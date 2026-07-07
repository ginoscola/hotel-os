"""
Test per la tabella app_config, la lettura di week_start_weekday
nel weekly_aggregator e gli endpoint GET /config/.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app import database as app_database
from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app.models.revenue import AppConfig  # noqa: F401 — per Base.metadata
from app.services.weekly_aggregator import _leggi_week_start, _reset_week_start_cache

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
    app.dependency_overrides[richiedi_utente_attivo] = lambda: None
    app.dependency_overrides[richiedi_admin] = lambda: None
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulisci_config(test_engine):
    """Svuota app_config prima di ogni test e resetta la cache del modulo."""
    with test_engine.connect() as conn:
        conn.execute(text("TRUNCATE app_config"))
        conn.commit()
    _reset_week_start_cache()
    yield
    _reset_week_start_cache()


# ---------------------------------------------------------------------------
# Test: lettura week_start_weekday da app_config
# ---------------------------------------------------------------------------

def test_week_start_legge_da_app_config(test_engine, TestSession, monkeypatch):
    """Se app_config contiene week_start_weekday, _leggi_week_start() lo usa."""
    with test_engine.connect() as conn:
        conn.execute(text(
            "INSERT INTO app_config (key, value) VALUES ('week_start_weekday', '1')"
        ))
        conn.commit()

    monkeypatch.setattr(app_database, "SessionLocal", TestSession)
    assert _leggi_week_start() == 1


def test_week_start_fallback_se_chiave_assente(TestSession, monkeypatch):
    """Se la chiave non esiste in app_config, il fallback è 5 (sabato)."""
    # app_config è svuotata da pulisci_config
    monkeypatch.setattr(app_database, "SessionLocal", TestSession)
    assert _leggi_week_start() == 5


def test_week_start_cache_viene_resettata(test_engine, TestSession, monkeypatch):
    """Dopo _reset_week_start_cache() il nuovo valore in DB viene riletto."""
    with test_engine.connect() as conn:
        conn.execute(text(
            "INSERT INTO app_config (key, value) VALUES ('week_start_weekday', '0')"
        ))
        conn.commit()

    monkeypatch.setattr(app_database, "SessionLocal", TestSession)
    _reset_week_start_cache()
    assert _leggi_week_start() == 0


# ---------------------------------------------------------------------------
# Test: endpoint GET /config/
# ---------------------------------------------------------------------------

def test_get_config_lista_vuota(client):
    """GET /config/ con tabella vuota restituisce lista vuota."""
    resp = client.get("/config/")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_config_lista_con_valori(client, test_engine):
    """GET /config/ restituisce tutte le chiavi inserite."""
    with test_engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO app_config (key, value, description) VALUES
            ('week_start_weekday', '5', 'Giorno inizio settimana'),
            ('cors_origins', 'http://localhost:5173', 'URL CORS')
        """))
        conn.commit()

    resp = client.get("/config/")
    assert resp.status_code == 200
    data = {item["key"]: item for item in resp.json()}
    assert "week_start_weekday" in data
    assert data["week_start_weekday"]["value"] == "5"
    assert "cors_origins" in data


def test_get_config_singola_chiave(client, test_engine):
    """GET /config/{key} restituisce il valore corretto."""
    with test_engine.connect() as conn:
        conn.execute(text(
            "INSERT INTO app_config (key, value, description) VALUES "
            "('anno_confronto_giorni_offset', '364', 'Offset giorni')"
        ))
        conn.commit()

    resp = client.get("/config/anno_confronto_giorni_offset")
    assert resp.status_code == 200
    body = resp.json()
    assert body["key"] == "anno_confronto_giorni_offset"
    assert body["value"] == "364"


def test_get_config_chiave_inesistente(client):
    """GET /config/{key} con chiave assente restituisce 404."""
    resp = client.get("/config/chiave_che_non_esiste")
    assert resp.status_code == 404
