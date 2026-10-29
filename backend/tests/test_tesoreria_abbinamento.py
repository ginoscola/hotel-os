"""Test del motore di abbinamento scadenze Passcom ↔ banca (modulo Tesoreria, Fase 2). Test puri.

Nomi e importi inventati, con le forme reali di Passcom e dell'estratto conto (sigle puntate, nomi
troncati a 24 caratteri, "Ri.Ba. scadenza", "saldo ft …").
"""
import os
import sys
from datetime import date
from decimal import Decimal as D

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tesoreria_abbinamento import (  # noqa: E402
    MovimentoUscita, ScadenzaDaAbbinare, abbina, forza_nome, numero_fattura, parole,
)


def S(chiave, giorno, tipo, codice, nome, importo, numero=None, doc=None):
    return ScadenzaDaAbbinare(chiave, giorno, tipo, codice, nome, D(importo), numero, doc)


def M(id_, giorno, importo, abi, controparte=None, testo=""):
    return MovimentoUscita(id_, giorno, D(importo), abi, controparte, testo)


def test_parole_e_sigle():
    assert parole("C.I.L COMPAGNIA ITALIANA LAVANDERIE S.P.A") == ["CIL", "COMPAGNIA", "ITALIANA", "LAVANDERIE"]
    assert parole("CAFFÈ Rossi s.r.l.") == ["CAFFE", "ROSSI"]
    assert parole(None) == []


def test_forza_nome():
    assert forza_nome("TIM  S.p.A.", "TIM SPA") == 2
    assert forza_nome("F. G. di Faitanini Cristian & C s.a.s.", "F.G. DI FAITANINI CRISTI") == 2   # troncato
    assert forza_nome("GLAM SOC.CONSORTILE PER AZIONI", "GLAM SOCIETA CONSORTILE PER AZIONI") == 2
    assert forza_nome("ZUCCHETTI HOSPITALITY SRL", "ZUCCHETTI SPA") == 1
    assert forza_nome("La Fourchette (Italy) srl", "GC RE THEFORK") == 0
    assert forza_nome("La Fourchette (Italy) srl", "GC RE THEFORK", {"GC RE THEFORK"}) == 2       # alias imparato
    assert forza_nome("ROSSI SRL", None) == 0


def test_numero_fattura():
    assert numero_fattura("1/718") == "718"
    assert numero_fattura("00000000000942") == "942"
    assert numero_fattura("7") is None and numero_fattura(None) is None


def test_riba_somma_con_nota_di_credito():
    g = date(2026, 9, 30)
    sc = [S("a", g, "RIC.BANC.", "601.1", "MARRONI S.p.A.", "120.50"),
          S("b", g, "RIC.BANC.", "601.1", "MARRONI S.p.A.", "80.25"),
          S("c", g, "RIC.BANC.", "601.1", "MARRONI S.p.A.", "-20.75")]
    mov = [M(1, g, "-100.00", "31//48", "MARRONI S.P.A."), M(2, g, "-80.00", "31//48", "MARRONI S P A")]
    [p] = abbina(sc, mov)
    assert p.stato == "automatico" and p.regola == "riba_somma"
    assert sorted(p.chiavi) == ["a", "b", "c"] and sorted(p.movimenti) == [1, 2]


def test_riba_uno_a_uno_e_fuori_finestra():
    g = date(2026, 9, 30)
    sc = [S("a", g, "RIC.BANC.", "601.1", "IGEA CARNI SRL", "55.21"),
          S("b", g, "RIC.BANC.", "601.1", "IGEA CARNI SRL", "65.19"),
          S("c", g, "RIC.BANC.", "601.1", "IGEA CARNI SRL", "99.00")]
    mov = [M(1, g, "-55.21", "31//48", "IGEA CARNI S.R.L."), M(2, date(2026, 10, 2), "-65.19", "31//48", "IGEA CARNI S.R.L."),
           M(3, date(2026, 10, 9), "-99.00", "31//48", "IGEA CARNI S.R.L.")]       # 9 giorni dopo: fuori
    proposte = abbina(sc, mov)
    assert {(tuple(p.chiavi), tuple(p.movimenti), p.stato) for p in proposte} == {
        (("a",), (1,), "automatico"), (("b",), (2,), "automatico")}


