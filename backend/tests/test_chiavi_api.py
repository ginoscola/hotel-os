"""
Test delle chiavi API per agenti AI (header X-API-Key): creazione/revoca da admin,
sola lettura, mai valide sugli endpoint admin, chiavi revocate/scadute/utente disattivato.
Dati sintetici; nessun override di richiedi_admin/richiedi_utente_attivo: si prova l'autenticazione vera.
"""

import os
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import crea_token_accesso, hash_password
from app.database import Base, get_db
from app.main import app
from app.models.revenue import ApiKey, User  # noqa: F401 — per Base.metadata

from tests._db import TEST_DB_URL  # noqa: E402


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
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

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def pulisci(test_engine):
    def svuota():
        with test_engine.connect() as conn:
            conn.execute(text("DELETE FROM api_keys"))
            conn.execute(text("DELETE FROM users"))
            conn.commit()
    svuota()
    yield
    svuota()


def _crea_utente(engine, username, ruolo, attivo=True):
    with engine.connect() as conn:
        uid = conn.execute(text("""
            INSERT INTO users (username, password_hash, ruolo, attivo)
            VALUES (:u, :pw, :r, :a) RETURNING id
        """), {"u": username, "pw": hash_password("password-test"), "r": ruolo, "a": attivo}).scalar()
        conn.commit()
    return uid


@pytest.fixture
def admin_headers(test_engine):
    _crea_utente(test_engine, "test-admin", "admin")
    return {"Authorization": f"Bearer {crea_token_accesso('test-admin', 'admin')}"}


@pytest.fixture
def agente_id(test_engine):
    return _crea_utente(test_engine, "test-agente", "viewer")


@pytest.fixture
def chiave(client, admin_headers, agente_id):
    r = client.post("/admin/chiavi-api", json={"user_id": agente_id, "nome": "Bot di prova"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()


def _h(chiave_testo):
    return {"X-API-Key": chiave_testo}


def test_creazione_restituisce_chiave_una_volta(client, admin_headers, chiave):
    assert chiave["chiave"].startswith("hos_")
    assert chiave["chiave"].startswith(chiave["prefisso"])
    elenco = client.get("/admin/chiavi-api", headers=admin_headers).json()
    assert len(elenco) == 1
    assert "chiave" not in elenco[0] and "hash_chiave" not in elenco[0]
    assert elenco[0]["username"] == "test-agente"


def test_chiave_valida_legge_e_registra_ultimo_uso(client, admin_headers, chiave):
    assert client.get("/hotels/", headers=_h(chiave["chiave"])).status_code == 200
    me = client.get("/auth/me", headers=_h(chiave["chiave"]))
    assert me.status_code == 200 and me.json()["username"] == "test-agente"
    elenco = client.get("/admin/chiavi-api", headers=admin_headers).json()
    assert elenco[0]["ultimo_uso"] is not None


def test_chiave_mai_valida_su_endpoint_admin(client, chiave):
    assert client.get("/admin/utenti", headers=_h(chiave["chiave"])).status_code == 403


def test_chiave_in_sola_lettura(client, chiave, agente_id):
    r = client.post("/admin/chiavi-api", json={"user_id": agente_id, "nome": "x"}, headers=_h(chiave["chiave"]))
    assert r.status_code == 403
    assert "sola lettura" in r.json()["detail"]


def test_chiave_sbagliata_o_assente(client, chiave):
    assert client.get("/hotels/", headers=_h("hos_inventata")).status_code == 401
    assert client.get("/hotels/").status_code == 401


def test_chiave_revocata(client, admin_headers, chiave):
    r = client.post(f"/admin/chiavi-api/{chiave['id']}/revoca", headers=admin_headers)
    assert r.status_code == 200 and r.json()["attiva"] is False
    assert client.get("/hotels/", headers=_h(chiave["chiave"])).status_code == 401


def test_chiave_scaduta(client, test_engine, chiave):
    with test_engine.connect() as conn:
        conn.execute(text("UPDATE api_keys SET scade_il = :d"), {"d": date.today() - timedelta(days=1)})
        conn.commit()
    assert client.get("/hotels/", headers=_h(chiave["chiave"])).status_code == 401


def test_chiave_valida_fino_al_giorno_di_scadenza(client, test_engine, chiave):
    with test_engine.connect() as conn:
        conn.execute(text("UPDATE api_keys SET scade_il = :d"), {"d": date.today()})
        conn.commit()
    assert client.get("/hotels/", headers=_h(chiave["chiave"])).status_code == 200


def test_utente_disattivato_blocca_la_chiave(client, test_engine, chiave):
    with test_engine.connect() as conn:
        conn.execute(text("UPDATE users SET attivo = false WHERE username = 'test-agente'"))
        conn.commit()
    assert client.get("/hotels/", headers=_h(chiave["chiave"])).status_code == 401


def test_niente_chiavi_per_utenti_admin(client, test_engine, admin_headers):
    admin2 = _crea_utente(test_engine, "test-admin-2", "admin")
    r = client.post("/admin/chiavi-api", json={"user_id": admin2, "nome": "x"}, headers=admin_headers)
    assert r.status_code == 400


def test_scadenza_nel_passato_rifiutata(client, admin_headers, agente_id):
    ieri = (date.today() - timedelta(days=1)).isoformat()
    r = client.post("/admin/chiavi-api", json={"user_id": agente_id, "nome": "x", "scade_il": ieri},
                    headers=admin_headers)
    assert r.status_code == 400


def test_gestione_chiavi_solo_admin(client, test_engine, agente_id):
    viewer = {"Authorization": f"Bearer {crea_token_accesso('test-agente', 'viewer')}"}
    assert client.get("/admin/chiavi-api", headers=viewer).status_code == 403
