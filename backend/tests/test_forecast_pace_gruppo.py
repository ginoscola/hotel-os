"""
Test per GET /forecast/pace-gruppo:
- Restituisce una serie di punti per ogni hotel in anagrafica
- Ogni punto corrisponde a uno snapshot_date con la somma OTB del mese target
- _hotels_per_codice("all", ...) non deve più fallire (Hotel non ha il campo attivo)
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import hash_password, crea_token_accesso
from app.database import Base, get_db
from app.main import app
from app.models.revenue import User, Hotel, DailyRevenue  # noqa: F401

TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"
HOTEL_CODE = "PACEGRP"


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="module")
def TestSession(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture(scope="module")
def client(test_engine, TestSession):
    def override_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def setup_db(TestSession):
    db = TestSession()
    try:
        if not db.query(User).filter(User.username == 'test_admin_pacegrp').first():
            db.add(User(username='test_admin_pacegrp', password_hash=hash_password('test123'), ruolo='admin', attivo=True))
        if not db.query(Hotel).filter(Hotel.code == HOTEL_CODE).first():
            db.add(Hotel(code=HOTEL_CODE, name='Test Pace Gruppo', default_rooms=10))
        db.commit()

        db.query(DailyRevenue).filter(DailyRevenue.hotel_code == HOTEL_CODE).delete()
        for snap, rev in [('2026-05-01', 1000.0), ('2026-05-08', 1500.0)]:
            db.add(DailyRevenue(
                hotel_code=HOTEL_CODE, data='2026-05-15',
                rooms_sold=5, rooms_available=10, pax=8,
                revenue_rooms=rev, revenue_fnb=0, revenue_extra=0, revenue_total=rev,
                snapshot_date=snap, is_test=False,
            ))
        db.commit()
    finally:
        db.close()


def _headers():
    return {"Authorization": f"Bearer {crea_token_accesso('test_admin_pacegrp', 'admin')}"}


class TestPaceGruppo:
    def test_include_ogni_hotel(self, client, setup_db):
        resp = client.get("/forecast/pace-gruppo?anno=2026&mese=5", headers=_headers())
        assert resp.status_code == 200
        dati = resp.json()
        codici = [s['hotel_code'] for s in dati['strutture']]
        assert HOTEL_CODE in codici

    def test_punti_per_snapshot(self, client, setup_db):
        resp = client.get("/forecast/pace-gruppo?anno=2026&mese=5", headers=_headers())
        struttura = next(s for s in resp.json()['strutture'] if s['hotel_code'] == HOTEL_CODE)
        assert len(struttura['punti']) == 2
        assert struttura['punti'][0]['snapshot_date'] == '2026-05-01'
        assert struttura['punti'][0]['otb_revenue'] == 1000.0
        assert struttura['punti'][1]['otb_revenue'] == 1500.0

    def test_mese_senza_dati_restituisce_lista_vuota(self, client, setup_db):
        resp = client.get("/forecast/pace-gruppo?anno=2020&mese=1", headers=_headers())
        assert resp.status_code == 200
        struttura = next(s for s in resp.json()['strutture'] if s['hotel_code'] == HOTEL_CODE)
        assert struttura['punti'] == []
