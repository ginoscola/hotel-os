"""Test per /usali/movimenti-attivi: righe auto da Produzione/Corrispettivi + righe manuali,
PER STRUTTURA (DPH/CLB/INT/BON), incluso il redirect Maremosso (solo DPH: pranzo/cena Du Parc +
righe Welcome Reparto='Maremosso').

Usa lo stesso DB di test (revenue_master_test) delle altre suite.
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
from app.models.produzione import ProdCategoria, ProdImport, ProdRiga  # noqa: F401
from app.models.corrispettivi import CorrispettiviDocumento, CorrispettiviManuale  # noqa: F401
from app.models.usali import UsaliMovimentoRiga, UsaliVoceManuali  # noqa: F401

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

    utente_finto = SimpleNamespace(id=None)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente_finto
    app.dependency_overrides[richiedi_admin] = lambda: utente_finto
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulisci_e_semina(test_engine, TestSession):
    with test_engine.connect() as conn:
        conn.execute(text(
            "TRUNCATE usali_voci_manuali, usali_movimenti_righe, corrispettivi_documenti, "
            "corrispettivi_manuali, prod_righe, prod_imports, prod_categorie, hotels RESTART IDENTITY CASCADE"
        ))
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('CLB', 'Club Hotel', 45), ('DPH', 'Hotel Du Parc', 43), ('INT', 'Hotel International', 45)
        """))
        conn.execute(text("""
            INSERT INTO prod_categorie (code, name, includi_report, ordine, attivo) VALUES
            ('alloggio', 'Alloggio', true, 1, true),
            ('colazione', 'Colazione', true, 2, true),
            ('cena', 'Cena', true, 3, true),
            ('pranzo', 'Pranzo', true, 4, true),
            ('parcheggio_hotel', 'Parcheggio Hotel', true, 5, true),
            ('parcheggio_esterno', 'Parcheggio Esterno', true, 6, true),
            ('spiaggia', 'Spiaggia', true, 7, true),
            ('altro', 'Altro', true, 99, true)
        """))
        conn.execute(text("""
            INSERT INTO prod_imports (nome_file, data_da, data_a, n_righe_totali, n_righe_valide, n_righe_riassetto, n_righe_escluse, is_test) VALUES
            ('test.xlsx', '2026-06-01', '2026-06-30', 0, 0, 0, 0, false)
        """))
        # Righe Movimenti Attivi minime per struttura (mirror del seed di usali002_2026, ridotto)
        conn.execute(text("""
            INSERT INTO usali_movimenti_righe (struttura_code, reparto, conto, riga_code, tipo, ordine, categoria_produzione) VALUES
            ('DPH', 'Camere', 'Camere Gruppi', 'mov_camere_gruppi', 'manuale', 1, NULL),
            ('DPH', 'Parcheggio', 'Servizio Parcheggio -> Area Hotel', 'mov_parcheggio_hotel', 'auto_produzione', 2, 'parcheggio_hotel'),
            ('DPH', 'Ricavi Vari', 'Penali di Cancellazione Camere', 'mov_penali', 'auto_corrispettivi_penali', 3, NULL),
            ('DPH', 'Ristorante Mare Mosso', 'Alimenti -> Altri Alimenti - Hotel', 'mov_maremosso_alimenti', 'auto_maremosso', 4, NULL),
            ('DPH', 'Ristorante Mare Mosso', 'Alimenti -> Altri Alimenti - Clienti Esterni', 'mov_maremosso_alimenti_esterni', 'auto_maremosso_esterni', 5, NULL),
            ('CLB', 'Parcheggio', 'Servizio Parcheggio -> Area Esterna', 'mov_parcheggio_esterno', 'auto_produzione', 1, 'parcheggio_esterno'),
            ('CLB', 'Ristorante', 'Alimenti -> Pranzo', 'mov_ristorante_pranzo', 'auto_produzione', 2, 'pranzo'),
            ('INT', 'Colazione', 'Alimenti -> Altri Alimenti', 'mov_colazione', 'auto_produzione', 1, 'colazione'),
            ('BON', 'Ristorante', 'Alimenti -> Altri Alimenti', 'mov_alimenti', 'manuale', 1, NULL)
        """))
        conn.commit()

    db = TestSession()
    try:
        cat = {c.code: c.id for c in db.query(ProdCategoria).all()}
        imp = db.query(ProdImport).first()

        def riga(**kw):
            base = dict(
                import_id=imp.id, data_riferimento=date(2026, 6, 15), struttura_code='DPH',
                camera='D101', is_riassetto=False, prezzo_lordo=0, prezzo_netto=0,
                imponibile=0, iva=0, aliquota_pct=10, is_test=False, oid_welcome=None,
            )
            base.update(kw)
            return ProdRiga(**base)

        db.add_all([
            # Parcheggio Hotel (DPH) + Esterno (CLB) — auto da Produzione. IVA reale 22% (non 0
            # come le altre righe fixture) per verificare che il lordo delle righe auto si calcoli
            # dall'IVA reale sommata dai dati sorgente, non da un'aliquota assunta.
            riga(categoria_id=cat['parcheggio_hotel'], struttura_code='DPH', imponibile=100.0, iva=22.0, oid_welcome=1),
            riga(categoria_id=cat['parcheggio_esterno'], struttura_code='CLB', imponibile=50.0, oid_welcome=2),
            # Colazione (INT) — auto da Produzione
            riga(categoria_id=cat['colazione'], struttura_code='INT', imponibile=30.0, oid_welcome=3),
            # Pranzo/Cena Du Parc — da redirigere al Maremosso (solo DPH ha questo redirect)
            riga(categoria_id=cat['pranzo'], struttura_code='DPH', imponibile=40.0, oid_welcome=4),
            riga(categoria_id=cat['cena'], struttura_code='DPH', imponibile=60.0, oid_welcome=5),
            # Pranzo Club Hotel — resta un ricavo normale del CLB (sezione Ristorante propria,
            # NON deve finire nel Maremosso: solo il Du Parc mangia al Maremosso)
            riga(categoria_id=cat['pranzo'], struttura_code='CLB', imponibile=77.0, oid_welcome=6),
            # Riga Welcome esplicitamente 'Maremosso' come Reparto
            riga(categoria_id=cat['altro'], struttura_code='DPH', descrizione='Maremosso', imponibile=25.0, oid_welcome=7),
            # Riassetto: non deve entrare in nessun totale
            riga(categoria_id=cat['parcheggio_hotel'], struttura_code='DPH', imponibile=0.0,
                 is_riassetto=True, oid_welcome=8),
            # Fuori mese (maggio): non deve contare nel totale di giugno
            riga(categoria_id=cat['parcheggio_hotel'], struttura_code='DPH', imponibile=500.0,
                 data_riferimento=date(2026, 5, 15), oid_welcome=9),
        ])

        # Penali Corrispettivi DPH (giugno) — auto
        db.add(CorrispettiviDocumento(
            data_documento=date(2026, 6, 10), suffisso='D-SC', tipo='scontrino', struttura_code='DPH',
            totale_lordo=0, imponibile=15.0, iva=0, aliquota_pct=0, categoria='penali',
            annullato=False, is_test=False,
        ))
        # Penale annullata: non deve contare
        db.add(CorrispettiviDocumento(
            data_documento=date(2026, 6, 11), suffisso='D-SC', tipo='scontrino', struttura_code='DPH',
            totale_lordo=0, imponibile=999.0, iva=0, aliquota_pct=0, categoria='penali',
            annullato=True, is_test=False,
        ))
        # Penale CLB: non deve mai comparire nel totale DPH (per-struttura, non più di gruppo)
        db.add(CorrispettiviDocumento(
            data_documento=date(2026, 6, 12), suffisso='C-SC', tipo='scontrino', struttura_code='CLB',
            totale_lordo=0, imponibile=888.0, iva=0, aliquota_pct=0, categoria='penali',
            annullato=False, is_test=False,
        ))

        # Maremosso clienti esterni (giugno): 330.00 lordo totale -> 300.00 imponibile, 30.00 IVA
        # (110.00 + 220.00, divisibile esattamente per 1.10, per assertion pulite)
        db.add(CorrispettiviManuale(
            data_giorno=date(2026, 6, 5), struttura_code='MMS', arrangiamenti_lordo=110.0, is_test=False,
        ))
        db.add(CorrispettiviManuale(
            data_giorno=date(2026, 6, 20), struttura_code='MMS', arrangiamenti_lordo=220.0, is_test=False,
        ))
        # Fuori mese (maggio): non deve contare nel totale di giugno
        db.add(CorrispettiviManuale(
            data_giorno=date(2026, 5, 31), struttura_code='MMS', arrangiamenti_lordo=999.0, is_test=False,
        ))
        # Dato di test: non deve contare
        db.add(CorrispettiviManuale(
            data_giorno=date(2026, 6, 15), struttura_code='MMS', arrangiamenti_lordo=999.0, is_test=True,
        ))
        # BON: non deve mai comparire nel totale MMS
        db.add(CorrispettiviManuale(
            data_giorno=date(2026, 6, 15), struttura_code='BON', arrangiamenti_lordo=999.0, is_test=False,
        ))
        db.commit()
    finally:
        db.close()


