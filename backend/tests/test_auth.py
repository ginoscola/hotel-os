"""
Test per il sistema di autenticazione JWT:
login, protezione endpoint, ruoli admin/viewer, gestione utenti.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import hash_password, crea_token_accesso
from app.database import Base, get_db
from app.main import app
from app.models.revenue import User  # noqa: F401 — per Base.metadata

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
    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulisci_utenti(test_engine):
    """Svuota la tabella users prima di ogni test."""
    with test_engine.connect() as conn:
        conn.execute(text("DELETE FROM users"))
        conn.commit()
    yield
    with test_engine.connect() as conn:
        conn.execute(text("DELETE FROM users"))
        conn.commit()


@pytest.fixture
def utente_admin(test_engine):
    """Inserisce un utente admin di test nel DB."""
    with test_engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO users (username, email, password_hash, ruolo, attivo)
            VALUES ('testadmin', 'admin@test.it', :pw, 'admin', true)
        """), {"pw": hash_password("admin2024")})
        conn.commit()
    return {"username": "testadmin", "password": "admin2024", "ruolo": "admin"}


@pytest.fixture
def utente_viewer(test_engine):
    """Inserisce un utente viewer di test nel DB."""
    with test_engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO users (username, email, password_hash, ruolo, attivo)
            VALUES ('testviewer', 'viewer@test.it', :pw, 'viewer', true)
        """), {"pw": hash_password("viewer2024")})
        conn.commit()
    return {"username": "testviewer", "password": "viewer2024", "ruolo": "viewer"}


def _login(client, username, password):
    """Helper: esegue il login via form e restituisce la risposta."""
    return client.post(
        "/auth/login",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


def _token_diretto(username, ruolo):
    """Genera un token JWT direttamente (bypassa il rate limiter nei test)."""
    return crea_token_accesso(username, ruolo)


def _header_admin(utente_admin):
    """Restituisce gli header Authorization per l'utente admin."""
    return {"Authorization": f"Bearer {_token_diretto(utente_admin['username'], 'admin')}"}


def _header_viewer(utente_viewer):
    """Restituisce gli header Authorization per l'utente viewer."""
    return {"Authorization": f"Bearer {_token_diretto(utente_viewer['username'], 'viewer')}"}


# ---------------------------------------------------------------------------
# Test: POST /auth/login
# ---------------------------------------------------------------------------

def test_login_credenziali_corrette(client, utente_admin):
    """Login con credenziali valide restituisce token e metadati."""
    resp = _login(client, utente_admin["username"], utente_admin["password"])
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["username"] == utente_admin["username"]
    assert body["ruolo"] == "admin"
    assert len(body["access_token"]) > 20


def test_login_password_errata(client, utente_admin):
    """Login con password sbagliata restituisce 401."""
    resp = _login(client, utente_admin["username"], "wrongpassword")
    assert resp.status_code == 401
    assert "Credenziali errate" in resp.json()["detail"]


def test_login_username_inesistente(client):
    """Login con username che non esiste restituisce 401."""
    resp = _login(client, "nonexistent_user_xyz", "qualsiasipwd")
    assert resp.status_code == 401


