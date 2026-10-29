"""Motore di abbinamento scadenze Passcom ↔ movimenti bancari (modulo Tesoreria, Fase 2). Funzioni pure.

Una scadenza aperta per lo studio è "pagata" se in banca c'è un'uscita compatibile. La modalità indicata
in Passcom è solo un'indicazione (decisione dell'utente, 29/10/2026): si cerca prima con la regola della
modalità indicata, poi con gli altri canali (il risultato è allora sempre da confermare).

Canali (codice causale ABI dell'estratto conto):
- **Ri.Ba.** (`31//48`, "Ri.Ba. scadenza gg/mm/aa"): scadenze RIC.BANC. dello stesso fornitore e della
  stessa data, entro ±3 giorni. Una Ri.Ba. può pagare più fatture e un fornitore può avere più addebiti lo
  stesso giorno (MARR): si confronta la **somma** delle scadenze con la somma degli addebiti, poi 1:1.
- **Addebito diretto SDD** (`31//22`, `31//21`): stesso importo, creditore simile, ±7 giorni.
- **Bonifico** (`26//11`, `26//10`, `26//31`): stesso importo o somma delle fatture citate nella causale
  ("saldo ft 1762 1763"), nome simile, ±15 giorni.
- **Assegno** (`13//00`): la banca non riporta il beneficiario → solo importo e data, sempre da confermare.

Stati: `automatico` solo se sicuro (nome riconosciuto con forza piena, importo esatto, modalità indicata,
un solo candidato); altrimenti `proposto` (da confermare). Gli abbinamenti già confermati/scartati e le
scadenze segnate pagate a mano non si toccano: arrivano qui come esclusioni.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from itertools import combinations
from typing import Optional

CENT = Decimal("0.01")

ABI_RIBA = ("31//48",)
ABI_SDD = ("31//22", "31//21")
ABI_BONIFICO = ("26//11", "26//10", "26//31")
ABI_ASSEGNO = ("13//00",)
ABI_PAGAMENTI = ABI_RIBA + ABI_SDD + ABI_BONIFICO + ABI_ASSEGNO

# Modalità Passcom → canale principale
CANALE_DI_MODALITA = {"RIC.BANC.": "riba", "ADDEB. C/C": "sdd", "BONIFICO": "bonifico", "RIMESSA": "bonifico"}

FINESTRA = {"riba": 3, "sdd": 7, "bonifico": 15}
FINESTRA_ALTRO = (-30, 45)          # altra modalità: da 30 giorni prima a 45 dopo la scadenza
MAX_COMBINAZIONI = 6                # addebiti Ri.Ba. dello stesso giorno provati insieme

# Parole che non distinguono un fornitore (forme societarie, articoli)
PAROLE_VUOTE = {
    "SPA", "SRL", "SRLS", "SNC", "SAS", "SS", "STP", "SOC", "SOCIETA", "COOP", "COOPERATIVA", "PER", "AZIONI",
    "DI", "DEL", "DELLA", "DELLE", "DEI", "E", "ED", "IL", "LA", "LE", "LO", "GLI", "C", "CO", "A", "UNICO",
    "SOCIO", "RESPONSABILITA", "LIMITATA", "BENEFIT", "LTD", "LIMITED", "LLC", "INC", "BV", "GMBH", "SLU", "SL",
    "SA", "AG", "UNIPERSONALE", "VIA", "DEP",
}


@dataclass
class ScadenzaDaAbbinare:
    chiave: str
    data_scadenza: date
    tipo_pagamento: str
    codice_fornitore: str
    fornitore: str
    importo: Decimal
    numero_documento: Optional[str] = None
    data_documento: Optional[date] = None


@dataclass
class MovimentoUscita:
    id: int
    data: date
    importo: Decimal                    # negativo
    causale_abi: Optional[str]
    controparte: Optional[str]
    testo: str                          # causale + descrizione

    @property
    def canale(self) -> Optional[str]:
        abi = self.causale_abi or ""
        if abi in ABI_RIBA:
            return "riba"
        if abi in ABI_SDD:
            return "sdd"
        if abi in ABI_BONIFICO:
            return "bonifico"
        if abi in ABI_ASSEGNO:
            return "assegno"
        return None


@dataclass
class Proposta:
    chiavi: list
    movimenti: list                     # id movimento
    stato: str                          # automatico | proposto
    regola: str                         # riba, riba_somma, sdd, bonifico, bonifico_somma, assegno, altra_modalita
    nota: str = ""
    nomi_banca: list = field(default_factory=list)    # controparti (per imparare gli alias)


# ── Nomi ───────────────────────────────────────────────────────────────────────

def _senza_accenti(testo: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", testo) if not unicodedata.combining(c))


def parole(nome: Optional[str]) -> list:
    """Parole significative di un nome: maiuscolo, senza accenti e punteggiatura, sigle puntate unite
    ('C.I.L' → 'CIL', 'S.P.A.' → 'SPA'), senza forme societarie e articoli."""
    if not nome:
        return []
    grezze = re.findall(r"[A-Z0-9]+", _senza_accenti(nome).upper())
    unite, sigla = [], ""
    for p in grezze:
        if len(p) == 1 and p.isalpha():
            sigla += p
            continue
        if sigla:
            unite.append(sigla)
            sigla = ""
        unite.append(p)
    if sigla:
        unite.append(sigla)
    return [p for p in unite if p not in PAROLE_VUOTE and len(p) >= 2]


def normalizza_nome(nome: Optional[str]) -> str:
    return " ".join(parole(nome))


def _uguali(a: str, b: str) -> bool:
    """Stessa parola, o una troncata dell'altra (la banca tronca i nomi a 24–31 caratteri)."""
    if a == b:
        return True
    return min(len(a), len(b)) >= 4 and (a.startswith(b) or b.startswith(a))


