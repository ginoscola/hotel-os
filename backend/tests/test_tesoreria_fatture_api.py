"""Test Tesoreria Fase 5, blocco B: import degli ZIP di fatture ricevute, stato rispetto allo scadenzario Passcom
e alla banca, debiti da registrare per la previsione, calcoli puri di `services/tesoreria_fatture.py`.

Fatture, scadenze Passcom e movimenti bancari inventati, costruiti nei test. DB dedicato, file in cartella temporanea.
"""
import io
import os
import sys
import zipfile
from datetime import date, timedelta
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
from app.models.tesoreria import (  # noqa: E402
    TesoreriaConto, TesoreriaFornitorePiva, TesoreriaMovimento, TesoreriaScadenza, TesoreriaScadImport,
)
from app.routers.tesoreria_fatture_stato import stato_fatture  # noqa: E402
from app.services.tesoreria_fatture import (  # noqa: E402
    RataXml, compensa_note, giorni_abituali, numero_passcom, rate_da_pagare,
)

from tests._db import TEST_DB_URL  # noqa: E402

ADMIN = SimpleNamespace(id=None, ruolo="admin")
VIEWER = SimpleNamespace(id=None, ruolo="viewer")
utente_corrente = {"u": ADMIN}
OGGI = date.today()
KM = "04569190400"


def fattura_xml(piva, nome, numero, data, totale, tipo="TD01", modalita=None, scadenza=None, rata=None,
                paese="IT") -> bytes:
    pagamento = ""
    if modalita or scadenza or rata:
        pagamento = ("<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento>"
                     + (f"<ModalitaPagamento>{modalita}</ModalitaPagamento>" if modalita else "")
                     + (f"<DataScadenzaPagamento>{scadenza}</DataScadenzaPagamento>" if scadenza else "")
                     + f"<ImportoPagamento>{rata or totale}</ImportoPagamento></DettaglioPagamento></DatiPagamento>")
    imponibile = (Decimal(totale) / Decimal("1.22")).quantize(Decimal("0.01"))
    imposta = Decimal(totale) - imponibile
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
<FatturaElettronicaHeader>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>{paese}</IdPaese><IdCodice>{piva}</IdCodice></IdFiscaleIVA>
<Anagrafica><Denominazione>{nome}</Denominazione></Anagrafica></DatiAnagrafici></CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>{KM}</IdCodice></IdFiscaleIVA>
<Anagrafica><Denominazione>KM Di Mare S.r.l.</Denominazione></Anagrafica></DatiAnagrafici></CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
<DatiGenerali><DatiGeneraliDocumento><TipoDocumento>{tipo}</TipoDocumento><Divisa>EUR</Divisa><Data>{data}</Data>
<Numero>{numero}</Numero><ImportoTotaleDocumento>{totale}</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi><DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>{imponibile}</ImponibileImporto>
<Imposta>{imposta}</Imposta></DatiRiepilogo></DatiBeniServizi>
{pagamento}
</FatturaElettronicaBody>
</p:FatturaElettronica>""".encode()


def _meta(idfile, nome, ricezione: date) -> bytes:
    coppie = {"idfile": idfile, "dataaccoglienza": f"{ricezione.isoformat()}T10:00:00.000+01:00", "nomefile": nome}
    righe = "".join(f"<metadato><nome>{k}</nome><valore>{v}</valore></metadato>" for k, v in coppie.items())
    return (f'<metadatiFattura xmlns="urn:xml.fatturazione.sogei.it">{righe}</metadatiFattura>').encode()


def zip_fatture(voci) -> bytes:
    """voci: [(idfile, ricezione, xml)]"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for idfile, ricezione, xml in voci:
            nome = f"IT{idfile}_x.xml"
            z.writestr(nome, xml)
            z.writestr(nome + "_metaDato.xml", _meta(idfile, nome, ricezione))
    return buf.getvalue()


@pytest.fixture(scope="module")
def test_engine():
    engine = create_engine(TEST_DB_URL)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="module")
