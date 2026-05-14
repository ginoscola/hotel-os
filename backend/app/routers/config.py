"""Endpoint di sola lettura per la configurazione applicazione."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import AppConfig

router = APIRouter(prefix="/config", tags=["config"], dependencies=[Depends(richiedi_utente_attivo)])


class ConfigItem(BaseModel):
    key: str
    value: str
    description: str | None = None


@router.get("/", response_model=List[ConfigItem])
def lista_config(db: Session = Depends(get_db)):
    """Restituisce tutte le chiavi di configurazione."""
    rows = db.query(AppConfig).order_by(AppConfig.key).all()
    return [ConfigItem(key=r.key, value=r.value, description=r.description) for r in rows]


@router.get("/{key}", response_model=ConfigItem)
def leggi_config(key: str, db: Session = Depends(get_db)):
    """Restituisce il valore di una singola chiave di configurazione."""
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Chiave '{key}' non trovata in app_config")
    return ConfigItem(key=row.key, value=row.value, description=row.description)