def forza_nome(fornitore: str, controparte: Optional[str], alias: set = frozenset()) -> int:
    """2 = stesso fornitore (alias imparato, oppure tutte le parole o almeno due in comune);
    1 = una parola di almeno 4 lettere in comune; 0 = nessuna somiglianza."""
    if not controparte:
        return 0
    if normalizza_nome(controparte) in alias:
        return 2
    pf = [p for p in parole(fornitore) if len(p) >= 3]
    pc = parole(controparte)
    if not pf or not pc:
        return 0
    comuni = [p for p in pf if any(_uguali(p, c) for c in pc)]
    if len(comuni) >= 2 or (comuni and len(comuni) == len(pf)):
        return 2
    if any(len(p) >= 4 for p in comuni):
        return 1
    return 0


def numeri_citati(testo: str) -> set:
    """Numeri presenti nel testo (senza zeri iniziali), per riconoscere 'saldo ft 1762 1763'."""
    return {n.lstrip("0") for n in re.findall(r"\d+", testo or "") if n.strip("0")}


def numero_fattura(numero: Optional[str]) -> Optional[str]:
    """Parte numerica significativa del numero documento ('1/718' → '718', '00000942' → '942')."""
    if not numero:
        return None
    cifre = re.findall(r"\d+", numero)
    if not cifre:
        return None
    n = max(cifre, key=len).lstrip("0")
    return n if len(n) >= 2 else None


# ── Motore ─────────────────────────────────────────────────────────────────────

def _dist(m: MovimentoUscita, s_data: date) -> int:
    return abs((m.data - s_data).days)


def _somma(valori) -> Decimal:
    return sum(valori, Decimal("0"))


