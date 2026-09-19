"""Cancellazioni — import da export Welcome ("Elenco Prenotazioni" o, in formato legacy,
"PrenotazioniWeb").

Dato reale, una riga = una camera cancellata (a differenza di una stima derivata dagli
snapshot Revenue, rimossa dopo il confronto con questo dato reale — vedi CLAUDE.md).
Per "PrenotazioniWeb" limitato a quanto l'export espone (nessun ID prenotazione interno
univoco, nessuna data di cancellazione — vedi models/prenotazioni.py).
"""

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import String, cast, func, or_, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.prenotazioni import PrenotazioneCancellata, PrenotazioneCancellataImport
from app.services.prenotazioni_parser import parse_csv
from app.utils.locale_it import MESI_IT

router = APIRouter(prefix="/prenotazioni-cancellate", tags=["prenotazioni-cancellate"])

# La stagione operativa va maggio-settembre (vedi hotel_seasons): le prenotazioni fatte a
# ottobre/novembre/dicembre sono quasi sempre per la stagione SUCCESSIVA (chi prenota con largo
# anticipo), non un residuo della stagione appena finita. I grafici "per mese di prenotazione"
# vanno quindi letti come anno commerciale ott→set, non come anno solare gen→dic.
_MESI_ORDINE_COMMERCIALE = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]


def _fmt_import(imp: PrenotazioneCancellataImport) -> dict:
    return {
        "id": imp.id,
        "nome_file": imp.nome_file,
        "mese": imp.mese,
        "anno": imp.anno,
        "mese_label": MESI_IT[imp.mese - 1] if imp.mese else "Intera stagione",
        "n_righe_totali": imp.n_righe_totali,
        "n_righe_valide": imp.n_righe_valide,
        "n_righe_fuori_mese": imp.n_righe_fuori_mese,
        "is_test": imp.is_test,
        "created_at": imp.created_at.date().isoformat() if imp.created_at else None,
    }


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

# Campi aggiornati su una prenotazione già presente quando on_conflict=aggiorna — esclude
# gli 3 campi identità (hotel_code, numero_prenotazione, tipo_camera, già uguali per costruzione,
# vedi _identita_riga) e data_rilevata (resta la data della prima osservazione, non quella del
# reimport).
_CAMPI_AGGIORNABILI = [
    "canale", "canale_vendita", "codice_ota", "data_cancellazione", "data_prenotazione",
    "arrivo", "partenza", "notti", "pax", "cliente", "email", "trattamento", "mercato", "importo",
]


def _identita_riga(r: dict):
    return (r["hotel_code"], r["numero_prenotazione"], r["tipo_camera"])


