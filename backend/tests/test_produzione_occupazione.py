"""Test tab "Occupazione e Consumo" (Statistiche Produzione): voci automatiche, valori manuali,
correzione e ripristino del valore automatico."""
import os
import sys
from datetime import date
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app import models as _models  # noqa: F401  registra tutte le relationship

from tests._db import TEST_DB_URL  # noqa: E402


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def client(test_engine):
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


@pytest.fixture(autouse=True)
def dati(test_engine):
    with test_engine.connect() as conn:
        conn.execute(text(
            "TRUNCATE prod_occupazione_consumi, prenotazioni_cancellate, prenotazioni_cancellate_imports, "
            "daily_revenue, hotel_seasons, hotels RESTART IDENTITY CASCADE"
        ))
        conn.execute(text("INSERT INTO hotels (code, name, default_rooms) VALUES ('DPH', 'Hotel Du Parc', 43)"))
        conn.execute(text("""
            INSERT INTO hotel_seasons (hotel_id, season_year, open_date, close_date, total_rooms)
            SELECT id, 2026, '2026-05-01', '2026-09-19', 43 FROM hotels WHERE code = 'DPH'
        """))
        # Due snapshot per lo stesso giorno: conta solo il più recente
        conn.execute(text("""
            INSERT INTO daily_revenue (hotel_code, data, rooms_sold, rooms_available, pax, revenue_rooms,
                revenue_fnb, revenue_extra, revenue_total, snapshot_date, is_test) VALUES
            ('DPH', '2026-05-10', 5, 43, 9, 0, 0, 0, 0, '2026-05-01', false),
            ('DPH', '2026-05-10', 10, 43, 20, 0, 0, 0, 0, '2026-05-09', false),
            ('DPH', '2026-05-11', 12, 43, 22, 0, 0, 0, 0, '2026-05-09', false)
        """))
        conn.execute(text("""
            INSERT INTO prenotazioni_cancellate_imports (nome_file, anno, tipo, n_righe_totali, n_righe_valide, n_righe_fuori_mese, is_test)
            VALUES ('nd.xlsx', 2026, 'non_disdetta', 3, 3, 0, false)
        """))
        # 2 camere arrivate a maggio (non disdette) + 1 cancellata (esclusa)
        conn.execute(text("""
            INSERT INTO prenotazioni_cancellate (import_id, hotel_code, data_rilevata, canale, canale_vendita,
                codice_ota, data_prenotazione, arrivo, partenza, notti, pax, cliente, tipo_camera, importo,
                modificato_manualmente, cancellata, is_test) VALUES
            (1, 'DPH', '2026-05-01', 'Diretto', '', '', '2026-03-01', '2026-05-10', '2026-05-12', 2, 2, 'A', 'D', 100, false, false, false),
            (1, 'DPH', '2026-05-01', 'Diretto', '', '', '2026-03-01', '2026-05-11', '2026-05-12', 1, 3, 'B', 'D', 100, false, false, false),
            (1, 'DPH', '2026-05-01', 'Diretto', '', '', '2026-03-01', '2026-05-11', '2026-05-12', 1, 4, 'C', 'D', 100, false, true, false)
        """))
        conn.commit()


def _voce(risposta, code):
    return next(v for v in risposta['voci'] if v['voce_code'] == code)


def _mese(voce, m):
    return voce['mesi'][m - 1]


def test_voci_automatiche_dph(client):
    r = client.get("/produzione/occupazione-consumi", params={'struttura': 'DPH', 'anno': 2026})
    assert r.status_code == 200
    d = r.json()
    # Du Parc + Maremosso come struttura unica: reparto ristorante = Mare Mosso
    assert _voce(d, 'ristorante_presenze')['reparto'] == 'Ristorante Mare Mosso'
    # Camere vendibili = 43 camere × giorni di apertura
    vend = _voce(d, 'camere_vendibili')
    assert _mese(vend, 5)['valore'] == 43 * 31
    assert _mese(vend, 9)['valore'] == 43 * 19
    assert _mese(vend, 10)['valore'] == 0
    # Revenue: snapshot più recente per data
    assert _mese(_voce(d, 'camere_occupate'), 5)['valore'] == 22
    assert _mese(_voce(d, 'camere_presenze'), 5)['valore'] == 42
    # Arrivi: solo prenotazioni non disdette
    assert _mese(_voce(d, 'camere_arrivi'), 5)['valore'] == 2
    assert _mese(_voce(d, 'camere_arrivi_clienti'), 5)['valore'] == 5
    assert _mese(_voce(d, 'camere_arrivi'), 6)['valore'] is None
    assert _voce(d, 'utenze_kwh')['tipo'] == 'manuale'


def test_manuale_e_correzione_auto(client):
    base = {'struttura_code': 'DPH', 'anno': 2026, 'mese': 5}
    assert client.put("/produzione/occupazione-consumi", json={**base, 'voce_code': 'utenze_kwh', 'valore': 1234.5}).status_code == 200
    assert client.put("/produzione/occupazione-consumi", json={**base, 'voce_code': 'camere_vendibili', 'valore': 1364}).status_code == 200

    d = client.get("/produzione/occupazione-consumi", params={'struttura': 'DPH', 'anno': 2026}).json()
    assert _mese(_voce(d, 'utenze_kwh'), 5)['valore'] == 1234.5
    vend = _mese(_voce(d, 'camere_vendibili'), 5)
    assert vend == {'mese': 5, 'automatico': 1333, 'manuale': 1364, 'valore': 1364}

    # null = ripristina il valore automatico
    client.put("/produzione/occupazione-consumi", json={**base, 'voce_code': 'camere_vendibili', 'valore': None})
    d = client.get("/produzione/occupazione-consumi", params={'struttura': 'DPH', 'anno': 2026}).json()
    assert _mese(_voce(d, 'camere_vendibili'), 5)['valore'] == 1333


def test_bon_solo_manuale(client):
    d = client.get("/produzione/occupazione-consumi", params={'struttura': 'BON', 'anno': 2026}).json()
    assert {v['voce_code'] for v in d['voci']} == {'ristorante_presenze', 'utenze_kwh', 'utenze_acqua_m3', 'utenze_gas_smc'}
    assert all(v['tipo'] == 'manuale' for v in d['voci'])


def test_validazioni(client):
    assert client.get("/produzione/occupazione-consumi", params={'struttura': 'MMS', 'anno': 2026}).status_code == 400
    base = {'struttura_code': 'BON', 'anno': 2026, 'mese': 5}
    assert client.put("/produzione/occupazione-consumi", json={**base, 'voce_code': 'camere_vendibili', 'valore': 1}).status_code == 400
    assert client.put("/produzione/occupazione-consumi", json={**base, 'voce_code': 'utenze_kwh', 'valore': -1}).status_code == 400
    assert client.put("/produzione/occupazione-consumi", json={**base, 'mese': 13, 'voce_code': 'utenze_kwh', 'valore': 1}).status_code == 400
