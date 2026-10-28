"""Test del calcolo dei saldi (modulo Tesoreria). Test puri, nessun database."""
import os
import sys
from datetime import date
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_parser import parse_estratto_cbi  # noqa: E402
from app.services.tesoreria_saldi import saldo_a_data, verifica_saldi  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "tesoreria")

SALDI = {date(2026, 3, 1): Decimal("1000.00"), date(2026, 3, 10): Decimal("1150.00")}
MOVIMENTI = [
    (date(2026, 3, 2), Decimal("200.00")),
    (date(2026, 3, 5), Decimal("-50.00")),
    (date(2026, 3, 12), Decimal("-100.00")),
]


def test_saldo_esatto_su_data_nota():
    assert saldo_a_data(date(2026, 3, 1), SALDI, MOVIMENTI) == Decimal("1000.00")


def test_saldo_in_avanti_dal_saldo_precedente():
    assert saldo_a_data(date(2026, 3, 2), SALDI, MOVIMENTI) == Decimal("1200.00")
    assert saldo_a_data(date(2026, 3, 4), SALDI, MOVIMENTI) == Decimal("1200.00")   # giorno senza movimenti
    assert saldo_a_data(date(2026, 3, 15), SALDI, MOVIMENTI) == Decimal("1050.00")


def test_saldo_all_indietro_prima_del_primo_saldo():
    saldi = {date(2026, 3, 10): Decimal("1150.00")}
    assert saldo_a_data(date(2026, 3, 1), saldi, MOVIMENTI) == Decimal("1000.00")
    assert saldo_a_data(date(2026, 3, 3), saldi, MOVIMENTI) == Decimal("1200.00")


def test_saldo_senza_saldi_noti():
    assert saldo_a_data(date(2026, 3, 1), {}, MOVIMENTI) is None


def test_verifica_saldi_coerenti():
    assert verifica_saldi(SALDI, MOVIMENTI) == []


def test_verifica_segnala_periodo_mancante():
    """Un movimento mancante (es. file non caricato) fa scattare la discrepanza con la differenza."""
    errori = verifica_saldi(SALDI, MOVIMENTI[1:])
    assert len(errori) == 1
    assert errori[0].data_da == date(2026, 3, 1)
    assert errori[0].data_a == date(2026, 3, 10)
    assert errori[0].differenza == Decimal("200.00")


def test_saldi_e_movimenti_del_file_coerenti():
    with open(os.path.join(FIXTURES, "estratto_principale.xml"), "rb") as f:
        risultato = parse_estratto_cbi(f.read())
    movimenti = [(m.data_contabile, m.importo) for m in risultato.movimenti]
    assert verifica_saldi(risultato.saldi, movimenti) == []
    # Il 04/03 non ha movimenti: saldo = chiusura del 03/03
    assert saldo_a_data(date(2026, 3, 4), risultato.saldi, movimenti) == Decimal("10820.61")
