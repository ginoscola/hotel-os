"""Router FastAPI per anagrafica hotel e gestione stagioni operative."""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import Hotel, HotelSeason
from app.schemas.revenue import HotelCreate, HotelRead, HotelSeasonCreate, HotelSeasonRead, HotelUpdate

router = APIRouter(prefix="/hotels", tags=["hotels"], dependencies=[Depends(richiedi_utente_attivo)])


def _get_hotel_o_404(hotel_code: str, db: Session) -> Hotel:
    """Restituisce l'hotel o solleva 404."""
    hotel = db.query(Hotel).filter(Hotel.code == hotel_code.upper()).first()
    if not hotel:
        raise HTTPException(
            status_code=404,
            detail=f"Hotel '{hotel_code.upper()}' non trovato nel database",
        )
    return hotel


def _anno_corrente() -> int:
    return date.today().year


# ---------------------------------------------------------------------------
# Endpoint hotel
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[HotelRead])
def lista_hotel(db: Session = Depends(get_db)):
    """
    Restituisce la lista degli hotel con la stagione dell'anno corrente (se configurata).
    """
    anno = _anno_corrente()
    hotels = db.query(Hotel).order_by(Hotel.code).all()

    risultati = []
    for h in hotels:
        stagione = (
            db.query(HotelSeason)
            .filter(HotelSeason.hotel_id == h.id, HotelSeason.season_year == anno)
            .first()
        )
        h_dict = HotelRead.model_validate(h)
        h_dict.stagione_corrente = HotelSeasonRead.model_validate(stagione) if stagione else None
        risultati.append(h_dict)

    return risultati


@router.post("/", response_model=HotelRead, status_code=201, dependencies=[Depends(richiedi_admin)])
def crea_hotel(hotel: HotelCreate, db: Session = Depends(get_db)):
    """Crea un nuovo hotel nel database."""
    codice = hotel.code.upper()
    if db.query(Hotel).filter(Hotel.code == codice).first():
        raise HTTPException(status_code=409, detail=f"Hotel '{codice}' già esistente")
    record = Hotel(code=codice, name=hotel.name, default_rooms=hotel.default_rooms)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.put("/{hotel_code}", response_model=HotelRead, dependencies=[Depends(richiedi_admin)])
def aggiorna_hotel(hotel_code: str, dati: HotelUpdate, db: Session = Depends(get_db)):
    """Aggiorna nome e/o camere di default di un hotel esistente."""
    hotel = _get_hotel_o_404(hotel_code, db)
    if dati.name is not None:
        hotel.name = dati.name
    if dati.default_rooms is not None:
        hotel.default_rooms = dati.default_rooms
    db.commit()
    db.refresh(hotel)
    return hotel


# ---------------------------------------------------------------------------
# Endpoint stagioni
# ---------------------------------------------------------------------------

@router.post("/{hotel_code}/seasons", response_model=HotelSeasonRead, status_code=201, dependencies=[Depends(richiedi_admin)])
def crea_o_aggiorna_stagione(
    hotel_code: str,
    stagione: HotelSeasonCreate,
    db: Session = Depends(get_db),
):
    """
    Crea o aggiorna la stagione operativa per un hotel in un anno specifico.
    Se esiste già una stagione per quell'anno viene sovrascritta.
    """
    hotel = _get_hotel_o_404(hotel_code, db)

    esistente = (
        db.query(HotelSeason)
        .filter(
            HotelSeason.hotel_id == hotel.id,
            HotelSeason.season_year == stagione.season_year,
        )
        .first()
    )

    if esistente:
        esistente.open_date = stagione.open_date
        esistente.close_date = stagione.close_date
        esistente.total_rooms = stagione.total_rooms
        esistente.notes = stagione.notes
        record = esistente
    else:
        record = HotelSeason(
            hotel_id=hotel.id,
            season_year=stagione.season_year,
            open_date=stagione.open_date,
            close_date=stagione.close_date,
            total_rooms=stagione.total_rooms,
            notes=stagione.notes,
        )
        db.add(record)

    db.commit()
    db.refresh(record)
    return record


@router.get("/{hotel_code}/seasons/{year}", response_model=HotelSeasonRead)
def leggi_stagione(
    hotel_code: str,
    year: int,
    db: Session = Depends(get_db),
):
    """Restituisce la stagione operativa di un hotel per l'anno specificato."""
    hotel = _get_hotel_o_404(hotel_code, db)

    stagione = (
        db.query(HotelSeason)
        .filter(HotelSeason.hotel_id == hotel.id, HotelSeason.season_year == year)
        .first()
    )
    if not stagione:
        raise HTTPException(
            status_code=404,
            detail=f"Stagione {year} non configurata per {hotel_code.upper()}",
        )
    return stagione


@router.get("/{hotel_code}/seasons", response_model=List[HotelSeasonRead])
def lista_stagioni(hotel_code: str, db: Session = Depends(get_db)):
    """Restituisce tutte le stagioni configurate per un hotel, ordinate per anno."""
    hotel = _get_hotel_o_404(hotel_code, db)
    return (
        db.query(HotelSeason)
        .filter(HotelSeason.hotel_id == hotel.id)
        .order_by(HotelSeason.season_year)
        .all()
    )


# ---------------------------------------------------------------------------
# Helper interno condiviso con altri router
# ---------------------------------------------------------------------------

def get_stagione_per_anno(hotel_code: str, anno: int, db: Session) -> Optional[HotelSeason]:
    """
    Utility riutilizzabile dagli altri router per recuperare la stagione attiva.
    Restituisce None se non configurata.
    """
    hotel = db.query(Hotel).filter(Hotel.code == hotel_code.upper()).first()
    if not hotel:
        return None
    return (
        db.query(HotelSeason)
        .filter(HotelSeason.hotel_id == hotel.id, HotelSeason.season_year == anno)
        .first()
    )
