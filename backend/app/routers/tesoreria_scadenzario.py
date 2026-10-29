"""Tesoreria — import dello scadenzario fornitori Passcom (Fase 2), a fotografie.

Ogni file caricato è una fotografia delle scadenze aperte a una data (default: la "Data di Stampa" del
file). Più file con la stessa data compongono la stessa fotografia, uno per anno contabile (a cavallo
d'anno); un file con la stessa data e lo stesso anno contabile **sostituisce** il precedente, solo con
`sostituisci: true` (scelta dell'utente: evita doppioni riscaricando il file nello stesso giorno).

- POST /scadenzario/anteprima: parsing + controlli, riepilogo (aperto netto per fornitore, residui),
  confronto con la fotografia precedente dello stesso anno contabile (nuove / chiuse in contabilità).
  File in area temporanea con un token (24h), stessa area degli estratti conto. Nessuna scrittura sul DB.
- POST /scadenzario/conferma: salva fotografia e scadenze, file originale in {dir}/scadenzario/{anno}/.
- GET /scadenzario/import, GET /scadenzario/import/{id}/file, DELETE /scadenzario/import/{id}.
"""

import hashlib
import json
import shutil
import uuid
from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import User
from app.models.tesoreria import TesoreriaScadenza, TesoreriaScadImport
from app.routers.tesoreria_import import _leggi_anteprima, _pulisci_anteprime_scadute
from app.routers.tesoreria_shared import euro, nome_sicuro, puo_importare, puo_vedere, storage_dir
from app.services.tesoreria_parser import ErroreImportTesoreria
from app.services.tesoreria_passcom_parser import parse_scadenzario
from app.services.tesoreria_scadenzario import anno_contabile, confronta, riepilogo

router = APIRouter()

MAX_RIGHE_CONFRONTO = 200          # righe di dettaglio di nuove/chiuse restituite nell'anteprima


def _parse_o_400(contenuto: bytes):
    try:
        return parse_scadenzario(contenuto)
    except ErroreImportTesoreria as e:
        raise HTTPException(400, str(e))


def _data_o_400(valore, ripiego: Optional[date]) -> date:
    if not valore:
        return ripiego or date.today()
    try:
        return date.fromisoformat(str(valore)[:10])
    except ValueError:
        raise HTTPException(400, f"Data della fotografia non valida: {valore!r}")


def _da_sostituire(db: Session, data_foto: date, anno: Optional[int]):
    return db.query(TesoreriaScadImport).filter(
        TesoreriaScadImport.data_fotografia == data_foto, TesoreriaScadImport.anno_contabile == anno,
    ).all()


def _precedente(db: Session, data_foto: date, anno: Optional[int]) -> Optional[TesoreriaScadImport]:
    """Ultimo import dello stesso anno contabile con data anteriore alla fotografia."""
    return db.query(TesoreriaScadImport).filter(
        TesoreriaScadImport.anno_contabile == anno, TesoreriaScadImport.data_fotografia < data_foto,
    ).order_by(TesoreriaScadImport.data_fotografia.desc(), TesoreriaScadImport.id.desc()).first()


def _scadenza_json(s) -> dict:
    return {
        "chiave": s.chiave, "data_scadenza": s.data_scadenza.isoformat(), "tipo_pagamento": s.tipo_pagamento,
        "pareggio": s.pareggio, "tipo_documento": s.tipo_documento, "numero_documento": s.numero_documento,
        "data_documento": s.data_documento.isoformat() if s.data_documento else None,
        "codice_fornitore": s.codice_fornitore, "fornitore": s.fornitore, "importo": euro(s.importo),
        "descrizione": s.descrizione,
    }


def _riepilogo_json(r: dict, max_fornitori: Optional[int] = None) -> dict:
    fornitori = r["fornitori"][:max_fornitori] if max_fornitori else r["fornitori"]
    return {
        **{k: r[k] for k in ("n_scadenze", "n_pareggi", "n_fornitori", "n_fornitori_saldati", "n_residui")},
        "totale": euro(r["totale"]), "aperto": euro(r["aperto"]), "residui": euro(r["residui"]),
        "limite_residui": r["limite_residui"].isoformat(),
        "fornitori": [
            {"codice_fornitore": f["codice_fornitore"], "fornitore": f["fornitore"], "n": f["n"],
             "fatture": euro(f["fatture"]), "pareggi": euro(f["pareggi"]), "netto": euro(f["netto"]),
             "aperto": euro(f["aperto"]), "residui": euro(f["residui"]), "n_residui": f["n_residui"],
             "scadenza_min": f["scadenza_min"].isoformat(), "scadenza_max": f["scadenza_max"].isoformat()}
            for f in fornitori
        ],
    }


