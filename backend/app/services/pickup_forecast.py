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

import json
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.revenue import AppConfig, BudgetPrevisioneCorrettivo, DailyRevenue
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


CHIAVE_CONFIG = 'budget_previsione_parametri'
PARAMETRI_ALGORITMO = ('peso_moltiplicativo', 'finestra_settimane', 'tetto_coefficiente',
                       'peso_anni', 'tolleranza_giorni')


def valida_parametri(p: dict) -> dict:
    """Controlla e normalizza i parametri dell'algoritmo (solo le chiavi note). ValueError se fuori range."""
    out = {}
    for k in PARAMETRI_ALGORITMO:
        if k not in p:
            continue
        v = p[k]
        if k == 'peso_moltiplicativo':
            v = float(v)
            if not 0 <= v <= 1:
                raise ValueError("Il peso del coefficiente moltiplicativo va da 0 a 1")
        elif k == 'finestra_settimane':
            v = int(v)
            if not 0 <= v <= 6:
                raise ValueError("Le settimane vicine vanno da 0 a 6")
        elif k == 'tetto_coefficiente':
            if v in (None, ''):
                v = None
            else:
                v = float(v)
                if not 1 < v <= 50:
                    raise ValueError("Il tetto al coefficiente va da 1 a 50 (vuoto = nessun tetto)")
        elif k == 'peso_anni':
            v = [float(x) for x in v]
            if not 1 <= len(v) <= 5 or any(x < 0 for x in v) or not any(x > 0 for x in v):
                raise ValueError("Pesi anni: da 1 a 5 valori non negativi, almeno uno maggiore di zero")
        elif k == 'tolleranza_giorni':
            v = int(v)
            if not 0 <= v <= 14:
                raise ValueError("La tolleranza va da 0 a 14 giorni")
        out[k] = v
    return out


def leggi_parametri(db: Session) -> dict:
    """Parametri dell'algoritmo: default + valori salvati da Admin (app_config)."""
    p = {k: PARAMETRI_DEFAULT[k] for k in PARAMETRI_ALGORITMO}
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_CONFIG).first()
    if riga:
        try:
            p.update(valida_parametri(json.loads(riga.value)))
        except (ValueError, TypeError):
            pass  # config corrotta: restano i default
    return p


def leggi_correttivi(db: Session, hotel_code: str, season_year: int) -> dict:
    """{mese: %} per hotel/stagione; la chiave None è il valore di stagione (mese 0 in tabella)."""
    righe = db.query(BudgetPrevisioneCorrettivo).filter(
        BudgetPrevisioneCorrettivo.hotel_code == hotel_code,
        BudgetPrevisioneCorrettivo.season_year == season_year,
    ).all()
    return {(r.mese or None): float(r.correttivo_pct) for r in righe}


def parametri_hotel(db: Session, hotel_code: str, season_year: int) -> dict:
    return {**leggi_parametri(db), 'correttivi': leggi_correttivi(db, hotel_code, season_year)}


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
    otb_mese: dict = field(default_factory=lambda: defaultdict(lambda: defaultdict(_vuoto)))
    finale_mese: dict = field(default_factory=lambda: defaultdict(_vuoto))
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
        _somma(st.otb_mese[r.snapshot_date][r.data.month], r)
        prev = ultima_per_data.get(r.data)
        if prev is None or r.snapshot_date > prev.snapshot_date:
            ultima_per_data[r.data] = r
    for d, r in ultima_per_data.items():
        st = storico[d.year]
        ws = settimana_di(d)
        _somma(st.finale[ws], r)
        _somma(st.finale_mese[d.month], r)
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


def _anni_precedenti(season_year: int, p: dict) -> list[int]:
    return [season_year - i for i in range(1, len(p['peso_anni']) + 1)]


def _snapshot_corrente(corrente: Optional[StoricoAnno], oggi: date) -> Optional[date]:
    if not corrente:
        return None
    valide = [s for s in corrente.snapshot if s <= oggi]
    return valide[-1] if valide else None


