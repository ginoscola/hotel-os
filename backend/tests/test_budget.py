"""
Test per il modulo Budget: calculator, router, versioning, confronto, proiezione.

Usa lo stesso DB di test (revenue_master_test) degli altri test suite.
"""

import os
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models.revenue import BudgetConfig, BudgetEntry, DailyRevenue, Hotel  # noqa: F401
from app.services.budget_calculator import calcola_kpi_budget, calcola_mese_contabile

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
    """Svuota le tabelle rilevanti e reinserisce hotel + stagioni base prima di ogni test."""
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
        # Stagione 2026 per DPH (usata nei test di proiezione e settimane mancanti)
        conn.execute(text("""
            INSERT INTO hotel_seasons (hotel_id, season_year, open_date, close_date, total_rooms)
            SELECT id, 2026, '2026-05-01', '2026-09-19', 43
            FROM hotels WHERE code = 'DPH'
        """))
        conn.commit()


# ===========================================================================
# TEST 1-6 — budget_calculator.py
# ===========================================================================

class TestBudgetCalculator:
    def test_valori_corretti(self):
        """50% occ, ADR 100€, ADR F&B 40€, ADR Extra 10€, 100 camere disp."""
        kpi = calcola_kpi_budget(
            occupancy_pct=50.0, adr=100.0,
            adr_fnb=40.0, adr_extra=10.0,
            rooms_available=100,
        )
        # rs = round(50/100 * 100) = 50
        assert kpi.rooms_sold    == 50
        assert kpi.occupancy     == pytest.approx(50.0)
        assert kpi.revenue_rooms == pytest.approx(5000.0)
        assert kpi.revenue_fnb   == pytest.approx(50 * 40.0)
        assert kpi.revenue_extra == pytest.approx(50 * 10.0)
        assert kpi.revenue_total == pytest.approx(5000 + 2000 + 500)
        assert kpi.revpar        == pytest.approx(5000.0 / 100, rel=1e-4)

    def test_adr_fnb_zero_revenue_total_uguale_rooms(self):
        """adr_fnb = adr_extra = 0 → revenue_total = revenue_rooms."""
        kpi = calcola_kpi_budget(50.0, 100.0, 0, 0, 100)
        assert kpi.rooms_sold    == 50
        assert kpi.revenue_rooms == pytest.approx(5000.0)
        assert kpi.revenue_total == pytest.approx(5000.0)
        assert kpi.revenue_fnb   == pytest.approx(0.0)

    def test_divisioni_per_zero(self):
        """rooms_available=0 → rs=0 → revpar, trevpar, rmc = None."""
        kpi = calcola_kpi_budget(50.0, 80.0, 40.0, 10.0, 0)
        assert kpi.rooms_sold == 0
        assert kpi.revpar    is None
        assert kpi.trevpar   is None
        assert kpi.rmc       is None

    def test_occupancy_none(self):
        """occupancy_pct=None → rooms_sold=None → revenue_rooms=None."""
        kpi = calcola_kpi_budget(None, 80.0, 40.0, 10.0, 301)
        assert kpi.rooms_sold    is None
        assert kpi.revenue_rooms is None

    def test_inc_somma_a_100(self):
        """Le tre incidenze sommano a 100%."""
        kpi = calcola_kpi_budget(60.0, 100.0, 40.0, 10.0, 100)
        somma = (kpi.inc_rooms or 0) + (kpi.inc_fnb or 0) + (kpi.inc_extra or 0)
        assert somma == pytest.approx(100.0, abs=0.01)

    def test_rmc_corretto(self):
        """RMC = revenue_total / rooms_sold: 10 cam, ADR 100, F&B 0, Extra 0."""
        kpi = calcola_kpi_budget(10.0, 100.0, 0.0, 0.0, 100)
        assert kpi.rooms_sold == 10
        assert kpi.rmc == pytest.approx(1000.0 / 10)


# ===========================================================================
# TEST 7-10 — calcola_mese_contabile
# ===========================================================================

class TestMeseContabile:
    def test_aprile_maggioranza(self):
        """26/04–02/05: aprile=5 giorni → aprile."""
        mese, anno = calcola_mese_contabile(date(2026, 4, 26), date(2026, 5, 2))
        assert mese == 4

    def test_luglio_maggioranza(self):
        """28/06–04/07: luglio=4 giorni → luglio."""
        mese, anno = calcola_mese_contabile(date(2026, 6, 28), date(2026, 7, 4))
        assert mese == 7

    def test_mese_unico(self):
        """Settimana tutta in agosto → agosto."""
        mese, anno = calcola_mese_contabile(date(2026, 8, 1), date(2026, 8, 7))
        assert mese == 8

    def test_marzo_aprile(self):
        """29/03–04/04: aprile=4 → aprile."""
        mese, anno = calcola_mese_contabile(date(2026, 3, 29), date(2026, 4, 4))
        assert mese == 4


