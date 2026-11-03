"""Test dei piani della Tesoreria: calcoli puri, lettura del piano mutuo, affitti con percentuali, ricorrenti, interventi,
carte, abbinamento con nomi diversi (S.A.S./S.N.C.), permessi. DB dedicato."""
import os
import sys
from datetime import date, timedelta
from decimal import Decimal as D
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app.auth import richiedi_admin, richiedi_utente_attivo  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services.tesoreria_parser import ErroreImportTesoreria  # noqa: E402
from app.services.tesoreria_piani import (  # noqa: E402
    advertising_per_addebito, chiudi_totale, data_addebito_advertising, data_addebito_carta, date_ricorrente, importi_rate,
    nome_corrisponde, parse_piano_mutuo,
)

from tests._db import TEST_DB_URL  # noqa: E402

ADMIN = SimpleNamespace(id=None, ruolo="admin")
VIEWER = SimpleNamespace(id=None, ruolo="viewer")
utente_corrente = {"u": ADMIN}
FUTURO = date.today().year + 1
FIXTURE_MUTUO = os.path.join(os.path.dirname(__file__), "fixtures", "tesoreria", "piano_mutuo.xls")


# ── Puri ────────────────────────────────────────────────────────────────────────

def test_percentuali_terzi_tornano_al_canone():
    assert importi_rate(D("183000"), [D("33.333333"), D("33.333333"), D("33.333334")]) == [D("61000.00"), D("61000.00"), D("61000.00")]
    assert sum(importi_rate(D("100.01"), [D("33.333333"), D("33.333333"), D("33.333334")])) == D("100.01")


def test_piano_parziale_non_altera_importi():
    assert importi_rate(D("158600"), [D("18.915511")]) == [D("30000.00")]


def test_nomi_vecchio_e_nuovo_e_troncati():
    nomi = ["HOTEL DU PARC SNC", "HOTEL DU PARC S.A.S."]
    assert nome_corrisponde("HOTEL DU PARC S.A.S. DI", nomi)
    assert nome_corrisponde("Hotel Du Parc Snc di Eli", nomi)
    assert not nome_corrisponde("HOTEL INTERNATIONAL S.N.", nomi)
    assert not nome_corrisponde("", nomi)


def test_addebito_carta():
    assert data_addebito_carta(date(2026, 10, 6), 27, date(2026, 10, 7)) == date(2026, 10, 27)
    assert data_addebito_carta(date(2026, 9, 28), 26, date(2026, 9, 29)) == date(2026, 10, 26)
    assert data_addebito_carta(date(2026, 9, 28), 26, date(2026, 11, 2)) == date(2026, 11, 2)   # in ritardo: oggi


def test_advertising_addebito_mese_dopo_e_totale():
    assert data_addebito_advertising(2026, 10, 27) == date(2026, 11, 27)
    assert data_addebito_advertising(2026, 12, 27) == date(2027, 1, 27)
    assert data_addebito_advertising(2027, 1, 27) == date(2027, 3, 1)      # 27/2/2027 è sabato
    assert data_addebito_advertising(2026, 1, None) == date(2026, 3, 2)     # senza giorno: fine febbraio, 28/2 è sabato
    assert advertising_per_addebito([(2025, 12, D("10")), (2026, 1, D("5"))]) == {(2026, 1): D("10"), (2026, 2): D("5")}
    assert chiudi_totale(D("100"), {1: D("30"), 5: D("0"), 3: D("20")}) == {1: D("30"), 3: D("20"), 5: D("50")}
    assert chiudi_totale(D("100"), {}) == {}
    with pytest.raises(ValueError):
        chiudi_totale(D("10"), {1: D("30"), 2: D("1")})


def test_date_ricorrente_lavorative_e_periodo():
    d = date_ricorrente(date(2027, 1, 1), date(2027, 12, 31), 30, [6, 2], None, date(2027, 7, 1))
    assert d == [date(2027, 3, 1), date(2027, 6, 30)]    # 28/2 è domenica


