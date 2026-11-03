"""Tesoreria — caparre per mese di arrivo (Fase 4a): riepilogo, coda di revisione, correzione a mano.

L'arrivo del soggiorno è letto dalla causale dei bonifici da clienti (`aggiorna_caparre()` in tesoreria_shared, a ogni
import e ricalcolo delle categorie). Caparra = incasso arrivato prima del giorno di arrivo. La coda di revisione
contiene i bonifici della stagione richiesta senza arrivo. Un bonifico si può segnare "caparra senza periodo"
(regola 'senza_periodo'): conta come caparra della stagione del pagamento ed è distribuito sui mesi di arrivo in
proporzione alle caparre di cui il mese è noto.
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
from app.services.tesoreria_caparre import MESI_STAGIONE, distribuisci, future_al, per_mese_arrivo
from app.services.tesoreria_report import anno_di, anno_prima, etichetta_anno, intervallo_anno

router = APIRouter()

STRUTTURE = ("DPH", "CLB", "INT")
ZERO = Decimal(0)
SENZA_PERIODO = "senza_periodo"
ESCLUSO = "escluso"


def caparre_db(db: Session) -> list:
    """[(data pagamento, arrivo, struttura, importo)] di tutti i movimenti con un arrivo (letto o a mano)."""
    righe = db.query(
        TesoreriaMovimento.data_contabile, TesoreriaMovimento.arrivo, TesoreriaMovimento.arrivo_struttura,
        TesoreriaMovimento.importo,
    ).filter(TesoreriaMovimento.arrivo.isnot(None), TesoreriaMovimento.importo > 0).all()
    return [tuple(r) for r in righe]


def senza_periodo_db(db: Session) -> list:
    """[(data pagamento, importo)] dei bonifici segnati "caparra senza periodo"."""
    righe = db.query(TesoreriaMovimento.data_contabile, TesoreriaMovimento.importo).filter(
        TesoreriaMovimento.arrivo_regola == SENZA_PERIODO, TesoreriaMovimento.importo > 0).all()
    return [tuple(r) for r in righe]


def senza_periodo_stagione(senza: list, anno: int, al_giorno: date) -> Decimal:
    """Caparre senza periodo pagate nell'anno alberghiero `anno` fino a `al_giorno`."""
    dal, al = intervallo_anno(anno, "alberghiero")
    return sum((i for pag, i in senza if dal <= pag <= min(al, al_giorno)), ZERO)


def caparre_per_mese(caparre: list, senza: list, anno: int, al_giorno: date) -> dict:
    """{mese di arrivo: importo} delle caparre della stagione `anno` incassate fino a `al_giorno`, comprese quelle
    senza periodo distribuite in proporzione (se la stagione non ha ancora caparre note, come la stagione prima)."""
    pesi = {m: sum(v.values(), ZERO) for m, v in per_mese_arrivo(caparre, al_giorno, anno).items()}
    quote = pesi or {m: sum(v.values(), ZERO)
                     for m, v in per_mese_arrivo(caparre, date(anno - 1, 12, 31), anno - 1).items()}
    extra = distribuisci(senza_periodo_stagione(senza, anno, al_giorno), quote)
    return {m: pesi.get(m, ZERO) + extra.get(m, ZERO) for m in set(pesi) | set(extra)}


def bonifici_stagione(db: Session, anno: int) -> list:
    """Bonifici da clienti in entrata dell'anno alberghiero `anno`, dal più recente."""
    dal, al = intervallo_anno(anno, "alberghiero")
    cat = db.query(TesoreriaCategoria.id).filter(TesoreriaCategoria.codice == CATEGORIA_CAPARRE).first()
    return db.query(TesoreriaMovimento).filter(
        TesoreriaMovimento.categoria_id == (cat[0] if cat else None), TesoreriaMovimento.importo > 0,
        TesoreriaMovimento.data_contabile >= dal, TesoreriaMovimento.data_contabile <= al,
    ).order_by(TesoreriaMovimento.data_contabile.desc(), TesoreriaMovimento.id.desc()).all()


def in_coda(m: TesoreriaMovimento) -> bool:
    return m.arrivo is None and m.arrivo_regola not in (ESCLUSO, SENZA_PERIODO)


def sistemato(m: TesoreriaMovimento) -> bool:
    """Arrivo inserito a mano, segnato senza periodo o escluso, o trovato tramite una prenotazione Welcome."""
    return m.arrivo_manuale or (m.arrivo_regola or "").startswith("welcome")


