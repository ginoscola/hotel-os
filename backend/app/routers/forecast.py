"""Router FastAPI — modulo Forecast & OTB (On The Books).

L'OTB viene calcolato direttamente da daily_revenue: ogni upload settimanale
del modulo Revenue è implicitamente uno snapshot OTB identificato da snapshot_date.

Tabelle gestite:
  - daily_revenue      (sola lettura — scritto dal modulo Revenue)
  - forecast_budget    (budget mensile per hotel/anno/mese)
  - forecast_pickup_config (pickup rate mensile: % incremento OTB → forecast)
  - forecast_maturato  (maturato manuale: override del dato OTB calcolato)
"""

from calendar import monthrange
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import (
    DailyRevenue,
    ForecastBudget,
    ForecastMaturato,
    ForecastPickupConfig,
    Hotel,
)
from app.utils.locale_it import MESI_IT

router = APIRouter(prefix="/forecast", tags=["forecast"])


# ---------------------------------------------------------------------------
# Schemi Pydantic
# ---------------------------------------------------------------------------

class ForecastMeseRow(BaseModel):
    mese: int
    mese_label: str
    is_past: bool
    # OTB da daily_revenue (ultimo snapshot)
    otb_revenue: Optional[float] = None
    otb_room_nights: Optional[int] = None
    otb_snapshot_date: Optional[str] = None       # data dell'ultimo upload Revenue
    # Maturato manuale (override dell'OTB calcolato)
    maturato_revenue: Optional[float] = None
    maturato_room_nights: Optional[int] = None
    maturato_al: Optional[str] = None             # data_riferimento ISO
    # Valore effettivo usato per il forecast (maturato se presente, altrimenti OTB)
    base_forecast: Optional[float] = None
    pickup_rate: Optional[float] = None
    forecast_revenue: Optional[float] = None
    # Budget e confronto
    budget_revenue: Optional[float] = None
    budget_room_nights: Optional[int] = None
    consuntivo_revenue: Optional[float] = None    # solo mesi passati
    delta_pct: Optional[float] = None


class ForecastSummaryResponse(BaseModel):
    anno: int
    hotel_code: str
    mesi: List[ForecastMeseRow]
    totale_otb: Optional[float]
    totale_forecast: Optional[float]
    totale_budget: Optional[float]
    totale_consuntivo: Optional[float]


class PacePunto(BaseModel):
    snapshot_date: str
    otb_revenue: float
    otb_room_nights: int


class PaceChartResponse(BaseModel):
    anno: int
    mese: int
    mese_label: str
    hotel_code: str
    punti: List[PacePunto]
    budget_revenue: Optional[float]
    forecast_revenue: Optional[float]
    pickup_rate: Optional[float]
    maturato_revenue: Optional[float]
    maturato_al: Optional[str]


class MaturatInput(BaseModel):
    hotel_code: str
    anno: int
    mese: int
    data_riferimento: date
    maturato_revenue: float
    maturato_room_nights: Optional[int] = None
    note: Optional[str] = None


class MaturatRead(BaseModel):
    id: int
    hotel_code: str
    anno: int
    mese: int
    mese_label: str
    data_riferimento: str
    maturato_revenue: float
    maturato_room_nights: Optional[int]
    note: Optional[str]
    updated_at: Optional[str]


class BudgetInput(BaseModel):
    hotel_code: str
    anno: int
    mese: int
    budget_revenue: float
    budget_room_nights: int = 0


class PickupConfigInput(BaseModel):
    hotel_code: str
    anno: int
    mese: int
    pickup_rate: float          # es. 0.15 = +15%
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Funzioni di supporto
# ---------------------------------------------------------------------------

def _get_hotel_o_404(hotel_code: str, db: Session) -> Hotel:
    hotel = db.query(Hotel).filter(Hotel.code == hotel_code.upper()).first()
    if not hotel:
        raise HTTPException(status_code=404, detail=f"Hotel '{hotel_code}' non trovato")
    return hotel


def _hotels_per_codice(hotel_code: str, db: Session) -> List[Hotel]:
    if hotel_code.lower() == "all":
        return db.query(Hotel).filter(Hotel.attivo == True).order_by(Hotel.code).all()
    return [_get_hotel_o_404(hotel_code, db)]


