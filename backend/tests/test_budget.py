"""
Test per il router /budget e per la FK hotel_id in daily_revenue.

Usa lo stesso DB di test (revenue_master_test) degli altri test suite.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date

import sqlalchemy.exc
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models.revenue import BudgetEntry, DailyRevenue, Hotel  # noqa: F401 — per Base.metadata

TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"


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
def pulisci_tabelle(test_engine):
    """Svuota le tabelle rilevanti e reinserisce gli hotel base prima di ogni test."""
    with test_engine.connect() as conn:
        conn.execute(text(
            "TRUNCATE budget_entries, daily_revenue, hotel_seasons, hotels, imports "
            "RESTART IDENTITY CASCADE"
        ))
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('CLB', 'Club Hotel', 45),
            ('DPH', 'Hotel Du Parc', 43),
            ('INT', 'Hotel International', 45)
        """))
        conn.commit()


# ---------------------------------------------------------------------------
# Test endpoint GET /budget — lista vuota senza errore
# ---------------------------------------------------------------------------

def test_get_budget_lista_vuota(client):
    """GET /budget con nessun dato restituisce lista vuota, non errore."""
    resp = client.get("/budget/CLB/2026")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_budget_hotel_inesistente_404(client):
    """GET /budget con hotel non esistente restituisce 404."""
    resp = client.get("/budget/XXX/2026")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test endpoint POST /budget — inserimento e aggiornamento
# ---------------------------------------------------------------------------

def test_post_budget_inserisce_settimane(client):
    """POST /budget inserisce le settimane e le restituisce ordinate."""
    payload = [
        {
            "week_start": "2026-06-06",
            "version": "v1",
            "rooms_sold_budget": 200,
            "revenue_rooms_budget": 12000.00,
            "revenue_fnb_budget": 3000.00,
            "revenue_extra_budget": 500.00,
            "revenue_total_budget": 15500.00,
        },
        {
            "week_start": "2026-05-30",
            "version": "v1",
            "rooms_sold_budget": 180,
            "revenue_rooms_budget": 10800.00,
        },
    ]
    resp = client.post("/budget/CLB/2026", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    # Ordinate per week_start
    assert data[0]["week_start"] == "2026-05-30"
    assert data[1]["week_start"] == "2026-06-06"
    assert data[0]["rooms_sold_budget"] == 180
    assert data[1]["revenue_total_budget"] == 15500.0


def test_post_budget_upsert_aggiorna_valore(client):
    """Secondo POST con stessa settimana → aggiorna il valore, non duplica."""
    payload_v1 = [{"week_start": "2026-06-06", "rooms_sold_budget": 100}]
    client.post("/budget/CLB/2026", json=payload_v1)

    payload_v2 = [{"week_start": "2026-06-06", "rooms_sold_budget": 999}]
    resp = client.post("/budget/CLB/2026", json=payload_v2)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["rooms_sold_budget"] == 999


def test_post_budget_hotel_inesistente_404(client):
    """POST /budget con hotel non esistente restituisce 404."""
    resp = client.post("/budget/XXX/2026", json=[{"week_start": "2026-06-06"}])
    assert resp.status_code == 404


def test_get_budget_singola_settimana(client):
    """GET /budget/{hotel}/{year}/{week} restituisce la settimana corretta."""
    payload = [{"week_start": "2026-06-06", "rooms_sold_budget": 150}]
    client.post("/budget/CLB/2026", json=payload)

    resp = client.get("/budget/CLB/2026/2026-06-06")
    assert resp.status_code == 200
    assert resp.json()["rooms_sold_budget"] == 150


def test_get_budget_singola_settimana_assente_404(client):
    """GET /budget/{hotel}/{year}/{week} con settimana assente restituisce 404."""
    resp = client.get("/budget/CLB/2026/2026-06-06")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test FK hotel_id in daily_revenue
# ---------------------------------------------------------------------------

def test_hotel_id_viene_popolato_su_insert(test_engine, TestSession):
    """Inserimento in daily_revenue con hotel_code noto → hotel_id viene valorizzato."""
    with test_engine.connect() as conn:
        # Recupera l'id di CLB
        clb_id = conn.execute(
            text("SELECT id FROM hotels WHERE code = 'CLB'")
        ).scalar()

        conn.execute(text("""
            INSERT INTO daily_revenue
              (hotel_code, data, rooms_sold, rooms_available, pax,
               revenue_rooms, revenue_fnb, revenue_extra, revenue_total,
               snapshot_date, hotel_id)
            VALUES
              ('CLB', '2026-06-01', 30, 45, 60, 2000, 500, 100, 2600,
               '2026-05-08', :hotel_id)
        """), {"hotel_id": clb_id})
        conn.commit()

        hotel_id_letto = conn.execute(
            text("SELECT hotel_id FROM daily_revenue WHERE data = '2026-06-01'")
        ).scalar()

    assert hotel_id_letto == clb_id


def test_hotel_id_fk_rifiuta_id_non_valido(test_engine):
    """Inserimento con hotel_id non esistente deve sollevare un'eccezione di integrità."""
    with pytest.raises(Exception) as exc_info:
        with test_engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO daily_revenue
                  (hotel_code, data, rooms_sold, rooms_available, pax,
                   revenue_rooms, revenue_fnb, revenue_extra, revenue_total,
                   snapshot_date, hotel_id)
                VALUES
                  ('CLB', '2026-06-02', 10, 45, 20, 800, 200, 0, 1000,
                   '2026-05-08', 99999)
            """))
            conn.commit()
    # PostgreSQL solleva ForeignKeyViolation
    assert "foreign key" in str(exc_info.value).lower() or \
           "violates" in str(exc_info.value).lower() or \
           "IntegrityError" in type(exc_info.value).__name__
