"""Endpoint per la gestione del budget settimanale per hotel."""

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import BudgetEntry, Hotel

router = APIRouter(prefix="/budget", tags=["budget"], dependencies=[Depends(richiedi_utente_attivo)])


# ---------------------------------------------------------------------------
# Schemi Pydantic
# ---------------------------------------------------------------------------

class BudgetSettimanaInput(BaseModel):
    week_start: date
    version: str = 'v1'
    rooms_sold_budget: Optional[int] = None
    revenue_rooms_budget: Optional[float] = None
    revenue_fnb_budget: Optional[float] = None
    revenue_extra_budget: Optional[float] = None
    revenue_total_budget: Optional[float] = None
    notes: Optional[str] = None


class BudgetSettimanaOutput(BaseModel):
    id: int
    hotel_id: Optional[int]
    season_year: int
    week_start: date
    version: str
    rooms_sold_budget: Optional[int]
    revenue_rooms_budget: Optional[float]
    revenue_fnb_budget: Optional[float]
    revenue_extra_budget: Optional[float]
    revenue_total_budget: Optional[float]
    notes: Optional[str]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _hotel_id_o_404(hotel_code: str, db: Session) -> int:
    h = db.query(Hotel).filter(Hotel.code == hotel_code.upper()).first()
    if not h:
        raise HTTPException(status_code=404,
                            detail=f"Hotel '{hotel_code}' non trovato nel database")
    return h.id


def _dec_to_float(v) -> Optional[float]:
    """Converte Decimal→float per la serializzazione JSON."""
    return float(v) if isinstance(v, Decimal) else v


def _row_to_output(row: BudgetEntry) -> BudgetSettimanaOutput:
    return BudgetSettimanaOutput(
        id=row.id,
        hotel_id=row.hotel_id,
        season_year=row.season_year,
        week_start=row.week_start,
        version=row.version,
        rooms_sold_budget=row.rooms_sold_budget,
        revenue_rooms_budget=_dec_to_float(row.revenue_rooms_budget),
        revenue_fnb_budget=_dec_to_float(row.revenue_fnb_budget),
        revenue_extra_budget=_dec_to_float(row.revenue_extra_budget),
        revenue_total_budget=_dec_to_float(row.revenue_total_budget),
        notes=row.notes,
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/{hotel_code}/{season_year}", response_model=List[BudgetSettimanaOutput])
def salva_budget(
    hotel_code: str,
    season_year: int,
    settimane: List[BudgetSettimanaInput],
    db: Session = Depends(get_db),
):
    """Inserisce o aggiorna il budget settimanale di un hotel per anno (upsert)."""
    hotel_id = _hotel_id_o_404(hotel_code, db)

    for s in settimane:
        stmt = (
            pg_insert(BudgetEntry)
            .values(
                hotel_id=hotel_id,
                season_year=season_year,
                week_start=s.week_start,
                version=s.version,
                rooms_sold_budget=s.rooms_sold_budget,
                revenue_rooms_budget=s.revenue_rooms_budget,
                revenue_fnb_budget=s.revenue_fnb_budget,
                revenue_extra_budget=s.revenue_extra_budget,
                revenue_total_budget=s.revenue_total_budget,
                notes=s.notes,
            )
            .on_conflict_do_update(
                constraint='uq_budget_hotel_settimana',
                set_={
                    'rooms_sold_budget': s.rooms_sold_budget,
                    'revenue_rooms_budget': s.revenue_rooms_budget,
                    'revenue_fnb_budget': s.revenue_fnb_budget,
                    'revenue_extra_budget': s.revenue_extra_budget,
                    'revenue_total_budget': s.revenue_total_budget,
                    'notes': s.notes,
                },
            )
        )
        db.execute(stmt)

    db.commit()

    rows = (
        db.query(BudgetEntry)
        .filter(BudgetEntry.hotel_id == hotel_id, BudgetEntry.season_year == season_year)
        .order_by(BudgetEntry.week_start)
        .all()
    )
    return [_row_to_output(r) for r in rows]


@router.get("/{hotel_code}/{season_year}", response_model=List[BudgetSettimanaOutput])
def lista_budget(
    hotel_code: str,
    season_year: int,
    db: Session = Depends(get_db),
):
    """Restituisce tutti i budget settimanali di un hotel per anno, ordinati per week_start."""
    hotel_id = _hotel_id_o_404(hotel_code, db)
    rows = (
        db.query(BudgetEntry)
        .filter(BudgetEntry.hotel_id == hotel_id, BudgetEntry.season_year == season_year)
        .order_by(BudgetEntry.week_start)
        .all()
    )
    return [_row_to_output(r) for r in rows]


@router.get("/{hotel_code}/{season_year}/{week_start}", response_model=BudgetSettimanaOutput)
def budget_settimana(
    hotel_code: str,
    season_year: int,
    week_start: date,
    db: Session = Depends(get_db),
):
    """Restituisce il budget di una singola settimana."""
    hotel_id = _hotel_id_o_404(hotel_code, db)
    row = (
        db.query(BudgetEntry)
        .filter(
            BudgetEntry.hotel_id == hotel_id,
            BudgetEntry.season_year == season_year,
            BudgetEntry.week_start == week_start,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Nessun budget per {hotel_code} settimana {week_start}",
        )
    return _row_to_output(row)
