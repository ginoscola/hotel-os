"""Test KPI e categorie KPI del Conto Economico USALI contabile.

Produzione fittizia in daily_revenue per DPH 2026 (stagione 01/05–19/09):
maggio/giugno/luglio/settembre presenti, agosto assente (→ KPI per camera vuoti),
gennaio–aprile fuori stagione (→ chiuso: solo costi). Categorie KPI = seed della migrazione.
"""
import importlib.util
import io
import os
import sys
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app.auth import richiedi_admin, richiedi_utente_attivo  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services.usali_contabile_parser import parse_export  # noqa: E402

from tests._db import TEST_DB_URL  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "usali")
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
with open(os.path.join(FIXTURES, "export-1.xlsx"), "rb") as f:
    XLSX = f.read()
with open(os.path.join(FIXTURES, "pivot-1.csv"), "rb") as f:
    CSV = f.read()


def _seed_categorie():
    percorso = os.path.join(os.path.dirname(__file__), "..", "alembic", "versions",
                            "usali006_2026_conto_economico_contabile.py")
    spec = importlib.util.spec_from_file_location("usali006", percorso)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.CATEGORIE_KPI


CATEGORIE = _seed_categorie()

# mese → (giorni, camere disponibili/giorno, vendute/giorno, presenze/giorno)
PRODUZIONE = {5: (31, 43, 20, 40), 6: (30, 43, 30, 60), 7: (31, 43, 40, 85), 9: (19, 43, 25, 50)}


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def client(test_engine, tmp_path_factory):
    os.environ["USALI_CONTABILE_DIR"] = str(tmp_path_factory.mktemp("usali_contabile_kpi"))
    TestSession = sessionmaker(bind=test_engine)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    utente_finto = SimpleNamespace(id=None)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente_finto
    app.dependency_overrides[richiedi_admin] = lambda: utente_finto
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    os.environ.pop("USALI_CONTABILE_DIR", None)


@pytest.fixture(autouse=True)
def semina(test_engine, client):
    with test_engine.begin() as conn:
        conn.execute(text(
            "TRUNCATE usali_riga, usali_import, usali_regola_segmento, usali_segmento, "
            "usali_struttura_gestionale, usali_categoria_kpi, daily_revenue, hotel_seasons, hotels "
            "RESTART IDENTITY CASCADE"
        ))
        conn.execute(text("INSERT INTO hotels (code, name, default_rooms) VALUES ('DPH', 'Hotel Du Parc', 43)"))
        conn.execute(text(
            "INSERT INTO hotel_seasons (hotel_id, season_year, open_date, close_date, total_rooms) "
            "VALUES (1, 2026, '2026-05-01', '2026-09-19', 43)"
        ))
        conn.execute(text(
            "INSERT INTO usali_struttura_gestionale (id_gestionale, struttura_code) VALUES (128, 'DPH')"
        ))
        for categoria, conti in CATEGORIE.items():
            for conto in conti:
                conn.execute(text(
                    "INSERT INTO usali_categoria_kpi (conto_nome, reparto, categoria) VALUES (:c, '', :k)"
                ), {"c": conto, "k": categoria})
        for mese, (giorni, disp, vend, pax) in PRODUZIONE.items():
            for g in range(giorni):
                d = date(2026, mese, 1) + timedelta(days=g)
                # Snapshot vecchia con valori diversi: deve essere ignorata
                conn.execute(text(
                    "INSERT INTO daily_revenue (hotel_code, data, rooms_sold, rooms_available, pax, "
                    "revenue_rooms, revenue_fnb, revenue_extra, revenue_total, snapshot_date, is_test) "
                    "VALUES ('DPH', :d, 1, :disp, 1, 0, 0, 0, 0, '2026-03-01', false), "
                    "('DPH', :d, :vend, :disp, :pax, 0, 0, 0, 0, '2026-09-21', false)"
                ), {"d": d, "disp": disp, "vend": vend, "pax": pax})
    r = client.post("/usali/contabile/anteprima", files={
        "xlsx": ("export-1.xlsx", XLSX, XLSX_MIME), "csv": ("pivot-1.csv", CSV, "text/csv"),
    })
    assert r.status_code == 200, r.text
    c = client.post("/usali/contabile/conferma", json={"token": r.json()["token"]})
    assert c.status_code == 200, c.text


# ── Calcolo atteso indipendente, dal parser ──────────────────────────────────