def test_parser_mutuo_rifiuta_file_estraneo():
    with pytest.raises(ErroreImportTesoreria):
        parse_piano_mutuo(b"non un xls")


# ── API ─────────────────────────────────────────────────────────────────────────

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
        conn.execute(text("TRUNCATE tesoreria_impegni, tesoreria_contratti_affitto, tesoreria_rate_affitto, tesoreria_rate_mutuo, "
                          "tesoreria_ricorrenti, tesoreria_interventi, tesoreria_compensi, tesoreria_advertising, tesoreria_movimenti, tesoreria_saldi, tesoreria_categorie, "
                          "tesoreria_conti, app_config, user_module_permissions, module_permissions, modules, users RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO modules (code, name, ordine, attivo) VALUES ('tesoreria', 'TESORERIA', 30, true)"))
        conn.execute(text("""
            INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
            VALUES ('tesoreria', 'admin', true, true, true), ('tesoreria', 'viewer', true, false, false)
        """))
        conn.execute(text("INSERT INTO tesoreria_conti (codice, nome, tipo) VALUES ('C', 'Conto', 'conto')"))
        for c in ("affitti", "mutuo_rate", "assicurazioni", "soci_marchio", "soci_amministratori", "personale"):
            conn.execute(text("INSERT INTO tesoreria_categorie (codice, nome, tipo) VALUES (:c, :c, 'uscita')"), {"c": c})


def _contratto(client):
    r = client.post("/tesoreria/piani/affitti", json={
        "codice": "DPH", "controparte": "Hotel Du Parc", "nomi_banca": ["HOTEL DU PARC SNC", "HOTEL DU PARC S.A.S."], "canone_annuo": "158600",
    })
    assert r.status_code == 200, r.text
    return r.json()


def _rata(client, contratto_id, data, pct, anno=FUTURO):
    return client.post(f"/tesoreria/piani/affitti/{contratto_id}/rate",
                       json={"anno_competenza": anno, "data_prevista": data, "percentuale": pct})


def _impegni(client):
    return {i["codice"]: i for i in client.get("/tesoreria/impegni").json()["impegni"]}


def _movimento(test_engine, categoria, giorno, importo, controparte=""):
    with test_engine.begin() as conn:
        return conn.execute(text("""
            INSERT INTO tesoreria_movimenti (conto_id, data_contabile, importo, descrizione, controparte, impronta, categoria_id)
            SELECT 1, :g, :i, 'x', :cp, :imp, (SELECT id FROM tesoreria_categorie WHERE codice = :c) RETURNING id
        """), {"g": giorno, "i": importo, "imp": f"X{giorno}{importo}{controparte}", "c": categoria, "cp": controparte}).scalar()


def test_rate_in_percentuale_generano_impegni_e_data_si_sposta(client):
    c = _contratto(client)
    r = _rata(client, c["id"], f"{FUTURO}-01-31", "18.915511").json()
    assert r["rate"][0]["importo"] == 30000
    assert r["anni"][0]["residuo"] == 158600 and r["anni"][0]["da_pianificare"] == pytest.approx(128600, abs=0.1)
    codice = f"affitto:DPH:{r['rate'][0]['id']}"
    assert _impegni(client)[codice]["data_scadenza"] == f"{FUTURO}-01-31"
    r2 = client.put(f"/tesoreria/piani/affitti/rate/{r['rate'][0]['id']}", json={"data_prevista": f"{FUTURO}-03-15", "percentuale": "50"}).json()
    assert r2["rate"][0]["importo"] == 79300
    i = _impegni(client)[codice]
    assert i["data_scadenza"] == f"{FUTURO}-03-15" and i["importo"] == 79300 and i["compensabile"] is False