def _otb_mensile(db: Session, hotel_code: str, anno: int, mese: int) -> Optional[dict]:
    """
    Calcola l'OTB del mese dall'ultimo snapshot in daily_revenue.
    Usa tutti i giorni del mese presenti nell'ultimo snapshot caricato.
    """
    da = date(anno, mese, 1)
    a = date(anno, mese, monthrange(anno, mese)[1])

    # Snapshot più recente che contiene dati per questo mese
    max_snap = (
        db.query(func.max(DailyRevenue.snapshot_date))
        .filter(
            DailyRevenue.hotel_code == hotel_code.upper(),
            DailyRevenue.data.between(da, a),
            DailyRevenue.is_test == False,
        )
        .scalar()
    )
    if not max_snap:
        return None

    rows = (
        db.query(DailyRevenue)
        .filter(
            DailyRevenue.hotel_code == hotel_code.upper(),
            DailyRevenue.data.between(da, a),
            DailyRevenue.snapshot_date == max_snap,
            DailyRevenue.is_test == False,
        )
        .all()
    )
    if not rows:
        return None

    return {
        "revenue_total": round(sum(r.revenue_total or 0 for r in rows), 2),
        "rooms_sold": sum(r.rooms_sold or 0 for r in rows),
        "snapshot_date": max_snap,
    }


def _consuntivo_mensile(db: Session, hotel_code: str, anno: int, mese: int) -> Optional[dict]:
    """
    Consuntivo del mese: per ogni data usa solo la snapshot più recente
    (evita duplicati da forecast successivi sugli stessi giorni).
    """
    da = date(anno, mese, 1)
    a = date(anno, mese, monthrange(anno, mese)[1])

    subq = (
        db.query(
            DailyRevenue.data,
            func.max(DailyRevenue.snapshot_date).label("max_snap"),
        )
        .filter(
            DailyRevenue.hotel_code == hotel_code.upper(),
            DailyRevenue.data.between(da, a),
            DailyRevenue.is_test == False,
        )
        .group_by(DailyRevenue.data)
        .subquery()
    )

    rows = (
        db.query(DailyRevenue)
        .join(
            subq,
            (DailyRevenue.data == subq.c.data)
            & (DailyRevenue.snapshot_date == subq.c.max_snap),
        )
        .filter(DailyRevenue.hotel_code == hotel_code.upper())
        .all()
    )

    if not rows:
        return None

    return {
        "revenue_total": round(sum(r.revenue_total or 0 for r in rows), 2),
        "rooms_sold": sum(r.rooms_sold or 0 for r in rows),
    }


def _arrotonda(v: Optional[float], dec: int = 2) -> Optional[float]:
    return round(v, dec) if v is not None else None


# ---------------------------------------------------------------------------
# Endpoint: riepilogo stagione
# ---------------------------------------------------------------------------

