"""Test della stima IVA mensile (Tesoreria Fase 5, blocco C): calcoli puri e collegamento con il calendario fiscale.
Nessun database (l'endpoint è provato in test_tesoreria_fatture_api.py)."""
import os
import sys
from datetime import date
from decimal import Decimal as D

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_calendario import DatiFiscali, genera_scadenze  # noqa: E402
from app.services.tesoreria_iva import (  # noqa: E402
    acquisti_completi, credito_fine_anno, iva_acquisti_per_mese, liquidazioni, vendite_complete,
)


def test_iva_acquisti_per_mese_di_ricezione():
    fatture = [("TD01", D("100.00"), date(2026, 7, 31)), ("TD24", D("50.00"), date(2026, 8, 2)),
               ("TD04", D("10.00"), date(2026, 8, 20)), ("TD17", D("999.00"), date(2026, 8, 5)),
               ("TD01", None, date(2026, 8, 6))]
    assert iva_acquisti_per_mese(fatture) == {(2026, 7): D("100.00"), (2026, 8): D("40.00")}


def test_mesi_completi():
    oggi = date(2026, 11, 5)
    assert acquisti_completi(2026, 10, date(2026, 10, 29), oggi)
    assert not acquisti_completi(2026, 10, date(2026, 10, 20), oggi)        # fatture non ancora scaricate
    assert not acquisti_completi(2026, 11, date(2026, 11, 30), oggi)        # mese in corso
    assert vendite_complete(2026, 3, D(0), False, oggi)                     # fuori stagione a zero: ok
    assert not vendite_complete(2026, 8, D(0), True, oggi)                  # in stagione senza incassi: non importati
    assert vendite_complete(2026, 8, D("1000"), True, oggi)


def test_liquidazioni_credito_riportato_soglia_e_catena():
    vendite = {(2026, 1): D("0"), (2026, 2): D("500"), (2026, 3): D("1020"), (2026, 4): D("30"), (2026, 5): D("900")}
    acquisti = {(2026, 1): D("1000"), (2026, 2): D("300"), (2026, 3): D("0"), (2026, 4): D("10"), (2026, 5): D("0")}
    completi = {(2026, m) for m in (1, 2, 3, 4, 6)}
    r = liquidazioni(2026, vendite, acquisti, completi)
    assert [(x.saldo, x.versamento, x.credito_dopo) for x in r[:4]] == [
        (D("-1000"), D("0"), D("-1000")),
        (D("-800"), D("0"), D("-800")),
        (D("220"), D("220"), D("0")),         # a debito: si versa, il credito si azzera
        (D("20"), D("0"), D("20")),           # sotto 25,82 €: rinviato al mese dopo
    ]
    assert r[2].scadenza == date(2026, 4, 16) and r[11].scadenza == date(2027, 1, 16)
    assert r[4].saldo is None and r[5].saldo is None                         # maggio incompleto: la catena si ferma
    assert credito_fine_anno(r) is None
    tutti = liquidazioni(2026, {}, {(2026, 1): D("50")}, {(2026, m) for m in range(1, 13)})
    assert credito_fine_anno(tutti) == D("50")


def test_calendario_usa_la_stima_dei_mesi_conclusi():
    dati = DatiFiscali(iva_agosto={2026: D("5281.61")})
    dati.iva_dati = {(2026, 10): (D("1200.00"), "Stima"), (2026, 11): (D("0"), "Stima")}
    iva = [s for s in genera_scadenze(date(2026, 11, 1), date(2027, 12, 31), dati) if s.tipo == "iva"]
    assert [(s.codice, s.data, s.importo) for s in iva] == [
        ("iva:2026-10", date(2026, 11, 16), D("1200.00")),
        ("iva:2027-08", date(2027, 9, 16), D("5281.61")),     # mese futuro: ultimo agosto versato
    ]
    # agosto concluso e a credito: nessuna scadenza, anche se l'anno prima si era versato
    dati.iva_dati = {(2027, 8): (D("0"), "Stima")}
    assert not [s for s in genera_scadenze(date(2027, 9, 1), date(2027, 12, 31), dati) if s.tipo == "iva"]