def test_ultima_rata_automatica_chiude_il_100(client):
    c = _contratto(client)
    r = _rata(client, c["id"], f"{FUTURO}-01-31", "30").json()
    # Una rata sola resta com'è: il resto è da pianificare
    assert r["rate"][0]["percentuale"] == 30 and r["rate"][0]["automatica"] is False
    assert r["anni"][0]["da_pianificare"] == pytest.approx(111020, abs=0.01)
    r = _rata(client, c["id"], f"{FUTURO}-03-31", "20").json()
    assert [x["percentuale"] for x in r["rate"]] == [30, 70] and r["rate"][1]["automatica"] is True
    assert r["anni"][0]["da_pianificare"] == 0 and sum(x["importo"] for x in r["rate"]) == 158600
    # Una rata successiva diventa l'ultima: la precedente torna alla percentuale inserita
    r = _rata(client, c["id"], f"{FUTURO}-06-30", "10").json()
    assert [x["percentuale"] for x in r["rate"]] == [30, 20, 50]
    assert [x["automatica"] for x in r["rate"]] == [False, False, True]
    # Anche spostando la data: chi diventa ultima chiude il totale
    r = client.put(f"/tesoreria/piani/affitti/rate/{r['rate'][2]['id']}", json={"data_prevista": f"{FUTURO}-02-15"}).json()
    assert [x["percentuale"] for x in r["rate"]] == [30, 10, 60]
    assert r["rate"][1]["data_prevista"] == f"{FUTURO}-02-15"


def test_percentuali_che_arrivano_al_100_prima_dell_ultima_rifiutate(client):
    c = _contratto(client)
    assert _rata(client, c["id"], f"{FUTURO}-01-31", "60").status_code == 200
    assert _rata(client, c["id"], f"{FUTURO}-02-28", "41").status_code == 200
    assert _rata(client, c["id"], f"{FUTURO}-03-31", "10").status_code == 400
    assert _rata(client, c["id"], f"{FUTURO}-01-15", "101", anno=FUTURO + 1).status_code == 400


def test_abbinamento_con_vecchia_ragione_sociale_e_blocco_rata_pagata(client, test_engine):
    c = _contratto(client)
    giorno = date.today() + timedelta(days=3)
    r = _rata(client, c["id"], giorno.isoformat(), "18.915511").json()
    _movimento(test_engine, "affitti", giorno + timedelta(days=2), D("-30000.00"), "HOTEL DU PARC S.A.S. DI")
    assert client.post("/tesoreria/impegni/abbina").json()["automatici"] == 1
    dettaglio = client.get("/tesoreria/piani/affitti").json()[0]
    assert dettaglio["anni"][0]["pagato"] == 30000 and dettaglio["rate"][0]["stato"] == "pagato"
    assert client.put(f"/tesoreria/piani/affitti/rate/{r['rate'][0]['id']}", json={"percentuale": "20"}).status_code == 409
    assert client.delete(f"/tesoreria/piani/affitti/rate/{r['rate'][0]['id']}").status_code == 409


def test_pagamento_parziale_resta_da_confermare(client, test_engine):
    c = _contratto(client)
    giorno = date.today() + timedelta(days=3)
    _rata(client, c["id"], giorno.isoformat(), "37.831021")
    _movimento(test_engine, "affitti", giorno, D("-20000.00"), "HOTEL DU PARC SNC DI ELI")
    assert client.post("/tesoreria/impegni/abbina").json() == {"automatici": 0, "proposti": 1}


def test_altra_controparte_non_abbinata(client, test_engine):
    c = _contratto(client)
    giorno = date.today() + timedelta(days=3)
    _rata(client, c["id"], giorno.isoformat(), "18.915511")
    _movimento(test_engine, "affitti", giorno, D("-30000.00"), "HOTEL INTERNATIONAL S.N.")
    assert client.post("/tesoreria/impegni/abbina").json() == {"automatici": 0, "proposti": 0}


def _categoria(client, test_engine, codice):
    with test_engine.connect() as conn:
        return conn.execute(text("SELECT id FROM tesoreria_categorie WHERE codice = :c"), {"c": codice}).scalar()


