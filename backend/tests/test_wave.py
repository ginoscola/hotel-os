"""Test dell'indice WAVE, Fase 1: calcoli puri, lettura del foglio Storico, import, riferimento dal DB."""

import io
from datetime import date
from types import SimpleNamespace

import openpyxl
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import Base, get_db
from app.main import app
from app.models.corrispettivi import CorrispettiviManuale
from app.models.revenue import Hotel, HotelSeason
from app.services.wave import (riferimenti, riferimento_settimana, riferimento_stagione, valori_per_periodo,
                               wave)
from app.services.wave_dati import riferimento_anno
from app.services.wave_import import ErroreImportWave, parse_storico
from tests._db import TEST_DB_URL

INTESTAZIONE = ['Struttura', 'Anno', 'Mese', 'Lordo totale (€, IVA e tassa incluse)',
                'Arrangiamenti lordi (€, senza tassa)', 'Tassa di soggiorno (€)', 'Quota tassa stimata',
                'Netto (€, IVA esclusa, senza tassa)', 'Metodo', 'Fonte', 'Note']


def _xlsx(righe, foglio='Storico'):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = foglio
    ws.append(INTESTAZIONE)
    for r in righe:
        struttura, anno, mese, netto = r[:4]
        ws.append([struttura, anno, mese, None, None, None, None, netto, 'metodo', 'fonte', None])
    ws.append(['Legenda: numeri in blu …'])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── Calcoli puri ──────────────────────────────────────────────────────────────

def test_valori_per_periodo_unisce_aprile_maggio_e_ignora_altri_mesi():
    out = valori_per_periodo({3: 50, 4: 100, 5: 200, 6: 300, 10: 999})
    assert out == {'inizio': 300, 'giugno': 300}


def test_riferimento_solo_anni_precedenti():
    valori = {2023: {'agosto': 100.0}, 2024: {'agosto': 150.0}, 2025: {'agosto': 120.0}}
    assert riferimenti(valori, 2025)['agosto'] == {'riferimento': 150.0, 'anno_record': 2024}
    assert riferimenti(valori, 2024)['agosto'] == {'riferimento': 100.0, 'anno_record': 2023}
    assert riferimenti(valori, 2023)['agosto'] == {'riferimento': None, 'anno_record': None}


def test_riferimento_a_parita_vale_anno_piu_vecchio():
    assert riferimenti({2023: {'luglio': 10.0}, 2024: {'luglio': 10.0}}, 2026)['luglio']['anno_record'] == 2023


def test_stagione_somma_dei_migliori_di_anni_diversi():
    valori = {2023: {'luglio': 100.0, 'agosto': 50.0}, 2024: {'luglio': 80.0, 'agosto': 90.0}}
    assert riferimento_stagione(riferimenti(valori, 2026)) == 190.0
    assert riferimento_stagione(riferimenti(valori, 2023)) is None


def test_riferimento_settimana_quota_per_giorni():
    rif = {'luglio': {'riferimento': 310.0}, 'agosto': {'riferimento': 620.0}, 'giugno': {'riferimento': 300.0}}
    assert riferimento_settimana(rif, date(2026, 7, 4)) == pytest.approx(70.0)        # 7 giorni di luglio
    # 25/7–31/7 tutti luglio; 1/8–7/8 tutti agosto; 28/7–3/8: 4 di luglio + 3 di agosto
    assert riferimento_settimana(rif, date(2026, 7, 28)) == pytest.approx(4 * 10 + 3 * 20)


def test_riferimento_settimana_aprile_maggio_esclusi():
    rif = {'inizio': {'riferimento': 6100.0}, 'giugno': {'riferimento': 300.0}}
    assert riferimento_settimana(rif, date(2026, 5, 2)) is None                       # tutta maggio
    assert riferimento_settimana(rif, date(2026, 5, 30)) == pytest.approx(5 * 10)     # 30–31/5 esclusi


def test_wave_percentuale():
    assert wave(90, 100) == pytest.approx(90)
    assert wave(None, 100) is None and wave(90, None) is None and wave(90, 0) is None


# ── Lettura del foglio Storico ────────────────────────────────────────────────

def test_parse_storico_righe_e_avvisi():
    righe, avvisi = parse_storico(_xlsx([
        ('DPH', 2024, 'Agosto', 190817.44),
        ('dph', 2023, 'Maggio', 12781.62),
        ('CLB', 2026, 'Luglio', 1),        # anno di HotelOS: ignorato
        ('CLB', 2024, 'Ottobre', 1),       # fuori stagione
        ('XXX', 2024, 'Luglio', 1),        # struttura sconosciuta
        ('MMS', 2024, 'Luglio', None),     # senza netto
    ]))
    assert [(r.struttura_code, r.anno, r.mese, float(r.netto)) for r in righe] == [
        ('DPH', 2024, 8, 190817.44), ('DPH', 2023, 5, 12781.62)]
    assert len(avvisi) == 4