def test_sdd_automatico_e_nome_diverso_da_confermare():
    sc = [S("a", date(2026, 10, 16), "ADDEB. C/C", "601.2", "NUOVA ASCOM SERVIZI", "1188.28"),
          S("b", date(2026, 10, 21), "ADDEB. C/C", "601.3", "La Fourchette (Italy) srl", "489.27")]
    mov = [M(1, date(2026, 10, 21), "-1188.28", "31//22", "NUOVA ASCOM SERVIZI - C.A.T."),
           M(2, date(2026, 10, 23), "-489.27", "31//22", "GC RE THEFORK")]
    p = {tuple(x.chiavi): x for x in abbina(sc, mov)}
    assert p[("a",)].stato == "automatico" and p[("a",)].regola == "sdd"
    assert p[("b",)].stato == "proposto" and "Nome in banca diverso" in p[("b",)].nota
    assert p[("b",)].nomi_banca == ["GC RE THEFORK"]


def test_importo_diverso_di_un_centesimo_non_abbina():
    sc = [S("a", date(2026, 10, 16), "ADDEB. C/C", "601.2", "TELEFONIA ROSSI", "25.47")]
    assert abbina(sc, [M(1, date(2026, 10, 16), "-25.48", "31//22", "TELEFONIA ROSSI")]) == []


def test_contanti_pagato_con_bonifico_da_confermare():
    sc = [S("a", date(2026, 10, 14), "CONTANTI", "601.4", "ORTOFRUTTA BIANCHI SRL", "172.89")]
    [p] = abbina(sc, [M(1, date(2026, 10, 20), "-172.89", "26//11", "ORTOFRUTTA BIANCHI S.R.", "saldo ft 55")])
    assert p.stato == "proposto" and p.regola == "altra_modalita" and "CONTANTI" in p.nota


def test_bonifico_numero_citato_e_somma_di_piu_fatture():
    sc = [S("a", date(2026, 9, 30), "BONIFICO", "601.5", "GLAMOUR CONSORZIO SPA", "3707.80", "1762"),
          S("b", date(2026, 9, 30), "BONIFICO", "601.6", "VERDI LUIGI", "100.00", "12"),
          S("c", date(2026, 9, 30), "BONIFICO", "601.6", "VERDI LUIGI", "250.00", "13")]
    mov = [M(1, date(2026, 10, 14), "-3707.80", "26//11", "GLAMOUR SOCIETA", "saldo FT 1762"),
           M(2, date(2026, 10, 5), "-350.00", "26//11", "VERDI LUIGI", "saldo ft 12 e 13")]
    p = {tuple(sorted(x.chiavi)): x for x in abbina(sc, mov)}
    assert p[("a",)].stato == "automatico"          # nome debole ma numero fattura citato
    assert p[("b", "c")].regola == "bonifico_somma" and p[("b", "c")].stato == "automatico"


def test_stesso_importo_ripetuto_da_confermare():
    sc = [S("a", date(2026, 10, 7), "ADDEB. C/C", "601.7", "NUMIA SPA", "45.75"),
          S("b", date(2026, 11, 5), "ADDEB. C/C", "601.7", "NUMIA SPA", "45.75")]
    mov = [M(1, date(2026, 11, 5), "-45.75", "31//22", "NUMIA SPA"), M(2, date(2026, 10, 9), "-45.75", "31//22", "NUMIA SPA")]
    p = {x.chiavi[0]: x for x in abbina(sc, mov)}
    # la prima resta da confermare (due scadenze uguali), la seconda è l'unica rimasta nella sua finestra
    assert (p["a"].movimenti, p["a"].stato) == ([2], "proposto") and "stesso importo" in p["a"].nota
    assert (p["b"].movimenti, p["b"].stato) == ([1], "automatico")


def test_assegno_solo_se_univoco():
    s1 = S("a", date(2026, 10, 12), "BONIFICO", "601.8", "SOGLIA SNC", "1350.00", doc=date(2026, 10, 12))
    [p] = abbina([s1], [M(1, date(2026, 10, 14), "-1350.00", "13//00", None, "Vs assegno n.")])
    assert p.regola == "assegno" and p.stato == "proposto"
    s2 = S("b", date(2026, 10, 20), "CONTANTI", "601.9", "ALTRO SRL", "1350.00")
    assert abbina([s1, s2], [M(1, date(2026, 10, 14), "-1350.00", "13//00", None, "Vs assegno n.")]) == []


def test_coppie_scartate_non_riproposte():
    sc = [S("a", date(2026, 10, 16), "ADDEB. C/C", "601.2", "TELEFONIA ROSSI", "25.47")]
    mov = [M(1, date(2026, 10, 16), "-25.47", "31//22", "TELEFONIA ROSSI")]
    assert abbina(sc, mov, scartati={("a", 1)}) == []
    assert abbina(sc, [M(1, date(2026, 10, 16), "25.47", "31//22", "TELEFONIA ROSSI")]) == []   # entrata: mai