def caparre_posizione(db: Session, giorno: date) -> dict:
    """Per la Posizione: caparre in banca a `giorno` per soggiorni successivi, per mese di arrivo e struttura, e
    quanti bonifici della stagione in corso attendono il periodo di soggiorno."""
    caparre = caparre_db(db)
    future = future_al(caparre, giorno)
    per_mese = [{"anno": y, "mese": m, **_blocco(v)} for (y, m), v in sorted(future.items())]
    per_struttura = {}
    for v in future.values():
        for s, imp in v.items():
            per_struttura[s] = per_struttura.get(s, ZERO) + imp
    # Senza periodo: quota distribuita sui mesi di arrivo della stagione ancora da venire (dal mese dopo)
    stagione = anno_di(giorno, "alberghiero")
    pesi = {m: sum(v.values(), ZERO) for m, v in per_mese_arrivo(caparre, giorno, stagione).items()}
    quote = distribuisci(senza_periodo_stagione(senza_periodo_db(db), stagione, giorno), pesi)
    senza = sum((v for m, v in quote.items() if (stagione, m) > (giorno.year, giorno.month)), ZERO)
    coda = [m for m in bonifici_stagione(db, stagione) if in_coda(m)]
    blocco = _blocco(per_struttura)
    return {**blocco, "totale": euro(Decimal(str(blocco["totale"])) + senza), "per_mese": per_mese,
            "senza_periodo": euro(senza), "n_coda": len(coda), "importo_coda": euro(sum((m.importo for m in coda), ZERO))}


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
    caparre, senza = caparre_db(db), senza_periodo_db(db)
    fine_ap = date(anno - 1, 12, 31)
    ora = per_mese_arrivo(caparre, giorno, anno)
    ap = per_mese_arrivo(caparre, giorno_ap, anno - 1)
    ap_fine = per_mese_arrivo(caparre, fine_ap, anno - 1)
    mesi = [{"mese": m, "quest_anno": _blocco(ora.get(m)), "anno_prima": _blocco(ap.get(m)),
             "anno_prima_finale": _blocco(ap_fine.get(m))} for m in MESI_STAGIONE]
    sp = {"quest_anno": senza_periodo_stagione(senza, anno, giorno),
          "anno_prima": senza_periodo_stagione(senza, anno - 1, giorno_ap),
          "anno_prima_finale": senza_periodo_stagione(senza, anno - 1, fine_ap)}

    def tot(dati, extra):
        per_struttura = {s: sum((v.get(s, ZERO) for v in dati.values()), ZERO) for s in (*STRUTTURE, "")}
        per_struttura[""] += extra
        return _blocco(per_struttura)

    bonifici = bonifici_stagione(db, anno)
    categorie = mappa_categorie(db)
    return {
        "anno": anno, "etichetta": etichetta_anno(anno, "alberghiero"), "al_giorno": giorno.isoformat(),
        "al_giorno_ap": giorno_ap.isoformat(), "mesi": mesi,
        "senza_periodo": {k: _blocco({"": v}) for k, v in sp.items()},
        "totali": {"quest_anno": tot(ora, sp["quest_anno"]), "anno_prima": tot(ap, sp["anno_prima"]),
                   "anno_prima_finale": tot(ap_fine, sp["anno_prima_finale"])},
        "bonifici": {
            "n": len(bonifici), "n_letti": sum(m.arrivo is not None for m in bonifici),
            "n_welcome": sum((m.arrivo_regola or "").startswith("welcome") for m in bonifici),
            "n_senza_periodo": sum(m.arrivo_regola == SENZA_PERIODO for m in bonifici),
            "n_esclusi": sum(m.arrivo_regola == ESCLUSO for m in bonifici),
            "n_coda": sum(in_coda(m) for m in bonifici),
        },
        "coda": [movimento_json(m, categorie) for m in bonifici if in_coda(m)],
        "sistemati": [movimento_json(m, categorie) for m in bonifici if sistemato(m)],
    }


@router.put("/caparre/{movimento_id}")
def correggi_caparra(movimento_id: int, body: dict = Body(...), db: Session = Depends(get_db),
                     _=Depends(puo_modificare)):
    """`{arrivo: 'YYYY-MM-DD', struttura: 'DPH'|'CLB'|'INT'|null}` → arrivo inserito a mano; `{senza_periodo: true}` →
    caparra di cui non si cerca il periodo; `{escluso: true}` → non è una caparra; `{automatico: true}` → torna alla
    lettura automatica (causale e prenotazioni Welcome)."""
    m = db.get(TesoreriaMovimento, movimento_id)
    if not m:
        raise HTTPException(404, "Movimento non trovato")
    if body.get("automatico"):
        m.arrivo_manuale = False
        m.arrivo, m.arrivo_regola, m.arrivo_struttura = None, None, None
        db.flush()
        aggiorna_caparre(db)
    elif body.get("escluso") or body.get("senza_periodo"):
        _segna(m, ESCLUSO if body.get("escluso") else SENZA_PERIODO)
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



def _segna(m: TesoreriaMovimento, stato: str) -> None:
    if m.importo <= 0:
        raise HTTPException(400, "Solo un'entrata può essere una caparra")
    m.arrivo_manuale, m.arrivo, m.arrivo_regola, m.arrivo_struttura = True, None, stato, None


@router.post("/caparre/segna")
def segna_caparre(body: dict = Body(...), db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Più bonifici insieme: `{ids: [...], stato: 'senza_periodo'|'escluso'}`."""
    stato, ids = body.get("stato"), body.get("ids") or []
    if stato not in (SENZA_PERIODO, ESCLUSO) or not isinstance(ids, list) or not ids:
        raise HTTPException(400, "Indicare i movimenti e uno stato tra senza_periodo ed escluso")
    movimenti = db.query(TesoreriaMovimento).filter(TesoreriaMovimento.id.in_(ids)).all()
    if len(movimenti) != len(set(ids)):
        raise HTTPException(404, "Movimento non trovato")
    for m in movimenti:
        _segna(m, stato)
    db.commit()
    return {"n": len(movimenti)}
