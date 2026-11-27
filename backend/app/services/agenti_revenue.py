"""Riepilogo settimanale Revenue per gli agenti AI (GET /agenti/revenue/settimanale, v4.39.0).

Sostituisce le ~26 chiamate della routine del bot revenue manager (dashboard gruppo e hotel per due
snapshot, budget, cancellazioni) con una risposta compatta, senza serie giornaliere, con pick-up e
scostamenti già calcolati. Nessun calcolo nuovo: si riusano le funzioni delle pagine
(`_carica_righe`, `aggrega_totali_righe`/`calcola_kpi`, `wave_hotel`, `_entry_to_budget_dict`,
`tasso_cancellazione`), quindi i numeri coincidono con quelli a schermo. KPI sempre sui totali.
"""

from collections import defaultdict
from datetime import date, timedelta
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.prenotazioni import PrenotazioneCancellataImport
from app.models.revenue import AppConfig, BudgetEntry, DailyRevenue, Hotel
from app.routers.budget import _entry_to_budget_dict
from app.routers.dashboard import _carica_righe, _raggruppa_per_hotel
from app.routers.prenotazioni import tasso_cancellazione
from app.services.kpi_calculator import aggrega_totali_righe, calcola_kpi
from app.services.wave_hotel import wave_hotel
from app.services.weekly_aggregator import settimana_di

CAMPI_RICAVI = ('revenue_rooms', 'revenue_fnb', 'revenue_extra', 'revenue_total')
SOGLIA_RETTIFICA_EURO = 0.01

NOTE_LETTURA = [
    "Settimana commerciale sabato→venerdì; KPI sempre calcolati sui totali, mai medie di KPI.",
    "Valori OTB (on the books) alla data della snapshot: le settimane future crescono con le prenotazioni.",
    "ADR PMS = ricavi camere ÷ camere vendute da Welcome: il file 'solo alloggio' toglie i pasti a un valore "
    "fisso che cambia ogni anno, quindi non è il prezzo camera e non va confrontato tra anni (usare ricavi totali).",
    "Mr Preno mette spiaggia e parcheggio sulla prima notte: gli extra giornalieri hanno picchi agli arrivi.",
    "WAVE = ricavi netti IVA (÷1,10) ÷ miglior risultato storico dello stesso periodo (anno_record, diverso per "
    "hotel e mese): non è il confronto con l'anno scorso. Le settimane future sono basse per costruzione.",
    "Pick-up = differenza tra le due snapshot; rettifiche_passato = settimane già concluse cambiate tra le due "
    "snapshot (cancellazioni, correzioni): sommate al pick-up delle future danno il pick-up di stagione.",
    "Welcome dà solo totali per giorno: un calo di camere con ricavi in aumento (o viceversa) non ha causale in HotelOS.",
]


def _r(v: Optional[float], d: int = 2) -> Optional[float]:
    return None if v is None else round(v, d)


def _kpi(righe) -> Optional[dict]:
    if not righe:
        return None
    t = aggrega_totali_righe(righe)
    k = calcola_kpi(t.rooms_sold, t.rooms_available, t.revenue_rooms, t.revenue_fnb, t.revenue_extra,
                    t.revenue_total)
    return {
        'rooms_sold': t.rooms_sold,
        'rooms_available': t.rooms_available,
        'camere_residue': t.rooms_available - t.rooms_sold,
        'occupancy': _r(k.occupancy),
        'adr': _r(k.adr),
        'revpar': _r(k.revpar),
        **{c: _r(getattr(t, c)) for c in CAMPI_RICAVI},
    }


def _diff(a, b, d=2):
    return None if a is None or b is None else round(a - b, d)


def _delta(corr: Optional[dict], prec: Optional[dict]) -> Optional[dict]:
    """Differenza corrente − precedente (pick-up se precedente = snapshot prima)."""
    if corr is None or prec is None:
        return None
    return {
        'camere': corr['rooms_sold'] - prec['rooms_sold'],
        **{c: _diff(corr[c], prec[c]) for c in CAMPI_RICAVI},
        'occupancy_pp': _diff(corr['occupancy'], prec['occupancy']),
        'adr': _diff(corr['adr'], prec['adr']),
        'revpar': _diff(corr['revpar'], prec['revpar']),
    }


def _per_settimana(righe) -> Dict[date, list]:
    out = defaultdict(list)
    for r in righe:
        out[settimana_di(r.data)].append(r)
    return out


def _config_int(db: Session, chiave: str, default: int) -> int:
    row = db.query(AppConfig).filter(AppConfig.key == chiave).first()
    try:
        return int(row.value) if row else default
    except (TypeError, ValueError):
        return default


