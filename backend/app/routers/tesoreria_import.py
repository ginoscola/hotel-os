"""Tesoreria — import degli estratti conto bancari (XML CBI), stesso schema di usali_contabile.

- POST /import/anteprima: parsing + controlli, conto riconosciuto dall'IBAN, movimenti nuovi e già
  presenti (impronta), saldi che cambiano, verifica saldi sul conto intero dopo l'import,
  classificazione dei nuovi. File in area temporanea con un token (24h). Nessuna scrittura sul DB.
- POST /import/conferma: inserisce solo i movimenti nuovi (classificati con le regole attive) e
  scrive i saldi del file (la banca prevale anche su un saldo inserito a mano).
- DELETE /import/{id}: toglie i movimenti che quell'import ha inserito per primo e i suoi saldi.
"""

import hashlib
import json
import re
import shutil
import time
import uuid
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import User
from app.models.tesoreria import TesoreriaConto, TesoreriaImport, TesoreriaMovimento, TesoreriaSaldo
from app.routers.tesoreria_abbinamenti import ricalcola_abbinamenti
from app.routers.tesoreria_shared import (
    categoria_automatica, euro, id_ripiego, mappa_categorie, nome_sicuro, puo_importare, puo_vedere,
    regole_attive, ricalcola_categorie, storage_dir,
)
from app.services.tesoreria_parser import ErroreImportTesoreria, parse_estratto_cbi
from app.services.tesoreria_saldi import verifica_saldi

router = APIRouter()

TTL_ANTEPRIMA_SEC = 24 * 3600


def _parse_o_400(contenuto: bytes):
    try:
        return parse_estratto_cbi(contenuto)
    except ErroreImportTesoreria as e:
        raise HTTPException(400, str(e))


def _conto_da_iban(db: Session, iban: str) -> TesoreriaConto:
    conto = db.query(TesoreriaConto).filter(TesoreriaConto.iban == iban).first()
    if conto is None:
        raise HTTPException(
            400, f"Nessun conto con IBAN {iban}: impostarlo in Admin → Tesoreria → Conti prima dell'import"
        )
    if not conto.ha_import:
        raise HTTPException(400, f"Il conto {conto.nome} non è impostato per l'import degli estratti conto")
    return conto


def _pulisci_anteprime_scadute():
    base = storage_dir() / "_anteprima"
    if not base.exists():
        return
    limite = time.time() - TTL_ANTEPRIMA_SEC
    for d in base.iterdir():
        if d.is_dir() and d.stat().st_mtime < limite:
            shutil.rmtree(d, ignore_errors=True)


def _leggi_anteprima(token: str) -> tuple:
    if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
        raise HTTPException(400, "Token anteprima non valido")
    d = storage_dir() / "_anteprima" / token
    meta_path = d / "meta.json"
    if not meta_path.exists():
        raise HTTPException(410, "Anteprima scaduta o già confermata: ricaricare il file")
    return d, json.loads(meta_path.read_text()), (d / "file.xml").read_bytes()


def _import_duplicato(db: Session, conto_id: int, sha: str):
    return db.query(TesoreriaImport).filter_by(conto_id=conto_id, sha256=sha).first()


def _impronte_presenti(db: Session, conto_id: int, impronte: list) -> set:
    presenti = set()
    for i in range(0, len(impronte), 1000):
        blocco = impronte[i:i + 1000]
        presenti.update(
            imp for (imp,) in db.query(TesoreriaMovimento.impronta)
            .filter(TesoreriaMovimento.conto_id == conto_id, TesoreriaMovimento.impronta.in_(blocco))
        )
    return presenti