def Sessione(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture(scope="module")
def client(Sessione, tmp_path_factory):
    os.environ["TESORERIA_DIR"] = str(tmp_path_factory.mktemp("tesoreria"))

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
        conn.execute(text(
            "TRUNCATE tesoreria_fatture_import, tesoreria_fornitori_piva, tesoreria_abbinamenti, "
            "tesoreria_pagate_manuali, tesoreria_fornitori_banca, tesoreria_movimenti, tesoreria_conti, "
            "tesoreria_scadenze, tesoreria_scad_import, user_module_permissions, module_permissions, modules, users "
            "RESTART IDENTITY CASCADE"))
        conn.execute(text("INSERT INTO modules (code, name, ordine, attivo) VALUES ('tesoreria', 'TESORERIA', 30, true)"))
        conn.execute(text("""
            INSERT INTO module_permissions (module_code, ruolo, puo_vedere, puo_modificare, puo_importare)
            VALUES ('tesoreria', 'admin', true, true, true), ('tesoreria', 'viewer', true, false, false)
        """))


def _importa(client, contenuto, nome="fatture.zip"):
    a = client.post("/tesoreria/fatture/anteprima", files={"file": (nome, contenuto, "application/zip")})
    assert a.status_code == 200, a.text
    k = client.post("/tesoreria/fatture/conferma", json={"token": a.json()["token"]})
    assert k.status_code == 200, k.text
    return a.json(), k.json()


def _passcom(Sessione, ultima_registrazione: date, righe):
    """Fotografia Passcom di oggi. righe: [(codice, fornitore, numero, data_doc, importo, scadenza)]"""
    with Sessione() as db:
        imp = TesoreriaScadImport(data_fotografia=OGGI, anno_contabile=OGGI.year, nome_file="s.xml", sha256="x" * 64)
        db.add(imp)
        db.flush()
        for i, (codice, nome, numero, data_doc, importo, scadenza) in enumerate(righe):
            db.add(TesoreriaScadenza(
                import_id=imp.id, chiave=f"{codice}|P{i}|{scadenza}|{importo}", data_scadenza=scadenza,
                tipo_pagamento="BONIFICO", tipo_documento="FR", registro="1", numero_documento=numero,
                data_documento=data_doc, data_registrazione=ultima_registrazione, protocollo=f"P{i}",
                codice_fornitore=codice, fornitore=nome, importo=Decimal(importo)))
        db.commit()


def _uscita(Sessione, giorno: date, importo, controparte, abi="26//11"):
    with Sessione() as db:
        conto = db.query(TesoreriaConto).first()
        if conto is None:
            conto = TesoreriaConto(codice="CC", nome="Conto", tipo="conto", iban="IT00X0000000000000000000001")
            db.add(conto)
            db.flush()
        db.add(TesoreriaMovimento(conto_id=conto.id, data_contabile=giorno, importo=Decimal(importo),
                                  descrizione=f"Bonifico a {controparte}", controparte=controparte, causale_abi=abi,
                                  impronta=f"H:{controparte}{giorno}{importo}"))
        db.commit()


def _stati(client):
    return {f["numero"]: f["stato"] for f in client.get("/tesoreria/fatture", params={"per_pagina": 500}).json()["fatture"]}


# ── Import ─────────────────────────────────────────────────────────────────────

def test_import_salva_fatture_iva_e_rate_e_riconosce_i_doppioni(client, Sessione):
    ieri = OGGI - timedelta(days=1)
    z = zip_fatture([
        ("1", ieri, fattura_xml("01111111111", "Pesce Fresco Srl", "BA000123", "2026-10-01", "122.00",
                                modalita="MP12", scadenza="2026-11-30")),
        ("2", ieri, fattura_xml("02222222222", "Studio Rossi", "7/2026", "2026-10-02", "500.00")),
    ])
    a, k = _importa(client, z)
    assert a["n_nuove"] == 2 and k["n_nuove"] == 2 and a["ricezione_a"] == ieri.isoformat()
    d = client.get("/tesoreria/fatture", params={"q": "pesce"}).json()["fatture"][0]
    det = client.get(f"/tesoreria/fatture/{d['id']}", params={"xml": True}).json()
    assert det["iva"][0]["aliquota"] == 22.0 and det["scadenze_file"][0]["modalita"] == "MP12"
    assert det["rate"][0]["data_scadenza"] == "2026-11-30" and not det["rate"][0]["data_stimata"]
    assert "Pesce Fresco" in det["xml"]

    # stesso ZIP: riconosciuto e rifiutato alla conferma
    a2 = client.post("/tesoreria/fatture/anteprima", files={"file": ("bis.zip", z, "application/zip")}).json()
    assert a2["gia_importato"] and a2["n_nuove"] == 0 and a2["n_gia_presenti"] == 2
    assert client.post("/tesoreria/fatture/conferma", json={"token": a2["token"]}).status_code == 409

    # ZIP diverso: una già presente per idfile, una con stessa P.IVA + numero + data ma idfile diverso
    z3 = zip_fatture([
        ("1", ieri, fattura_xml("01111111111", "Pesce Fresco Srl", "BA000123", "2026-10-01", "122.00")),
        ("9", ieri, fattura_xml("02222222222", "Studio Rossi", "7/2026", "2026-10-02", "500.00")),
        ("3", ieri, fattura_xml("03333333333", "Carni Spa", "55", "2026-10-03", "61.00")),
    ])
    a3, k3 = _importa(client, z3)
    assert a3["n_nuove"] == 1 and a3["n_gia_presenti"] == 1 and a3["n_doppie_documento"] == 1
    storico = client.get("/tesoreria/fatture/import").json()
    assert [i["n_collegate"] for i in storico] == [1, 2]

    # eliminazione: spariscono solo le fatture inserite per prime da quell'import
    assert client.delete(f"/tesoreria/fatture/import/{storico[0]['id']}").status_code == 400
    assert client.delete(f"/tesoreria/fatture/import/{storico[0]['id']}?conferma=true").json()["fatture_eliminate"] == 1
    assert sorted(_stati(client)) == ["7/2026", "BA000123"]


def test_import_errori(client):
    r = client.post("/tesoreria/fatture/anteprima", files={"file": ("x.zip", b"non zip", "application/zip")})
    assert r.status_code == 400 and "ZIP" in r.json()["detail"]
    utente_corrente["u"] = VIEWER
    z = zip_fatture([("1", OGGI, fattura_xml("01111111111", "A", "1", "2026-10-01", "10.00"))])
    assert client.post("/tesoreria/fatture/anteprima", files={"file": ("x.zip", z, "application/zip")}).status_code == 403
    assert client.get("/tesoreria/fatture").status_code == 200


# ── Stato ──────────────────────────────────────────────────────────────────────

def test_stato_rispetto_a_passcom_e_banca(client, Sessione):
    reg = OGGI - timedelta(days=4)                    # ultima registrazione dello studio → limite = reg − 15
    limite = reg - timedelta(days=15)
    _passcom(Sessione, reg, [
        ("601.00001", "PESCE FRESCO S.R.L.", "123", date(2026, 10, 1), "122.00", date(2026, 11, 30)),
        # stesso numero e data ma altro fornitore: non deve abbinarsi alla fattura di Carni
        ("601.00009", "ALTRO FORNITORE SNC", "55", date(2026, 10, 3), "61.00", date(2026, 11, 3)),
    ])
    _uscita(Sessione, limite - timedelta(days=5), "-250.00", "LUCE E GAS SPA", abi="31//22")
    _importa(client, zip_fatture([
        ("1", limite - timedelta(days=10), fattura_xml("01111111111", "Pesce Fresco Srl", "BA000123", "2026-10-01", "122.00")),
        ("2", limite + timedelta(days=2), fattura_xml("03333333333", "Carni Spa", "55", "2026-10-03", "61.00",
                                                      modalita="MP05", scadenza=(OGGI + timedelta(days=20)).isoformat())),
        ("3", limite - timedelta(days=10), fattura_xml("04444444444", "Ferramenta Bianchi", "88", "2026-09-01", "45.00")),
        ("4", limite - timedelta(days=90), fattura_xml("05555555555", "Vecchio Fornitore", "12", "2026-06-01", "30.00")),
        ("5", limite - timedelta(days=8), fattura_xml("06666666666", "Luce e Gas Spa", "E-900", "2026-09-10", "250.00",
                                                      modalita="MP19", scadenza=(limite - timedelta(days=4)).isoformat())),
        ("6", limite + timedelta(days=1), fattura_xml("IE999", "Pubblicita Ltd", "10/1", "2026-10-05", "12.20",
                                                      tipo="TD17", paese="IE")),
        ("7", limite + timedelta(days=3), fattura_xml("03333333333", "Carni Spa", "NC1", "2026-10-06", "11.00", tipo="TD04")),
    ]))
    stati = _stati(client)
    assert stati == {"BA000123": "in_scadenzario", "55": "da_registrare", "88": "chiusa", "12": "chiusa",
                     "E-900": "pagata_banca", "10/1": "autofattura", "NC1": "da_registrare"}
    with Sessione() as db:
        assert db.query(TesoreriaFornitorePiva).one().codice_fornitore == "601.00001"   # imparato da Passcom
        st = stato_fatture(db)
    # debiti per la previsione: Carni 61 − nota di credito 11 = 50, alla scadenza del file
    assert [(r.fornitore, importo, r.data_scadenza) for r, importo in st["debiti"]] == \
        [("Carni Spa", Decimal("50.00"), OGGI + timedelta(days=20))]

    r = client.get("/tesoreria/fatture", params={"stato": "da_registrare,chiusa"}).json()
    assert r["limite_da_registrare"] == limite.isoformat() and r["totale"] == 4
    assert r["conteggi"]["da_registrare"]["n"] == 2

    # una fattura chiusa ma recente (cercata in banca) segnata pagata a mano con l'endpoint dello scadenzario
    ferr = client.get("/tesoreria/fatture", params={"q": "ferramenta"}).json()["fatture"][0]
    assert ferr["rate"][0]["data_stimata"]
    k = client.post("/tesoreria/scadenzario/pagate-manuali", json={"chiavi": [ferr["rate"][0]["chiave"]]})
    assert k.status_code == 200 and k.json()["segnate"] == 1
    assert _stati(client)["88"] == "pagata_manuale"

    e = client.get("/tesoreria/fatture/da-registrare/export", params={"formato": "csv"})
    assert e.status_code == 200 and "Carni Spa" in e.content.decode("utf-8-sig", "replace")


def test_fattura_da_registrare_entra_in_previsione(client, Sessione):
    reg = OGGI - timedelta(days=1)
    _passcom(Sessione, reg, [("601.00001", "ALTRO", "1", date(2026, 1, 1), "10.00", OGGI + timedelta(days=200))])
    scad = OGGI + timedelta(days=40)
    _importa(client, zip_fatture([("1", OGGI, fattura_xml("03333333333", "Carni Spa", "77", OGGI.isoformat(), "305.00",
                                                          modalita="MP12", scadenza=scad.isoformat()))]))
    p = client.get("/tesoreria/previsione")
    assert p.status_code == 200, p.text
    righe = p.json()["scenari"]["realista"]
    mese = next(r for r in righe if (r["anno"], r["mese"]) == (scad.year, scad.month))
    assert mese["uscite_certe"]["fatture"] == 305.0


# ── Calcoli puri ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("numero,atteso", [
    ("BA046401", "46401"), ("991/2026", "912026"), ("351697231", "697231"), ("4127/PV", "4127"),
    ("INR1379163", "379163"), ("it-I-01192347", "192347"), ("NC", ""),
])
def test_numero_passcom(numero, atteso):
    assert numero_passcom(numero) == atteso


