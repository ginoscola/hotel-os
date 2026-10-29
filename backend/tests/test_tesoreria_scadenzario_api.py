"""Test integrazione Tesoreria Fase 2, blocco B: import a fotografie dello scadenzario fornitori Passcom
(anteprima/conferma, riepilogo per fornitore al netto dei pareggi, residui, confronto con la fotografia
precedente, sostituzione dello stesso giorno, storico, file, eliminazione, permessi) e calcoli puri.

Fixture finta tests/fixtures/tesoreria/scadenzario_da_pagare.xml. DB dedicato, file in cartella temporanea.
"""
import os
import sys
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app.auth import richiedi_admin, richiedi_utente_attivo  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services.tesoreria_passcom_parser import parse_scadenzario  # noqa: E402
from app.services.tesoreria_scadenzario import (  # noqa: E402
    anno_contabile, confronta, e_residuo, per_fornitore, riepilogo, unisci_fotografia,
)

from tests._db import TEST_DB_URL  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "tesoreria", "scadenzario_da_pagare.xml")
with open(FIXTURE, "rb") as _f:
    SCAD = _f.read()
# Fotografia successiva: stampa al 31/10, la bolletta da 25,47 diventa 30,00 (una chiusa + una nuova)
SCAD_31 = (SCAD.replace(b">15/10/2026<", b">31/10/2026<").replace(b">25.47<", b">30.00<")
           .replace(b">228.36<", b">232.89<"))
# Stesso giorno, file riscaricato (contenuto diverso → impronta diversa)
SCAD_BIS = SCAD + b"\n"

ADMIN = SimpleNamespace(id=None, ruolo="admin")
VIEWER = SimpleNamespace(id=None, ruolo="viewer")
utente_corrente = {"u": ADMIN}


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def client(test_engine, tmp_path_factory):
    os.environ["TESORERIA_DIR"] = str(tmp_path_factory.mktemp("tesoreria"))
    Sessione = sessionmaker(bind=test_engine)

    def override_get_db():
        db = Sessione()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[richiedi_utente_attivo] = lambda: utente_corrente["u"]
    app.dependency_overrides[richiedi_admin] = lambda: utente_corrente["u"]
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    os.environ.pop("TESORERIA_DIR", None)


@pytest.fixture(autouse=True)
def pulisci(test_engine):
    utente_corrente["u"] = ADMIN
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE tesoreria_scadenze, tesoreria_scad_import, user_module_permissions, "
                          "module_permissions, modules, users RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO modules (code, name, ordine, attivo) VALUES ('tesoreria', 'TESORERIA', 30, true)"))
        conn.execute(text("""
            INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
            VALUES ('tesoreria', 'admin', true, true, true), ('tesoreria', 'viewer', true, false, false)
        """))


def _anteprima(client, contenuto=SCAD, nome="scadenzario.xml", data=None):
    return client.post("/tesoreria/scadenzario/anteprima", files={"file": (nome, contenuto, "application/xml")},
                       data={"data_fotografia": data} if data else None)


def _importa(client, contenuto=SCAD, nome="scadenzario.xml", **extra):
    r = _anteprima(client, contenuto, nome)
    assert r.status_code == 200, r.text
    c = client.post("/tesoreria/scadenzario/conferma", json={"token": r.json()["token"], **extra})
    assert c.status_code == 200, c.text
    return c.json()


# ── Calcoli puri ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def scadenze():
    return parse_scadenzario(SCAD).scadenze


def test_aperto_per_fornitore_al_netto_dei_pareggi(scadenze):
    f = {x["codice_fornitore"]: x for x in per_fornitore(scadenze, date(2026, 10, 15))}
    albergo = f["601.00002"]                          # fattura 5.000 − pareggi 2 × 2.650
    assert albergo["fatture"] == Decimal("5000.00") and albergo["pareggi"] == Decimal("-5300.00")
    assert albergo["netto"] == Decimal("-300.00") and albergo["aperto"] == 0
    assert f["601.00003"]["aperto"] == Decimal("180.00")          # 120,50 + 80,25 − 20,75 (nota di credito)
    assert f["601.00001"]["aperto"] == 0 and f["601.00001"]["n_residui"] == 1


def test_riepilogo_e_residui(scadenze):
    r = riepilogo(scadenze, date(2026, 10, 15))
    assert r["totale"] == Decimal("228.36")
    assert r["aperto"] == Decimal("180.00") + Decimal("25.47") + Decimal("300.00") + Decimal("172.89")
    assert r["n_fornitori"] == 6 and r["n_fornitori_saldati"] == 2
    assert r["limite_residui"] == date(2025, 1, 1)
    assert r["n_residui"] == 1 and r["residui"] == Decimal("-150.00")         # scadenza 2011
    assert not e_residuo(next(s for s in scadenze if s.numero_documento == "45"), date(2026, 10, 15))  # 2025
    assert anno_contabile(scadenze) == 2026


def test_confronta_e_unisci(scadenze):
    altre = parse_scadenzario(SCAD_31).scadenze
    c = confronta(scadenze, altre)
    assert [s.importo for s in c["nuove"]] == [Decimal("30.00")]
    assert [s.importo for s in c["chiuse"]] == [Decimal("25.47")]
    assert len(unisci_fotografia([scadenze, scadenze])) == len(scadenze)


# ── Endpoint ────────────────────────────────────────────────────────────────────