def _analizza(db: Session, conto: TesoreriaConto, risultato) -> dict:
    """Confronto file ↔ DB: movimenti nuovi, saldi che cambiano, verifica saldi a import fatto."""
    presenti = _impronte_presenti(db, conto.id, [m.impronta for m in risultato.movimenti])
    nuovi = [m for m in risultato.movimenti if m.impronta not in presenti]

    saldi_db = {s.data: s for s in db.query(TesoreriaSaldo).filter(TesoreriaSaldo.conto_id == conto.id)}
    saldi_cambiati = [
        {"data": d.isoformat(), "saldo_attuale": euro(saldi_db[d].saldo), "origine": saldi_db[d].origine,
         "saldo_nuovo": euro(v)}
        for d, v in sorted(risultato.saldi.items()) if d in saldi_db and saldi_db[d].saldo != v
    ]

    # Verifica sul conto intero come sarà dopo l'import
    saldi = {d: s.saldo for d, s in saldi_db.items()}
    saldi.update(risultato.saldi)
    movimenti = [
        (d, imp) for d, imp in db.query(TesoreriaMovimento.data_contabile, TesoreriaMovimento.importo)
        .filter(TesoreriaMovimento.conto_id == conto.id)
    ]
    movimenti += [(m.data_contabile, m.importo) for m in nuovi]
    discrepanze = [
        {"data_da": x.data_da.isoformat(), "data_a": x.data_a.isoformat(), "saldo_da": euro(x.saldo_da),
         "saldo_a": euro(x.saldo_a), "movimenti": euro(x.movimenti), "differenza": euro(x.differenza)}
        for x in verifica_saldi(saldi, movimenti)
    ]
    return {"nuovi": nuovi, "n_gia_presenti": len(risultato.movimenti) - len(nuovi),
            "saldi_cambiati": saldi_cambiati, "discrepanze": discrepanze}


def _riepilogo_categorie(db: Session, nuovi: list) -> list:
    regole, ripiego, categorie = regole_attive(db), id_ripiego(db), mappa_categorie(db)
    gruppi = defaultdict(lambda: [0, Decimal("0.00")])
    for m in nuovi:
        cat_id = categoria_automatica(m.descrizione, m.controparte, m.importo, regole, ripiego)
        gruppi[cat_id][0] += 1
        gruppi[cat_id][1] += m.importo
    out = []
    for cat_id, (n, totale) in gruppi.items():
        cat = categorie.get(cat_id)
        out.append({"categoria_id": cat_id, "codice": cat.codice if cat else None,
                    "nome": cat.nome if cat else "Da classificare", "colore": cat.colore if cat else None,
                    "ordine": cat.ordine if cat else 999, "n": n, "importo": euro(totale)})
    return sorted(out, key=lambda x: x["ordine"])


# ── Endpoint ────────────────────────────────────────────────────────────────────

@router.post("/import/anteprima")
async def anteprima_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(puo_importare),
):
    contenuto = await file.read()
    if not contenuto:
        raise HTTPException(400, "File vuoto")
    risultato = _parse_o_400(contenuto)
    conto = _conto_da_iban(db, risultato.iban)
    analisi = _analizza(db, conto, risultato)

    sha = hashlib.sha256(contenuto).hexdigest()
    duplicato = _import_duplicato(db, conto.id, sha)

    _pulisci_anteprime_scadute()
    token = uuid.uuid4().hex
    d = storage_dir() / "_anteprima" / token
    d.mkdir(parents=True, exist_ok=True)
    (d / "file.xml").write_bytes(contenuto)
    (d / "meta.json").write_text(json.dumps({"nome_file": nome_sicuro(file.filename), "sha256": sha}))

    nuovi = analisi["nuovi"]
    return {
        "token": token,
        "nome_file": file.filename,
        "conto": {"id": conto.id, "codice": conto.codice, "nome": conto.nome},
        "iban": risultato.iban,
        "data_da": risultato.data_da.isoformat() if risultato.data_da else None,
        "data_a": risultato.data_a.isoformat() if risultato.data_a else None,
        "n_movimenti": len(risultato.movimenti),
        "n_nuovi": len(nuovi),
        "n_gia_presenti": analisi["n_gia_presenti"],
        "importo_nuovi": euro(sum((m.importo for m in nuovi), Decimal("0.00"))),
        "n_saldi": len(risultato.saldi),
        "saldo_finale": euro(risultato.saldi[max(risultato.saldi)]) if risultato.saldi else None,
        "saldi_cambiati": analisi["saldi_cambiati"],
        "discrepanze": analisi["discrepanze"],
        "per_categoria": _riepilogo_categorie(db, nuovi),
        "gia_importato": (
            {"id": duplicato.id, "data": duplicato.created_at.isoformat() if duplicato.created_at else None}
            if duplicato else None
        ),
        "avvisi": risultato.avvisi,
    }