RIGHE = parse_export(XLSX).righe
NOMI = {cat: {n.lower() for n in conti} for cat, conti in CATEGORIE.items()}


def _somma(mesi, filtro):
    return sum((r.importi[(2026, m)] for r in RIGHE if filtro(r) for m in mesi), Decimal(0))


def _ricavi(mesi, rep=None):
    return _somma(mesi, lambda r: r.sezione == "Ricavi Operativi" and (rep is None or r.reparto == rep))


def _gop(mesi):
    return _somma(mesi, lambda r: r.sezione in ("Ricavi Operativi", "Costi Operativi", "Costi Generali"))


def _costo_cat(mesi, cat, sez=None, rep=None):
    return -_somma(mesi, lambda r: r.tipo == "costo" and r.conto_nome.lower() in NOMI[cat]
                   and (sez is None or r.sezione == sez) and (rep is None or r.reparto == rep))


def _disp(mesi):
    return sum(PRODUZIONE[m][0] * PRODUZIONE[m][1] for m in mesi)


def _vend(mesi):
    return sum(PRODUZIONE[m][0] * PRODUZIONE[m][2] for m in mesi)


def _r(x):
    return round(float(x), 2)


def _kpi(client, **params):
    params = {"struttura": "DPH", "anno": 2026, "mese_da": 1, "mese_a": 9, **params}
    r = client.get("/usali/contabile/kpi", params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ── KPI ──────────────────────────────────────────────────────────────────────

def test_stati_produzione(client):
    mensili = {x["mese"]: x for x in _kpi(client)["mensili"]}
    assert [mensili[m]["stato_produzione"] for m in range(1, 10)] == \
        ["chiuso"] * 4 + ["ok"] * 3 + ["mancante", "ok"]
    # Mese chiuso: costi sì, KPI per camera no
    gen = mensili[1]
    assert gen["camere_disponibili"] == 0
    assert gen["occupazione"] is None and gen["goppar"] is None and gen["adr"] is None
    assert gen["costo_personale"] == _r(_costo_cat([1], "personale"))
    assert gen["gop"] == -6824.80
    # Mese senza produzione: KPI per camera vuoti (non zero), rapporti sugli importi presenti
    ago = mensili[8]
    assert ago["camere_disponibili"] is None
    for k in ("occupazione", "adr", "revpar", "trevpar", "goppar", "cpor", "utenze_per_camera_venduta"):
        assert ago[k] is None
    assert ago["gop_perc"] == _r(_gop([8]) / _ricavi([8]) * 100)


def test_kpi_mensili_giugno(client):
    giu = next(x for x in _kpi(client)["mensili"] if x["mese"] == 6)
    disp, vend = _disp([6]), _vend([6])
    ric_cam = _ricavi([6], "Camere")
    costi_cam = -_somma([6], lambda r: r.sezione == "Costi Operativi" and r.reparto == "Camere")
    assert giu["camere_disponibili"] == disp and giu["camere_vendute"] == vend   # snapshot più recente
    assert giu["presenze"] == 30 * 60
    assert giu["occupazione"] == _r(Decimal(vend) / disp * 100)
    assert giu["adr"] == _r(ric_cam / vend)
    assert giu["revpar"] == _r(ric_cam / disp)
    assert giu["trevpar"] == _r(_ricavi([6]) / disp)
    assert giu["goppar"] == _r(_gop([6]) / disp)
    assert giu["gop_perc"] == _r(_gop([6]) / _ricavi([6]) * 100)
    assert giu["cpor"] == _r(costi_cam / vend)
    assert giu["margine_camere_perc"] == _r((ric_cam - costi_cam) / ric_cam * 100)
    assert giu["costo_personale_perc"] == _r(_costo_cat([6], "personale") / _ricavi([6]) * 100)
    assert giu["commissioni_perc_ricavi_camere"] == _r(
        _costo_cat([6], "commissioni", "Costi Operativi", "Camere") / ric_cam * 100)
    ric_fnb = _ricavi([6], "Food & Beverage")
    assert giu["food_cost_perc"] == _r(_costo_cat([6], "food", "Costi Operativi", "Food & Beverage") / ric_fnb * 100)
    assert giu["beverage_cost_perc"] == _r(
        _costo_cat([6], "beverage", "Costi Operativi", "Food & Beverage") / ric_fnb * 100)
    assert giu["utenze_per_camera_venduta"] == _r(_costo_cat([6], "utenze") / vend)
    assert set(giu["personale_per_reparto"]) >= {"Camere", "Food & Beverage"}
    assert sum(giu["personale_per_reparto"].values()) == pytest.approx(giu["costo_personale"], abs=0.05)


def test_kpi_periodo_solo_mesi_aperti(client):
    k = _kpi(client)
    p = k["periodo"]
    aperti = [5, 6, 7, 9]
    assert k["mesi_per_camera"] == aperti
    assert k["mesi_senza_produzione"] == [8]
    assert p["camere_disponibili"] == _disp(aperti)
    # Totali aggregati sui mesi aperti, mai medie dei KPI mensili
    assert p["occupazione"] == _r(Decimal(_vend(aperti)) / _disp(aperti) * 100)
    assert p["goppar"] == _r(_gop(aperti) / _disp(aperti))
    assert p["adr"] == _r(_ricavi(aperti, "Camere") / _vend(aperti))
    # Rapporti sugli importi: tutti i mesi del periodo (agosto compreso)
    tutti = list(range(1, 10))
    assert p["gop"] == 105037.14
    assert p["gop_perc"] == _r(_gop(tutti) / _ricavi(tutti) * 100)
    assert p["costo_personale"] == _r(_costo_cat(tutti, "personale"))


def test_gop_cumulato(client):
    mensili = _kpi(client, mese_da=6, mese_a=9)["mensili"]
    assert [x["mese"] for x in mensili] == [6, 7, 8, 9]
    # Cumulato da gennaio anche se il periodo parte da giugno
    assert mensili[0]["gop_cumulato"] == _r(_gop(range(1, 7)))
    assert mensili[-1]["gop_cumulato"] == 105037.14


def test_mese_non_importato(client):
    mensili = {x["mese"]: x for x in _kpi(client, mese_da=9, mese_a=12)["mensili"]}
    assert mensili[10]["importato"] is False
    assert mensili[10]["gop"] is None and mensili[10]["gop_cumulato"] is None


def test_struttura_senza_camere(client):
    k = _kpi(client, struttura="BON")
    assert all(x["stato_produzione"] == "non_applicabile" for x in k["mensili"])
    assert k["periodo"]["goppar"] is None


# ── Categorie KPI ────────────────────────────────────────────────────────────

def test_non_categorizzati_e_crud(client):
    elenco = client.get("/usali/contabile/categorie-kpi/non-categorizzati").json()
    nomi = {(x["conto_nome"], x["reparto"]) for x in elenco}
    assert ("Biancheria", "Camere") in nomi
    assert not any(x["conto_nome"] == "Retribuzione netta" for x in elenco)   # già nel seed
    assert all(x["strutture"] == ["DPH"] for x in elenco)

    r = client.post("/usali/contabile/categorie-kpi",
                    json={"conto_nome": "Biancheria", "reparto": "", "categoria": "altro"})
    assert r.status_code == 200, r.text
    assert client.post("/usali/contabile/categorie-kpi",
                       json={"conto_nome": "biancheria", "categoria": "altro"}).status_code == 409
    assert client.post("/usali/contabile/categorie-kpi",
                       json={"conto_nome": "Gas Cucina", "categoria": "pippo"}).status_code == 400
    elenco = client.get("/usali/contabile/categorie-kpi/non-categorizzati").json()
    assert not any(x["conto_nome"] == "Biancheria" for x in elenco)

    cid = r.json()["id"]
    assert client.put(f"/usali/contabile/categorie-kpi/{cid}", json={"categoria": "utenze"}).json()["categoria"] == "utenze"
    assert client.delete(f"/usali/contabile/categorie-kpi/{cid}").status_code == 200


def test_categoria_specifica_per_reparto_vince(client):
    giu_prima = next(x for x in _kpi(client)["mensili"] if x["mese"] == 6)
    # 'Voucher' in Camere non è personale (regola specifica di reparto)
    client.post("/usali/contabile/categorie-kpi",
                json={"conto_nome": "Voucher", "reparto": "Camere", "categoria": "altro"})
    giu = next(x for x in _kpi(client)["mensili"] if x["mese"] == 6)
    voucher_camere = -_somma([6], lambda r: r.conto_nome == "Voucher" and r.reparto == "Camere")
    assert giu["costo_personale"] == pytest.approx(giu_prima["costo_personale"] - float(voucher_camere), abs=0.01)
