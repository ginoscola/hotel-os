"""Router FastAPI — risposte compatte per gli agenti AI (bot Grok, in futuro Claude).

Ogni endpoint risponde a una domanda ricorrente di un agente in una sola chiamata, con numeri già
calcolati dalle funzioni delle pagine. Solo lettura. Dettagli in docs/moduli/revenue.md.
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import richiedi_utente_attivo
from app.database import get_db
from app.services.agenti_revenue import riepilogo_settimanale

router = APIRouter(prefix="/agenti", tags=["agenti AI"], dependencies=[Depends(richiedi_utente_attivo)])


@router.get("/revenue/settimanale")
def revenue_settimanale(
    snapshot: Optional[date] = Query(None, description="Snapshot da analizzare (default: la più recente)"),
    confronto: Optional[date] = Query(None, description="Snapshot di confronto per il pick-up (default: la precedente)"),
    versione_budget: str = Query('v1', description="Versione del budget"),
    db: Session = Depends(get_db),
):
    """Riepilogo settimanale per il revenue manager: KPI di stagione di gruppo e hotel, pick-up tra due
    snapshot, settimane future, rettifiche sulle settimane passate, WAVE, scostamenti vs budget e vs anno
    precedente (null con motivo se mancano), cancellazioni e note di lettura. Nessuna serie giornaliera."""
    try:
        return riepilogo_settimanale(db, snapshot, confronto, versione_budget)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
