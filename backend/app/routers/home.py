"""Router FastAPI per la Home / Cruscotto gruppo — landing page dopo il login.

Aggrega dati già esposti dagli altri moduli (Revenue, Budget, Forecast, Produzione,
Corrispettivi, Dipendenti) in un'unica vista, riusando le funzioni già esistenti — molte
sono semplici funzioni Python decorate con @router.get (il decoratore restituisce la
funzione invariata), quindi chiamabili direttamente in Python: stesso pattern già in uso in
produzione_export.py (riusa get_trattamenti()/get_reparti()/get_gruppo()).

Due endpoint separati (non un solo endpoint con branching sul ruolo), così un utente
'viewer' riceve un 403 pulito sul blocco riservato invece di un payload silenziosamente
più povero:
  GET       /home/cruscotto        (utente attivo) → gauge operativi, vs budget, ritmo
                                     prenotazioni, mix canali/categorie, pagamenti, semaforo
                                     hotel, freschezza dati
  GET       /home/cruscotto/admin  (admin)         → costo del lavoro, Δ RT stagione, mix
                                     trattamento/tipo ospite, heatmap occupancy, margine di
                                     contribuzione parziale (usa dati Dipendenti/payroll)
  GET|PUT   /home/soglie                           → cutoff rosso/arancio/verde dei tachimetri
"""
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.corrispettivi import CorrispettiviDocumento, CorrispettiviImport
from app.models.home import DashboardKpiSoglia
from app.models.produzione import ProdImport
from app.models.revenue import DailyRevenue, Hotel, HotelSeason, PayrollImport
from app.routers.budget import _confronto_gruppo_dati
from app.routers.corrispettivi_report import report_pagamenti
from app.routers.corrispettivi_rt import RT_STRUTTURE, _range_stagione, _somma_rt_pms
from app.routers.corrispettivi_shared import STRUTTURE_HOTEL
from app.routers.dashboard import _carica_righe, _kpi_schema, _max_snapshot, _raggruppa_per_hotel
from app.routers.dipendenti import _costo_lavoro_per_struttura
from app.routers.forecast import _pace_punti
from app.routers.produzione_report import _categorie_attive, _per_categoria, report_canali, report_tipo_ospite, report_trattamenti
from app.routers.produzione_shared import query_report
from app.utils.locale_it import MESI_IT

router = APIRouter(prefix="/home", tags=["home"])


# ---------------------------------------------------------------------------
# Helper — perimetro hotel / stagione
# ---------------------------------------------------------------------------

def _hotel_codes(hotel_code: Optional[str]) -> list[str]:
    """'GRUPPO' (o assente) → tutti gli hotel; codice singolo → solo quello, validato."""
    if not hotel_code or hotel_code.upper() == 'GRUPPO':
        return list(STRUTTURE_HOTEL)
    hc = hotel_code.upper()
    if hc not in STRUTTURE_HOTEL:
        raise HTTPException(400, f"hotel_code non valido: usa GRUPPO oppure {STRUTTURE_HOTEL}")
    return [hc]


def _stagione_range(hotel_codes: list[str], anno: int, db: Session) -> Optional[dict]:
    """Range di stagione per il perimetro richiesto: per gruppo/RT condivisa (es. DPH+CLB con
    aperture sfasate) usa l'apertura più anticipata e la chiusura più tardiva — stesso criterio
    di _range_stagione in corrispettivi_rt.py."""
    stagioni = (
        db.query(HotelSeason)
        .join(Hotel, Hotel.id == HotelSeason.hotel_id)
        .filter(Hotel.code.in_(hotel_codes), HotelSeason.season_year == anno)
        .all()
    )
    if not stagioni:
        return None
    apertura = min(s.open_date for s in stagioni)
    chiusura = max(s.close_date for s in stagioni)
    oggi = date.today()
    giorni_totali = (chiusura - apertura).days + 1
    giorni_trascorsi = max(0, min((oggi - apertura).days + 1, giorni_totali))
    return {
        'open_date': apertura,
        'close_date': chiusura,
        'giorni_totali': giorni_totali,
        'giorni_trascorsi': giorni_trascorsi,
        'perc_trascorsa': round(giorni_trascorsi / giorni_totali * 100, 1) if giorni_totali else None,
        'giorni_alla_chiusura': max(0, (chiusura - oggi).days),
    }


