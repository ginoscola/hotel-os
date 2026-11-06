"""Test delle regole pure delle spese straordinarie (services/tesoreria_spese_straordinarie.py)."""
import os
import sys
from datetime import date
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_spese_straordinarie import (  # noqa: E402
    FatturaSpesa, anno_alberghiero, applica_allo_storico, da_togliere, modalita_da_passcom, predefiniti,
)

D = Decimal


def test_modalita_da_passcom_e_predefiniti():
    assert [modalita_da_passcom(t) for t in ("RIC.BANC.", "ADDEB. C/C", "RIMESSA", "BONIFICO", "CONTANTI", "CARTA", "NON INDICATA", None)] == \
        ["riba", "sdd", "bonifico", "bonifico", "contanti", "carta", None, None]
    s = date(2025, 4, 30)
    assert predefiniti("RIC.BANC.", s, False) == ("riba", s)
    assert predefiniti("RIC.BANC.", s, True) == ("carta", s)                        # fornitore pagato con carta
    assert predefiniti("BONIFICO", s, True, ("fornitori_sdd", date(2025, 5, 2))) == ("sdd", date(2025, 5, 2))  # pagamento trovato


def test_anno_alberghiero():
    assert anno_alberghiero(date(2026, 11, 6)) == 2027
    assert anno_alberghiero(date(2026, 9, 30)) == 2026


def test_da_togliere_regole():
    oggi = date(2026, 11, 6)
    fatture = [
        FatturaSpesa("a", D("100"), "riba", date(2025, 4, 30)),
        FatturaSpesa("b", D("50"), "riba", date(2025, 4, 2)),
        FatturaSpesa("c", D("-20"), "riba", date(2025, 4, 30)),           # nota di credito
        FatturaSpesa("d", D("70"), "carta", date(2025, 5, 27)),
        FatturaSpesa("e", D("30"), "contanti", date(2025, 4, 30)),        # non passa dalla banca
        FatturaSpesa("f", D("40"), "bonifico", date(2025, 4, 30), gia_fuori=True),   # bonifico già straordinario
        FatturaSpesa("g", D("40"), "bonifico", date(2026, 12, 1)),        # futura
        FatturaSpesa("h", D("40"), "bonifico", date(2026, 1, 1), aperta=True),       # ancora da pagare
        FatturaSpesa("i", D("40"), "riba", None),                          # data mancante
    ]
    assert da_togliere(fatture, oggi) == {"fornitori_riba": {(2025, 4): D("130")}, "carte": {(2025, 5): D("70")}}


def test_applica_allo_storico_mai_sotto_zero():
    uscite = {"fornitori_riba": {(2025, 4): D("100")}, "carte": {(2025, 5): D("500")}}
    nuove, tolto, avvisi = applica_allo_storico(uscite, {"fornitori_riba": {(2025, 4): D("130")}, "carte": {(2025, 5): D("70")},
                                                         "assegni": {(2025, 6): D("10")}})
    assert nuove["fornitori_riba"][(2025, 4)] == 0 and nuove["carte"][(2025, 5)] == D("430")
    assert tolto == {"fornitori_riba": {(2025, 4): D("100")}, "carte": {(2025, 5): D("70")}}
    assert [(a["categoria"], a["importo"], a["uscito"]) for a in avvisi] == [("fornitori_riba", D("130"), D("100")), ("assegni", D("10"), D("0"))]
    assert uscite["fornitori_riba"][(2025, 4)] == D("100")           # l'originale non cambia
