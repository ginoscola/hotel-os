"""Test del parser degli estratti conto XML CBI (modulo Tesoreria).

Fixture finte (nomi, IBAN e importi inventati) con la struttura dei file reali BCC:
tests/fixtures/tesoreria/estratto_principale.xml e estratto_pos.xml. Test puri, nessun database.
"""
import os
import sys
from datetime import date
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_parser import (  # noqa: E402
    ErroreImportTesoreria, estrai_controparte, parse_estratto_cbi,
)

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "tesoreria")


def _leggi(nome: str) -> bytes:
    with open(os.path.join(FIXTURES, nome), "rb") as f:
        return f.read()


@pytest.fixture(scope="module")
def principale():
    return parse_estratto_cbi(_leggi("estratto_principale.xml"))


@pytest.fixture(scope="module")
def pos():
    return parse_estratto_cbi(_leggi("estratto_pos.xml"))


# ── Lettura ──────────────────────────────────────────────────────────────────

def test_iban_e_periodo(principale):
    assert principale.iban == "IT00X0000000000000000111111"
    assert principale.data_da == date(2026, 3, 2)
    assert principale.data_a == date(2026, 3, 5)
    assert principale.avvisi == []


def test_movimenti_in_ordine_di_data_con_segno(principale):
    movimenti = principale.movimenti
    assert len(movimenti) == 7
    assert [m.data_contabile for m in movimenti] == sorted(m.data_contabile for m in movimenti)
    assert movimenti[0].importo == Decimal("500.00")
    assert sum(m.importo for m in movimenti) == Decimal("-179.39")
    assert all(isinstance(m.importo, Decimal) for m in movimenti)


def test_saldi_chiusura_e_apertura_del_giorno_prima(principale):
    assert principale.saldi == {
        date(2026, 3, 1): Decimal("10000.00"),   # apertura del primo giorno
        date(2026, 3, 2): Decimal("9299.50"),
        date(2026, 3, 3): Decimal("10820.61"),
        date(2026, 3, 5): Decimal("9820.61"),
    }


def test_saldi_negativi_conto_pos(pos):
    assert pos.saldi[date(2026, 3, 2)] == Decimal("-1300.00")
    assert pos.saldi[date(2026, 3, 4)] == Decimal("-138.20")


def test_data_valuta_e_causale(principale):
    assegno = principale.movimenti[-1]
    assert assegno.descrizione == "Vs assegno n."
    assert assegno.data_contabile == date(2026, 3, 5)
    assert assegno.data_valuta == date(2026, 3, 3)
    assert assegno.causale_abi == "13//00"
    assert assegno.riferimento == "900000000000007"


# ── Antiduplicato ────────────────────────────────────────────────────────────

def test_commissioni_identiche_restano_distinte(principale):
    commissioni = [m for m in principale.movimenti if m.descrizione.startswith("Commissioni")]
    assert len(commissioni) == 2
    assert commissioni[0].impronta != commissioni[1].impronta
    assert all(m.impronta.startswith("R:") for m in principale.movimenti)


def test_impronta_senza_riferimento_banca():
    """Senza AcctSvcrRef: hash dei dati + occorrenza, distinto per righe identiche e stabile."""
    xml = _leggi("estratto_principale.xml")
    import re
    xml = re.sub(rb"<ns5:AcctSvcrRef>\d+</ns5:AcctSvcrRef>", b"", xml)
    primo = parse_estratto_cbi(xml)
    secondo = parse_estratto_cbi(xml)
    commissioni = [m for m in primo.movimenti if m.descrizione.startswith("Commissioni")]
    assert commissioni[0].impronta.startswith("H:")
    assert commissioni[0].impronta != commissioni[1].impronta
    assert [m.impronta for m in primo.movimenti] == [m.impronta for m in secondo.movimenti]
    assert primo.avvisi and "senza riferimento" in primo.avvisi[0]


# ── Controparte ──────────────────────────────────────────────────────────────

def test_controparte_entrata_da_ragione_sociale(principale):
    assert principale.movimenti[0].controparte == "MARIO ROSSI"


def test_controparte_uscita_dopo_asterisco_senza_ordinante(principale):
    """Il bonifico in uscita contiene 'Intestazione ordinante: KM DI MARE SRL' nelle info
    aggiuntive: la controparte non deve includerlo (altrimenti diventerebbe un giroconto)."""
    fornitore = next(m for m in principale.movimenti if m.importo == Decimal("-1200.00"))
    assert fornitore.controparte.startswith("FORNITORE ALFA SRL")
    assert "KM DI MARE" not in fornitore.controparte.upper()


def test_controparte_giroconti(principale, pos):
    entrata = next(m for m in principale.movimenti if m.importo == Decimal("3000.00"))
    uscita = next(m for m in pos.movimenti if m.importo == Decimal("-3000.00"))
    assert entrata.controparte == "KM DI MARE SRL"
    assert uscita.controparte == "KM DI MARE SRL GC POS"


def test_controparte_bonifico_istantaneo():
    testo = ("Bonifico tramite Internet Banking *INSTANT DEL 04/07/2025 ORE 13:40 ID. 0000IT "
             "BEN Mario RossiBusta Paga Giugno")
    assert estrai_controparte(testo, Decimal("-500")) == "Mario RossiBusta Paga Giugno"


def test_controparte_vuota_senza_riferimenti():
    assert estrai_controparte("Commissioni su bonifico tramite in", Decimal("-0.25")) == ""
    assert estrai_controparte("Carta del Credito Cooperativo ******606 CARTA MOVIMENTO",
                              Decimal("-10")) == "606 CARTA MOVIMENTO"


# ── Errori bloccanti ─────────────────────────────────────────────────────────

def test_rifiuta_file_non_xml():
    with pytest.raises(ErroreImportTesoreria, match="XML valido"):
        parse_estratto_cbi(b"Data contabile\tData valuta\tImporto\n")


def test_rifiuta_xml_non_cbi():
    with pytest.raises(ErroreImportTesoreria, match="CBI"):
        parse_estratto_cbi(b"<?xml version='1.0'?><radice><riga/></radice>")


def test_rifiuta_giorno_che_non_quadra():
    xml = _leggi("estratto_principale.xml").replace(b">1478.89<", b">1478.80<")
    with pytest.raises(ErroreImportTesoreria, match="non quadra"):
        parse_estratto_cbi(xml)


def test_rifiuta_saldo_non_continuo():
    # Apertura e chiusura del 05/03 entrambe spostate: il giorno quadra ma non segue il 03/03.
    xml = _leggi("estratto_principale.xml")
    xml = xml.replace(b">10820.61<", b">10820.71<", 1)   # solo il primo: OPBD del 05/03
    xml = xml.replace(b">9820.61<", b">9820.71<")         # CLBD e CLAV del 05/03
    with pytest.raises(ErroreImportTesoreria, match="non continuo"):
        parse_estratto_cbi(xml)


def test_rifiuta_due_iban():
    xml = _leggi("estratto_principale.xml").replace(
        b"IT00X0000000000000000111111", b"IT00X0000000000000000999999", 1)
    with pytest.raises(ErroreImportTesoreria, match="un solo conto"):
        parse_estratto_cbi(xml)


def test_rifiuta_movimenti_non_contabilizzati():
    xml = _leggi("estratto_principale.xml").replace(b"<ns5:Sts>BOOK</ns5:Sts>", b"<ns5:Sts>PDNG</ns5:Sts>", 1)
    with pytest.raises(ErroreImportTesoreria, match="non contabilizzato"):
        parse_estratto_cbi(xml)