def _analizza(db: Session, risultato, data_foto: date, sha: str) -> dict:
    anno = anno_contabile(risultato.scadenze)
    prec = _precedente(db, data_foto, anno)
    confronto = None
    if prec:
        vecchie = db.query(TesoreriaScadenza).filter(TesoreriaScadenza.import_id == prec.id).all()
        c = confronta(vecchie, risultato.scadenze)
        confronto = {
            "import_id": prec.id, "data_fotografia": prec.data_fotografia.isoformat(),
            "n_nuove": len(c["nuove"]), "importo_nuove": euro(c["importo_nuove"]),
            "n_chiuse": len(c["chiuse"]), "importo_chiuse": euro(c["importo_chiuse"]),
            "nuove": [_scadenza_json(s) for s in c["nuove"][:MAX_RIGHE_CONFRONTO]],
            "chiuse": [_scadenza_json(s) for s in c["chiuse"][:MAX_RIGHE_CONFRONTO]],
        }
    duplicato = db.query(TesoreriaScadImport).filter(TesoreriaScadImport.sha256 == sha).first()
    return {
        "anno_contabile": anno,
        "data_fotografia": data_foto.isoformat(),
        "riepilogo": _riepilogo_json(riepilogo(risultato.scadenze, data_foto)),
        "confronto": confronto,
        "sostituisce": [
            {"id": i.id, "nome_file": i.nome_file, "n_righe": i.n_righe, "totale": euro(i.totale),
             "created_at": i.created_at.isoformat() if i.created_at else None}
            for i in _da_sostituire(db, data_foto, anno)
        ],
        "gia_importato": (
            {"id": duplicato.id, "data_fotografia": duplicato.data_fotografia.isoformat()} if duplicato else None
        ),
    }


# ── Endpoint ────────────────────────────────────────────────────────────────────

@router.post("/scadenzario/anteprima")
async def anteprima_scadenzario(
    file: UploadFile = File(...),
    data_fotografia: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    _=Depends(puo_importare),
):
    contenuto = await file.read()
    if not contenuto:
        raise HTTPException(400, "File vuoto")
    risultato = _parse_o_400(contenuto)
    data_foto = _data_o_400(data_fotografia, risultato.data_stampa)
    sha = hashlib.sha256(contenuto).hexdigest()
    analisi = _analizza(db, risultato, data_foto, sha)

    _pulisci_anteprime_scadute()
    token = uuid.uuid4().hex
    d = storage_dir() / "_anteprima" / token
    d.mkdir(parents=True, exist_ok=True)
    (d / "file.xml").write_bytes(contenuto)
    (d / "meta.json").write_text(json.dumps({"nome_file": nome_sicuro(file.filename), "sha256": sha,
                                             "tipo": "scadenzario"}))
    return {
        "token": token, "nome_file": file.filename, "azienda": risultato.azienda,
        "data_stampa": risultato.data_stampa.isoformat() if risultato.data_stampa else None,
        "scadenza_da": risultato.scadenza_da.isoformat() if risultato.scadenza_da else None,
        "scadenza_a": risultato.scadenza_a.isoformat() if risultato.scadenza_a else None,
        "avvisi": risultato.avvisi,
        **analisi,
    }


