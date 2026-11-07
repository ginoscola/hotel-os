"""
Export della Dashboard Gruppo (/export/gruppo): deve contare UNA snapshot per giorno.

Bug reale (trovato 07/11/2026, v4.30.6): l'export sommava le righe di tutte le snapshot
importate — per 8–14/08/2026 3,6 milioni € invece di 167.616 €, 26.068 camere disponibili
in una settimana invece di 931.
"""
import csv
import os
import sys
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app.models.revenue import DailyRevenue

from tests._db import TEST_DB_URL  # noqa: E402

GIORNI = [date(2026, 8, 8) + timedelta(days=i) for i in range(7)]  # sabato → venerdì
VECCHIA, NUOVA = date(2026, 7, 1), date(2026, 8, 1)


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture(scope="module")
def client(test_engine):
    Sess = sessionmaker(bind=test_engine)

    def override_get_db():
        db = Sess()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    utente = SimpleNamespace(id=None, ruolo="admin")
    app.dependency_overrides[richiedi_admin] = lambda: utente
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _riga(hotel, giorno, snapshot, ricavo):
    return DailyRevenue(
        hotel_code=hotel, data=giorno, snapshot_date=snapshot,
        rooms_sold=10, rooms_available=40, pax=20,
        revenue_rooms=ricavo, revenue_fnb=0.0, revenue_extra=0.0, revenue_total=ricavo,
    )


@pytest.fixture(autouse=True)
def dati(test_engine):
    """CLB: due snapshot (100 €/giorno la vecchia, 150 € la nuova). DPH: solo la vecchia (80 €)."""
    with test_engine.connect() as conn:
        conn.execute(text("TRUNCATE daily_revenue, hotel_seasons, hotels, imports RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO hotels (code, name, default_rooms) VALUES ('CLB','Club Hotel',45), ('DPH','Hotel Du Parc',43)"))
        conn.commit()
    s = sessionmaker(bind=test_engine)()
    for g in GIORNI:
        s.add(_riga("CLB", g, VECCHIA, 100.0))
        s.add(_riga("CLB", g, NUOVA, 150.0))
        s.add(_riga("DPH", g, VECCHIA, 80.0))
    s.commit()
    s.close()


def _dettaglio(resp) -> dict:
    """Dal csv: {hotel: (camere disponibili, ricavo totale)} della sezione DETTAGLIO PER HOTEL."""
    assert resp.status_code == 200, resp.text
    testo = resp.content.decode("utf-8-sig")
    sezione = testo.split("=== DETTAGLIO PER HOTEL ===")[1].strip().splitlines()
    righe = list(csv.reader(sezione))
    intest = righe[0]
    i_disp, i_tot = intest.index("Cam. Disponibili"), intest.index("Rev. Totale (€)")
    return {r[0]: (int(r[i_disp]), float(r[i_tot])) for r in righe[1:] if r and r[0] in ("CLB", "DPH")}


def test_con_snapshot_conta_solo_quella(client):
    d = _dettaglio(client.get(f"/export/gruppo?da=2026-08-08&a=2026-08-14&snapshot={NUOVA}&formato=csv"))
    assert d["CLB"] == (7 * 40, 7 * 150.0)
    assert "DPH" not in d  # DPH non ha righe in quella snapshot


def test_senza_snapshot_usa_la_piu_recente_per_giorno(client):
    d = _dettaglio(client.get("/export/gruppo?da=2026-08-08&a=2026-08-14&formato=csv"))
    assert d["CLB"] == (7 * 40, 7 * 150.0)  # non 100 + 150
    assert d["DPH"] == (7 * 40, 7 * 80.0)   # la sua unica snapshot


def test_snapshot_senza_dati_404(client):
    resp = client.get("/export/gruppo?da=2026-08-08&a=2026-08-14&snapshot=2026-01-01&formato=csv")
    assert resp.status_code == 404
