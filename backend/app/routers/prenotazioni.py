"""Cancellazioni reali — import da export Welcome "PrenotazioniWeb".

Complementare alla stima di /forecast/cancellazioni (picco vs attuale sugli snapshot
Revenue): qui il dato è reale, una riga = una camera cancellata, ma limitato a quanto
l'export espone (nessun ID prenotazione interno univoco, nessuna data di cancellazione —
vedi models/prenotazioni.py).
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.prenotazioni import PrenotazioneCancellata, PrenotazioneCancellataImport
from app.services.prenotazioni_parser import parse_csv
from app.utils.locale_it import MESI_IT

router = APIRouter(prefix="/prenotazioni-cancellate", tags=["prenotazioni-cancellate"])


def _fmt_import(imp: PrenotazioneCancellataImport) -> dict:
    return {
        "id": imp.id,
        "nome_file": imp.nome_file,
        "mese": imp.mese,
        "anno": imp.anno,
        "mese_label": MESI_IT[imp.mese - 1],
        "n_righe_totali": imp.n_righe_totali,
        "n_righe_valide": imp.n_righe_valide,
        "n_righe_fuori_mese": imp.n_righe_fuori_mese,
        "is_test": imp.is_test,
        "created_at": imp.created_at.date().isoformat() if imp.created_at else None,
    }


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

@router.post("/import")
def importa_csv(
    mese: int = Query(..., ge=1, le=12, description="Mese di prenotazione dichiarato per questo file"),
    anno: int = Query(...),
    is_test: bool = Query(False),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Il file deve essere un CSV")

    esistente = db.query(PrenotazioneCancellataImport).filter_by(
        mese=mese, anno=anno, nome_file=file.filename,
    ).first()
    if esistente:
        raise HTTPException(
            status_code=409,
            detail=f"Import già presente per {file.filename} (mese {mese:02d}/{anno})",
        )

    raw = file.file.read()
    try:
        risultato = parse_csv(raw, mese_atteso=mese, anno_atteso=anno, data_rilevata=date.today())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    imp = PrenotazioneCancellataImport(
        nome_file=file.filename,
        mese=mese,
        anno=anno,
        n_righe_totali=risultato["n_righe_totali"],
        n_righe_valide=risultato["n_righe_valide"],
        n_righe_fuori_mese=risultato["n_righe_fuori_mese"],
        is_test=is_test,
        imported_by=utente.id if hasattr(utente, "id") else None,
    )
    db.add(imp)
    db.flush()

    CHUNK_SIZE = 500
    n_inserite = 0
    try:
        righe = risultato["righe"]
        for i in range(0, len(righe), CHUNK_SIZE):
            blocco = righe[i:i + CHUNK_SIZE]
            valori = [dict(import_id=imp.id, is_test=is_test, **riga) for riga in blocco]
            stmt = pg_insert(PrenotazioneCancellata).values(valori)
            stmt = stmt.on_conflict_do_nothing(constraint="uq_prenotazione_cancellata_dedup")
            res = db.execute(stmt)
            n_inserite += res.rowcount or 0
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Errore DB: {exc}")

    return {
        "id": imp.id,
        "n_inserite": n_inserite,
        "n_saltate": len(risultato["righe"]) - n_inserite,
        "n_righe_totali": risultato["n_righe_totali"],
        "n_righe_fuori_mese": risultato["n_righe_fuori_mese"],
        "warning": risultato["warning"],
    }


@router.get("/import/storico", dependencies=[Depends(richiedi_utente_attivo)])
def storico_import(is_test: bool = Query(False), db: Session = Depends(get_db)):
    imports = (
        db.query(PrenotazioneCancellataImport)
        .filter(PrenotazioneCancellataImport.is_test == is_test)
        .order_by(PrenotazioneCancellataImport.created_at.desc())
        .all()
    )
    return [_fmt_import(i) for i in imports]


@router.delete("/import/{import_id}", dependencies=[Depends(richiedi_admin)])
def elimina_import(import_id: int, conferma: bool = Query(False), db: Session = Depends(get_db)):
    if not conferma:
        raise HTTPException(status_code=400, detail="Aggiungere ?conferma=true per confermare l'eliminazione")
    imp = db.query(PrenotazioneCancellataImport).filter(PrenotazioneCancellataImport.id == import_id).first()
    if not imp:
        raise HTTPException(status_code=404, detail="Import non trovato")
    db.delete(imp)
    db.commit()
    return {"eliminato": import_id}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def _applica_filtri(query, hotel_code, canale, prenotazione_da, prenotazione_a, arrivo_da, arrivo_a, is_test):
    query = query.filter(PrenotazioneCancellata.is_test == is_test)
    if hotel_code and hotel_code.lower() != "all":
        query = query.filter(PrenotazioneCancellata.hotel_code == hotel_code.upper())
    if canale:
        query = query.filter(PrenotazioneCancellata.canale == canale)
    if prenotazione_da:
        query = query.filter(PrenotazioneCancellata.data_prenotazione >= prenotazione_da)
    if prenotazione_a:
        query = query.filter(PrenotazioneCancellata.data_prenotazione <= prenotazione_a)
    if arrivo_da:
        query = query.filter(PrenotazioneCancellata.arrivo >= arrivo_da)
    if arrivo_a:
        query = query.filter(PrenotazioneCancellata.arrivo <= arrivo_a)
    return query


@router.get("/report", dependencies=[Depends(richiedi_utente_attivo)])
def report(
    anno: int = Query(...),
    hotel_code: str = Query(default="all"),
    canale: Optional[str] = Query(default=None),
    arrivo_da: Optional[date] = Query(default=None),
    arrivo_a: Optional[date] = Query(default=None),
    prenotazione_da: Optional[date] = Query(default=None),
    prenotazione_a: Optional[date] = Query(default=None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Aggregati per mese di prenotazione, per hotel e per canale."""
    base = db.query(PrenotazioneCancellata).filter(
        func.extract("year", PrenotazioneCancellata.data_prenotazione) == anno
    )
    base = _applica_filtri(base, hotel_code, canale, prenotazione_da, prenotazione_a, arrivo_da, arrivo_a, is_test)
    righe = base.all()

    per_mese = {m: {"n": 0, "importo": 0.0} for m in range(1, 13)}
    per_mese_arrivo = {m: {"n": 0, "importo": 0.0} for m in range(1, 13)}
    per_hotel: dict = {}
    per_canale: dict = {}

    for r in righe:
        m = r.data_prenotazione.month
        per_mese[m]["n"] += 1
        per_mese[m]["importo"] += r.importo

        ma = r.arrivo.month
        per_mese_arrivo[ma]["n"] += 1
        per_mese_arrivo[ma]["importo"] += r.importo

        per_hotel.setdefault(r.hotel_code, {"n": 0, "importo": 0.0})
        per_hotel[r.hotel_code]["n"] += 1
        per_hotel[r.hotel_code]["importo"] += r.importo

        per_canale.setdefault(r.canale, {"n": 0, "importo": 0.0})
        per_canale[r.canale]["n"] += 1
        per_canale[r.canale]["importo"] += r.importo

    return {
        "anno": anno,
        "hotel_code": hotel_code,
        "totale_n": len(righe),
        "totale_importo": round(sum(r.importo for r in righe), 2),
        "per_mese": [
            {"mese": m, "mese_label": MESI_IT[m - 1], "n": d["n"], "importo": round(d["importo"], 2)}
            for m, d in per_mese.items()
        ],
        "per_mese_arrivo": [
            {"mese": m, "mese_label": MESI_IT[m - 1], "n": d["n"], "importo": round(d["importo"], 2)}
            for m, d in per_mese_arrivo.items()
        ],
        "per_hotel": [
            {"hotel_code": h, "n": d["n"], "importo": round(d["importo"], 2)}
            for h, d in per_hotel.items()
        ],
        "per_canale": [
            {"canale": c, "n": d["n"], "importo": round(d["importo"], 2)}
            for c, d in sorted(per_canale.items(), key=lambda x: -x[1]["importo"])
        ],
    }


