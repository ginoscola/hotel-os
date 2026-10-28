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


# ── Controparte e causale separate (formati reali, nomi inventati) ─────────────

from app.services.tesoreria_parser import campi_etichettati, controparte_e_causale  # noqa: E402

USCITA_ETICHETTE = (
    "Bonifico tramite Internet Banking *BAGNI ALFA SNC DI ROSSI Msaldo FT 10 ID.BON:0899500000000000000000000000IT "
    "Info aggiuntive: Codice Riferimento Operazione: 0899500000000000000000000000IT Iban beneficiario: "
    "IT00X0000000000000000333333 Nominativo beneficiario: BAGNI ALFA SNC DI ROSSI MARIO E LUIGI Codice causale: 26 "
    "Data contabile: 17/09/2026 Dati esito: La disposizione e' Eseguita. Causale: saldo FT 10 Esito: Eseguita "
    "Importo: -5117.90 Intestazione ordinante: KM DI MARE SRL"
)


@pytest.mark.parametrize("descrizione, nome, abi, importo, atteso", [
    # bonifico in uscita con etichette: nome completo (non troncato a 24) e causale
    (USCITA_ETICHETTE, "*BAGNI ALFA SNC DI ROSSI Msaldo FT 10              ID.BON:0899500000000000000000000000IT",
     "26//11", "-5117.90", ("BAGNI ALFA SNC DI ROSSI MARIO E LUIGI", "saldo FT 10")),
    # bonifico in uscita senza etichette: nome a 24 caratteri (spazi conservati) + causale
    ("Bonifico tramite Internet Banking *Comune di Esempio Canone pubblicita 2025",
     "*Comune di Esempio       Canone pubblicita 2025", "26//11", "-366", ("Comune di Esempio", "Canone pubblicita 2025")),
    ("Bonifico tramite Internet Banking *ASSOCIAZIONE ALBERGATORIQUOTA ASSOCIATIVA 2027",
     "*ASSOCIAZIONE ALBERGATORIQUOTA ASSOCIATIVA 2027", "26//11", "-150",
     ("ASSOCIAZIONE ALBERGATORI", "QUOTA ASSOCIATIVA 2027")),
    ("Giro conto *KM DI MARE SRL GIROCONTO", "*KM DI MARE SRL          GIROCONTO", "34//00", "-1000",
     ("KM DI MARE SRL", "GIROCONTO")),
    # entrata: ragione sociale e descrizione aggiuntiva senza prefissi né nome
    ("Bonifico a vs favore *ROSSI MARIO Caparra camera 12 Info aggiuntive: Data ordine: 26/10/2026 "
     "Ragione sociale ordinante: ROSSI MARIO Indirizzo ordinante: VIA FINTA 1 ID_BONIFICO: 0000IT "
     "Descrizione aggiuntiva del movimento: *2026-10-26*ROSSI MARIO Caparra camera 12",
     "*ROSSI MARIO Caparra camera 12", "48//00", "300", ("ROSSI MARIO", "Caparra camera 12")),
    # SDD con documento: [documento 36][creditore 31][riferimento]
    ("SDD Core - Richiesta Incasso SEPA REF-0001 FORNITORE BETA SPA X1",
     "REF-0001" + " " * 28 + "FORNITORE BETA SPA" + " " * 13 + "X1", "31//22", "-489.27",
     ("FORNITORE BETA SPA", "SDD REF-0001")),
    # SDD senza documento: [creditore 31][riferimento]
    ("SDD B2B - Richiesta Incasso SEPA TELEFONIA SPA MU0001", "TELEFONIA SPA" + " " * 18 + "MU0001",
     "31//21", "-80", ("TELEFONIA SPA", "SDD MU0001")),
    # Ri.Ba.: [riferimento 22][scadenza 9][creditore 24][indirizzo]
    ("Addebito RIBA CBI attivo 07090/2026A0000000000 30/09/26 GAMMA S.R.L. VIA ROMA 1 Car. avviso : 30/09/26",
     "07090/2026A0000000000 30/09/26 GAMMA S.R.L.            VIA ROMA 1             Car. avviso : 30/09/26",
     "31//48", "-1200", ("GAMMA S.R.L.", "Ri.Ba. scadenza 30/09/26")),
    # bonifico istantaneo: nome e causale attaccati, resta tutto in controparte
    ("Disposizione per emolumenti intern *INSTANT DEL 23/10/2026 ORE 12:16 ID. 0000IT BEN ANNA BIANCHI",
     "*INSTANT DEL 23/10/2026 ORE 12:16 ID. 0000IT BEN ANNA BIANCHI", "39//11", "-629.07", ("ANNA BIANCHI", "")),
    # scritture della banca: nessuna controparte, la causale è il testo
    ("Addebito rata mutuo *000/000000/003 Scad.:20/10/2026 Cap.: 937,95", "*000/000000/003 Scad.:20/10/2026",
     "15//10", "-1478.89", ("", "Addebito rata mutuo *000/000000/003 Scad.:20/10/2026 Cap.: 937,95")),
    ("Carta del Credito Cooperativo ******606 CARTA MOVIMENTO", "******606   CARTA MOVIMENTO", "45//15", "-271.62",
     ("", "Carta del Credito Cooperativo ******606 CARTA MOVIMENTO")),
])
def test_controparte_e_causale(descrizione, nome, abi, importo, atteso):
    assert controparte_e_causale(descrizione, nome, abi, Decimal(importo)) == atteso


def test_campi_etichettati_non_confonde_causale_e_codice_causale():
    campi = campi_etichettati(USCITA_ETICHETTE)
    assert campi["Codice causale"] == "26"
    assert campi["Causale"] == "saldo FT 10"
