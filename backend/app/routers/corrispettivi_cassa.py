"""Sotto-router Corrispettivi — Cassa contante reale di gruppo (corrfix005_2026).

Endpoint (montati sotto /corrispettivi dall'aggregatore corrispettivi.py):
  GET    /cassa/movimenti        → elenco movimenti (saldo iniziale / versamenti / rettifiche)
  POST   /cassa/movimenti        → crea movimento (admin)
  PUT    /cassa/movimenti/{id}   → modifica movimento (admin)
  DELETE /cassa/movimenti/{id}   → elimina movimento (admin)
  GET    /cassa/riepilogo        → saldo progressivo per mese + saldo corrente

Cassa reale = saldo_iniziale + Σ contante incassato − Σ versamenti + Σ rettifiche.
Il "contante incassato" per mese è la riga 'Contante' di `report_tipo_incasso` (nessuna
riaggregazione: resta allineato alla tab Tipo Incasso, MMS/BON e pregresso inclusi).
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import richiedi_admin, richiedi_utente_attivo
from app.models.corrispettivi import CassaMovimento
from app.routers.corrispettivi_shared import _to_float, _d
from app.routers.corrispettivi_report import report_tipo_incasso
from app.utils.locale_it import MESI_IT

router = APIRouter()

TIPI_MOVIMENTO = ('saldo_iniziale', 'versamento', 'rettifica')


def _fmt_movimento(m: CassaMovimento) -> dict:
    return {
        'id': m.id,
        'tipo': m.tipo,
        'data': m.data.isoformat(),
        'importo': _to_float(m.importo),
        'note': m.note,
        'is_test': m.is_test,
        'updated_at': m.updated_at.isoformat() if m.updated_at else None,
    }


def _parse_body(body: dict) -> tuple:
    tipo = str(body.get('tipo', '')).strip()
    if tipo not in TIPI_MOVIMENTO:
        raise HTTPException(status_code=400, detail=f"tipo deve essere uno di: {TIPI_MOVIMENTO}")
    try:
        data_m = date.fromisoformat(str(body.get('data')))
    except ValueError:
        raise HTTPException(status_code=400, detail="data non valida (formato YYYY-MM-DD)")
    if tipo == 'saldo_iniziale':
        # Il saldo iniziale è "al 1° del mese": normalizzo così il riepilogo mensile non
        # deve spezzare un mese a metà.
        data_m = data_m.replace(day=1)
    try:
        importo = round(float(body.get('importo')), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="importo obbligatorio (numero)")
    if tipo in ('saldo_iniziale', 'versamento') and importo < 0:
        raise HTTPException(status_code=400,
                            detail=f"l'importo di un {tipo} non può essere negativo")
    return tipo, data_m, importo, body.get('note')


@router.get("/cassa/movimenti")
def lista_movimenti(
    anno: int = Query(None, ge=2020, le=2035),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    q = db.query(CassaMovimento).filter(CassaMovimento.is_test == is_test)
    if anno:
        q = q.filter(func.extract('year', CassaMovimento.data) == anno)
    # Dal più recente al più vecchio (il frontend riordina comunque, questo è per coerenza).
    movimenti = q.order_by(CassaMovimento.data.desc(), CassaMovimento.id.desc()).all()
    return [_fmt_movimento(m) for m in movimenti]


@router.post("/cassa/movimenti")
def crea_movimento(body: dict, db: Session = Depends(get_db), utente=Depends(richiedi_admin)):
    tipo, data_m, importo, note = _parse_body(body)
    m = CassaMovimento(
        tipo=tipo, data=data_m, importo=_d(importo), note=note,
        is_test=bool(body.get('is_test', False)),
        created_by=utente.id, updated_by=utente.id,
    )
    db.add(m)
    db.commit()
    return _fmt_movimento(m)


@router.put("/cassa/movimenti/{mov_id}")
def modifica_movimento(mov_id: int, body: dict, db: Session = Depends(get_db), utente=Depends(richiedi_admin)):
    m = db.query(CassaMovimento).filter(CassaMovimento.id == mov_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Movimento non trovato")
    tipo, data_m, importo, note = _parse_body({**_fmt_movimento(m), **body})
    m.tipo, m.data, m.importo, m.note = tipo, data_m, _d(importo), note
    m.updated_by = utente.id
    db.commit()
    return _fmt_movimento(m)


@router.delete("/cassa/movimenti/{mov_id}")
def elimina_movimento(mov_id: int, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    m = db.query(CassaMovimento).filter(CassaMovimento.id == mov_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Movimento non trovato")
    db.delete(m)
    db.commit()
    return {'ok': True}


@router.get("/cassa/riepilogo")
def riepilogo_cassa(
    anno: int = Query(..., ge=2020, le=2035),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    """Saldo progressivo della cassa contante di gruppo per l'anno richiesto."""
    ti = report_tipo_incasso(anno=anno, is_test=is_test, db=db, _=None)
    contante_mese = {int(k): float(v) for k, v in (ti.get('per_tipo', {}).get('Contante') or {}).items()}

    movimenti = (
        db.query(CassaMovimento)
        .filter(CassaMovimento.is_test == is_test)
        .order_by(CassaMovimento.data.asc(), CassaMovimento.id.asc())
        .all()
    )

    # Saldo iniziale = il più recente con data <= 31/12 dell'anno richiesto.
    saldi = [m for m in movimenti if m.tipo == 'saldo_iniziale' and m.data.year <= anno]
    saldo_row = max(saldi, key=lambda m: m.data) if saldi else None
    saldo_iniziale = _to_float(saldo_row.importo) if saldo_row else 0.0
    # Da quale mese dell'anno far partire il conteggio (se il saldo è di un anno prima, da gennaio).
    mese_da = saldo_row.data.month if (saldo_row and saldo_row.data.year == anno) else 1

    vers_mese: dict = {}
    rett_mese: dict = {}
    for m in movimenti:
        if m.data.year != anno or m.data.month < mese_da:
            continue
        if m.tipo == 'versamento':
            vers_mese[m.data.month] = round(vers_mese.get(m.data.month, 0.0) + _to_float(m.importo), 2)
        elif m.tipo == 'rettifica':
            rett_mese[m.data.month] = round(rett_mese.get(m.data.month, 0.0) + _to_float(m.importo), 2)

    mesi_attivi = sorted(
        x for x in set(contante_mese) | set(vers_mese) | set(rett_mese) if x >= mese_da
    )

    saldo = saldo_iniziale
    mesi_out = []
    tot_c = tot_v = tot_r = 0.0
    for mm in mesi_attivi:
        c = round(contante_mese.get(mm, 0.0), 2)
        v = round(vers_mese.get(mm, 0.0), 2)
        r = round(rett_mese.get(mm, 0.0), 2)
        saldo = round(saldo + c - v + r, 2)
        tot_c = round(tot_c + c, 2)
        tot_v = round(tot_v + v, 2)
        tot_r = round(tot_r + r, 2)
        mesi_out.append({
            'mese': mm, 'nome_mese': MESI_IT[mm - 1],
            'contante_incassato': c, 'versamenti': v, 'rettifiche': r,
            'saldo_fine_mese': saldo,
        })

    return {
        'anno': anno,
        'saldo_iniziale': (
            {'importo': saldo_iniziale, 'data': saldo_row.data.isoformat(), 'id': saldo_row.id}
            if saldo_row else None
        ),
        'mesi': mesi_out,
        'totali': {'contante_incassato': tot_c, 'versamenti': tot_v, 'rettifiche': tot_r},
        'saldo_corrente': saldo,
    }
