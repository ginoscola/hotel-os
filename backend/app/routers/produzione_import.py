"""Sotto-router Statistiche Produzione — import StatisticheProduzione.xlsx.

Endpoint (montati sotto /produzione dall'aggregatore produzione.py):
  POST   /import           → upload file Excel
  GET    /import/storico   → storico sessioni import
  DELETE /import/{id}      → elimina import (solo is_test=true)
"""
import os
import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.produzione import ProdImport, ProdRiga
from app.services.prod_parser import parse_xlsx

router = APIRouter()


def _fmt_import(imp: ProdImport) -> dict:
    return {
        'id': imp.id,
        'nome_file': imp.nome_file,
        'data_da': imp.data_da.isoformat() if imp.data_da else None,
        'data_a': imp.data_a.isoformat() if imp.data_a else None,
        'strutture_presenti': imp.strutture_presenti or [],
        'n_righe_totali': imp.n_righe_totali,
        'n_righe_valide': imp.n_righe_valide,
        'n_righe_riassetto': imp.n_righe_riassetto,
        'n_righe_escluse': imp.n_righe_escluse,
        'is_test': imp.is_test,
        'created_at': imp.created_at.isoformat() if imp.created_at else None,
    }


@router.post("/import")
def importa_xlsx(
    file: UploadFile = File(...),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Carica StatisticheProduzione.xlsx e importa tutte le righe analitiche.

    Idempotente: righe già presenti (stessa chiave anti-duplicati) vengono
    saltate con ON CONFLICT DO NOTHING.
    """
    if not file.filename.lower().endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Solo file Excel (.xlsx) accettati")

    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        risultato = parse_xlsx(tmp_path, db)
    except Exception as exc:
        os.unlink(tmp_path)
        raise HTTPException(status_code=422, detail=f"Errore parser: {exc}")
    else:
        os.unlink(tmp_path)

    esistente = db.query(ProdImport).filter(
        ProdImport.nome_file == file.filename,
        ProdImport.data_da == risultato['data_da'],
        ProdImport.data_a == risultato['data_a'],
    ).first()
    if esistente:
        raise HTTPException(
            status_code=409,
            detail=f"Import già presente per il periodo {risultato['data_da']} — {risultato['data_a']} "
                   f"(id={esistente.id}). Eliminare prima l'import esistente.",
        )

    imp = ProdImport(
        nome_file=file.filename,
        data_da=risultato['data_da'],
        data_a=risultato['data_a'],
        strutture_presenti=sorted(risultato['strutture_trovate']),
        n_righe_totali=risultato['n_righe_totali'],
        n_righe_valide=risultato['n_valide'],
        n_righe_riassetto=risultato['n_riassetto'],
        n_righe_escluse=risultato['n_escluse'],
        is_test=is_test,
        imported_by=utente.id,
    )
    db.add(imp)
    db.flush()  # ottiene imp.id

    # Insert in blocchi (non una riga alla volta): un import di un mese intero è ~13.000 righe,
    # 13.000 round-trip singoli al DB causavano timeout lato frontend (30s) — bug reale.
    CHUNK_SIZE = 500
    n_inserite = 0
    try:
        righe = risultato['righe']
        for i in range(0, len(righe), CHUNK_SIZE):
            blocco = righe[i:i + CHUNK_SIZE]
            valori = [dict(import_id=imp.id, is_test=is_test, **riga) for riga in blocco]
            stmt = pg_insert(ProdRiga).values(valori)
            stmt = stmt.on_conflict_do_nothing(constraint='uq_prod_riga_antiduplicati')
            res = db.execute(stmt)
            n_inserite += res.rowcount or 0
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Errore DB: {exc}")

    return {
        'id': imp.id,
        'n_inserite': n_inserite,
        'n_saltate': len(risultato['righe']) - n_inserite,
        'strutture': sorted(risultato['strutture_trovate']),
        'periodo': {
            'da': risultato['data_da'].isoformat(),
            'a': risultato['data_a'].isoformat(),
        },
        'n_righe_riassetto': risultato['n_riassetto'],
        'n_righe_escluse': risultato['n_escluse'],
        'warning': risultato['warning'],
    }


@router.get("/import/storico")
def storico_import(
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    imports = (
        db.query(ProdImport)
        .filter(ProdImport.is_test == is_test)
        .order_by(ProdImport.created_at.desc())
        .all()
    )
    return [_fmt_import(i) for i in imports]


@router.delete("/import/{import_id}")
def elimina_import(
    import_id: int,
    conferma: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_admin),
):
    """Elimina una sessione di import (test o reale) e tutte le righe collegate (CASCADE).

    Stesso comportamento di Corrispettivi: nessuna restrizione a is_test, solo la conferma
    esplicita in query string protegge da cancellazioni accidentali.
    """
    if not conferma:
        raise HTTPException(status_code=400,
                             detail="Aggiungere ?conferma=true per confermare l'eliminazione")

    imp = db.query(ProdImport).filter(ProdImport.id == import_id).first()
    if not imp:
        raise HTTPException(status_code=404, detail="Import non trovato")

    db.delete(imp)  # cascade su prod_righe (ondelete=CASCADE)
    db.commit()
    return {'eliminato': import_id}