@router.post("/import/conferma")
def conferma_import(
    body: dict = Body(...),
    db: Session = Depends(get_db),
    utente=Depends(puo_importare),
):
    d, meta, contenuto = _leggi_anteprima(body.get("token"))
    risultato = _parse_o_400(contenuto)
    conto = _conto_da_iban(db, risultato.iban)

    duplicato = _import_duplicato(db, conto.id, meta["sha256"])
    if duplicato:
        raise HTTPException(409, f"Questo file è già stato importato (import #{duplicato.id}): nessuna modifica.")

    analisi = _analizza(db, conto, risultato)
    nuovi = analisi["nuovi"]
    regole, ripiego = regole_attive(db), id_ripiego(db)
    utente_id = getattr(utente, "id", None)
    imp = TesoreriaImport(
        conto_id=conto.id, nome_file=meta["nome_file"], sha256=meta["sha256"],
        data_da=risultato.data_da, data_a=risultato.data_a,
        n_movimenti=len(risultato.movimenti), n_nuovi=len(nuovi),
        n_gia_presenti=analisi["n_gia_presenti"], n_saldi=len(risultato.saldi),
        avvisi=(risultato.avvisi + [f"{len(analisi['discrepanze'])} discrepanze di saldo"]
                if analisi["discrepanze"] else risultato.avvisi) or None,
        note=(body.get("note") or None), utente_id=utente_id,
    )
    copiato = None
    try:
        db.add(imp)
        db.flush()
        db.bulk_insert_mappings(TesoreriaMovimento, [
            {
                "conto_id": conto.id, "import_id": imp.id,
                "data_contabile": m.data_contabile, "data_valuta": m.data_valuta, "importo": m.importo,
                "descrizione": m.descrizione, "controparte": (m.controparte or None), "causale": (m.causale or None),
                "causale_abi": m.causale_abi, "riferimento_banca": m.riferimento, "impronta": m.impronta,
                "categoria_id": categoria_automatica(m.descrizione, m.controparte, m.importo, regole, ripiego),
            }
            for m in nuovi
        ])

        saldi_db = {s.data: s for s in db.query(TesoreriaSaldo).filter(TesoreriaSaldo.conto_id == conto.id)}
        for giorno, valore in risultato.saldi.items():
            s = saldi_db.get(giorno)
            if s is None:
                db.add(TesoreriaSaldo(conto_id=conto.id, data=giorno, saldo=valore, origine="import",
                                      import_id=imp.id, utente_id=utente_id))
            elif s.saldo != valore or s.origine != "import":
                s.saldo, s.origine, s.import_id, s.utente_id = valore, "import", imp.id, utente_id

        anno = (risultato.data_a or risultato.data_da).year if (risultato.data_a or risultato.data_da) else 0
        dest = storage_dir() / "banca" / str(anno)
        dest.mkdir(parents=True, exist_ok=True)
        copiato = dest / f"{imp.id}_{meta['nome_file']}"
        shutil.copyfile(d / "file.xml", copiato)
        imp.percorso = str(copiato)
        db.flush()
        abbinamenti = ricalcola_abbinamenti(db)     # nuove uscite: scadenze Passcom pagate
        db.commit()
    except Exception:
        db.rollback()
        if copiato:
            copiato.unlink(missing_ok=True)
        raise
    shutil.rmtree(d, ignore_errors=True)

    return {"import_id": imp.id, "conto_id": conto.id, "n_nuovi": len(nuovi),
            "n_gia_presenti": analisi["n_gia_presenti"], "n_saldi": len(risultato.saldi),
            "n_discrepanze": len(analisi["discrepanze"]), "abbinamenti": abbinamenti}


@router.get("/import")
def storico_import(
    conto_id: int = None,
    db: Session = Depends(get_db),
    _=Depends(puo_vedere),
):
    q = db.query(TesoreriaImport, TesoreriaConto, User.username) \
        .join(TesoreriaConto, TesoreriaConto.id == TesoreriaImport.conto_id) \
        .outerjoin(User, User.id == TesoreriaImport.utente_id)
    if conto_id:
        q = q.filter(TesoreriaImport.conto_id == conto_id)
    # Movimenti ancora collegati (= quelli che sparirebbero eliminando l'import)
    collegati = dict(
        db.query(TesoreriaMovimento.import_id, func.count(TesoreriaMovimento.id))
        .filter(TesoreriaMovimento.import_id.isnot(None)).group_by(TesoreriaMovimento.import_id).all()
    )
    return [
        {
            "id": i.id, "conto_id": c.id, "conto_codice": c.codice, "conto_nome": c.nome,
            "nome_file": i.nome_file, "ha_file": bool(i.percorso and Path(i.percorso).exists()),
            "data_da": i.data_da.isoformat() if i.data_da else None,
            "data_a": i.data_a.isoformat() if i.data_a else None,
            "n_movimenti": i.n_movimenti, "n_nuovi": i.n_nuovi, "n_gia_presenti": i.n_gia_presenti,
            "n_saldi": i.n_saldi, "n_collegati": collegati.get(i.id, 0),
            "avvisi": i.avvisi or [], "note": i.note, "utente": username,
            "created_at": i.created_at.isoformat() if i.created_at else None,
        }
        for i, c, username in q.order_by(TesoreriaImport.id.desc()).all()
    ]