def _f(**k):
    base = dict(impronta="SDI:1", nota_credito=False, numero="1", data_documento=date(2026, 10, 1),
                cedente_denominazione="X", totale=Decimal("1220.00"), ritenuta=None, rate=[])
    base.update(k)
    return SimpleNamespace(**base)


def _r(numero, modalita, scad, importo):
    return SimpleNamespace(numero=numero, modalita=modalita, data_scadenza=scad, importo=importo)


def test_rate_da_pagare():
    # parcella con ritenuta e senza rate: totale − ritenuta, data stimata dai giorni abituali
    r = rate_da_pagare(_f(ritenuta=Decimal("200.00")), "C", 45)
    assert [(x.importo, x.data_scadenza, x.data_stimata, x.tipo_pagamento) for x in r] == \
        [(Decimal("1020.00"), date(2026, 11, 15), True, "NON INDICATA")]
    # due rate con importo: si usano quelle, con la modalità del file
    r = rate_da_pagare(_f(rate=[_r(1, "MP12", date(2026, 11, 30), Decimal("610.00")),
                                _r(2, "MP12", date(2026, 12, 31), Decimal("610.00"))]), "C", None)
    assert [(x.chiave, x.tipo_pagamento, x.importo) for x in r] == \
        [("XML:SDI:1#1", "RIC.BANC.", Decimal("610.00")), ("XML:SDI:1#2", "RIC.BANC.", Decimal("610.00"))]
    # rata senza importo: totale, con la data del file; nota di credito negativa
    r = rate_da_pagare(_f(nota_credito=True, totale=Decimal("50.00"), rate=[_r(1, "MP05", date(2026, 10, 20), None)]), "C", None)
    assert [(x.importo, x.data_scadenza, x.data_stimata) for x in r] == [(Decimal("-50.00"), date(2026, 10, 20), False)]


