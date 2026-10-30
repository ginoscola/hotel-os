"""Test del budget ristoranti: consuntivo da corrispettivi manuali, confronto, precompilazione, gruppo."""

from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app.models.corrispettivi import CorrispettiviManuale
from app.models.revenue import BudgetRistorante, Hotel, HotelSeason
from app.services.budget_ristoranti import riepilogo
from tests._db import TEST_DB_URL

# 2026: 06/06 è sabato. 2027: 05/06 è il sabato corrispondente (−364 giorni).
WS_1 = date(2026, 6, 6)
WS_2 = date(2026, 6, 13)


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
    utente = SimpleNamespace(id=None)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente
    app.dependency_overrides[richiedi_admin] = lambda: utente
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def dati(engine, Sessione):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE budget_ristoranti, corrispettivi_manuali, hotel_seasons, hotels "
                          "RESTART IDENTITY CASCADE"))
    db = Sessione()
    hotel = Hotel(code='DPH', name='Hotel Du Parc', default_rooms=43)
    db.add(hotel)
    db.flush()
    db.add(HotelSeason(hotel_id=hotel.id, season_year=2026, open_date=date(2026, 5, 1),
                       close_date=date(2026, 9, 19), total_rooms=43))
    for giorno, codice, importo, is_test in [
        (date(2026, 6, 6), 'MMS', 1000, False),
        (date(2026, 6, 12), 'MMS', 500, False),  # stessa settimana (ven)
        (date(2026, 6, 13), 'MMS', 200, False),  # settimana dopo
        (date(2026, 6, 7), 'BON', 300, False),
        (date(2026, 6, 8), 'BON', 9999, True),   # test: mai nei conti
    ]:
        db.add(CorrispettiviManuale(data_giorno=giorno, struttura_code=codice,
                                    arrangiamenti_lordo=importo, is_test=is_test))
    db.commit()
    db.close()


def _put(client, ws, codice, importo, anno=2026, version='v1'):
    return client.put(f"/budget-ristoranti/{anno}/{ws}", json={
        'struttura_code': codice, 'version': version, 'importo': importo})


def _settimana(dati, ws):
    return next(s for s in dati['settimane'] if s['week_start'] == ws.isoformat())


def test_griglia_copre_la_stagione_e_somma_il_consuntivo_per_settimana(client):
    d = client.get("/budget-ristoranti/2026").json()
    assert d['settimane'][0]['week_start'] == '2026-04-25'
    assert d['settimane'][-1]['week_start'] == '2026-09-19'
    assert _settimana(d, WS_1)['MMS']['consuntivo'] == 1500
    assert _settimana(d, WS_2)['MMS']['consuntivo'] == 200
    assert _settimana(d, WS_1)['BON']['consuntivo'] == 300  # esclusa la riga di test
    assert d['totali']['totale']['consuntivo'] == 2000


def test_scostamento_solo_su_settimane_chiuse_con_budget_e_consuntivo(client):
    assert _put(client, WS_1, 'MMS', 1200).status_code == 200
    assert _put(client, WS_2, 'MMS', 800).status_code == 200
    assert _put(client, date(2026, 6, 20), 'MMS', 700).status_code == 200  # nessun consuntivo
    d = client.get("/budget-ristoranti/2026").json()
    t = d['totali']['MMS']
    assert t['budget'] == 2700
    assert t['budget_confrontabile'] == 2000
    assert t['scostamento'] == 1700 - 2000
    assert t['scostamento_pct'] == pytest.approx(-0.15)
    # La settimana chiusa senza dati resta a budget nella proiezione
    assert t['proiezione'] == 1700 + 700


def test_settimana_in_corso_e_futura_restano_a_budget(Sessione, client):
    _put(client, WS_1, 'MMS', 1200)
    db = Sessione()
    d = riepilogo(2026, 'v1', db, oggi=date(2026, 6, 8))
    db.close()
    s = _settimana(d, WS_1)
    assert s['stato'] == 'in_corso'
    assert s['MMS']['scostamento'] is None
    assert s['MMS']['proiezione'] == 1200
    assert d['totali']['MMS']['scostamento'] is None
    assert _settimana(d, date(2026, 6, 20))['stato'] == 'futura'


