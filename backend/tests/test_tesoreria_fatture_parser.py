"""Test del lettore degli ZIP di fatture ricevute (modulo Tesoreria, Fase 5).

Fatture inventate in tests/fixtures/tesoreria/fatture/ (differita con 2 aliquote, DDT e allegato; parcella
con ritenuta e 2 rate; nota di credito senza totale; autofattura TD17 estera; fattura emessa dall'azienda;
copia della differita firmata .p7m). Gli ZIP e i metaDato SDI sono costruiti nei test. Nessun database.
"""
import base64
import io
import os
import sys
import zipfile
from datetime import date
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_fatture_parser import (  # noqa: E402
    ErroreImportTesoreria, parse_fattura_xml, parse_zip_fatture,
)

DIR = os.path.join(os.path.dirname(__file__), "fixtures", "tesoreria", "fatture")


def _file(nome: str) -> bytes:
    with open(os.path.join(DIR, nome), "rb") as f:
        return f.read()


def _meta(idfile: str, nomefile: str, ricezione: str) -> bytes:
    coppie = {"idfile": idfile, "dataaccoglienza": ricezione, "nomefile": nomefile,
              "cessionariopiva": "04569190400"}
    righe = "".join(f"<metadato><nome>{k}</nome><valore>{v}</valore></metadato>" for k, v in coppie.items())
    return (f'<?xml version="1.0" encoding="UTF-8"?><metadatiFattura xmlns="urn:xml.fatturazione.sogei.it">'
            f"{righe}</metadatiFattura>").encode()