def test_compensa_note_e_giorni_abituali():
    def rata(forn, scad, imp):
        return RataXml(chiave=f"{forn}{scad}", impronta="x", numero_rata=1, data_scadenza=scad, data_stimata=False,
                       tipo_pagamento="BONIFICO", codice_fornitore=forn, fornitore=forn, importo=Decimal(imp),
                       numero_documento=None, data_documento=None)
    rate = [rata("A", date(2026, 11, 1), "100"), rata("A", date(2026, 12, 1), "100"), rata("A", date(2026, 11, 5), "-150"),
            rata("B", date(2026, 11, 2), "40"), rata("C", date(2026, 11, 3), "-10")]
    assert [(r.codice_fornitore, imp) for r, imp in compensa_note(rate)] == [("B", Decimal("40")), ("A", Decimal("50"))]
    g = giorni_abituali([("P", date(2026, 1, 1), date(2026, 1, 31)), ("P", date(2026, 2, 1), date(2026, 3, 3)),
                         ("P", date(2026, 3, 1), date(2026, 5, 30)), ("Q", date(2026, 1, 1), None)])
    assert g == {"P": 30}


def test_iva_mensile_da_vendite_e_fatture(client, Sessione, monkeypatch):
    import app.routers.tesoreria_iva as modulo_iva
    anno = OGGI.year - 1                                   # anno concluso: tutti i mesi completi
    monkeypatch.setattr(modulo_iva, "_mesi_in_stagione", lambda db, a: {7, 8})
    monkeypatch.setattr(modulo_iva, "vendite_iva_per_mese", lambda db, a: (
        {(a, 7): Decimal("100.00"), (a, 8): Decimal("900.00")}, {(a, 7): Decimal("1100"), (a, 8): Decimal("9900")}))
    _importa(client, zip_fatture([
        ("1", date(anno, 7, 10), fattura_xml("01111111111", "Pesce Fresco Srl", "1", f"{anno}-07-10", "610.00")),
        ("2", date(anno, 8, 10), fattura_xml("01111111111", "Pesce Fresco Srl", "2", f"{anno}-08-10", "122.00")),
        ("3", date(anno, 8, 11), fattura_xml("IE1", "Ads Ltd", "3", f"{anno}-08-11", "1220.00", tipo="TD17", paese="IE")),
        ("4", date(anno, 12, 30), fattura_xml("01111111111", "Pesce Fresco Srl", "4", f"{anno}-12-30", "12.20")),
        ("5", OGGI, fattura_xml("01111111111", "Pesce Fresco Srl", "5", OGGI.isoformat(), "12.20")),
    ]))
    r = client.get("/tesoreria/iva", params={"anno": anno}).json()
    mesi = {m["mese"]: m for m in r["mesi"]}
    assert mesi[7]["acquisti"] == 110.0 and mesi[7]["saldo"] == -10.0 and mesi[7]["versamento"] == 0
    # agosto: 900 − 22 (autofattura esclusa) − 10 di credito = 868 da versare il 16/9
    assert mesi[8]["acquisti"] == 22.0 and mesi[8]["versamento"] == 868.0 and mesi[8]["scadenza"] == f"{anno}-09-16"
    assert r["credito_fine_anno"] == 2.2 and all(m["completo"] for m in r["mesi"])