def _snapshot_disponibili(db: Session) -> List[date]:
    """Snapshot Revenue reali (senza dati di test), dalla più recente."""
    righe = (db.query(DailyRevenue.snapshot_date).filter(DailyRevenue.is_test == False)  # noqa: E712
             .distinct().order_by(DailyRevenue.snapshot_date.desc()).all())
    return [s for (s,) in righe]


def _variazione_totali(righe_c, righe_p) -> dict:
    """Variazione di camere e ricavi tra due insiemi di righe, anche se uno dei due è vuoto."""
    return {
        'camere': sum(r.rooms_sold for r in righe_c) - sum(r.rooms_sold for r in righe_p),
        **{c: _r(sum(getattr(r, c) for r in righe_c) - sum(getattr(r, c) for r in righe_p)) for c in CAMPI_RICAVI},
    }


def _cambiata(v: dict) -> bool:
    return v['camere'] != 0 or abs(v['revenue_total']) >= SOGLIA_RETTIFICA_EURO


# ---------------------------------------------------------------------------
# WAVE
# ---------------------------------------------------------------------------

def _wave(db: Session, codice: str, righe_corr, righe_prec) -> Optional[dict]:
    w = wave_hotel(db, codice, righe_corr)
    if not w:
        return None
    wp = wave_hotel(db, codice, righe_prec) if righe_prec else None
    periodi_prec = {p['periodo']: p for p in (wp or {}).get('periodi', [])}
    return {
        'stagione': {**w['stagione'],
                     'delta_pp': _diff(w['stagione']['wave'], (wp or {}).get('stagione', {}).get('wave'), 1)},
        'periodi': [
            {'periodo': p['periodo'], 'etichetta': p['etichetta'], 'anno_record': p['anno_record'],
             'valore': p['valore'], 'riferimento': p['riferimento'], 'wave': p['wave'],
             'delta_pp': _diff(p['wave'], periodi_prec.get(p['periodo'], {}).get('wave'), 1)}
            for p in w['periodi'] if p['riferimento'] is not None
        ],
    }


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------

def _budget_per_hotel(db: Session, anno: int, versione: str) -> Dict[str, Dict[date, dict]]:
    """hotel_code → {week_start: budget}; solo hotel con un budget non vuoto (ricavi > 0)."""
    out: Dict[str, Dict[date, dict]] = {}
    for h in db.query(Hotel).all():
        entries = db.query(BudgetEntry).filter(
            BudgetEntry.hotel_id == h.id, BudgetEntry.season_year == anno, BudgetEntry.version == versione,
        ).all()
        settimane = {e.week_start: _entry_to_budget_dict(e) for e in entries}
        if sum((b.get('revenue_total') or 0) for b in settimane.values()) > 0:
            out[h.code] = settimane
    return out


def _vs_budget(otb: Optional[dict], budget: List[dict]) -> Optional[dict]:
    """OTB contro la somma dei budget delle stesse settimane (KPI budget ricalcolati sui totali)."""
    if otb is None or not budget:
        return None
    rs = sum(b.get('rooms_sold') or 0 for b in budget)
    ra = sum(b.get('rooms_available') or 0 for b in budget)
    tot = {c: sum(b.get(c) or 0 for b in budget) for c in CAMPI_RICAVI}
    occ = rs / ra * 100 if ra else None
    adr = tot['revenue_rooms'] / rs if rs else None
    return {
        'budget': {'rooms_sold': rs, 'occupancy': _r(occ), 'adr': _r(adr), **{c: _r(v) for c, v in tot.items()}},
        'scostamento': {
            'camere': otb['rooms_sold'] - rs,
            'revenue_total': _r(otb['revenue_total'] - tot['revenue_total']),
            'revenue_total_pct': _r((otb['revenue_total'] - tot['revenue_total']) / tot['revenue_total'] * 100, 1)
            if tot['revenue_total'] else None,
            'occupancy_pp': _diff(otb['occupancy'], _r(occ)),
            'adr': _diff(otb['adr'], _r(adr)),
        },
    }


# ---------------------------------------------------------------------------
# Cancellazioni
# ---------------------------------------------------------------------------