def _zip(voci: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nome, dati in voci.items():
            z.writestr(nome, dati)
    return buf.getvalue()


def _zip_ade() -> bytes:
    """ZIP come quello dell'AdE: file + metaDato, un nome con il prefisso idfile, una fattura con BOM."""
    return _zip({
        "IT01234567890_aaaa1.xml": _file("differita.xml"),
        "IT01234567890_aaaa1.xml_metaDato.xml": _meta("100", "IT01234567890_aaaa1.xml", "2026-10-02T09:00:00.000+02:00"),
        "IT09876543210_bbbb2.XML": b"\xef\xbb\xbf" + _file("parcella.xml"),
        "IT09876543210_bbbb2.XML_metaDato.xml": _meta("101", "IT09876543210_bbbb2.XML", "2026-10-06T10:00:00.000+02:00"),
        # omonimo: nello ZIP il file ha davanti l'idfile, il metaDato riporta il nome senza
        "102_IT01234567890_cccc3.xml": _file("nota_credito.xml"),
        "102_IT01234567890_cccc3.xml_metaDato.xml": _meta("102", "IT01234567890_cccc3.xml", "2026-10-11T08:00:00.000+02:00"),
        "IT04569190400_dddd4.xml": _file("autofattura.xml"),
        "IT04569190400_dddd4.xml_metaDato.xml": _meta("103", "IT04569190400_dddd4.xml", "2026-09-30T19:00:00.000+02:00"),
        "IT01234567890_eeee5.xml.p7m": _file("firmata.xml.p7m"),
        "IT01234567890_eeee5.xml.p7m_metaDato.xml": _meta("104", "IT01234567890_eeee5.xml.p7m", "2026-10-03T12:00:00.000+02:00"),
    })


@pytest.fixture(scope="module")
def ris():
    return parse_zip_fatture(_zip_ade())


def _per_numero(ris):
    return {f.numero: f for f in ris.fatture}


def test_zip_ade_letto_per_intero(ris):
    assert ris.n_file == 5 and len(ris.fatture) == 5 and ris.errori == []
    assert ris.ricezione_da == date(2026, 9, 30) and ris.ricezione_a == date(2026, 10, 11)
    # ordinate per ricezione, impronta dall'idfile SDI
    assert [f.id_sdi for f in ris.fatture] == ["103", "100", "104", "101", "102"]
    assert all(f.impronta == f"SDI:{f.id_sdi}" for f in ris.fatture)


def test_differita_riepiloghi_rate_ddt_allegati(ris):
    f = _per_numero(ris)["123/PV"]
    assert f.tipo_documento == "TD24" and f.data_documento == date(2026, 9, 30)
    assert f.cedente_piva == "01234567890" and f.cedente_paese == "IT"
    assert f.cedente_denominazione == "Alimentari Finti S.r.l."
    assert f.totale == Decimal("132.00") and not f.totale_calcolato
    assert f.imponibile == Decimal("110.00") and f.imposta == Decimal("12.20")
    assert [(r.aliquota, r.imposta) for r in f.riepiloghi] == [(Decimal("10.00"), Decimal("10.00")),
                                                               (Decimal("22.00"), Decimal("2.20"))]
    assert len(f.rate) == 1 and f.rate[0].modalita == "MP12"
    assert f.rate[0].data_scadenza == date(2026, 10, 31) and f.rate[0].importo == Decimal("122.20")
    assert f.n_ddt == 2 and f.causale == "FATTURA DIFFERITA DDT DI SETTEMBRE"
    assert f.ha_allegati and "Attachment" not in f.xml and "Pesce" in f.xml
    assert not f.autofattura and not f.nota_credito


def test_parcella_persona_fisica_ritenuta_due_rate(ris):
    f = _per_numero(ris)["7"]
    assert f.cedente_denominazione == "Mario Rossi" and f.cedente_cf == "RSSMRA70A01H501Z"
    assert f.ritenuta == Decimal("200.00") and f.totale == Decimal("1220.00")
    assert [r.numero for r in f.rate] == [1, 2] and all(r.condizioni == "TP01" for r in f.rate)
    assert sum(r.importo for r in f.rate) == f.totale - f.ritenuta
    assert f.rate[0].iban == "IT60X0542811101000000123456" and f.rate[1].iban is None


def test_nota_credito_senza_totale(ris):
    f = _per_numero(ris)["NC 5"]
    assert f.nota_credito and f.totale_calcolato and f.totale == Decimal("22.00")
    assert f.fatture_collegate == [{"numero": "123/PV", "data": "2026-09-30"}]
    assert f.rate == [] and f.ritenuta is None
    assert f.riepiloghi[0].esigibilita is None


def test_autofattura_estera(ris):
    f = _per_numero(ris)["10/45"]
    assert f.autofattura and f.cedente_paese == "IE" and f.rate == []


def test_firmata_p7m_der_e_base64():
    assert _per_numero(parse_zip_fatture(_zip_ade()))["124/PV"].nome_file.endswith(".p7m")
    b64 = base64.encodebytes(_file("firmata.xml.p7m"))
    r = parse_zip_fatture(_zip({"x.xml.p7m": b64}))
    assert [f.numero for f in r.fatture] == ["124/PV"] and r.errori == []


def test_file_illeggibili_non_bloccano():
    r = parse_zip_fatture(_zip({
        "buona.xml": _file("parcella.xml"),
        "rotta.xml": b"<FatturaElettronica><non chiuso",
        "firma.xml.p7m": b"non e una firma",
        "altro.xml": b"<?xml version='1.0'?><Ricevuta/>",
        "leggimi.txt": b"ciao",
    }))
    assert len(r.fatture) == 1 and r.n_file == 4
    motivi = {e.file: e.motivo for e in r.errori}
    assert "XML non valido" in motivi["rotta.xml"]
    assert "p7m" in motivi["firma.xml.p7m"]
    assert "non è una fattura" in motivi["altro.xml"]
    assert any("1 file ignorati" in a for a in r.avvisi)


def test_senza_metadato_impronta_da_contenuto_e_doppioni():
    r = parse_zip_fatture(_zip({"a.xml": _file("parcella.xml"), "dir/b.xml": _file("parcella.xml")}))
    assert len(r.fatture) == 1 and r.fatture[0].impronta.startswith("H:")
    assert r.fatture[0].id_sdi is None and r.fatture[0].data_ricezione is None and r.ricezione_da is None
    assert any("più volte" in a for a in r.avvisi) and any("senza metaDato" in a for a in r.avvisi)


def test_zip_annidato():
    interno = _zip({"IT1_x.xml": _file("parcella.xml"),
                    "IT1_x.xml_metaDato.xml": _meta("200", "IT1_x.xml", "2026-10-06T10:00:00.000+02:00")})
    r = parse_zip_fatture(_zip({"trimestre.zip": interno, "IT2_y.xml": _file("autofattura.xml")}))
    assert sorted(f.numero for f in r.fatture) == ["10/45", "7"]
    assert {f.id_sdi for f in r.fatture} == {"200", None}


def test_rifiuta_zip_di_fatture_emesse():
    with pytest.raises(ErroreImportTesoreria, match="emesse"):
        parse_zip_fatture(_zip({"a.xml": _file("parcella.xml"), "b.xml": _file("emessa.xml")}))


def test_rifiuta_destinatario_diverso():
    with pytest.raises(ErroreImportTesoreria, match="non sono intestate"):
        parse_zip_fatture(_zip({"a.xml": _file("parcella.xml")}), piva_azienda="99999999999")


@pytest.mark.parametrize("contenuto,messaggio", [
    (b"non e uno zip", "ZIP valido"),
    (_zip({"leggimi.txt": b"x"}), "non ci sono fatture"),
    (_zip({"rotta.xml": b"<x"}), "Nessuna fattura leggibile"),
])
def test_errori_bloccanti(contenuto, messaggio):
    with pytest.raises(ErroreImportTesoreria, match=messaggio):
        parse_zip_fatture(contenuto)


def test_lotto_di_piu_fatture_non_gestito():
    xml = _file("parcella.xml").decode()
    inizio = xml.index("<FatturaElettronicaBody>")
    fine = xml.index("</FatturaElettronicaBody>") + len("</FatturaElettronicaBody>")
    doppio = xml[:fine] + xml[inizio:fine] + xml[fine:]
    r = parse_zip_fatture(_zip({"lotto.xml": doppio, "buona.xml": _file("autofattura.xml")}))
    assert len(r.fatture) == 1 and "lotto" in r.errori[0].motivo


def test_parse_fattura_xml_importi_decimali():
    d = parse_fattura_xml(_file("differita.xml"))
    assert isinstance(d["totale"], Decimal) and isinstance(d["riepiloghi"][0].imponibile, Decimal)
