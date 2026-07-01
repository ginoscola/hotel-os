"""Test unitari e di integrazione per fiscal_doc_parser e fiscal_doc_validator.

Test unitari: usano stringhe sintetiche, nessun PDF necessario.
Test integrazione: usano il PDF reale in uploads/ (saltato se assente).

Scenari coperti:
  - _parse_decimal / _parse_data
  - Riga normale (data+spazio+tipo)
  - Riga SENZA spazio tra data e tipo (es. "22/05/26SCA") — fix regex \\s*
  - Documento ANNULLATO
  - Caparra CP con numero=0
  - Documento multi-riga (importi su riga di continuazione)
  - Più CP con numero=0 e camera diversa (idempotenza assenza constraint)
  - Sezione documenti vuota
  - Individuazione sezioni
  - Validazione checksum OK e KO
  - PDF reale: 14 documenti, 0 righe non parsate, checksum OK
"""

from __future__ import annotations

import os
import sys
from datetime import date
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.fiscal_doc_parser import (
    _individua_sezioni,
    _parsa_riga_documento,
    _parsa_sezione_documenti,
    _parse_data,
    _parse_decimal,
    _prova_estrai_importi_continuazione,
    parse_pdf,
)
from app.services.fiscal_doc_validator import valida

PDF_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "uploads", "documenti fiscali emessi.pdf"
)

# ---------------------------------------------------------------------------
# Utility — _parse_decimal
# ---------------------------------------------------------------------------

def test_parse_decimal_normale():
    assert _parse_decimal("243,36") == Decimal("243.36")

def test_parse_decimal_migliaia():
    assert _parse_decimal("1.243,36") == Decimal("1243.36")

def test_parse_decimal_negativo():
    assert _parse_decimal("-50,00") == Decimal("-50.00")

def test_parse_decimal_zero():
    assert _parse_decimal("0,00") == Decimal("0")

def test_parse_decimal_vuoto():
    assert _parse_decimal("") is None

def test_parse_decimal_trattino():
    assert _parse_decimal("-") == Decimal("0")

def test_parse_decimal_testo():
    assert _parse_decimal("ANNULLATO") is None


# ---------------------------------------------------------------------------
# Utility — _parse_data
# ---------------------------------------------------------------------------

def test_parse_data_anno_corto():
    assert _parse_data("22/05/26") == date(2026, 5, 22)

def test_parse_data_anno_lungo():
    assert _parse_data("22/05/2026") == date(2026, 5, 22)

def test_parse_data_invalida():
    assert _parse_data("gibberish") is None

def test_parse_data_vuota():
    assert _parse_data("") is None


# ---------------------------------------------------------------------------
# _parsa_riga_documento — riga normale (con spazio tra data e tipo)
# ---------------------------------------------------------------------------

def test_riga_normale_con_spazio():
    riga = "22/05/26 SCA 116 D-SCA D230 MARIO ROSSI 243,36 243,36 0,00 BANCOMAT 243,36 221,24 22,12 0,00"
    doc = _parsa_riga_documento(riga)
    assert doc is not None
    assert doc["data_documento"] == date(2026, 5, 22)
    assert doc["tipo_doc"] == "SCA"
    assert doc["numero"] == 116
    assert doc["suffisso"] == "D-SCA"
    assert doc["camera"] == "D230"
    assert "MARIO ROSSI" in (doc["intestazione"] or "")
    assert doc["totale"] == Decimal("243.36")
    assert doc["incassato"] == Decimal("243.36")
    assert doc["sospeso"] == Decimal("0.00")
    assert doc["tipo_pagamento"] == "BANCOMAT"
    assert doc["imponibile"] == Decimal("221.24")
    assert doc["iva"] == Decimal("22.12")
    assert doc["annullato"] is False


# ---------------------------------------------------------------------------
# _parsa_riga_documento — SENZA spazio tra data e tipo (fix regex \s*)
# ---------------------------------------------------------------------------