# ===========================================================================
# TEST ENDPOINT — GET lista vuota
# ===========================================================================

def test_get_budget_lista_vuota(client):
    resp = client.get("/budget/CLB/2026")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_budget_hotel_inesistente_404(client):
    resp = client.get("/budget/XXX/2026")
    assert resp.status_code == 404


# ===========================================================================
# TEST PUT — inserimento singola settimana con KPI calcolati
# ===========================================================================

def test_put_budget_calcola_kpi(client):
    """PUT con occupancy=70% → camere_vendute derivato, KPI calcolati."""
    resp = client.put("/budget/DPH/2026/2026-06-06", json={
        'version': 'v1',
        'occupancy': 70.0,
        'adr': 100.0,
        'adr_fnb': 40.0,
        'adr_extra': 10.0,
    })
    assert resp.status_code == 200, resp.text
    d = resp.json()
    assert d['occupancy']      == pytest.approx(70.0)
    assert d['camere_vendute'] is not None        # derivato da occupancy
    assert d['revenue_rooms']  is not None
    assert d['revenue_total']  > d['revenue_rooms']
    assert d['mese_contabile'] is not None


def test_put_budget_mese_contabile_luglio(client):
    """week 27/06–03/07 → mese contabile luglio (4 giorni)."""
    resp = client.put("/budget/DPH/2026/2026-06-27", json={
        'occupancy': 50.0, 'adr': 70.0,
    })
    d = resp.json()
    assert d['mese_contabile'] == 7
    assert d['anno_contabile'] == 2026


def test_put_budget_upsert_non_duplica(client):
    """PUT ripetuto → aggiorna il valore, non crea duplicato."""
    client.put("/budget/DPH/2026/2026-06-06", json={'occupancy': 50.0, 'adr': 60.0})
    client.put("/budget/DPH/2026/2026-06-06", json={'occupancy': 80.0, 'adr': 85.0})
    resp = client.get("/budget/DPH/2026?version=v1")
    data = resp.json()
    assert len(data) == 1
    assert data[0]['occupancy'] == pytest.approx(80.0)


# ===========================================================================
# TEST VERSIONING
# ===========================================================================

def test_versioni_indipendenti(client):
    """v2 non sovrascrive v1."""
    client.put("/budget/DPH/2026/2026-06-06", json={'version': 'v1', 'occupancy': 70.0, 'adr': 80.0})
    client.post("/budget/DPH/2026/version", json={'source_version': 'v1', 'new_version': 'v2'})
    client.put("/budget/DPH/2026/2026-06-06", json={'version': 'v2', 'occupancy': 90.0, 'adr': 200.0})
    v1 = client.get("/budget/DPH/2026/2026-06-06?version=v1").json()
    v2 = client.get("/budget/DPH/2026/2026-06-06?version=v2").json()
    assert v1['occupancy'] == pytest.approx(70.0)
    assert v2['occupancy'] == pytest.approx(90.0)


def test_lista_versioni(client):
    client.put("/budget/DPH/2026/2026-06-06", json={'version': 'v1', 'occupancy': 70.0, 'adr': 80.0})
    client.post("/budget/DPH/2026/version", json={'source_version': 'v1', 'new_version': 'v2'})
    resp = client.get("/budget/DPH/2026/versions")
    assert set(resp.json()['versions']) == {'v1', 'v2'}


# ===========================================================================
# TEST CONFRONTO actual vs budget
# ===========================================================================

def test_confronto_senza_actual(client):
    """Senza daily_revenue → dati_disponibili=False."""
    client.put("/budget/DPH/2026/2026-06-06", json={'occupancy': 70.0, 'adr': 80.0, 'adr_fnb': 40.0})
    resp = client.get("/budget/DPH/2026/confronto?version=v1")
    sett = resp.json()['settimane']
    assert sett[0]['dati_disponibili'] is False
    assert sett[0]['budget']['revenue_rooms'] is not None


def test_confronto_con_actual(client, test_engine):
    """Con daily_revenue → scostamento calcolato."""
    client.put("/budget/DPH/2026/2026-06-06", json={'occupancy': 70.0, 'adr': 80.0, 'adr_fnb': 40.0})
    with test_engine.connect() as conn:
        dph_id = conn.execute(text("SELECT id FROM hotels WHERE code='DPH'")).scalar()
        for i in range(7):
            giorno = date(2026, 6, 6) + timedelta(days=i)
            conn.execute(text("""
                INSERT INTO daily_revenue
                  (hotel_code, hotel_id, data, rooms_sold, rooms_available, pax,
                   revenue_rooms, revenue_fnb, revenue_extra, revenue_total, snapshot_date)
                VALUES ('DPH', :hid, :data, 5, 43, 10, 400, 200, 50, 650, '2026-06-01')
            """), {'hid': dph_id, 'data': giorno})
        conn.commit()
    resp = client.get("/budget/DPH/2026/confronto?version=v1")
    sett = resp.json()['settimane']
    assert sett[0]['dati_disponibili'] is True
    assert sett[0]['actual']['revenue_total'] == pytest.approx(650 * 7, rel=1e-3)


