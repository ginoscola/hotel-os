"""
Test per le due modalità della dashboard gruppo:
  - modalita=stagione  → dati intera stagione per snapshot
  - modalita=settimana → dati singola settimana commerciale
  - GET /dashboard/gruppo/snapshots
  - legacy (da/a) rimane funzionante
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models.revenue import DailyRevenue, Hotel  # noqa: F401 — per Base.metadata

TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"

# Snapshot e dati di test
SNAP = date(2026, 5, 4)
SNAP_STR = "2026-05-04"


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def TestSession(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture(scope="module")
def client(test_engine, TestSession):
    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulisci_e_popola(test_engine):
    """Svuota le tabelle e inserisce dati minimi di test per ogni test."""
    with test_engine.connect() as conn:
        conn.execute(text(
            "TRUNCATE budget_entries, daily_revenue, hotel_seasons, hotels, imports "
            "RESTART IDENTITY CASCADE"
        ))
        # Tre hotel
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('CLB', 'Club Hotel', 45),
            ('DPH', 'Hotel Du Parc', 43),
            ('INT', 'Hotel International', 45)
        """))
        # Dati per due settimane (sab 30/05 e sab 06/06), due hotel (CLB e DPH)
        # Settimana 1: 30/05 – 05/06 (7 giorni per CLB, 7 per DPH)
        for giorno in range(7):
            d = f"2026-05-{30 + giorno:02d}" if 30 + giorno <= 31 else f"2026-06-{giorno - 2:02d}"
            # Calcolo corretto delle date
        # Inserisco con date esplicite
        rows = [
            # (hotel_code, data, rooms_sold, rooms_available, rev_rooms, rev_fnb, rev_extra, rev_total)
            ("CLB", "2026-05-30", 20, 45, 1000.00, 300.00, 50.00, 1350.00),
            ("CLB", "2026-05-31", 22, 45, 1100.00, 320.00, 0.00,  1420.00),
            ("CLB", "2026-06-01", 25, 45, 1250.00, 400.00, 100.00, 1750.00),
            ("CLB", "2026-06-02", 18, 45, 900.00,  200.00, 0.00,   1100.00),
            ("CLB", "2026-06-03", 15, 45, 750.00,  150.00, 0.00,   900.00),
            ("CLB", "2026-06-04", 12, 45, 600.00,  120.00, 0.00,   720.00),
            ("CLB", "2026-06-05", 10, 45, 500.00,  100.00, 0.00,   600.00),
            ("DPH", "2026-05-30", 30, 43, 1500.00, 500.00, 80.00,  2080.00),
            ("DPH", "2026-05-31", 32, 43, 1600.00, 550.00, 0.00,   2150.00),
            ("DPH", "2026-06-01", 35, 43, 1750.00, 600.00, 200.00, 2550.00),
            ("DPH", "2026-06-02", 28, 43, 1400.00, 400.00, 0.00,   1800.00),
            ("DPH", "2026-06-03", 20, 43, 1000.00, 300.00, 0.00,   1300.00),
            ("DPH", "2026-06-04", 18, 43, 900.00,  250.00, 0.00,   1150.00),
            ("DPH", "2026-06-05", 15, 43, 750.00,  200.00, 0.00,   950.00),
            # Settimana 2: 06/06 – 12/06 (solo CLB per semplicità)
            ("CLB", "2026-06-06", 28, 45, 1400.00, 450.00, 70.00, 1920.00),
            ("CLB", "2026-06-07", 30, 45, 1500.00, 480.00, 0.00,  1980.00),
            ("CLB", "2026-06-08", 32, 45, 1600.00, 500.00, 0.00,  2100.00),
            ("CLB", "2026-06-09", 25, 45, 1250.00, 380.00, 0.00,  1630.00),
            ("CLB", "2026-06-10", 20, 45, 1000.00, 300.00, 0.00,  1300.00),
            ("CLB", "2026-06-11", 18, 45, 900.00,  270.00, 0.00,  1170.00),
            ("CLB", "2026-06-12", 15, 45, 750.00,  220.00, 0.00,  970.00),
        ]
        for r in rows:
            conn.execute(text("""
                INSERT INTO daily_revenue
                  (hotel_code, data, rooms_sold, rooms_available, pax,
                   revenue_rooms, revenue_fnb, revenue_extra, revenue_total,
                   snapshot_date)
                VALUES (:hc, :d, :rs, :ra, 0, :rr, :rf, :re, :rt, :snap)
            """), {
                "hc": r[0], "d": r[1], "rs": r[2], "ra": r[3],
                "rr": r[4], "rf": r[5], "re": r[6], "rt": r[7],
                "snap": SNAP_STR,
            })
        conn.commit()


# ---------------------------------------------------------------------------
# Test GET /dashboard/gruppo/snapshots
# ---------------------------------------------------------------------------

def test_snapshots_gruppo_restituisce_lista(client):
    """GET /dashboard/gruppo/snapshots restituisce le snapshot disponibili."""
    resp = client.get("/dashboard/gruppo/snapshots")
    assert resp.status_code == 200
    data = resp.json()
    assert "snapshots" in data
    assert len(data["snapshots"]) == 1
    assert data["snapshots"][0]["snapshot_date"] == SNAP_STR