def _r(v: Optional[float], d: int = 2) -> Optional[float]:
    return round(v, d) if v is not None else None


# ---------------------------------------------------------------------------
# Helper — soglie tachimetri
# ---------------------------------------------------------------------------

def _soglie_map(db: Session, hotel_code: Optional[str]) -> dict[str, DashboardKpiSoglia]:
    """kpi_code → soglia applicabile: un override per hotel_code (se esiste) vince sempre
    sulla soglia di default (hotel_code NULL)."""
    rows = db.query(DashboardKpiSoglia).filter(DashboardKpiSoglia.attivo.is_(True)).all()
    per_kpi: dict[str, DashboardKpiSoglia] = {}
    for r in rows:
        if r.hotel_code is None:
            per_kpi.setdefault(r.kpi_code, r)
        elif r.hotel_code == hotel_code:
            per_kpi[r.kpi_code] = r
    return per_kpi


def _gauge(kpi_code: str, valore: Optional[float], soglie: dict, **extra) -> dict:
    """Valuta `valore` contro la soglia di kpi_code e restituisce {valore, zona, soglia, **extra}.
    zona/soglia None se non c'è una soglia configurata per questo kpi o il valore è indisponibile —
    il frontend disegna comunque il numero, senza colorare il tachimetro."""
    row = soglie.get(kpi_code)
    if row is None or valore is None:
        return {'valore': valore, 'zona': None, 'soglia': None, **extra}
    rossa = float(row.soglia_rossa)
    arancione = float(row.soglia_arancione)
    target = float(row.target) if row.target is not None else None
    if row.direzione == 'alto_meglio':
        zona = 'rosso' if valore < rossa else ('arancio' if valore < arancione else 'verde')
    elif row.direzione == 'basso_meglio':
        zona = 'rosso' if valore > rossa else ('arancio' if valore > arancione else 'verde')
    else:  # 'target' — bidirezionale, scarto assoluto dal target
        scarto = abs(valore - (target or 0))
        zona = 'verde' if scarto <= arancione else ('arancio' if scarto <= rossa else 'rosso')
    return {
        'valore': valore, 'zona': zona,
        'soglia': {
            'direzione': row.direzione, 'unita': row.unita, 'target': target,
            'soglia_rossa': rossa, 'soglia_arancione': arancione,
        },
        **extra,
    }


# ---------------------------------------------------------------------------
# Helper — revenue / ritmo prenotazioni (daily_revenue)
# ---------------------------------------------------------------------------

def _otb_stagione_per_snapshot(hotel_codes: list[str], db: Session) -> list[dict]:
    """OTB cumulato (somma revenue_total su tutte le date caricate) per ogni snapshot_date —
    serie storica per il pickup a N giorni."""
    rows = db.execute(
        select(DailyRevenue.snapshot_date, func.sum(DailyRevenue.revenue_total))
        .where(
            DailyRevenue.hotel_code.in_(hotel_codes),
            DailyRevenue.is_test.is_(False),
            DailyRevenue.snapshot_date.isnot(None),
        )
        .group_by(DailyRevenue.snapshot_date)
        .order_by(DailyRevenue.snapshot_date)
    ).all()
    return [{'snapshot_date': r[0], 'otb_revenue': round(float(r[1] or 0), 2)} for r in rows]


def _pickup(serie: list[dict], giorni: int) -> Optional[float]:
    if len(serie) < 2:
        return None
    ultimo = serie[-1]
    target = ultimo['snapshot_date'] - timedelta(days=giorni)
    precedente = None
    for p in serie:
        if p['snapshot_date'] <= target:
            precedente = p
    if precedente is None:
        return None
    return round(ultimo['otb_revenue'] - precedente['otb_revenue'], 2)


def _pace_gruppo_punti(hotel_codes: list[str], anno: int, mese: int, db: Session) -> list[dict]:
    """Somma _pace_punti (forecast.py) sugli hotel del perimetro, per snapshot_date."""
    somma: dict[str, float] = defaultdict(float)
    for hc in hotel_codes:
        for p in _pace_punti(db, hc, anno, mese):
            somma[p.snapshot_date] += p.otb_revenue
    return [{'snapshot_date': sd, 'otb_revenue': round(v, 2)} for sd, v in sorted(somma.items())]