@router.get("/", dependencies=[Depends(richiedi_utente_attivo)])
def lista_righe(
    anno: int = Query(...),
    hotel_code: str = Query(default="all"),
    canale: Optional[str] = Query(default=None),
    arrivo_da: Optional[date] = Query(default=None),
    arrivo_a: Optional[date] = Query(default=None),
    prenotazione_da: Optional[date] = Query(default=None),
    prenotazione_a: Optional[date] = Query(default=None),
    is_test: bool = Query(False),
    pagina: int = Query(1, ge=1),
    per_pagina: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(PrenotazioneCancellata).filter(
        func.extract("year", PrenotazioneCancellata.data_prenotazione) == anno
    )
    query = _applica_filtri(query, hotel_code, canale, prenotazione_da, prenotazione_a, arrivo_da, arrivo_a, is_test)
    totale = query.count()
    righe = (
        query.order_by(PrenotazioneCancellata.data_prenotazione.desc())
        .offset((pagina - 1) * per_pagina)
        .limit(per_pagina)
        .all()
    )
    return {
        "totale": totale,
        "pagina": pagina,
        "per_pagina": per_pagina,
        "righe": [
            {
                "id": r.id,
                "hotel_code": r.hotel_code,
                "canale": r.canale,
                "canale_vendita": r.canale_vendita,
                "codice_ota": r.codice_ota,
                "numero_prenotazione": r.numero_prenotazione,
                "data_cancellazione": r.data_cancellazione.isoformat() if r.data_cancellazione else None,
                "data_rilevata": r.data_rilevata.isoformat(),
                "data_prenotazione": r.data_prenotazione.isoformat(),
                "arrivo": r.arrivo.isoformat(),
                "partenza": r.partenza.isoformat(),
                "notti": r.notti,
                "pax": r.pax,
                "cliente": r.cliente,
                "tipo_camera": r.tipo_camera,
                "trattamento": r.trattamento,
                "importo": r.importo,
            }
            for r in righe
        ],
    }


# ---------------------------------------------------------------------------
# Admin — dati di test
# ---------------------------------------------------------------------------

@router.get("/admin/test-stats", dependencies=[Depends(richiedi_admin)])
def test_stats(db: Session = Depends(get_db)):
    n_import = db.query(PrenotazioneCancellataImport).filter(
        PrenotazioneCancellataImport.is_test == True  # noqa: E712
    ).count()
    n_righe = db.query(PrenotazioneCancellata).filter(
        PrenotazioneCancellata.is_test == True  # noqa: E712
    ).count()
    return {"imports": n_import, "righe": n_righe}


@router.delete("/admin/test-data", dependencies=[Depends(richiedi_admin)])
def elimina_test_data(db: Session = Depends(get_db)):
    imports = db.query(PrenotazioneCancellataImport).filter(
        PrenotazioneCancellataImport.is_test == True  # noqa: E712
    ).all()
    n = len(imports)
    for imp in imports:
        db.delete(imp)
    db.commit()
    return {"ok": True, "eliminati": n}
