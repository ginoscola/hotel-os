"""Test del motore di classificazione (modulo Tesoreria) con le regole effettivamente seminate dalla
migrazione tes001_2026, su descrizioni con la forma di quelle reali (nomi inventati).
Test puri, nessun database.
"""
import importlib.util
import os
import sys
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_classificatore import RegolaClassificazione, classifica  # noqa: E402
from app.services.tesoreria_parser import estrai_controparte, parse_estratto_cbi  # noqa: E402

BACKEND = os.path.join(os.path.dirname(__file__), "..")
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "tesoreria")


def _migrazione():
    percorso = os.path.join(BACKEND, "alembic", "versions", "tes001_2026_modulo_tesoreria.py")
    spec = importlib.util.spec_from_file_location("tes001_2026", percorso)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


MIGRAZIONE = _migrazione()
ID_CATEGORIA = {codice: i for i, (codice, *_resto) in enumerate(MIGRAZIONE.CATEGORIE, start=1)}
CODICE = {i: codice for codice, i in ID_CATEGORIA.items()}
REGOLE = [
    RegolaClassificazione(categoria_id=ID_CATEGORIA[cat], campo=campo, operatore=op, valori=valori,
                          valori_anche=anche, segno=segno, priorita=i * 10)
    for i, (cat, campo, op, valori, anche, segno) in enumerate(MIGRAZIONE.REGOLE, start=1)
]


def _categoria(descrizione: str, importo: str):
    imp = Decimal(importo)
    cat_id = classifica(descrizione, estrai_controparte(descrizione, imp), imp, REGOLE)
    return CODICE.get(cat_id)


def test_regole_puntano_a_categorie_esistenti():
    assert all(cat in ID_CATEGORIA for cat, *_ in MIGRAZIONE.REGOLE)
    assert "da_classificare" in ID_CATEGORIA


