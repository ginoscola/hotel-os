"""Router lookup — endpoint di configurazione condivisi tra tutti i moduli.

Prefix: /lookup

Endpoint:
  GET /lookup/tipi-pagamento   → lista tipi pagamento (attivi o tutti)
  PUT /lookup/tipi-pagamento/{id} → modifica (solo admin)
  POST /lookup/tipi-pagamento     → crea nuovo (solo admin)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import richiedi_admin, richiedi_utente_attivo
from app.models.shared import TipoPagamento

router = APIRouter(prefix="/lookup", tags=["lookup"])


def _fmt(t: TipoPagamento) -> dict:
    return {
        'id': t.id,
        'codice': t.codice,
        'descrizione': t.descrizione,
        'categoria': t.categoria,
        'attivo': t.attivo,
        'ordine': t.ordine,
    }


@router.get("/tipi-pagamento")
def lista_tipi_pagamento(
    solo_attivi: bool = True,
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    """Lista tipi pagamento ordinata per ordine, poi codice."""
    q = db.query(TipoPagamento)
    if solo_attivi:
        q = q.filter(TipoPagamento.attivo == True)
    return [_fmt(t) for t in q.order_by(TipoPagamento.ordine, TipoPagamento.codice).all()]


@router.post("/tipi-pagamento")
def crea_tipo_pagamento(
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(richiedi_admin),
):
    """Crea un nuovo tipo pagamento."""
    codice = (body.get('codice') or '').strip()
    if not codice:
        raise HTTPException(status_code=400, detail="Campo 'codice' obbligatorio")
    if db.query(TipoPagamento).filter(TipoPagamento.codice == codice).first():
        raise HTTPException(status_code=409, detail=f"Codice '{codice}' già esistente")
    t = TipoPagamento(
        codice=codice,
        descrizione=(body.get('descrizione') or codice).strip(),
        categoria=(body.get('categoria') or '').strip(),
        attivo=bool(body.get('attivo', True)),
        ordine=int(body.get('ordine', 0)),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _fmt(t)


@router.put("/tipi-pagamento/{tipo_id}")
def modifica_tipo_pagamento(
    tipo_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(richiedi_admin),
):
    """Aggiorna un tipo pagamento esistente."""
    t = db.query(TipoPagamento).filter(TipoPagamento.id == tipo_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tipo pagamento non trovato")
    for campo in ('descrizione', 'categoria', 'ordine'):
        if campo in body:
            setattr(t, campo, body[campo])
    if 'attivo' in body:
        t.attivo = bool(body['attivo'])
    db.commit()
    db.refresh(t)
    return _fmt(t)