def test_riga_senza_spazio_data_tipo():
    """Il PMS a volte omette lo spazio tra data e tipo: 22/05/26SCA invece di 22/05/26 SCA."""
    riga = "22/05/26SCA 116 D-SCA D230 MARIO ROSSI 243,36 243,36 0,00 BANCOMAT 243,36 221,24 22,12 0,00"
    doc = _parsa_riga_documento(riga)
    assert doc is not None, "La riga senza spazio deve essere parsata (fix \\s* nella regex)"
    assert doc["data_documento"] == date(2026, 5, 22)
    assert doc["tipo_doc"] == "SCA"
    assert doc["numero"] == 116
    assert doc["totale"] == Decimal("243.36")
    assert doc["incassato"] == Decimal("243.36")
    assert doc["tipo_pagamento"] == "BANCOMAT"

def test_riga_cp_senza_spazio():
    """CP senza spazio: 22/05/26CP."""
    riga = "22/05/26CP 0 I-CP I205 ANNA VERDI 165,00 165,00 0,00 BANCOMAT 165,00 150,00 15,00 0,00"
    doc = _parsa_riga_documento(riga)
    assert doc is not None
    assert doc["tipo_doc"] == "CP"
    assert doc["numero"] == 0
    assert doc["totale"] == Decimal("165.00")


# ---------------------------------------------------------------------------
# _parsa_riga_documento — documento ANNULLATO
# ---------------------------------------------------------------------------

def test_riga_annullato():
    riga = "22/05/26 SC 999 D-SC D101 LUIGI BIANCHI 100,00 100,00 0,00 ANNULLATO 100,00 90,91 9,09 0,00"
    doc = _parsa_riga_documento(riga)
    assert doc is not None
    assert doc["annullato"] is True
    assert doc["tipo_doc"] == "SC"
    assert doc["numero"] == 999


# ---------------------------------------------------------------------------
# _parsa_riga_documento — caparra CP con numero=0
# ---------------------------------------------------------------------------

def test_riga_cp_numero_zero():
    """Le caparre CP hanno spesso numero=0 — non devono essere scartate."""
    riga = "22/05/26 CP 0 I-CP I205 ANNA VERDI 165,00 165,00 0,00 BANCOMAT 165,00 150,00 15,00 0,00"
    doc = _parsa_riga_documento(riga)
    assert doc is not None
    assert doc["tipo_doc"] == "CP"
    assert doc["numero"] == 0
    assert doc["camera"] == "I205"
    assert doc["totale"] == Decimal("165.00")
    assert doc["incassato"] == Decimal("165.00")


# ---------------------------------------------------------------------------
# _parsa_riga_documento — riga non riconoscibile
# ---------------------------------------------------------------------------

def test_riga_non_documento():
    """Una riga senza data non deve essere parsata come documento."""
    assert _parsa_riga_documento("Totali: 1234,00 1234,00 0,00") is None
    assert _parsa_riga_documento("") is None
    assert _parsa_riga_documento("INTESTAZIONE Num. Cam. Data") is None


# ---------------------------------------------------------------------------
# _prova_estrai_importi_continuazione — riga di continuazione
# ---------------------------------------------------------------------------

def test_continuazione_importi():
    """Gli importi sulla riga di continuazione devono aggiornare il documento."""
    doc = {
        "data_documento": date(2026, 5, 22),
        "tipo_doc": "SC",
        "numero": 100,
        "suffisso": "C-SC",
        "camera": "C201",
        "intestazione": "OSPITE DALLA TERRA DI QUALCHE POSTO MOLTO LONTANO",
        "indirizzo": None,
        "totale": None,
        "incassato": None,
        "sospeso": None,
        "tipo_pagamento": None,
        "imponibile": None,
        "iva": None,
        "soggetto_acconto": None,
        "annullato": False,
    }
    riga_cont = "100,00 100,00 0,00 CONTANTE 100,00 90,91 9,09 0,00"
    _prova_estrai_importi_continuazione(riga_cont, doc)
    assert doc["totale"] == Decimal("100.00")
    assert doc["incassato"] == Decimal("100.00")
    assert doc["sospeso"] == Decimal("0.00")
    assert doc["tipo_pagamento"] == "CONTANTE"
    assert doc["imponibile"] == Decimal("90.91")
    assert doc["iva"] == Decimal("9.09")

