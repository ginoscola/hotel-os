"""Router per la gestione dei registratori telematici (RT) condivisi tra hotel.

Prefix: /rt-printers

Endpoint:
  GET    /rt-printers/                    → lista stampanti con hotel associati
  POST   /rt-printers/                    → crea stampante (solo admin)
  PUT    /rt-printers/{id}                → aggiorna nome/ip (solo admin)
  DELETE /rt-printers/{id}                → elimina (solo admin; hotel associati → rt_printer_id=NULL)
  PUT    /rt-printers/hotels/{hotel_code} → associa/disassocia un hotel a una stampante (solo admin)
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import Hotel, RtPrinter

router = APIRouter(prefix="/rt-printers", tags=["rt-printers"])


class RtPrinterCreate(BaseModel):
    nome: str
    ip: str


class RtPrinterUpdate(BaseModel):
    nome: Optional[str] = None
    ip: Optional[str] = None


class AssociaStampante(BaseModel):
    printer_id: Optional[int] = None


def _fmt(p: RtPrinter) -> dict:
    return {
        'id': p.id,
        'nome': p.nome,
        'ip': p.ip,
        'hotels': [h.code for h in p.hotels],
    }


@router.get("/", dependencies=[Depends(richiedi_utente_attivo)])
def lista_stampanti(db: Session = Depends(get_db)) -> List[dict]:
    stampanti = db.query(RtPrinter).order_by(RtPrinter.nome).all()
    return [_fmt(p) for p in stampanti]


@router.post("/", status_code=201, dependencies=[Depends(richiedi_admin)])
def crea_stampante(dati: RtPrinterCreate, db: Session = Depends(get_db)) -> dict:
    if db.query(RtPrinter).filter(RtPrinter.ip == dati.ip).first():
        raise HTTPException(status_code=409, detail=f"Esiste già una stampante con IP '{dati.ip}'")
    record = RtPrinter(nome=dati.nome, ip=dati.ip)
    db.add(record)
    db.commit()
    db.refresh(record)
    return _fmt(record)


@router.put("/{printer_id}", dependencies=[Depends(richiedi_admin)])
def aggiorna_stampante(printer_id: int, dati: RtPrinterUpdate, db: Session = Depends(get_db)) -> dict:
    record = db.query(RtPrinter).filter(RtPrinter.id == printer_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Stampante non trovata")
    if dati.nome is not None:
        record.nome = dati.nome
    if dati.ip is not None:
        record.ip = dati.ip
    db.commit()
    db.refresh(record)
    return _fmt(record)


@router.delete("/{printer_id}", dependencies=[Depends(richiedi_admin)])
def elimina_stampante(printer_id: int, db: Session = Depends(get_db)):
    record = db.query(RtPrinter).filter(RtPrinter.id == printer_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Stampante non trovata")
    db.delete(record)
    db.commit()
    return {"ok": True}


@router.put("/hotels/{hotel_code}", dependencies=[Depends(richiedi_admin)])
def associa_hotel(hotel_code: str, dati: AssociaStampante, db: Session = Depends(get_db)) -> dict:
    hotel = db.query(Hotel).filter(Hotel.code == hotel_code.upper()).first()
    if not hotel:
        raise HTTPException(status_code=404, detail=f"Hotel '{hotel_code.upper()}' non trovato")
    if dati.printer_id is not None and not db.query(RtPrinter).filter(RtPrinter.id == dati.printer_id).first():
        raise HTTPException(status_code=404, detail="Stampante non trovata")
    hotel.rt_printer_id = dati.printer_id
    db.commit()
    return {"ok": True, "hotel_code": hotel.code, "printer_id": hotel.rt_printer_id}