@router.post("/scadenzario/conferma")
def conferma_scadenzario(
    body: dict = Body(...),
    db: Session = Depends(get_db),
    utente=Depends(puo_importare),
):
    d, meta, contenuto = _leggi_anteprima(body.get("token"))
    if meta.get("tipo") != "scadenzario":
        raise HTTPException(400, "Il token non è di un'anteprima dello scadenzario")
    risultato = _parse_o_400(contenuto)
    data_foto = _data_o_400(body.get("data_fotografia"), risultato.data_stampa)
    anno = anno_contabile(risultato.scadenze)

    duplicato = db.query(TesoreriaScadImport).filter(TesoreriaScadImport.sha256 == meta["sha256"]).first()
    if duplicato:
        raise HTTPException(409, f"Questo file è già stato importato (fotografia del "
                                 f"{duplicato.data_fotografia.strftime('%d/%m/%Y')}): nessuna modifica.")
    vecchi = _da_sostituire(db, data_foto, anno)
    if vecchi and not body.get("sostituisci"):
        raise HTTPException(409, f"Esiste già uno scadenzario del {data_foto.strftime('%d/%m/%Y')} per l'anno "
                                 f"contabile {anno}: confermare la sostituzione.")

    imp = TesoreriaScadImport(
        data_fotografia=data_foto, data_stampa=risultato.data_stampa, anno_contabile=anno,
        nome_file=meta["nome_file"], sha256=meta["sha256"], n_righe=len(risultato.scadenze),
        totale=risultato.totale, scadenza_da=risultato.scadenza_da, scadenza_a=risultato.scadenza_a,
        avvisi=risultato.avvisi or None, note=(body.get("note") or None), utente_id=getattr(utente, "id", None),
    )
    copiato, percorsi_vecchi = None, [v.percorso for v in vecchi if v.percorso]
    try:
        for v in vecchi:
            db.delete(v)                # scadenze in cascata
        db.add(imp)
        db.flush()
        db.bulk_insert_mappings(TesoreriaScadenza, [
            {"import_id": imp.id, "chiave": s.chiave, "data_scadenza": s.data_scadenza,
             "tipo_pagamento": s.tipo_pagamento, "pareggio": s.pareggio, "tipo_documento": s.tipo_documento,
             "registro": s.registro, "numero_documento": s.numero_documento, "data_documento": s.data_documento,
             "data_registrazione": s.data_registrazione, "protocollo": s.protocollo,
             "codice_fornitore": s.codice_fornitore, "fornitore": s.fornitore, "importo": s.importo,
             "descrizione": s.descrizione}
            for s in risultato.scadenze
        ])
        dest = storage_dir() / "scadenzario" / str(data_foto.year)
        dest.mkdir(parents=True, exist_ok=True)
        copiato = dest / f"{imp.id}_{meta['nome_file']}"
        shutil.copyfile(d / "file.xml", copiato)
        imp.percorso = str(copiato)
        db.commit()
    except Exception:
        db.rollback()
        if copiato:
            copiato.unlink(missing_ok=True)
        raise
    for p in percorsi_vecchi:
        Path(p).unlink(missing_ok=True)
    shutil.rmtree(d, ignore_errors=True)
    return {"import_id": imp.id, "data_fotografia": data_foto.isoformat(), "anno_contabile": anno,
            "n_righe": imp.n_righe, "totale": euro(imp.totale), "sostituiti": [v.id for v in vecchi]}


@router.get("/scadenzario/import")
def storico_scadenzario(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    q = db.query(TesoreriaScadImport, User.username).outerjoin(User, User.id == TesoreriaScadImport.utente_id)
    return [
        {"id": i.id, "data_fotografia": i.data_fotografia.isoformat(),
         "data_stampa": i.data_stampa.isoformat() if i.data_stampa else None,
         "anno_contabile": i.anno_contabile, "nome_file": i.nome_file,
         "ha_file": bool(i.percorso and Path(i.percorso).exists()), "n_righe": i.n_righe, "totale": euro(i.totale),
         "scadenza_da": i.scadenza_da.isoformat() if i.scadenza_da else None,
         "scadenza_a": i.scadenza_a.isoformat() if i.scadenza_a else None,
         "avvisi": i.avvisi or [], "note": i.note, "utente": username,
         "created_at": i.created_at.isoformat() if i.created_at else None}
        for i, username in q.order_by(TesoreriaScadImport.data_fotografia.desc(), TesoreriaScadImport.id.desc())
    ]


@router.get("/scadenzario/import/{import_id}/file")
def scarica_scadenzario(import_id: int, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    imp = db.get(TesoreriaScadImport, import_id)
    if not imp:
        raise HTTPException(404, "Import non trovato")
    if not imp.percorso or not Path(imp.percorso).exists():
        raise HTTPException(404, "File originale non disponibile")
    return FileResponse(imp.percorso, filename=imp.nome_file, media_type="application/xml")


@router.delete("/scadenzario/import/{import_id}")
def elimina_scadenzario(import_id: int, conferma: bool = False, db: Session = Depends(get_db),
                        _=Depends(puo_importare)):
    imp = db.get(TesoreriaScadImport, import_id)
    if not imp:
        raise HTTPException(404, "Import non trovato")
    if not conferma:
        raise HTTPException(400, "Eliminazione non confermata: aggiungere ?conferma=true")
    n = db.query(TesoreriaScadenza).filter(TesoreriaScadenza.import_id == import_id).count()
    percorso = imp.percorso
    db.delete(imp)
    db.commit()
    if percorso:
        Path(percorso).unlink(missing_ok=True)
    return {"import_id": import_id, "scadenze_eliminate": n}