def _prevedi(storico: dict, season_year: int, ws: date, snapshot: date, p: dict,
             correttivo: float = 0.0) -> Optional[tuple[dict, int]]:
    """Previsione della settimana ws con i dati noti alla snapshot indicata (anche passata, per il
    controllo a ritroso). (valori, n settimane di riferimento) oppure None se manca lo storico."""
    otb = storico[season_year].otb[snapshot][ws]
    anticipo = max((ws - snapshot).days, 0)
    stime = []
    for a, peso in zip(_anni_precedenti(season_year, p), p['peso_anni']):
        if a not in storico or not peso:
            continue
        s = _stima_anno(storico[a], ws - timedelta(days=364 * (season_year - a)), anticipo, otb, p)
        if s is not None:
            stime.append((peso, s))
    if not stime:
        return None
    tot_peso = sum(w for w, _ in stime)
    valori = {'rooms_available': otb['rooms_available']}
    for c in CAMPI_PREVISTI:
        prev = sum(w * s[c] for w, s in stime) / tot_peso
        valori[c] = max(otb[c] + (prev - otb[c]) * (1 + correttivo / 100), 0.0)
    if otb['rooms_available']:
        valori['rooms_sold'] = min(valori['rooms_sold'], otb['rooms_available'])
    valori['revenue_total'] = valori['revenue_rooms'] + valori['revenue_fnb'] + valori['revenue_extra']
    return valori, sum(s['_n_riferimento'] for _, s in stime)


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
    storico = carica_storico(db, hotel_code, [season_year] + _anni_precedenti(season_year, p))
    corrente = storico.get(season_year)
    snapshot = _snapshot_corrente(corrente, oggi)

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

        voce['anticipo_giorni'] = max((ws - snapshot).days, 0)
        in_corso = ws <= snapshot
        corr = correttivo_settimana(ws, p['correttivi'])
        stima = _prevedi(storico, season_year, ws, snapshot, p, corr)
        if stima is None:
            if in_corso:
                voce['tipo'] = 'otb'
                voce['valori'] = otb
            continue
        valori, n_rif = stima
        voce.update(
            tipo='in_corso' if in_corso else 'previsione',
            valori=valori,
            n_riferimento=n_rif,
            correttivo_pct=corr,
        )
    anni_storico = [a for a in _anni_precedenti(season_year, p) if a in storico]
    return {'snapshot': snapshot, 'anni_storico': anni_storico, 'settimane': risultato}


# ---------------------------------------------------------------------------
# Controllo dell'algoritmo (Admin): precisione a ritroso e ritmo vs anno precedente
# ---------------------------------------------------------------------------

ANTICIPI_CONTROLLO = (14, 28, 56)   # 2, 4, 8 settimane prima dell'arrivo
MIN_SETTIMANE_SUGGERIMENTO = 3


def _riepilogo_errori(righe: list[dict]) -> dict:
    """righe: {'otb', 'previsione', 'finale'} sul ricavo totale di una settimana."""
    n = len(righe)
    if not n:
        return {'n_settimane': 0, 'errore_medio_pct': None, 'scostamento_pct': None,
                'pickup_previsto': 0.0, 'pickup_reale': 0.0, 'suggerito_pct': None}
    fin = sum(r['finale'] for r in righe)
    prev = sum(r['previsione'] for r in righe)
    pk_prev = sum(r['previsione'] - r['otb'] for r in righe)
    pk_real = sum(r['finale'] - r['otb'] for r in righe)
    errori = [abs(r['previsione'] - r['finale']) / r['finale'] * 100 for r in righe if r['finale']]
    suggerito = None
    if n >= MIN_SETTIMANE_SUGGERIMENTO and pk_prev > 0:
        suggerito = max(-90.0, min(200.0, round((pk_real / pk_prev - 1) * 100)))
    return {
        'n_settimane': n,
        'errore_medio_pct': round(statistics.mean(errori), 1) if errori else None,
        # positivo = la previsione era più alta del finale (sovrastima)
        'scostamento_pct': round((prev - fin) / fin * 100, 1) if fin else None,
        'pickup_previsto': pk_prev,
        'pickup_reale': pk_real,
        'suggerito_pct': suggerito,
    }


