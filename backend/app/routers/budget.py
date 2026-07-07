"""Endpoint per la gestione del budget settimanale per hotel.

Struttura endpoint:
    PUT  /budget/{hotel_code}/{season_year}/{week_start}  → salva/aggiorna singola settimana
    POST /budget/{hotel_code}/{season_year}               → upsert lista settimane (legacy)
    POST /budget/{hotel_code}/{season_year}/bulk          → inserimento multiplo
    GET  /budget/{hotel_code}/{season_year}               → lista budget
    GET  /budget/{hotel_code}/{season_year}/{week_start}  → singola settimana
    GET  /budget/{hotel_code}/{season_year}/versions      → versioni disponibili
    POST /budget/{hotel_code}/{season_year}/version       → crea nuova versione
    GET  /budget/{hotel_code}/{season_year}/confronto     → actual vs budget settimanale
    GET  /budget/{hotel_code}/{season_year}/confronto/mensile  → confronto aggregato per mese
    GET  /budget/{hotel_code}/{season_year}/proiezione    → proiezione fine stagione
    GET  /budget/{hotel_code}/{season_year}/settimane-mancanti → settimane senza budget
    GET  /budget/{hotel_code}/{season_year}/config        → config hotel/anno
    PUT  /budget/{hotel_code}/{season_year}/config        → salva config
    POST /budget/{hotel_code}/{season_year}/import-excel  → importa da .xlsx
    GET  /budget/gruppo/{season_year}/confronto           → confronto gruppo
    GET  /budget/gruppo/{season_year}/proiezione          → proiezione gruppo
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, joinedload

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import BudgetConfig, BudgetEntry, DailyRevenue, Hotel, HotelSeason
from app.services.budget_calculator import KPIBudget, calcola_kpi_budget, calcola_mese_contabile
from app.services.budget_importer import importa_budget_excel
from app.services.weekly_aggregator import settimana_di

router = APIRouter(prefix="/budget", tags=["budget"], dependencies=[Depends(richiedi_utente_attivo)])


# ---------------------------------------------------------------------------
# Schemi Pydantic
# ---------------------------------------------------------------------------

class BudgetSettimanaInput(BaseModel):
    week_start: date
    version: str = 'v1'
    # 4 input manuali
    occupancy: Optional[float] = None     # % occupazione 0-100 (input principale)
    adr: Optional[float] = None           # prezzo medio camera €
    adr_fnb: Optional[float] = None       # F&B medio per camera venduta €
    adr_extra: Optional[float] = None     # Extra medio per camera venduta €
    notes: Optional[str] = None
    # campo legacy per import Excel con camere_vendute invece di occupancy
    camere_vendute: Optional[int] = None


class BudgetSettimanaSingolaInput(BaseModel):
    """Come BudgetSettimanaInput ma senza week_start: nel PUT della singola settimana
    week_start arriva già dal path e la funzione usa quello, mai il campo nel body."""
    version: str = 'v1'
    occupancy: Optional[float] = None
    adr: Optional[float] = None
    adr_fnb: Optional[float] = None
    adr_extra: Optional[float] = None
    notes: Optional[str] = None
    camere_vendute: Optional[int] = None


class BudgetSettimanaOutput(BaseModel):
    id: int
    hotel_id: Optional[int]
    season_year: int
    week_start: date
    version: str
    # Input manuali
    occupancy: Optional[float]            # % 0-100 (input)
    adr: Optional[float]
    adr_fnb: Optional[float]              # € per camera venduta (input)
    adr_extra: Optional[float]            # € per camera venduta (input)
    # Derivati
    camere_vendute: Optional[int]         # derivato da occupancy × rooms_available
    rooms_available: Optional[int]
    # Revenue
    revenue_rooms: Optional[float]
    revenue_fnb: Optional[float]
    revenue_extra: Optional[float]
    revenue_total: Optional[float]
    # KPI derivati
    revpar: Optional[float]
    trevpar: Optional[float]
    rmc: Optional[float]
    inc_rooms: Optional[float]
    inc_fnb: Optional[float]
    inc_extra: Optional[float]
    # Mese contabile
    mese_contabile: Optional[int]
    anno_contabile: Optional[int]
    notes: Optional[str]

    model_config = {"from_attributes": True}


class NuovaVersioneInput(BaseModel):
    source_version: str
    new_version: str
    note: Optional[str] = None


class BudgetConfigInput(BaseModel):
    costo_pasto: Optional[float] = None
    costo_colazione: Optional[float] = None
    altro_rev_presenza: Optional[float] = None
    notti_medie_soggiorno: Optional[float] = None
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Helper interni
# ---------------------------------------------------------------------------

def _hotel_o_404(hotel_code: str, db: Session) -> Hotel:
    h = db.query(Hotel).filter(Hotel.code == hotel_code.upper()).first()
    if not h:
        raise HTTPException(status_code=404,
                            detail=f"Hotel '{hotel_code}' non trovato nel database")
    return h


def _dec(v) -> Optional[float]:
    """Decimal → float per la serializzazione JSON."""
    return float(v) if isinstance(v, Decimal) else v


def _rooms_available_settimana(hotel: Hotel, season_year: int, week_start: date, db: Session) -> Optional[int]:
    """Calcola le camere disponibili per una settimana (total_rooms × giorni nella stagione)."""
    stagione = (
        db.query(HotelSeason)
        .filter(HotelSeason.hotel_id == hotel.id, HotelSeason.season_year == season_year)
        .first()
    )
    if not stagione:
        return hotel.default_rooms * 7

    week_end = week_start + timedelta(days=6)
    # Giorni dell'hotel aperti in questa settimana
    giorni = 0
    giorno = week_start
    while giorno <= week_end:
        if stagione.open_date <= giorno <= stagione.close_date:
            giorni += 1
        giorno += timedelta(days=1)
    return stagione.total_rooms * giorni if giorni > 0 else None


def _row_to_output(row: BudgetEntry) -> BudgetSettimanaOutput:
    return BudgetSettimanaOutput(
        id=row.id,
        hotel_id=row.hotel_id,
        season_year=row.season_year,
        week_start=row.week_start,
        version=row.version,
        camere_vendute=row.rooms_sold_budget,
        adr=_dec(row.adr_budget),
        adr_fnb=_dec(row.adr_fnb_budget),
        adr_extra=_dec(row.adr_extra_budget),
        rooms_available=row.rooms_available_budget,
        revenue_rooms=_dec(row.revenue_rooms_budget),
        revenue_fnb=_dec(row.revenue_fnb_budget),
        revenue_extra=_dec(row.revenue_extra_budget),
        revenue_total=_dec(row.revenue_total_budget),
        occupancy=_dec(row.occupancy_budget),
        revpar=_dec(row.revpar_budget),
        trevpar=_dec(row.trevpar_budget),
        rmc=_dec(row.rmc_budget),
        inc_rooms=_dec(row.inc_rooms_budget),
        inc_fnb=_dec(row.inc_fnb_budget),
        inc_extra=_dec(row.inc_extra_budget),
        mese_contabile=row.mese_contabile,
        anno_contabile=row.anno_contabile,
        notes=row.notes,
    )


def _calcola_e_salva(
    hotel: Hotel,
    season_year: int,
    week_start: date,
    occupancy: Optional[float],
    adr: Optional[float],
    adr_fnb: Optional[float],
    adr_extra: Optional[float],
    version: str,
    notes: Optional[str],
    updated_by_id: Optional[int],
    db: Session,
) -> BudgetEntry:
    """Upsert con calcolo KPI automatico.

    occupancy è il % di occupazione (0-100) — input principale.
    adr_fnb e adr_extra sono € per camera venduta (input diretti).
    Le camere vendute vengono derivate: round(occupancy/100 × rooms_available).
    """
    week_end = week_start + timedelta(days=6)
    rooms_available = _rooms_available_settimana(hotel, season_year, week_start, db)
    mese, anno = calcola_mese_contabile(week_start, week_end)

    kpi: KPIBudget = calcola_kpi_budget(
        occupancy_pct=occupancy,
        adr=adr,
        adr_fnb=adr_fnb,
        adr_extra=adr_extra,
        rooms_available=rooms_available,
    )

    valori = dict(
        hotel_id=hotel.id,
        season_year=season_year,
        week_start=week_start,
        version=version,
        rooms_sold_budget=kpi.rooms_sold,         # derivato da occupancy
        adr_budget=adr,
        adr_fnb_budget=adr_fnb,
        adr_extra_budget=adr_extra,
        rooms_available_budget=rooms_available,
        revenue_rooms_budget=kpi.revenue_rooms,
        revenue_fnb_budget=kpi.revenue_fnb,
        revenue_extra_budget=kpi.revenue_extra,
        revenue_total_budget=kpi.revenue_total,
        occupancy_budget=kpi.occupancy,           # input, salvato invariato
        revpar_budget=kpi.revpar,
        trevpar_budget=kpi.trevpar,
        rmc_budget=kpi.rmc,
        inc_rooms_budget=kpi.inc_rooms,
        inc_fnb_budget=kpi.inc_fnb,
        inc_extra_budget=kpi.inc_extra,
        mese_contabile=mese,
        anno_contabile=anno,
        notes=notes,
        updated_by=updated_by_id,
    )

    set_vals = {k: v for k, v in valori.items()
                if k not in ('hotel_id', 'season_year', 'week_start', 'version')}

    stmt = (
        pg_insert(BudgetEntry)
        .values(**valori)
        .on_conflict_do_update(
            constraint='uq_budget_hotel_settimana',
            set_=set_vals,
        )
        .returning(BudgetEntry.id)
    )
    result = db.execute(stmt)
    db.commit()
    new_id = result.scalar()
    return db.query(BudgetEntry).filter(BudgetEntry.id == new_id).first()


def _actual_settimanale(hotel: Hotel, season_year: int, version: str, db: Session, week_da=None, week_a=None) -> dict:
    """
    Calcola i KPI actual da daily_revenue aggregati per settimana commerciale.
    Restituisce dict: week_start → dict KPI.
    """
    q = (
        db.query(DailyRevenue)
        .filter(
            DailyRevenue.hotel_id == hotel.id,
            DailyRevenue.is_test == False,  # noqa: E712
        )
        .order_by(DailyRevenue.data)
    )
    if week_da:
        q = q.filter(DailyRevenue.data >= week_da)
    if week_a:
        q = q.filter(DailyRevenue.data <= week_a + timedelta(days=6))

    # Usa solo la snapshot più recente per ogni data
    per_data: dict[date, DailyRevenue] = {}
    for r in q.all():
        prev = per_data.get(r.data)
        if prev is None or (r.snapshot_date or date.min) > (prev.snapshot_date or date.min):
            per_data[r.data] = r

    # Aggrega per settimana
    per_settimana: dict[date, dict] = defaultdict(lambda: {
        'rooms_sold': 0, 'rooms_available': 0,
        'revenue_rooms': 0.0, 'revenue_fnb': 0.0,
        'revenue_extra': 0.0, 'revenue_total': 0.0,
        'giorni': 0,
    })
    for giorno, row in per_data.items():
        ws = settimana_di(giorno)
        s = per_settimana[ws]
        s['rooms_sold']     += row.rooms_sold
        s['rooms_available'] += row.rooms_available
        s['revenue_rooms']  += row.revenue_rooms
        s['revenue_fnb']    += row.revenue_fnb
        s['revenue_extra']  += row.revenue_extra
        s['revenue_total']  += row.revenue_total
        s['giorni']         += 1

    def _kpi(s):
        rs = s['rooms_sold']
        ra = s['rooms_available']
        rt = s['revenue_total']
        rr = s['revenue_rooms']
        def sd(n, d): return n / d if d else None
        return {
            'rooms_sold': rs, 'rooms_available': ra,
            'revenue_rooms': rr, 'revenue_fnb': s['revenue_fnb'],
            'revenue_extra': s['revenue_extra'], 'revenue_total': rt,
            'giorni': s['giorni'],
            'occupancy': sd(rs * 100, ra),
            'adr': sd(rr, rs),
            'revpar': sd(rr, ra),
            'trevpar': sd(rt, ra),
            'rmc': sd(rt, rs),
            'inc_rooms': sd(rr * 100, rt),
            'inc_fnb': sd(s['revenue_fnb'] * 100, rt),
            'inc_extra': sd(s['revenue_extra'] * 100, rt),
        }

    return {ws: _kpi(s) for ws, s in per_settimana.items()}


def _scostamento(budget: dict, actual: dict) -> dict:
    """Calcola scostamento assoluto e percentuale tra actual e budget."""
    campi = ['rooms_sold', 'revenue_rooms', 'revenue_fnb', 'revenue_extra',
             'revenue_total', 'occupancy', 'adr', 'revpar', 'trevpar', 'rmc']
    assoluto = {}
    percentuale = {}
    for k in campi:
        b = budget.get(k)
        a = actual.get(k)
        if b is not None and a is not None:
            assoluto[k] = a - b
            percentuale[k] = (a - b) / b * 100 if b != 0 else None
        else:
            assoluto[k] = None
            percentuale[k] = None
    sopra = (actual.get('revenue_total') or 0) >= (budget.get('revenue_total') or 0)
    return {'assoluto': assoluto, 'percentuale': percentuale, 'sopra_budget': sopra}


def _entry_to_budget_dict(e: BudgetEntry) -> dict:
    return {
        'rooms_sold': e.rooms_sold_budget,
        'rooms_available': e.rooms_available_budget,
        'revenue_rooms': _dec(e.revenue_rooms_budget),
        'revenue_fnb': _dec(e.revenue_fnb_budget),
        'revenue_extra': _dec(e.revenue_extra_budget),
        'revenue_total': _dec(e.revenue_total_budget),
        'occupancy': _dec(e.occupancy_budget),
        'adr': _dec(e.adr_budget),
        'adr_fnb': _dec(e.adr_fnb_budget),
        'adr_extra': _dec(e.adr_extra_budget),
        'revpar': _dec(e.revpar_budget),
        'trevpar': _dec(e.trevpar_budget),
        'rmc': _dec(e.rmc_budget),
        'inc_rooms': _dec(e.inc_rooms_budget),
        'inc_fnb': _dec(e.inc_fnb_budget),
        'inc_extra': _dec(e.inc_extra_budget),
    }


def _settimane_stagione(hotel: Hotel, season_year: int, db: Session) -> list[tuple[date, date]]:
    """Lista di tutte le settimane commerciali (week_start, week_end) della stagione."""
    stagione = (
        db.query(HotelSeason)
        .filter(HotelSeason.hotel_id == hotel.id, HotelSeason.season_year == season_year)
        .first()
    )
    if not stagione:
        return []
    ws = settimana_di(stagione.open_date)
    risultato = []
    while ws <= stagione.close_date:
        we = ws + timedelta(days=6)
        risultato.append((ws, we))
        ws += timedelta(days=7)
    return risultato


# ---------------------------------------------------------------------------
# ENDPOINT GRUPPO — deve stare PRIMA di /{hotel_code} per evitare conflitti
# ---------------------------------------------------------------------------

@router.get("/gruppo/{season_year}/confronto")
def confronto_gruppo(
    season_year: int,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    """Confronto actual vs budget per tutti gli hotel del gruppo."""
    hotels = db.query(Hotel).all()
    risultato = []
    for hotel in hotels:
        entries = (
            db.query(BudgetEntry)
            .filter(
                BudgetEntry.hotel_id == hotel.id,
                BudgetEntry.season_year == season_year,
                BudgetEntry.version == version,
            )
            .order_by(BudgetEntry.week_start)
            .all()
        )
        if not entries:
            continue
        actual_map = _actual_settimanale(hotel, season_year, version, db)
        budget_tot = {'revenue_total': 0.0, 'rooms_sold': 0, 'rooms_available': 0,
                      'revenue_rooms': 0.0, 'revenue_fnb': 0.0, 'revenue_extra': 0.0}
        actual_tot = {k: 0.0 for k in budget_tot}
        n_sett_ok = 0
        for e in entries:
            b = _entry_to_budget_dict(e)
            a = actual_map.get(e.week_start)
            for k in budget_tot:
                budget_tot[k] = (budget_tot[k] or 0) + (b.get(k) or 0)
                if a:
                    actual_tot[k] = (actual_tot[k] or 0) + (a.get(k) or 0)
                    n_sett_ok += 1

        def sd(n, d): return n / d if d else None
        risultato.append({
            'hotel_code': hotel.code,
            'hotel_name': hotel.name,
            'n_settimane_budget': len(entries),
            'n_settimane_actual': n_sett_ok // max(len(entries), 1),
            'budget': budget_tot,
            'actual': actual_tot,
            'scostamento_revenue': (actual_tot['revenue_total'] - budget_tot['revenue_total'])
                                    if budget_tot['revenue_total'] else None,
            'scostamento_pct': sd(
                (actual_tot['revenue_total'] - budget_tot['revenue_total']),
                budget_tot['revenue_total'],
            ),
        })
    return {'season_year': season_year, 'version': version, 'hotel': risultato}


@router.get("/gruppo/{season_year}/proiezione")
def proiezione_gruppo(
    season_year: int,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    """Proiezione fine stagione per il gruppo."""
    hotels = db.query(Hotel).all()
    budget_gruppo = {'revenue_total': 0.0, 'rooms_sold': 0, 'revenue_rooms': 0.0,
                     'revenue_fnb': 0.0, 'revenue_extra': 0.0}
    proiezione_gruppo = {k: 0.0 for k in budget_gruppo}
    risultati_hotel = []

    for hotel in hotels:
        entries = (
            db.query(BudgetEntry)
            .filter(
                BudgetEntry.hotel_id == hotel.id,
                BudgetEntry.season_year == season_year,
                BudgetEntry.version == version,
            )
            .order_by(BudgetEntry.week_start)
            .all()
        )
        if not entries:
            continue
        actual_map = _actual_settimanale(hotel, season_year, version, db)
        bud = 0.0; proj = 0.0; n_comp = 0
        for e in entries:
            bud += float(e.revenue_total_budget or 0)
            a = actual_map.get(e.week_start)
            proj += a['revenue_total'] if a else float(e.revenue_total_budget or 0)
            if a:
                n_comp += 1
        def sd(n, d): return n / d if d else None
        risultati_hotel.append({
            'hotel_code': hotel.code,
            'hotel_name': hotel.name,
            'budget_totale': bud,
            'proiezione': proj,
            'scostamento': proj - bud,
            'scostamento_pct': sd(proj - bud, bud),
            'settimane_completate': n_comp,
            'settimane_totali': len(entries),
        })
        for k in budget_gruppo:
            budget_gruppo[k] += float(getattr(entries[0], f'{k}_budget', 0) or 0) * len(entries)
        proiezione_gruppo['revenue_total'] += proj

    return {
        'season_year': season_year,
        'version': version,
        'hotel': risultati_hotel,
        'budget_gruppo_revenue': sum(h['budget_totale'] for h in risultati_hotel),
        'proiezione_gruppo_revenue': sum(h['proiezione'] for h in risultati_hotel),
    }


# ---------------------------------------------------------------------------
# ENDPOINT HOTEL
# ---------------------------------------------------------------------------

@router.put("/{hotel_code}/{season_year}/{week_start}", response_model=BudgetSettimanaOutput)
def salva_settimana(
    hotel_code: str,
    season_year: int,
    week_start: date,
    body: BudgetSettimanaSingolaInput,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Inserisce o aggiorna una singola settimana con ricalcolo KPI automatico."""
    hotel = _hotel_o_404(hotel_code, db)
    row = _calcola_e_salva(
        hotel=hotel,
        season_year=season_year,
        week_start=week_start,
        occupancy=body.occupancy,
        adr=body.adr,
        adr_fnb=body.adr_fnb,
        adr_extra=body.adr_extra,
        version=body.version,
        notes=body.notes,
        updated_by_id=utente.id,
        db=db,
    )
    return _row_to_output(row)


