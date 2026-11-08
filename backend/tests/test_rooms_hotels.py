"""Anagrafica camere (/rooms) e hotel (PUT /hotels/{code}) usate da Admin → Hotel e camere (v4.31.0).

Utenti e camere sintetici, DB di test. Le scritture sono solo per admin: verificato con token
veri (utenti admin e viewer creati nel DB di test), non con override delle dipendenze.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.auth import crea_token_accesso, hash_password
from app.database import Base, get_db
from app.main import app
from app.models.revenue import Hotel, User  # noqa: F401 — per Base.metadata
from app.models.rooms import Room

from tests._db import TEST_DB_URL  # noqa: E402


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
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def dati(test_engine):
    with test_engine.connect() as conn:
        conn.execute(text("TRUNCATE rooms, hotel_seasons, hotels RESTART IDENTITY CASCADE"))
        conn.execute(text("DELETE FROM users WHERE username IN ('camere_admin', 'camere_viewer')"))
        conn.execute(text("""
            INSERT INTO hotels (code, name, default_rooms) VALUES
            ('DPH', 'Hotel Du Parc', 43), ('CLB', 'Club Hotel', 45), ('INT', 'Hotel International', 45)
        """))
        conn.execute(text("""
            INSERT INTO rooms (code, hotel_id, struttura_code, nome_tipo, piano, attiva)
            SELECT 'D101', id, 'DPH', 'classic', 1, true FROM hotels WHERE code='DPH'
            UNION ALL SELECT 'D102', id, 'DPH', 'comfort', 1, true FROM hotels WHERE code='DPH'
            UNION ALL SELECT 'OVER1', id, 'DPH', 'over', NULL, false FROM hotels WHERE code='DPH'
            UNION ALL SELECT 'C201', id, 'CLB', 'doppia', 2, true FROM hotels WHERE code='CLB'
        """))
        conn.commit()
    s = sessionmaker(bind=test_engine)()
    for username, ruolo in [('camere_admin', 'admin'), ('camere_viewer', 'viewer')]:
        s.add(User(username=username, password_hash=hash_password('x'), ruolo=ruolo, attivo=True))
    s.commit()
    s.close()
    yield
    # Non lasciare hotel/camere/utenti nel DB di test: altri file creano i propri hotel solo
    # "se non esistono" (es. test_rt_chiusure_import, DPH con stampante RT).
    with test_engine.connect() as conn:
        conn.execute(text("TRUNCATE rooms, hotel_seasons, hotels RESTART IDENTITY CASCADE"))
        conn.execute(text("DELETE FROM users WHERE username IN ('camere_admin', 'camere_viewer')"))
        conn.commit()


def _h(ruolo):
    return {"Authorization": f"Bearer {crea_token_accesso('camere_' + ruolo, ruolo)}"}


# ---------------------------------------------------------------------------
# Camere
# ---------------------------------------------------------------------------

def test_lista_camere_e_filtri(client):
    tutte = client.get("/rooms/", headers=_h("viewer")).json()
    assert {c["code"] for c in tutte} == {"D101", "D102", "OVER1", "C201"}
    dph = client.get("/rooms/?struttura_code=dph", headers=_h("viewer")).json()
    assert {c["code"] for c in dph} == {"D101", "D102", "OVER1"}
    attive = client.get("/rooms/?struttura_code=DPH&attiva=true", headers=_h("viewer")).json()
    assert {c["code"] for c in attive} == {"D101", "D102"}


def test_crea_camera(client, TestSession):
    r = client.post("/rooms/", headers=_h("admin"), json={
        "code": " d103 ", "struttura_code": "dph", "nome_tipo": "smart", "posti_letto": 2, "piano": 1,
    })
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["code"] == "D103" and j["struttura_code"] == "DPH" and j["attiva"] is True
    with TestSession() as db:
        room = db.query(Room).filter(Room.code == "D103").one()
        assert room.hotel_id == db.query(Hotel).filter(Hotel.code == "DPH").one().id


def test_codice_doppione_rifiutato(client):
    r = client.post("/rooms/", headers=_h("admin"), json={"code": "d101", "struttura_code": "DPH"})
    assert r.status_code == 409


def test_struttura_inesistente_rifiutata(client):
    r = client.post("/rooms/", headers=_h("admin"), json={"code": "X1", "struttura_code": "XXX"})
    assert r.status_code == 400


def test_valori_non_validi_rifiutati(client):
    assert client.post("/rooms/", headers=_h("admin"), json={"code": "", "struttura_code": "DPH"}).status_code == 422
    assert client.put("/rooms/D101", headers=_h("admin"), json={"posti_letto": -1}).status_code == 422


def test_modifica_e_disattiva_camera(client):
    r = client.put("/rooms/d101", headers=_h("admin"), json={"posti_letto": 3, "attiva": False, "note": "lavori"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["posti_letto"], j["attiva"], j["note"], j["nome_tipo"]) == (3, False, "lavori", "classic")


def test_codice_e_struttura_non_modificabili(client):
    """La struttura decide l'hotel degli addebiti importati: la PUT la ignora."""
    r = client.put("/rooms/C201", headers=_h("admin"), json={"struttura_code": "DPH", "code": "D999"})
    assert r.status_code == 200
    assert (r.json()["code"], r.json()["struttura_code"]) == ("C201", "CLB")


def test_camera_inesistente_404(client):
    assert client.put("/rooms/ZZZ", headers=_h("admin"), json={"note": "x"}).status_code == 404


def test_viewer_non_puo_scrivere_camere(client):
    assert client.post("/rooms/", headers=_h("viewer"), json={"code": "D104", "struttura_code": "DPH"}).status_code == 403
    assert client.put("/rooms/D101", headers=_h("viewer"), json={"note": "x"}).status_code == 403


def test_senza_accesso_401(client):
    assert client.get("/rooms/").status_code in (401, 403)


# ---------------------------------------------------------------------------
# Hotel
# ---------------------------------------------------------------------------

def test_modifica_hotel(client):
    r = client.put("/hotels/dph", headers=_h("admin"), json={"name": "Hotel Du Parc Riccione", "default_rooms": 44})
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["default_rooms"]) == ("Hotel Du Parc Riccione", 44)


def test_hotel_valori_non_validi(client):
    assert client.put("/hotels/DPH", headers=_h("admin"), json={"default_rooms": 0}).status_code == 422
    assert client.put("/hotels/DPH", headers=_h("admin"), json={"name": ""}).status_code == 422


def test_viewer_non_puo_modificare_hotel(client):
    assert client.put("/hotels/DPH", headers=_h("viewer"), json={"default_rooms": 40}).status_code == 403
