"""
Test per l'import CORRISP.xml in rt_chiusure:
- Inserisce una nuova riga da un file XML valido
- on_conflict=salta non tocca una riga già presente
- on_conflict=aggiorna aggiorna una riga esistente non modificata a mano
- Una riga con modificato_manualmente=True non viene mai sovrascritta
- Solo admin può importare (viewer riceve 403)
"""
import os
import socket
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import hash_password, crea_token_accesso
from app.database import Base, get_db
from app.main import app
from app.models.revenue import User, Hotel, RtPrinter  # noqa: F401
from app.models.corrispettivi import RtChiusura  # noqa: F401

TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"
FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'corrisp_20260630_mock.xml')

# Data di test isolata dai dati reali già presenti in rt_chiusure
DATA_TEST = "2026-06-30"
RT_CODE_TEST = "RT1"


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
        for username, ruolo in [('test_admin_rtxml', 'admin'), ('test_viewer_rtxml', 'viewer')]:
            if not db.query(User).filter(User.username == username).first():
                db.add(User(
                    username=username,
                    password_hash=hash_password('test123'),
                    ruolo=ruolo,
                    attivo=True,
                ))
        # Hotel + stampante RT di test, necessari per /rt-chiusure/import-da-stampante
        if not db.query(Hotel).filter(Hotel.code == 'DPH').first():
            printer = RtPrinter(nome='Test RT1', ip='10.0.0.1')
            db.add(printer)
            db.flush()
            db.add(Hotel(code='DPH', name='Test Du Parc', default_rooms=10, rt_printer_id=printer.id))
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def pulisci_riga_test(TestSession):
    """Rimuove la riga di test da rt_chiusure prima e dopo ogni test."""
    def _pulisci():
        db = TestSession()
        try:
            db.query(RtChiusura).filter(
                RtChiusura.data_chiusura == DATA_TEST,
                RtChiusura.rt_code == RT_CODE_TEST,
            ).delete()
            db.commit()
        finally:
            db.close()
    _pulisci()
    yield
    _pulisci()


def _token(ruolo: str) -> str:
    username = 'test_admin_rtxml' if ruolo == 'admin' else 'test_viewer_rtxml'
    return crea_token_accesso(username, ruolo)


def _headers(ruolo: str) -> dict:
    return {"Authorization": f"Bearer {_token(ruolo)}"}


def _file_xml():
    with open(FIXTURE_PATH, 'rb') as f:
        return {'file': ('99MEX036593-20260630T210045-0944-CORRISP.xml', f.read(), 'text/xml')}


class TestImportXmlInserisce:
    def test_inserisce_nuova_riga(self, client, setup_db):
        resp = client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": RT_CODE_TEST, "on_conflict": "salta"},
            files=_file_xml(),
            headers=_headers("admin"),
        )
        assert resp.status_code == 200
        dati = resp.json()
        assert dati["esito"] == "inserito"
        assert dati["data_chiusura"] == DATA_TEST
        assert dati["rt_code"] == RT_CODE_TEST
        assert dati["totale_giorno"] == pytest.approx(1955.28)
        assert dati["progressivo"] == 944


class TestImportXmlSaltaSeEsiste:
    def test_seconda_importazione_salta(self, client, setup_db):
        # prima importazione
        client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": RT_CODE_TEST, "on_conflict": "salta"},
            files=_file_xml(),
            headers=_headers("admin"),
        )
        # seconda importazione, stesso file
        resp = client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": RT_CODE_TEST, "on_conflict": "salta"},
            files=_file_xml(),
            headers=_headers("admin"),
        )
        assert resp.status_code == 200
        dati = resp.json()
        assert dati["esito"] == "saltato"
        assert dati["warning"]


class TestImportXmlAggiorna:
    def test_aggiorna_riga_non_modificata(self, client, setup_db, TestSession):
        client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": RT_CODE_TEST, "on_conflict": "salta"},
            files=_file_xml(),
            headers=_headers("admin"),
        )
        resp = client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": RT_CODE_TEST, "on_conflict": "aggiorna"},
            files=_file_xml(),
            headers=_headers("admin"),
        )
        assert resp.status_code == 200
        assert resp.json()["esito"] == "aggiornato"

        db = TestSession()
        try:
            riga = db.query(RtChiusura).filter(
                RtChiusura.data_chiusura == DATA_TEST,
                RtChiusura.rt_code == RT_CODE_TEST,
            ).first()
            assert riga is not None
            assert float(riga.esente_n1) == pytest.approx(46.01)
        finally:
            db.close()


class TestImportXmlProteggeModificatoManualmente:
    def test_non_sovrascrive_riga_modificata_a_mano(self, client, setup_db, TestSession):
        # inserisce e poi marca come modificata manualmente con un valore riconoscibile
        client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": RT_CODE_TEST, "on_conflict": "salta"},
            files=_file_xml(),
            headers=_headers("admin"),
        )
        db = TestSession()
        try:
            riga = db.query(RtChiusura).filter(
                RtChiusura.data_chiusura == DATA_TEST,
                RtChiusura.rt_code == RT_CODE_TEST,
            ).first()
            riga.modificato_manualmente = True
            riga.totale_giorno = 999.99
            db.commit()
        finally:
            db.close()

        resp = client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": RT_CODE_TEST, "on_conflict": "aggiorna"},
            files=_file_xml(),
            headers=_headers("admin"),
        )
        assert resp.status_code == 200
        assert resp.json()["esito"] == "saltato"

        db = TestSession()
        try:
            riga = db.query(RtChiusura).filter(
                RtChiusura.data_chiusura == DATA_TEST,
                RtChiusura.rt_code == RT_CODE_TEST,
            ).first()
            assert float(riga.totale_giorno) == pytest.approx(999.99)
        finally:
            db.close()


