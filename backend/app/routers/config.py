"""Endpoint di configurazione applicazione."""

import json
import re
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import AppConfig

router = APIRouter(prefix="/config", tags=["config"], dependencies=[Depends(richiedi_utente_attivo)])

_CHIAVE_CC_COLORI = "cc_colori_reparti"
_DEFAULT_CC_COLORI = {"cucina": "#3d8c40", "ristorante": "#3d8c40"}
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


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


# ---------------------------------------------------------------------------
# Libreria colori centri di costo
# ---------------------------------------------------------------------------

@router.get("/cc-colori/mappa")
def get_cc_colori(db: Session = Depends(get_db)):
    """Restituisce la mappa reparto→tinta HSL (0-360) per i colori CC."""
    row = db.query(AppConfig).filter(AppConfig.key == _CHIAVE_CC_COLORI).first()
    if not row:
        return _DEFAULT_CC_COLORI
    try:
        return json.loads(row.value)
    except Exception:
        return _DEFAULT_CC_COLORI


@router.put("/cc-colori/mappa")
def put_cc_colori(
    mappa: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Salva la mappa reparto→colore hex per i colori CC (solo admin)."""
    # Valida che i valori siano colori hex validi (#RRGGBB)
    for nome, colore in mappa.items():
        if not isinstance(colore, str) or not _HEX_RE.match(colore):
            raise HTTPException(400, f"Colore non valido per '{nome}': usa formato #RRGGBB (es. #3d8c40)")
    valore = json.dumps({k.lower().strip(): v.lower() for k, v in mappa.items()})
    row = db.query(AppConfig).filter(AppConfig.key == _CHIAVE_CC_COLORI).first()
    if row:
        row.value = valore
        row.updated_at = datetime.utcnow()
    else:
        db.add(AppConfig(
            key=_CHIAVE_CC_COLORI,
            value=valore,
            description="Mappa nome reparto (lowercase) → colore hex #RRGGBB",
        ))
    db.commit()
    return {"ok": True}
