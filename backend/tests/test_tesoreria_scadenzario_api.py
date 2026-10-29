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
        conn.execute(text("TRUNCATE tesoreria_abbinamenti, tesoreria_pagate_manuali, tesoreria_fornitori_banca, "
                          "tesoreria_movimenti, tesoreria_conti, tesoreria_scadenze, tesoreria_scad_import, "
                          "user_module_permissions, module_permissions, modules, users RESTART IDENTITY CASCADE"))
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


# ── Abbinamenti con la banca (blocco C) ────────────────────────────────────────

USCITE = [
    # data, importo, abi, controparte, causale
    ("2026-10-31", "-180.00", "31//48", "CAFFE ROSSI SRL", "Ri.Ba. scadenza 31/10/26"),     # 3 scadenze (con NR)
    ("2026-10-28", "-25.47", "31//22", "TELEFONIA ESEMPIO S.P.A.", "SDD bolletta"),
    ("2026-10-31", "-300.00", "26//11", "SOL SERVICES", "fattura 10/200"),                  # nome diverso
    ("2026-11-02", "-172.89", "13//00", None, "Vs assegno n."),                             # contanti → assegno
    ("2026-11-03", "-99.00", "26//11", "ALTRO FORNITORE", "acconto"),
]


def _uscite(test_engine, righe=USCITE):
    with test_engine.begin() as conn:
        conn.execute(text("INSERT INTO tesoreria_conti (codice, nome, tipo, fido, ha_import, ordine) "
                          "VALUES ('PRINC', 'Conto principale', 'conto', 0, true, 1)"))
        for i, (g, imp, abi, contro, causale) in enumerate(righe, start=1):
            conn.execute(text("""
                INSERT INTO tesoreria_movimenti (conto_id, data_contabile, importo, descrizione, controparte, causale,
                                                 causale_abi, impronta)
                VALUES (1, :g, :imp, :d, :c, :causale, :abi, :imp_id)
            """), dict(g=g, imp=imp, d=f"{causale} {contro or ''}", c=contro, causale=causale, abi=abi, imp_id=f"T{i}"))