@router.get(
    "/summary",
    response_model=ForecastSummaryResponse,
    dependencies=[Depends(richiedi_utente_attivo)],
)
def get_summary(
    anno: int = Query(..., description="Anno stagionale"),
    hotel_code: str = Query(default="all", description="Codice hotel o 'all'"),
    db: Session = Depends(get_db),
):
    """
    Tabella mensile: OTB (da daily_revenue), maturato manuale, pickup%, forecast,
    budget, consuntivo (mesi passati) e delta%.

    Logica per mese M:
    - Mese passato: mostra consuntivo reale da daily_revenue.
    - Mese futuro/corrente: base = maturato manuale se presente, altrimenti OTB calcolato.
      forecast = base × (1 + pickup_rate).
    """
    hotels = _hotels_per_codice(hotel_code, db)
    if not hotels:
        raise HTTPException(status_code=404, detail="Nessun hotel trovato")

    today = date.today()
    is_single = len(hotels) == 1

    mesi: List[ForecastMeseRow] = []
    tot_otb = 0.0
    tot_forecast = 0.0
    tot_budget = 0.0
    tot_consuntivo = 0.0
    has_any_otb = False
    has_any_budget = False
    has_any_consuntivo = False

    for m in range(1, 13):
        mese_last = date(anno, m, monthrange(anno, m)[1])
        is_past = mese_last < today

        otb_rev = 0.0
        otb_rn = 0
        otb_snap: Optional[date] = None
        mat_rev: Optional[float] = None
        mat_rn: Optional[int] = None
        mat_al: Optional[date] = None
        base_rev = 0.0
        forecast_rev = 0.0
        budget_rev = 0.0
        budget_rn = 0
        consuntivo_rev = 0.0
        pickup_rate: Optional[float] = None
        found_otb = False
        found_budget = False
        found_consuntivo = False
        found_maturato = False

        for hotel in hotels:
            # OTB da daily_revenue
            otb = _otb_mensile(db, hotel.code, anno, m)
            if otb:
                found_otb = True
                otb_rev += otb["revenue_total"]
                otb_rn += otb["rooms_sold"]
                if otb_snap is None or otb["snapshot_date"] > otb_snap:
                    otb_snap = otb["snapshot_date"]

            # Maturato manuale
            mat = (
                db.query(ForecastMaturato)
                .filter_by(hotel_id=hotel.id, anno=anno, mese=m)
                .first()
            )
            if mat:
                found_maturato = True
                mat_rev = (mat_rev or 0) + float(mat.maturato_revenue)
                if mat.maturato_room_nights:
                    mat_rn = (mat_rn or 0) + mat.maturato_room_nights
                # In modalità singolo hotel esponiamo la data_riferimento
                if is_single:
                    mat_al = mat.data_riferimento

            # Pickup config
            pickup = (
                db.query(ForecastPickupConfig)
                .filter_by(hotel_id=hotel.id, anno=anno, mese=m)
                .first()
            )
            rate = float(pickup.pickup_rate) if pickup else None
            if is_single:
                pickup_rate = rate

            # Base forecast: maturato se presente, altrimenti OTB
            base_hotel = float(mat.maturato_revenue) if mat else (otb["revenue_total"] if otb else 0.0)
            fcst_hotel = base_hotel * (1.0 + rate) if rate is not None else base_hotel
            base_rev += base_hotel
            forecast_rev += fcst_hotel

            # Budget
            budget = (
                db.query(ForecastBudget)
                .filter_by(hotel_id=hotel.id, anno=anno, mese=m)
                .first()
            )
            if budget:
                found_budget = True
                budget_rev += float(budget.budget_revenue)
                budget_rn += budget.budget_room_nights

            # Consuntivo (mesi passati)
            if is_past:
                cons = _consuntivo_mensile(db, hotel.code, anno, m)
                if cons:
                    found_consuntivo = True
                    consuntivo_rev += cons["revenue_total"]

        # Delta%
        delta: Optional[float] = None
        if found_budget and budget_rev > 0:
            if is_past and found_consuntivo:
                delta = round((consuntivo_rev - budget_rev) / budget_rev * 100, 1)
            elif not is_past and (found_otb or found_maturato):
                delta = round((forecast_rev - budget_rev) / budget_rev * 100, 1)

        # Totali
        if found_otb:
            has_any_otb = True
            tot_otb += otb_rev
        if found_otb or found_maturato:
            tot_forecast += forecast_rev
        if found_budget:
            has_any_budget = True
            tot_budget += budget_rev
        if found_consuntivo:
            has_any_consuntivo = True
            tot_consuntivo += consuntivo_rev

        mesi.append(ForecastMeseRow(
            mese=m,
            mese_label=MESI_IT[m - 1],
            is_past=is_past,
            otb_revenue=_arrotonda(otb_rev) if found_otb else None,
            otb_room_nights=otb_rn if found_otb else None,
            otb_snapshot_date=otb_snap.isoformat() if otb_snap else None,
            maturato_revenue=_arrotonda(mat_rev) if found_maturato else None,
            maturato_room_nights=mat_rn if found_maturato else None,
            maturato_al=mat_al.isoformat() if mat_al else None,
            base_forecast=_arrotonda(base_rev) if (found_otb or found_maturato) else None,
            pickup_rate=pickup_rate,
            forecast_revenue=_arrotonda(forecast_rev) if (found_otb or found_maturato) else None,
            budget_revenue=_arrotonda(budget_rev) if found_budget else None,
            budget_room_nights=budget_rn if found_budget else None,
            consuntivo_revenue=_arrotonda(consuntivo_rev) if (is_past and found_consuntivo) else None,
            delta_pct=delta,
        ))

    return ForecastSummaryResponse(
        anno=anno,
        hotel_code=hotels[0].code if is_single else "all",
        mesi=mesi,
        totale_otb=_arrotonda(tot_otb) if has_any_otb else None,
        totale_forecast=_arrotonda(tot_forecast) if (has_any_otb or has_any_budget) else None,
        totale_budget=_arrotonda(tot_budget) if has_any_budget else None,
        totale_consuntivo=_arrotonda(tot_consuntivo) if has_any_consuntivo else None,
    )