@router.get("/import/{import_id}/file")
def scarica_file_originale(import_id: int, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    imp = db.get(TesoreriaImport, import_id)
    if not imp:
        raise HTTPException(404, "Import non trovato")
    if not imp.percorso or not Path(imp.percorso).exists():
        raise HTTPException(404, "File originale non disponibile")
    return FileResponse(imp.percorso, filename=imp.nome_file, media_type="application/xml")


@router.delete("/import/{import_id}")
def elimina_import(
    import_id: int,
    conferma: bool = False,
    db: Session = Depends(get_db),
    _=Depends(puo_importare),
):
    """Elimina un import: i movimenti che ha inserito per primo (anche se un import successivo li
    conteneva: quello li aveva trovati già presenti), i saldi che ha scritto, il file originale."""
    imp = db.get(TesoreriaImport, import_id)
    if not imp:
        raise HTTPException(404, "Import non trovato")
    if not conferma:
        raise HTTPException(400, "Eliminazione non confermata: aggiungere ?conferma=true")
    n_mov = db.query(TesoreriaMovimento).filter(TesoreriaMovimento.import_id == import_id) \
        .delete(synchronize_session=False)
    n_saldi = db.query(TesoreriaSaldo).filter(TesoreriaSaldo.import_id == import_id) \
        .delete(synchronize_session=False)
    percorso = imp.percorso
    db.delete(imp)
    db.flush()
    ricalcola_abbinamenti(db)       # gli abbinamenti con i movimenti eliminati spariscono
    db.commit()
    if percorso:
        Path(percorso).unlink(missing_ok=True)
    return {"import_id": import_id, "movimenti_eliminati": n_mov, "saldi_eliminati": n_saldi}


def riprocessa_movimenti(db: Session) -> dict:
    """Rilegge i file XML originali di tutti gli import e aggiorna controparte e causale dei movimenti
    già presenti (abbinati per conto + impronta), poi riapplica le regole ai movimenti non corretti a
    mano. Non fa commit. Serve quando migliora la lettura dei testi della banca: niente reimport."""
    aggiornati, letti, file_mancanti = 0, set(), []
    per_conto = defaultdict(dict)                     # conto_id → {impronta: (controparte, causale)}
    for imp in db.query(TesoreriaImport).order_by(TesoreriaImport.id):
        if not imp.percorso or not Path(imp.percorso).exists():
            file_mancanti.append(imp.nome_file)
            continue
        risultato = parse_estratto_cbi(Path(imp.percorso).read_bytes())
        for m in risultato.movimenti:
            per_conto[imp.conto_id][m.impronta] = (m.controparte or None, m.causale or None)
    for conto_id, valori in per_conto.items():
        for mov in db.query(TesoreriaMovimento).filter(TesoreriaMovimento.conto_id == conto_id):
            nuovi = valori.get(mov.impronta)
            if nuovi is None:
                continue
            letti.add(mov.id)
            if (mov.controparte, mov.causale) != nuovi:
                mov.controparte, mov.causale = nuovi
                aggiornati += 1
    db.flush()
    n_totale = db.query(func.count(TesoreriaMovimento.id)).scalar()
    return {"n_movimenti": n_totale, "n_riletti": len(letti), "n_aggiornati": aggiornati,
            "n_senza_file": n_totale - len(letti), "file_mancanti": file_mancanti,
            "ricalcolo": ricalcola_categorie(db)}


@router.post("/import/riprocessa")
def riprocessa(db: Session = Depends(get_db), _=Depends(puo_importare)):
    try:
        esito = riprocessa_movimenti(db)
    except ErroreImportTesoreria as e:
        db.rollback()
        raise HTTPException(400, f"Un file originale non si legge più: {e}")
    db.commit()
    return esito