# ===========================================================================
# TEST PROIEZIONE
# ===========================================================================

def test_proiezione_mix_actual_budget(client, test_engine):
    """Sett. 1 con actual, sett. 2 senza → proiezione usa actual + budget."""
    client.put("/budget/DPH/2026/2026-06-06", json={'occupancy': 70.0, 'adr': 80.0})
    client.put("/budget/DPH/2026/2026-06-13", json={'occupancy': 60.0, 'adr': 70.0})
    # Leggi il budget_revenue_rooms della sett2 per il confronto
    sett2_bud = client.get("/budget/DPH/2026/2026-06-13?version=v1").json()
    sett2_rev_rooms = sett2_bud['revenue_rooms']

    with test_engine.connect() as conn:
        dph_id = conn.execute(text("SELECT id FROM hotels WHERE code='DPH'")).scalar()
        for i in range(7):
            giorno = date(2026, 6, 6) + timedelta(days=i)
            conn.execute(text("""
                INSERT INTO daily_revenue
                  (hotel_code, hotel_id, data, rooms_sold, rooms_available, pax,
                   revenue_rooms, revenue_fnb, revenue_extra, revenue_total, snapshot_date)
                VALUES ('DPH', :hid, :data, 5, 43, 10, 400, 0, 0, 400, '2026-06-01')
            """), {'hid': dph_id, 'data': giorno})
        conn.commit()
    resp = client.get("/budget/DPH/2026/proiezione?version=v1")
    d = resp.json()
    assert d['settimane_completate'] == 1
    assert d['settimane_totali']     == 2
    assert d['pct_stagione_completata'] == pytest.approx(50.0)
    # proiezione = actual sett1 (400*7) + budget sett2
    assert d['stagione_proiezione']['revenue_rooms'] == pytest.approx(400 * 7 + sett2_rev_rooms, rel=1e-3)


# ===========================================================================
# TEST AGGREGAZIONE MENSILE
# ===========================================================================

def test_confronto_mensile_raggruppa_per_mese(client):
    """Confronto mensile aggrega le settimane per mese_contabile."""
    # Apr: 1 sett, Mag: 2 sett
    client.put("/budget/DPH/2026/2026-04-25", json={'occupancy': 50.0, 'adr': 60.0})
    client.put("/budget/DPH/2026/2026-05-02", json={'occupancy': 55.0, 'adr': 70.0})
    client.put("/budget/DPH/2026/2026-05-09", json={'occupancy': 60.0, 'adr': 80.0})
    resp = client.get("/budget/DPH/2026/confronto/mensile?version=v1")
    assert resp.status_code == 200
    mesi = resp.json()['mesi']
    assert len({m['mese_contabile'] for m in mesi}) >= 2


# ===========================================================================
# TEST SETTIMANE MANCANTI
# ===========================================================================

def test_settimane_mancanti(client):
    """settimane-mancanti elenca le settimane della stagione senza budget."""
    client.put("/budget/DPH/2026/2026-06-06", json={'occupancy': 70.0, 'adr': 80.0})
    resp = client.get("/budget/DPH/2026/settimane-mancanti?version=v1")
    assert resp.status_code == 200
    d = resp.json()
    # n_mancanti = totale - 1 (quella inserita)
    assert d['n_mancanti'] == d['n_settimane_totali'] - 1


# ===========================================================================
# TEST BULK
# ===========================================================================

def test_bulk_salva_multiple_settimane(client):
    """POST /bulk inserisce più settimane con KPI calcolati."""
    payload = [
        {'week_start': '2026-06-06', 'occupancy': 70.0, 'adr': 80.0, 'adr_fnb': 40.0},
        {'week_start': '2026-06-13', 'occupancy': 60.0, 'adr': 75.0, 'adr_fnb': 35.0},
        {'week_start': '2026-06-20', 'occupancy': 65.0, 'adr': 78.0},
    ]
    resp = client.post("/budget/DPH/2026/bulk", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert all(d['revenue_rooms'] is not None for d in data)
    # Ordinate per week_start
    wss = [d['week_start'] for d in data]
    assert wss == sorted(wss)


# ===========================================================================
# TEST FK hotel_id in daily_revenue (mantenuti dalla versione precedente)
# ===========================================================================

def test_hotel_id_viene_popolato_su_insert(test_engine):
    with test_engine.connect() as conn:
        clb_id = conn.execute(text("SELECT id FROM hotels WHERE code = 'CLB'")).scalar()
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
    assert ("foreign key" in str(exc_info.value).lower()
            or "violates" in str(exc_info.value).lower()
            or "IntegrityError" in type(exc_info.value).__name__)
