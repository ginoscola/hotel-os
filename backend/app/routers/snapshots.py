"""Endpoint per la lista delle snapshot disponibili per hotel."""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import DailyRevenue, ImportSession
from app.utils.locale_it import formatta_data_it

router = APIRouter(prefix="/snapshots", tags=["snapshots"], dependencies=[Depends(richiedi_utente_attivo)])


class SnapshotItem(BaseModel):
    snapshot_date: date
    label: str              # "5 mag 2026"
    n_anomalie: int = 0     # numero di anomalie registrate nell'import


class ListaSnapshot(BaseModel):
    snapshots: List[SnapshotItem]


@router.get("/{hotel_code}", response_model=ListaSnapshot)
def lista_snapshots(hotel_code: str, db: Session = Depends(get_db)):
    """Lista delle snapshot disponibili per un hotel, dalla più recente."""
    hotel_code = hotel_code.upper()

    # Distinct snapshot_date dalla tabella daily_revenue
    rows = (
        db.execute(
            select(DailyRevenue.snapshot_date)
            .where(DailyRevenue.hotel_code == hotel_code)
            .where(DailyRevenue.snapshot_date.isnot(None))
            .distinct()
            .order_by(DailyRevenue.snapshot_date.desc())
        )
        .scalars()
        .all()
    )

    # Recupera il conteggio anomalie per ogni snapshot dalla tabella imports
    anomalie_per_snap: dict[date, int] = {}
    if rows:
        imp_rows = db.execute(
            select(ImportSession.snapshot_date, ImportSession.anomalie)
            .where(ImportSession.hotel_code == hotel_code)
            .where(ImportSession.snapshot_date.in_(rows))
        ).all()
        for sd, anomalie in imp_rows:
            n = len(anomalie) if isinstance(anomalie, list) else 0
            # somma nel caso ci siano più righe per la stessa snapshot (non dovrebbe accadere)
            anomalie_per_snap[sd] = anomalie_per_snap.get(sd, 0) + n

    return ListaSnapshot(
        snapshots=[
            SnapshotItem(
                snapshot_date=sd,
                label=formatta_data_it(sd),
                n_anomalie=anomalie_per_snap.get(sd, 0),
            )
            for sd in rows
        ]
    )