def _abbinamenti(client, **params):
    r = client.get("/tesoreria/scadenzario/abbinamenti", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_import_calcola_gli_abbinamenti(client, test_engine):
    _uscite(test_engine)
    esito = _importa(client)
    assert esito["abbinamenti"]["n_automatici"] == 2 and esito["abbinamenti"]["n_proposti"] == 2
    d = _abbinamenti(client)
    assert d["conteggi"] == {"automatico": 2, "proposto": 2, "confermato": 0, "scartato": 0}
    per_regola = {a["regola"]: a for a in d["abbinamenti"]}
    riba = per_regola["riba_somma"]
    assert riba["stato"] == "automatico" and riba["n_scadenze"] == 3 and riba["differenza"] == 0
    assert per_regola["sdd"]["stato"] == "automatico"
    assert per_regola["bonifico"]["stato"] == "proposto" and "diverso" in per_regola["bonifico"]["nota"]
    assert per_regola["assegno"]["stato"] == "proposto"
    # fornitore saldato dai pareggi e residuo 2011: mai abbinati
    tutte = {s["chiave"].split("|")[0] for a in d["abbinamenti"] for s in a["scadenze"]}
    assert "601.00002" not in tutte and "601.00001" not in tutte


def test_conferma_impara_il_nome_in_banca(client, test_engine):
    _uscite(test_engine)
    _importa(client)
    bonifico = next(a for a in _abbinamenti(client)["abbinamenti"] if a["regola"] == "bonifico")
    r = client.post("/tesoreria/scadenzario/abbinamenti/conferma", json={"ids": [bonifico["id"]]})
    assert r.status_code == 200 and r.json()["confermati"] == [bonifico["id"]]
    with test_engine.connect() as conn:
        assert conn.execute(text("SELECT codice_fornitore, nome_banca FROM tesoreria_fornitori_banca")).all() == [
            ("601.00005", "SOL SERVICES")]
    # il ricalcolo non tocca i confermati
    client.post("/tesoreria/scadenzario/abbinamenti/ricalcola")
    d = _abbinamenti(client)
    assert d["conteggi"]["confermato"] == 1 and d["conteggi"]["automatico"] == 2 and d["conteggi"]["proposto"] == 1


def test_scarta_non_ripropone(client, test_engine):
    _uscite(test_engine)
    _importa(client)
    assegno = next(a for a in _abbinamenti(client)["abbinamenti"] if a["regola"] == "assegno")
    r = client.post("/tesoreria/scadenzario/abbinamenti/scarta", json={"ids": [assegno["id"]]})
    assert r.status_code == 200
    client.post("/tesoreria/scadenzario/abbinamenti/ricalcola")
    d = _abbinamenti(client)
    assert d["conteggi"]["scartato"] == 1 and not any(a["regola"] == "assegno" and a["stato"] != "scartato"
                                                       for a in d["abbinamenti"])
    # annullando lo scarto la proposta torna
    assert client.delete(f"/tesoreria/scadenzario/abbinamenti/{assegno['id']}").status_code == 200
    assert any(a["regola"] == "assegno" and a["stato"] == "proposto" for a in _abbinamenti(client)["abbinamenti"])


def test_abbinamento_manuale_e_candidati(client, test_engine):
    _uscite(test_engine)
    _importa(client)
    chiave = next(s["chiave"] for a in _abbinamenti(client)["abbinamenti"] if a["regola"] == "assegno"
                  for s in a["scadenze"])
    cand = client.get("/tesoreria/scadenzario/movimenti-candidati", params={"chiave": chiave}).json()
    assert cand[0]["importo"] == -172.89
    altro = next(c for c in cand if c["importo"] == -99.0)
    r = client.post("/tesoreria/scadenzario/abbinamenti/manuale",
                    json={"chiavi": [chiave], "movimenti": [altro["id"]], "nota": "acconto"})
    assert r.status_code == 200, r.text
    assert r.json()["stato"] == "confermato" and r.json()["differenza"] == round(99.0 - 172.89, 2)
    d = _abbinamenti(client)
    assert not any(a["regola"] == "assegno" for a in d["abbinamenti"])   # proposta sostituita
    # una scadenza già confermata non si abbina di nuovo
    r = client.post("/tesoreria/scadenzario/abbinamenti/manuale", json={"chiavi": [chiave], "movimenti": [altro["id"]]})
    assert r.status_code == 409
    assert client.post("/tesoreria/scadenzario/abbinamenti/manuale",
                       json={"chiavi": ["inesistente"], "movimenti": [altro["id"]]}).status_code == 400


def test_pagate_a_mano_selezione_multipla(client, test_engine):
    _uscite(test_engine)
    _importa(client)
    proposte = [a for a in _abbinamenti(client)["abbinamenti"] if a["stato"] == "proposto"]
    chiavi = [s["chiave"] for a in proposte for s in a["scadenze"]]
    r = client.post("/tesoreria/scadenzario/pagate-manuali",
                    json={"chiavi": chiavi, "data_pagamento": "2026-11-01", "nota": "pagate con carta"})
    assert r.status_code == 200 and r.json()["segnate"] == 2
    assert _abbinamenti(client)["conteggi"]["proposto"] == 0          # le proposte su quelle scadenze spariscono
    elenco = client.get("/tesoreria/scadenzario/pagate-manuali").json()
    assert len(elenco) == 2 and elenco[0]["nota"] == "pagate con carta"
    # già abbinata in automatico e confermata: non si segna a mano
    sdd = next(a for a in _abbinamenti(client)["abbinamenti"] if a["regola"] == "sdd")
    client.post("/tesoreria/scadenzario/abbinamenti/conferma", json={"ids": [sdd["id"]]})
    r = client.post("/tesoreria/scadenzario/pagate-manuali", json={"chiavi": [sdd["scadenze"][0]["chiave"]]})
    assert r.status_code == 409
    r = client.post("/tesoreria/scadenzario/pagate-manuali/rimuovi", json={"chiavi": chiavi})
    assert r.json()["rimosse"] == 2 and _abbinamenti(client)["conteggi"]["proposto"] == 2


def test_movimento_eliminato_toglie_l_abbinamento(client, test_engine):
    _uscite(test_engine)
    _importa(client)
    sdd = next(a for a in _abbinamenti(client)["abbinamenti"] if a["regola"] == "sdd")
    client.post("/tesoreria/scadenzario/abbinamenti/conferma", json={"ids": [sdd["id"]]})
    with test_engine.begin() as conn:
        conn.execute(text("DELETE FROM tesoreria_movimenti WHERE id = :i"), {"i": sdd["movimenti"][0]["id"]})
    client.post("/tesoreria/scadenzario/abbinamenti/ricalcola")
    assert _abbinamenti(client)["conteggi"]["confermato"] == 0


def test_viewer_non_modifica_abbinamenti(client, test_engine):
    _uscite(test_engine)
    _importa(client)
    utente_corrente["u"] = VIEWER
    assert client.get("/tesoreria/scadenzario/abbinamenti").status_code == 200
    assert client.post("/tesoreria/scadenzario/abbinamenti/ricalcola").status_code == 403
    assert client.post("/tesoreria/scadenzario/abbinamenti/conferma", json={"ids": [1]}).status_code == 403
    assert client.post("/tesoreria/scadenzario/pagate-manuali", json={"chiavi": ["x"]}).status_code == 403


# ── Scheda Scadenzario (blocco D) ──────────────────────────────────────────────

def test_stato_delle_scadenze(client, test_engine):
    from app.routers.tesoreria_scadenzario_report import stato_scadenze
    _uscite(test_engine)
    _importa(client)
    sdd = next(a for a in _abbinamenti(client)["abbinamenti"] if a["regola"] == "sdd")
    client.post("/tesoreria/scadenzario/abbinamenti/conferma", json={"ids": [sdd["id"]]})
    with sessionmaker(bind=test_engine)() as db:
        st = stato_scadenze(db, oggi=date(2026, 11, 15))
    per_stato = {}
    for r in st["scadenze"]:
        per_stato.setdefault(r["stato"], []).append(r)
    assert len(per_stato["pagata_banca"]) == 4             # Ri.Ba. (3, con nota di credito) + SDD
    assert len(per_stato["da_confermare"]) == 2            # bonifico con nome diverso, assegno
    assert len(per_stato["pareggio"]) == 3
    assert {r["codice_fornitore"] for r in per_stato["compensata"]} == {"601.00002"}     # coperta dai pareggi
    assert "aperta" not in per_stato and "scaduta" not in per_stato
    sdd_riga = next(r for r in per_stato["pagata_banca"] if r["codice_fornitore"] == "601.00004")
    assert sdd_riga["pagata_come"] == "Addebito diretto" and sdd_riga["data_pagamento"] == date(2026, 10, 28)
    t = st["totali"]
    assert t["da_segnalare"]["importo"] == Decimal("205.47")        # 180,00 + 25,47
    assert t["da_pagare"]["importo"] == Decimal("472.89")           # 300,00 + 172,89 da confermare
    # senza abbinamenti, dopo la scadenza: scaduta
    client.post("/tesoreria/scadenzario/pagate-manuali", json={"chiavi": [r["chiave"] for r in per_stato["da_confermare"]]})
    with sessionmaker(bind=test_engine)() as db:
        st = stato_scadenze(db, oggi=date(2026, 12, 15))
    assert sum(1 for r in st["scadenze"] if r["stato"] == "pagata_manuale") == 2
    assert st["totali"]["da_segnalare"]["n"] == 6
    assert st["totali"]["da_segnalare"]["importo"] == Decimal("678.36")


def test_stato_senza_scadenzario(client):
    r = client.get("/tesoreria/scadenzario/stato").json()
    assert r["data_fotografia"] is None and r["scadenze"] == []


def test_dettaglio_fornitore_ed_export(client, test_engine):
    _uscite(test_engine)
    _importa(client)
    d = client.get("/tesoreria/scadenzario/fornitore/601.00003").json()
    assert d["fornitore"] == "CAFFÈ ROSSI S.R.L." and len(d["scadenze"]) == 3
    assert [p["importo"] for p in d["pagamenti"]] == [-180.0] and d["pagamenti"][0]["abbinato"]
    assert d["mensile"] == [{"mese": "2026-10", "importo": 180.0}]
    assert d["abbinamenti"][0]["regola"] == "riba_somma"
    assert client.get("/tesoreria/scadenzario/fornitore/999").status_code == 404
    r = client.get("/tesoreria/scadenzario/da-segnalare/export", params={"formato": "csv"})
    assert r.status_code == 200
    testo = r.content.decode("utf-8-sig")
    assert "CAFFÈ ROSSI" in testo and "TELEFONIA ESEMPIO" in testo and "TOTALE" in testo
    for formato in ("xlsx", "pdf"):
        assert client.get("/tesoreria/scadenzario/da-segnalare/export", params={"formato": formato}).status_code == 200


def test_tempi_di_pagamento(client, test_engine):
    from app.routers.tesoreria_scadenzario_report import tempi_pagamento
    _uscite(test_engine)
    _importa(client)
    with sessionmaker(bind=test_engine)() as db:
        t = tempi_pagamento(db, date(2026, 1, 1), date(2026, 12, 31))
    # Ri.Ba. 31/10 per fatture del 30/09 (31 giorni, la nota di credito non pesa) + SDD 28/10 per fattura del 10/10
    assert t["n"] == 3
    attesa = (31 * 120.50 + 31 * 80.25 + 18 * 25.47) / (120.50 + 80.25 + 25.47)
    assert t["giorni_da_fattura"] == round(attesa, 1)
    assert t["fornitori"][0]["codice_fornitore"] == "601.00003"


def test_pareggi_coprono_prima_le_pagate():
    from app.services.tesoreria_scadenzario import compensa_pareggi
    def r(stato, importo, giorno, pareggio=False):
        return {"stato": stato, "importo": Decimal(importo), "data_scadenza": date(2026, 1, giorno),
                "codice_fornitore": "F", "pareggio": pareggio}
    righe = [r("pagata_banca", "100.00", 20), r("pagata_banca", "-10.00", 20), r("scaduta", "50.00", 5),
             r("aperta", "70.00", 25), r("pareggio", "-120.00", 28, True)]
    compensa_pareggi(righe)
    pag, nc, scad, aperta, _ = righe
    assert pag["stato"] == "compensata" and pag["stato_originale"] == "pagata_banca"     # la pagata per prima
    assert nc["da_segnalare"] == Decimal("-10.00")
    assert scad["stato"] == "scaduta" and scad["compensato"] == Decimal("20.00") and scad["aperto"] == Decimal("30.00")
    assert aperta["aperto"] == Decimal("70.00")