# ---------------------------------------------------------------------------
# Endpoint: pace chart
# ---------------------------------------------------------------------------

@router.get(
    "/pace",
    response_model=PaceChartResponse,
    dependencies=[Depends(richiedi_utente_attivo)],
)
def get_pace(
    anno: int = Query(...),
    mese: int = Query(..., ge=1, le=12),
    hotel_code: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Crescita OTB per un mese target attraverso gli snapshot di daily_revenue.
    Ogni upload settimanale del modulo Revenue genera un punto nel grafico.
    """
    hotel = _get_hotel_o_404(hotel_code, db)
    da = date(anno, mese, 1)
    a = date(anno, mese, monthrange(anno, mese)[1])

    # Un punto per snapshot_date: totale revenue del mese in quell'istantanea
    righe = (
        db.query(
            DailyRevenue.snapshot_date,
            func.sum(DailyRevenue.revenue_total).label("otb_revenue"),
            func.sum(DailyRevenue.rooms_sold).label("otb_room_nights"),
        )
        .filter(
            DailyRevenue.hotel_code == hotel.code,
            DailyRevenue.data.between(da, a),
            DailyRevenue.is_test == False,
        )
        .group_by(DailyRevenue.snapshot_date)
        .order_by(DailyRevenue.snapshot_date.asc())
        .all()
    )

    punti = [
        PacePunto(
            snapshot_date=r.snapshot_date.isoformat(),
            otb_revenue=round(float(r.otb_revenue), 2),
            otb_room_nights=int(r.otb_room_nights or 0),
        )
        for r in righe
    ]

    budget = db.query(ForecastBudget).filter_by(hotel_id=hotel.id, anno=anno, mese=mese).first()
    pickup = db.query(ForecastPickupConfig).filter_by(hotel_id=hotel.id, anno=anno, mese=mese).first()
    mat = db.query(ForecastMaturato).filter_by(hotel_id=hotel.id, anno=anno, mese=mese).first()
    pickup_rate = float(pickup.pickup_rate) if pickup else None

    # Forecast: usa maturato se presente, altrimenti OTB più recente
    forecast_rev: Optional[float] = None
    if mat:
        base = float(mat.maturato_revenue)
        forecast_rev = round(base * (1.0 + pickup_rate), 2) if pickup_rate is not None else base
    elif punti:
        base = punti[-1].otb_revenue
        forecast_rev = round(base * (1.0 + pickup_rate), 2) if pickup_rate is not None else base

    return PaceChartResponse(
        anno=anno,
        mese=mese,
        mese_label=MESI_IT[mese - 1],
        hotel_code=hotel.code,
        punti=punti,
        budget_revenue=float(budget.budget_revenue) if budget else None,
        forecast_revenue=forecast_rev,
        pickup_rate=pickup_rate,
        maturato_revenue=float(mat.maturato_revenue) if mat else None,
        maturato_al=mat.data_riferimento.isoformat() if mat else None,
    )


# ---------------------------------------------------------------------------
# Endpoint: CRUD maturato
# ---------------------------------------------------------------------------

@router.get(
    "/maturato",
    response_model=List[MaturatRead],
    dependencies=[Depends(richiedi_utente_attivo)],
)
def lista_maturato(
    anno: int = Query(...),
    hotel_code: str = Query(default="all"),
    db: Session = Depends(get_db),
):
    """Lista maturati inseriti per anno (tutti gli hotel o uno specifico)."""
    hotels = _hotels_per_codice(hotel_code, db)
    hotel_ids = [h.id for h in hotels]
    hotel_map = {h.id: h.code for h in hotels}

    rows = (
        db.query(ForecastMaturato)
        .filter(
            ForecastMaturato.hotel_id.in_(hotel_ids),
            ForecastMaturato.anno == anno,
        )
        .order_by(ForecastMaturato.mese)
        .all()
    )

    return [
        MaturatRead(
            id=r.id,
            hotel_code=hotel_map.get(r.hotel_id, "?"),
            anno=r.anno,
            mese=r.mese,
            mese_label=MESI_IT[r.mese - 1],
            data_riferimento=r.data_riferimento.isoformat(),
            maturato_revenue=float(r.maturato_revenue),
            maturato_room_nights=r.maturato_room_nights,
            note=r.note,
            updated_at=r.updated_at.isoformat() if r.updated_at else None,
        )
        for r in rows
    ]


@router.put("/maturato", dependencies=[Depends(richiedi_admin)])
def salva_maturato(payload: MaturatInput, db: Session = Depends(get_db)):
    """Upsert maturato mensile per hotel + anno + mese."""
    hotel = _get_hotel_o_404(payload.hotel_code, db)

    stmt = pg_insert(ForecastMaturato).values(
        hotel_id=hotel.id,
        anno=payload.anno,
        mese=payload.mese,
        data_riferimento=payload.data_riferimento,
        maturato_revenue=round(payload.maturato_revenue, 2),
        maturato_room_nights=payload.maturato_room_nights,
        note=payload.note,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_forecast_maturato_hotel_anno_mese",
        set_={
            "data_riferimento": payload.data_riferimento,
            "maturato_revenue": round(payload.maturato_revenue, 2),
            "maturato_room_nights": payload.maturato_room_nights,
            "note": payload.note,
            "updated_at": func.now(),
        },
    )
    db.execute(stmt)
    db.commit()

    return {
        "ok": True,
        "hotel_code": hotel.code,
        "anno": payload.anno,
        "mese": payload.mese,
        "mese_label": MESI_IT[payload.mese - 1],
        "maturato_revenue": payload.maturato_revenue,
        "data_riferimento": payload.data_riferimento.isoformat(),
    }


@router.delete("/maturato/{id}", dependencies=[Depends(richiedi_admin)])
def elimina_maturato(id: int, db: Session = Depends(get_db)):
    """Elimina un record maturato."""
    riga = db.query(ForecastMaturato).filter(ForecastMaturato.id == id).first()
    if not riga:
        raise HTTPException(status_code=404, detail="Record maturato non trovato")
    db.delete(riga)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Endpoint: upsert budget mensile
# ---------------------------------------------------------------------------

@router.put("/budget", dependencies=[Depends(richiedi_admin)])
def salva_budget(payload: BudgetInput, db: Session = Depends(get_db)):
    """Upsert budget mensile per hotel + anno + mese."""
    hotel = _get_hotel_o_404(payload.hotel_code, db)

    stmt = pg_insert(ForecastBudget).values(
        hotel_id=hotel.id,
        anno=payload.anno,
        mese=payload.mese,
        budget_revenue=round(payload.budget_revenue, 2),
        budget_room_nights=payload.budget_room_nights,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_forecast_budget_hotel_anno_mese",
        set_={
            "budget_revenue": round(payload.budget_revenue, 2),
            "budget_room_nights": payload.budget_room_nights,
            "updated_at": func.now(),
        },
    )
    db.execute(stmt)
    db.commit()

    return {"ok": True, "hotel_code": hotel.code, "anno": payload.anno, "mese": payload.mese}


# ---------------------------------------------------------------------------
# Endpoint: upsert pickup config
# ---------------------------------------------------------------------------

@router.put("/pickup-config", dependencies=[Depends(richiedi_admin)])
def salva_pickup_config(payload: PickupConfigInput, db: Session = Depends(get_db)):
    """Upsert pickup rate mensile per hotel + anno + mese."""
    hotel = _get_hotel_o_404(payload.hotel_code, db)

    stmt = pg_insert(ForecastPickupConfig).values(
        hotel_id=hotel.id,
        anno=payload.anno,
        mese=payload.mese,
        pickup_rate=round(payload.pickup_rate, 4),
        note=payload.note,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_forecast_pickup_hotel_anno_mese",
        set_={
            "pickup_rate": round(payload.pickup_rate, 4),
            "note": payload.note,
        },
    )
    db.execute(stmt)
    db.commit()

    return {
        "ok": True,
        "hotel_code": hotel.code,
        "anno": payload.anno,
        "mese": payload.mese,
        "pickup_rate": payload.pickup_rate,
    }
