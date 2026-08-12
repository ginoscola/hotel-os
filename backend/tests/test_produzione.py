"""Test per il modulo Statistiche Produzione (dentro USALI).

Usa lo stesso DB di test (revenue_master_test) degli altri test suite (test_budget.py, ecc.).
Usa il file reale uploads/StatisticheProduzione.xlsx come fixture (488 righe, giugno 2026,
3 strutture, 86 righe riassetto — numeri verificati manualmente prima di scrivere i test).
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
from app.models.rooms import Room  # noqa: F401
from app.services.prod_parser import _carica_mapping_dettagli, _categoria_da_prezzo, parse_xlsx
from app.utils.struttura_resolver import carica_mappa_rooms, struttura_da_camera

TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"
FILE_TEST = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "StatisticheProduzione.xlsx")


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

    utente_finto = SimpleNamespace(id=None)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente_finto
    app.dependency_overrides[richiedi_admin] = lambda: utente_finto
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulisci_tabelle(test_engine):
    """Svuota le tabelle e reinserisce hotel/camere/categorie base prima di ogni test.

    prod_categorie va riseminata manualmente perché create_all() crea solo lo schema,
    non esegue gli INSERT della migrazione prod001_2026.
    """
    with test_engine.connect() as conn:
        conn.execute(text(
            "TRUNCATE prod_righe, prod_imports, prod_dettaglio_categoria, prod_categorie, "
            "rooms, hotels RESTART IDENTITY CASCADE"
        ))
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('CLB', 'Club Hotel', 45),
            ('DPH', 'Hotel Du Parc', 43),
            ('INT', 'Hotel International', 45)
        """))
        # Solo alcune camere reali nel DB (lookup autoritativo): il resto deve
        # risolversi via fallback prefisso, per testare entrambi i percorsi.
        conn.execute(text("""
            INSERT INTO rooms (code, hotel_id, struttura_code, attiva)
            SELECT 'C268', id, 'CLB', true FROM hotels WHERE code = 'CLB'
            UNION ALL SELECT 'D406', id, 'DPH', true FROM hotels WHERE code = 'DPH'
            UNION ALL SELECT 'I424', id, 'INT', true FROM hotels WHERE code = 'INT'
        """))
        conn.execute(text("""
            INSERT INTO prod_categorie (code, name, descrizione, includi_report, ordine, attivo, tariffa_riferimento) VALUES
            ('alloggio',           'Alloggio',           'Quota Alloggio',              true, 1, true, NULL),
            ('colazione',          'Colazione',          'Quota Colazione',             true, 2, true, NULL),
            ('cena',               'Cena',               'Quota Cena',                  true, 3, true, NULL),
            ('pranzo',             'Pranzo',             'Quota Pranzo',                true, 4, true, NULL),
            ('colazione_extra',    'Colazione Extra',    'Colazione Extra',             true, 5, true, NULL),
            ('parcheggio_hotel',   'Parcheggio Hotel',   'Parcheggio Area Hotel',       true, 6, true, 20.00),
            ('parcheggio_esterno', 'Parcheggio Esterno', 'Parcheggio Area Campoquadro', true, 7, true, 13.00),
            ('spiaggia',           'Spiaggia',           'Servizio Spiaggia',           true, 8, true, NULL),
            ('ricarica_auto',      'Ricarica Auto',      'Ricarica veicoli elettrici',  true, 9, true, NULL),
            ('altro',              'Altro',              'Tutto il resto non mappato',  true, 99, true, NULL)
        """))
        # Mapping testo Welcome -> categoria (non hardcoded, gestito da admin in produzione)
        conn.execute(text("""
            INSERT INTO prod_dettaglio_categoria (dettaglio_originale, categoria_id)
            SELECT v.dettaglio, c.id FROM (VALUES
                ('Quota Alloggio',               'alloggio'),
                ('Quota Colazione',              'colazione'),
                ('Quota Cena',                   'cena'),
                ('Quota Pranzo',                 'pranzo'),
                ('Colazione Extra',              'colazione_extra'),
                ('Riassetto',                    'altro'),
                ('Parcheggio Area Hotel',        'parcheggio_hotel'),
                ('Parcheggio Area Campoquadro',  'parcheggio_esterno'),
                ('Servizio Spiaggia',            'spiaggia'),
                ('Ricarica Auto',                'ricarica_auto')
            ) AS v(dettaglio, code)
            JOIN prod_categorie c ON c.code = v.code
        """))
        # "Parcheggio extra": categoria assegnata in base al prezzo, non al testo
        conn.execute(text("""
            INSERT INTO prod_dettaglio_categoria (dettaglio_originale, categoria_id, categoria_da_prezzo)
            SELECT 'Parcheggio extra', id, true FROM prod_categorie WHERE code = 'parcheggio_hotel'
        """))
        conn.commit()


