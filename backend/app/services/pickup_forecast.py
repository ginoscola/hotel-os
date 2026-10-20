"""
Previsione di fine stagione per settimana commerciale con il metodo del pickup.

Per ogni settimana futura W, a D giorni dall'arrivo rispetto all'ultima snapshot:
- settimane di riferimento = la stessa settimana degli anni precedenti (W − 364gg·k) ± `finestra_settimane`;
- per ognuna: OTB alla snapshot con lo stesso anticipo D (la più vicina, entro `tolleranza_giorni`)
  e valore finale (snapshot più recente per data);
- coefficiente moltiplicativo = Σ finale / Σ OTB; pickup additivo = media(finale − OTB);
- previsione = peso_moltiplicativo · OTB · coefficiente + (1 − peso) · (OTB + pickup);
- più anni di storico: media pesata (`peso_anni`, il primo è l'anno precedente).
Il correttivo % agisce solo sul pickup previsto (previsione − OTB), mai sull'OTB già in mano.

Ogni campo (camere vendute, ricavi camere/F&B/extra) è previsto separatamente; revenue_total è
la somma dei tre ricavi, camere vendute non superano le disponibili.
Prova sulla stagione 2026 (settimane vicine dello stesso anno come proxy dell'anno precedente):
errore sul ricavo di stagione 1–2,5% già da marzo, contro il 40–70% dell'OTB puro.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.revenue import DailyRevenue
from app.services.weekly_aggregator import settimana_di

CAMPI_PREVISTI = ('rooms_sold', 'revenue_rooms', 'revenue_fnb', 'revenue_extra')
CAMPI = CAMPI_PREVISTI + ('rooms_available', 'revenue_total')

PARAMETRI_DEFAULT = {
    'peso_moltiplicativo': 0.5,   # 0 = solo additivo, 1 = solo moltiplicativo
    'finestra_settimane': 2,      # settimane vicine considerate (±)
    'tetto_coefficiente': None,   # es. 4.0; None = nessun tetto (un tetto peggiorava la prova 2026)
    'peso_anni': [2, 1],          # anno precedente, due anni prima, ...
    'tolleranza_giorni': 4,       # distanza massima tra anticipo cercato e snapshot storica
    'correttivi': {},             # {mese (int) | None (stagione): % sul pickup}
}


def _vuoto() -> dict:
    return {k: 0.0 for k in CAMPI}


def _somma(dst: dict, r: DailyRevenue) -> None:
    dst['rooms_sold'] += r.rooms_sold or 0
    dst['rooms_available'] += r.rooms_available or 0
    dst['revenue_rooms'] += float(r.revenue_rooms or 0)
    dst['revenue_fnb'] += float(r.revenue_fnb or 0)
    dst['revenue_extra'] += float(r.revenue_extra or 0)
    dst['revenue_total'] += float(r.revenue_total or 0)


@dataclass
class StoricoAnno:
    """Snapshot di un anno: OTB per (snapshot, settimana) e valore finale per settimana."""
    otb: dict = field(default_factory=lambda: defaultdict(lambda: defaultdict(_vuoto)))
    finale: dict = field(default_factory=lambda: defaultdict(_vuoto))
    ultima_data: dict = field(default_factory=dict)  # settimana → ultima data con righe
    snapshot: list = field(default_factory=list)      # snapshot ordinate


def carica_storico(db: Session, hotel_code: str, anni: list[int]) -> dict[int, StoricoAnno]:
    """Legge daily_revenue (no test) degli anni indicati, raggruppata per settimana commerciale."""
    if not anni:
        return {}
    righe = (
        db.query(DailyRevenue)
        .filter(
            DailyRevenue.hotel_code == hotel_code,
            DailyRevenue.is_test == False,  # noqa: E712
            DailyRevenue.data >= date(min(anni), 1, 1),
            DailyRevenue.data <= date(max(anni), 12, 31),
        )
        .all()
    )
    storico: dict[int, StoricoAnno] = {}
    ultima_per_data: dict[date, DailyRevenue] = {}
    for r in righe:
        if r.data.year not in anni:
            continue
        st = storico.setdefault(r.data.year, StoricoAnno())
        ws = settimana_di(r.data)
        _somma(st.otb[r.snapshot_date][ws], r)
        prev = ultima_per_data.get(r.data)
        if prev is None or r.snapshot_date > prev.snapshot_date:
            ultima_per_data[r.data] = r
    for d, r in ultima_per_data.items():
        st = storico[d.year]
        ws = settimana_di(d)
        _somma(st.finale[ws], r)
        if d > st.ultima_data.get(ws, date.min):
            st.ultima_data[ws] = d
    for st in storico.values():
        st.snapshot = sorted(st.otb)
    return storico


def _snapshot_vicina(st: StoricoAnno, target: date, tolleranza: int) -> Optional[date]:
    migliore = None
    for s in st.snapshot:
        dist = abs((s - target).days)
        if dist <= tolleranza and (migliore is None or dist < abs((migliore - target).days)):
            migliore = s
    return migliore


def _stima_anno(st: StoricoAnno, ws: date, anticipo: int, otb: dict, p: dict) -> Optional[dict]:
    """Previsione per campo usando un solo anno di storico; None se nessuna settimana di riferimento."""
    finestra = p['finestra_settimane']
    rif = []
    for k in range(-finestra, finestra + 1):
        w = ws + timedelta(days=7 * k)
        if w not in st.finale:
            continue
        s = _snapshot_vicina(st, w - timedelta(days=anticipo), p['tolleranza_giorni'])
        if s is None or w not in st.otb[s]:
            continue
        rif.append((st.otb[s][w], st.finale[w]))
    if not rif:
        return None
    stima = {}
    for c in CAMPI_PREVISTI:
        add = otb[c] + statistics.mean(f[c] - o[c] for o, f in rif)
        den = sum(o[c] for o, _ in rif)
        if den > 0:
            coeff = sum(f[c] for _, f in rif) / den
            if p['tetto_coefficiente']:
                coeff = min(coeff, p['tetto_coefficiente'])
            pm = p['peso_moltiplicativo']
            stima[c] = pm * otb[c] * coeff + (1 - pm) * add
        else:
            stima[c] = add
    stima['_n_riferimento'] = len(rif)
    return stima


def _mese_prevalente(ws: date) -> int:
    conta = defaultdict(int)
    for i in range(7):
        conta[(ws + timedelta(days=i)).month] += 1
    return max(conta, key=conta.get)


def correttivo_settimana(ws: date, correttivi: dict) -> float:
    """% di correttivo: quella del mese prevalente della settimana, altrimenti quella di stagione."""
    mese = _mese_prevalente(ws)
    if mese in correttivi and correttivi[mese] is not None:
        return float(correttivi[mese])
    return float(correttivi.get(None) or 0)


def previsione_stagione(
    db: Session,
    hotel_code: str,
    season_year: int,
    settimane: list[date],
    oggi: Optional[date] = None,
    parametri: Optional[dict] = None,
) -> dict:
    """
    Classifica ogni settimana e ne calcola consuntivo/OTB/previsione.

    Ritorna {'snapshot': data ultima snapshot ≤ oggi | None, 'anni_storico': [...],
             'settimane': {ws: {'tipo', 'otb', 'valori', 'anticipo_giorni', 'n_riferimento',
                                'correttivo_pct'}}}
    tipo: 'consuntivo' (tutti i giorni prima della snapshot), 'in_corso' / 'previsione' (valori =
    previsione), 'otb' (in corso senza storico: valori = OTB), 'senza_dati' (nessuna previsione
    possibile: il chiamante usa il budget).
    """
    p = {**PARAMETRI_DEFAULT, **(parametri or {})}
    oggi = oggi or date.today()
    anni_prec = [season_year - i for i in range(1, len(p['peso_anni']) + 1)]
    storico = carica_storico(db, hotel_code, [season_year] + anni_prec)
    corrente = storico.get(season_year)
    snapshot = None
    if corrente:
        valide = [s for s in corrente.snapshot if s <= oggi]
        snapshot = valide[-1] if valide else None

    anni_storico = [a for a in anni_prec if a in storico]
    pesi = {a: w for a, w in zip(anni_prec, p['peso_anni'])}

    risultato = {}
    for ws in settimane:
        voce = {'tipo': 'senza_dati', 'otb': None, 'valori': None,
                'anticipo_giorni': None, 'n_riferimento': 0, 'correttivo_pct': 0.0}
        risultato[ws] = voce
        if snapshot is None or ws not in corrente.otb[snapshot]:
            continue
        otb = dict(corrente.otb[snapshot][ws])
        voce['otb'] = otb
        if corrente.ultima_data.get(ws, ws + timedelta(days=6)) < snapshot:
            # come _actual_settimanale() in budget.py: snapshot più recente per ogni data
            voce['tipo'] = 'consuntivo'
            voce['valori'] = dict(corrente.finale[ws])
            continue

        anticipo = max((ws - snapshot).days, 0)
        voce['anticipo_giorni'] = anticipo
        in_corso = ws <= snapshot
        stime = []
        for a in anni_storico:
            s = _stima_anno(storico[a], ws - timedelta(days=364 * (season_year - a)), anticipo, otb, p)
            if s is not None:
                stime.append((pesi[a], s))
        if not stime:
            if in_corso:
                voce['tipo'] = 'otb'
                voce['valori'] = otb
            continue

        tot_peso = sum(w for w, _ in stime)
        corr = correttivo_settimana(ws, p['correttivi'])
        valori = {'rooms_available': otb['rooms_available']}
        for c in CAMPI_PREVISTI:
            prev = sum(w * s[c] for w, s in stime) / tot_peso
            valori[c] = otb[c] + (prev - otb[c]) * (1 + corr / 100)
        for c in CAMPI_PREVISTI:
            valori[c] = max(valori[c], 0.0)
        if otb['rooms_available']:
            valori['rooms_sold'] = min(valori['rooms_sold'], otb['rooms_available'])
        valori['revenue_total'] = valori['revenue_rooms'] + valori['revenue_fnb'] + valori['revenue_extra']
        voce.update(
            tipo='in_corso' if in_corso else 'previsione',
            valori=valori,
            n_riferimento=sum(s['_n_riferimento'] for _, s in stime),
            correttivo_pct=corr,
        )
    return {'snapshot': snapshot, 'anni_storico': anni_storico, 'settimane': risultato}