def test_ricorrente_genera_per_ogni_mese_e_si_cancella(client, test_engine):
    client.put("/tesoreria/impegni/parametri", json={"orizzonte": f"{FUTURO}-12-31"})
    r = client.post("/tesoreria/piani/ricorrenti", json={
        "descrizione": "Polizza", "categoria_id": _categoria(client, test_engine, "assicurazioni"), "importo": "2970", "giorno": 13, "mesi": [1, 7],
    })
    assert r.status_code == 200, r.text
    assert f"ricorrente:{r.json()['id']}:{FUTURO}-07" in _impegni(client)
    client.delete(f"/tesoreria/piani/ricorrenti/{r.json()['id']}")
    assert not _impegni(client)


def _rata_intervento(client, intervento_id, data):
    r = client.post(f"/tesoreria/piani/interventi/{intervento_id}/rate", json={"data_prevista": data})
    assert r.status_code == 200, r.text
    return r.json()


def _impegni_intervento(client):
    return sorted((v for k, v in _impegni(client).items() if k.startswith("intervento:")), key=lambda x: x["data_scadenza"])


def test_intervento_senza_importo_o_rate_fuori_previsione(client):
    i = client.post("/tesoreria/piani/interventi", json={"descrizione": "Piscina", "struttura_code": "DPH", "inclusa_in_previsione": True}).json()
    assert i["importo_stimato"] is None and not _impegni(client)
    client.put(f"/tesoreria/piani/interventi/{i['id']}", json={"importo_stimato": "25000"})
    assert not _impegni(client)
    _rata_intervento(client, i["id"], f"{FUTURO}-03-15")
    impegni = _impegni_intervento(client)
    assert impegni[0]["data_scadenza"] == f"{FUTURO}-03-15" and impegni[0]["importo"] == 25000
    client.put(f"/tesoreria/piani/interventi/{i['id']}", json={"inclusa_in_previsione": False})
    assert not _impegni(client)
    assert client.put(f"/tesoreria/piani/interventi/{i['id']}", json={"stato": "boh"}).status_code == 400


def test_intervento_a_rate_l_ultima_chiude_il_100(client):
    i = client.post("/tesoreria/piani/interventi", json={"descrizione": "Piscina", "importo_stimato": "10000", "inclusa_in_previsione": True}).json()
    r = _rata_intervento(client, i["id"], f"{FUTURO}-01-10")
    assert [x["percentuale"] for x in r["rate"]] == [100] and r["rate"][0]["automatica"] is True
    r = _rata_intervento(client, i["id"], f"{FUTURO}-03-10")
    assert [x["percentuale"] for x in r["rate"]] == [50, 50]
    r = client.put(f"/tesoreria/piani/interventi/rate/{r['rate'][0]['id']}", json={"percentuale": "30"}).json()
    assert [x["percentuale"] for x in r["rate"]] == [30, 70]
    assert [x["importo"] for x in r["rate"]] == [3000, 7000]
    assert [(x["data_scadenza"], x["importo"]) for x in _impegni_intervento(client)] == [(f"{FUTURO}-01-10", 3000), (f"{FUTURO}-03-10", 7000)]
    # L'ultima resta automatica anche se le si scrive una percentuale
    r = client.put(f"/tesoreria/piani/interventi/rate/{r['rate'][1]['id']}", json={"percentuale": "10"}).json()
    assert [x["percentuale"] for x in r["rate"]] == [30, 70]
    assert client.put(f"/tesoreria/piani/interventi/rate/{r['rate'][0]['id']}", json={"percentuale": "100"}).status_code == 400
    # Spostando le date cambia chi è l'ultima, il totale resta il 100%
    r = client.put(f"/tesoreria/piani/interventi/rate/{r['rate'][0]['id']}", json={"data_prevista": f"{FUTURO}-05-10"}).json()
    assert [x["percentuale"] for x in r["rate"]] == [70, 30]
    r = client.delete(f"/tesoreria/piani/interventi/rate/{r['rate'][1]['id']}").json()
    assert [x["percentuale"] for x in r["rate"]] == [100]