def test_fattura_sdi_collegata_a_spesa_straordinaria_poi_registrata(client, Sessione, test_engine):
    from sqlalchemy import text
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE tesoreria_interventi, tesoreria_impegni RESTART IDENTITY CASCADE"))
    reg = OGGI - timedelta(days=1)
    _passcom(Sessione, reg, [("601.00001", "ALTRO", "1", date(2026, 1, 1), "10.00", OGGI + timedelta(days=200))])
    scad = OGGI + timedelta(days=40)
    _importa(client, zip_fatture([("1", OGGI, fattura_xml("03333333333", "Piscine Spa", "77", OGGI.isoformat(), "3050.00",
                                                          modalita="MP05", scadenza=scad.isoformat()))]))
    i = client.post("/tesoreria/piani/interventi", json={"descrizione": "Piscina", "fornitore": "Piscine Spa", "importo_stimato": "10000"}).json()
    f = client.get(f"/tesoreria/piani/interventi/{i['id']}/fatture").json()
    sdi = next(c for c in f["candidate"] if c["origine"] == "sdi")
    assert sdi["suggerita"] is True and sdi["importo"] == 3050
    r = client.post(f"/tesoreria/piani/interventi/{i['id']}/fatture", json={"chiave": sdi["chiave"]})
    assert r.status_code == 200, r.text
    assert r.json()["residuo"] == 6950
    mese = next(x for x in client.get("/tesoreria/previsione").json()["scenari"]["realista"] if (x["anno"], x["mese"]) == (scad.year, scad.month))
    assert mese["uscite_certe"].get("interventi") == 3050 and "fatture" not in mese["uscite_certe"]
    # lo studio la registra: il collegamento passa alla scadenza Passcom
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE tesoreria_scadenze, tesoreria_scad_import RESTART IDENTITY CASCADE"))
    _passcom(Sessione, OGGI, [("601.00002", "PISCINE SPA", "77", OGGI, "3050.00", scad)])
    client.post("/tesoreria/impegni/genera")
    collegate = client.get(f"/tesoreria/piani/interventi/{i['id']}/fatture").json()["collegate"]
    assert [(c["origine"], c["importo"]) for c in collegate] == [("passcom", 3050)]


