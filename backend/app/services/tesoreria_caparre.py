"""Tesoreria — caparre per mese di arrivo (Fase 4a). Solo calcoli, nessun accesso al DB.

Dalla causale dei bonifici da clienti si leggono la data di arrivo del soggiorno e la struttura. Una caparra è un
incasso arrivato in banca prima del giorno di arrivo (caparra, acconto o saldo anticipato: per la cassa sono uguali).
Formati visti sui bonifici 2025-2026: "DAL 22/08/2026 AL 29/08/2026" (anche "TURRIDAL 25/04", anni scritti male come
205/225/2052), "dal 13 06 26 al 20", "DAL 30082025", "dal 22 al 29 giugno", "23-26LUG2025", "4.7 18.7.26",
"PERIOD OF STAY 010826 - 080826", "VOM 25.05.", solo il mese ("caparra agosto 2025").
"""

import re
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

ZERO = Decimal(0)
MESI_STAGIONE = range(4, 11)            # un arrivo fuori da aprile-ottobre è quasi sempre una lettura sbagliata
ANTICIPO_MAX = timedelta(days=550)      # caparre fino a ~18 mesi prima
RITARDO_MAX = timedelta(days=60)        # saldi pagati fino a due mesi dopo l'arrivo

_MESI = r"(GENNAIO|GEN|FEBBRAIO|FEB|MARZO|MAR|APRILE|APR|MAGGIO|MAG|MAY|GIUGNO|GIU|JUNE|JUNI|JUN|LUGLIO|LUG|JULY|" \
        r"JULI|JUL|AGOSTO|AGO|AUGUST|AUG|SETTEMBRE|SETT|SET|SEPTEMBER|SEP|OTTOBRE|OTT|OCTOBER|OCT)(?![A-Z])"
_SEP = r"\s*[\/\.\-]\s*"
_DATA = rf"(?<![\d/.])(\d{{1,2}}){_SEP}(\d{{1,2}})(?:{_SEP}(\d{{1,4}}))?"
_DAL = r"(?:DAL|DA|DL|VOM|FROM|DATA)"
_FINE = r"(?:AL|A|AU|BIS|TO|-|ALL)"

# (nome della regola, espressione, gruppi giorno/mese/anno — il mese può essere un nome)
_REGOLE = [
    ("dal_al", rf"DAL\s*{_DATA}\s*{_FINE}\s*{_DATA}", (1, 2, (3, 6))),
    ("dal_al", r"DAL\s*(\d{1,2})\s(\d{1,2})\s(\d{4})", (1, 2, 3)),
    ("ggmmaaaa", rf"{_DAL}\s*(\d{{2}})(\d{{2}})(\d{{4}})\b", (1, 2, 3)),
    ("gg_gg_mese", rf"\b(\d{{1,2}})\s*(?:-|AL|/|E)\s*\d{{1,2}}\s*(?:DI\s+)?{_MESI}\s*'?(\d{{2,4}})?", (1, 2, 3)),
    ("dal_spazi", rf"{_DAL}\s*(\d{{1,2}})(?:{_SEP}|\s+)(\d{{1,2}})(?:\s*[\/\.\- ]\s*(\d{{1,4}}))?(?!\d)"
                  rf"(?=\s*(?:{_FINE}|\d|$))", (1, 2, 3)),
    ("data_data", rf"\b{_DATA}\s*{_FINE}\s*{_DATA}", (1, 2, (3, 6))),
    ("ggmmaa", r"(\d{2})(\d{2})(\d{2})\s*-\s*\d{6}", (1, 2, 3)),
    ("gg_mese", rf"\b(\d{{1,2}})\s*{_MESI}\s*'?(\d{{2,4}})?", (1, 2, 3)),
    ("dal_solo", rf"(?:DAL|ARRIVO|ARRIVAL|FROM|CHECK.?IN|PER IL|IL)\s*{_DATA}", (1, 2, 3)),
    ("solo_mese", rf"\b{_MESI}\s*'?(\d{{2,4}})?", (None, 1, 2)),
]
_REGOLE = [(n, re.compile(p), g) for n, p, g in _REGOLE]