def test_prova_accende_e_spegne_interventi_a_rate(client):
    acceso = client.post("/tesoreria/piani/interventi", json={"descrizione": "A", "importo_stimato": "1000", "inclusa_in_previsione": True}).json()
    spento = client.post("/tesoreria/piani/interventi", json={"descrizione": "B", "importo_stimato": "1000"}).json()
    for i in (acceso, spento):
        _rata_intervento(client, i["id"], f"{FUTURO}-01-10")
        _rata_intervento(client, i["id"], f"{FUTURO}-02-10")
    assert len(_impegni_intervento(client)) == 2
    r = client.post("/tesoreria/previsione/prova", json={"interventi_on": [spento["id"]], "interventi_off": [acceso["id"]]})
    assert r.status_code == 200, r.text


def _compenso(client, voce="marchio", anno=FUTURO, importo="60000"):
    r = client.post("/tesoreria/piani/compensi", json={"voce": voce, "anno_competenza": anno, "importo": importo})
    assert r.status_code == 200, r.text
    return r.json()


def _rata_compenso(client, compenso_id, data):
    r = client.post(f"/tesoreria/piani/compensi/{compenso_id}/rate", json={"data_prevista": data})
    assert r.status_code == 200, r.text
    return r.json()


def _impegni_compenso(client):
    return sorted((v for k, v in _impegni(client).items() if k.startswith("compenso:")), key=lambda x: x["data_scadenza"])


def test_compenso_a_rate_entra_negli_impegni(client):
    c = _compenso(client)
    assert not _impegni_compenso(client)              # senza rate nessuna uscita
    assert client.post("/tesoreria/piani/compensi", json={"voce": "marchio", "anno_competenza": FUTURO, "importo": "1"}).status_code == 409
    assert client.post("/tesoreria/piani/compensi", json={"voce": "boh", "anno_competenza": FUTURO, "importo": "1"}).status_code == 400
    r = _rata_compenso(client, c["id"], f"{FUTURO}-01-08")
    assert [x["percentuale"] for x in r["rate"]] == [100]
    r = _rata_compenso(client, c["id"], f"{FUTURO}-06-23")
    r = client.put(f"/tesoreria/piani/compensi/rate/{r['rate'][0]['id']}", json={"percentuale": "25"}).json()
    assert [x["percentuale"] for x in r["rate"]] == [25, 75]
    impegni = _impegni_compenso(client)
    assert [(x["data_scadenza"], x["importo"]) for x in impegni] == [(f"{FUTURO}-01-08", 15000), (f"{FUTURO}-06-23", 45000)]
    assert impegni[0]["tipo"] == "compenso" and impegni[0]["compensabile"] is False
    # L'importo si decide ogni anno: cambiandolo, le rate seguono
    client.put(f"/tesoreria/piani/compensi/{c['id']}", json={"importo": "40000"})
    assert [x["importo"] for x in _impegni_compenso(client)] == [10000, 30000]
    # Voci diverse, stesso anno: non si sommano
    a = _compenso(client, "amministratori", importo="12000")
    _rata_compenso(client, a["id"], f"{FUTURO}-12-15")
    assert len(_impegni_compenso(client)) == 3
    assert client.delete(f"/tesoreria/piani/compensi/{a['id']}").status_code == 200
    assert len(_impegni_compenso(client)) == 2