def _cancellazioni(db: Session, anno: int, da: date, a: date, hotel_codes: List[str]) -> dict:
    imp = db.query(PrenotazioneCancellataImport).filter(
        PrenotazioneCancellataImport.anno == anno, PrenotazioneCancellataImport.is_test == False,  # noqa: E712
    )
    ultimo = imp.with_entities(func.max(PrenotazioneCancellataImport.created_at)).scalar()
    tipi = sorted({t for (t,) in imp.with_entities(PrenotazioneCancellataImport.tipo).distinct()})
    base = {
        'storicizzato': False,
        'aggiornate_al': ultimo.date().isoformat() if ultimo else None,
        'arrivi_da': da.isoformat(), 'arrivi_a': a.isoformat(),
        'nota': "Stato all'ultimo import manuale da Welcome, non alla data della snapshot. Il tasso è "
                "affidabile solo se sono stati importati sia i file 'disdetta' sia 'non_disdetta'.",
        'tipi_importati': tipi,
    }
    if not ultimo:
        return {**base, 'disponibile': False}

    def _tasso(codice):
        t = tasso_cancellazione(anno=anno, hotel_code=codice, canali=None, arrivo_da=da, arrivo_a=a,
                                prenotazione_da=None, prenotazione_a=None, is_test=False, db=db)
        canali = sorted(t['per_canale'], key=lambda c: -(c['totale_cancellato_importo'] or 0))[:5]
        return {k: t[k] for k in ('totale_prenotato', 'totale_cancellato', 'tasso_pct', 'totale_prenotato_importo',
                                  'totale_cancellato_importo', 'tasso_importo_pct')} | {'canali_principali': canali}

    return {**base, 'disponibile': True, 'gruppo': _tasso('all'),
            'hotel': {c: _tasso(c) for c in hotel_codes}}


# ---------------------------------------------------------------------------
# Riepilogo
# ---------------------------------------------------------------------------