def _pace_anno_precedente(hotel_codes: list[str], anno: int, db: Session) -> Optional[dict]:
    """Confronto OTB oggi vs OTB alla stessa distanza (in giorni) dall'apertura stagione,
    l'anno precedente. None se la stagione anno-1 non è configurata o non ha dati caricati —
    oggi (stagione 2026) non ci sono ancora snapshot 2025 in daily_revenue."""
    stagione_corr = _stagione_range(hotel_codes, anno, db)
    stagione_prec = _stagione_range(hotel_codes, anno - 1, db)
    if stagione_corr is None or stagione_prec is None:
        return None
    ha_dati = db.query(DailyRevenue.id).filter(
        DailyRevenue.hotel_code.in_(hotel_codes),
        DailyRevenue.data >= stagione_prec['open_date'],
        DailyRevenue.data <= stagione_prec['close_date'],
    ).first()
    if ha_dati is None:
        return None
    lead = (date.today() - stagione_corr['open_date']).days
    target = stagione_prec['open_date'] + timedelta(days=lead)
    snap_prec = db.execute(
        select(func.max(DailyRevenue.snapshot_date))
        .where(DailyRevenue.hotel_code.in_(hotel_codes), DailyRevenue.snapshot_date <= target)
    ).scalar()
    if snap_prec is None:
        return None
    righe_prec = [
        r for r in _carica_righe(db, snapshot_date=snap_prec)
        if r.hotel_code in hotel_codes and stagione_prec['open_date'] <= r.data <= stagione_prec['close_date']
    ]
    return {
        'anno': anno - 1,
        'snapshot_equivalente': snap_prec.isoformat(),
        'otb_revenue': round(sum(r.revenue_total for r in righe_prec), 2),
    }


def _aggrega_vs_budget(confronto_sel: list[dict]) -> Optional[dict]:
    """Aggrega su più hotel il confronto actual/budget già calcolato da _confronto_gruppo_dati
    (budget.py) — Σ totali, mai media dei KPI dei singoli hotel."""
    if not confronto_sel:
        return None
    tot_b = {'revenue_total': 0.0, 'rooms_sold': 0, 'rooms_available': 0, 'revenue_rooms': 0.0}
    tot_a = dict(tot_b)
    for c in confronto_sel:
        for k in tot_b:
            tot_b[k] += c['budget'].get(k) or 0
            tot_a[k] += c['actual'].get(k) or 0

    def pct(a, b):
        """% di realizzo rispetto al budget (100 = perfettamente in linea)."""
        return round(a / b * 100, 1) if b else None

    adr_a = tot_a['revenue_rooms'] / tot_a['rooms_sold'] if tot_a['rooms_sold'] else None
    adr_b = tot_b['revenue_rooms'] / tot_b['rooms_sold'] if tot_b['rooms_sold'] else None
    revpar_a = tot_a['revenue_rooms'] / tot_a['rooms_available'] if tot_a['rooms_available'] else None
    revpar_b = tot_b['revenue_rooms'] / tot_b['rooms_available'] if tot_b['rooms_available'] else None
    return {
        'revenue_total': {'actual': _r(tot_a['revenue_total']), 'budget': _r(tot_b['revenue_total']),
                           'pct': pct(tot_a['revenue_total'], tot_b['revenue_total'])},
        'adr': {'actual': _r(adr_a), 'budget': _r(adr_b), 'pct': pct(adr_a, adr_b) if adr_a is not None else None},
        'revpar': {'actual': _r(revpar_a), 'budget': _r(revpar_b),
                   'pct': pct(revpar_a, revpar_b) if revpar_a is not None else None},
    }


def _occupancy_per_mese(righe: list) -> list[dict]:
    """Occupancy per mese solare, solo i mesi con almeno una camera venduta ('in cui c'è
    stata gente') — un mese aperto ma senza vendite (es. inizio/fine stagione) non compare."""
    per_mese: dict[int, dict] = {}
    for r in righe:
        acc = per_mese.setdefault(r.data.month, {'rooms_sold': 0, 'rooms_available': 0})
        acc['rooms_sold'] += r.rooms_sold
        acc['rooms_available'] += r.rooms_available
    out = []
    for m in sorted(per_mese):
        acc = per_mese[m]
        if not acc['rooms_sold']:
            continue
        occ = round(acc['rooms_sold'] / acc['rooms_available'] * 100, 1) if acc['rooms_available'] else None
        out.append({
            'mese': m, 'mese_label': MESI_IT[m - 1],
            'rooms_sold': acc['rooms_sold'], 'rooms_available': acc['rooms_available'],
            'occupancy_valore': occ,
        })
    return out


