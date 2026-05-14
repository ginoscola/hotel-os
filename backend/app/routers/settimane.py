"""Router FastAPI — lista settimane disponibili per navigazione hotel/gruppo."""

from collections import defaultdict
from datetime import date, timedelta
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import DailyRevenue
from app.schemas.dashboard import ListaSettimane, SettimanNavigazione
from app.services.weekly_aggregator import settimana_di
from app.utils.locale_it import MESI_IT, formatta_data_it

router = APIRouter(prefix="/settimane", tags=["settimane"], dependencies=[Depends(richiedi_utente_attivo)])


def _label_settimana(ws: date, we: date) -> str:
    """Etichetta compatta italiana: '10–16 mag 2026' o '27 mag–2 giu 2026'."""
    if ws.month == we.month and ws.year == we.year:
        return f"{ws.day}–{we.day} {MESI_IT[ws.month - 1]} {ws.year}"
    elif ws.year == we.year:
        return f"{ws.day} {MESI_IT[ws.month - 1]}–{we.day} {MESI_IT[we.month - 1]} {ws.year}"
    return (
        f"{ws.day} {MESI_IT[ws.month - 1]} {ws.year}–"
        f"{we.day} {MESI_IT[we.month - 1]} {we.year}"
    )


def _costruisci_lista(rows: List[Tuple]) -> ListaSettimane:
    """Raggruppa le righe (data, snapshot_date) per settimana commerciale."""
    per_settimana: dict = defaultdict(list)
    for data, snap in rows:
        ws = settimana_di(data)
        per_settimana[ws].append(snap)

    settimane = []
    for ws in sorted(per_settimana.keys(), reverse=True):  # più recente prima
        snaps = [s for s in per_settimana[ws] if s is not None]
        snap_max = max(snaps) if snaps else None
        we = ws + timedelta(days=6)
        settimane.append(
            SettimanNavigazione(
                week_start=ws,
                week_end=we,
                label=_label_settimana(ws, we),
                snapshot_date=snap_max,
                snapshot_label=formatta_data_it(snap_max),
                giorni=len(per_settimana[ws]),
            )
        )
    return ListaSettimane(settimane=settimane)


# Definire /gruppo PRIMA di /{hotel_code} — FastAPI usa l'ordine di definizione
# per risolvere i percorsi ambigui; "gruppo" verrebbe interpretato come hotel_code
# se definito dopo.

@router.get("/gruppo", response_model=ListaSettimane)
def lista_settimane_gruppo(db: Session = Depends(get_db)):
    """Lista di tutte le settimane con dati nel gruppo, dalla più recente."""
    rows = db.execute(
        select(DailyRevenue.data, DailyRevenue.snapshot_date)
        .order_by(DailyRevenue.data)
    ).all()
    return _costruisci_lista(rows)


@router.get("/{hotel_code}", response_model=ListaSettimane)
def lista_settimane_hotel(hotel_code: str, db: Session = Depends(get_db)):
    """Lista di tutte le settimane con dati per un hotel, dalla più recente."""
    rows = db.execute(
        select(DailyRevenue.data, DailyRevenue.snapshot_date)
        .where(DailyRevenue.hotel_code == hotel_code.upper())
        .order_by(DailyRevenue.data)
    ).all()
    return _costruisci_lista(rows)