def _righe_by_code(dati):
    return {r['riga_code']: r for r in dati['righe']}


def _get(client, struttura, anno=2026, mese=6):
    r = client.get('/usali/movimenti-attivi', params={'struttura': struttura, 'anno': anno, 'mese': mese})
    assert r.status_code == 200, r.text
    return r.json()


class TestMovimentiAttivi:
    def test_struttura_non_valida_rifiutata(self, client):
        r = client.get('/usali/movimenti-attivi', params={'struttura': 'MMS', 'anno': 2026, 'mese': 6})
        assert r.status_code == 400  # Maremosso non è una struttura selezionabile, è dentro DPH

    def test_righe_auto_produzione_per_struttura(self, client):
        """Ogni struttura vede solo i propri dati Produzione, non quelli delle altre."""
        dph = _righe_by_code(_get(client, 'DPH'))
        assert dph['mov_parcheggio_hotel']['imponibile'] == 100.0
        assert dph['mov_parcheggio_hotel']['auto'] is True

        clb = _righe_by_code(_get(client, 'CLB'))
        assert clb['mov_parcheggio_esterno']['imponibile'] == 50.0
        assert clb['mov_ristorante_pranzo']['imponibile'] == 77.0  # sezione Ristorante propria del CLB

        int_ = _righe_by_code(_get(client, 'INT'))
        assert int_['mov_colazione']['imponibile'] == 30.0

    def test_riassetto_e_mese_diverso_esclusi(self, client):
        dph = _righe_by_code(_get(client, 'DPH'))
        assert dph['mov_parcheggio_hotel']['imponibile'] == 100.0  # non 100+500 (maggio) né +0 (riassetto)

    def test_redirect_maremosso_solo_dph(self, client):
        """Pranzo+Cena Du Parc (40+60) + riga Reparto='Maremosso' (25) = 125, solo su DPH.
        Il CLB ha la propria sezione Ristorante (77 nel pranzo), non un redirect al Maremosso."""
        dph = _righe_by_code(_get(client, 'DPH'))
        assert dph['mov_maremosso_alimenti']['imponibile'] == 125.0
        assert dph['mov_maremosso_alimenti']['auto'] is True

    def test_maremosso_clienti_esterni_da_corrispettivi_manuali(self, client):
        """Clienti esterni al Maremosso: da corrispettivi_manuali (MMS), non da Welcome — lordo
        330.00 (110+220) / 1.10 = 300.00 imponibile, 30.00 IVA. Esclude righe fuori mese, di test
        e di un'altra struttura (BON)."""
        dph = _righe_by_code(_get(client, 'DPH'))
        riga = dph['mov_maremosso_alimenti_esterni']
        assert riga['auto'] is True
        assert riga['imponibile'] == pytest.approx(300.0, abs=0.01)
        assert riga['iva'] == pytest.approx(30.0, abs=0.01)
        assert riga['lordo'] == pytest.approx(330.0, abs=0.01)

    def test_penali_per_struttura(self, client):
        """DPH: 15€ dalla riga valida (999€ annullata esclusa). Il penale CLB (888€) non deve
        comparire nel totale DPH — ogni struttura vede solo i propri documenti."""
        dph = _righe_by_code(_get(client, 'DPH'))
        assert dph['mov_penali']['imponibile'] == 15.0

    def test_riga_manuale_per_struttura_isolata(self, client):
        """Il valore manuale salvato per DPH non deve comparire per un'altra struttura."""
        r1 = _righe_by_code(_get(client, 'DPH'))
        assert r1['mov_camere_gruppi']['imponibile'] == 0.0
        assert r1['mov_camere_gruppi']['auto'] is False

        put = client.put('/usali/movimenti-attivi', json={
            'struttura': 'DPH', 'anno': 2026, 'mese': 6, 'riga_code': 'mov_camere_gruppi', 'imponibile': 1234.56,
        })
        assert put.status_code == 200

        r2 = _righe_by_code(_get(client, 'DPH'))
        assert r2['mov_camere_gruppi']['imponibile'] == 1234.56

    def test_riga_auto_non_modificabile(self, client):
        put = client.put('/usali/movimenti-attivi', json={
            'struttura': 'DPH', 'anno': 2026, 'mese': 6, 'riga_code': 'mov_parcheggio_hotel', 'imponibile': 999,
        })
        assert put.status_code == 400

    def test_riga_di_altra_struttura_rifiutata(self, client):
        """mov_colazione esiste solo per INT: scriverla su DPH deve fallire."""
        put = client.put('/usali/movimenti-attivi', json={
            'struttura': 'DPH', 'anno': 2026, 'mese': 6, 'riga_code': 'mov_colazione', 'imponibile': 10,
        })
        assert put.status_code == 400

    def test_bon_set_minimo_tutto_manuale(self, client):
        bon = _get(client, 'BON')
        assert len(bon['righe']) == 1
        assert bon['righe'][0]['auto'] is False

    def test_totale_somma_tutte_le_righe(self, client):
        dati = _get(client, 'DPH')
        assert dati['totale'] == pytest.approx(sum(x['imponibile'] for x in dati['righe']), abs=0.01)


