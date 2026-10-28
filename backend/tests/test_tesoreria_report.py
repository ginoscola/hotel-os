"""Test dei calcoli puri di posizione e consuntivo (modulo Tesoreria). Nessun database."""
import os
import sys
from datetime import date
from decimal import Decimal

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_report import (  # noqa: E402
    SOGLIE_DEFAULT, aggrega, anno_prima, mesi_tra, stato_fido, valida_soglie,
)
from app.utils.locale_it import formatta_euro_it  # noqa: E402

D = Decimal


def test_soglie_valide_e_non():
    assert valida_soglie({"giorni_estratto": "10"}) == {"giorni_estratto": 10}
    assert set(SOGLIE_DEFAULT) == {"giorni_estratto", "giorni_saldo_carta", "giorni_preavviso_fido"}
    for errata in ({"giorni_estratto": 0}, {"giorni_estratto": "x"}, {"altro": 5}):
        with pytest.raises(ValueError):
            valida_soglie(errata)


def test_anno_prima():
    assert anno_prima(date(2026, 3, 15)) == date(2025, 3, 15)
    assert anno_prima(date(2028, 2, 29)) == date(2027, 2, 28)


@pytest.mark.parametrize("giorno, atteso", [
    (date(2027, 7, 1), (True, None)),                # oltre i 60 giorni di preavviso
    (date(2027, 8, 1), (True, "arancione")),         # 60 giorni prima
    (date(2027, 9, 30), (True, "arancione")),        # giorno di scadenza: ancora conteggiato
    (date(2027, 10, 1), (False, "rosso")),           # scaduto
])
def test_stato_fido(giorno, atteso):
    s = stato_fido(D("130000"), date(2027, 9, 30), giorno, 60)
    assert (s["conteggiato"], s["livello"]) == atteso


def test_fido_senza_scadenza_o_nullo():
    assert stato_fido(D("1000"), None, date(2030, 1, 1), 60)["conteggiato"] is True
    assert stato_fido(D("0"), date(2020, 1, 1), date(2030, 1, 1), 60) == \
        {"conteggiato": False, "livello": None, "giorni_alla_scadenza": None}


def test_mesi_tra():
    assert mesi_tra(date(2025, 11, 20), date(2026, 2, 1)) == [(2025, 11), (2025, 12), (2026, 1), (2026, 2)]


def test_aggrega_operativi_non_operativi_ed_esclusi():
    movimenti = [
        (date(2026, 3, 2), D("500.00"), 1),       # operativa
        (date(2026, 3, 3), D("-200.00"), 1),
        (date(2026, 4, 1), D("140000.00"), 2),    # non operativa (erogazione mutuo)
        (date(2026, 4, 2), D("3000.00"), 3),      # giroconto escluso
        (date(2026, 4, 2), D("-3000.00"), 3),
        (date(2026, 4, 5), D("-10.00"), None),    # senza categoria → ripiego
    ]
    agg = aggrega(movimenti, non_operative={2, 3}, escluse={3}, ripiego=9)
    assert (agg.operativi.entrate, agg.operativi.uscite, agg.operativi.netto) == (D("500.00"), D("-210.00"), D("290.00"))
    assert agg.non_operativi.netto == D("140000.00")
    assert (agg.giroconti_esclusi.n, agg.giroconti_esclusi.netto) == (2, D("0.00"))
    assert 3 not in agg.per_categoria and agg.per_categoria[9].netto == D("-10.00")
    assert agg.per_mese[(2026, 3)].netto == D("300.00") and agg.per_mese[(2026, 4)].netto == D("-10.00")


def test_formatta_euro_it():
    assert formatta_euro_it(D("-1478.89")) == "-1.478,89 €"
    assert formatta_euro_it(D("130000")) == "130.000,00 €"
    assert formatta_euro_it(None) is None


# ── Carte di credito ────────────────────────────────────────────────────────────

from app.services.tesoreria_report import stato_carta  # noqa: E402

CHIUSURA = date(2026, 10, 6)
ADDEBITO_AMEX = (date(2026, 10, 27), D("-3042.39"), "SDD Core - Richiesta Incasso SEPA 01M4 AMERICAN EXPRESS ITALIA")


def test_carta_da_addebitare_prima_del_pagamento():
    s = stato_carta(CHIUSURA, D("3042.39"), [ADDEBITO_AMEX], "AMERICAN EXPRESS", date(2026, 10, 20))
    assert (s["saldo"], s["stato"]) == (D("3042.39"), "da_addebitare")


def test_carta_addebitata_torna_a_zero():
    s = stato_carta(CHIUSURA, D("3042.39"), [ADDEBITO_AMEX], "american express", date(2026, 10, 28))
    assert (s["saldo"], s["stato"], s["data_addebito"]) == (D("0.00"), "addebitato", date(2026, 10, 27))


@pytest.mark.parametrize("candidato, testo", [
    ((date(2026, 10, 27), D("-3042.38"), ADDEBITO_AMEX[2]), "AMERICAN EXPRESS"),     # importo diverso
    ((date(2026, 10, 5), D("-3042.39"), ADDEBITO_AMEX[2]), "AMERICAN EXPRESS"),      # prima della chiusura
    ((date(2026, 12, 1), D("-3042.39"), ADDEBITO_AMEX[2]), "AMERICAN EXPRESS"),      # oltre i 45 giorni
    ((date(2026, 10, 27), D("-3042.39"), "Carta del Credito Cooperativo"), "AMERICAN EXPRESS"),  # altra carta
])
def test_carta_addebito_non_riconosciuto(candidato, testo):
    s = stato_carta(CHIUSURA, D("3042.39"), [candidato], testo, date(2026, 12, 31))
    assert s["stato"] == "da_addebitare"


def test_carta_senza_testo_abbina_solo_importo_e_estratto_a_zero():
    assert stato_carta(CHIUSURA, D("3042.39"), [ADDEBITO_AMEX], None, date(2026, 10, 28))["stato"] == "addebitato"
    assert stato_carta(CHIUSURA, D("0"), [], "X", date(2026, 10, 28))["stato"] == "nessun_debito"
