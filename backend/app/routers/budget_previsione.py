"""Parametri e correttivi della previsione pickup usata dalla proiezione fine stagione del Budget.

Prefix separato da /budget per non collidere con le rotte /budget/{hotel_code}/{season_year}.

Endpoint:
  GET /budget-previsione/parametri             → valori correnti + default
  PUT /budget-previsione/parametri   (admin)   → salva in app_config (budget_previsione_parametri)
  GET /budget-previsione/correttivi?anno=      → griglia hotel × mesi di stagione
  PUT /budget-previsione/correttivi  (admin)   {hotel_code, season_year, mese, correttivo_pct|null, note}
                                                 mese 0 = stagione; correttivo_pct null = cancella
"""

import json
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import AppConfig, BudgetPrevisioneCorrettivo, Hotel, HotelSeason
from app.services.pickup_forecast import (
    CHIAVE_CONFIG, PARAMETRI_ALGORITMO, PARAMETRI_DEFAULT, leggi_parametri, valida_parametri,
)

router = APIRouter(prefix="/budget-previsione", tags=["budget"])

LIMITI_CORRETTIVO = (-90, 200)


@router.get("/parametri")
def get_parametri(db: Session = Depends(get_db), _=Depends(richiedi_utente_attivo)):
    return {
        'valori': leggi_parametri(db),
        'default': {k: PARAMETRI_DEFAULT[k] for k in PARAMETRI_ALGORITMO},
    }


@router.put("/parametri")
def put_parametri(body: dict, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    try:
        nuovi = {**leggi_parametri(db), **valida_parametri(body)}
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_CONFIG).first()
    if riga is None:
        riga = AppConfig(key=CHIAVE_CONFIG,
                         description="Parametri previsione pickup della proiezione fine stagione Budget")
        db.add(riga)
    riga.value = json.dumps(nuovi)
    db.commit()
    return {'valori': nuovi}


def _mesi_stagione(stagioni: list[HotelSeason]) -> list[int]:
    mesi = set()
    for s in stagioni:
        d = s.open_date.replace(day=1)
        while d <= s.close_date:
            mesi.add(d.month)
            d = (d + timedelta(days=32)).replace(day=1)
    return sorted(mesi) or [5, 6, 7, 8, 9]


@router.get("/correttivi")
def get_correttivi(anno: int = Query(...), db: Session = Depends(get_db), _=Depends(richiedi_utente_attivo)):
    stagioni = db.query(HotelSeason).filter(HotelSeason.season_year == anno).all()
    hotel_ids = {s.hotel_id for s in stagioni}
    hotels = db.query(Hotel).order_by(Hotel.code).all()
    if hotel_ids:
        hotels = [h for h in hotels if h.id in hotel_ids]
    righe = db.query(BudgetPrevisioneCorrettivo).filter(BudgetPrevisioneCorrettivo.season_year == anno).all()
    return {
        'anno': anno,
        'hotel': [{'code': h.code, 'name': h.name} for h in hotels],
        'mesi': _mesi_stagione(stagioni),
        'righe': [{
            'hotel_code': r.hotel_code, 'mese': r.mese,
            'correttivo_pct': float(r.correttivo_pct), 'note': r.note,
            'updated_at': r.updated_at.isoformat() if r.updated_at else None,
        } for r in righe],
    }


class CorrettivoInput(BaseModel):
    hotel_code: str
    season_year: int
    mese: int = 0
    correttivo_pct: Optional[float] = None
    note: Optional[str] = None


@router.put("/correttivi")
def put_correttivo(body: CorrettivoInput, db: Session = Depends(get_db), utente=Depends(richiedi_admin)):
    codice = body.hotel_code.upper()
    if not db.query(Hotel).filter(Hotel.code == codice).first():
        raise HTTPException(status_code=404, detail=f"Hotel '{codice}' non trovato")
    if not 0 <= body.mese <= 12:
        raise HTTPException(status_code=400, detail="Mese da 1 a 12 (0 = intera stagione)")
    riga = db.query(BudgetPrevisioneCorrettivo).filter(
        BudgetPrevisioneCorrettivo.hotel_code == codice,
        BudgetPrevisioneCorrettivo.season_year == body.season_year,
        BudgetPrevisioneCorrettivo.mese == body.mese,
    ).first()
    if body.correttivo_pct is None:
        if riga:
            db.delete(riga)
            db.commit()
        return {'esito': 'cancellato'}
    lo, hi = LIMITI_CORRETTIVO
    if not lo <= body.correttivo_pct <= hi:
        raise HTTPException(status_code=400, detail=f"Correttivo da {lo}% a +{hi}%")
    if riga is None:
        riga = BudgetPrevisioneCorrettivo(hotel_code=codice, season_year=body.season_year, mese=body.mese)
        db.add(riga)
    riga.correttivo_pct = body.correttivo_pct
    riga.note = body.note
    riga.modificato_da = getattr(utente, 'id', None)
    db.commit()
    return {'esito': 'salvato'}
