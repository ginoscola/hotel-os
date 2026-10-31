"""WAVE di un hotel sulle righe di una snapshot Revenue (Fase 2: Dashboard Hotel ed export).

Numeratore = `revenue_total` dei dati Revenue ÷ 1,10 (IVA inclusa e senza tassa di soggiorno, verificato sul 2026),
notte per notte; riferimento = quello per data documento della Fase 1 (`riferimento_anno()`, migliore degli anni
precedenti a quello della snapshot). Solo i giorni da aprile a settembre; aprile e maggio solo come blocco "Inizio
stagione" (nessun riferimento settimanale); una settimana a cavallo di maggio e giugno conta solo i giorni di giugno.
Stagione = Σ incassi dei periodi che hanno un riferimento ÷ Σ riferimenti (mai la media dei WAVE). La snapshot
comprende anche il prenotato futuro: a stagione in corso il WAVE di stagione è "con quello che c'è in mano oggi".
"""

from collections import Counter, defaultdict
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.services.wave import (PERIODI, PERIODO_MESE_SINGOLO, periodo_di, riferimento_settimana,
                               riferimento_stagione, wave)
from app.services.wave_dati import IVA, riferimento_anno
from app.services.weekly_aggregator import settimana_di


def _cella(valore: Optional[float], riferimento: Optional[float]) -> dict:
    return {'valore': None if valore is None else round(valore, 2),
            'riferimento': None if riferimento is None else round(riferimento, 2),
            'wave': None if wave(valore, riferimento) is None else round(wave(valore, riferimento), 1)}


def wave_hotel(db: Session, hotel_code: str, righe, oggi: Optional[date] = None) -> Optional[dict]:
    """→ {'anno', 'stagione', 'periodi': [...], 'settimane': {week_start: cella}} oppure None senza righe in
    aprile–settembre. Ogni cella = {'valore' (netto), 'riferimento', 'wave' (%)}."""
    righe_wave = [r for r in righe if periodo_di(r.data.month)]
    if not righe_wave:
        return None
    anno = Counter(r.data.year for r in righe_wave).most_common(1)[0][0]
    struttura = next(s for s in riferimento_anno(db, anno, oggi)['strutture']
                     if s['struttura_code'] == hotel_code) if hotel_code in ('DPH', 'CLB', 'INT') else None
    rif = struttura['riferimento'] if struttura else {c: {'riferimento': None, 'anno_record': None}
                                                      for c, _, _ in PERIODI}

    per_periodo, per_settimana = defaultdict(float), defaultdict(float)
    for r in righe_wave:
        if r.data.year != anno:
            continue
        netto = r.revenue_total / IVA
        per_periodo[periodo_di(r.data.month)] += netto
        if r.data.month in PERIODO_MESE_SINGOLO:
            per_settimana[settimana_di(r.data)] += netto

    periodi = []
    for codice, etichetta, mesi in PERIODI:
        valore = per_periodo.get(codice)
        periodi.append({'periodo': codice, 'etichetta': etichetta, 'mesi': list(mesi),
                        'anno_record': rif[codice]['anno_record'],
                        **_cella(valore, rif[codice]['riferimento'])})

    con_rif = [p for p in periodi if p['riferimento'] is not None]
    valore_stagione = sum(per_periodo.get(p['periodo'], 0.0) for p in con_rif) if con_rif else None
    settimane = {}
    for ws in sorted({settimana_di(r.data) for r in righe_wave if r.data.year == anno}):
        settimane[ws] = _cella(per_settimana.get(ws), riferimento_settimana(rif, ws))
    return {
        'anno': anno,
        'stagione': _cella(valore_stagione, riferimento_stagione(rif)),
        'periodi': periodi,
        'settimane': settimane,
    }