class TestToggleIva:
    """Righe auto: lordo dall'IVA reale sommata dai dati sorgente. Righe manuali: lordo
    dall'aliquota configurata sulla riga (usali_movimenti_righe.aliquota_iva, default 10%)."""

    def test_riga_auto_lordo_da_iva_reale(self, client):
        dph = _righe_by_code(_get(client, 'DPH'))
        riga = dph['mov_parcheggio_hotel']
        assert riga['imponibile'] == 100.0
        assert riga['iva'] == 22.0
        assert riga['lordo'] == 122.0

    def test_riga_manuale_lordo_da_aliquota_default_10(self, client):
        client.put('/usali/movimenti-attivi', json={
            'struttura': 'DPH', 'anno': 2026, 'mese': 6, 'riga_code': 'mov_camere_gruppi', 'imponibile': 200.0,
        })
        dph = _righe_by_code(_get(client, 'DPH'))
        riga = dph['mov_camere_gruppi']
        assert riga['imponibile'] == 200.0
        assert riga['iva'] == pytest.approx(20.0, abs=0.01)
        assert riga['lordo'] == pytest.approx(220.0, abs=0.01)

    def test_riga_manuale_con_aliquota_personalizzata_22(self, client):
        """Es. Shop Km Di Mare: aliquota diversa dal default 10%, come 'shop' in Corrispettivi."""
        crea = client.post('/usali/movimenti-righe', json={
            'struttura_code': 'DPH', 'reparto': 'Shop', 'conto': 'Ricavi -> Shop',
            'riga_code': 'mov_shop_test', 'tipo': 'manuale', 'aliquota_iva': 22.0,
        })
        assert crea.status_code == 200

        client.put('/usali/movimenti-attivi', json={
            'struttura': 'DPH', 'anno': 2026, 'mese': 6, 'riga_code': 'mov_shop_test', 'imponibile': 100.0,
        })
        dph = _righe_by_code(_get(client, 'DPH'))
        riga = dph['mov_shop_test']
        assert riga['iva'] == pytest.approx(22.0, abs=0.01)
        assert riga['lordo'] == pytest.approx(122.0, abs=0.01)

    def test_totale_imponibile_e_lordo_nel_payload(self, client):
        dati = _get(client, 'DPH')
        assert dati['totale_imponibile'] == pytest.approx(sum(x['imponibile'] for x in dati['righe']), abs=0.01)
        assert dati['totale_lordo'] == pytest.approx(sum(x['lordo'] for x in dati['righe']), abs=0.01)
        assert dati['totale_lordo'] >= dati['totale_imponibile']


