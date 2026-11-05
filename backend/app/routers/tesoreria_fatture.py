"""Tesoreria — fatture elettroniche ricevute (Fase 5, blocco B): import degli ZIP del portale AdE e consultazione.

- POST /fatture/anteprima: lettura dello ZIP (`parse_zip_fatture`), fatture nuove / già presenti (per `idfile`, e per
  partita IVA + numero + data se l'idfile manca o è diverso), errori per file, periodo di ricezione. Lo ZIP e il
  risultato della lettura restano in area temporanea con un token (24h): la conferma non rilegge lo ZIP (fino a 15 s).
- POST /fatture/conferma: inserisce le nuove con righe IVA e rate, ZIP originale in {dir}/fatture/{anno}/, poi
  ricalcola gli abbinamenti con la banca (anche le rate delle fatture non ancora in Passcom).
- GET /fatture/import, GET /fatture/import/{id}/file, DELETE /fatture/import/{id}?conferma=true (toglie le fatture
  che quell'import ha inserito per primo).
- GET /fatture (filtri, stato, paginazione), GET /fatture/{id}, GET /fatture/da-registrare/export.
Pagare a mano e abbinare a mano una rata usano gli endpoint dello scadenzario con la chiave `XML:{impronta}#{rata}`.
"""

import hashlib
import json
import pickle
import re
import shutil
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import User
from app.models.tesoreria import (
    TesoreriaFattura, TesoreriaFatturaIva, TesoreriaFatturaScadenza, TesoreriaFattureImport,
)
from app.routers.corrispettivi_documenti import _risposta_tabella
from app.routers.tesoreria_abbinamenti import _abbinamenti_json, ricalcola_abbinamenti
from app.routers.tesoreria_fatture_stato import stato_fatture
from app.routers.tesoreria_import import _pulisci_anteprime_scadute
from app.routers.tesoreria_shared import (
    cella_data, cella_importo, euro, nome_sicuro, puo_importare, puo_vedere, storage_dir,
)
from app.models.tesoreria import TesoreriaAbbinamento, TesoreriaAbbinamentoScadenza
from app.services.tesoreria_fatture import NOMI_MODALITA, PREFISSO_CHIAVE
from app.services.tesoreria_fatture_parser import parse_zip_fatture
from app.services.tesoreria_parser import ErroreImportTesoreria

router = APIRouter()

MAX_ERRORI_ANTEPRIMA = 200
STATI = ("autofattura", "in_scadenzario", "pagata_banca", "pagata_manuale", "pagata_carta", "da_confermare",
         "da_registrare", "da_verificare", "chiusa")
ETICHETTE_STATO = {
    "autofattura": "Autofattura (solo IVA)", "in_scadenzario": "Nello scadenzario Passcom",
    "pagata_banca": "Pagata in banca", "pagata_manuale": "Segnata pagata a mano", "pagata_carta": "Pagata con carta",
    "da_confermare": "Pagamento da confermare", "da_registrare": "Da registrare",
    "da_verificare": "Da verificare", "chiusa": "Chiusa in contabilità",
}
ORDINAMENTI = {
    "data_ricezione": TesoreriaFattura.data_ricezione, "data_documento": TesoreriaFattura.data_documento,
    "fornitore": TesoreriaFattura.cedente_denominazione, "totale": TesoreriaFattura.totale,
}


# ── Anteprima / conferma ─────────────────────────────────────────────────────────