def test_compenso_due_bonifici_stesso_giorno_chiudono_la_rata(client, test_engine):
    giorno = date.today() + timedelta(days=5)
    c = _compenso(client, importo="16000")
    r = _rata_compenso(client, c["id"], giorno.isoformat())
    _movimento(test_engine, "soci_marchio", giorno, D("-8000.00"), "GINO")
    _movimento(test_engine, "soci_marchio", giorno, D("-8000.00"), "ELISA")
    assert client.post("/tesoreria/impegni/abbina").json()["automatici"] == 1
    d = client.get("/tesoreria/piani/compensi").json()[0]
    assert d["pagato"] == 16000 and d["rate"][0]["pagata"] is True and d["rate"][0]["automatica"] is False
    assert client.put(f"/tesoreria/piani/compensi/rate/{r['rate'][0]['id']}", json={"percentuale": "50"}).status_code == 409
    assert client.delete(f"/tesoreria/piani/compensi/{c['id']}").status_code == 409


def test_compenso_altra_voce_e_personale_non_abbinano(client, test_engine):
    giorno = date.today() + timedelta(days=5)
    c = _compenso(client, "amministratori", importo="5000")
    _rata_compenso(client, c["id"], giorno.isoformat())
    _movimento(test_engine, "soci_marchio", giorno, D("-5000.00"), "GINO")
    _movimento(test_engine, "personale", giorno, D("-5000.00"), "BONIFICI")
    assert client.post("/tesoreria/impegni/abbina").json() == {"automatici": 0, "proposti": 0}
    _movimento(test_engine, "soci_amministratori", giorno, D("-4000.00"), "GINO")
    assert client.post("/tesoreria/impegni/abbina").json() == {"automatici": 0, "proposti": 1}


def test_estratto_carta_da_addebitare_poi_sparisce(client, test_engine):
    chiusura = date.today() - timedelta(days=2)
    with test_engine.begin() as conn:
        conn.execute(text("INSERT INTO tesoreria_conti (codice, nome, tipo, giorno_addebito, testo_addebito) VALUES ('AMEX', 'Amex', 'carta_credito', 27, 'AMERICAN')"))
        conn.execute(text("INSERT INTO tesoreria_saldi (conto_id, data, saldo, origine) SELECT id, :d, 500, 'manuale' FROM tesoreria_conti WHERE codice = 'AMEX'"), {"d": chiusura})
    client.post("/tesoreria/impegni/genera")
    assert _impegni(client)[f"carta:AMEX:{chiusura}"]["importo"] == 500
    with test_engine.begin() as conn:
        conn.execute(text("INSERT INTO tesoreria_movimenti (conto_id, data_contabile, importo, descrizione, impronta) VALUES (1, :d, -500, 'AMERICAN EXPRESS', 'Y')"), {"d": date.today()})
    client.post("/tesoreria/impegni/genera")
    assert f"carta:AMEX:{chiusura}" not in _impegni(client)


def _amex(test_engine):
    with test_engine.begin() as conn:
        return conn.execute(text("INSERT INTO tesoreria_conti (codice, nome, tipo, giorno_addebito, testo_addebito) "
                                 "VALUES ('AMEX', 'Amex', 'carta_credito', 27, 'AMERICAN') RETURNING id")).scalar()


def test_advertising_per_mese_ultimo_chiude_il_totale(client, test_engine):
    amex = _amex(test_engine)
    assert client.post("/tesoreria/piani/advertising", json={"anno": FUTURO, "conto_id": 1, "totale": "1200"}).status_code == 400
    r = client.post("/tesoreria/piani/advertising", json={"anno": FUTURO, "conto_id": amex, "totale": "1200",
                                                         "mesi": {"1": "100", "2": "200", "3": "999"}})
    assert r.status_code == 200, r.text
    a = r.json()
    assert [(m["mese"], m["importo"], m["automatico"]) for m in a["mesi"]] == [(1, 100, False), (2, 200, False), (3, 900, True)]
    assert client.post("/tesoreria/piani/advertising", json={"anno": FUTURO, "conto_id": amex, "totale": "1"}).status_code == 409
    imp = {k: v for k, v in _impegni(client).items() if k.startswith("advertising:")}
    assert imp[f"advertising:{FUTURO}:1"]["importo"] == 100 and imp[f"advertising:{FUTURO}:1"]["data_scadenza"] == data_addebito_advertising(FUTURO, 1, 27).isoformat()
    assert imp[f"advertising:{FUTURO}:3"]["tipo"] == "advertising" and imp[f"advertising:{FUTURO}:3"]["importo"] == 900
    # tolto marzo: febbraio diventa l'ultimo e chiude il totale
    a = client.put(f"/tesoreria/piani/advertising/{a['id']}", json={"mesi": {"3": None}}).json()
    assert [(m["mese"], m["importo"]) for m in a["mesi"]] == [(1, 100), (2, 1100)]
    assert f"advertising:{FUTURO}:3" not in _impegni(client)
    assert client.put(f"/tesoreria/piani/advertising/{a['id']}", json={"totale": "50"}).status_code == 400
    assert client.put(f"/tesoreria/piani/advertising/{a['id']}", json={"mesi": {"13": "1"}}).status_code == 400
    assert client.delete(f"/tesoreria/piani/advertising/{a['id']}").status_code == 200
    assert not [k for k in _impegni(client) if k.startswith("advertising:")]