def controllo_previsione(
    db: Session,
    hotel_code: str,
    season_year: int,
    oggi: Optional[date] = None,
    parametri: Optional[dict] = None,
) -> dict:
    """
    Precisione: per ogni settimana chiusa della stagione rifà la previsione (senza correttivo) alla
    snapshot di 2/4/8 settimane prima e la confronta col finale. Correttivo suggerito =
    Σ vendite reali / Σ vendite previste − 1 su tutte le distanze, solo con almeno
    MIN_SETTIMANE_SUGGERIMENTO settimane. Ritmo: OTB dei mesi alla snapshot corrente contro l'OTB
    dell'anno precedente alla stessa data (−364 giorni). Tutto ricalcolato dalle snapshot.
    """
    p = {**PARAMETRI_DEFAULT, **(parametri or {})}
    oggi = oggi or date.today()
    anni_prec = _anni_precedenti(season_year, p)
    storico = carica_storico(db, hotel_code, [season_year] + anni_prec)
    corrente = storico.get(season_year)
    snapshot = _snapshot_corrente(corrente, oggi)
    anni_storico = [a for a in anni_prec if a in storico]
    vuoto = {'snapshot': snapshot, 'anni_storico': anni_storico, 'settimane': [],
             'per_anticipo': [], 'complessivo': _riepilogo_errori([]), 'ritmo': []}
    if snapshot is None:
        return vuoto

    # --- precisione a ritroso
    per_anticipo = {a: [] for a in ANTICIPI_CONTROLLO}
    settimane = []
    for ws in sorted(corrente.finale):
        if corrente.ultima_data.get(ws, ws) >= snapshot:
            continue   # non ancora chiusa
        finale = corrente.finale[ws]['revenue_total']
        voce = {'week_start': ws.isoformat(), 'finale': finale, 'previsioni': []}
        for anticipo in ANTICIPI_CONTROLLO:
            s = _snapshot_vicina(corrente, ws - timedelta(days=anticipo), p['tolleranza_giorni'])
            if s is None or ws not in corrente.otb[s]:
                continue
            stima = _prevedi(storico, season_year, ws, s, p)
            if stima is None:
                continue
            riga = {'otb': corrente.otb[s][ws]['revenue_total'],
                    'previsione': stima[0]['revenue_total'], 'finale': finale}
            per_anticipo[anticipo].append(riga)
            voce['previsioni'].append({'anticipo_giorni': anticipo, 'snapshot': s.isoformat(),
                                       'otb': riga['otb'], 'previsione': riga['previsione']})
        if voce['previsioni']:
            settimane.append(voce)

    # --- ritmo: OTB per mese oggi vs anno precedente alla stessa data
    ritmo = []
    prec = storico.get(season_year - 1)
    s_prec = _snapshot_vicina(prec, snapshot - timedelta(days=364), p['tolleranza_giorni']) if prec else None
    for mese in sorted(corrente.otb_mese[snapshot]):
        oggi_m = corrente.otb_mese[snapshot][mese]['revenue_total']
        prec_m = prec.otb_mese[s_prec][mese]['revenue_total'] if s_prec else None
        fin_prec = prec.finale_mese[mese]['revenue_total'] if prec and mese in prec.finale_mese else None
        ritmo.append({
            'mese': mese,
            'otb': oggi_m,
            'otb_anno_prec': prec_m,
            'delta_pct': round((oggi_m - prec_m) / prec_m * 100, 1) if prec_m else None,
            'finale_anno_prec': fin_prec,
        })

    return {
        'snapshot': snapshot,
        'snapshot_anno_prec': s_prec,
        'anni_storico': anni_storico,
        'settimane': settimane,
        'per_anticipo': [{'anticipo_giorni': a, **_riepilogo_errori(r)} for a, r in per_anticipo.items()],
        'complessivo': _riepilogo_errori([r for rs in per_anticipo.values() for r in rs]),
        'ritmo': ritmo,
    }
