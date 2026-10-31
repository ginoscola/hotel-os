"""WAVE di un hotel sulle righe di una snapshot Revenue (Fase 2: Dashboard Hotel ed export).

Numeratore = `revenue_total` dei dati Revenue ÷ 1,10 (IVA inclusa e senza tassa di soggiorno, verificato sul 2026),
notte per notte; riferimento = quello per data documento della Fase 1 (`riferimento_anno()`, migliore degli anni
precedenti a quello della snapshot). Solo i giorni da aprile a settembre; aprile e maggio solo come blocco "Inizio
stagione" (nessun riferimento settimanale); una settimana a cavallo di maggio e giugno conta solo i giorni di giugno.
Stagione = Σ incassi dei periodi che hanno un riferimento ÷ Σ riferimenti (mai la media dei WAVE). La snapshot
comprende anche il prenotato futuro: a stagione in corso il WAVE di stagione è "con quello che c'è in mano oggi".

Le settimane coprono **tutti** i giorni da giugno a settembre, anche senza dati (hotel chiuso = incasso zero:
nessuna correzione per i giorni di apertura), così la somma dei riferimenti settimanali è quella dei mesi e il
`progressivo` (Σ incassi ÷ Σ riferimenti fino alla settimana, Inizio stagione compreso) dell'ultima settimana
coincide con il WAVE di stagione. Serve al grafico: le barre settimanali "si compensano" a occhio, il progressivo no.
"""

from collections import Counter, defaultdict
from datetime import date, timedelta
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
        codice = PERIODO_MESE_SINGOLO.get(r.data.month)
        if codice and rif[codice]['riferimento'] is not None:
            per_settimana[settimana_di(r.data)] += netto

    periodi = []
    for codice, etichetta, mesi in PERIODI:
        valore = per_periodo.get(codice)
        periodi.append({'periodo': codice, 'etichetta': etichetta, 'mesi': list(mesi),
                        'anno_record': rif[codice]['anno_record'],
                        **_cella(valore, rif[codice]['riferimento'])})

    con_rif = [p for p in periodi if p['riferimento'] is not None]
    valore_stagione = sum(per_periodo.get(p['periodo'], 0.0) for p in con_rif) if con_rif else None
    # Tutte le settimane da quella del 1/6 a quella del 30/9 + quelle di aprile/maggio presenti nei dati
    tutte = {settimana_di(r.data) for r in righe_wave if r.data.year == anno}
    ws = settimana_di(date(anno, 6, 1))
    while ws <= date(anno, 9, 30):
        tutte.add(ws)
        ws += timedelta(days=7)
    inizio = next(p for p in periodi if p['periodo'] == 'inizio')
    cum_v = per_periodo.get('inizio', 0.0) if inizio['riferimento'] is not None else 0.0
    cum_r = inizio['riferimento'] or 0.0
    settimane = {}
    for ws in sorted(tutte):
        rif_sett = riferimento_settimana(rif, ws)
        valore = per_settimana.get(ws, 0.0 if rif_sett is not None else None)
        cella = _cella(valore, rif_sett)
        if rif_sett is not None:
            cum_v += valore
            cum_r += rif_sett
            cella['progressivo'] = None if wave(cum_v, cum_r) is None else round(wave(cum_v, cum_r), 1)
        else:
            cella['progressivo'] = None
        settimane[ws] = cella
    return {
        'anno': anno,
        'stagione': _cella(valore_stagione, riferimento_stagione(rif)),
        'periodi': periodi,
        'settimane': settimane,
    }