def test_fattura_chiusa_assegnata_a_spesa_esce_dallo_storico(client, Sessione, test_engine):
    """Fattura vecchia e chiusa assegnata dalla scheda Fatture: modalità e data proposte dalla fattura, modificabili;
    l'importo esce dallo storico delle uscite (Ri.Ba.) del mese di pagamento, mai oltre quanto uscito."""
    from app.models.tesoreria import TesoreriaCategoria
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE tesoreria_interventi, tesoreria_impegni, tesoreria_categorie RESTART IDENTITY CASCADE"))
    reg = OGGI - timedelta(days=1)
    _passcom(Sessione, reg, [("601.00001", "ALTRO", "1", date(2026, 1, 1), "10.00", OGGI + timedelta(days=200))])
    ricevuta = OGGI - timedelta(days=300)
    scad = ricevuta + timedelta(days=30)
    _importa(client, zip_fatture([
        ("1", ricevuta, fattura_xml("03333333333", "Arredi Spa", "77", ricevuta.isoformat(), "305.00",
                                    modalita="MP12", scadenza=scad.isoformat())),
        ("2", ricevuta, fattura_xml("03333333333", "Arredi Spa", "78", ricevuta.isoformat(), "50.00", tipo="TD17")),
    ]))
    with Sessione() as db:
        cat = TesoreriaCategoria(codice="fornitori_riba", nome="Fornitori Ri.Ba.", tipo="uscita")
        db.add(cat)
        db.commit()
        cat_id = cat.id
    _uscita(Sessione, scad, "-1000.00", "RIBA CUMULATIVA", abi="31//48")
    with Sessione() as db:
        db.query(TesoreriaMovimento).update({TesoreriaMovimento.categoria_id: cat_id})
        db.commit()
    elenco = client.get("/tesoreria/fatture", params={"per_pagina": 500}).json()["fatture"]
    ids = {f["numero"]: f["id"] for f in elenco}
    assert {f["numero"]: f["stato"] for f in elenco}["77"] == "chiusa"
    i = client.post("/tesoreria/piani/interventi", json={"descrizione": "Sala da pranzo", "anno": 2026}).json()
    assert i["anno"] == 2026
    r = client.post(f"/tesoreria/piani/interventi/{i['id']}/fatture-sdi", json={"fattura_ids": [ids["77"], ids["78"]]})
    assert r.status_code == 200, r.text
    assert r.json()["n_nuove"] == 1 and len(r.json()["saltate"]) == 1      # l'autofattura non si assegna
    assert r.json()["spesa"]["costo_finale"] == 305
    f = client.get(f"/tesoreria/piani/interventi/{i['id']}/fatture").json()["collegate"][0]
    assert f["modalita_pagamento"] == "riba" and f["data_pagamento"] == scad.isoformat()
    # la scheda Fatture mostra la spesa e filtra
    assegnate = client.get("/tesoreria/fatture", params={"spesa": "si"}).json()["fatture"]
    assert [x["numero"] for x in assegnate] == ["77"] and assegnate[0]["spesa"]["descrizione"] == "Sala da pranzo"
    p = client.get("/tesoreria/previsione").json()
    assert p["straordinarie_tolte"] == [{"categoria": "fornitori_riba", "categoria_nome": "Fornitori Ri.Ba.",
                                         "anno": scad.year, "mese": scad.month, "importo": 305.0}]
    # contanti: niente da togliere
    assert client.put(f"/tesoreria/piani/interventi/fatture/{f['id']}", json={"modalita_pagamento": "contanti"}).status_code == 200
    assert client.get("/tesoreria/previsione").json()["straordinarie_tolte"] == []
    assert client.put(f"/tesoreria/piani/interventi/fatture/{f['id']}", json={"modalita_pagamento": "xx"}).status_code == 400
    # riassegnata a un'altra spesa: si sposta con la sua modalità
    j = client.post("/tesoreria/piani/interventi", json={"descrizione": "Altro lavoro"}).json()
    r = client.post(f"/tesoreria/piani/interventi/{j['id']}/fatture-sdi", json={"fattura_ids": [ids["77"]]})
    assert r.json()["n_spostate"] == 1
    assert client.get(f"/tesoreria/piani/interventi/{j['id']}/fatture").json()["collegate"][0]["modalita_pagamento"] == "contanti"