def _semaforo_hotel(per_hotel_righe: dict, confronto: list[dict], db: Session) -> list[dict]:
    confronto_by_hc = {c['hotel_code']: c for c in confronto}
    out = []
    for hc in STRUTTURE_HOTEL:
        righe = per_hotel_righe.get(hc, [])
        kpi = _kpi_schema(righe) if righe else None
        c = confronto_by_hc.get(hc)
        snap_hc = _max_snapshot(db, hotel_code=hc)
        out.append({
            'hotel_code': hc,
            'occupancy': kpi.occupancy if kpi else None,
            'scostamento_budget_pct': c['scostamento_pct'] if c else None,
            'ultimo_snapshot': snap_hc.isoformat() if snap_hc else None,
        })
    return out


# ---------------------------------------------------------------------------
# Helper — cassa / pagamenti (corrispettivi)
# ---------------------------------------------------------------------------

def _perc_contante(pagamenti: dict) -> Optional[float]:
    esclusi = {'Caparra', 'Sospeso', 'MMS / BON (manuale)'}
    totale_anno = pagamenti.get('totale_anno') or {}
    totale = sum(v for k, v in totale_anno.items() if k not in esclusi)
    contante = totale_anno.get('Contante', 0.0)
    return round(contante / totale * 100, 1) if totale else None


def _tassa_soggiorno_incassata(stagione: dict, db: Session) -> float:
    """Stima: somma la colonna tassa_soggiorno (esatta solo su formato esteso Welcome;
    NULL sul formato base) sui documenti non annullati della stagione."""
    tot = db.query(func.sum(func.coalesce(CorrispettiviDocumento.tassa_soggiorno, 0))).filter(
        CorrispettiviDocumento.data_documento >= stagione['open_date'],
        CorrispettiviDocumento.data_documento <= stagione['close_date'],
        CorrispettiviDocumento.annullato.is_(False),
        CorrispettiviDocumento.is_test.is_(False),
    ).scalar()
    return round(float(tot or 0), 2)


def _commissioni_ota(stagione: dict, hc_sel: str, oggi: date, db: Session) -> dict:
    """Placeholder: prezzo_lordo == prezzo_netto su tutte le righe finché Welcome non
    valorizza la colonna Commissione per canale (vedi nota in produzione.py)."""
    struttura_filtro = None if hc_sel == 'GRUPPO' else hc_sel
    righe = query_report(db, stagione['open_date'], min(stagione['close_date'], oggi),
                          struttura_filtro, None, None, None, False).all()
    commissione = sum(float(r.prezzo_lordo) - float(r.prezzo_netto) for r in righe)
    lordo_ota = sum(float(r.prezzo_lordo) for r in righe if (r.canale or '').strip().lower() not in ('', 'diretto', 'direct'))
    return {
        'commissione_stimata': round(commissione, 2),
        'lordo_ota': round(lordo_ota, 2),
        'nota': "La colonna Commissione risulta oggi sempre 0 nell'export Welcome PMS: placeholder pronto per quando verrà valorizzata.",
    }


def _freschezza(db: Session) -> dict:
    ultimo_snapshot = {}
    for hc in STRUTTURE_HOTEL:
        snap = _max_snapshot(db, hotel_code=hc)
        ultimo_snapshot[hc] = snap.isoformat() if snap else None
    ultimo_prod = db.query(ProdImport).filter(ProdImport.is_test.is_(False)).order_by(ProdImport.created_at.desc()).first()
    ultimo_corr = db.query(CorrispettiviImport).filter(CorrispettiviImport.is_test.is_(False)).order_by(CorrispettiviImport.created_at.desc()).first()
    ultimo_payroll = db.query(PayrollImport).filter(PayrollImport.is_test.is_(False)).order_by(
        PayrollImport.anno.desc(), PayrollImport.mese.desc()
    ).first()
    return {
        'ultimo_snapshot_per_hotel': ultimo_snapshot,
        'ultimo_import_produzione': ultimo_prod.created_at.isoformat() if ultimo_prod else None,
        'ultimo_import_corrispettivi': ultimo_corr.created_at.isoformat() if ultimo_corr else None,
        'ultimo_mese_payroll': f'{ultimo_payroll.mese:02d}/{ultimo_payroll.anno}' if ultimo_payroll else None,
    }


