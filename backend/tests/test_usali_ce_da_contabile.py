"""Conto Economico interno (/usali/report) alimentato dalla contabilità importata.

Con un import contabile (fixture DPH gen–set 2026): EBITDAR = GOP contabile, ricavi e costi dalle
righe contabili, lavoro per reparto dai cedolini (qui simulati), differenza personale contabile −
cedolini in "lavoro non suddiviso", voci non modificabili a mano. Mesi senza contabilità: fonti
di sempre.
"""
import importlib.util
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import app.routers.usali as usali_router  # noqa: E402
from app.auth import richiedi_admin, richiedi_utente_attivo  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services.usali_contabile_ce import voce_interna  # noqa: E402

from tests._db import TEST_DB_URL  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "usali")
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
with open(os.path.join(FIXTURES, "export-1.xlsx"), "rb") as f:
    XLSX = f.read()
with open(os.path.join(FIXTURES, "pivot-1.csv"), "rb") as f:
    CSV = f.read()

CEDOLINI = {"lavoro_camere": 1000.0, "lavoro_fnb": 2000.0, "lavoro_altri_reparti": None}


def _seed_categorie():
    percorso = os.path.join(os.path.dirname(__file__), "..", "alembic", "versions",
                            "usali006_2026_conto_economico_contabile.py")
    spec = importlib.util.spec_from_file_location("usali006", percorso)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.CATEGORIE_KPI


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def client(test_engine, tmp_path_factory):
    os.environ["USALI_CONTABILE_DIR"] = str(tmp_path_factory.mktemp("usali_ce_contabile"))
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
def semina(test_engine, client, monkeypatch):
    # Cedolini finti solo per gen–set (i mesi della contabilità di prova)
    monkeypatch.setattr(usali_router, "_lavoro_cedolini",
                        lambda db, codice, anno, m_ini, m_fin, cc: dict(CEDOLINI) if m_fin <= 9 else {})
    with test_engine.begin() as conn:
        conn.execute(text(
            "TRUNCATE usali_riga, usali_import, usali_struttura_gestionale, usali_categoria_kpi, "
            "usali_voci_manuali, daily_revenue, hotels RESTART IDENTITY CASCADE"
        ))
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('DPH', 'Hotel Du Parc', 43), ('CLB', 'Club Hotel', 45), ('INT', 'International', 45)
        """))
        conn.execute(text(
            "INSERT INTO usali_struttura_gestionale (id_gestionale, struttura_code) VALUES (128, 'DPH')"
        ))
        for categoria, conti in _seed_categorie().items():
            for conto in conti:
                conn.execute(text(
                    "INSERT INTO usali_categoria_kpi (conto_nome, reparto, categoria) VALUES (:c, '', :k)"
                ), {"c": conto, "k": categoria})
    r = client.post("/usali/contabile/anteprima", files={
        "xlsx": ("export-1.xlsx", XLSX, XLSX_MIME), "csv": ("pivot-1.csv", CSV, "text/csv"),
    })
    assert r.status_code == 200, r.text
    assert client.post("/usali/contabile/conferma", json={"token": r.json()["token"]}).status_code == 200


def _dph(client, mese, ytd):
    r = client.get("/usali/report", params={"anno": 2026, "mese": mese, "ytd": str(ytd).lower()})
    assert r.status_code == 200, r.text
    return next(s for s in r.json()["strutture"] if s["struttura_code"] == "DPH")


def test_ytd_ebitdar_uguale_gop_contabile(client):
    s = _dph(client, 9, True)
    c = s["contabile"]
    assert s["tot_ricavi"] == 581783.76
    assert s["ebitdar"] == pytest.approx(105037.14, abs=0.01)
    assert c["gop_contabile"] == 105037.14 and c["differenza_gop"] == 0
    assert c["mesi_contabili"] == list(range(1, 10)) and c["mesi_altre_fonti"] == []
    # Lavoro per reparto dai cedolini, differenza col personale contabile nel "non suddiviso"
    assert s["lavoro_camere"] == 1000 and s["lavoro_fnb"] == 2000
    assert c["personale_cedolini"] == 3000
    assert s["lavoro_non_suddiviso"] == pytest.approx(c["personale_contabile"] - 3000, abs=0.01)
    # Utenze = conti contabili di Costi Generali > Utenze
    assert s["utenze"] == pytest.approx(10473.15 + 23343.96 + 3064.45, abs=0.02)
    assert "manutenzioni" in s["voci_auto"] and "ricavi_camere" in s["voci_auto"]


def test_mese_singolo(client):
    s = _dph(client, 6, False)
    assert s["tot_ricavi"] == 93546.83
    assert s["ebitdar"] == pytest.approx(5197.65, abs=0.01)
    assert s["contabile"]["differenza_gop"] == 0


def test_voci_manuali_bloccate_nei_mesi_contabili(client):
    body = {"struttura_code": "DPH", "anno": 2026, "voce_code": "utenze", "valore": 100}
    assert client.put("/usali/voce", json={**body, "mese": 6}).status_code == 409
    assert client.put("/usali/voce", json={**body, "mese": 10}).status_code == 200


def test_voci_manuali_ignorate_e_mesi_misti(client, test_engine):
    with test_engine.begin() as conn:
        # Valore manuale su un mese contabile (inserito prima della contabilità): ignorato
        conn.execute(text("INSERT INTO usali_voci_manuali (struttura_code, anno, mese, voce_code, valore) "
                          "VALUES ('DPH', 2026, 9, 'manutenzioni', 99999)"))
    assert _dph(client, 9, True)["ebitdar"] == pytest.approx(105037.14, abs=0.01)

    # Ottobre senza contabilità: voce manuale non compilata → 0 (non −cumulato di settembre)
    assert _dph(client, 10, False)["ebitdar"] == 0

    # Ottobre compilato a mano: YTD = contabilità gen–set + manuale ottobre
    with test_engine.begin() as conn:
        conn.execute(text("INSERT INTO usali_voci_manuali (struttura_code, anno, mese, voce_code, valore) "
                          "VALUES ('DPH', 2026, 10, 'manutenzioni', 100499)"))
    s = _dph(client, 10, True)
    assert s["contabile"]["mesi_altre_fonti"] == [10]
    assert s["ebitdar"] == pytest.approx(105037.14 - 500, abs=0.01)


def test_mesi_senza_contabilita_come_prima(client):
    r = client.get("/usali/report", params={"anno": 2025, "mese": 6, "ytd": "false"})
    assert r.status_code == 200
    assert all(s["contabile"] is None and s["voci_auto"] == [] for s in r.json()["strutture"])


def test_mappatura_voci():
    def riga(sezione, reparto, conto):
        return SimpleNamespace(sezione=sezione, reparto=reparto, conto_nome=conto)
    assert voce_interna(riga("Ricavi Operativi", "Camere", "Camere Individuali"), None) == "ricavi_camere"
    assert voce_interna(riga("Ricavi Operativi", "Ricavi Vari", "Penali"), None) == "ricavi_vari_operativi"
    assert voce_interna(riga("Costi Operativi", "Camere", "Servizi con Contratto"), None) == "appalto_camere"
    assert voce_interna(riga("Costi Operativi", "Camere", "Commissioni"), "commissioni") == "altri_costi_camere"
    assert voce_interna(riga("Costi Operativi", "Food & Beverage", "Branzino"), "food") == "fdv_fnb"
    assert voce_interna(riga("Costi Operativi", "Food & Beverage", "Porcellana"), None) == "attrezzature_fnb"
    assert voce_interna(riga("Costi Operativi", "Food & Beverage", "Carta e Plastica"), None) == "altri_costi_fnb"
    assert voce_interna(riga("Costi Operativi", "Altri Reparti Operativi", "Noleggi"), None) == "fdv_altri_reparti"
    assert voce_interna(riga("Costi Generali", "Amministrativo e Generale", "Prestazioni Professionali"), None) == "consulenze"
    assert voce_interna(riga("Costi Generali", "Utenze", "Gas"), "utenze") == "utenze"
    assert voce_interna(riga("Non Operativi", "Costi", "Affitti"), None) is None
