"""Test integrazione impegni della Tesoreria: generazione idempotente, conferme, credito, abbinamento, permessi,
avviso TARI (PDF finto con reportlab). DB dedicato, file in cartella temporanea."""
import io
import os
import sys
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from reportlab.pdfgen import canvas  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from app.auth import richiedi_admin, richiedi_utente_attivo  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services.tesoreria_parser import ErroreImportTesoreria  # noqa: E402
from app.services.tesoreria_tari_parser import parse_avviso_tari  # noqa: E402

from tests._db import TEST_DB_URL  # noqa: E402

ADMIN = SimpleNamespace(id=None, ruolo="admin")
VIEWER = SimpleNamespace(id=None, ruolo="viewer")
utente_corrente = {"u": ADMIN}
ANNO = date.today().year + 1


def _pdf(righe):
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for r in righe:
        c.drawString(40, y, r)
        y -= 14
    c.save()
    return buf.getvalue()


def _avviso(fase="conguaglio", rate=(("1", f"01-12-{ANNO}", "100,00"), ("RATA UNICA", f"01-12-{ANNO}", "100,00"))):
    return _pdf([
        f"Avviso di Pagamento Tassa sui rifiuti (TARI) n. 99 del 23-10-{ANNO} ANNO {ANNO}. Emissione a {fase}.",
        "Totale Avviso 100,00 EUR",
        f"Riepilogo e scadenze dei versamenti TARI {ANNO} del suddetto Avviso di Pagamento:",
        "Rata n data scadenza importo",
        *[f"{n} {d} {i}" for n, d, i in rate],
        "Situazione precedenti avvisi",
        f"1 30-06-{ANNO} 777,00",
    ])


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
        conn.execute(text("TRUNCATE tesoreria_impegni, tesoreria_movimenti, tesoreria_categorie, tesoreria_conti, "
                          "app_config, user_module_permissions, module_permissions, modules, users "
                          "RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO modules (code, name, ordine, attivo) VALUES ('tesoreria', 'TESORERIA', 30, true)"))
        conn.execute(text("""
            INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
            VALUES ('tesoreria', 'admin', true, true, true), ('tesoreria', 'viewer', true, false, false)
        """))


def _parametri(client, **extra):
    corpo = {"orizzonte": f"{ANNO}-12-31", "fissi": [
        {"codice": "7085", "descrizione": "Libri sociali", "mese": 3, "giorno": 16, "importo": 309.87}], **extra}
    r = client.put("/tesoreria/impegni/parametri", json=corpo)
    assert r.status_code == 200, r.text


def _impegni(client):
    return {i["codice"]: i for i in client.get("/tesoreria/impegni").json()["impegni"]}


def test_generazione_idempotente_e_conferma_mai_sovrascritta(client):
    _parametri(client)
    assert client.post("/tesoreria/impegni/genera").json()["n_nuovi"] > 0
    prima = _impegni(client)
    codice = f"tributo_fisso:7085:{ANNO}"
    assert prima[codice]["importo"] == 309.87 and prima[codice]["stato"] == "stimato"

    nuova_data = f"{ANNO}-03-20"
    r = client.put(f"/tesoreria/impegni/{prima[codice]['id']}", json={"importo_confermato": 400, "data_scadenza": nuova_data})
    assert r.json()["stato"] == "confermato"

    _parametri(client, fissi=[{"codice": "7085", "descrizione": "Libri sociali", "mese": 3, "giorno": 16, "importo": 350}])
    esito = client.post("/tesoreria/impegni/genera").json()
    assert esito["n_nuovi"] == 0
    dopo = _impegni(client)[codice]
    assert dopo["importo"] == 400 and dopo["data_scadenza"] == nuova_data and dopo["importo_stimato"] == 350


def test_voce_non_piu_prevista_rimossa_salvo_confermata(client):
    fissi = [{"codice": "A", "descrizione": "A", "mese": 3, "giorno": 16, "importo": 1},
             {"codice": "B", "descrizione": "B", "mese": 4, "giorno": 16, "importo": 2}]
    _parametri(client, fissi=fissi)
    client.post("/tesoreria/impegni/genera")
    i = _impegni(client)
    client.put(f"/tesoreria/impegni/{i[f'tributo_fisso:B:{ANNO}']['id']}", json={"importo_confermato": 5})
    _parametri(client, fissi=[])
    assert client.post("/tesoreria/impegni/genera").json()["n_rimossi"] == 1
    assert f"tributo_fisso:B:{ANNO}" in _impegni(client) and f"tributo_fisso:A:{ANNO}" not in _impegni(client)


def test_credito_copre_e_tari_resta_esclusa(client):
    _parametri(client, crediti_iva=[{"importo": 100, "disponibile_dal": "2020-01-01"}], tari_totali={str(ANNO - 1): 1000})
    esito = client.post("/tesoreria/impegni/genera").json()
    i = _impegni(client)
    fisso = i[f"tributo_fisso:7085:{ANNO}"]
    assert fisso["coperto_credito"] == 100 and fisso["da_pagare"] == 209.87
    assert i[f"tari:{ANNO}:acconto"]["coperto_credito"] == 0
    assert esito["credito_residuo"] == 0