def test_advertising_gia_addebitato_o_nell_estratto_non_entra(client, test_engine):
    amex = _amex(test_engine)
    passato = date.today().year - 1
    client.post("/tesoreria/piani/advertising", json={"anno": passato, "conto_id": amex, "totale": "500", "mesi": {"3": "500"}})
    assert not [k for k in _impegni(client) if k.startswith("advertising:")]
    # spesa del mese che finisce nell'estratto già inserito: la contiene l'estratto
    chiusura = date.today() - timedelta(days=2)
    addebito = data_addebito_carta(chiusura, 27, date.today())
    spesa = (addebito.year, addebito.month - 1) if addebito.month > 1 else (addebito.year - 1, 12)
    r = client.post("/tesoreria/piani/advertising", json={"anno": spesa[0], "conto_id": amex, "totale": "300", "mesi": {str(spesa[1]): "300"}})
    if r.status_code == 409:      # stesso anno del piano precedente
        client.put(f"/tesoreria/piani/advertising/{client.get('/tesoreria/piani/advertising').json()[-1]['id']}",
                   json={"totale": "800", "mesi": {str(spesa[1]): "300"}})
    codice = f"advertising:{spesa[0]}:{spesa[1]}"
    if data_addebito_advertising(spesa[0], spesa[1], 27) >= date.today():
        assert codice in _impegni(client)
    with test_engine.begin() as conn:
        conn.execute(text("INSERT INTO tesoreria_saldi (conto_id, data, saldo, origine) VALUES (:c, :d, 900, 'manuale')"), {"c": amex, "d": chiusura})
    client.post("/tesoreria/impegni/genera")
    assert codice not in _impegni(client)


def test_mutuo_da_file_salta_pagate_e_ricarica(client, test_engine):
    client.put("/tesoreria/impegni/parametri", json={"orizzonte": "2099-09-30"})
    with open(FIXTURE_MUTUO, "rb") as f:
        contenuto = f.read()
    r = client.post("/tesoreria/piani/mutuo", files={"file": ("piano.xls", contenuto)})
    assert r.status_code == 200, r.text
    assert r.json() == {"n_rate": 3, "n_pagate": 1}
    i = _impegni(client)
    assert "mutuo:036/307528:1" not in i
    assert i["mutuo:036/307528:2"]["importo"] == 101.5     # 100 + 1,50 di spese
    assert "mutuo:036/307528:3" not in i                   # oltre l'orizzonte
    piano = client.get("/tesoreria/piani/mutuo").json()
    assert piano["debito_residuo"] == 150