def test_snapshots_gruppo_route_non_ambigua(client):
    """L'endpoint /snapshots non viene catturato dalla route /gruppo generico."""
    resp = client.get("/dashboard/gruppo/snapshots")
    assert resp.status_code == 200
    assert "snapshots" in resp.json()


# ---------------------------------------------------------------------------
# Test modalità STAGIONE
# ---------------------------------------------------------------------------

def test_stagione_kpi_tutta_stagione(client):
    """modalita=stagione aggrega tutti i dati della snapshot."""
    resp = client.get(f"/dashboard/gruppo?modalita=stagione&snapshot={SNAP_STR}")
    assert resp.status_code == 200
    dati = resp.json()
    assert dati["modalita"] == "stagione"
    assert dati["snapshot_date"] == SNAP_STR
    # Tutti e due gli hotel hanno dati
    assert set(dati["hotel_attivi"]) == {"CLB", "DPH"}
    # Camere vendute = somma di tutte le righe
    rooms_expected = sum([
        20, 22, 25, 18, 15, 12, 10,  # CLB sett1
        30, 32, 35, 28, 20, 18, 15,  # DPH sett1
        28, 30, 32, 25, 20, 18, 15,  # CLB sett2
    ])
    assert dati["kpi_gruppo"]["rooms_sold"] == rooms_expected
    # settimane contiene più di 1 settimana
    assert len(dati["settimane"]) >= 2


def test_stagione_settimana_ref_non_impostata(client):
    """In modalità stagione, settimana_ref_start e _end sono null."""
    resp = client.get(f"/dashboard/gruppo?modalita=stagione&snapshot={SNAP_STR}")
    dati = resp.json()
    assert dati["settimana_ref_start"] is None
    assert dati["settimana_ref_end"] is None


def test_stagione_contributi_per_hotel(client):
    """In modalità stagione, i contributi elencano tutti gli hotel con dati."""
    resp = client.get(f"/dashboard/gruppo?modalita=stagione&snapshot={SNAP_STR}")
    dati = resp.json()
    hotel_codes = {c["hotel_code"] for c in dati["contributi"]}
    assert hotel_codes == {"CLB", "DPH"}


def test_stagione_snapshot_inesistente_404(client):
    """modalita=stagione con snapshot non esistente restituisce 404."""
    resp = client.get("/dashboard/gruppo?modalita=stagione&snapshot=2025-01-01")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test modalità SETTIMANA
# ---------------------------------------------------------------------------

def test_settimana_kpi_solo_settimana_selezionata(client):
    """modalita=settimana filtra i dati alla settimana commerciale indicata."""
    resp = client.get(
        f"/dashboard/gruppo?modalita=settimana&settimana=2026-05-30&snapshot={SNAP_STR}"
    )
    assert resp.status_code == 200
    dati = resp.json()
    assert dati["modalita"] == "settimana"
    assert dati["settimana_ref_start"] == "2026-05-30"
    assert dati["settimana_ref_end"]   == "2026-06-05"
    # Solo la prima settimana: CLB (7 giorni) + DPH (7 giorni)
    rooms_expected = (20+22+25+18+15+12+10) + (30+32+35+28+20+18+15)
    assert dati["kpi_gruppo"]["rooms_sold"] == rooms_expected


def test_settimana_seconda_settimana(client):
    """Settimana 06/06 ha solo CLB."""
    resp = client.get(
        f"/dashboard/gruppo?modalita=settimana&settimana=2026-06-06&snapshot={SNAP_STR}"
    )
    assert resp.status_code == 200
    dati = resp.json()
    assert dati["hotel_attivi"] == ["CLB"]
    rooms_expected = 28 + 30 + 32 + 25 + 20 + 18 + 15
    assert dati["kpi_gruppo"]["rooms_sold"] == rooms_expected


def test_settimana_senza_snapshot_usa_max_disponibile(client):
    """modalita=settimana senza snapshot esplicito usa il max disponibile."""
    resp = client.get("/dashboard/gruppo?modalita=settimana&settimana=2026-05-30")
    assert resp.status_code == 200
    assert resp.json()["snapshot_date"] == SNAP_STR


def test_settimana_inesistente_404(client):
    """Settimana senza dati restituisce 404."""
    resp = client.get("/dashboard/gruppo?modalita=settimana&settimana=2025-01-04")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test legacy (da/a) — nessuna regressione
# ---------------------------------------------------------------------------

def test_legacy_da_a_funziona(client):
    """Il parametro da/a legacy funziona ancora correttamente."""
    resp = client.get("/dashboard/gruppo?da=2026-05-30&a=2026-06-05")
    assert resp.status_code == 200
    dati = resp.json()
    rooms_expected = (20+22+25+18+15+12+10) + (30+32+35+28+20+18+15)
    assert dati["kpi_gruppo"]["rooms_sold"] == rooms_expected
