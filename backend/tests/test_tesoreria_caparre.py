"""Test caparre per mese di arrivo (Tesoreria Fase 4a): lettura della causale sui formati visti nei bonifici reali
(nomi e date inventati), aggregazioni per mese di arrivo e rettifica degli incassi nella previsione."""
import os
import sys
from datetime import date
from decimal import Decimal as D

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_caparre import (  # noqa: E402
    abbina_prenotazione, distribuisci, future_al, indice_prenotazioni, leggi_arrivo, leggi_struttura, parole_nome,
    per_mese_arrivo,
)
from app.services.tesoreria_previsione import DatiPrevisione, calcola_scenario  # noqa: E402

PAG = date(2026, 3, 2)
B = "Bonifico a vs favore *"


@pytest.mark.parametrize("causale, arrivo", [
    ("ROSSI MARIO CAPARRA PER SOGGIORNO PRESSO HOTEL DU PARC A NOME MARIO ROSSI DAL 22/08/2026 AL 29/08/2026", date(2026, 8, 22)),
    ("CAPARRA PER SOGGIORNO PRESSO HOTEL DU PARC A NOME LUCA BIANCHIDAL 14/06/2026 AL 15/", date(2026, 6, 14)),
    ("CAPARRA PER SOGGIORNO PRESSO CLUB HOTEL A NOME ANNA VERDI DAL 13/07/205 AL 20/07/2026", date(2026, 7, 13)),
    ("CAPARRA CLUB HOTEL DAL 19/07/2AL 26/07/26", date(2026, 7, 19)),
    ("DAL 03.08.26 AL 10.08.26", date(2026, 8, 3)),
    ("caparra dal 07 08 2026 al 21 08 2026", date(2026, 8, 7)),
    ("CAPARRA PER SOGGIORNO PRESSO HOTEL INTERNATIONAL DAL 13 06 26 AL 20", date(2026, 6, 13)),
    ("CAPARRA HOTEL DU PARC DAL 30082026 AL 05092026", date(2026, 8, 30)),
    ("caparra soggiorno dal 16 al 22 agosto 2026", date(2026, 8, 16)),
    ("CAPARRA SOGG HOTEL INTERNATIONAL ROSSI 23-26LUG2026", date(2026, 7, 23)),
    ("PERIOD OF STAY 010826 - 080826", date(2026, 8, 1)),
    ("CAPARRA SOGGIORNO 26.07.2026 AU 02.08.2026", date(2026, 7, 26)),
    ("caparra confirmatoria soggiorno 26 luglio 2 agosto", date(2026, 7, 26)),
    ("CAPARRA SOGGIORNO AGOSTO 2026 ROSSI", date(2026, 8, 1)),
    ("CAPARRA HOTEL DU PARC DAL 7/3/2026 AL 7/10/2026", date(2026, 7, 3)),       # giorno e mese invertiti
    ("CAPARRA HOTEL INTERNATIONAL DAL 18/07/2052 AL 25/07/2026", date(2026, 7, 18)),
])
def test_legge_la_data_di_arrivo(causale, arrivo):
    assert leggi_arrivo(B + causale + " Info aggiuntive: Data ordine: 02/03/2026", PAG)[0] == arrivo


def test_anno_successivo_se_manca_e_la_data_e_passata():
    assert leggi_arrivo(B + "CAPARRA DAL 12/07 AL 19/07", date(2026, 9, 20))[0] == date(2027, 7, 12)


@pytest.mark.parametrize("causale", [
    "CAPARRA PRENOTAZIONE BK/2026/104 ROSSI",
    "SALDO SOGGIORNO ROSSI",
    "PRENOTAZIONE DEL 10 FEBBRAIO 2026 COD BK 2026 012",      # data della prenotazione, fuori stagione
    "MARCHE MULTISERVIZI SPA 8060BC20250000011179 200012683962-242500349140",
])
def test_non_legge_senza_un_arrivo_plausibile(causale):
    assert leggi_arrivo(B + causale, PAG) == (None, None)


def test_ignora_intestazione_dei_bonifici_istantanei():
    testo = B + "INSTANT DEL 05/03/2026 ORE 16:32 ID. 39000260305D00979400000001 ORD Rossi MarioCaparra per soggior"
    assert leggi_arrivo(testo, date(2026, 3, 5)) == (None, None)


def test_testo_dopo_info_aggiuntive_ignorato():
    assert leggi_arrivo(B + "ROSSI Info aggiuntive: Data ordine: 12/07/2026", PAG) == (None, None)


@pytest.mark.parametrize("causale, struttura", [
    ("CAPARRA PER SOGGIORNO PRESSO CLUB HOTEL", "CLB"),
    ("CAPARRA HOTEL INTERNATIONAL", "INT"),
    ("CAPARRA HOTEL DU PARC", "DPH"),
    ("CAPARRA HOTEL DU PA RC", "DPH"),
    ("CAPARRA HOTEL DU PARK", "DPH"),
    ("CAPARRA PER SOGGIORNO", None),
    ("CAPARRA CLUB HOTEL E HOTEL INTERNATIONAL", None),
])
def test_struttura(causale, struttura):
    assert leggi_struttura(B + causale) == struttura