class TestImportXmlPermessi:
    def test_viewer_non_puo_importare(self, client, setup_db):
        resp = client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": RT_CODE_TEST, "on_conflict": "salta"},
            files=_file_xml(),
            headers=_headers("viewer"),
        )
        assert resp.status_code == 403

    def test_rt_code_non_valido(self, client, setup_db):
        resp = client.post(
            "/corrispettivi/rt-chiusure/import-xml",
            params={"rt_code": "RT9", "on_conflict": "salta"},
            files=_file_xml(),
            headers=_headers("admin"),
        )
        assert resp.status_code == 400


ELENCO_CARTELLA_HTML = (
    '<html><body><table>'
    '<tr><td><a href="99MEX036593-20260630T210045-0944-CORRISP.xml">...</a></td></tr>'
    '<tr><td><a href="99MEX036593-20260630T210045-0944-ESITO-123.xml">...</a></td></tr>'
    '<tr><td><a href="99MEX036593-20260630T210045-0944-ZREPORT.txt">...</a></td></tr>'
    '</table></body></html>'
)


class TestImportDaStampante:
    """_get_raw_http è mockata: verifica la logica del backend (ricerca file, parsing, upsert),
    non la reale raggiungibilità della stampante (non testabile in questo ambiente)."""

    def test_importa_con_successo(self, client, setup_db):
        with open(FIXTURE_PATH, 'rb') as f:
            contenuto_xml = f.read()

        def _side_effect(ip, path):
            if path.endswith('/'):
                return 200, ELENCO_CARTELLA_HTML.encode('utf-8')
            return 200, contenuto_xml

        with patch('app.routers.corrispettivi._get_raw_http', side_effect=_side_effect):
            resp = client.post(
                "/corrispettivi/rt-chiusure/import-da-stampante",
                json={"rt_code": RT_CODE_TEST, "data": DATA_TEST, "on_conflict": "salta"},
                headers=_headers("admin"),
            )
        assert resp.status_code == 200
        dati = resp.json()
        assert dati["esito"] == "inserito"
        assert dati["nome_file"] == "99MEX036593-20260630T210045-0944-CORRISP.xml"
        assert dati["totale_giorno"] == pytest.approx(1955.28)

    def test_nessun_file_corrisp_in_cartella(self, client, setup_db):
        html_senza_corrisp = '<html><body><a href="99MEX036593-20260630T210045-0944-ZREPORT.txt">a</a></body></html>'
        with patch('app.routers.corrispettivi._get_raw_http', return_value=(200, html_senza_corrisp.encode('utf-8'))):
            resp = client.post(
                "/corrispettivi/rt-chiusure/import-da-stampante",
                json={"rt_code": RT_CODE_TEST, "data": DATA_TEST, "on_conflict": "salta"},
                headers=_headers("admin"),
            )
        assert resp.status_code == 404

    def test_cartella_non_trovata(self, client, setup_db):
        with patch('app.routers.corrispettivi._get_raw_http', return_value=(404, b'')):
            resp = client.post(
                "/corrispettivi/rt-chiusure/import-da-stampante",
                json={"rt_code": RT_CODE_TEST, "data": DATA_TEST, "on_conflict": "salta"},
                headers=_headers("admin"),
            )
        assert resp.status_code == 404

    def test_data_non_valida(self, client, setup_db):
        resp = client.post(
            "/corrispettivi/rt-chiusure/import-da-stampante",
            json={"rt_code": RT_CODE_TEST, "data": "30-06-2026", "on_conflict": "salta"},
            headers=_headers("admin"),
        )
        assert resp.status_code == 400

    def test_viewer_non_puo_importare(self, client, setup_db):
        resp = client.post(
            "/corrispettivi/rt-chiusure/import-da-stampante",
            json={"rt_code": RT_CODE_TEST, "data": DATA_TEST, "on_conflict": "salta"},
            headers=_headers("viewer"),
        )
        assert resp.status_code == 403


class TestGetRawHttp:
    """Riproduce, con un server TCP locale, la risposta malformata reale della stampante
    (Transfer-Encoding: chunked duplicato, corpo in realtà non chunked) verificando che
    _get_raw_http() la legga correttamente ignorando l'intestazione."""

    def test_gestisce_transfer_encoding_duplicato(self):
        import threading
        from app.routers.corrispettivi import _get_raw_http

        corpo_atteso = b'<html><body>ciao</body></html>'
        risposta_malformata = (
            b"HTTP/1.1 200 OK\r\n"
            b"Transfer-Encoding: chunked\r\n"
            b"Content-Type: text/html; charset=utf-8\r\n"
            b"Transfer-Encoding: chunked\r\n"
            b"\r\n" + corpo_atteso
        )

        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(('127.0.0.1', 0))
        server.listen(1)
        porta = server.getsockname()[1]

        def _servi():
            conn, _ = server.accept()
            conn.recv(4096)
            conn.sendall(risposta_malformata)
            conn.close()

        t = threading.Thread(target=_servi, daemon=True)
        t.start()
        try:
            status, corpo = _get_raw_http('127.0.0.1', '/qualsiasi', timeout=3.0, port=porta)
        finally:
            server.close()
            t.join(timeout=3.0)

        assert status == 200
        assert corpo == corpo_atteso
