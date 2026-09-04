"""Test per la Home / Cruscotto gruppo (routers/home.py).

Stesso DB di test isolato (revenue_master_test) e stesso pattern di auth degli altri suite
recenti (es. test_produzione_ricavi_camere.py): override diretto di richiedi_utente_attivo/
richiedi_admin, non solo get_db (altrimenti gli endpoint protetti rispondono 401 e mascherano
bug reali — vedi nota CLAUDE.md sul modulo Budget).

Non riesegue la migrazione home001_2026 (Base.metadata.create_all crea la tabella dalla
definizione del modello, senza il seed): le soglie di test sono inserite qui esplicitamente,
un sottoinsieme minimo di quelle reali.
"""
import os
import sys
from datetime import date
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app.models.home import DashboardKpiSoglia  # noqa: F401
from app.models.produzione import ProdCategoria, ProdImport, ProdRiga  # noqa: F401
from app.models.rooms import Room  # noqa: F401

TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"


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

    utente_finto = SimpleNamespace(id=None, ruolo="admin")
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente_finto
    app.dependency_overrides[richiedi_admin] = lambda: utente_finto
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def seed(test_engine, TestSession):
    with test_engine.connect() as conn:
        conn.execute(text(
            "TRUNCATE daily_revenue, budget_entries, hotel_seasons, hotels, "
            "dashboard_kpi_soglie, employee_monthly, employee_cost_center_monthly, "
            "payroll_imports, cost_centers, employees "
            "RESTART IDENTITY CASCADE"
        ))
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('DPH', 'Hotel Du Parc', 4), ('CLB', 'Club Hotel', 4), ('INT', 'Hotel International', 4)
        """))
        # Stagione 2020 (già chiusa da anni): rende deterministico 'mesi chiusi' nel test admin,
        # a prescindere da quando gira la suite.
        conn.execute(text("""
            INSERT INTO hotel_seasons (hotel_id, season_year, open_date, close_date, total_rooms)
            SELECT id, 2020, '2020-05-01', '2020-06-30', 4 FROM hotels
        """))
        # Due snapshot per testare pickup + occupancy: 60% poi 80% di occupazione.
        conn.execute(text("""
            INSERT INTO daily_revenue
                (hotel_code, data, rooms_sold, rooms_available, pax,
                 revenue_rooms, revenue_fnb, revenue_extra, revenue_total, snapshot_date, is_test)
            VALUES
                ('DPH', '2020-05-10', 2, 4, 4, 200, 50, 10, 260, '2020-05-01', false),
                ('DPH', '2020-05-10', 3, 4, 6, 300, 75, 15, 390, '2020-05-08', false)
        """))
        # Soglie minime necessarie ai gauge esercitati dal test.
        conn.execute(text("""
            INSERT INTO dashboard_kpi_soglie
                (kpi_code, hotel_code, direzione, unita, target, soglia_rossa, soglia_arancione, ordine)
            VALUES
                ('occupancy', NULL, 'alto_meglio', 'perc', NULL, 55, 70, 10),
                ('pickup_7gg', NULL, 'alto_meglio', 'euro', NULL, 0, 1000, 50),
                ('labor_cost_ratio', NULL, 'basso_meglio', 'perc', NULL, 38, 30, 70)
        """))
        # Centro di costo struttura DPH + un dipendente per il blocco costo del lavoro (admin).
        conn.execute(text("""
            INSERT INTO cost_centers (code, name, tipo, hotel_id, attivo, ordine)
            SELECT 'DPH', 'Hotel Du Parc', 'struttura', id, true, 0 FROM hotels WHERE code = 'DPH'
        """))
        conn.execute(text("""
            INSERT INTO employees (codice_fiscale, cognome, nome, attivo)
            VALUES ('ZZTEST00NA01A000A', 'Test', 'Mario', true)
        """))
        conn.execute(text("""
            INSERT INTO payroll_imports (nome_file, mese, anno, societa, stato, is_test)
            VALUES ('test.pdf', 5, 2020, 'TEST SRL', 'importato', false)
        """))
        conn.execute(text("""
            INSERT INTO employee_monthly
                (import_id, employee_id, cost_center_id, percentuale_cc, costo_aziendale, override_manuale)
            SELECT pi.id, e.id, cc.id, 100, 1000.00, false
            FROM payroll_imports pi, employees e, cost_centers cc
            WHERE pi.mese = 5 AND pi.anno = 2020 AND e.codice_fiscale = 'ZZTEST00NA01A000A' AND cc.code = 'DPH'
        """))
        conn.execute(text("""
            INSERT INTO employee_cost_center_monthly
                (employee_id, import_id, cost_center_id, percentuale, override_manuale)
            SELECT e.id, pi.id, cc.id, 100, false
            FROM employees e, payroll_imports pi, cost_centers cc
            WHERE e.codice_fiscale = 'ZZTEST00NA01A000A' AND pi.mese = 5 AND pi.anno = 2020 AND cc.code = 'DPH'
        """))
        conn.commit()


def test_cruscotto_gruppo_200(client):
    r = client.get("/home/cruscotto", params={"anno": 2020, "hotel_code": "GRUPPO"})
    assert r.status_code == 200
    d = r.json()
    assert d["stagione"]["open_date"] == "2020-05-01"
    # kpi_operativi riflette solo l'ULTIMO snapshot (2020-05-08): 3 vendute su 4, non la
    # somma con lo snapshot precedente (stessa data, snapshot diversi = stessa prenotazione
    # vista in momenti diversi, non due giorni distinti).
    assert d["kpi_operativi"]["rooms_sold"] == 3
    # Ultimo snapshot (2020-05-08): 3 vendute su 4 disponibili = 75% → sopra la soglia
    # arancione (70) → zona verde
    assert d["kpi_operativi"]["occupancy"]["zona"] == "verde"
    # Pickup 7gg: 390 - 260 = 130 → sopra la soglia rossa (0) ma sotto l'arancione (1000) → arancio
    assert d["pickup_7gg"]["valore"] == 130.0
    assert d["pickup_7gg"]["zona"] == "arancio"
    assert d["semaforo_hotel"] and len(d["semaforo_hotel"]) == 3


def test_cruscotto_hotel_singolo(client):
    r = client.get("/home/cruscotto", params={"anno": 2020, "hotel_code": "DPH"})
    assert r.status_code == 200
    assert r.json()["hotel_code"] == "DPH"


def test_cruscotto_hotel_code_invalido(client):
    r = client.get("/home/cruscotto", params={"hotel_code": "XXX"})
    assert r.status_code == 400


def test_cruscotto_admin_costo_lavoro(client):
    r = client.get("/home/cruscotto/admin", params={"anno": 2020, "hotel_code": "GRUPPO"})
    assert r.status_code == 200
    d = r.json()
    assert d["costo_lavoro"]["mesi_coperti"] == [5]
    per_dph = next(s for s in d["costo_lavoro"]["per_struttura"] if s["struttura_code"] == "DPH")
    assert per_dph["costo_aziendale"] == 1000.0
    assert d["margine_contribuzione"] is not None


def test_cruscotto_admin_richiede_ruolo_admin(client, test_engine, TestSession):
    """Un utente non-admin deve ricevere 403 su /home/cruscotto/admin — override separato
    (non il fixture `client`, che finge sempre un admin) per non mascherare la dipendenza reale.
    Ripristina gli override del fixture `client` alla fine (non un `.clear()` secco), altrimenti
    i test successivi che riusano `client` restano senza auth (401)."""
    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    def nega_admin():
        raise HTTPException(status_code=403, detail="Riservato agli amministratori")

    originali = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: SimpleNamespace(id=None, ruolo="viewer")
    app.dependency_overrides[richiedi_admin] = nega_admin
    try:
        with TestClient(app) as c:
            r = c.get("/home/cruscotto/admin")
            assert r.status_code == 403
            # Il cruscotto pubblico resta accessibile allo stesso utente viewer.
            r2 = c.get("/home/cruscotto")
            assert r2.status_code == 200
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(originali)


def test_soglie_get_e_put(client):
    r = client.get("/home/soglie")
    assert r.status_code == 200
    soglie = r.json()
    assert any(s["kpi_code"] == "occupancy" for s in soglie)
    occ_id = next(s["id"] for s in soglie if s["kpi_code"] == "occupancy")

    r2 = client.put(f"/home/soglie/{occ_id}", json={"soglia_rossa": 50, "soglia_arancione": 65})
    assert r2.status_code == 200
    assert r2.json()["soglia_rossa"] == 50.0

    r3 = client.put("/home/soglie/999999", json={"soglia_rossa": 1, "soglia_arancione": 2})
    assert r3.status_code == 404