@router.post("/{hotel_code}/{season_year}/bulk", response_model=List[BudgetSettimanaOutput])
def salva_bulk(
    hotel_code: str,
    season_year: int,
    settimane: List[BudgetSettimanaInput],
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Inserisce multiple settimane in un'unica chiamata."""
    hotel = _hotel_o_404(hotel_code, db)
    rows = []
    for s in settimane:
        r = _calcola_e_salva(
            hotel=hotel,
            season_year=season_year,
            week_start=s.week_start,
            occupancy=s.occupancy,
            adr=s.adr,
            adr_fnb=s.adr_fnb,
            adr_extra=s.adr_extra,
            version=s.version,
            notes=s.notes,
            updated_by_id=utente.id,
            db=db,
        )
        if r:
            rows.append(r)
    return [_row_to_output(r) for r in rows]


@router.get("/{hotel_code}/{season_year}/versions")
def lista_versioni(
    hotel_code: str,
    season_year: int,
    db: Session = Depends(get_db),
):
    """Lista versioni disponibili per hotel e anno."""
    hotel = _hotel_o_404(hotel_code, db)
    rows = (
        db.query(BudgetEntry.version)
        .filter(BudgetEntry.hotel_id == hotel.id, BudgetEntry.season_year == season_year)
        .distinct()
        .all()
    )
    return {'versions': sorted(r.version for r in rows)}


@router.post("/{hotel_code}/{season_year}/version")
def crea_versione(
    hotel_code: str,
    season_year: int,
    body: NuovaVersioneInput,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Crea una nuova versione copiando le settimane da una versione esistente."""
    hotel = _hotel_o_404(hotel_code, db)

    # Verifica che la versione sorgente esista
    sorgente = (
        db.query(BudgetEntry)
        .filter(
            BudgetEntry.hotel_id == hotel.id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.version == body.source_version,
        )
        .all()
    )
    if not sorgente:
        raise HTTPException(status_code=404,
                            detail=f"Versione '{body.source_version}' non trovata")

    # Verifica che la versione destinazione non esista già
    esiste = (
        db.query(BudgetEntry)
        .filter(
            BudgetEntry.hotel_id == hotel.id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.version == body.new_version,
        )
        .first()
    )
    if esiste:
        raise HTTPException(status_code=409,
                            detail=f"Versione '{body.new_version}' già esistente")

    copiate = 0
    for s in sorgente:
        db.add(BudgetEntry(
            hotel_id=hotel.id,
            season_year=season_year,
            week_start=s.week_start,
            version=body.new_version,
            rooms_sold_budget=s.rooms_sold_budget,
            adr_budget=s.adr_budget,
            adr_fnb_budget=s.adr_fnb_budget,
            adr_extra_budget=s.adr_extra_budget,
            rooms_available_budget=s.rooms_available_budget,
            revenue_rooms_budget=s.revenue_rooms_budget,
            revenue_fnb_budget=s.revenue_fnb_budget,
            revenue_extra_budget=s.revenue_extra_budget,
            revenue_total_budget=s.revenue_total_budget,
            occupancy_budget=s.occupancy_budget,
            revpar_budget=s.revpar_budget,
            trevpar_budget=s.trevpar_budget,
            rmc_budget=s.rmc_budget,
            inc_rooms_budget=s.inc_rooms_budget,
            inc_fnb_budget=s.inc_fnb_budget,
            inc_extra_budget=s.inc_extra_budget,
            mese_contabile=s.mese_contabile,
            anno_contabile=s.anno_contabile,
            notes=body.note,
            updated_by=utente.id,
        ))
        copiate += 1

    db.commit()
    return {
        'source_version': body.source_version,
        'new_version': body.new_version,
        'settimane_copiate': copiate,
    }


@router.get("/{hotel_code}/{season_year}/confronto")
def confronto_actual_budget(
    hotel_code: str,
    season_year: int,
    version: str = Query('v1'),
    week_da: Optional[date] = Query(None),
    week_a: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """Confronto actual vs budget settimana per settimana."""
    hotel = _hotel_o_404(hotel_code, db)

    q = (
        db.query(BudgetEntry)
        .filter(
            BudgetEntry.hotel_id == hotel.id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.version == version,
        )
        .order_by(BudgetEntry.week_start)
    )
    if week_da:
        q = q.filter(BudgetEntry.week_start >= week_da)
    if week_a:
        q = q.filter(BudgetEntry.week_start <= week_a)
    entries = q.all()

    actual_map = _actual_settimanale(hotel, season_year, version, db, week_da, week_a)

    risultato = []
    for e in entries:
        b = _entry_to_budget_dict(e)
        a = actual_map.get(e.week_start)
        mese, anno = calcola_mese_contabile(e.week_start, e.week_start + timedelta(days=6))
        risultato.append({
            'week_start': e.week_start.isoformat(),
            'week_end': (e.week_start + timedelta(days=6)).isoformat(),
            'mese_contabile': e.mese_contabile or mese,
            'anno_contabile': e.anno_contabile or anno,
            'budget': b,
            'actual': a,
            'scostamento': _scostamento(b, a) if a else None,
            'dati_disponibili': a is not None,
        })

    # Totali
    budget_tot = {k: sum((r['budget'].get(k) or 0) for r in risultato) for k in
                  ['rooms_sold', 'revenue_rooms', 'revenue_fnb', 'revenue_extra', 'revenue_total']}
    actual_tot = {k: sum((r['actual'].get(k) or 0) for r in risultato if r['actual'])
                  for k in budget_tot}

    return {
        'hotel_code': hotel.code,
        'season_year': season_year,
        'version': version,
        'settimane': risultato,
        'totali_budget': budget_tot,
        'totali_actual': actual_tot,
        'scostamento_totale': _scostamento(budget_tot, actual_tot),
    }


@router.get("/{hotel_code}/{season_year}/confronto/mensile")
def confronto_mensile(
    hotel_code: str,
    season_year: int,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    """Confronto actual vs budget aggregato per mese contabile."""
    hotel = _hotel_o_404(hotel_code, db)
    entries = (
        db.query(BudgetEntry)
        .filter(
            BudgetEntry.hotel_id == hotel.id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.version == version,
        )
        .order_by(BudgetEntry.week_start)
        .all()
    )
    actual_map = _actual_settimanale(hotel, season_year, version, db)

    campi = ['rooms_sold', 'revenue_rooms', 'revenue_fnb', 'revenue_extra', 'revenue_total']
    mesi: dict[tuple, dict] = defaultdict(lambda: {
        'budget': {k: 0.0 for k in campi},
        'actual': {k: 0.0 for k in campi},
        'n_settimane': 0,
        'n_actual': 0,
    })

    for e in entries:
        chiave = (e.anno_contabile or 0, e.mese_contabile or 0)
        m = mesi[chiave]
        b = _entry_to_budget_dict(e)
        a = actual_map.get(e.week_start)
        for k in campi:
            m['budget'][k] += b.get(k) or 0
            if a:
                m['actual'][k] += a.get(k) or 0
        m['n_settimane'] += 1
        if a:
            m['n_actual'] += 1

    from app.utils.locale_it import MESI_IT
    risultato = []
    for (anno, mese), dati in sorted(mesi.items()):
        label = f"{MESI_IT[mese - 1]} {anno}" if 1 <= mese <= 12 else f"{mese}/{anno}"
        risultato.append({
            'mese_contabile': mese,
            'anno_contabile': anno,
            'label': label,
            'n_settimane': dati['n_settimane'],
            'n_actual': dati['n_actual'],
            'budget': dati['budget'],
            'actual': dati['actual'],
            'scostamento': _scostamento(dati['budget'], dati['actual'])
                           if dati['n_actual'] > 0 else None,
        })

    return {
        'hotel_code': hotel.code,
        'season_year': season_year,
        'version': version,
        'mesi': risultato,
    }


@router.get("/{hotel_code}/{season_year}/proiezione")
def proiezione_fine_stagione(
    hotel_code: str,
    season_year: int,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    """
    Proiezione fine stagione: settimane con actual → usa actual; senza → usa budget.
    """
    hotel = _hotel_o_404(hotel_code, db)
    entries = (
        db.query(BudgetEntry)
        .filter(
            BudgetEntry.hotel_id == hotel.id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.version == version,
        )
        .order_by(BudgetEntry.week_start)
        .all()
    )
    if not entries:
        raise HTTPException(status_code=404, detail="Nessun budget inserito")

    actual_map = _actual_settimanale(hotel, season_year, version, db)

    campi = ['rooms_sold', 'rooms_available', 'revenue_rooms', 'revenue_fnb',
             'revenue_extra', 'revenue_total']
    bud_tot  = {k: 0.0 for k in campi}
    act_parz = {k: 0.0 for k in campi}
    proj_tot = {k: 0.0 for k in campi}
    sett_completate = 0

    dettaglio = []
    for e in entries:
        b = _entry_to_budget_dict(e)
        a = actual_map.get(e.week_start)
        for k in campi:
            bud_tot[k]  += b.get(k) or 0
            proj_tot[k] += (a.get(k) if a else b.get(k)) or 0
            if a:
                act_parz[k] += a.get(k) or 0
        if a:
            sett_completate += 1
        tipo = 'completata' if a else 'proiettata'
        dettaglio.append({
            'week_start': e.week_start.isoformat(),
            'week_end': (e.week_start + timedelta(days=6)).isoformat(),
            'tipo': tipo,
            'budget': b,
            'actual_o_proiezione': a if a else b,
        })

    def sd(n, d): return n / d if d else None
    scost = {k: sd(proj_tot[k] - bud_tot[k], bud_tot[k]) for k in campi}
    pct_completata = sett_completate / len(entries) * 100 if entries else 0

    scost_rev = proj_tot['revenue_total'] - bud_tot['revenue_total']
    if abs(sd(scost_rev, bud_tot['revenue_total']) or 0) < 5:
        trend = 'in_linea'
    elif scost_rev > 0:
        trend = 'sopra_budget'
    else:
        trend = 'sotto_budget'

    return {
        'hotel_code': hotel.code,
        'season_year': season_year,
        'version': version,
        'stagione_budget_totale': bud_tot,
        'stagione_actual_parziale': act_parz,
        'stagione_proiezione': proj_tot,
        'scostamento_proiezione': scost,
        'settimane_completate': sett_completate,
        'settimane_totali': len(entries),
        'pct_stagione_completata': round(pct_completata, 1),
        'trend': trend,
        'dettaglio': dettaglio,
    }


@router.get("/{hotel_code}/{season_year}/settimane-mancanti")
def settimane_mancanti(
    hotel_code: str,
    season_year: int,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    """Settimane della stagione per cui non è stato inserito il budget."""
    hotel = _hotel_o_404(hotel_code, db)
    settimane = _settimane_stagione(hotel, season_year, db)
    se_con_budget = {
        e.week_start
        for e in db.query(BudgetEntry.week_start).filter(
            BudgetEntry.hotel_id == hotel.id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.version == version,
        ).all()
    }
    mancanti = [
        {'week_start': ws.isoformat(), 'week_end': we.isoformat()}
        for ws, we in settimane if ws not in se_con_budget
    ]
    return {
        'hotel_code': hotel.code,
        'season_year': season_year,
        'version': version,
        'n_settimane_totali': len(settimane),
        'n_mancanti': len(mancanti),
        'mancanti': mancanti,
    }


@router.get("/{hotel_code}/{season_year}/config")
def leggi_config(
    hotel_code: str,
    season_year: int,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    """Legge i parametri di configurazione budget per hotel e anno."""
    hotel = _hotel_o_404(hotel_code, db)
    cfg = (
        db.query(BudgetConfig)
        .filter(
            BudgetConfig.hotel_id == hotel.id,
            BudgetConfig.season_year == season_year,
            BudgetConfig.version == version,
        )
        .first()
    )
    if not cfg:
        return {'hotel_id': hotel.id, 'season_year': season_year, 'version': version}
    return {
        'id': cfg.id,
        'hotel_id': cfg.hotel_id,
        'season_year': cfg.season_year,
        'version': cfg.version,
        'costo_pasto': _dec(cfg.costo_pasto),
        'costo_colazione': _dec(cfg.costo_colazione),
        'altro_rev_presenza': _dec(cfg.altro_rev_presenza),
        'notti_medie_soggiorno': _dec(cfg.notti_medie_soggiorno),
        'note': cfg.note,
    }


@router.put("/{hotel_code}/{season_year}/config")
def salva_config(
    hotel_code: str,
    season_year: int,
    body: BudgetConfigInput,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Crea o aggiorna i parametri di configurazione budget."""
    hotel = _hotel_o_404(hotel_code, db)
    cfg = (
        db.query(BudgetConfig)
        .filter(
            BudgetConfig.hotel_id == hotel.id,
            BudgetConfig.season_year == season_year,
            BudgetConfig.version == version,
        )
        .first()
    )
    if cfg:
        cfg.costo_pasto = body.costo_pasto
        cfg.costo_colazione = body.costo_colazione
        cfg.altro_rev_presenza = body.altro_rev_presenza
        cfg.notti_medie_soggiorno = body.notti_medie_soggiorno
        cfg.note = body.note
    else:
        cfg = BudgetConfig(
            hotel_id=hotel.id,
            season_year=season_year,
            version=version,
            costo_pasto=body.costo_pasto,
            costo_colazione=body.costo_colazione,
            altro_rev_presenza=body.altro_rev_presenza,
            notti_medie_soggiorno=body.notti_medie_soggiorno,
            note=body.note,
            created_by=utente.id,
        )
        db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {'ok': True, 'id': cfg.id}


@router.post("/{hotel_code}/{season_year}/import-excel")
def import_excel(
    hotel_code: str,
    season_year: int,
    version: str = Query('v1'),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Importa budget da file Excel (.xlsx)."""
    hotel = _hotel_o_404(hotel_code, db)
    contenuto = file.file.read()
    risultato = importa_budget_excel(contenuto, version=version)

    salvate = 0
    for r in risultato['righe']:
        # Se l'Excel ha camere_vendute ma non occupancy, la deriva da rooms_available
        occ = r.get('occupancy')
        if occ is None and r.get('camere_vendute') is not None:
            ra = _rooms_available_settimana(hotel, season_year, r['week_start'], db)
            if ra:
                occ = round(r['camere_vendute'] / ra * 100, 2)
        row = _calcola_e_salva(
            hotel=hotel,
            season_year=season_year,
            week_start=r['week_start'],
            occupancy=occ,
            adr=r.get('adr'),
            adr_fnb=r.get('adr_fnb'),
            adr_extra=r.get('adr_extra'),
            version=r.get('version', version),
            notes=r.get('note'),
            updated_by_id=utente.id,
            db=db,
        )
        if row:
            salvate += 1

    return {
        'hotel_code': hotel.code,
        'season_year': season_year,
        'version': version,
        'n_righe_lette': risultato['n_righe_lette'],
        'n_righe_salvate': salvate,
        'righe_non_parsate': risultato['righe_non_parsate'],
    }


# ---------------------------------------------------------------------------
# Endpoint legacy (compatibilità con vecchio frontend)
# ---------------------------------------------------------------------------

@router.post("/{hotel_code}/{season_year}", response_model=List[BudgetSettimanaOutput])
def salva_budget_legacy(
    hotel_code: str,
    season_year: int,
    settimane: List[BudgetSettimanaInput],
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Inserisce o aggiorna budget settimanale (endpoint legacy, preferire /bulk)."""
    hotel = _hotel_o_404(hotel_code, db)
    rows = []
    for s in settimane:
        r = _calcola_e_salva(
            hotel=hotel,
            season_year=season_year,
            week_start=s.week_start,
            occupancy=s.occupancy,
            adr=s.adr,
            adr_fnb=s.adr_fnb,
            adr_extra=s.adr_extra,
            version=s.version,
            notes=s.notes,
            updated_by_id=utente.id,
            db=db,
        )
        if r:
            rows.append(r)
    return [_row_to_output(r) for r in rows]


@router.get("/{hotel_code}/{season_year}", response_model=List[BudgetSettimanaOutput])
def lista_budget(
    hotel_code: str,
    season_year: int,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    """Restituisce tutti i budget settimanali di un hotel per anno e versione."""
    hotel = _hotel_o_404(hotel_code, db)
    rows = (
        db.query(BudgetEntry)
        .filter(
            BudgetEntry.hotel_id == hotel.id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.version == version,
        )
        .order_by(BudgetEntry.week_start)
        .all()
    )
    return [_row_to_output(r) for r in rows]


@router.get("/{hotel_code}/{season_year}/{week_start}", response_model=BudgetSettimanaOutput)
def budget_settimana(
    hotel_code: str,
    season_year: int,
    week_start: date,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
):
    """Restituisce il budget di una singola settimana."""
    hotel = _hotel_o_404(hotel_code, db)
    row = (
        db.query(BudgetEntry)
        .filter(
            BudgetEntry.hotel_id == hotel.id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.week_start == week_start,
            BudgetEntry.version == version,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Nessun budget per {hotel_code} settimana {week_start} versione {version}",
        )
    return _row_to_output(row)