def test_credito_copre_tutto_vista_coperto(client):
    _parametri(client, crediti_iva=[{"importo": 1000, "disponibile_dal": "2020-01-01"}])
    client.post("/tesoreria/impegni/genera")
    assert _impegni(client)[f"tributo_fisso:7085:{ANNO}"]["stato_vista"] == "coperto"


def _movimento(test_engine, categoria, giorno, importo):
    with test_engine.begin() as conn:
        conn.execute(text("INSERT INTO tesoreria_conti (codice, nome, tipo) VALUES ('C', 'C', 'conto') ON CONFLICT DO NOTHING"))
        conn.execute(text("INSERT INTO tesoreria_categorie (codice, nome, tipo) VALUES (:c, :c, 'uscita') ON CONFLICT DO NOTHING"), {"c": categoria})
        return conn.execute(text("""
            INSERT INTO tesoreria_movimenti (conto_id, data_contabile, importo, descrizione, impronta, categoria_id)
            SELECT (SELECT id FROM tesoreria_conti LIMIT 1), :g, :i, 'Delega Unificata', :imp,
                   (SELECT id FROM tesoreria_categorie WHERE codice = :c) RETURNING id
        """), {"g": giorno, "i": importo, "imp": f"X{giorno}{importo}", "c": categoria}).scalar()


def test_abbinamento_esatto_chiude_e_diverso_propone(client, test_engine):
    domani = date.today() + timedelta(days=1)
    a = client.post("/tesoreria/impegni", json={"descrizione": "Esatto", "data_scadenza": domani.isoformat(), "importo": 100}).json()
    b = client.post("/tesoreria/impegni", json={"descrizione": "Diverso", "data_scadenza": (domani + timedelta(days=30)).isoformat(), "importo": 100}).json()
    m1 = _movimento(test_engine, "f24", domani + timedelta(days=2), Decimal("-100.00"))
    m2 = _movimento(test_engine, "f24", domani + timedelta(days=31), Decimal("-120.00"))
    assert client.post("/tesoreria/impegni/abbina").json() == {"automatici": 1, "proposti": 1}
    i = {x["id"]: x for x in client.get("/tesoreria/impegni").json()["impegni"]}
    assert i[a["id"]]["stato"] == "pagato" and i[a["id"]]["movimento_id"] == m1
    assert i[b["id"]]["stato"] == "confermato" and i[b["id"]]["abbinamento"] == "proposto"

    r = client.post(f"/tesoreria/impegni/{b['id']}/abbinamento", json={"azione": "scarta"})
    assert r.status_code == 200 and r.json()[0]["movimento_id"] is None
    assert client.post("/tesoreria/impegni/abbina").json()["proposti"] == 0   # lo scarto resta
    assert m2


def test_gruppo_stessa_scadenza_un_solo_addebito(client, test_engine):
    giorno = date.today() + timedelta(days=5)
    for d, imp in (("A", 60), ("B", 40)):
        client.post("/tesoreria/impegni", json={"descrizione": d, "data_scadenza": giorno.isoformat(), "importo": imp})
    _movimento(test_engine, "f24", giorno, Decimal("-100.00"))
    assert client.post("/tesoreria/impegni/abbina").json()["automatici"] == 2


def test_permessi(client):
    utente_corrente["u"] = VIEWER
    assert client.get("/tesoreria/impegni").status_code == 200
    assert client.post("/tesoreria/impegni/genera").status_code == 403
    assert client.put("/tesoreria/impegni/parametri", json={}).status_code == 403


def test_voce_calendario_non_eliminabile_manuale_si(client):
    _parametri(client)
    client.post("/tesoreria/impegni/genera")
    i = _impegni(client)[f"tributo_fisso:7085:{ANNO}"]
    assert client.delete(f"/tesoreria/impegni/{i['id']}").status_code == 400
    m = client.post("/tesoreria/impegni", json={"descrizione": "X", "data_scadenza": f"{ANNO}-01-10", "importo": 1}).json()
    assert client.delete(f"/tesoreria/impegni/{m['id']}").status_code == 200


def test_parser_tari_rata_unica_ignora_precedenti():
    a = parse_avviso_tari(_avviso())
    assert (a.numero, a.anno, a.fase, a.totale) == ("99", ANNO, "conguaglio", Decimal("100.00"))
    assert [r.numero for r in a.rate] == ["RATA UNICA"]


def test_parser_tari_rifiuta_scansione_e_somma_errata():
    with pytest.raises(ErroreImportTesoreria, match="scansione"):
        parse_avviso_tari(_pdf([""]))
    with pytest.raises(ErroreImportTesoreria, match="sommano"):
        parse_avviso_tari(_avviso(rate=(("1", f"01-12-{ANNO}", "90,00"),)))