def test_continuazione_solo_testo():
    """Se la riga di continuazione non ha numeri in formato italiano (virgola decimale),
    viene trattata come indirizzo. Nota: interi senza virgola (es. numeri civici)
    sono ambigui per il parser — qui usiamo solo testo puro."""
    doc = {"totale": None, "indirizzo": None}
    _prova_estrai_importi_continuazione("C/O HOTEL RIMINI MARE", doc)
    assert doc["totale"] is None
    assert doc["indirizzo"] == "C/O HOTEL RIMINI MARE"


# ---------------------------------------------------------------------------
# _parsa_sezione_documenti — scenari completi
# ---------------------------------------------------------------------------

def _righe_sezione(*docs: str) -> list[str]:
    """Costruisce una lista di righe sezione con intestazione colonne."""
    header = "Data Num. Cam. Intestazione Totale Incassato Sospeso Pagamento Lordo Imponibile IVA Tassa"
    return [header] + list(docs)


def test_sezione_vuota():
    assert _parsa_sezione_documenti([], []) == []


def test_sezione_un_documento():
    righe = _righe_sezione(
        "22/05/26 SC 1 D-SC D101 MARIO ROSSI 50,00 50,00 0,00 CONTANTE 50,00 45,45 4,55 0,00"
    )
    non_parsate: list = []
    docs = _parsa_sezione_documenti(righe, non_parsate)
    assert len(docs) == 1
    assert len(non_parsate) == 0
    assert docs[0]["numero"] == 1
    assert docs[0]["totale"] == Decimal("50.00")


def test_sezione_documento_senza_spazio():
    """Riga con data+tipo fusi deve essere parsata correttamente."""
    righe = _righe_sezione(
        "22/05/26SCA 116 D-SCA D230 MARIO ROSSI 243,36 243,36 0,00 BANCOMAT 243,36 221,24 22,12 0,00",
        "22/05/26SC  115 D-SC  D230 LUIGI BIANCHI 100,00 100,00 0,00 CONTANTE 100,00 90,91 9,09 0,00",
    )
    non_parsate: list = []
    docs = _parsa_sezione_documenti(righe, non_parsate)
    assert len(docs) == 2
    assert len(non_parsate) == 0
    assert docs[0]["tipo_doc"] == "SCA"
    assert docs[1]["tipo_doc"] == "SC"


def test_sezione_multi_riga():
    """Documento con importi su riga di continuazione."""
    header = "Data Num. Cam. Intestazione Totale Incassato Sospeso Pagamento Lordo Imponibile IVA Tassa"
    righe = [
        header,
        "22/05/26 SC 100 C-SC C201 OSPITE DALLA TERRA DI UN POSTO MOLTO LONTANO",
        "100,00 100,00 0,00 CONTANTE 100,00 90,91 9,09 0,00",
    ]
    non_parsate: list = []
    docs = _parsa_sezione_documenti(righe, non_parsate)
    assert len(docs) == 1
    doc = docs[0]
    assert doc["tipo_doc"] == "SC"
    assert doc["numero"] == 100
    assert doc["totale"] == Decimal("100.00")
    assert doc["tipo_pagamento"] == "CONTANTE"