@pytest.mark.parametrize("descrizione, importo, atteso", [
    # Giroconti: solo dalla controparte
    ("Bonifico a favore di *KM DI MARE SRL GC POS", "-30000", "giroconti"),
    ("Bonifico a vs favore *KM DI MARE SRL GIROCONTO Info aggiuntive: Ragione sociale ordinante: "
     "KM DI MARE SRL Indirizzo ordinante: VIA FINTA", "30000", "giroconti"),
    ("Bonifico tramite Internet Banking *FORNITORE BETA SPA saldo ft 1 Info aggiuntive: Data ordine: "
     "05/10/2026 Intestazione ordinante: KM DI MARE SRL Localita ordinante: CATTOLICA", "-255.53",
     "fornitori_bonifici"),
    # Mutuo
    ("Erogazione mutuo *Erogaz. Mutuo 000/000000/01", "140000", "mutuo_erogazione"),
    ("Spese erogazione mutuo *Erogaz. Mutuo 000/000000/01", "-1050", "mutuo_rate"),
    ("Addebito rata mutuo *000/000000/003 Scad.:20/10/2026 Cap.: 937,95", "-1478.89", "mutuo_rate"),
    # Storni: nella categoria del movimento che annullano
    ("Storno scritture 0000001 31.10.25ACCREDITI - COMM. SU TRANStorno comm.eserc.carte i", "15.93", "banca"),
    ("Storno scritture *2025-07-14*MARIO ROSSI BONIFICO PER ACCREDITO DEGLI EMOLUMENTI DI MARIO ROSSI",
     "128", "personale"),
    ("Storno scritture *2025-07-15*ANNA BIANCHI RESTITUZIONE CAPARRA ANNA BIANCHI", "1450", "bonifici_clienti"),
    ("Storno scritture 0000001 02.10.25 000000000001 CLUB HOTEL-HOTEL DU PARC", "-838.20", "incassi_pos"),
    ("Storno scritture Rimborso / Storno F23", "11.05", None),
    # Regole della specifica
    ("Bonifico tramite Internet Banking *Comune di Gabicce Mare TASSA DI SOGGIORNO AGOSTO", "-9000",
     "tassa_soggiorno"),
    ("Bonifico tramite Internet Banking *Comune di gabicce mare Canone Servizio Pubblicita", "-366",
     "fornitori_bonifici"),
    ("Bonifico tramite Internet Banking *HOTEL INTERNATIONAL S.N.saldo FT 3", "-50000", "affitti"),
    ("Bonifico tramite Internet Banking *Hotel Du Parc Snc di EliSaldo rata 1 FT 4.1", "-30000", "affitti"),
    # La causale che nomina un hotel non rende il bonifico un affitto (il nome è solo all'inizio)
    ("Bonifico tramite Internet Banking *WTG WELCOME TO GABICCE Quota Associativa 2025 Hotel Du Parc",
     "-3300", "fornitori_bonifici"),
    ("Bonifico tramite Internet Banking *INSTANT DEL 29/07/2025 ORE 20:11 ID. 0000IT BEN Anna "
     "BianchiStorno conto hotel international", "-250", "fornitori_bonifici"),
    ("Disposizione per emolumenti intern *INSTANT DEL 23/10/2026 BEN MARIO ROSSI", "-629.07", "personale"),
    ("Bonifico a vs favore *MARIO ROSSI RESTITUZIONE STIPENDIO SETTEMBRE", "925", "personale"),
    ("Bonifico tramite Internet Banking *Fideuram Vita S.p.A. 2026", "-857.12", "personale"),
    ("Imposte e tasse:Delega Unificata(p C.ATT:00000000000/29", "-7403.70", "f24"),
    ("Bonifico tramite Internet Banking *GINO SCOLA compensi MARCHI 2026", "-10000", "soci_marchio"),
    ("SDD Core - Richiesta Incasso SEPA REF-0000 GC RE THEFORK QZM7TNB", "-489.27", "ota_marketing"),
    ("SDD Core - Richiesta Incasso SEPA 01M4 AMERICAN EXPRESS ITALIA SOCIET E2025", "-3042.39", "carte"),
    ("SDD Core - Richiesta Incasso SEPA Documento E001 nr.04170 FORNITORE GAMMA", "-1188.28", "fornitori_sdd"),
    ("Carta del Credito Cooperativo ******************606 CARTA MOVIMENTO", "-271.62", "carte"),
    ("Commissioni su bonifico tramite in", "-0.25", "banca"),
    ("Pagamento interessi esigibili corr Rapporto: 0002/036/000000", "-0.78", "banca"),
    ("Addebito RIBA CBI 000 MARR S.p.A.", "-4500", "fornitori_riba"),
    ("Vs assegno n.", "-1000", "assegni"),
    ("Incassi Internazionali Numia SpA 0000001 18.09.26 000000000001 CLUB HOTEL-HOTEL DU PARC", "2500",
     "incassi_pos"),
    ("Versamento contanti", "3000", "versamenti"),
    ("Bonifico a vs favore *ISTITUTO NAZIONALE PER L ASSICURAZIONE C RIMBORSO", "175.92", "bonifici_clienti"),
])
def test_classificazione(descrizione, importo, atteso):
    assert _categoria(descrizione, importo) == atteso


def test_segno_della_regola():
    """'Bonifico' in entrata = cliente, in uscita = fornitore; 'NUMIA' conta solo in entrata."""
    assert _categoria("Bonifico a vs favore *CLIENTE", "100") == "bonifici_clienti"
    assert _categoria("Bonifico tramite Internet Banking *FORNITORE", "-100") == "fornitori_bonifici"
    assert _categoria("Addebito canone NUMIA terminale", "-30") is None


def test_maiuscole_e_spazi_ignorati():
    assert _categoria("addebito   rata   MUTUO *000", "-10") == "mutuo_rate"


def test_valori_anche_obbligatori():
    regola = RegolaClassificazione(categoria_id=1, campo="descrizione", operatore="contiene",
                                   valori=["SOGGIORNO"], valori_anche=["COMUNE", "TESORERIA"])
    assert classifica("tassa di soggiorno comune", "", Decimal("-1"), [regola]) == 1
    assert classifica("tassa di soggiorno", "", Decimal("-1"), [regola]) is None


def test_fixture_classificate():
    """Tutti i movimenti delle fixture finiscono nella categoria attesa."""
    attesi = {
        "estratto_principale.xml": ["bonifici_clienti", "banca", "banca", "fornitori_bonifici",
                                    "giroconti", "mutuo_rate", "assegni"],
        "estratto_pos.xml": ["giroconti", "incassi_pos", "incassi_pos", "incassi_pos"],
    }
    for nome, categorie in attesi.items():
        with open(os.path.join(FIXTURES, nome), "rb") as f:
            risultato = parse_estratto_cbi(f.read())
        trovate = [CODICE.get(classifica(m.descrizione, m.controparte, m.importo, REGOLE))
                   for m in risultato.movimenti]
        assert trovate == categorie, nome