def _cartella_anteprima(token: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
        raise HTTPException(400, "Token anteprima non valido")
    d = storage_dir() / "_anteprima" / token
    if not (d / "meta.json").exists() or not (d / "lettura.pkl").exists():
        raise HTTPException(410, "Anteprima scaduta o già confermata: ricaricare lo ZIP")
    return d


def _gia_presenti(db: Session, fatture: list) -> tuple:
    """(impronte già in archivio, impronte con stessa partita IVA + numero + data di una fattura già in archivio)."""
    impronte = [f.impronta for f in fatture]
    presenti = set()
    for i in range(0, len(impronte), 1000):
        presenti.update(x for (x,) in db.query(TesoreriaFattura.impronta)
                        .filter(TesoreriaFattura.impronta.in_(impronte[i:i + 1000])))
    documenti = {(p, n, d) for p, n, d in db.query(TesoreriaFattura.cedente_piva, TesoreriaFattura.numero,
                                                   TesoreriaFattura.data_documento)}
    doppie = {f.impronta for f in fatture if f.impronta not in presenti
              and (f.cedente_piva, f.numero, f.data_documento) in documenti}
    return presenti, doppie


def _riepilogo_tipi(fatture: list) -> list:
    tipi = {}
    for f in fatture:
        t = tipi.setdefault(f.tipo_documento, {"tipo_documento": f.tipo_documento, "n": 0, "totale": Decimal("0.00")})
        t["n"] += 1
        t["totale"] += f.totale
    return [{**t, "totale": euro(t["totale"])} for t in sorted(tipi.values(), key=lambda t: -t["n"])]


@router.post("/fatture/anteprima")
async def anteprima(file: UploadFile = File(...), db: Session = Depends(get_db), _=Depends(puo_importare)):
    contenuto = await file.read()
    if not contenuto:
        raise HTTPException(400, "File vuoto")
    try:
        lettura = parse_zip_fatture(contenuto)
    except ErroreImportTesoreria as e:
        raise HTTPException(400, str(e))
    sha = hashlib.sha256(contenuto).hexdigest()
    presenti, doppie = _gia_presenti(db, lettura.fatture)
    nuove = [f for f in lettura.fatture if f.impronta not in presenti and f.impronta not in doppie]
    duplicato = db.query(TesoreriaFattureImport).filter(TesoreriaFattureImport.sha256 == sha).first()

    _pulisci_anteprime_scadute()
    token = uuid.uuid4().hex
    d = storage_dir() / "_anteprima" / token
    d.mkdir(parents=True, exist_ok=True)
    (d / "file.zip").write_bytes(contenuto)
    with open(d / "lettura.pkl", "wb") as fh:            # scritto e riletto solo dal server
        pickle.dump(lettura, fh)
    (d / "meta.json").write_text(json.dumps({"nome_file": nome_sicuro(file.filename), "sha256": sha, "tipo": "fatture"}))
    date_doc = [f.data_documento for f in lettura.fatture]
    return {
        "token": token, "nome_file": file.filename, "n_file": lettura.n_file,
        "n_fatture": len(lettura.fatture), "n_nuove": len(nuove), "n_gia_presenti": len(presenti),
        "n_doppie_documento": len(doppie), "n_errori": len(lettura.errori),
        "errori": [{"file": e.file, "motivo": e.motivo} for e in lettura.errori[:MAX_ERRORI_ANTEPRIMA]],
        "avvisi": lettura.avvisi,
        "ricezione_da": lettura.ricezione_da.isoformat() if lettura.ricezione_da else None,
        "ricezione_a": lettura.ricezione_a.isoformat() if lettura.ricezione_a else None,
        "documento_da": min(date_doc).isoformat() if date_doc else None,
        "documento_a": max(date_doc).isoformat() if date_doc else None,
        "totale_nuove": euro(sum((f.totale for f in nuove), Decimal("0.00"))),
        "per_tipo": _riepilogo_tipi(nuove),
        "gia_importato": ({"id": duplicato.id, "data": duplicato.created_at.isoformat() if duplicato.created_at else None}
                          if duplicato else None),
    }


def _inserisci(db: Session, import_id: int, fatture: list):
    oggetti = []
    for f in fatture:
        o = TesoreriaFattura(
            import_id=import_id, impronta=f.impronta, id_sdi=f.id_sdi, nome_file=f.nome_file,
            data_ricezione=f.data_ricezione, cedente_paese=f.cedente_paese, cedente_piva=f.cedente_piva,
            cedente_cf=f.cedente_cf, cedente_denominazione=f.cedente_denominazione, tipo_documento=f.tipo_documento,
            numero=f.numero, data_documento=f.data_documento, divisa=f.divisa, totale=f.totale,
            totale_calcolato=f.totale_calcolato, imponibile=f.imponibile, imposta=f.imposta, ritenuta=f.ritenuta,
            causale=f.causale, fatture_collegate=f.fatture_collegate or None, n_ddt=f.n_ddt,
            ha_allegati=f.ha_allegati, xml=f.xml,
        )
        db.add(o)
        oggetti.append(o)
    db.flush()
    iva, rate = [], []
    for o, f in zip(oggetti, fatture):
        iva += [{"fattura_id": o.id, "aliquota": r.aliquota, "natura": r.natura, "imponibile": r.imponibile,
                 "imposta": r.imposta, "esigibilita": r.esigibilita, "riferimento_normativo": r.riferimento_normativo}
                for r in f.riepiloghi]
        rate += [{"fattura_id": o.id, "numero_rata": r.numero, "condizioni": r.condizioni, "modalita": r.modalita,
                  "data_scadenza": r.data_scadenza, "importo": r.importo, "iban": r.iban} for r in f.rate]
    db.bulk_insert_mappings(TesoreriaFatturaIva, iva)
    db.bulk_insert_mappings(TesoreriaFatturaScadenza, rate)


@router.post("/fatture/conferma")
def conferma(body: dict = Body(...), db: Session = Depends(get_db), utente=Depends(puo_importare)):
    d = _cartella_anteprima(body.get("token"))
    meta = json.loads((d / "meta.json").read_text())
    if meta.get("tipo") != "fatture":
        raise HTTPException(400, "Il token non è di un'anteprima di fatture")
    with open(d / "lettura.pkl", "rb") as fh:
        lettura = pickle.load(fh)
    duplicato = db.query(TesoreriaFattureImport).filter(TesoreriaFattureImport.sha256 == meta["sha256"]).first()
    if duplicato:
        raise HTTPException(409, f"Questo ZIP è già stato importato (import #{duplicato.id}): nessuna modifica.")
    presenti, doppie = _gia_presenti(db, lettura.fatture)
    nuove = [f for f in lettura.fatture if f.impronta not in presenti and f.impronta not in doppie]
    avvisi = list(lettura.avvisi)
    if doppie:
        avvisi.append(f"{len(doppie)} fatture con stessa partita IVA, numero e data di una già in archivio: saltate.")
    imp = TesoreriaFattureImport(
        nome_file=meta["nome_file"], sha256=meta["sha256"], n_file=lettura.n_file, n_nuove=len(nuove),
        n_presenti=len(presenti) + len(doppie), n_errori=len(lettura.errori),
        ricezione_da=lettura.ricezione_da, ricezione_a=lettura.ricezione_a,
        errori=[{"file": e.file, "motivo": e.motivo} for e in lettura.errori] or None, avvisi=avvisi or None,
        note=(body.get("note") or None), utente_id=getattr(utente, "id", None),
    )
    copiato = None
    try:
        db.add(imp)
        db.flush()
        _inserisci(db, imp.id, nuove)
        anno = (lettura.ricezione_a or date.today()).year
        dest = storage_dir() / "fatture" / str(anno)
        dest.mkdir(parents=True, exist_ok=True)
        copiato = dest / f"{imp.id}_{meta['nome_file']}"
        shutil.copyfile(d / "file.zip", copiato)
        imp.percorso = str(copiato)
        db.flush()
        abbinamenti = ricalcola_abbinamenti(db)     # rate delle fatture non in Passcom cercate in banca
        db.commit()
    except Exception:
        db.rollback()
        if copiato:
            copiato.unlink(missing_ok=True)
        raise
    shutil.rmtree(d, ignore_errors=True)
    return {"import_id": imp.id, "n_nuove": len(nuove), "n_gia_presenti": len(presenti) + len(doppie),
            "n_errori": len(lettura.errori), "abbinamenti": abbinamenti}


@router.get("/fatture/import")
def storico(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    collegate = dict(db.query(TesoreriaFattura.import_id, func.count(TesoreriaFattura.id))
                     .group_by(TesoreriaFattura.import_id).all())
    q = db.query(TesoreriaFattureImport, User.username).outerjoin(User, User.id == TesoreriaFattureImport.utente_id)
    return [
        {"id": i.id, "nome_file": i.nome_file, "ha_file": bool(i.percorso and Path(i.percorso).exists()),
         "n_file": i.n_file, "n_nuove": i.n_nuove, "n_presenti": i.n_presenti, "n_errori": i.n_errori,
         "n_collegate": collegate.get(i.id, 0),
         "ricezione_da": i.ricezione_da.isoformat() if i.ricezione_da else None,
         "ricezione_a": i.ricezione_a.isoformat() if i.ricezione_a else None,
         "errori": i.errori or [], "avvisi": i.avvisi or [], "note": i.note, "utente": username,
         "created_at": i.created_at.isoformat() if i.created_at else None}
        for i, username in q.order_by(TesoreriaFattureImport.id.desc()).all()
    ]


@router.get("/fatture/import/{import_id}/file")
def scarica_zip(import_id: int, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    imp = db.get(TesoreriaFattureImport, import_id)
    if not imp:
        raise HTTPException(404, "Import non trovato")
    if not imp.percorso or not Path(imp.percorso).exists():
        raise HTTPException(404, "File originale non disponibile")
    return FileResponse(imp.percorso, filename=imp.nome_file, media_type="application/zip")


@router.delete("/fatture/import/{import_id}")
def elimina_import(import_id: int, conferma: bool = False, db: Session = Depends(get_db), _=Depends(puo_importare)):
    """Toglie le fatture che l'import ha inserito per primo (righe IVA e rate comprese) e lo ZIP originale.
    Le fatture che un import successivo conteneva ma aveva trovato già presenti spariscono anche loro."""
    imp = db.get(TesoreriaFattureImport, import_id)
    if not imp:
        raise HTTPException(404, "Import non trovato")
    if not conferma:
        raise HTTPException(400, "Eliminazione non confermata: aggiungere ?conferma=true")
    n = db.query(TesoreriaFattura).filter(TesoreriaFattura.import_id == import_id).count()
    percorso = imp.percorso
    db.delete(imp)                                  # CASCADE su fatture, righe IVA e rate
    db.flush()
    ricalcola_abbinamenti(db)
    db.commit()
    if percorso:
        Path(percorso).unlink(missing_ok=True)
    return {"import_id": import_id, "fatture_eliminate": n}


# ── Consultazione ────────────────────────────────────────────────────────────────

def _rata_json(r) -> dict:
    return {"chiave": r.chiave, "numero_rata": r.numero_rata, "data_scadenza": r.data_scadenza.isoformat(),
            "data_stimata": r.data_stimata, "tipo_pagamento": r.tipo_pagamento, "importo": euro(r.importo)}


def _riga_json(r: dict) -> dict:
    f = r["fattura"]
    return {
        "id": f.id, "impronta": f.impronta, "id_sdi": f.id_sdi, "stato": r["stato"],
        "stato_etichetta": ETICHETTE_STATO[r["stato"]],
        "data_ricezione": f.data_ricezione.isoformat() if f.data_ricezione else None,
        "cedente_denominazione": f.cedente_denominazione, "cedente_piva": f.cedente_piva,
        "cedente_paese": f.cedente_paese, "codice_fornitore": r["codice_fornitore"],
        "tipo_documento": f.tipo_documento, "numero": f.numero, "data_documento": f.data_documento.isoformat(),
        "totale": euro(f.totale), "imponibile": euro(f.imponibile), "imposta": euro(f.imposta),
        "ritenuta": euro(f.ritenuta), "da_pagare": euro(r["da_pagare"]),
        "prima_scadenza": min((x.data_scadenza for x in r["rate"]), default=None),
        "rate": [_rata_json(x) for x in r["rate"]],
        "passcom": [{**p, "data_scadenza": p["data_scadenza"].isoformat(), "importo": euro(p["importo"])}
                    for p in r["passcom"]],
    }


def _filtra(righe: list, stato, tipo, q, ricevuta_da, ricevuta_a) -> list:
    testo = (q or "").strip().lower()
    out = []
    for r in righe:
        f = r["fattura"]
        ricevuta = f.data_ricezione.date() if f.data_ricezione else f.data_documento
        if stato and r["stato"] not in stato.split(","):
            continue
        if tipo and f.tipo_documento != tipo:
            continue
        if ricevuta_da and ricevuta < ricevuta_da or ricevuta_a and ricevuta > ricevuta_a:
            continue
        if testo and not any(testo in (x or "").lower() for x in (
                f.cedente_denominazione, f.cedente_piva, f.numero, f.causale, str(f.totale))):
            continue
        out.append(r)
    return out


@router.get("/fatture")
def elenco(
    stato: Optional[str] = None, tipo: Optional[str] = None, q: Optional[str] = None,
    ricevuta_da: Optional[date] = None, ricevuta_a: Optional[date] = None,
    ordina_per: str = Query("data_ricezione", pattern="^(data_ricezione|data_documento|fornitore|totale)$"),
    direzione: str = Query("desc", pattern="^(asc|desc)$"),
    pagina: int = Query(1, ge=1), per_pagina: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db), _=Depends(puo_vedere),
):
    st = stato_fatture(db)
    righe = _filtra(st["righe"], stato, tipo, q, ricevuta_da, ricevuta_a)
    chiave = {
        "data_ricezione": lambda r: (r["fattura"].data_ricezione.date() if r["fattura"].data_ricezione
                                     else r["fattura"].data_documento),
        "data_documento": lambda r: r["fattura"].data_documento,
        "fornitore": lambda r: r["fattura"].cedente_denominazione.lower(),
        "totale": lambda r: r["fattura"].totale,
    }[ordina_per]
    righe.sort(key=chiave, reverse=direzione == "desc")
    inizio = (pagina - 1) * per_pagina
    return {
        "data_fotografia": st["data_fotografia"].isoformat() if st["data_fotografia"] else None,
        "ultima_registrazione": st["ultima_registrazione"].isoformat() if st["ultima_registrazione"] else None,
        "limite_da_registrare": st["limite_da_registrare"].isoformat() if st["limite_da_registrare"] else None,
        "conteggi": {s: {"n": v["n"], "importo": euro(v["importo"]), "etichetta": ETICHETTE_STATO[s]}
                     for s, v in st["conteggi"].items()},
        "totale": len(righe), "pagina": pagina, "per_pagina": per_pagina,
        "fatture": [_riga_json(r) for r in righe[inizio:inizio + per_pagina]],
    }


@router.get("/fatture/da-registrare/export")
def export_da_registrare(formato: str = Query("xlsx", pattern="^(xlsx|csv|pdf)$"),
                         db: Session = Depends(get_db), _=Depends(puo_vedere)):
    """Fatture arrivate allo SDI ma non ancora nello scadenzario Passcom: la lista da mandare allo studio."""
    st = stato_fatture(db)
    righe = sorted((r for r in st["righe"] if r["stato"] in ("da_registrare", "da_verificare")),
                   key=lambda r: (r["stato"] != "da_registrare", r["fattura"].cedente_denominazione.lower(),
                                  r["fattura"].data_documento))
    intestazioni = ["Stato", "Fornitore", "P.IVA", "Tipo", "Numero", "Data doc.", "Ricevuta", "Totale", "Scadenza"]
    corpo = [[ETICHETTE_STATO[r["stato"]], r["fattura"].cedente_denominazione, r["fattura"].cedente_piva or "",
              r["fattura"].tipo_documento, r["fattura"].numero, cella_data(r["fattura"].data_documento),
              cella_data(r["fattura"].data_ricezione.date() if r["fattura"].data_ricezione else None),
              cella_importo(r["fattura"].totale, formato),
              cella_data(min((x.data_scadenza for x in r["rate"]), default=None))] for r in righe]
    corpo.append(["TOTALE", f"{len(righe)} fatture", "", "", "", "", "",
                  cella_importo(sum((r["fattura"].totale for r in righe), Decimal("0.00")), formato), ""])
    foto = st["data_fotografia"].strftime("%d/%m/%Y") if st["data_fotografia"] else "—"
    return _risposta_tabella(
        formato, f"fatture_da_registrare_{date.today().isoformat()}",
        f"Fatture ricevute non presenti nello scadenzario Passcom del {foto}", intestazioni, corpo,
        larghezze_pdf=[10, 26, 10, 5, 11, 8, 8, 9, 8], numeriche_pdf=(7,),
    )


@router.get("/fatture/{fattura_id}")
def dettaglio(fattura_id: int, xml: bool = False, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    f = db.get(TesoreriaFattura, fattura_id)
    if not f:
        raise HTTPException(404, "Fattura non trovata")
    st = stato_fatture(db)
    riga = next(r for r in st["righe"] if r["fattura"].id == fattura_id)
    abbinamenti = db.query(TesoreriaAbbinamento).join(
        TesoreriaAbbinamentoScadenza, TesoreriaAbbinamentoScadenza.abbinamento_id == TesoreriaAbbinamento.id,
    ).filter(TesoreriaAbbinamentoScadenza.chiave.like(f"{PREFISSO_CHIAVE}{f.impronta}#%")).distinct().all()
    out = _riga_json(riga)
    out.update({
        "nome_file": f.nome_file, "causale": f.causale, "fatture_collegate": f.fatture_collegate or [],
        "n_ddt": f.n_ddt, "ha_allegati": f.ha_allegati, "totale_calcolato": f.totale_calcolato,
        "cedente_cf": f.cedente_cf,
        "iva": [{"aliquota": euro(r.aliquota), "natura": r.natura, "imponibile": euro(r.imponibile),
                 "imposta": euro(r.imposta), "esigibilita": r.esigibilita,
                 "riferimento_normativo": r.riferimento_normativo}
                for r in db.query(TesoreriaFatturaIva).filter_by(fattura_id=f.id).order_by(TesoreriaFatturaIva.id)],
        "scadenze_file": [{"numero_rata": r.numero_rata, "condizioni": r.condizioni, "modalita": r.modalita,
                           "modalita_nome": NOMI_MODALITA.get(r.modalita or "", r.modalita),
                           "data_scadenza": r.data_scadenza.isoformat() if r.data_scadenza else None,
                           "importo": euro(r.importo), "iban": r.iban}
                          for r in db.query(TesoreriaFatturaScadenza).filter_by(fattura_id=f.id)
                          .order_by(TesoreriaFatturaScadenza.numero_rata)],
        "abbinamenti": _abbinamenti_json(db, abbinamenti),
    })
    if xml:
        out["xml"] = f.xml
    return out