def test_login_utente_disattivo(client, test_engine):
    """Login con utente disattivato restituisce 401."""
    with test_engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO users (username, password_hash, ruolo, attivo)
            VALUES ('disattivato', :pw, 'viewer', false)
        """), {"pw": hash_password("pwd123")})
        conn.commit()

    resp = _login(client, "disattivato", "pwd123")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Test: GET /auth/me
# ---------------------------------------------------------------------------

def test_auth_me_con_token_valido(client, utente_admin):
    """GET /auth/me con token valido restituisce i dati dell'utente."""
    headers = _header_admin(utente_admin)
    resp = client.get("/auth/me", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == utente_admin["username"]
    assert body["ruolo"] == "admin"
    assert "password_hash" not in body


def test_auth_me_senza_token(client):
    """GET /auth/me senza token restituisce 403 (HTTPBearer rifiuta)."""
    resp = client.get("/auth/me")
    assert resp.status_code in (401, 403)


def test_auth_me_token_invalido(client):
    """GET /auth/me con token malformato restituisce 401/403."""
    resp = client.get("/auth/me", headers={"Authorization": "Bearer tokenfalso"})
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Test: accesso endpoint protetti
# ---------------------------------------------------------------------------

def test_endpoint_protetto_senza_token_restituisce_401_o_403(client):
    """Un endpoint con richiedi_utente_attivo rifiuta richieste senza token."""
    resp = client.get("/hotels/")
    assert resp.status_code in (401, 403)


def test_endpoint_viewer_accessibile_con_token_viewer(client, utente_viewer):
    """Un viewer può accedere agli endpoint di sola lettura."""
    headers = _header_viewer(utente_viewer)
    resp = client.get("/hotels/", headers=headers)
    # 200 o 404 (se db vuoto) — comunque non 401/403
    assert resp.status_code not in (401, 403)


def test_endpoint_admin_rifiuta_viewer(client, utente_viewer):
    """Un endpoint richiedi_admin restituisce 403 se chiamato da un viewer."""
    headers = _header_viewer(utente_viewer)
    resp = client.get("/admin/test-stats", headers=headers)
    assert resp.status_code == 403
    assert "amministratori" in resp.json()["detail"].lower()


def test_endpoint_admin_accessibile_con_token_admin(client, utente_admin):
    """Un admin può accedere agli endpoint richiedi_admin."""
    headers = _header_admin(utente_admin)
    resp = client.get("/admin/test-stats", headers=headers)
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Test: GET/POST /admin/utenti
# ---------------------------------------------------------------------------

def test_lista_utenti_restituisce_lista(client, utente_admin, utente_viewer):
    """GET /admin/utenti restituisce la lista senza password_hash."""
    headers = _header_admin(utente_admin)
    resp = client.get("/admin/utenti", headers=headers)
    assert resp.status_code == 200
    utenti = resp.json()
    assert isinstance(utenti, list)
    assert len(utenti) >= 1
    for u in utenti:
        assert "password_hash" not in u
        assert "username" in u
        assert "ruolo" in u


def test_crea_nuovo_utente_da_admin(client, utente_admin):
    """Un admin può creare un nuovo utente viewer."""
    headers = _header_admin(utente_admin)
    resp = client.post(
        "/admin/utenti",
        json={"username": "nuovoutente", "email": "nuovo@test.it", "password": "pwd123", "ruolo": "viewer"},
        headers=headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["username"] == "nuovoutente"
    assert body["ruolo"] == "viewer"
    assert "password_hash" not in body


def test_crea_utente_username_duplicato(client, utente_admin):
    """Creare un utente con username già esistente restituisce 409."""
    headers = _header_admin(utente_admin)
    client.post(
        "/admin/utenti",
        json={"username": "duplicato", "password": "pwd123", "ruolo": "viewer"},
        headers=headers,
    )
    resp = client.post(
        "/admin/utenti",
        json={"username": "duplicato", "password": "altrapwd", "ruolo": "viewer"},
        headers=headers,
    )
    assert resp.status_code == 409


def test_viewer_non_puo_creare_utenti(client, utente_admin, utente_viewer):
    """Un viewer non può accedere a POST /admin/utenti."""
    headers_viewer = _header_viewer(utente_viewer)
    resp = client.post(
        "/admin/utenti",
        json={"username": "tentativo", "password": "pwd123", "ruolo": "viewer"},
        headers=headers_viewer,
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test: PUT /admin/utenti/{id} — disattivazione
# ---------------------------------------------------------------------------

def test_disattiva_utente(client, utente_admin):
    """Un admin può disattivare un utente viewer."""
    headers = _header_admin(utente_admin)
    resp_crea = client.post(
        "/admin/utenti",
        json={"username": "dadeactivate", "password": "pwd123", "ruolo": "viewer"},
        headers=headers,
    )
    user_id = resp_crea.json()["id"]

    resp = client.put(
        f"/admin/utenti/{user_id}",
        json={"attivo": False},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["attivo"] is False


def test_non_si_puo_disattivare_ultimo_admin(client, utente_admin):
    """Disattivare l'unico admin rimasto restituisce 400."""
    headers = _header_admin(utente_admin)
    lista = client.get("/admin/utenti", headers=headers).json()
    admin_id = next(u["id"] for u in lista if u["username"] == utente_admin["username"])

    resp = client.put(
        f"/admin/utenti/{admin_id}",
        json={"attivo": False},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "ultimo" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Test: POST /admin/utenti/{id}/reset-password
# ---------------------------------------------------------------------------

def test_reset_password_funziona(client, utente_admin, test_engine):
    """Un admin può reimpostare la password di un altro utente e il nuovo login funziona."""
    headers = _header_admin(utente_admin)
    resp_crea = client.post(
        "/admin/utenti",
        json={"username": "pwdresetuser", "password": "vecchiapwd", "ruolo": "viewer"},
        headers=headers,
    )
    user_id = resp_crea.json()["id"]

    resp = client.post(
        f"/admin/utenti/{user_id}/reset-password",
        json={"password": "nuovapwd123"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert "aggiornata" in resp.json()["messaggio"].lower()

    # Verifica che il nuovo login funzioni
    resp_login = _login(client, "pwdresetuser", "nuovapwd123")
    assert resp_login.status_code == 200


# ---------------------------------------------------------------------------
# Test: POST /auth/logout
# ---------------------------------------------------------------------------

def test_logout_restituisce_messaggio(client, utente_admin):
    """POST /auth/logout restituisce messaggio di conferma."""
    headers = _header_admin(utente_admin)
    resp = client.post("/auth/logout", headers=headers)
    assert resp.status_code == 200
    assert "logout" in resp.json()["message"].lower()