def abbina(scadenze: list, movimenti: list, alias: Optional[dict] = None, scartati: set = frozenset()) -> list:
    """Restituisce le proposte di abbinamento.

    `scadenze`: scadenze aperte da abbinare (già esclusi pareggi, fornitori saldati, residui, scadenze
    confermate o pagate a mano). `movimenti`: uscite bancarie non ancora usate da abbinamenti confermati.
    `alias`: {codice fornitore: {nome banca normalizzato}}. `scartati`: coppie (chiave, id movimento) che
    l'utente ha scartato, da non riproporre.
    """
    alias = alias or {}
    usate, usati = set(), set()
    proposte = []

    def libero(m, chiavi=()):
        return m.id not in usati and not any((k, m.id) in scartati for k in chiavi)

    def forza(s, m):
        return forza_nome(s.fornitore, m.controparte, alias.get(s.codice_fornitore, set()))

    def registra(chiavi, movs, stato, regola, nota=""):
        usate.update(chiavi)
        usati.update(m.id for m in movs)
        proposte.append(Proposta(chiavi=list(chiavi), movimenti=[m.id for m in movs], stato=stato, regola=regola,
                                 nota=nota, nomi_banca=sorted({m.controparte for m in movs if m.controparte})))

    per_canale = {"riba": [], "sdd": [], "bonifico": [], "assegno": []}
    for m in movimenti:
        if m.importo < 0 and m.canale:
            per_canale[m.canale].append(m)

    # 1. Ri.Ba.: gruppi per fornitore e data di scadenza
    gruppi = {}
    for s in scadenze:
        if CANALE_DI_MODALITA.get(s.tipo_pagamento) == "riba":
            gruppi.setdefault((s.codice_fornitore, s.data_scadenza), []).append(s)
    for (_, giorno), gruppo in sorted(gruppi.items(), key=lambda x: x[0][1]):
        cand = [m for m in per_canale["riba"] if libero(m, [s.chiave for s in gruppo])
                and _dist(m, giorno) <= FINESTRA["riba"] and forza(gruppo[0], m) >= 1]
        if not cand:
            continue
        sicuro = all(forza(gruppo[0], m) == 2 for m in cand)
        totale = _somma(s.importo for s in gruppo)
        # a) tutti gli addebiti del giorno = tutte le scadenze del gruppo
        if abs(_somma(-m.importo for m in cand) - totale) <= CENT:
            registra([s.chiave for s in gruppo], cand, "automatico" if sicuro else "proposto",
                     "riba_somma" if len(gruppo) > 1 else "riba")
            continue
        # b) abbinamenti 1:1 per importo
        resto = list(gruppo)
        for s in list(resto):
            pari = [m for m in cand if libero(m) and -m.importo == s.importo]
            if len(pari) == 1 and sum(1 for x in resto if x.importo == s.importo) == 1:
                registra([s.chiave], pari, "automatico" if forza(s, pari[0]) == 2 else "proposto", "riba")
                resto.remove(s)
        # c) un sottoinsieme degli addebiti = le scadenze rimaste
        if resto:
            tot_resto = _somma(s.importo for s in resto)
            liberi = [m for m in cand if libero(m)][:MAX_COMBINAZIONI]
            trovate = [c for k in range(1, len(liberi) + 1) for c in combinations(liberi, k)
                       if abs(_somma(-m.importo for m in c) - tot_resto) <= CENT]
            if len(trovate) == 1:
                registra([s.chiave for s in resto], list(trovate[0]), "proposto", "riba_somma",
                         "Somma degli addebiti Ri.Ba. del giorno uguale alle scadenze rimaste")

    # 2–3. Addebito diretto e bonifico, 1:1 per importo (modalità indicata o altra modalità)
    for canale in ("sdd", "bonifico"):
        for s in sorted((s for s in scadenze if s.chiave not in usate), key=lambda s: s.data_scadenza):
            principale = CANALE_DI_MODALITA.get(s.tipo_pagamento) == canale
            da, a = (-FINESTRA[canale], FINESTRA[canale]) if principale else FINESTRA_ALTRO
            cand = [m for m in per_canale[canale] if libero(m, [s.chiave]) and -m.importo == s.importo
                    and da <= (m.data - s.data_scadenza).days <= a]
            # nome diverso (es. 'La Fourchette' / 'GC RE THEFORK'): solo con la modalità indicata e un
            # solo pagamento di quell'importo nella finestra, sempre da confermare
            if not any(forza(s, m) >= 1 for m in cand):
                if principale and len(cand) == 1:
                    registra([s.chiave], cand, "proposto", canale,
                             "Nome in banca diverso da quello in Passcom: stesso importo e data compatibile")
                continue
            cand = [m for m in cand if forza(s, m) >= 1]
            cand.sort(key=lambda m: (-forza(s, m), _dist(m, s.data_scadenza)))
            m = cand[0]
            numero = numero_fattura(s.numero_documento)
            citato = bool(numero and numero in numeri_citati(m.testo))
            unico = len(cand) == 1 and sum(
                1 for x in scadenze if x.chiave not in usate and x.codice_fornitore == s.codice_fornitore
                and x.importo == s.importo) == 1
            sicuro = principale and unico and (forza(s, m) == 2 or citato)
            nota = "" if principale else f"Modalità diversa da quella in Passcom ({s.tipo_pagamento})"
            if not unico:
                nota = (nota + "; " if nota else "") + "Più scadenze o pagamenti con lo stesso importo"
            registra([s.chiave], [m], "automatico" if sicuro else "proposto",
                     canale if principale else "altra_modalita", nota)

    # 3b. Bonifico che paga più fatture citate nella causale
    for m in per_canale["bonifico"]:
        if not libero(m):
            continue
        citati = numeri_citati(m.testo)
        per_forn = {}
        for s in scadenze:
            if s.chiave in usate or numero_fattura(s.numero_documento) not in citati:
                continue
            if forza(s, m) >= 1 and -45 <= (m.data - s.data_scadenza).days <= 45:
                per_forn.setdefault(s.codice_fornitore, []).append(s)
        for gruppo in per_forn.values():
            if len(gruppo) > 1 and abs(_somma(s.importo for s in gruppo) + m.importo) <= CENT:
                sicuro = all(forza(s, m) == 2 for s in gruppo)
                registra([s.chiave for s in gruppo], [m], "automatico" if sicuro else "proposto", "bonifico_somma",
                         "Bonifico unico per più fatture citate nella causale")
                break

    # 4. Assegni: nessun nome in banca, solo importo e data → sempre da confermare, solo se univoco
    for s in sorted((s for s in scadenze if s.chiave not in usate), key=lambda s: s.data_scadenza):
        inizio = (s.data_documento or s.data_scadenza) - timedelta(days=5)
        cand = [m for m in per_canale["assegno"] if libero(m, [s.chiave]) and -m.importo == s.importo
                and inizio <= m.data <= s.data_scadenza + timedelta(days=FINESTRA_ALTRO[1])]
        stesso_importo = [x for x in scadenze if x.chiave not in usate and x.importo == s.importo]
        if len(cand) == 1 and len(stesso_importo) == 1:
            registra([s.chiave], cand, "proposto", "assegno",
                     "Assegno: la banca non riporta il beneficiario, verificare")

    return proposte
