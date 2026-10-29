"""Test del parser dello scadenzario fornitori Passcom (modulo Tesoreria, Fase 2).

Fixture finta (fornitori e importi inventati) con la struttura del file reale:
tests/fixtures/tesoreria/scadenzario_da_pagare.xml (SpreadsheetML, windows-1252). Test puri, nessun database.
"""
import os
import sys
from datetime import date
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_passcom_parser import (  # noqa: E402
    ErroreImportTesoreria, parse_scadenzario,
)

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "tesoreria", "scadenzario_da_pagare.xml")


def _leggi() -> bytes:
    with open(FIXTURE, "rb") as f:
        return f.read()


@pytest.fixture(scope="module")
def ris():
    return parse_scadenzario(_leggi())


def test_intestazione_e_totale(ris):
    assert ris.azienda == "XX1 SOCIETA DI PROVA SRL"
    assert ris.data_stampa == date(2026, 10, 15)
    assert len(ris.scadenze) == 10
    assert ris.totale == Decimal("228.36")
    assert sum(s.importo for s in ris.scadenze) == ris.totale
    assert ris.scadenza_da == date(2011, 1, 1) and ris.scadenza_a == date(2026, 11, 30)
    assert ris.avvisi == []


def test_riga_di_dettaglio(ris):
    s = next(s for s in ris.scadenze if s.numero_documento == "1001")
    assert s.data_scadenza == date(2026, 10, 31)
    assert s.tipo_pagamento == "RIC.BANC." and not s.pareggio
    assert s.tipo_documento == "FR" and s.registro == "1"
    assert s.data_documento == date(2026, 9, 30) and s.data_registrazione == date(2026, 10, 2)
    assert s.protocollo == "A01/001800 44000"
    assert s.codice_fornitore == "601.00003"
    assert s.fornitore == "CAFFÈ ROSSI S.R.L."          # windows-1252 letto correttamente
    assert s.importo == Decimal("120.50")
    assert s.chiave == "601.00003|A01/001800 44000|2026-10-31|120.50"


def test_nota_di_credito_negativa_e_registro_estero(ris):
    nr = next(s for s in ris.scadenze if s.tipo_documento == "NR")
    assert nr.importo == Decimal("-20.75")
    estero = next(s for s in ris.scadenze if s.codice_fornitore == "601.00005")
    assert estero.registro == "8" and estero.numero_documento == "10/200"


def test_pareggi_senza_protocollo_e_chiave_univoca(ris):
    pareggi = [s for s in ris.scadenze if s.pareggio]
    assert len(pareggi) == 3
    assert all(s.tipo_pagamento == "*PAREGGIO*" and s.protocollo is None and s.tipo_documento is None for s in pareggi)
    doppi = [s.chiave for s in pareggi if s.codice_fornitore == "601.00002"]
    assert doppi == ["601.00002||2026-11-30|-2650.00", "601.00002||2026-11-30|-2650.00#2"]
    assert len({s.chiave for s in ris.scadenze}) == len(ris.scadenze)


def test_descrizione_e_ragione_sociale_a_capo(ris):
    s = next(s for s in ris.scadenze if s.numero_documento == "45")
    assert s.descrizione == "Gennaio - Dicembre 25"
    assert s.fornitore == "Albergo Esempio S.a.s. di Prova Mario & C."   # la riga ' C.' non si aggiunge


def test_totale_che_non_quadra():
    contenuto = _leggi().replace(b'<Data ss:Type="Number">228.36</Data>', b'<Data ss:Type="Number">228.46</Data>')
    with pytest.raises(ErroreImportTesoreria, match="non coincide"):
        parse_scadenzario(contenuto)


def test_totale_mancante():
    contenuto = _leggi().replace(b">Totale<", b">Altro<")
    with pytest.raises(ErroreImportTesoreria, match="Totale"):
        parse_scadenzario(contenuto)


def test_file_delle_rate_pagate_rifiutato():
    riga_pagata = (b'<Cell ss:Index="3" ss:StyleID="s11"><Data ss:Type="String">31/10/2026</Data></Cell>'
                   b'<Cell ss:Index="4" ss:StyleID="s11"><Data ss:Type="String">P</Data></Cell>\n'
                   b'    <Cell ss:Index="5" ss:StyleID="s11"><Data ss:Type="String">RIC.BANC.')
    contenuto = _leggi().replace(b'<Cell ss:Index="5" ss:StyleID="s11"><Data ss:Type="String">RIC.BANC.', riga_pagata, 1)
    with pytest.raises(ErroreImportTesoreria, match="rate già pagate"):
        parse_scadenzario(contenuto)


def test_foglio_sbagliato_o_non_xml():
    with pytest.raises(ErroreImportTesoreria, match="Foglio"):
        parse_scadenzario(_leggi().replace(b'ss:Name="-Scaddoc"', b'ss:Name="Foglio1"'))
    with pytest.raises(ErroreImportTesoreria, match="XML"):
        parse_scadenzario(b"Data;Importo\n01/10/2026;10,00\n")
    with pytest.raises(ErroreImportTesoreria, match="scadenzario Passcom"):
        parse_scadenzario(b'<?xml version="1.0"?><BkToCstmrStmt/>')


def test_importo_e_date():
    from app.services.tesoreria_passcom_parser import _data, _importo
    assert _importo("-150.00", "x") == Decimal("-150.00")
    assert _importo("1.234,56", "x") == Decimal("1234.56")
    assert _data("05/10/26", "x") == date(2026, 10, 5)
    assert _data("05/10/2026", "x") == date(2026, 10, 5)
    with pytest.raises(ErroreImportTesoreria):
        _data("2026-10-05", "x")
