"""Budget dei ristoranti Mare Mosso (clienti esterni) e Buona Onda.

Prefix separato da /budget per non collidere con le rotte /budget/{hotel_code}/{season_year}.

Endpoint:
  GET  /budget-ristoranti/{anno}?version=              → settimane, mesi contabili, totali
  PUT  /budget-ristoranti/{anno}/{week_start}  (admin) {struttura_code, version, importo|null, note?}
                                                         importo null = cancella la riga
  POST /budget-ristoranti/{anno}/precompila    (admin) → budget = consuntivo della settimana −364 gg
  GET  /budget-ristoranti/{anno}/export?formato=       → xlsx|csv|pdf
"""

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import BudgetRistorante
from app.routers.corrispettivi_documenti import _risposta_tabella
from app.routers.tesoreria_shared import cella_data, cella_importo
from app.services.budget_ristoranti import RISTORANTI, consuntivo_settimanale, riepilogo
from app.services.weekly_aggregator import settimana_di
from app.utils.locale_it import MESI_IT

router = APIRouter(prefix="/budget-ristoranti", tags=["budget"])


class BudgetRistoranteInput(BaseModel):
    struttura_code: str
    version: str = 'v1'
    importo: Optional[float] = None
    note: Optional[str] = None


@router.get("/{anno}")
def get_riepilogo(
    anno: int,
    version: str = Query('v1'),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    return riepilogo(anno, version, db)


@router.put("/{anno}/{week_start}")
def salva_settimana(
    anno: int,
    week_start: date,
    body: BudgetRistoranteInput,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    if body.struttura_code not in RISTORANTI:
        raise HTTPException(400, f"Ristorante non valido: {body.struttura_code}")
    if settimana_di(week_start) != week_start or week_start.year != anno:
        raise HTTPException(400, f"{week_start.isoformat()} non è l'inizio di una settimana del {anno}")
    if body.importo is not None and body.importo < 0:
        raise HTTPException(400, "L'importo non può essere negativo")

    riga = db.query(BudgetRistorante).filter_by(
        struttura_code=body.struttura_code, season_year=anno,
        week_start=week_start, version=body.version,
    ).first()
    if body.importo is None:
        if riga:
            db.delete(riga)
            db.commit()
        return {'cancellata': True}
    if not riga:
        riga = BudgetRistorante(struttura_code=body.struttura_code, season_year=anno,
                                week_start=week_start, version=body.version)
        db.add(riga)
    riga.importo = round(body.importo, 2)
    if body.note is not None:
        riga.note = body.note
    riga.updated_by = utente.id
    db.commit()
    return {'cancellata': False, 'importo': float(riga.importo)}


@router.post("/{anno}/precompila")
def precompila(
    anno: int,
    version: str = Query('v1'),
    sovrascrivi: bool = Query(False),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Riempie il budget con l'incasso della settimana corrispondente dell'anno prima (−364 giorni)."""
    offset = timedelta(days=364)
    esistenti = {
        (r.struttura_code, r.week_start): r
        for r in db.query(BudgetRistorante).filter_by(season_year=anno, version=version)
    }
    compilate, saltate = 0, 0
    for (codice, ws_prec), importo in sorted(consuntivo_settimanale(anno - 1, db).items()):
        ws = ws_prec + offset
        if ws.year != anno:
            continue
        riga = esistenti.get((codice, ws))
        if riga and not sovrascrivi:
            saltate += 1
            continue
        if not riga:
            riga = BudgetRistorante(struttura_code=codice, season_year=anno, week_start=ws, version=version)
            db.add(riga)
        riga.importo = round(importo, 2)
        riga.note = f"Da consuntivo {anno - 1} (sett. {ws_prec.strftime('%d/%m/%Y')})"
        riga.updated_by = utente.id
        compilate += 1
    db.commit()
    return {'season_year': anno, 'anno_sorgente': anno - 1, 'version': version,
            'n_compilate': compilate, 'n_saltate': saltate}


@router.get("/{anno}/export")
def export(
    anno: int,
    version: str = Query('v1'),
    formato: str = Query('xlsx', pattern='^(xlsx|csv|pdf)$'),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    dati = riepilogo(anno, version, db)
    intestazioni = ["Settimana", "Mese"]
    for nome in RISTORANTI.values():
        intestazioni += [f"{nome} budget", f"{nome} consuntivo", f"{nome} scostamento"]
    intestazioni += ["Totale budget", "Totale consuntivo"]

    def e(v):
        return cella_importo(v, formato)

    righe = []
    for s in dati['settimane']:
        riga = [cella_data(date.fromisoformat(s['week_start'])), MESI_IT[s['mese']]]
        for c in RISTORANTI:
            riga += [e(s[c]['budget']), e(s[c]['consuntivo']), e(s[c]['scostamento'])]
        celle = [s[c] for c in RISTORANTI]
        riga += [e(sum(x['budget'] or 0 for x in celle)), e(sum(x['consuntivo'] or 0 for x in celle))]
        righe.append(riga)
    riga = ["TOTALE", ""]
    for c in RISTORANTI:
        t = dati['totali'][c]
        riga += [e(t['budget']), e(t['consuntivo']), e(t['scostamento'])]
    t = dati['totali']['totale']
    righe.append(riga + [e(t['budget']), e(t['consuntivo'])])

    titolo = f"Budget ristoranti {anno} — versione {version} (IVA inclusa)"
    return _risposta_tabella(formato, f"Budget_ristoranti_{anno}_{version}", titolo, intestazioni, righe,
                             [10, 9, 10, 10, 10, 10, 10, 10, 10, 10], tuple(range(2, 10)))
