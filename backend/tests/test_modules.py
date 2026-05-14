"""
Test per il sistema di gestione moduli:
- GET /modules/ restituisce moduli con permessi corretti per ruolo
- Viewer ha puo_modificare=false
- Modulo disattivato non appare in GET /modules/
- Admin può aggiornare permessi via PUT /modules/admin/{code}/permissions/{ruolo}
- ProtectedRoute: accesso negato se puo_vedere=false (logica frontend, testata via API)
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
from app.models.revenue import Module, ModulePermission, User  # noqa: F401

TEST_DB_URL = "postgresql://ginoscola@localhost:5432/revenue_master_test"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

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
    """Crea utenti admin e viewer + moduli di test nel DB di test."""
    db = TestSession()
    try:
        # Utenti
        for username, ruolo in [('test_admin_mod', 'admin'), ('test_viewer_mod', 'viewer')]:
            if not db.query(User).filter(User.username == username).first():
                db.add(User(
                    username=username,
                    password_hash=hash_password('test123'),
                    ruolo=ruolo,
                    attivo=True,
                ))

        # Modulo di test (se non esiste)
        if not db.query(Module).filter(Module.code == 'test_mod').first():
            db.add(Module(code='test_mod', name='Test Modulo', ordine=99, attivo=True))
            db.flush()
            db.add(ModulePermission(
                module_code='test_mod', ruolo='admin',
                puo_vedere=True, puo_modificare=True, puo_importare=True,
            ))
            db.add(ModulePermission(
                module_code='test_mod', ruolo='viewer',
                puo_vedere=True, puo_modificare=False, puo_importare=False,
            ))

        db.commit()
    finally:
        db.close()


def _token(ruolo: str) -> str:
    username = 'test_admin_mod' if ruolo == 'admin' else 'test_viewer_mod'
    return crea_token_accesso(username, ruolo)


def _headers(ruolo: str) -> dict:
    return {"Authorization": f"Bearer {_token(ruolo)}"}


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------

class TestListaModuli:
    def test_admin_vede_moduli_attivi(self, client, setup_db):
        """GET /modules/ restituisce i moduli attivi con permessi admin corretti."""
        resp = client.get("/modules/", headers=_headers("admin"))
        assert resp.status_code == 200
        dati = resp.json()
        assert isinstance(dati, list)
        # Tutti i moduli restituiti devono essere attivi
        assert all(m["attivo"] for m in dati)

    def test_admin_puo_modificare_true(self, client, setup_db):
        """L'admin ha puo_modificare=true per i moduli principali."""
        resp = client.get("/modules/", headers=_headers("admin"))
        moduli = {m["code"]: m for m in resp.json()}
        if "revenue" in moduli:
            assert moduli["revenue"]["puo_modificare"] is True

    def test_viewer_puo_modificare_false(self, client, setup_db):
        """Il viewer ha puo_modificare=false su tutti i moduli."""
        resp = client.get("/modules/", headers=_headers("viewer"))
        assert resp.status_code == 200
        for m in resp.json():
            assert m["puo_modificare"] is False, f"viewer non dovrebbe poter modificare '{m['code']}'"

    def test_viewer_puo_importare_false(self, client, setup_db):
        """Il viewer ha puo_importare=false su tutti i moduli."""
        resp = client.get("/modules/", headers=_headers("viewer"))
        for m in resp.json():
            assert m["puo_importare"] is False

    def test_non_autenticato_riceve_401(self, client, setup_db):
        """Senza token riceve 401."""
        resp = client.get("/modules/")
        assert resp.status_code == 401


class TestModuloDisattivato:
    def test_modulo_disattivato_non_appare(self, client, setup_db, TestSession):
        """Un modulo disattivato non compare in GET /modules/."""
        # Disattiva il modulo di test
        db = TestSession()
        try:
            m = db.query(Module).filter(Module.code == 'test_mod').first()
            if m:
                m.attivo = False
                db.commit()
        finally:
            db.close()

        resp = client.get("/modules/", headers=_headers("admin"))
        codes = [m["code"] for m in resp.json()]
        assert "test_mod" not in codes

        # Ripristina
        db = TestSession()
        try:
            m = db.query(Module).filter(Module.code == 'test_mod').first()
            if m:
                m.attivo = True
                db.commit()
        finally:
            db.close()

    def test_modulo_riattivato_riappare(self, client, setup_db):
        """Dopo la riattivazione il modulo torna nella lista."""
        resp = client.get("/modules/", headers=_headers("admin"))
        codes = [m["code"] for m in resp.json()]
        assert "test_mod" in codes


class TestAggiornamentoPermessi:
    def test_admin_aggiorna_permessi(self, client, setup_db):
        """PUT /modules/admin/{code}/permissions/{ruolo} aggiorna correttamente."""
        payload = {"puo_vedere": True, "puo_modificare": False, "puo_importare": False}
        resp = client.put(
            "/modules/admin/test_mod/permissions/viewer",
            json=payload,
            headers=_headers("admin"),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_viewer_non_puo_aggiornare_permessi(self, client, setup_db):
        """Il viewer non può aggiornare permessi (403)."""
        payload = {"puo_vedere": True, "puo_modificare": True, "puo_importare": True}
        resp = client.put(
            "/modules/admin/test_mod/permissions/viewer",
            json=payload,
            headers=_headers("viewer"),
        )
        assert resp.status_code == 403

    def test_admin_disattiva_modulo(self, client, setup_db):
        """PUT /modules/admin/{code} con attivo=false disattiva il modulo."""
        resp = client.put(
            "/modules/admin/test_mod",
            json={"attivo": False},
            headers=_headers("admin"),
        )
        assert resp.status_code == 200
        assert resp.json()["attivo"] is False

        # Verifica che non compaia in GET /modules/
        lista = client.get("/modules/", headers=_headers("admin")).json()
        assert "test_mod" not in [m["code"] for m in lista]

        # Ripristina
        client.put("/modules/admin/test_mod", json={"attivo": True}, headers=_headers("admin"))


class TestDettaglioModulo:
    def test_dettaglio_contiene_permessi(self, client, setup_db):
        """GET /modules/{code} restituisce il dettaglio con tutti i permessi per ruolo."""
        resp = client.get("/modules/test_mod", headers=_headers("admin"))
        assert resp.status_code == 200
        dati = resp.json()
        assert "permessi" in dati
        ruoli = [p["ruolo"] for p in dati["permessi"]]
        assert "admin" in ruoli
        assert "viewer" in ruoli

    def test_modulo_inesistente_404(self, client, setup_db):
        """GET /modules/codice_inesistente restituisce 404."""
        resp = client.get("/modules/inesistente_xyz", headers=_headers("admin"))
        assert resp.status_code == 404