def riepilogo_settimanale(db: Session, snapshot: Optional[date] = None, confronto: Optional[date] = None,
                          versione_budget: str = 'v1') -> dict:
    """Vedi docstring del modulo. LookupError se mancano i dati (→ 404), ValueError se i parametri sono incoerenti (→ 400)."""
    disponibili = _snapshot_disponibili(db)
    if not disponibili:
        raise LookupError("Nessuna snapshot Revenue importata.")
    snap = snapshot or disponibili[0]
    if snap not in disponibili:
        raise LookupError(f"Snapshot {snap.isoformat()} non trovata.")
    if confronto is None:
        confronto = next((s for s in disponibili if s < snap), None)
    elif confronto not in disponibili:
        raise LookupError(f"Snapshot di confronto {confronto.isoformat()} non trovata.")
    elif confronto >= snap:
        raise ValueError("La snapshot di confronto deve essere precedente a quella principale.")

    avvisi: List[str] = []
    nomi = {h.code: h.name for h in db.query(Hotel).all()}
    corr = _raggruppa_per_hotel(_carica_righe(db, snapshot_date=snap))
    prec = _raggruppa_per_hotel(_carica_righe(db, snapshot_date=confronto)) if confronto else {}
    codici = sorted(corr)
    if confronto is None:
        avvisi.append("Nessuna snapshot precedente: pick-up non calcolabile.")
    mancanti = [c for c in codici if confronto and c not in prec]
    if mancanti:
        avvisi.append(f"Hotel senza dati nella snapshot di confronto ({', '.join(mancanti)}): pick-up non "
                      "calcolato per loro e gruppo escluso dal pick-up.")
    pickup_gruppo_ok = confronto is not None and not mancanti

    tutte_corr = [r for c in codici for r in corr[c]]
    tutte_prec = [r for c in codici for r in prec.get(c, [])]
    periodo_da, periodo_a = min(r.data for r in tutte_corr), max(r.data for r in tutte_corr)

    # Anno precedente: snapshot a ~364 giorni (stessa regola dei confronti della Dashboard)
    offset = _config_int(db, 'anno_confronto_giorni_offset', 364)
    toll = _config_int(db, 'anno_confronto_tolleranza_giorni', 30)
    obiettivo = snap - timedelta(days=offset)
    candidati = [s for s in disponibili if abs((s - obiettivo).days) <= toll and s.year == snap.year - 1]
    snap_ap = min(candidati, key=lambda s: abs((s - obiettivo).days)) if candidati else None
    ap = _raggruppa_per_hotel(_carica_righe(db, snapshot_date=snap_ap)) if snap_ap else {}

    budget = _budget_per_hotel(db, snap.year, versione_budget)

    # --- stagione: gruppo e hotel ---
    def _vs_budget_righe(per_hotel_righe: Dict[str, list], hotel_codes) -> Optional[dict]:
        con_budget = [c for c in hotel_codes if c in budget]
        if not con_budget:
            return None
        righe, voci = [], []
        for c in con_budget:
            settimane_b = budget[c]
            righe += [r for r in per_hotel_righe.get(c, []) if settimana_di(r.data) in settimane_b]
            voci += list(settimane_b.values())
        out = _vs_budget(_kpi(righe), voci)
        if out is not None and len(con_budget) < len(hotel_codes):
            out['hotel_inclusi'] = con_budget
        return out

    def _vs_ap(righe_c, righe_ap) -> Optional[dict]:
        k_ap = _kpi(righe_ap)
        return None if k_ap is None else {'anno_precedente': k_ap, 'differenza': _delta(_kpi(righe_c), k_ap)}

    kpi_gruppo = _kpi(tutte_corr)
    gruppo = {
        'kpi': kpi_gruppo,
        'pickup': _delta(kpi_gruppo, _kpi(tutte_prec)) if pickup_gruppo_ok else None,
        'vs_budget': _vs_budget_righe(corr, codici),
        'vs_anno_precedente': _vs_ap(tutte_corr, [r for c in codici for r in ap.get(c, [])]) if snap_ap else None,
    }

    hotel = []
    for c in codici:
        k = _kpi(corr[c])
        hotel.append({
            'hotel_code': c, 'hotel_name': nomi.get(c, c),
            'kpi': k,
            'pickup': _delta(k, _kpi(prec.get(c))) if c in prec else None,
            'vs_budget': _vs_budget_righe(corr, [c]),
            'vs_anno_precedente': _vs_ap(corr[c], ap.get(c, [])) if snap_ap else None,
            'wave': _wave(db, c, corr[c], prec.get(c)),
        })

    # --- settimane future e rettifiche sulle passate ---
    sett_corr = {c: _per_settimana(corr[c]) for c in codici}
    sett_prec = {c: _per_settimana(prec.get(c, [])) for c in codici}
    sett_ap = {c: _per_settimana(ap.get(c, [])) for c in codici}
    tutte_ws = sorted({ws for c in codici for ws in sett_corr[c]} | {ws for c in codici for ws in sett_prec[c]})

    settimane_future, rettifiche = [], []
    for ws in tutte_ws:
        we = ws + timedelta(days=6)
        ws_ap = ws - timedelta(days=offset)
        per_h = []
        for c in codici:
            rc, rp = sett_corr[c].get(ws, []), sett_prec[c].get(ws, [])
            kc = _kpi(rc)
            voce = {'hotel_code': c, 'kpi': kc, 'pickup': _delta(kc, _kpi(rp)) if c in prec and kc and rp else None}
            if we >= snap:
                b = budget.get(c, {}).get(ws)
                voce['vs_budget'] = _vs_budget(kc, [b]) if b and (b.get('revenue_total') or 0) > 0 else None
                voce['vs_anno_precedente'] = _vs_ap(rc, sett_ap[c].get(ws_ap, [])) if snap_ap else None
            per_h.append(voce)
        righe_c = [r for c in codici for r in sett_corr[c].get(ws, [])]
        righe_p = [r for c in codici for r in sett_prec[c].get(ws, [])]
        kg = _kpi(righe_c)
        base = {'week_start': ws.isoformat(), 'week_end': we.isoformat(),
                'label': f"{ws.strftime('%d/%m')}–{we.strftime('%d/%m')}"}
        if we >= snap:
            settimane_future.append({**base, 'in_corso': ws <= snap,
                                     'gruppo': {'kpi': kg, 'pickup': _delta(kg, _kpi(righe_p)) if pickup_gruppo_ok
                                                else None},
                                     'hotel': per_h})
        elif pickup_gruppo_ok:
            v = _variazione_totali(righe_c, righe_p)
            if _cambiata(v):
                per_h_v = [(c, _variazione_totali(sett_corr[c].get(ws, []), sett_prec[c].get(ws, []))) for c in codici]
                rettifiche.append({**base, 'variazione': v,
                                   'hotel': [{'hotel_code': c, 'variazione': vh} for c, vh in per_h_v if _cambiata(vh)]})

    motivo_budget = None if budget else (
        f"Nessun budget {snap.year} (versione {versione_budget}) caricato con ricavi: gli scostamenti vs budget sono null.")
    motivo_ap = None if snap_ap else (
        f"Nessuna snapshot dell'anno precedente vicina al {obiettivo.strftime('%d/%m/%Y')} (±{toll} giorni): "
        "confronto con l'anno precedente non disponibile.")

    return {
        'meta': {
            'snapshot': snap.isoformat(),
            'snapshot_confronto': confronto.isoformat() if confronto else None,
            'snapshot_anno_precedente': snap_ap.isoformat() if snap_ap else None,
            'periodo_da': periodo_da.isoformat(), 'periodo_a': periodo_a.isoformat(),
            'hotel': codici,
            'budget_disponibile': bool(budget), 'budget_versione': versione_budget,
            'budget_hotel': sorted(budget), 'motivo_budget': motivo_budget,
            'anno_precedente_disponibile': snap_ap is not None, 'motivo_anno_precedente': motivo_ap,
            'snapshot_disponibili_recenti': [s.isoformat() for s in disponibili[:8]],
        },
        'avvisi': avvisi,
        'gruppo': gruppo,
        'hotel': hotel,
        'settimane_future': settimane_future,
        'rettifiche_passato': rettifiche,
        'cancellazioni': _cancellazioni(db, snap.year, max(snap, periodo_da), periodo_a, codici),
        'note': NOTE_LETTURA,
    }