def test_sezione_due_cp_numero_zero_camera_diversa():
    """Due CP con numero=0 ma camera diversa devono generare 2 documenti distinti."""
    righe = _righe_sezione(
        "22/05/26 CP 0 I-CP I205 ANNA VERDI 165,00 165,00 0,00 BANCOMAT 165,00 150,00 15,00 0,00",
        "22/05/26 CP 0 I-CP I301 GIUSEPPE BIANCHI 50,00 50,00 0,00 CONTANTE 50,00 45,45 4,55 0,00",
    )
    non_parsate: list = []
    docs = _parsa_sezione_documenti(righe, non_parsate)
    assert len(docs) == 2
    assert docs[0]["camera"] == "I205"
    assert docs[1]["camera"] == "I301"
    assert docs[0]["numero"] == 0
    assert docs[1]["numero"] == 0


def test_sezione_documento_annullato():
    righe = _righe_sezione(
        "22/05/26 SC 999 D-SC D101 LUIGI BIANCHI 100,00 100,00 0,00 ANNULLATO 100,00 90,91 9,09 0,00"
    )
    docs = _parsa_sezione_documenti(righe, [])
    assert len(docs) == 1
    assert docs[0]["annullato"] is True


# ---------------------------------------------------------------------------
# _individua_sezioni — segmentazione in sezioni
# ---------------------------------------------------------------------------

def test_individua_sezioni():
    righe = [
        "Riepilogo Documenti Emessi",
        "22/05/26 SC 1 ...",
        "Dettaglio di Cassa",
        "CONTANTE 100,00 0,00",
    ]
    sezioni = _individua_sezioni(righe)
    assert "documenti" in sezioni
    assert "dettaglio_cassa" in sezioni
    assert sezioni["documenti"] == ["22/05/26 SC 1 ..."]

def test_individua_sezioni_vuote():
    sezioni = _individua_sezioni([])
    assert sezioni == {}


# ---------------------------------------------------------------------------
# fiscal_doc_validator — checksum OK
# ---------------------------------------------------------------------------

def test_valida_checksum_ok():
    """Tutti i controlli devono passare con dati coerenti."""
    dati = {
        "documenti": [
            {
                "tipo_doc": "SC",
                "incassato": Decimal("100.00"),
                "iva": Decimal("9.09"),
                "sospeso": Decimal("0.00"),
                "totale": Decimal("100.00"),
                "annullato": False,
                "numero": 1,
                "tipo_pagamento": "CONTANTE",
            },
        ],
        "dettaglio_cassa": [
            {"incasso": Decimal("100.00"), "tipo": "CONTANTE", "sosp_incassati": Decimal("0.00")},
        ],
        "riepilogo_iva": [{"iva": Decimal("9.09")}],
        "caparre_utilizzate": [],
        "warnings": [],
    }
    rapporto = valida(dati)
    assert rapporto["checksum_ok"] is True
    assert all(c["ok"] for c in rapporto["controlli"])


def test_valida_checksum_ko_cassa():
    """Mismatch tra incassato documenti e Dettaglio di Cassa → checksum KO."""
    dati = {
        "documenti": [
            {
                "tipo_doc": "SC",
                "incassato": Decimal("100.00"),
                "iva": Decimal("9.09"),
                "sospeso": Decimal("0.00"),
                "totale": Decimal("100.00"),
                "annullato": False,
                "numero": 1,
                "tipo_pagamento": "CONTANTE",
            },
        ],
        "dettaglio_cassa": [
            # Volutamente errato: 150 invece di 100
            {"incasso": Decimal("150.00"), "tipo": "CONTANTE", "sosp_incassati": Decimal("0.00")},
        ],
        "riepilogo_iva": [{"iva": Decimal("9.09")}],
        "caparre_utilizzate": [],
        "warnings": [],
    }
    rapporto = valida(dati)
    assert rapporto["checksum_ok"] is False
    cassa_ctrl = next(c for c in rapporto["controlli"] if "Cassa" in c["nome"])
    assert cassa_ctrl["ok"] is False
    assert cassa_ctrl["differenza"] == pytest.approx(50.0)


