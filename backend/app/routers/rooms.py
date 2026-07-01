"""Endpoint anagrafica camere.

GET  /rooms/                     — lista camere (filtro per struttura_code)
GET  /rooms/{code}               — dettaglio singola camera
POST /rooms/                     — crea camera (admin)
PUT  /rooms/{code}               — aggiorna camera (admin)
DELETE /rooms/{code}             — elimina camera (admin)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import Hotel
from app.models.rooms import Room

router = APIRouter(prefix="/rooms", tags=["rooms"])


# ---------------------------------------------------------------------------
# Schemi Pydantic
# ---------------------------------------------------------------------------

class RoomOut(BaseModel):
    id: int
    code: str
    hotel_id: int
    struttura_code: str
    tipo_risorsa: Optional[str]
    nome_tipo: Optional[str]
    posti_letto: Optional[int]
    letti_aggiunti: Optional[int]
    piano: Optional[int]
    attiva: bool
    note: Optional[str]

    class Config:
        from_attributes = True


class RoomIn(BaseModel):
    code: str
    struttura_code: str
    tipo_risorsa: Optional[str] = None
    nome_tipo: Optional[str] = None
    posti_letto: Optional[int] = None
    letti_aggiunti: Optional[int] = None
    piano: Optional[int] = None
    attiva: bool = True
    note: Optional[str] = None


class RoomUpdate(BaseModel):
    tipo_risorsa: Optional[str] = None
    nome_tipo: Optional[str] = None
    posti_letto: Optional[int] = None
    letti_aggiunti: Optional[int] = None
    piano: Optional[int] = None
    attiva: Optional[bool] = None
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/", response_model=list[RoomOut])
def lista_camere(
    struttura_code: Optional[str] = Query(None),
    attiva: Optional[bool] = Query(None),
    piano: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: dict = Depends(richiedi_utente_attivo),
):
    """Lista camere con filtri opzionali."""
    q = db.query(Room)
    if struttura_code:
        q = q.filter(Room.struttura_code == struttura_code.upper())
    if attiva is not None:
        q = q.filter(Room.attiva == attiva)
    if piano is not None:
        q = q.filter(Room.piano == piano)
    return q.order_by(Room.struttura_code, Room.piano, Room.code).all()


@router.get("/{code}", response_model=RoomOut)
def dettaglio_camera(
    code: str,
    db: Session = Depends(get_db),
    _: dict = Depends(richiedi_utente_attivo),
):
    room = db.query(Room).filter(Room.code == code.upper()).first()
    if not room:
        raise HTTPException(404, f"Camera '{code}' non trovata")
    return room


@router.post("/", response_model=RoomOut, status_code=201)
def crea_camera(
    body: RoomIn,
    db: Session = Depends(get_db),
    _: dict = Depends(richiedi_admin),
):
    hotel = db.query(Hotel).filter(Hotel.code == body.struttura_code.upper()).first()
    if not hotel:
        raise HTTPException(400, f"Hotel '{body.struttura_code}' non trovato")
    if db.query(Room).filter(Room.code == body.code.upper()).first():
        raise HTTPException(409, f"Camera '{body.code}' già esistente")

    room = Room(
        code=body.code.upper(),
        hotel_id=hotel.id,
        struttura_code=hotel.code,
        tipo_risorsa=body.tipo_risorsa,
        nome_tipo=body.nome_tipo,
        posti_letto=body.posti_letto,
        letti_aggiunti=body.letti_aggiunti,
        piano=body.piano,
        attiva=body.attiva,
        note=body.note,
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


@router.put("/{code}", response_model=RoomOut)
def aggiorna_camera(
    code: str,
    body: RoomUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(richiedi_admin),
):
    room = db.query(Room).filter(Room.code == code.upper()).first()
    if not room:
        raise HTTPException(404, f"Camera '{code}' non trovata")

    for campo, valore in body.model_dump(exclude_unset=True).items():
        setattr(room, campo, valore)
    db.commit()
    db.refresh(room)
    return room


@router.delete("/{code}", status_code=204)
def elimina_camera(
    code: str,
    db: Session = Depends(get_db),
    _: dict = Depends(richiedi_admin),
):
    room = db.query(Room).filter(Room.code == code.upper()).first()
    if not room:
        raise HTTPException(404, f"Camera '{code}' non trovata")
    db.delete(room)
    db.commit()
