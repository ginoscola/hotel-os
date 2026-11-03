"""Tesoreria — caparre per mese di arrivo (Fase 4a): riepilogo, coda di revisione, correzione a mano.

L'arrivo del soggiorno è letto dalla causale dei bonifici da clienti (`aggiorna_caparre()` in tesoreria_shared, a ogni
import e ricalcolo delle categorie). Caparra = incasso arrivato prima del giorno di arrivo. La coda di revisione
contiene solo i bonifici dell'anno alberghiero in corso senza arrivo: lo storico serve solo al confronto con l'anno
prima e lì i non letti restano "senza periodo" (succede in modo simile in entrambi gli anni).
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tesoreria import TesoreriaCategoria, TesoreriaMovimento
from app.routers.tesoreria_shared import (
    CATEGORIA_CAPARRE, aggiorna_caparre, euro, mappa_categorie, movimento_json, puo_modificare, puo_vedere,
)
from app.services.tesoreria_caparre import MESI_STAGIONE, future_al, per_mese_arrivo
from app.services.tesoreria_report import anno_di, anno_prima, etichetta_anno, intervallo_anno

router = APIRouter()

STRUTTURE = ("DPH", "CLB", "INT")
ZERO = Decimal(0)


def caparre_db(db: Session) -> list:
    """[(data pagamento, arrivo, struttura, importo)] di tutti i movimenti con un arrivo (letto o a mano)."""
    righe = db.query(
        TesoreriaMovimento.data_contabile, TesoreriaMovimento.arrivo, TesoreriaMovimento.arrivo_struttura,
        TesoreriaMovimento.importo,
    ).filter(TesoreriaMovimento.arrivo.isnot(None), TesoreriaMovimento.importo > 0).all()
    return [tuple(r) for r in righe]


def bonifici_stagione(db: Session, anno: int) -> list:
    """Bonifici da clienti in entrata dell'anno alberghiero `anno`, dal più recente."""
    dal, al = intervallo_anno(anno, "alberghiero")
    cat = db.query(TesoreriaCategoria.id).filter(TesoreriaCategoria.codice == CATEGORIA_CAPARRE).first()
    return db.query(TesoreriaMovimento).filter(
        TesoreriaMovimento.categoria_id == (cat[0] if cat else None), TesoreriaMovimento.importo > 0,
        TesoreriaMovimento.data_contabile >= dal, TesoreriaMovimento.data_contabile <= al,
    ).order_by(TesoreriaMovimento.data_contabile.desc(), TesoreriaMovimento.id.desc()).all()


def in_coda(m: TesoreriaMovimento) -> bool:
    return m.arrivo is None and m.arrivo_regola != "escluso"


def caparre_posizione(db: Session, giorno: date) -> dict:
    """Per la Posizione: caparre in banca a `giorno` per soggiorni successivi, per mese di arrivo e struttura, e
    quanti bonifici della stagione in corso attendono il periodo di soggiorno."""
    future = future_al(caparre_db(db), giorno)
    per_mese = [{"anno": y, "mese": m, **_blocco(v)} for (y, m), v in sorted(future.items())]
    per_struttura = {}
    for v in future.values():
        for s, imp in v.items():
            per_struttura[s] = per_struttura.get(s, ZERO) + imp
    coda = [m for m in bonifici_stagione(db, anno_di(giorno, "alberghiero")) if in_coda(m)]
    return {**_blocco(per_struttura), "per_mese": per_mese, "n_coda": len(coda),
            "importo_coda": euro(sum((m.importo for m in coda), ZERO))}


def _blocco(per_struttura: Optional[dict]) -> dict:
    per_struttura = per_struttura or {}
    return {"totale": euro(sum(per_struttura.values(), ZERO)),
            "per_struttura": {s: euro(per_struttura.get(s, ZERO)) for s in (*STRUTTURE, "")}}


@router.get("/caparre")
def riepilogo_caparre(anno: Optional[int] = Query(None), db: Session = Depends(get_db), _=Depends(puo_vedere)):
    """Caparre per mese di arrivo della stagione `anno` (anno alberghiero, = anno dell'estate; default quella in
    corso): incassate finora, anno prima alla stessa data, anno prima a fine stagione. Più la coda di revisione."""
    oggi = date.today()
    anno = anno or anno_di(oggi, "alberghiero")
    giorno = min(oggi, intervallo_anno(anno, "alberghiero")[1])
    giorno_ap = anno_prima(giorno)
    caparre = caparre_db(db)
    ora = per_mese_arrivo(caparre, giorno, anno)
    ap = per_mese_arrivo(caparre, giorno_ap, anno - 1)
    ap_fine = per_mese_arrivo(caparre, date(anno - 1, 12, 31), anno - 1)
    mesi = [{"mese": m, "quest_anno": _blocco(ora.get(m)), "anno_prima": _blocco(ap.get(m)),
             "anno_prima_finale": _blocco(ap_fine.get(m))} for m in MESI_STAGIONE]
    tot = lambda dati: _blocco({s: sum((v.get(s, ZERO) for v in dati.values()), ZERO) for s in (*STRUTTURE, "")})

    bonifici = bonifici_stagione(db, anno)
    categorie = mappa_categorie(db)
    coda = [movimento_json(m, categorie) for m in bonifici if in_coda(m)]
    return {
        "anno": anno, "etichetta": etichetta_anno(anno, "alberghiero"), "al_giorno": giorno.isoformat(),
        "al_giorno_ap": giorno_ap.isoformat(), "mesi": mesi,
        "totali": {"quest_anno": tot(ora), "anno_prima": tot(ap), "anno_prima_finale": tot(ap_fine)},
        "bonifici": {"n": len(bonifici), "n_letti": sum(m.arrivo is not None for m in bonifici),
                     "n_esclusi": sum(m.arrivo_regola == "escluso" for m in bonifici), "n_coda": len(coda)},
        "coda": coda,
    }


@router.put("/caparre/{movimento_id}")
def correggi_caparra(movimento_id: int, body: dict = Body(...), db: Session = Depends(get_db),
                     _=Depends(puo_modificare)):
    """`{arrivo: 'YYYY-MM-DD', struttura: 'DPH'|'CLB'|'INT'|null}` → arrivo inserito a mano; `{escluso: true}` → non
    è un incasso per un soggiorno; `{automatico: true}` → torna alla lettura della causale."""
    m = db.get(TesoreriaMovimento, movimento_id)
    if not m:
        raise HTTPException(404, "Movimento non trovato")
    if body.get("automatico"):
        m.arrivo_manuale = False
        m.arrivo, m.arrivo_regola, m.arrivo_struttura = None, None, None
        db.flush()
        aggiorna_caparre(db)
    elif body.get("escluso"):
        m.arrivo_manuale, m.arrivo, m.arrivo_regola, m.arrivo_struttura = True, None, "escluso", None
    else:
        if m.importo <= 0:
            raise HTTPException(400, "Solo un'entrata può essere un incasso per un soggiorno")
        try:
            arrivo = date.fromisoformat(str(body.get("arrivo") or ""))
        except ValueError:
            raise HTTPException(400, "Data di arrivo non valida")
        struttura = body.get("struttura") or None
        if struttura not in (None, *STRUTTURE):
            raise HTTPException(400, "Struttura non valida")
        m.arrivo_manuale, m.arrivo, m.arrivo_regola, m.arrivo_struttura = True, arrivo, "manuale", struttura
    db.commit()
    return movimento_json(m, mappa_categorie(db))

