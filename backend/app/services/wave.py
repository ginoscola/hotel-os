"""Calcoli puri dell'indice WAVE (Weekly Achieved Value vs Excellence). Nessun accesso DB.

WAVE di un periodo = fatturato del periodo ÷ riferimento del periodo. Il riferimento di un periodo per l'anno X è
il valore più alto, in euro, ottenuto in quel periodo negli anni **precedenti** a X (decisione 31/10/2026): un
record dell'anno X risulta sopra il 100%, il primo anno di una struttura non ha riferimento. Nessuna correzione
per i giorni di apertura; aprile e maggio uniti in "Inizio stagione"; mesi fuori da aprile–settembre ignorati.
La stagione dei migliori è la somma dei riferimenti dei singoli periodi (record di anni diversi).
"""

import calendar
from datetime import date, timedelta
from typing import Optional

# (codice, etichetta, mesi)
PERIODI = [
    ('inizio', 'Inizio stagione (apr+mag)', (4, 5)),
    ('giugno', 'Giugno', (6,)),
    ('luglio', 'Luglio', (7,)),
    ('agosto', 'Agosto', (8,)),
    ('settembre', 'Settembre', (9,)),
]
MESI_WAVE = tuple(m for _, _, mesi in PERIODI for m in mesi)
PERIODO_DI_MESE = {m: codice for codice, _, mesi in PERIODI for m in mesi}
# Periodi formati da un solo mese: gli unici con un riferimento settimanale
PERIODO_MESE_SINGOLO = {mesi[0]: codice for codice, _, mesi in PERIODI if len(mesi) == 1}


def periodo_di(mese: int) -> Optional[str]:
    return PERIODO_DI_MESE.get(mese)


def valori_per_periodo(mensili: dict) -> dict:
    """{mese: valore} → {periodo: somma}. Un periodo senza nessun mese presente non compare (nessun dato, non
    zero); i mesi fuori da aprile–settembre sono ignorati."""
    out = {}
    for mese, valore in mensili.items():
        codice = periodo_di(mese)
        if codice is None or valore is None:
            continue
        out[codice] = out.get(codice, 0.0) + float(valore)
    return out


def riferimenti(valori_anni: dict, anno: int) -> dict:
    """{anno: {periodo: valore}} → {periodo: {'riferimento', 'anno_record'}} per l'anno `anno`, usando solo gli
    anni precedenti. A parità di valore vale l'anno più vecchio (il record era già stato fatto). Periodi senza
    nessun anno precedente: riferimento None."""
    out = {}
    for codice, _, _ in PERIODI:
        migliore, anno_record = None, None
        for a in sorted(valori_anni):
            if a >= anno:
                continue
            v = valori_anni[a].get(codice)
            if v is not None and (migliore is None or v > migliore):
                migliore, anno_record = v, a
        out[codice] = {'riferimento': migliore, 'anno_record': anno_record}
    return out


def riferimento_stagione(rif: dict) -> Optional[float]:
    """Stagione dei migliori: somma dei riferimenti dei periodi che ne hanno uno."""
    valori = [r['riferimento'] for r in rif.values() if r['riferimento'] is not None]
    return sum(valori) if valori else None


def riferimento_settimana(rif: dict, week_start: date) -> Optional[float]:
    """Riferimento di una settimana (7 giorni da `week_start`): per ogni giorno di giugno–settembre la quota
    giornaliera del riferimento del suo mese (riferimento ÷ giorni del mese). I giorni di aprile e maggio non
    hanno riferimento settimanale (aperture a spot: conta solo il blocco "Inizio stagione"), quindi una
    settimana a cavallo tra maggio e giugno prende solo i giorni di giugno. None se nessun giorno ha riferimento.
    """
    totale, trovato = 0.0, False
    for i in range(7):
        giorno = week_start + timedelta(days=i)
        codice = PERIODO_MESE_SINGOLO.get(giorno.month)
        if codice is None:
            continue
        valore = (rif.get(codice) or {}).get('riferimento')
        if valore is None:
            continue
        totale += valore / calendar.monthrange(giorno.year, giorno.month)[1]
        trovato = True
    return totale if trovato else None


def wave(valore: Optional[float], riferimento: Optional[float]) -> Optional[float]:
    """Percentuale (100 = come il riferimento). None se manca uno dei due o il riferimento è zero."""
    if valore is None or not riferimento:
        return None
    return valore / riferimento * 100