class TestMovimentiRighe:
    """CRUD admin delle definizioni di riga (usali_movimenti_righe)."""

    def test_lista_per_struttura(self, client):
        r = client.get('/usali/movimenti-righe', params={'struttura': 'DPH'})
        assert r.status_code == 200
        righe = {x['riga_code']: x for x in r.json()}
        assert 'mov_camere_gruppi' in righe
        assert 'mov_colazione' not in righe  # quella è solo di INT
        assert righe['mov_camere_gruppi']['aliquota_iva'] == 10.0  # default

    def test_aliquota_iva_personalizzata_in_crud(self, client):
        crea = client.post('/usali/movimenti-righe', json={
            'struttura_code': 'DPH', 'reparto': 'Shop', 'conto': 'Ricavi -> Shop',
            'riga_code': 'mov_shop_crud', 'tipo': 'manuale', 'aliquota_iva': 22.0,
        })
        assert crea.status_code == 200
        riga_id = crea.json()['id']

        righe = {x['riga_code']: x for x in client.get('/usali/movimenti-righe', params={'struttura': 'DPH'}).json()}
        assert righe['mov_shop_crud']['aliquota_iva'] == 22.0

        client.put(f'/usali/movimenti-righe/{riga_id}', json={'aliquota_iva': 20.0})
        righe = {x['riga_code']: x for x in client.get('/usali/movimenti-righe', params={'struttura': 'DPH'}).json()}
        assert righe['mov_shop_crud']['aliquota_iva'] == 20.0

    def test_crea_modifica_elimina(self, client):
        crea = client.post('/usali/movimenti-righe', json={
            'struttura_code': 'DPH', 'reparto': 'Test', 'conto': 'Voce Test',
            'riga_code': 'mov_test_nuovo', 'tipo': 'manuale',
        })
        assert crea.status_code == 200
        riga_id = crea.json()['id']

        agg = client.put(f'/usali/movimenti-righe/{riga_id}', json={'attivo': False})
        assert agg.status_code == 200

        # Disattivata: non deve più comparire in GET /movimenti-attivi
        dph = _get(client, 'DPH')
        assert all(r['riga_code'] != 'mov_test_nuovo' for r in dph['righe'])

        elim = client.delete(f'/usali/movimenti-righe/{riga_id}')
        assert elim.status_code == 200

    def test_riga_duplicata_rifiutata(self, client):
        r = client.post('/usali/movimenti-righe', json={
            'struttura_code': 'DPH', 'reparto': 'Camere', 'conto': 'Camere Gruppi',
            'riga_code': 'mov_camere_gruppi', 'tipo': 'manuale',
        })
        assert r.status_code == 400