_STRUTTURE = [
    ("CLB", re.compile(r"CLUB")),
    ("INT", re.compile(r"INTERN|INTERNAZ")),
    ("DPH", re.compile(r"DU\s*P\s*A\s*R\s*[CK]|DUPARC|\bDI PARC\b")),
]


def pulisci(descrizione: str) -> str:
    """Testo utile in maiuscolo: senza "Info aggiuntive" (dati della banca) e senza l'intestazione dei bonifici
    istantanei, che contiene la data e l'ora dell'ordine (non del soggiorno)."""
    t = (descrizione or "").split("Info aggiuntive")[0]
    t = re.sub(r"^Bonifico a vs favore \*(\d{4}-\d{2}-\d{2}\*)?", "", t)
    t = re.sub(r"INSTANT DEL \S+ ORE \S+ ID\. \S+ ORD ", "", t)
    t = re.sub(r"\bINST \d\d:\d\d ", "", t)
    return t.upper()


def _mese(valore: str) -> Optional[int]:
    if valore.isdigit():
        return int(valore)
    for i, k in enumerate(("GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC")):
        if valore.startswith(k):
            return i + 1
    return {"MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10}.get(valore[:3])


def _plausibile(d: date, pagamento: date) -> bool:
    return d.month in MESI_STAGIONE and pagamento - RITARDO_MAX <= d <= pagamento + ANTICIPO_MAX


def data_arrivo(giorno, mese, anno, pagamento: date) -> Optional[date]:
    """Data di arrivo plausibile: se l'anno manca o è scritto male (205, 225, 2052) si provano l'anno del pagamento e
    il successivo; se il mese cade fuori stagione si prova a scambiare giorno e mese (7/3/2026 = 3 luglio)."""
    g, m = int(giorno), _mese(str(mese))
    if m is None:
        return None
    anni = []
    if anno:
        a = int(anno)
        anni.append(a + 2000 if a < 100 else a)
    anni += [pagamento.year, pagamento.year + 1]
    scambi = ((g, m), (m, g)) if str(mese).isdigit() else ((g, m),)
    for gg, mm in scambi:
        for y in anni:
            try:
                d = date(y, mm, gg)
            except ValueError:
                continue
            if _plausibile(d, pagamento):
                return d
    return None


def leggi_arrivo(descrizione: str, pagamento: date) -> tuple:
    """(data di arrivo, nome della regola) o (None, None). Prima regola che dà una data plausibile."""
    testo = pulisci(descrizione)
    for nome, espressione, (ig, im, ia) in _REGOLE:
        for m in espressione.finditer(testo):
            anno = next((m[i] for i in ia if m[i]), None) if isinstance(ia, tuple) else m[ia]
            d = data_arrivo(m[ig] if ig else 1, m[im], anno, pagamento)
            if d:
                return d, nome
    return None, None


def leggi_struttura(descrizione: str) -> Optional[str]:
    """DPH, CLB o INT se la causale ne cita una sola."""
    testo = pulisci(descrizione)
    trovate = [codice for codice, espressione in _STRUTTURE if espressione.search(testo)]
    return trovate[0] if len(trovate) == 1 else None


def per_mese_arrivo(caparre: list, al_giorno: date, anno_arrivo: int) -> dict:
    """{mese: {struttura: importo}} delle caparre `(data_pagamento, arrivo, struttura, importo)` per arrivi
    nell'anno, incassate entro `al_giorno` e prima dell'arrivo. Struttura mancante = ''."""
    out = {}
    for pagato, arrivo, struttura, importo in caparre:
        if arrivo.year == anno_arrivo and pagato <= al_giorno and pagato < arrivo:
            mese = out.setdefault(arrivo.month, {})
            mese[struttura or ""] = mese.get(struttura or "", ZERO) + importo
    return out


def future_al(caparre: list, giorno: date) -> dict:
    """{(anno, mese) di arrivo: {struttura: importo}} delle caparre già in banca a `giorno` per soggiorni dopo."""
    out = {}
    for pagato, arrivo, struttura, importo in caparre:
        if pagato <= giorno < arrivo:
            mese = out.setdefault((arrivo.year, arrivo.month), {})
            mese[struttura or ""] = mese.get(struttura or "", ZERO) + importo
    return out