def test_anteprima_non_scrive(client, test_engine):
    r = _anteprima(client)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["data_fotografia"] == "2026-10-15" and a["data_stampa"] == "2026-10-15"
    assert a["anno_contabile"] == 2026
    assert a["riepilogo"]["n_scadenze"] == 10 and a["riepilogo"]["totale"] == 228.36
    assert a["riepilogo"]["aperto"] == 678.36
    assert a["riepilogo"]["fornitori"][0]["codice_fornitore"] == "601.00005"   # aperto più alto
    assert a["confronto"] is None and a["sostituisce"] == [] and a["gia_importato"] is None
    with test_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM tesoreria_scad_import")).scalar() == 0


def test_anteprima_data_scelta_e_errori(client):
    assert _anteprima(client, data="2026-10-20").json()["data_fotografia"] == "2026-10-20"
    assert _anteprima(client, data="20/10/2026").status_code == 400
    assert _anteprima(client, contenuto=b"non xml").status_code == 400
    assert _anteprima(client, contenuto=b"").status_code == 400


def test_conferma_salva_scadenze_e_file(client, test_engine):
    esito = _importa(client, note="prima fotografia")
    assert esito["n_righe"] == 10 and esito["totale"] == 228.36 and esito["sostituiti"] == []
    storico = client.get("/tesoreria/scadenzario/import").json()
    assert len(storico) == 1 and storico[0]["ha_file"] and storico[0]["anno_contabile"] == 2026
    assert storico[0]["note"] == "prima fotografia"
    f = client.get(f"/tesoreria/scadenzario/import/{esito['import_id']}/file")
    assert f.status_code == 200 and f.content == SCAD
    with test_engine.connect() as conn:
        riga = conn.execute(text(
            "SELECT fornitore, importo, registro, descrizione FROM tesoreria_scadenze WHERE numero_documento = '45'"
        )).one()
    assert riga.fornitore == "Albergo Esempio S.a.s. di Prova Mario & C." and riga.importo == Decimal("5000.00")
    assert riga.registro == "1" and riga.descrizione == "Gennaio - Dicembre 25"


def test_stesso_file_rifiutato_e_token_monouso(client):
    _importa(client)
    a = _anteprima(client).json()
    assert a["gia_importato"] is not None
    assert client.post("/tesoreria/scadenzario/conferma", json={"token": a["token"]}).status_code == 409
    vecchio = _anteprima(client, SCAD_31).json()["token"]
    assert client.post("/tesoreria/scadenzario/conferma", json={"token": vecchio}).status_code == 200
    assert client.post("/tesoreria/scadenzario/conferma", json={"token": vecchio}).status_code == 410


def test_confronto_con_fotografia_precedente(client):
    _importa(client)
    a = _anteprima(client, SCAD_31).json()
    c = a["confronto"]
    assert c["data_fotografia"] == "2026-10-15"
    assert c["n_nuove"] == 1 and c["importo_nuove"] == 30.0
    assert c["n_chiuse"] == 1 and c["importo_chiuse"] == 25.47
    assert c["chiuse"][0]["fornitore"] == "TELEFONIA ESEMPIO SPA"


def test_stesso_giorno_sostituisce_solo_con_conferma(client, test_engine):
    primo = _importa(client)
    a = _anteprima(client, SCAD_BIS).json()
    assert [s["id"] for s in a["sostituisce"]] == [primo["import_id"]]
    r = client.post("/tesoreria/scadenzario/conferma", json={"token": a["token"]})
    assert r.status_code == 409 and "sostituzione" in r.json()["detail"]
    a = _anteprima(client, SCAD_BIS).json()
    esito = client.post("/tesoreria/scadenzario/conferma", json={"token": a["token"], "sostituisci": True}).json()
    assert esito["sostituiti"] == [primo["import_id"]]
    storico = client.get("/tesoreria/scadenzario/import").json()
    assert [i["id"] for i in storico] == [esito["import_id"]]
    with test_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM tesoreria_scadenze")).scalar() == 10
    assert client.get(f"/tesoreria/scadenzario/import/{primo['import_id']}/file").status_code == 404


def test_altra_data_non_sostituisce(client):
    _importa(client)
    esito = _importa(client, SCAD_31)
    assert esito["sostituiti"] == []
    assert len(client.get("/tesoreria/scadenzario/import").json()) == 2


def test_elimina_import(client, test_engine):
    esito = _importa(client)
    assert client.delete(f"/tesoreria/scadenzario/import/{esito['import_id']}").status_code == 400
    r = client.delete(f"/tesoreria/scadenzario/import/{esito['import_id']}?conferma=true")
    assert r.status_code == 200 and r.json()["scadenze_eliminate"] == 10
    with test_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM tesoreria_scadenze")).scalar() == 0
    assert client.delete("/tesoreria/scadenzario/import/999?conferma=true").status_code == 404


def test_token_degli_estratti_conto_non_valido_qui(client):
    r = client.post("/tesoreria/scadenzario/conferma", json={"token": "0" * 32})
    assert r.status_code == 410


def test_viewer_vede_ma_non_importa(client):
    _importa(client)
    utente_corrente["u"] = VIEWER
    assert client.get("/tesoreria/scadenzario/import").status_code == 200
    assert _anteprima(client).status_code == 403
    assert client.delete("/tesoreria/scadenzario/import/1?conferma=true").status_code == 403
