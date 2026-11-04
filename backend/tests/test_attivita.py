"""Test delle attività ricorrenti (scadenziario operativo): occorrenze, finestre, stato, parametri da Admin e API."""

from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app.models.corrispettivi import RtChiusura
from app.models.revenue import Hotel, HotelSeason, ImportSession
from app.services.attivita import (PER_CODICE, Attivita, applica_parametri, in_ritardo, occorrenze, settimane,
                                   stato, valida_parametri, voci_mese)
from tests._db import TEST_DB_URL

OGGI = date(2026, 7, 15)
STAGIONI = {("INT", 2026): [(date(2026, 5, 30), date(2026, 9, 19))]}


# ── Calcoli puri ──────────────────────────────────────────────────────────────

def test_giornaliera_solo_nei_giorni_di_stagione():
    att = PER_CODICE["rt2"]
    maggio = occorrenze(att, 2026, 5, STAGIONI)
    assert [o.giorno_dato for o in maggio] == [date(2026, 5, 30), date(2026, 5, 31)]
    assert maggio[0].scadenza == date(2026, 5, 31)          # il dato di un giorno si carica il giorno dopo
    assert occorrenze(att, 2026, 5, {}) == []               # nessuna stagione configurata


def test_settimanale_finestra_della_settimana():
    occ = occorrenze(Attivita("x", "X", "G", "settimanale", giorno=0), 2026, 7, {})
    assert [o.scadenza for o in occ] == [date(2026, 7, d) for d in (6, 13, 20, 27)]
    assert (occ[0].da, occ[0].a) == (date(2026, 7, 6), date(2026, 7, 12))


def test_mensile_giorno_oltre_fine_mese_e_mesi_attivi():
    att = Attivita("x", "X", "G", "mensile", giorno=31, mesi=(2, 3))
    assert occorrenze(att, 2026, 2, {})[0].scadenza == date(2026, 2, 28)
    assert occorrenze(att, 2026, 4, {}) == []


def test_annuale_finestra_dell_anno():
    occ = occorrenze(Attivita("x", "X", "G", "annuale", giorno=15, mese=12), 2026, 12, {})
    assert (occ[0].scadenza, occ[0].da, occ[0].a) == (date(2026, 12, 15), date(2026, 1, 1), date(2026, 12, 31))
    assert occorrenze(Attivita("x", "X", "G", "annuale", giorno=15, mese=12), 2026, 11, {}) == []


def test_stato_con_parti_e_ritardo():
    att = Attivita("rev", "R", "G", "settimanale", giorno=0, parti=("DPH", "CLB"))
    occ = occorrenze(att, 2026, 7, {})[0]                   # lunedì 6/7
    ev = {"DPH": [date(2026, 7, 6)]}
    assert stato(occ, ev, set(), OGGI) == {"stato": "in_ritardo", "manuale": False, "mancanti": ["CLB"]}
    assert stato(occ, {**ev, "CLB": [date(2026, 7, 12)]}, set(), OGGI)["stato"] == "fatta"
    assert stato(occ, {**ev, "CLB": [date(2026, 7, 13)]}, set(), OGGI)["stato"] == "in_ritardo"  # settimana dopo
    assert stato(occ, ev, set(), date(2026, 7, 6))["stato"] == "da_fare"


def test_spunta_a_mano_e_attivita_non_verificabile():
    att = Attivita("m", "M", "G", "mensile", giorno=5, automatica=False)
    occ = occorrenze(att, 2026, 7, {})[0]
    assert stato(occ, {"": [date(2026, 7, 3)]}, set(), OGGI)["stato"] == "in_ritardo"   # evidenze ignorate
    assert stato(occ, {}, {("m", date(2026, 7, 5))}, OGGI) == {"stato": "fatta", "manuale": True, "mancanti": []}


def test_parametri_da_admin():
    assert valida_parametri("revenue", {"giorno": 2, "mesi": [9, 3, 3]}) == {"giorno": 2, "mesi": [3, 9]}
    with pytest.raises(ValueError):
        valida_parametri("revenue", {"giorno": 7})
    with pytest.raises(ValueError):
        valida_parametri("cedolini", {"mesi": []})
    with pytest.raises(ValueError):
        valida_parametri("inesistente", {})
    cat = {a.codice: a for a in applica_parametri({"revenue": {"giorno": 2}, "banca": {"attiva": False},
                                                    "cedolini": {"giorno": 99}})}
    assert cat["revenue"].giorno == 2 and not cat["banca"].attiva
    assert cat["cedolini"].giorno == PER_CODICE["cedolini"].giorno    # override non valido ignorato


def test_settimane_del_mese():
    s = settimane(2026, 11)
    assert s[0] == (date(2026, 10, 26), date(2026, 11, 1)) and s[-1][1] == date(2026, 12, 6)