# ---------------------------------------------------------------------------
# GET /home/cruscotto — visibile a ogni utente attivo
# ---------------------------------------------------------------------------

@router.get("/cruscotto", dependencies=[Depends(richiedi_utente_attivo)])
def cruscotto(
    anno: Optional[int] = Query(None),
    hotel_code: str = Query('GRUPPO'),
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    hotel_codes = _hotel_codes(hotel_code)
    hc_sel = hotel_code.upper() if hotel_code else 'GRUPPO'
    anno = anno or date.today().year
    oggi = date.today()
    soglie = _soglie_map(db, None if hc_sel == 'GRUPPO' else hc_sel)

    stagione = _stagione_range(hotel_codes, anno, db)

    snap = _max_snapshot(db)
    per_hotel_righe: dict = {}
    righe_sel: list = []
    if snap is not None:
        per_hotel_righe = _raggruppa_per_hotel(_carica_righe(db, snapshot_date=snap))
        righe_sel = [r for hc in hotel_codes for r in per_hotel_righe.get(hc, [])]
    kpi = _kpi_schema(righe_sel) if righe_sel else None

    otb_serie = _otb_stagione_per_snapshot(hotel_codes, db)
    pickup_7gg = _pickup(otb_serie, giorni=7)

    confronto = _confronto_gruppo_dati(anno, version, db)
    vs_budget = _aggrega_vs_budget([c for c in confronto if c['hotel_code'] in hotel_codes])

    pace_punti = _pace_gruppo_punti(hotel_codes, anno, oggi.month, db)
    pace_anno_precedente = _pace_anno_precedente(hotel_codes, anno, db)

    mix_canali = None
    mix_categorie = None
    commissioni_ota = None
    if stagione:
        fino_a = min(stagione['close_date'], oggi)
        struttura_filtro = None if hc_sel == 'GRUPPO' else hc_sel
        mix_canali = report_canali(data_da=stagione['open_date'], data_a=fino_a,
                                    struttura_code=struttura_filtro, is_test=False, db=db)['per_canale']
        righe_prod = query_report(db, stagione['open_date'], fino_a, struttura_filtro, None, None, None, False).all()
        categorie = _categorie_attive(db)
        agg_cat = _per_categoria(righe_prod, categorie)
        mix_categorie = [
            {'code': c.code, 'name': c.name, 'colore': c.colore, **agg_cat.get(c.code, {})}
            for c in categorie
        ]
        commissioni_ota = _commissioni_ota(stagione, hc_sel, oggi, db)

    pagamenti = report_pagamenti(anno=anno, is_test=False, db=db, _=None)
    perc_contante = _perc_contante(pagamenti)
    tassa_soggiorno = _tassa_soggiorno_incassata(stagione, db) if stagione else None

    return {
        'anno': anno,
        'hotel_code': hc_sel,
        'stagione': stagione,
        'snapshot_date': snap.isoformat() if snap else None,
        'kpi_operativi': None if kpi is None else {
            'rooms_sold': kpi.rooms_sold, 'rooms_available': kpi.rooms_available,
            'revenue_total': kpi.revenue_total,
            'occupancy': _gauge('occupancy', kpi.occupancy, soglie),
            'adr': kpi.adr, 'revpar': kpi.revpar, 'trevpar': kpi.trevpar, 'rmc': kpi.rmc,
            'inc_rooms': kpi.inc_rooms, 'inc_fnb': kpi.inc_fnb, 'inc_extra': kpi.inc_extra,
            'occupancy_per_mese': [
                {
                    'mese': m['mese'], 'mese_label': m['mese_label'],
                    'rooms_sold': m['rooms_sold'], 'rooms_available': m['rooms_available'],
                    'occupancy': _gauge('occupancy', m['occupancy_valore'], soglie),
                }
                for m in _occupancy_per_mese(righe_sel)
            ],
        },
        'pickup_7gg': _gauge('pickup_7gg', pickup_7gg, soglie),
        'vs_budget': None if vs_budget is None else {
            'revenue_total': _gauge('revenue_stagione_vs_budget', vs_budget['revenue_total']['pct'], soglie,
                                     actual=vs_budget['revenue_total']['actual'], budget=vs_budget['revenue_total']['budget']),
            'adr': _gauge('adr_vs_budget', vs_budget['adr']['pct'], soglie,
                          actual=vs_budget['adr']['actual'], budget=vs_budget['adr']['budget']),
            'revpar': _gauge('revpar_vs_budget', vs_budget['revpar']['pct'], soglie,
                             actual=vs_budget['revpar']['actual'], budget=vs_budget['revpar']['budget']),
        },
        'pace': {'mese': oggi.month, 'anno': anno, 'punti': pace_punti},
        'pace_anno_precedente': pace_anno_precedente,
        'mix_canali': mix_canali,
        'mix_categorie': mix_categorie,
        'commissioni_ota': commissioni_ota,
        'pagamenti': {
            'perc_contante': _gauge('perc_contante', perc_contante, soglie),
            'tassa_soggiorno_incassata_stagione': tassa_soggiorno,
        },
        'semaforo_hotel': _semaforo_hotel(per_hotel_righe, confronto, db),
        'freschezza': _freschezza(db),
    }


# ---------------------------------------------------------------------------
# GET /home/cruscotto/admin — solo admin (costo del lavoro e derivati)
# ---------------------------------------------------------------------------

@router.get("/cruscotto/admin", dependencies=[Depends(richiedi_admin)])
def cruscotto_admin(
    anno: Optional[int] = Query(None),
    hotel_code: str = Query('GRUPPO'),
    db: Session = Depends(get_db),
):
    hotel_codes = _hotel_codes(hotel_code)
    hc_sel = hotel_code.upper() if hotel_code else 'GRUPPO'
    anno = anno or date.today().year
    oggi = date.today()
    soglie = _soglie_map(db, None if hc_sel == 'GRUPPO' else hc_sel)

    stagione = _stagione_range(hotel_codes, anno, db)
    if stagione is None:
        raise HTTPException(404, f"Nessuna stagione {anno} configurata per {hc_sel}")
    fino_a = min(stagione['close_date'], oggi)

    # ── Costo del lavoro: solo mesi CHIUSI della stagione (mese in corso escluso, sempre
    # parziale) e solo quelli per cui esiste davvero un import payroll — vedi nota CLAUDE.md
    # sulla granularità mensile del modulo Dipendenti.
    mesi_stagione = list(range(stagione['open_date'].month, stagione['close_date'].month + 1))
    mesi_chiusi = [m for m in mesi_stagione if anno < oggi.year or m < oggi.month]
    imports_payroll = db.query(PayrollImport).filter(
        PayrollImport.anno == anno, PayrollImport.mese.in_(mesi_chiusi), PayrollImport.is_test.is_(False),
    ).all()
    import_ids = [i.id for i in imports_payroll]
    mesi_coperti = sorted({i.mese for i in imports_payroll})
    costo_per_struttura = _costo_lavoro_per_struttura(import_ids, db)

    snap = _max_snapshot(db)
    revenue_periodo = 0.0
    if snap is not None and mesi_coperti:
        per_hotel = _raggruppa_per_hotel(_carica_righe(db, snapshot_date=snap))
        righe_periodo = [r for hc in hotel_codes for r in per_hotel.get(hc, []) if r.data.month in mesi_coperti]
        revenue_periodo = round(sum(r.revenue_total for r in righe_periodo), 2)

    costo_totale = round(sum(v['costo_aziendale'] for k, v in costo_per_struttura.items() if k in hotel_codes), 2)
    labor_ratio = round(costo_totale / revenue_periodo * 100, 1) if revenue_periodo else None
    margine = round(revenue_periodo - costo_totale, 2) if mesi_coperti else None

    # ── Δ RT stagione (RT1 = DPH+CLB, RT2 = INT)
    rt_da_mostrare = [rt for rt, strutture in RT_STRUTTURE.items() if any(s in hotel_codes for s in strutture)]
    delta_rt = {}
    for rt_code in rt_da_mostrare:
        rng = _range_stagione(RT_STRUTTURE[rt_code], anno, db)
        if rng is None:
            delta_rt[rt_code] = None
            continue
        somma = _somma_rt_pms(rt_code, rng[0], rng[1], db)
        delta_rt[rt_code] = _gauge('delta_rt_pms', somma['somma_differenza'], soglie, **somma)

    # ── Mix trattamento / tipo ospite (Produzione)
    struttura_filtro = None if hc_sel == 'GRUPPO' else hc_sel
    mix_trattamento = report_trattamenti(data_da=stagione['open_date'], data_a=fino_a,
                                          struttura_code=struttura_filtro, is_test=False, db=db)['per_trattamento']
    mix_tipo_ospite = report_tipo_ospite(data_da=stagione['open_date'], data_a=fino_a,
                                          struttura_code=struttura_filtro, is_test=False, db=db)['per_tipo_ospite']

    # ── Heatmap occupancy per giorno di stagione
    heatmap: list[dict] = []
    if snap is not None:
        per_giorno: dict = defaultdict(lambda: {'rooms_sold': 0, 'rooms_available': 0})
        per_hotel = _raggruppa_per_hotel(_carica_righe(db, snapshot_date=snap))
        for hc in hotel_codes:
            for r in per_hotel.get(hc, []):
                per_giorno[r.data]['rooms_sold'] += r.rooms_sold
                per_giorno[r.data]['rooms_available'] += r.rooms_available
        heatmap = [
            {'data': d.isoformat(),
             'occupancy': round(v['rooms_sold'] / v['rooms_available'] * 100, 1) if v['rooms_available'] else None}
            for d, v in sorted(per_giorno.items())
        ]

    return {
        'anno': anno,
        'hotel_code': hc_sel,
        'costo_lavoro': {
            'mesi_coperti': mesi_coperti,
            'per_struttura': list(costo_per_struttura.values()),
            'costo_totale': costo_totale,
            'revenue_periodo': revenue_periodo,
            'labor_cost_ratio': _gauge('labor_cost_ratio', labor_ratio, soglie),
        },
        'margine_contribuzione': None if margine is None else {
            'revenue_periodo': revenue_periodo, 'costo_lavoro': costo_totale,
            'margine': margine,
            'margine_pct': round(margine / revenue_periodo * 100, 1) if revenue_periodo else None,
            'mesi_coperti': mesi_coperti,
            'nota': 'Parziale: sottrae solo il costo del lavoro, non gli altri costi operativi.',
        },
        'delta_rt_stagione': delta_rt,
        'mix_trattamento': mix_trattamento,
        'mix_tipo_ospite': mix_tipo_ospite,
        'heatmap_occupancy': heatmap,
    }


# ---------------------------------------------------------------------------
# Soglie tachimetri
# ---------------------------------------------------------------------------

class SogliaInput(BaseModel):
    target: Optional[float] = None
    soglia_rossa: float
    soglia_arancione: float


def _soglia_out(row: DashboardKpiSoglia) -> dict:
    return {
        'id': row.id, 'kpi_code': row.kpi_code, 'hotel_code': row.hotel_code,
        'direzione': row.direzione, 'unita': row.unita,
        'target': float(row.target) if row.target is not None else None,
        'soglia_rossa': float(row.soglia_rossa), 'soglia_arancione': float(row.soglia_arancione),
        'ordine': row.ordine,
    }


@router.get("/soglie", dependencies=[Depends(richiedi_utente_attivo)])
def lista_soglie(db: Session = Depends(get_db)):
    righe = (
        db.query(DashboardKpiSoglia)
        .filter(DashboardKpiSoglia.attivo.is_(True))
        .order_by(DashboardKpiSoglia.ordine)
        .all()
    )
    return [_soglia_out(r) for r in righe]


@router.put("/soglie/{soglia_id}", dependencies=[Depends(richiedi_admin)])
def aggiorna_soglia(soglia_id: int, body: SogliaInput, db: Session = Depends(get_db)):
    row = db.query(DashboardKpiSoglia).filter(DashboardKpiSoglia.id == soglia_id).first()
    if not row:
        raise HTTPException(404, "Soglia non trovata")
    row.target = body.target
    row.soglia_rossa = body.soglia_rossa
    row.soglia_arancione = body.soglia_arancione
    db.commit()
    db.refresh(row)
    return _soglia_out(row)