def _importa_file_test(client, is_test=True):
    with open(FILE_TEST, 'rb') as f:
        return client.post(
            "/produzione/import",
            files={'file': ('StatisticheProduzione.xlsx', f,
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
            params={'is_test': is_test},
        )


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

class TestParser:
    def test_legge_file_reale(self, TestSession):
        db = TestSession()
        try:
            r = parse_xlsx(FILE_TEST, db)
        finally:
            db.close()
        assert r['n_righe_totali'] == 487
        assert r['n_valide'] == 487
        assert r['n_riassetto'] == 86
        assert r['n_escluse'] == 0
        assert r['strutture_trovate'] == {'DPH', 'CLB', 'INT'}
        assert r['data_da'] == date(2026, 6, 1)

    def test_struttura_da_prefisso_camera(self, TestSession):
        db = TestSession()
        try:
            rooms_map = carica_mappa_rooms(db)
            # Non in rooms → fallback su prefisso/nome speciale
            assert struttura_da_camera('D107', rooms_map=rooms_map) == 'DPH'
            assert struttura_da_camera('C058', rooms_map=rooms_map) == 'CLB'
            assert struttura_da_camera('I418', rooms_map=rooms_map) == 'INT'
            assert struttura_da_camera('FUEGO', rooms_map=rooms_map) == 'DPH'
            assert struttura_da_camera('AIRE', rooms_map=rooms_map) == 'DPH'
            # In rooms → lookup autoritativo (vince anche se il prefisso direbbe altro)
            assert struttura_da_camera('c268', rooms_map=rooms_map) == 'CLB'  # case-insensitive
        finally:
            db.close()

    def test_righe_riassetto_salvate_con_flag(self, TestSession):
        db = TestSession()
        try:
            r = parse_xlsx(FILE_TEST, db)
        finally:
            db.close()
        riassetto = [x for x in r['righe'] if x['is_riassetto']]
        assert len(riassetto) == 86
        assert all(x['dettaglio_originale'].lower() == 'riassetto' for x in riassetto)

    def test_categorie_assegnate_correttamente(self, TestSession):
        db = TestSession()
        try:
            r = parse_xlsx(FILE_TEST, db)
            cats = {c.id: c.code for c in db.query(ProdCategoria).all()}
        finally:
            db.close()
        conteggi = {}
        for x in r['righe']:
            code = cats[x['categoria_id']]
            conteggi[code] = conteggi.get(code, 0) + 1
        assert conteggi['alloggio'] == 127
        assert conteggi['colazione'] == 123
        assert conteggi['cena'] == 38
        assert conteggi['pranzo'] == 27
        assert conteggi['colazione_extra'] == 5
        # Parcheggio diviso in due categorie separate (non più una con sotto-tipo interno)
        assert conteggi['parcheggio_hotel'] == 10
        assert conteggi['parcheggio_esterno'] == 24
        assert conteggi['spiaggia'] == 6
        # 'altro' include le 86 righe riassetto + le voci bar varie (spiaggia ora smistata)
        assert conteggi['altro'] == 127

    def test_parcheggio_diviso_hotel_esterno(self, TestSession):
        """Split confermato dall'utente: parcheggio Area Hotel (20€) ed Esterno/Campoquadro
        (13€) sono due categorie distinte, non un'unica 'parcheggio' con sotto-tipo interno —
        il mapping testo->categoria è in prod_dettaglio_categoria, non hardcoded, editabile
        da admin (es. se l'anno prossimo Welcome rinomina l'Articolo)."""
        db = TestSession()
        try:
            r = parse_xlsx(FILE_TEST, db)
            cats = {c.id: c.code for c in db.query(ProdCategoria).all()}
        finally:
            db.close()
        dettagli_hotel = {x['dettaglio_originale'] for x in r['righe'] if cats[x['categoria_id']] == 'parcheggio_hotel'}
        dettagli_esterno = {x['dettaglio_originale'] for x in r['righe'] if cats[x['categoria_id']] == 'parcheggio_esterno'}
        # Preserva la casistica originale del file, incluse le varianti maiuscolo/minuscolo,
        # ma il match a categoria è case-insensitive: entrambe le varianti finiscono nella
        # stessa categoria parcheggio_hotel.
        assert dettagli_hotel == {'Parcheggio Area Hotel', 'Parcheggio area hotel'}
        assert dettagli_esterno == {'Parcheggio Area Campoquadro'}

    def test_parcheggio_extra_categorizzato_per_prezzo(self, TestSession):
        """'Parcheggio extra' non ha un testo che lo distingua Hotel/Esterno (a differenza di
        'Parcheggio Area Hotel'/'Area Campoquadro'): la categoria è scelta in base al prezzo,
        multiplo esatto della tariffa (20€/notte Hotel, 13€/notte Esterno) — valori reali
        osservati in un import di giugno 2026. 'Ricarica Auto' invece NON segue questa regola:
        è un servizio a parte (ricarica veicoli elettrici), non un tipo di sosta."""
        db = TestSession()
        try:
            categorie_by_id = {c.id: c for c in db.query(ProdCategoria).all()}
            mapping = _carica_mapping_dettagli(db)
            fallback_id = mapping['parcheggio extra'][0]

            casi = {13.00: 'parcheggio_esterno', 26.00: 'parcheggio_esterno',
                    91.00: 'parcheggio_esterno', 18.00: 'parcheggio_hotel',
                    20.00: 'parcheggio_hotel', 280.00: 'parcheggio_hotel'}
            for prezzo, atteso in casi.items():
                cat_id = _categoria_da_prezzo(prezzo, categorie_by_id, fallback_id)
                assert categorie_by_id[cat_id].code == atteso, f"prezzo {prezzo}"

            # 'Ricarica Auto' mappato per testo (fisso), non per prezzo
            assert mapping['ricarica auto'] == (
                next(c.id for c in categorie_by_id.values() if c.code == 'ricarica_auto'), False,
            )
        finally:
            db.close()

    def test_imponibile_coerente_con_aliquota(self, TestSession):
        """imponibile = lordo / (1 + aliquota/100) — mai lordo - iva."""
        db = TestSession()
        try:
            r = parse_xlsx(FILE_TEST, db)
        finally:
            db.close()
        riga = next(x for x in r['righe'] if x['prezzo_lordo'] == 67.5 and x['aliquota_pct'] == 10.0)
        assert riga['imponibile'] == pytest.approx(67.5 / 1.10, abs=0.01)


# ---------------------------------------------------------------------------
# Import via API
# ---------------------------------------------------------------------------

class TestImport:
    def test_import_salva_righe(self, client):
        resp = _importa_file_test(client)
        assert resp.status_code == 200
        body = resp.json()
        assert body['n_inserite'] == 487
        assert body['n_righe_riassetto'] == 86
        assert set(body['strutture']) == {'DPH', 'CLB', 'INT'}

    def test_import_idempotente(self, client):
        """Un secondo import dello stesso file/periodo è rifiutato (409), non duplica righe —
        stesso pattern UX del modulo Dipendenti ('Import già presente...')."""
        r1 = _importa_file_test(client)
        assert r1.json()['n_inserite'] == 487

        r2 = _importa_file_test(client)
        assert r2.status_code == 409
        assert "già presente" in r2.json()['detail']

    def test_reimport_sovrapposto_non_duplica(self, client):
        """Bug reale: un secondo import con nome file diverso ma stesso periodo aggirava il
        controllo 409 a livello di sessione. Prima del fix su oid_welcome le righe venivano
        duplicate (401 -> 802); ora devono essere riconosciute come già presenti e saltate."""
        r1 = _importa_file_test(client)
        assert r1.json()['n_inserite'] == 487

        with open(FILE_TEST, 'rb') as f:
            r2 = client.post(
                "/produzione/import",
                files={'file': ('nome_diverso.xlsx', f,
                                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
                params={'is_test': True},
            )
        assert r2.status_code == 200
        body2 = r2.json()
        assert body2['n_inserite'] == 0
        assert body2['n_saltate'] == 487

    def test_righe_con_ospite_vuoto_non_si_collassano(self, TestSession):
        """Bug reale: con la vecchia chiave anti-duplicati (tupla di campi), righe DISTINTE con
        ospite vuoto (es. più persone nella stessa camera senza nome associato all'addebito) che
        condividono struttura/data/camera/dettaglio/prezzo venivano scartate come falsi duplicati.
        oid_welcome (id univoco Welcome per riga) le distingue correttamente."""
        db = TestSession()
        try:
            r = parse_xlsx(FILE_TEST, db)
        finally:
            db.close()
        vuoti = [x for x in r['righe'] if x['ospite'] == '']
        assert len(vuoti) >= 30  # 36 righe nel file reale hanno Cliente vuoto
        oid_vuoti = [x['oid_welcome'] for x in vuoti]
        assert len(oid_vuoti) == len(set(oid_vuoti))  # tutti distinti, nessuna collisione

    def test_import_test_eliminabile(self, client):
        r = _importa_file_test(client, is_test=True)
        import_id = r.json()['id']

        d = client.delete(f"/produzione/import/{import_id}", params={'conferma': True})
        assert d.status_code == 200

        storico = client.get("/produzione/import/storico", params={'is_test': True}).json()
        assert all(i['id'] != import_id for i in storico)

    def test_import_reale_eliminabile(self, client):
        """Come Corrispettivi: anche un import reale (non solo di test) è eliminabile con
        ?conferma=true, con cascade sulle righe collegate — utile per correggere import
        con dati sbagliati senza dover intervenire a mano sul database."""
        r = _importa_file_test(client, is_test=False)
        import_id = r.json()['id']

        d = client.delete(f"/produzione/import/{import_id}", params={'conferma': True})
        assert d.status_code == 200

        storico = client.get("/produzione/import/storico", params={'is_test': False}).json()
        assert all(i['id'] != import_id for i in storico)


class TestRicalcolaCategorie:
    def test_ricalcola_applica_mapping_a_righe_gia_importate(self, client, TestSession):
        """Bug reale: creare un mapping in Admin (es. 'Caffè' -> Bar Caffetteria) non tocca le
        righe già importate — categoria_id viene scritto una sola volta in fase di import.
        Serve un ricalcolo esplicito (stesso pattern di /dipendenti/ricalcola-cc-anno)."""
        _importa_file_test(client, is_test=False)

        db = TestSession()
        try:
            riga_altro = (
                db.query(ProdRiga)
                .join(ProdCategoria, ProdCategoria.id == ProdRiga.categoria_id)
                .filter(ProdCategoria.code == 'altro', ProdRiga.is_riassetto.is_(False))
                .first()
            )
            assert riga_altro is not None, "serve almeno una riga reale non mappata nel file di test"
            dettaglio = riga_altro.dettaglio_originale
        finally:
            db.close()

        cat = client.post("/produzione/categorie", json={
            'code': 'bar_caffetteria', 'name': 'Bar Caffetteria',
            'includi_report': True, 'ordine': 50, 'attivo': True,
        }).json()

        m = client.post("/produzione/mapping-dettagli", json={
            'dettaglio_originale': dettaglio, 'categoria_id': cat['id'], 'categoria_da_prezzo': False,
        })
        assert m.status_code == 200

        # Prima del ricalcolo: la riga già importata resta nella vecchia categoria ('altro')
        db = TestSession()
        try:
            riga_prima = db.query(ProdRiga).filter(ProdRiga.dettaglio_originale == dettaglio).first()
            assert riga_prima.categoria_id != cat['id']
        finally:
            db.close()

        r = client.post("/produzione/ricalcola-categorie")
        assert r.status_code == 200
        assert r.json()['n_righe_aggiornate'] >= 1

        db = TestSession()
        try:
            righe_dopo = db.query(ProdRiga).filter(ProdRiga.dettaglio_originale == dettaglio).all()
            assert len(righe_dopo) >= 1
            assert all(rr.categoria_id == cat['id'] for rr in righe_dopo)
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

class TestReport:
    def test_riassetto_escluso_dai_report(self, client):
        _importa_file_test(client, is_test=True)
        resp = client.get("/produzione/report/giornaliero", params={
            'data_da': '2026-06-01', 'data_a': '2026-06-01', 'is_test': True,
        })
        assert resp.status_code == 200
        dati = resp.json()
        n_righe_report = sum(g['totale']['n_righe'] for g in dati)
        # 487 totali - 86 riassetto = 401 righe attese nei report
        assert n_righe_report == 401

    def test_aggregazione_giornaliera_per_struttura(self, client):
        _importa_file_test(client, is_test=True)
        resp = client.get("/produzione/report/giornaliero", params={
            'data_da': '2026-06-01', 'data_a': '2026-06-01', 'is_test': True,
        })
        dati = resp.json()
        assert len(dati) == 3  # una riga per struttura (un solo giorno nel file)
        strutture = {g['struttura_code'] for g in dati}
        assert strutture == {'DPH', 'CLB', 'INT'}
        for g in dati:
            assert 'alloggio' in g['per_categoria']
            assert 'parcheggio_hotel' in g['per_categoria']
            assert 'parcheggio_esterno' in g['per_categoria']

    def test_aggregazione_settimanale(self, client):
        _importa_file_test(client, is_test=True)
        resp = client.get("/produzione/report/settimanale", params={
            'data_da': '2026-06-01', 'data_a': '2026-06-01', 'is_test': True,
        })
        assert resp.status_code == 200
        dati = resp.json()
        assert len(dati) == 3
        for g in dati:
            assert 'week_start' in g
            # 2026-06-01 è lunedì; settimana sab-ven → sabato precedente 2026-05-30
            assert g['week_start'] == '2026-05-30'

    def test_aggregazione_mensile(self, client):
        _importa_file_test(client, is_test=True)
        resp = client.get("/produzione/report/mensile", params={'anno': 2026, 'is_test': True})
        assert resp.status_code == 200
        dati = resp.json()
        assert len(dati['mesi']) == 12
        giugno = next(m for m in dati['mesi'] if m['mese'] == 6)
        assert giugno['totale']['n_righe'] == 401
        gennaio = next(m for m in dati['mesi'] if m['mese'] == 1)
        assert gennaio['totale']['n_righe'] == 0

    def test_report_canali_aggrega_correttamente(self, client):
        _importa_file_test(client, is_test=True)
        resp = client.get("/produzione/report/canali", params={
            'data_da': '2026-06-01', 'data_a': '2026-06-01', 'is_test': True,
        })
        assert resp.status_code == 200
        dati = resp.json()['per_canale']
        canali = {c['canale'] for c in dati}
        # 'Non specificato' è reale nel file: 36 righe hanno ParametroCanaleVendita vuoto
        assert canali == {'Booking Engine', 'Booking. com', 'Mr Preno', 'Non specificato'}
        totale_pct = sum(c['pct_totale'] for c in dati)
        assert totale_pct == pytest.approx(100.0, abs=0.5)
        for c in dati:
            assert sum(v['lordo'] for v in c['per_struttura'].values()) == pytest.approx(c['lordo'], abs=0.5)