def test_avviso_tari_sostituisce_la_stima(client):
    _parametri(client, tari_totali={str(ANNO - 1): 1000})
    client.post("/tesoreria/impegni/genera")
    assert f"tari:{ANNO}:conguaglio" in _impegni(client)

    r = client.post("/tesoreria/impegni/tari/anteprima", files={"file": ("avviso.pdf", _avviso(), "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["totale"] == 100 and _impegni(client)[f"tari:{ANNO}:conguaglio"]["importo"] == 250
    c = client.post("/tesoreria/impegni/tari/conferma", json={"token": r.json()["token"]})
    assert c.status_code == 200, c.text

    client.post("/tesoreria/impegni/genera")
    i = _impegni(client)
    assert f"tari:{ANNO}:conguaglio" not in i
    assert i[f"tari:{ANNO}:conguaglio:1"]["importo"] == 100
    assert i[f"tari:{ANNO}:conguaglio:1"]["fonte"] == "avviso"
    assert f"tari:{ANNO}:acconto" in i


def _due_f24_e_credito(client):
    """Due F24 manuali da 100 € (domani e fra 10 giorni) e 100 € di credito IVA: lo prende il primo."""
    _parametri(client, crediti_iva=[{"importo": 100, "disponibile_dal": "2020-01-01"}])
    domani = date.today() + timedelta(days=1)
    a = client.post("/tesoreria/impegni", json={"descrizione": "F24 A", "data_scadenza": domani.isoformat(),
                                               "importo": 100, "compensabile": True}).json()
    b = client.post("/tesoreria/impegni", json={"descrizione": "F24 B", "data_scadenza": (domani + timedelta(days=10)).isoformat(),
                                               "importo": 100, "compensabile": True}).json()
    client.post("/tesoreria/impegni/genera")
    i = {x["id"]: x for x in client.get("/tesoreria/impegni").json()["impegni"]}
    assert i[a["id"]]["stato_vista"] == "coperto" and i[b["id"]]["da_pagare"] == 100
    return a, b, domani


def test_senza_credito_passa_il_credito_al_successivo(client):
    a, b, _ = _due_f24_e_credito(client)
    r = client.put(f"/tesoreria/impegni/{a['id']}", json={"senza_credito": True})
    assert r.status_code == 200 and r.json()["senza_credito"] is True and r.json()["da_pagare"] == 100
    i = {x["id"]: x for x in client.get("/tesoreria/impegni").json()["impegni"]}
    assert i[b["id"]]["coperto_credito"] == 100 and i[b["id"]]["da_pagare"] == 0
    # togliendo la spunta torna come prima
    client.put(f"/tesoreria/impegni/{a['id']}", json={"senza_credito": False})
    i = {x["id"]: x for x in client.get("/tesoreria/impegni").json()["impegni"]}
    assert i[a["id"]]["coperto_credito"] == 100 and i[b["id"]]["coperto_credito"] == 0


def test_senza_credito_solo_su_f24(client):
    m = client.post("/tesoreria/impegni", json={"descrizione": "Bonifico", "data_scadenza": f"{ANNO}-01-10", "importo": 1}).json()
    assert client.put(f"/tesoreria/impegni/{m['id']}", json={"senza_credito": True}).status_code == 400


def test_f24_coperto_pagato_in_banca_proposto_e_conferma_libera_il_credito(client, test_engine):
    a, b, domani = _due_f24_e_credito(client)
    mov = _movimento(test_engine, "f24", domani + timedelta(days=1), Decimal("-100.00"))
    assert client.post("/tesoreria/impegni/abbina").json()["proposti"] == 1    # mai automatico
    i = {x["id"]: x for x in client.get("/tesoreria/impegni").json()["impegni"]}
    assert i[a["id"]]["abbinamento"] == "proposto" and i[a["id"]]["movimento_id"] == mov
    r = client.post(f"/tesoreria/impegni/{a['id']}/abbinamento", json={"azione": "conferma"})
    assert r.json()[0]["stato"] == "pagato" and r.json()[0]["senza_credito"] is True
    i = {x["id"]: x for x in client.get("/tesoreria/impegni").json()["impegni"]}
    assert i[b["id"]]["coperto_credito"] == 100


def test_conferma_con_credito_usato_non_spunta(client, test_engine):
    """Addebito pari al netto del credito: lo studio l'ha usato, la casella resta vuota."""
    _parametri(client, crediti_iva=[{"importo": 40, "disponibile_dal": "2020-01-01"}])
    domani = date.today() + timedelta(days=1)
    a = client.post("/tesoreria/impegni", json={"descrizione": "F24", "data_scadenza": domani.isoformat(),
                                               "importo": 100, "compensabile": True}).json()
    client.post("/tesoreria/impegni/genera")
    _movimento(test_engine, "f24", domani, Decimal("-60.00"))
    assert client.post("/tesoreria/impegni/abbina").json()["automatici"] == 1
    _movimento(test_engine, "f24", domani, Decimal("-1.00"))   # non tocca l'impegno già pagato
    i = {x["id"]: x for x in client.get("/tesoreria/impegni").json()["impegni"]}
    assert i[a["id"]]["stato"] == "pagato" and i[a["id"]]["senza_credito"] is False