CAPARRE = [
    (date(2025, 11, 3), date(2026, 7, 12), "CLB", D("500")),
    (date(2026, 2, 1), date(2026, 7, 20), None, D("300")),
    (date(2026, 7, 25), date(2026, 7, 20), "CLB", D("900")),     # pagato dopo l'arrivo: saldo, non caparra
    (date(2026, 3, 1), date(2026, 8, 9), "INT", D("200")),
]


def test_per_mese_arrivo_alla_data():
    assert per_mese_arrivo(CAPARRE, date(2026, 1, 31), 2026) == {7: {"CLB": D("500")}}
    assert per_mese_arrivo(CAPARRE, date(2026, 12, 31), 2026) == {7: {"CLB": D("500"), "": D("300")}, 8: {"INT": D("200")}}


def test_future_al():
    assert future_al(CAPARRE, date(2026, 7, 10)) == {(2026, 7): {"CLB": D("500"), "": D("300")}, (2026, 8): {"INT": D("200")}}
    assert future_al(CAPARRE, date(2026, 7, 15)) == {(2026, 7): {"": D("300")}, (2026, 8): {"INT": D("200")}}
    assert future_al(CAPARRE, date(2026, 8, 9)) == {}


def _dati(caparre):
    return DatiPrevisione(
        oggi=date(2026, 11, 3), orizzonte=date(2027, 8, 31), saldo_iniziale=D("0"),
        entrate={(2026, 6): D("1000"), (2026, 7): D("2000"), (2026, 8): D("3000")}, uscite={}, certe=[],
        budget={2027: D("1100")}, ricavi={2026: D("1000")}, caparre=caparre,
    )


def _mese(righe, y, m):
    return next(r for r in righe if (r["anno"], r["mese"]) == (y, m))


def test_rettifica_caparre_sposta_gli_incassi():
    # luglio 2027: 500 già in banca contro 200 un anno fa (× 1,1 = 220) → 280 incassati in anticipo
    righe = calcola_scenario(_dati({(2027, 7): (D("500"), D("200")), (2027, 8): (D("0"), D("100"))}), "realista")
    luglio, agosto = _mese(righe, 2027, 7), _mese(righe, 2027, 8)
    assert luglio["rettifica_caparre"] == D("280")
    assert luglio["entrate"] == D("2200") - D("280")
    assert agosto["rettifica_caparre"] == D("-110")             # in ritardo: arriveranno a ridosso dell'arrivo
    assert agosto["entrate"] == D("3300") + D("110")
    assert _mese(righe, 2027, 6)["rettifica_caparre"] == 0


def test_rettifica_nulla_senza_storico_dell_anno_prima():
    righe = calcola_scenario(_dati({(2027, 7): (D("500"), None)}), "realista")
    assert _mese(righe, 2027, 7)["rettifica_caparre"] == 0
    assert _mese(righe, 2027, 7)["entrate"] == D("2200")


def test_entrate_mai_negative():
    righe = calcola_scenario(_dati({(2027, 7): (D("9000"), D("0"))}), "realista")
    assert _mese(righe, 2027, 7)["entrate"] == 0



def _p(nome, arrivo, prenotata, struttura, codice):
    return (frozenset(parole_nome(nome)), arrivo, prenotata, struttura, codice)


PRENOTAZIONI = indice_prenotazioni([
    _p("Cerchioni Massimo", date(2026, 8, 9), date(2026, 1, 20), "INT", "101"),
    _p("Ortler Federico", date(2026, 6, 20), date(2026, 1, 30), "CLB", "102"),
    _p("Ortler Federico", date(2026, 6, 27), date(2026, 1, 30), "CLB", "103"),      # stesso mese: va bene
    _p("Bianchi Laura", date(2026, 7, 4), date(2026, 2, 1), "DPH", "104"),
    _p("Bianchi Laura", date(2026, 8, 15), date(2026, 2, 1), "DPH", "105"),         # mesi diversi: ambiguo
    _p("Verdi Anna", date(2026, 7, 10), date(2026, 3, 15), "DPH", "106"),           # prenotata dopo il bonifico
    _p("Kemp", date(2026, 9, 4), date(2026, 2, 1), "INT", "107"),
])


def test_abbina_prenotazione_per_nome_ospite():
    assert abbina_prenotazione("CERCHIONI MASSIMO GUIDOTTI BARBARA CAPARRA", date(2026, 1, 27), PRENOTAZIONI) == \
        (date(2026, 8, 9), "INT", "101")
    assert abbina_prenotazione("ORTLER FEDERICO, MESSNER MARIA", date(2026, 2, 3), PRENOTAZIONI) == \
        (date(2026, 6, 20), "CLB", "102")
    assert abbina_prenotazione("Sarah Kemp caparra", date(2026, 3, 1), PRENOTAZIONI) is None    # una parola corta
    assert abbina_prenotazione("BIANCHI LAURA CAPARRA", date(2026, 2, 10), PRENOTAZIONI) is None  # due mesi
    assert abbina_prenotazione("VERDI ANNA CAPARRA", date(2026, 3, 1), PRENOTAZIONI) is None      # non ancora prenotata
    assert abbina_prenotazione("CERCHIONI CAPARRA", date(2026, 1, 27), PRENOTAZIONI) is None      # una sola parola


def test_distribuisci():
    assert distribuisci(D("100"), {7: D("300"), 8: D("100")}) == {7: D("75"), 8: D("25")}
    assert distribuisci(D("100"), {}) == {}