def test_fattura_leggibile_e_pdf_del_fornitore(client):
    """Righe della fattura dall'XML salvato; allegati letti dallo ZIP originale: PDF nel browser, il resto scaricato."""
    import base64
    pdf = b"%PDF-1.4 finto"
    xml = fattura_xml("03333333333", "Arredi Spa", "77", OGGI.isoformat(), "122.00", modalita="MP05",
                      scadenza=OGGI.isoformat()).decode()
    xml = xml.replace("<DatiBeniServizi>", "<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea>"
                      "<Descrizione>TAVOLO ROVERE 80x80</Descrizione><Quantita>2.00</Quantita><UnitaMisura>PZ</UnitaMisura>"
                      "<PrezzoUnitario>50.00</PrezzoUnitario><PrezzoTotale>100.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA>"
                      "</DettaglioLinee>")
    xml = xml.replace("</FatturaElettronicaBody>",
                      f"<Allegati><NomeAttachment>fattura.pdf</NomeAttachment><FormatoAttachment>PDF</FormatoAttachment>"
                      f"<Attachment>{base64.b64encode(pdf).decode()}</Attachment></Allegati>"
                      f"<Allegati><NomeAttachment>nota.html</NomeAttachment><FormatoAttachment>HTML</FormatoAttachment>"
                      f"<Attachment>{base64.b64encode(b'<script>x</script>').decode()}</Attachment></Allegati>"
                      "</FatturaElettronicaBody>")
    _importa(client, zip_fatture([("1", OGGI, xml.encode())]))
    fid = client.get("/tesoreria/fatture").json()["fatture"][0]["id"]
    d = client.get(f"/tesoreria/fatture/{fid}/documento")
    assert d.status_code == 200, d.text
    d = d.json()
    assert d["tipo_nome"] == "Fattura" and d["cedente"]["denominazione"] == "Arredi Spa"
    assert d["righe"] == [{"numero": "1", "codice": None, "descrizione": "TAVOLO ROVERE 80x80", "quantita": 2.0, "unita": "PZ",
                           "prezzo_unitario": 50.0, "sconti": None, "prezzo_totale": 100.0, "aliquota": 22.0, "natura": None}]
    assert d["pagamenti"][0]["modalita"] == "Bonifico"
    assert [(a["nome"], a["formato"]) for a in d["allegati"]] == [("fattura.pdf", "pdf"), ("nota.html", "html")]
    r = client.get(f"/tesoreria/fatture/{fid}/allegati/0")
    assert r.status_code == 200 and r.content == pdf and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("inline")
    r = client.get(f"/tesoreria/fatture/{fid}/allegati/1")
    assert r.headers["content-type"] == "application/octet-stream" and r.headers["content-disposition"].startswith("attachment")
    assert client.get(f"/tesoreria/fatture/{fid}/allegati/5").status_code == 404


