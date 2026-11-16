"""Data di competenza dei Corrispettivi (v4.37.0): acconto incassato prima dell'arrivo conta nel giorno di
arrivo nei report gestionali; i report fiscali (data del documento) non cambiano.

Dati sintetici, DB di test (TEST_DATABASE_URL in .env).
"""
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
from app.models.corrispettivi import CorrispettiviDocumento
from app.routers.corrispettivi_report import report_fatturati
from app.routers.usali import _somma_penali_corrispettivi
from app.services.corrispettivi_competenza import calcola_data_competenza

from tests._db import TEST_DB_URL  # noqa: E402


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

    utente_finto = SimpleNamespace(id=None)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente_finto
    app.dependency_overrides[richiedi_admin] = lambda: utente_finto
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _doc(numero, data_doc, lordo, maschera='Prenotazione', arrivo=None, categoria='arrangiamenti',
         annullato=False):
    imponibile = round(lordo / 1.10, 2) if categoria == 'arrangiamenti' else lordo
    return CorrispettiviDocumento(
        data_documento=data_doc, numero=numero, suffisso='D-SC', tipo='scontrino', struttura_code='DPH',
        camera='X1', codice_prenotazione=str(numero), numero_scontrino=str(numero),
        totale_lordo=lordo, imponibile=imponibile, iva=round(lordo - imponibile, 2),
        aliquota_pct=10 if categoria == 'arrangiamenti' else 0, categoria=categoria,
        maschera_conto=maschera, arrivo=arrivo, annullato=annullato, is_test=False, tassa_soggiorno=0,
        data_competenza=calcola_data_competenza('scontrino', maschera, arrivo, data_doc),
    )


@pytest.fixture(scope="module")
def dati(TestSession):
    db = TestSession()
    db.execute(text("DELETE FROM corrispettivi_documenti"))
    db.add_all([
        _doc(1, date(2026, 7, 10), 1100.0),                                              # normale luglio
        _doc(2, date(2026, 7, 11), 440.0, 'Acconto', date(2026, 8, 15)),                 # → agosto
        _doc(3, date(2026, 11, 12), 433.5, 'Acconto', date(2027, 5, 29)),                # → maggio 2027
        _doc(4, date(2026, 8, 20), 220.0, 'Acconto', date(2026, 8, 18)),                 # durante: resta
        _doc(5, date(2026, 11, 13), 99.0, 'Acconto', date(2027, 6, 1), annullato=True),  # annullato
        _doc(6, date(2026, 11, 14), 50.0, 'Acconto', date(2027, 6, 1), categoria='penali'),
    ])
    db.commit()
    db.close()


# ── Regola ──────────────────────────────────────────────────────────────────────────────────────────
def test_regola_solo_acconti_prima_dell_arrivo():
    d = date(2026, 11, 12)
    assert calcola_data_competenza('scontrino', 'Acconto', date(2027, 5, 29), d) == date(2027, 5, 29)
    assert calcola_data_competenza('fattura', ' Acconto ', date(2026, 12, 1), d) == date(2026, 12, 1)
    assert calcola_data_competenza('scontrino', 'Prenotazione', date(2027, 5, 29), d) is None
    assert calcola_data_competenza('escluso', 'Acconto', date(2027, 5, 29), d) is None
    assert calcola_data_competenza('scontrino', 'Acconto', d, d) is None          # emesso all'arrivo
    assert calcola_data_competenza('scontrino', 'Acconto', None, d) is None       # formato base


# ── Riepilogo Fatturati ─────────────────────────────────────────────────────────────────────────────
def _mesi(r):
    return {m['mese']: m['totale_generale'] for m in r['mesi']}


def test_fatturati_per_data_scontrino_invariato(client, dati):
    r = client.get('/corrispettivi/report/fatturati', params={'anno': 2026}).json()
    assert r['competenza'] is False and r['acconti'] is None
    assert _mesi(r) == {7: 1540.0, 8: 220.0, 11: 483.5}


def test_fatturati_per_competenza(client, dati):
    r = client.get('/corrispettivi/report/fatturati', params={'anno': 2026, 'competenza': True}).json()
    assert _mesi(r) == {7: 1100.0, 8: 660.0}
    assert r['acconti']['verso_anni_successivi'] == {'importo': 483.5, 'n_documenti': 2}
    assert r['acconti']['da_anni_precedenti'] == {'importo': 0.0, 'n_documenti': 0}

    r27 = client.get('/corrispettivi/report/fatturati', params={'anno': 2027, 'competenza': True}).json()
    assert _mesi(r27) == {5: 433.5, 6: 50.0}
    assert r27['acconti']['da_anni_precedenti'] == {'importo': 483.5, 'n_documenti': 2}


def test_fatturati_netto_per_competenza(client, dati):
    r = client.get('/corrispettivi/report/fatturati',
                   params={'anno': 2026, 'competenza': True, 'lordo': False}).json()
    # arrangiamenti ÷ 1,10, penali senza IVA
    assert r['acconti']['verso_anni_successivi']['importo'] == round(433.5 / 1.1, 2) + 50.0


def test_chiamata_interna_resta_per_data_documento(TestSession, dati):
    """IVA e previsioni di Tesoreria, WAVE, Analisi Ricavi chiamano senza `competenza`: data documento."""
    db = TestSession()
    try:
        r = report_fatturati(anno=2026, lordo=True, is_test=False, db=db, _=None)
        assert r['competenza'] is False
        assert r['totale_anno']['totale_generale'] == 2243.5
    finally:
        db.close()


def test_export_fatturati_per_competenza(client, dati):
    resp = client.get('/corrispettivi/export/fatturati', params={'anno': 2026, 'competenza': True})
    assert resp.status_code == 200
    assert '_competenza' in resp.headers['content-disposition']


def test_giornaliero_resta_per_data_documento(client, dati):
    r = client.get('/corrispettivi/report/giornaliero',
                   params={'data_da': '2026-11-01', 'data_a': '2026-11-30'})
    assert r.status_code == 200
    assert '433.5' in r.text


# ── USALI ───────────────────────────────────────────────────────────────────────────────────────────
def test_usali_penali_per_competenza(TestSession, dati):
    db = TestSession()
    try:
        assert _somma_penali_corrispettivi(db, 'DPH', date(2026, 1, 1), date(2026, 12, 31))['imponibile'] == 0
        assert _somma_penali_corrispettivi(db, 'DPH', date(2027, 1, 1), date(2027, 12, 31))['imponibile'] == 50.0
    finally:
        db.close()


# ── Correzione manuale ──────────────────────────────────────────────────────────────────────────────
def test_correzione_manuale_data_competenza(client, TestSession, dati):
    db = TestSession()
    doc_id = db.query(CorrispettiviDocumento.id).filter(CorrispettiviDocumento.numero == 1).scalar()
    db.close()

    r = client.put(f'/corrispettivi/documenti/{doc_id}', json={'data_competenza': '2027-06-10'})
    assert r.status_code == 200
    assert r.json()['data_competenza'] == '2027-06-10' and r.json()['modificato_manualmente'] is True

    # uguale alla data del documento o vuota = nessuno spostamento
    r = client.put(f'/corrispettivi/documenti/{doc_id}', json={'data_competenza': '2026-07-10'})
    assert r.json()['data_competenza'] is None
    assert client.put(f'/corrispettivi/documenti/{doc_id}', json={'data_competenza': 'xx'}).status_code == 422