def test_mesi_contabili_e_versioni_separate(client):
    _put(client, date(2026, 5, 30), 'BON', 100)  # 2 giorni a maggio, 5 a giugno → giugno
    _put(client, WS_1, 'BON', 400, version='v2')
    v1 = client.get("/budget-ristoranti/2026").json()
    giugno = next(m for m in v1['mesi'] if m['mese'] == 6)
    assert giugno['BON']['budget'] == 100
    v2 = client.get("/budget-ristoranti/2026?version=v2").json()
    assert v2['totali']['BON']['budget'] == 400


def test_importo_nullo_cancella_e_validazioni(client):
    _put(client, WS_1, 'MMS', 1200)
    assert _put(client, WS_1, 'MMS', None).json()['cancellata'] is True
    assert client.get("/budget-ristoranti/2026").json()['totali']['MMS']['budget'] == 0
    assert _put(client, WS_1, 'DPH', 10).status_code == 400
    assert _put(client, WS_1, 'MMS', -1).status_code == 400
    assert _put(client, date(2026, 6, 8), 'MMS', 10).status_code == 400  # lunedì


def test_precompila_da_anno_precedente(client, Sessione):
    r = _put(client, date(2027, 6, 5), 'BON', 77, anno=2027)
    assert r.status_code == 200
    d = client.post("/budget-ristoranti/2027/precompila").json()
    assert d['n_compilate'] == 2  # MMS due settimane; BON già compilata
    assert d['n_saltate'] == 1
    db = Sessione()
    righe = {(r.struttura_code, r.week_start): r for r in db.query(BudgetRistorante).filter_by(season_year=2027)}
    assert float(righe[('MMS', date(2027, 6, 5))].importo) == 1500
    assert float(righe[('BON', date(2027, 6, 5))].importo) == 77
    assert '06/06/2026' in righe[('MMS', date(2027, 6, 5))].note
    db.close()
    d = client.post("/budget-ristoranti/2027/precompila?sovrascrivi=true").json()
    assert d['n_compilate'] == 3


@pytest.mark.parametrize('formato', ['xlsx', 'csv', 'pdf'])
def test_export(client, formato):
    _put(client, WS_1, 'MMS', 1200)
    r = client.get(f"/budget-ristoranti/2026/export?formato={formato}")
    assert r.status_code == 200
    assert 'Budget_ristoranti_2026_v1' in r.headers['content-disposition']


def test_gruppo_aggiunge_ristoranti_senza_toccare_gli_hotel(client):
    _put(client, WS_1, 'MMS', 1200)
    d = client.get("/budget/gruppo/2026/confronto").json()
    assert [r['struttura_code'] for r in d['ristoranti']] == ['MMS', 'BON']
    assert d['ristoranti'][0]['budget'] == 1200
    assert all(h['hotel_code'] not in ('MMS', 'BON') for h in d['hotel'])


def test_fonte_trend_e_avanzamento(client, Sessione):
    _put(client, WS_1, 'MMS', 1000)   # consuntivo 1500: chiusa
    _put(client, date(2026, 6, 20), 'MMS', 1000)   # in corso
    _put(client, date(2026, 6, 27), 'MMS', 1000)   # futura
    db = Sessione()
    d = riepilogo(2026, 'v1', db, oggi=date(2026, 6, 22))
    db.close()
    assert _settimana(d, WS_1)['MMS']['fonte'] == 'consuntivo'
    assert _settimana(d, date(2026, 6, 20))['MMS']['fonte'] == 'in_corso'
    assert _settimana(d, date(2026, 6, 27))['MMS']['fonte'] == 'budget'
    t = d['totali']['MMS']
    # + settimana 13/06 con solo consuntivo (200)
    assert (t['settimane_chiuse'], t['settimane_totali']) == (2, 4)
    assert t['proiezione'] == 1500 + 200 + 1000 + 1000
    assert t['trend'] == 'sopra_budget'   # 3700 vs 3000
    assert d['totali']['BON']['trend'] is None   # nessun budget


def test_gruppo_scostamento_senza_settimane_confrontabili(client):
    # BON: solo consuntivo (300). MMS: budget su settimana senza consuntivo → actual − budget
    _put(client, date(2026, 7, 4), 'MMS', 2000)
    r = {x['struttura_code']: x for x in client.get("/budget/gruppo/2026/confronto").json()['ristoranti']}
    assert r['BON']['scostamento'] == 300
    assert r['BON']['scostamento_pct'] is None
    assert r['MMS']['scostamento'] == 1700 - 2000
    assert r['MMS']['scostamento_pct'] == pytest.approx(-0.15)
    assert r['MMS']['budget_confrontabile'] == 2000