def test_parse_storico_errori():
    with pytest.raises(ErroreImportWave, match='Foglio'):
        parse_storico(_xlsx([('DPH', 2024, 'Agosto', 1)], foglio='Altro'))
    with pytest.raises(ErroreImportWave, match='due volte'):
        parse_storico(_xlsx([('DPH', 2024, 'Agosto', 1), ('DPH', 2024, 'Agosto', 2)]))
    with pytest.raises(ErroreImportWave, match='Excel'):
        parse_storico(b'non un file')


# ── Import e riferimento con DB ───────────────────────────────────────────────

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
def pulizia(engine):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE wave_storico, corrispettivi_manuali, hotel_seasons, hotels "
                          "RESTART IDENTITY CASCADE"))


def _import(client, righe, conferma):
    return client.post(f"/wave/storico/import?conferma={'true' if conferma else 'false'}",
                       files={'file': ('storico.xlsx', _xlsx(righe))})


def test_import_anteprima_non_scrive_poi_conferma(client):
    righe = [('MMS', 2024, 'Agosto', 28779.53), ('MMS', 2025, 'Agosto', 28931.5273)]
    r = _import(client, righe, False)
    assert r.status_code == 200 and r.json()['n_nuove'] == 2
    assert client.get("/wave/storico").json()['righe'] == []
    assert _import(client, righe, True).json()['n_nuove'] == 2
    assert len(client.get("/wave/storico").json()['righe']) == 2
    again = _import(client, righe, True).json()
    assert again['n_nuove'] == 0 and again['n_invariate'] == 2


def test_import_rifiuta_file_non_valido(client):
    r = client.post("/wave/storico/import", files={'file': ('x.xlsx', b'abc')})
    assert r.status_code == 400


def test_correzione_a_mano_protetta_dal_reimport_e_ripristino(client):
    _import(client, [('DPH', 2024, 'Aprile', 8177.77)], True)
    riga = client.get("/wave/storico").json()['righe'][0]
    mod = client.put(f"/wave/storico/{riga['id']}", json={'netto': 993.10}).json()
    assert mod['modificato_manualmente'] and mod['netto_originale'] == 8177.77

    rep = _import(client, [('DPH', 2024, 'Aprile', 8177.77)], True).json()
    assert rep['n_bloccate'] == 1 and rep['n_aggiornate'] == 0
    assert client.get("/wave/storico").json()['righe'][0]['netto'] == 993.10

    rip = client.put(f"/wave/storico/{riga['id']}", json={'ripristina': True}).json()
    assert rip['netto'] == 8177.77 and not rip['modificato_manualmente']


def test_import_aggiorna_righe_non_corrette(client):
    _import(client, [('CLB', 2022, 'Maggio', 2878.11)], True)
    rep = _import(client, [('CLB', 2022, 'Maggio', 6963.18)], True).json()
    assert rep['n_aggiornate'] == 1
    assert client.get("/wave/storico").json()['righe'][0]['netto'] == 6963.18


def test_riga_a_mano_e_eliminazione(client):
    r = client.post("/wave/storico", json={'struttura_code': 'BON', 'anno': 2024, 'mese': 7, 'netto': 100})
    assert r.status_code == 200 and r.json()['modificato_manualmente']
    assert client.post("/wave/storico", json={'struttura_code': 'BON', 'anno': 2024, 'mese': 7,
                                              'netto': 1}).status_code == 409
    assert client.post("/wave/storico", json={'struttura_code': 'BON', 'anno': 2026, 'mese': 7,
                                              'netto': 1}).status_code == 400
    assert client.delete(f"/wave/storico/{r.json()['id']}").status_code == 400
    assert client.delete(f"/wave/storico/{r.json()['id']}?conferma=true").status_code == 200


def _dati_mms(Sessione, client):
    _import(client, [('MMS', 2024, 'Agosto', 28779.53), ('MMS', 2025, 'Agosto', 28931.53),
                     ('MMS', 2025, 'Maggio', 705.27)], True)
    db = Sessione()
    hotel = Hotel(code='DPH', name='Hotel Du Parc', default_rooms=43)
    db.add(hotel)
    db.flush()
    db.add(HotelSeason(hotel_id=hotel.id, season_year=2026, open_date=date(2026, 5, 1),
                       close_date=date(2026, 9, 19), total_rooms=43))
    # 2026 dai corrispettivi manuali: 33.000 lordi ad agosto (= 30.000 netti, nuovo record)
    db.add(CorrispettiviManuale(data_giorno=date(2026, 8, 10), struttura_code='MMS',
                                arrangiamenti_lordo=33000, is_test=False))
    db.add(CorrispettiviManuale(data_giorno=date(2026, 8, 11), struttura_code='MMS',
                                arrangiamenti_lordo=99999, is_test=True))     # test: mai contato
    db.commit()
    return db