def test_voci_mese_giornaliere_raggruppate_e_in_ritardo():
    att = PER_CODICE["rt2"]
    ev = {"rt2": {"": [date(2026, 7, d) for d in range(1, 15) if d != 8]}}
    sett = voci_mese([att], 2026, 7, ev, set(), STAGIONI, OGGI)
    v = next(v for s in sett for v in s["voci"] if s["inizio"] == date(2026, 7, 6))
    assert v["stato"] == "in_ritardo" and len(v["giorni"]) == 7
    assert [g["data"] for g in v["giorni"] if g["stato"] == "in_ritardo"] == [date(2026, 7, 8)]
    ritardi = in_ritardo([sett])
    assert len(ritardi) == 1 and [g["data"] for g in ritardi[0]["giorni"]] == [date(2026, 7, 8)]
    assert ritardi[0]["scadenze"] == [date(2026, 7, 9)]


# ── API ──────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def engine():
    e = create_engine(TEST_DB_URL)
    Base.metadata.create_all(e)
    yield e
    Base.metadata.drop_all(e)
    e.dispose()


@pytest.fixture(scope="module")
def Sessione(engine):
    return sessionmaker(bind=engine)


@pytest.fixture(scope="module")
def client(Sessione):
    def override_get_db():
        db = Sessione()
        try:
            yield db
        finally:
            db.close()

    utente = SimpleNamespace(id=None, ruolo="admin")
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente
    app.dependency_overrides[richiedi_admin] = lambda: utente
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulizia(engine):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE attivita_fatte, rt_chiusure, imports, hotel_seasons, hotels, app_config "
                          "RESTART IDENTITY CASCADE"))


def _voce(r, codice, scadenza):
    return next(v for s in r["settimane"] for v in s["voci"] if v["codice"] == codice and scadenza in v["scadenze"])


def test_api_stato_dagli_import_e_spunta(client, Sessione):
    db = Sessione()
    h = Hotel(code="INT", name="International", default_rooms=45)
    db.add(h)
    db.flush()
    db.add(HotelSeason(hotel_id=h.id, season_year=2025, open_date=date(2025, 6, 1), close_date=date(2025, 9, 20),
                       total_rooms=45))
    db.add(RtChiusura(data_chiusura=date(2025, 7, 1), rt_code="RT2", totale_giorno=100))
    for code in ("DPH", "CLB", "INT"):
        db.add(ImportSession(hotel_code=code, snapshot_date=date(2025, 7, 7)))
    db.commit()
    db.close()

    r = client.get("/attivita", params={"anno": 2025, "mese": 7}).json()
    assert _voce(r, "revenue", "2025-07-07")["stato"] == "fatta"
    assert _voce(r, "revenue", "2025-07-14")["stato"] == "in_ritardo"
    rt2 = _voce(r, "rt2", "2025-07-02")
    assert [g["stato"] for g in rt2["giorni"]][:2] == ["fatta", "in_ritardo"]

    assert client.post("/attivita/fatto", json={"codice": "revenue", "scadenze": ["2025-07-14"]}).status_code == 200
    r = client.get("/attivita", params={"anno": 2025, "mese": 7}).json()
    assert _voce(r, "revenue", "2025-07-14")["manuale"] is True
    client.post("/attivita/fatto", json={"codice": "revenue", "scadenze": ["2025-07-14"], "fatto": False})
    r = client.get("/attivita", params={"anno": 2025, "mese": 7}).json()
    assert _voce(r, "revenue", "2025-07-14")["stato"] == "in_ritardo"
    assert client.post("/attivita/fatto", json={"codice": "x", "scadenze": []}).status_code == 404


def test_api_parametri_e_catalogo(client):
    assert client.put("/attivita/parametri/revenue", json={"giorno": 7}).status_code == 400
    assert client.put("/attivita/parametri/revenue", json={"giorno": 2, "mesi": [7]}).status_code == 200
    voce = next(a for a in client.get("/attivita/catalogo").json() if a["codice"] == "revenue")
    assert voce["giorno"] == 2 and voce["mesi"] == [7] and voce["modificata"] and voce["descrizione"] == "ogni mercoledì"
    r = client.get("/attivita", params={"anno": 2025, "mese": 7}).json()
    assert _voce(r, "revenue", "2025-07-02")
    client.put("/attivita/parametri/revenue", json={"ripristina": True})
    voce = next(a for a in client.get("/attivita/catalogo").json() if a["codice"] == "revenue")
    assert voce["giorno"] == 0 and not voce["modificata"]


def test_api_riepilogo_ed_export(client):
    r = client.get("/attivita/riepilogo").json()
    assert set(r) == {"in_ritardo", "da_fare_7gg"}
    pdf = client.get("/attivita/export", params={"anno": 2025, "mese": 7})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