def test_fattura_vecchia_pagata_da_bonifico_gia_straordinario_non_tolta_due_volte(client, Sessione, test_engine):
    """Fattura chiusa, non abbinata, pagata da un bonifico di pari importo già segnato straordinario: niente da togliere
    e data vera del bonifico proposta al collegamento."""
    from app.models.tesoreria import TesoreriaCategoria
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE tesoreria_interventi, tesoreria_impegni, tesoreria_categorie RESTART IDENTITY CASCADE"))
    _passcom(Sessione, OGGI - timedelta(days=1), [("601.00001", "ALTRO", "1", date(2026, 1, 1), "10.00", OGGI + timedelta(days=200))])
    ricevuta = OGGI - timedelta(days=300)
    scad = ricevuta + timedelta(days=30)
    _importa(client, zip_fatture([("1", ricevuta, fattura_xml("03333333333", "B &amp; T S.r.l.", "77", ricevuta.isoformat(),
                                                              "5544.90", modalita="MP05", scadenza=scad.isoformat()))]))
    with Sessione() as db:
        cat = TesoreriaCategoria(codice="fornitori_bonifici", nome="Fornitori – bonifici", tipo="uscita")
        db.add(cat)
        db.commit()
        cat_id = cat.id
    pagato = scad - timedelta(days=1)
    _uscita(Sessione, pagato, "-5544.90", "B&T srl Dorelan")
    _uscita(Sessione, pagato, "-1000.00", "ALTRO FORNITORE")
    with Sessione() as db:
        db.query(TesoreriaMovimento).update({TesoreriaMovimento.categoria_id: cat_id})
        db.query(TesoreriaMovimento).filter(TesoreriaMovimento.importo == Decimal("-5544.90")).update({TesoreriaMovimento.straordinario: True})
        db.commit()
    fid = client.get("/tesoreria/fatture").json()["fatture"][0]["id"]
    i = client.post("/tesoreria/piani/interventi", json={"descrizione": "Progetto 4 stelle", "anno": 2025}).json()
    assert client.post(f"/tesoreria/piani/interventi/{i['id']}/fatture-sdi", json={"fattura_ids": [fid]}).status_code == 200
    f = client.get(f"/tesoreria/piani/interventi/{i['id']}/fatture").json()["collegate"][0]
    assert f["data_pagamento"] == pagato.isoformat() and f["pagamento_banca"] == {"data": pagato.isoformat(), "straordinario": True}
    p = client.get("/tesoreria/previsione").json()
    assert p["straordinarie_tolte"] == [] and not any("Spese straordinarie" in a for a in p["avvisi"])
    # linea "senza le spese straordinarie" sul passato: il bonifico straordinario conta una volta sola
    from app.routers.tesoreria_previsione import _straordinarie_pagate, dati_previsione
    with Sessione() as db:
        pagate = _straordinarie_pagate(db, dati_previsione(db, OGGI), date(2000, 1, 1))
    assert pagate == {(pagato.year, pagato.month): Decimal("5544.90")}