def test_valida_cp_escluso_da_cassa():
    """Le caparre (CP) non devono essere conteggiate nel Dettaglio di Cassa."""
    dati = {
        "documenti": [
            {
                "tipo_doc": "SC",
                "incassato": Decimal("100.00"),
                "iva": Decimal("9.09"),
                "sospeso": Decimal("0.00"),
                "totale": Decimal("100.00"),
                "annullato": False,
                "numero": 1,
                "tipo_pagamento": "CONTANTE",
            },
            {
                "tipo_doc": "CP",
                "incassato": Decimal("200.00"),  # caparra — NON deve entrare nel totale cassa
                "iva": Decimal("0.00"),
                "sospeso": Decimal("0.00"),
                "totale": Decimal("200.00"),
                "annullato": False,
                "numero": 0,
                "tipo_pagamento": "BANCOMAT",
            },
        ],
        "dettaglio_cassa": [
            # Solo lo SC (100), non la CP (200)
            {"incasso": Decimal("100.00"), "tipo": "CONTANTE", "sosp_incassati": Decimal("0.00")},
        ],
        "riepilogo_iva": [{"iva": Decimal("9.09")}],
        "caparre_utilizzate": [],
        "warnings": [],
    }
    rapporto = valida(dati)
    cassa_ctrl = next(c for c in rapporto["controlli"] if "Cassa" in c["nome"])
    assert cassa_ctrl["ok"] is True, (
        "La CP non deve essere inclusa nel controllo Dettaglio di Cassa"
    )


def test_valida_lista_vuota():
    """Con zero documenti e cassa zero → tutti i controlli OK (niente da verificare)."""
    dati = {
        "documenti": [],
        "dettaglio_cassa": [],
        "riepilogo_iva": [],
        "caparre_utilizzate": [],
        "warnings": [],
    }
    rapporto = valida(dati)
    assert rapporto["checksum_ok"] is True


# ---------------------------------------------------------------------------
# Integrazione — PDF reale
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not os.path.exists(PDF_PATH), reason="PDF di test non trovato in uploads/")
def test_parse_pdf_reale_14_documenti():
    """Il PDF di test deve contenere esattamente 14 documenti e 0 righe non parsate."""
    dati = parse_pdf(PDF_PATH)
    assert len(dati["documenti"]) == 14, (
        f"Attesi 14 documenti, trovati {len(dati['documenti'])}"
    )
    assert len(dati["righe_non_parsate"]) == 0, (
        f"Attese 0 righe non parsate, trovate: {dati['righe_non_parsate']}"
    )


@pytest.mark.skipif(not os.path.exists(PDF_PATH), reason="PDF di test non trovato in uploads/")
def test_valida_pdf_reale_checksum_ok():
    """Il PDF reale deve passare tutti i 4 controlli di checksum."""
    dati = parse_pdf(PDF_PATH)
    rapporto = valida(dati)
    assert rapporto["checksum_ok"] is True, (
        f"Checksum fallito. Controlli: {rapporto['controlli']}"
    )
    for ctrl in rapporto["controlli"]:
        assert ctrl["ok"] is True, (
            f"Controllo '{ctrl['nome']}' fallito: diff={ctrl['differenza']}"
        )


@pytest.mark.skipif(not os.path.exists(PDF_PATH), reason="PDF di test non trovato in uploads/")
def test_parse_pdf_strutture_e_tipi():
    """Verifica tipi documento e distribuzione strutture nel PDF reale."""
    dati = parse_pdf(PDF_PATH)
    docs = dati["documenti"]

    tipi = {d["tipo_doc"] for d in docs}
    assert "SC" in tipi or "SCA" in tipi, "Atteso almeno un documento SC o SCA"
    assert "CP" in tipi, "Atteso almeno una caparra CP"

    # Tutti i documenti devono avere data_documento valorizzata
    senza_data = [d for d in docs if not d.get("data_documento")]
    assert len(senza_data) == 0, f"{len(senza_data)} documenti senza data"
