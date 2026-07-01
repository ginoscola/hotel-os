"""
Test per l'import CORRISP.xml in rt_chiusure:
- Inserisce una nuova riga da un file XML valido
- on_conflict=salta non tocca una riga già presente
- on_conflict=aggiorna aggiorna una riga esistente non modificata a mano
- Una riga con modificato_manualmente=True non viene mai sovrascritta
- Solo admin può importare (viewer riceve 403)
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import hash_password, crea_token_accesso
from app.database import Base, get_db
from app.main import app
from app.models.revenue import User  # noqa: F401
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
        assert dati["totale_giorno"] == pytest.approx(1955.10)
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