def _mms(dati):
    return next(s for s in dati['strutture'] if s['struttura_code'] == 'MMS')


def test_riferimento_storico_e_corrispettivi(Sessione, client):
    db = _dati_mms(Sessione, client)
    try:
        # 2026 a stagione chiusa: il riferimento del 2026 resta il meglio del 2022–2025
        mms = _mms(riferimento_anno(db, 2026, oggi=date(2026, 10, 31)))
        assert mms['riferimento']['agosto'] == {'riferimento': pytest.approx(28931.53), 'anno_record': 2025}
        agosto = next(p for p in mms['periodi'] if p['periodo'] == 'agosto')
        assert agosto['valori'][2026] == pytest.approx(30000)
        anno_2026 = next(a for a in mms['anni'] if a['anno'] == 2026)
        assert anno_2026['fonte'] == 'corrispettivi' and not anno_2026['in_corso']

        # per il 2027 il 2026 (chiuso) diventa il nuovo record
        mms = _mms(riferimento_anno(db, 2027, oggi=date(2026, 10, 31)))
        assert mms['riferimento']['agosto'] == {'riferimento': pytest.approx(30000), 'anno_record': 2026}
        assert mms['riferimento_stagione'] == pytest.approx(30000 + 705.27)

        # a stagione in corso il 2026 non concorre al record
        mms = _mms(riferimento_anno(db, 2027, oggi=date(2026, 9, 1)))
        assert mms['riferimento']['agosto']['anno_record'] == 2025
    finally:
        db.close()


def test_endpoint_riferimento(Sessione, client):
    _dati_mms(Sessione, client).close()
    r = client.get("/wave/riferimento?anno=2026")
    assert r.status_code == 200
    assert [s['struttura_code'] for s in r.json()['strutture']] == ['DPH', 'CLB', 'INT', 'MMS', 'BON']


# ── WAVE di un hotel sulle righe Revenue (Fase 2) ─────────────────────────────

def _righe_revenue(codice, giorni_valori):
    from app.services.file_parser import RigaRevenue
    return [RigaRevenue(hotel_code=codice, data=g, rooms_sold=10, rooms_available=20, pax=20,
                        revenue_rooms=v, revenue_fnb=0, revenue_extra=0, revenue_total=v)
            for g, v in giorni_valori]


def test_wave_hotel_settimana_a_cavallo_maggio_giugno(Sessione, client):
    from datetime import timedelta
    from app.services.wave_hotel import wave_hotel
    # riferimenti 2026 dal 2025: giugno 30.000 (1.000 al giorno), maggio 4.000 (blocco inizio)
    _import(client, [('DPH', 2025, 'Giugno', 30000), ('DPH', 2025, 'Maggio', 4000)], True)
    # 30/5/2026 (sabato) → 5/6: 7 giorni a 1.100 lordi = 1.000 netti
    giorni = [(date(2026, 5, 30) + timedelta(days=i), 1100.0) for i in range(7)]
    db = Sessione()
    try:
        w = wave_hotel(db, 'DPH', _righe_revenue('DPH', giorni), oggi=date(2026, 10, 31))
    finally:
        db.close()
    assert w['anno'] == 2026
    sett = w['settimane'][date(2026, 5, 30)]
    assert sett['valore'] == 5000.0 and sett['riferimento'] == 5000.0 and sett['wave'] == 100.0  # solo giugno
    # progressivo: inizio (2.000 su 4.000) + settimana (5.000 su 5.000)
    assert sett['progressivo'] == pytest.approx(7000 / 9000 * 100, abs=0.05)
    # settimane di giugno senza dati (hotel chiuso) = incasso zero; l'ultima chiude sul WAVE di stagione
    assert w['settimane'][date(2026, 6, 13)]['valore'] == 0.0
    ultima = max(k for k, v in w['settimane'].items() if v['progressivo'] is not None)
    assert w['settimane'][ultima]['progressivo'] == w['stagione']['wave']
    periodi = {p['periodo']: p for p in w['periodi']}
    assert periodi['inizio']['valore'] == 2000.0 and periodi['inizio']['wave'] == 50.0
    assert periodi['luglio']['riferimento'] is None and periodi['luglio']['wave'] is None
    # stagione: Σ incassi dei periodi con riferimento ÷ Σ riferimenti
    assert w['stagione']['valore'] == 7000.0 and w['stagione']['riferimento'] == 34000.0
    assert w['stagione']['wave'] == pytest.approx(20.6)


def test_wave_hotel_senza_giorni_di_stagione():
    from app.services.wave_hotel import wave_hotel
    assert wave_hotel(None, 'DPH', _righe_revenue('DPH', [(date(2026, 10, 3), 100.0)])) is None