@router.post("/import")
def importa_csv(
    mese: Optional[int] = Query(
        default=None, ge=1, le=12,
        description="Mese di prenotazione dichiarato per questo file — solo etichetta per 'Elenco "
        "Prenotazioni' (le date reali sono lette riga per riga); omesso = import di più mesi/intera "
        "stagione in un colpo solo",
    ),
    anno: int = Query(...),
    is_test: bool = Query(False),
    on_conflict: str = Query(
        "salta", pattern="^(salta|aggiorna)$",
        description="'aggiorna' sovrascrive le prenotazioni già presenti ma MAI modificate a mano "
        "(vedi modificato_manualmente); 'salta' (default) non tocca nulla di già presente",
    ),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    if not file.filename.lower().endswith((".csv", ".xlsx")):
        raise HTTPException(status_code=422, detail="Il file deve essere un CSV o un XLSX")

    esistente = db.query(PrenotazioneCancellataImport).filter_by(
        mese=mese, anno=anno, nome_file=file.filename,
    ).first()
    if esistente:
        label = f"mese {mese:02d}/{anno}" if mese else f"intera stagione {anno}"
        raise HTTPException(
            status_code=409,
            detail=f"Import già presente per {file.filename} ({label})",
        )

    raw = file.file.read()
    try:
        risultato = parse_csv(
            raw, mese_atteso=mese or 0, anno_atteso=anno, data_rilevata=date.today(),
        )
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

    righe = risultato["righe"]
    # Solo le righe con un ID prenotazione nativo (formato "Elenco Prenotazioni") possono essere
    # riconosciute come "la stessa prenotazione già presente" tra import diversi — il vecchio
    # formato "PrenotazioniWeb" non ha un ID affidabile e resta sul comportamento storico
    # (inserimento diretto, scarto silenzioso solo se identica su tutti i campi della UNIQUE).
    con_identita = [r for r in righe if r.get("numero_prenotazione")]
    senza_identita = [r for r in righe if not r.get("numero_prenotazione")]

    esistenti = {}
    chiavi = {_identita_riga(r) for r in con_identita}
    if chiavi:
        for row in db.query(PrenotazioneCancellata).filter(
            PrenotazioneCancellata.is_test == is_test,
            tuple_(
                PrenotazioneCancellata.hotel_code,
                PrenotazioneCancellata.numero_prenotazione,
                PrenotazioneCancellata.tipo_camera,
            ).in_(chiavi),
        ):
            esistenti[(row.hotel_code, row.numero_prenotazione, row.tipo_camera)] = row

    da_inserire = list(senza_identita)
    da_aggiornare = []
    messaggi_bloccate = []
    n_saltate_esistenti = 0

    for r in con_identita:
        riga_esistente = esistenti.get(_identita_riga(r))
        if riga_esistente is None:
            da_inserire.append(r)
        elif riga_esistente.modificato_manualmente:
            messaggi_bloccate.append(
                f"La prenotazione {r['numero_prenotazione']} ({r['tipo_camera']}, {r['hotel_code']}) "
                "non è stata inserita perché è già presente ed è stata modificata manualmente."
            )
        elif on_conflict == "aggiorna":
            da_aggiornare.append((riga_esistente, r))
        else:
            n_saltate_esistenti += 1

    CHUNK_SIZE = 500
    n_inserite = 0
    n_aggiornate = 0
    try:
        for i in range(0, len(da_inserire), CHUNK_SIZE):
            blocco = da_inserire[i:i + CHUNK_SIZE]
            valori = [dict(import_id=imp.id, is_test=is_test, **riga) for riga in blocco]
            stmt = pg_insert(PrenotazioneCancellata).values(valori)
            stmt = stmt.on_conflict_do_nothing(constraint="uq_prenotazione_cancellata_dedup")
            res = db.execute(stmt)
            n_inserite += res.rowcount or 0

        for riga_esistente, nuovi_valori in da_aggiornare:
            for campo in _CAMPI_AGGIORNABILI:
                setattr(riga_esistente, campo, nuovi_valori[campo])
            riga_esistente.import_id = imp.id
            n_aggiornate += 1

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Errore DB: {exc}")

    return {
        "id": imp.id,
        "n_inserite": n_inserite,
        "n_aggiornate": n_aggiornate,
        "n_saltate": (len(da_inserire) - n_inserite) + n_saltate_esistenti,
        "n_bloccate_modificate": len(messaggi_bloccate),
        "messaggi_bloccate": messaggi_bloccate,
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

def _applica_filtri(query, hotel_code, canali, prenotazione_da, prenotazione_a, arrivo_da, arrivo_a, is_test):
    query = query.filter(PrenotazioneCancellata.is_test == is_test)
    if hotel_code and hotel_code.lower() != "all":
        query = query.filter(PrenotazioneCancellata.hotel_code == hotel_code.upper())
    if canali:
        query = query.filter(PrenotazioneCancellata.canale.in_(canali))
    if prenotazione_da:
        query = query.filter(PrenotazioneCancellata.data_prenotazione >= prenotazione_da)
    if prenotazione_a:
        query = query.filter(PrenotazioneCancellata.data_prenotazione <= prenotazione_a)
    if arrivo_da:
        query = query.filter(PrenotazioneCancellata.arrivo >= arrivo_da)
    if arrivo_a:
        query = query.filter(PrenotazioneCancellata.arrivo <= arrivo_a)
    return query


def _parse_canali(canali: Optional[str]) -> Optional[list]:
    """'Booking.com,Sito Diretto' -> ['Booking.com', 'Sito Diretto'] — stringa comma-separated
    invece di un query param ripetuto, per non dipendere da come axios serializza gli array."""
    if not canali:
        return None
    valori = [c.strip() for c in canali.split(",") if c.strip()]
    return valori or None


def _applica_ricerca(query, q: Optional[str]):
    """Ricerca libera su tutti i campi mostrati in tabella — testuali via ILIKE diretto,
    numerici/data castati a testo per poter cercare anche importi ("540") o date ("2026-07")."""
    if not q:
        return query
    pattern = f"%{q}%"
    campi = [
        PrenotazioneCancellata.hotel_code,
        PrenotazioneCancellata.canale,
        PrenotazioneCancellata.canale_vendita,
        PrenotazioneCancellata.codice_ota,
        PrenotazioneCancellata.numero_prenotazione,
        PrenotazioneCancellata.cliente,
        PrenotazioneCancellata.email,
        PrenotazioneCancellata.tipo_camera,
        PrenotazioneCancellata.trattamento,
        PrenotazioneCancellata.mercato,
        cast(PrenotazioneCancellata.importo, String),
        cast(PrenotazioneCancellata.pax, String),
        cast(PrenotazioneCancellata.notti, String),
        cast(PrenotazioneCancellata.data_prenotazione, String),
        cast(PrenotazioneCancellata.arrivo, String),
        cast(PrenotazioneCancellata.partenza, String),
        cast(PrenotazioneCancellata.data_cancellazione, String),
    ]
    return query.filter(or_(*(c.ilike(pattern) for c in campi)))


_COLONNE_ORDINABILI = {
    "hotel_code": PrenotazioneCancellata.hotel_code,
    "canale": PrenotazioneCancellata.canale,
    "numero_prenotazione": PrenotazioneCancellata.numero_prenotazione,
    "data_prenotazione": PrenotazioneCancellata.data_prenotazione,
    "data_cancellazione": PrenotazioneCancellata.data_cancellazione,
    "arrivo": PrenotazioneCancellata.arrivo,
    "partenza": PrenotazioneCancellata.partenza,
    "cliente": PrenotazioneCancellata.cliente,
    "tipo_camera": PrenotazioneCancellata.tipo_camera,
    "importo": PrenotazioneCancellata.importo,
}


def _fmt_riga(r: PrenotazioneCancellata) -> dict:
    return {
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
        "email": r.email,
        "tipo_camera": r.tipo_camera,
        "trattamento": r.trattamento,
        "mercato": r.mercato,
        "importo": r.importo,
        "modificato_manualmente": r.modificato_manualmente,
    }


@router.get("/report", dependencies=[Depends(richiedi_utente_attivo)])
def report(
    anno: int = Query(...),
    hotel_code: str = Query(default="all"),
    canali: Optional[str] = Query(default=None, description="Canali separati da virgola"),
    arrivo_da: Optional[date] = Query(default=None),
    arrivo_a: Optional[date] = Query(default=None),
    prenotazione_da: Optional[date] = Query(default=None),
    prenotazione_a: Optional[date] = Query(default=None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Aggregati per mese di prenotazione, per hotel e per canale."""
    base = db.query(PrenotazioneCancellata).filter(
        func.extract("year", PrenotazioneCancellata.arrivo) == anno
    )
    base = _applica_filtri(base, hotel_code, _parse_canali(canali), prenotazione_da, prenotazione_a, arrivo_da, arrivo_a, is_test)
    righe = base.all()

    per_mese = {m: {"n": 0, "importo": 0.0} for m in range(1, 13)}
    per_mese_arrivo = {m: {"n": 0, "importo": 0.0} for m in range(1, 13)}
    per_hotel: dict = {}
    per_canale: dict = {}

    # Range giornaliero costruito sull'effettivo minimo/massimo tra le righe filtrate (non su
    # tutto l'anno solare): così restringere i filtri data (arrivo/prenotazione) restringe da sé
    # anche la vista "Giornaliero", coerente con l'idea di poter analizzare periodi più brevi
    # senza dover introdurre un filtro separato solo per il grafico.
    per_giorno = {}
    if righe:
        date_pren = [r.data_prenotazione for r in righe]
        d, fine = min(date_pren), max(date_pren)
        while d <= fine:
            per_giorno[d] = {"n": 0, "importo": 0.0}
            d += timedelta(days=1)
    per_giorno_arrivo = {}
    if righe:
        date_arr = [r.arrivo for r in righe]
        d, fine = min(date_arr), max(date_arr)
        while d <= fine:
            per_giorno_arrivo[d] = {"n": 0, "importo": 0.0}
            d += timedelta(days=1)

    for r in righe:
        m = r.data_prenotazione.month
        per_mese[m]["n"] += 1
        per_mese[m]["importo"] += r.importo

        ma = r.arrivo.month
        per_mese_arrivo[ma]["n"] += 1
        per_mese_arrivo[ma]["importo"] += r.importo

        per_giorno[r.data_prenotazione]["n"] += 1
        per_giorno[r.data_prenotazione]["importo"] += r.importo

        per_giorno_arrivo[r.arrivo]["n"] += 1
        per_giorno_arrivo[r.arrivo]["importo"] += r.importo

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
            {"mese": m, "mese_label": MESI_IT[m - 1], "n": per_mese[m]["n"], "importo": round(per_mese[m]["importo"], 2)}
            for m in _MESI_ORDINE_COMMERCIALE
        ],
        "per_mese_arrivo": [
            {"mese": m, "mese_label": MESI_IT[m - 1], "n": per_mese_arrivo[m]["n"], "importo": round(per_mese_arrivo[m]["importo"], 2)}
            for m in _MESI_ORDINE_COMMERCIALE
        ],
        "per_giorno": [
            {"data": d.isoformat(), "n": v["n"], "importo": round(v["importo"], 2)}
            for d, v in sorted(per_giorno.items())
        ],
        "per_giorno_arrivo": [
            {"data": d.isoformat(), "n": v["n"], "importo": round(v["importo"], 2)}
            for d, v in sorted(per_giorno_arrivo.items())
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


@router.get("/canali", dependencies=[Depends(richiedi_utente_attivo)])
def lista_canali(
    anno: int = Query(...),
    hotel_code: str = Query(default="all"),
    arrivo_da: Optional[date] = Query(default=None),
    arrivo_a: Optional[date] = Query(default=None),
    prenotazione_da: Optional[date] = Query(default=None),
    prenotazione_a: Optional[date] = Query(default=None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Elenco canali distinti per popolare le checkbox di filtro — NON filtrato per canale
    (altrimenti la lista si restringerebbe da sola man mano che se ne selezionano)."""
    query = db.query(PrenotazioneCancellata.canale).filter(
        func.extract("year", PrenotazioneCancellata.arrivo) == anno
    )
    query = _applica_filtri(query, hotel_code, None, prenotazione_da, prenotazione_a, arrivo_da, arrivo_a, is_test)
    canali = sorted({c for (c,) in query.distinct().all()})
    return {"canali": canali}


@router.get("/", dependencies=[Depends(richiedi_utente_attivo)])
def lista_righe(
    anno: int = Query(...),
    hotel_code: str = Query(default="all"),
    canali: Optional[str] = Query(default=None, description="Canali separati da virgola"),
    arrivo_da: Optional[date] = Query(default=None),
    arrivo_a: Optional[date] = Query(default=None),
    prenotazione_da: Optional[date] = Query(default=None),
    prenotazione_a: Optional[date] = Query(default=None),
    q: Optional[str] = Query(default=None, description="Ricerca libera su tutti i campi della tabella"),
    ordina_per: str = Query(default="data_prenotazione", description="Colonna di ordinamento (click intestazione)"),
    direzione: str = Query(default="desc", pattern="^(asc|desc)$"),
    is_test: bool = Query(False),
    pagina: int = Query(1, ge=1),
    per_pagina: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(PrenotazioneCancellata).filter(
        func.extract("year", PrenotazioneCancellata.arrivo) == anno
    )
    query = _applica_filtri(query, hotel_code, _parse_canali(canali), prenotazione_da, prenotazione_a, arrivo_da, arrivo_a, is_test)
    query = _applica_ricerca(query, q)
    totale = query.count()
    colonna = _COLONNE_ORDINABILI.get(ordina_per, PrenotazioneCancellata.data_prenotazione)
    ordinamento = colonna.asc() if direzione == "asc" else colonna.desc()
    righe = (
        query.order_by(ordinamento)
        .offset((pagina - 1) * per_pagina)
        .limit(per_pagina)
        .all()
    )
    return {
        "totale": totale,
        "pagina": pagina,
        "per_pagina": per_pagina,
        "righe": [_fmt_riga(r) for r in righe],
    }


class PrenotazioneCancellataUpdate(BaseModel):
    hotel_code: str
    canale: str
    canale_vendita: str = ""
    codice_ota: str = ""
    numero_prenotazione: Optional[str] = None
    data_cancellazione: Optional[date] = None
    data_prenotazione: date
    arrivo: date
    partenza: date
    pax: int = 0
    cliente: str = ""
    email: Optional[str] = None
    tipo_camera: str = ""
    trattamento: Optional[str] = None
    mercato: Optional[str] = None
    importo: float = 0.0


@router.put("/{riga_id}", dependencies=[Depends(richiedi_admin)])
def modifica_riga(riga_id: int, dati: PrenotazioneCancellataUpdate, db: Session = Depends(get_db)):
    riga = db.query(PrenotazioneCancellata).filter(PrenotazioneCancellata.id == riga_id).first()
    if not riga:
        raise HTTPException(status_code=404, detail="Prenotazione non trovata")
    if dati.partenza <= dati.arrivo:
        raise HTTPException(status_code=422, detail="La data di partenza deve essere successiva all'arrivo")

    for campo, valore in dati.model_dump().items():
        setattr(riga, campo, valore)
    riga.notti = (dati.partenza - dati.arrivo).days
    riga.modificato_manualmente = True
    db.commit()
    db.refresh(riga)
    return _fmt_riga(riga)


@router.delete("/{riga_id}", dependencies=[Depends(richiedi_admin)])
def elimina_riga(riga_id: int, conferma: bool = Query(False), db: Session = Depends(get_db)):
    if not conferma:
        raise HTTPException(status_code=400, detail="Aggiungere ?conferma=true per confermare l'eliminazione")
    riga = db.query(PrenotazioneCancellata).filter(PrenotazioneCancellata.id == riga_id).first()
    if not riga:
        raise HTTPException(status_code=404, detail="Prenotazione non trovata")
    db.delete(riga)
    db.commit()
    return {"eliminato": riga_id}


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