def _scadenza(test_engine, chiave="K1", importo=8000):
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE tesoreria_scadenze, tesoreria_scad_import, tesoreria_intervento_scadenze RESTART IDENTITY CASCADE"))
        conn.execute(text("""INSERT INTO tesoreria_scad_import (data_fotografia, nome_file, sha256, n_righe, totale, anno_contabile)
                             VALUES (:d, 'f.xml', 'x', 1, :i, :a)"""), {"d": date.today(), "i": importo, "a": date.today().year})
        conn.execute(text("""INSERT INTO tesoreria_scadenze (import_id, chiave, data_scadenza, tipo_pagamento, codice_fornitore, fornitore, importo, pareggio)
                             VALUES (1, :c, :d, 'BONIFICO', 'F1', 'PISCINE SRL', :i, false)"""),
                     {"c": chiave, "d": date.today() + timedelta(days=30), "i": importo})


def test_fattura_collegata_riduce_la_stima_e_si_scollega(client, test_engine):
    _scadenza(test_engine)
    client.put("/tesoreria/impegni/parametri", json={"orizzonte": f"{FUTURO}-12-31"})
    i = client.post("/tesoreria/piani/interventi", json={"descrizione": "Piscina", "fornitore": "PISCINE SRL", "importo_stimato": "10000",
                                                        "inclusa_in_previsione": True}).json()
    _rata_intervento(client, i["id"], f"{FUTURO}-03-31")
    f = client.get(f"/tesoreria/piani/interventi/{i['id']}/fatture").json()
    assert f["candidate"][0]["suggerita"] is True
    r = client.post(f"/tesoreria/piani/interventi/{i['id']}/fatture", json={"chiave": "K1"})
    assert r.status_code == 200, r.text
    assert r.json()["residuo"] == 2000
    assert _impegni_intervento(client)[0]["importo"] == 2000
    assert client.post(f"/tesoreria/piani/interventi/{i['id']}/fatture", json={"chiave": "K1"}).status_code == 409
    fid = client.get(f"/tesoreria/piani/interventi/{i['id']}/fatture").json()["collegate"][0]["id"]
    assert client.delete(f"/tesoreria/piani/interventi/fatture/{fid}").status_code == 200
    assert _impegni_intervento(client)[0]["importo"] == 10000


def test_fatture_coprono_prima_le_rate_piu_vicine(client, test_engine):
    _scadenza(test_engine, importo=4000)
    i = client.post("/tesoreria/piani/interventi", json={"descrizione": "Piscina", "importo_stimato": "10000", "inclusa_in_previsione": True}).json()
    _rata_intervento(client, i["id"], f"{FUTURO}-01-10")
    r = _rata_intervento(client, i["id"], f"{FUTURO}-03-10")
    client.put(f"/tesoreria/piani/interventi/rate/{r['rate'][0]['id']}", json={"percentuale": "30"})
    client.post(f"/tesoreria/piani/interventi/{i['id']}/fatture", json={"chiave": "K1"})
    assert [(x["data_scadenza"], x["importo"]) for x in _impegni_intervento(client)] == [(f"{FUTURO}-03-10", 6000)]


def test_intervento_pagato_quando_la_fattura_esce_dallo_scadenzario(client, test_engine):
    _scadenza(test_engine, importo=10000)
    i = client.post("/tesoreria/piani/interventi", json={"descrizione": "Piscina", "importo_stimato": "10000",
                                                        "inclusa_in_previsione": True}).json()
    _rata_intervento(client, i["id"], f"{FUTURO}-03-31")
    client.post(f"/tesoreria/piani/interventi/{i['id']}/fatture", json={"chiave": "K1"})
    assert client.get("/tesoreria/piani/interventi").json()[0]["stato"] != "pagato"
    with test_engine.begin() as conn:
        conn.execute(text("DELETE FROM tesoreria_scadenze"))
    client.post("/tesoreria/impegni/genera")
    assert client.get("/tesoreria/piani/interventi").json()[0]["stato"] == "pagato"


def test_permessi_viewer(client):
    utente_corrente["u"] = VIEWER
    assert client.get("/tesoreria/piani/affitti").status_code == 200
    assert client.post("/tesoreria/piani/interventi", json={"descrizione": "x"}).status_code == 403
