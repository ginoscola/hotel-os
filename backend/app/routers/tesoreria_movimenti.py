"""Tesoreria — movimenti: elenco con filtri/ricerca/ordinamento, correzione della categoria
(manuale = vince sulle regole), flag straordinario, note, proposta di regola da un movimento."""

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tesoreria import TesoreriaCategoria, TesoreriaMovimento, TesoreriaRegola
from app.models.tesoreria import TesoreriaConto
from app.routers.corrispettivi_documenti import _risposta_tabella
from app.routers.tesoreria_shared import (
    categoria_automatica, cella_data, cella_importo, euro, id_ripiego, mappa_categorie, movimento_json, puo_modificare, puo_vedere,
    regole_attive,
)
from app.services.tesoreria_classificatore import RegolaClassificazione, corrisponde

router = APIRouter()

# Whitelist: mai una colonna arbitraria dalla query string in order_by()
_COLONNE_ORDINABILI = {
    "data_contabile": TesoreriaMovimento.data_contabile,
    "data_valuta": TesoreriaMovimento.data_valuta,
    "importo": TesoreriaMovimento.importo,
    "controparte": TesoreriaMovimento.controparte,
    "descrizione": TesoreriaMovimento.descrizione,
}
PAROLE_PROPOSTA = 3
MAX_RIGHE_EXPORT = 50000
LUNGHEZZA_DESCRIZIONE_PDF = 200   # nel pdf il testo va a capo: oltre, righe troppo alte
# pdf orizzontale: pesi delle colonne (stesso ordine delle intestazioni), importo allineato a destra
LARGHEZZE_PDF = [7, 7, 9, 16, 34, 8, 12, 5, 5, 10]
COLONNE_NUMERICHE_PDF = (5,)   # parole iniziali della descrizione proposte come regola se manca la controparte


def filtra_movimenti(q, conto_id: Optional[int] = None, data_da: Optional[date] = None,
                     data_a: Optional[date] = None, categoria_id: Optional[int] = None,
                     segno: Optional[str] = None, testo: Optional[str] = None,
                     solo_manuali: bool = False, straordinario: Optional[bool] = None,
                     ripiego: Optional[int] = None):
    """Filtri comuni (elenco movimenti, e in seguito Drawer del consuntivo)."""
    if conto_id:
        q = q.filter(TesoreriaMovimento.conto_id == conto_id)
    if data_da:
        q = q.filter(TesoreriaMovimento.data_contabile >= data_da)
    if data_a:
        q = q.filter(TesoreriaMovimento.data_contabile <= data_a)
    if categoria_id:
        if categoria_id == ripiego:   # i movimenti senza categoria contano come "Da classificare"
            q = q.filter(or_(TesoreriaMovimento.categoria_id == categoria_id,
                             TesoreriaMovimento.categoria_id.is_(None)))
        else:
            q = q.filter(TesoreriaMovimento.categoria_id == categoria_id)
    if segno == "entrata":
        q = q.filter(TesoreriaMovimento.importo > 0)
    elif segno == "uscita":
        q = q.filter(TesoreriaMovimento.importo < 0)
    if solo_manuali:
        q = q.filter(TesoreriaMovimento.categoria_manuale.is_(True))
    if straordinario is not None:
        q = q.filter(TesoreriaMovimento.straordinario.is_(straordinario))
    if testo and testo.strip():
        like = f"%{testo.strip()}%"
        q = q.filter(or_(
            TesoreriaMovimento.descrizione.ilike(like),
            TesoreriaMovimento.controparte.ilike(like),
            TesoreriaMovimento.note.ilike(like),
            cast(TesoreriaMovimento.importo, String).ilike(like),
        ))
    return q


@router.get("/movimenti")
def lista_movimenti(
    conto_id: Optional[int] = None,
    data_da: Optional[date] = None,
    data_a: Optional[date] = None,
    categoria_id: Optional[int] = None,
    segno: Optional[str] = Query(None, pattern="^(entrata|uscita)$"),
    q: Optional[str] = None,
    solo_manuali: bool = False,
    straordinario: Optional[bool] = None,
    ordina_per: str = "data_contabile",
    direzione: str = Query("desc", pattern="^(asc|desc)$"),
    pagina: int = Query(1, ge=1),
    per_pagina: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(puo_vedere),
):
    ripiego = id_ripiego(db)
    base = filtra_movimenti(db.query(TesoreriaMovimento), conto_id, data_da, data_a, categoria_id, segno,
                            q, solo_manuali, straordinario, ripiego)
    totale, entrate, uscite = base.with_entities(
        func.count(TesoreriaMovimento.id),
        func.coalesce(func.sum(TesoreriaMovimento.importo).filter(TesoreriaMovimento.importo > 0), 0),
        func.coalesce(func.sum(TesoreriaMovimento.importo).filter(TesoreriaMovimento.importo < 0), 0),
    ).one()
    colonna = _COLONNE_ORDINABILI.get(ordina_per, TesoreriaMovimento.data_contabile)
    ordine = colonna.asc() if direzione == "asc" else colonna.desc()
    righe = base.order_by(ordine, TesoreriaMovimento.id.desc()) \
        .offset((pagina - 1) * per_pagina).limit(per_pagina).all()
    categorie = mappa_categorie(db)
    return {
        "totale": totale, "pagina": pagina, "per_pagina": per_pagina,
        "entrate": euro(Decimal(entrate)), "uscite": euro(Decimal(uscite)),
        "netto": euro(Decimal(entrate) + Decimal(uscite)),
        "righe": [movimento_json(m, categorie) for m in righe],
    }


@router.get("/movimenti/export")
def export_movimenti(
    formato: str = Query("xlsx", pattern="^(xlsx|csv|pdf)$"),
    conto_id: Optional[int] = None,
    data_da: Optional[date] = None,
    data_a: Optional[date] = None,
    categoria_id: Optional[int] = None,
    segno: Optional[str] = Query(None, pattern="^(entrata|uscita)$"),
    q: Optional[str] = None,
    solo_manuali: bool = False,
    straordinario: Optional[bool] = None,
    ordina_per: str = "data_contabile",
    direzione: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    _=Depends(puo_vedere),
):
    """Stessi filtri e ordinamento dell'elenco, tutte le righe (senza paginazione)."""
    base = filtra_movimenti(db.query(TesoreriaMovimento), conto_id, data_da, data_a, categoria_id, segno,
                            q, solo_manuali, straordinario, id_ripiego(db))
    colonna = _COLONNE_ORDINABILI.get(ordina_per, TesoreriaMovimento.data_contabile)
    righe = base.order_by(colonna.asc() if direzione == "asc" else colonna.desc(), TesoreriaMovimento.id.desc()) \
        .limit(MAX_RIGHE_EXPORT).all()
    categorie = mappa_categorie(db)
    conti = {c.id: c.nome for c in db.query(TesoreriaConto)}

    def descrizione(m):
        if formato == "pdf" and len(m.descrizione) > LUNGHEZZA_DESCRIZIONE_PDF:
            return m.descrizione[:LUNGHEZZA_DESCRIZIONE_PDF] + "…"
        return m.descrizione

    intestazioni = ["Data contabile", "Data valuta", "Conto", "Controparte", "Descrizione", "Importo",
                    "Categoria", "Corretta a mano", "Straordinario", "Note"]
    dati = [
        [cella_data(m.data_contabile), cella_data(m.data_valuta), conti.get(m.conto_id, ""),
         m.controparte or "", descrizione(m), cella_importo(m.importo, formato),
         categorie[m.categoria_id].nome if m.categoria_id in categorie else "Da classificare",
         "sì" if m.categoria_manuale else "", "sì" if m.straordinario else "", m.note or ""]
        for m in righe
    ]
    periodo = f" dal {cella_data(data_da)}" if data_da else ""
    periodo += f" al {cella_data(data_a)}" if data_a else ""
    return _risposta_tabella(formato, "tesoreria_movimenti", f"Tesoreria — movimenti{periodo}",
                             intestazioni, dati, LARGHEZZE_PDF, COLONNE_NUMERICHE_PDF)


@router.put("/movimenti/{movimento_id}")
def aggiorna_movimento(
    movimento_id: int,
    body: dict = Body(...),
    db: Session = Depends(get_db),
    _=Depends(puo_modificare),
):
    """Campi facoltativi: `categoria_id` (→ manuale, vince sulle regole), `automatica: true`
    (torna alla categoria delle regole), `straordinario`, `note`."""
    m = db.get(TesoreriaMovimento, movimento_id)
    if not m:
        raise HTTPException(404, "Movimento non trovato")
    if body.get("automatica"):
        m.categoria_manuale = False
        m.categoria_id = categoria_automatica(m.descrizione, m.controparte, m.importo,
                                              regole_attive(db), id_ripiego(db))
    elif "categoria_id" in body:
        cat = db.get(TesoreriaCategoria, body["categoria_id"]) if body["categoria_id"] else None
        if cat is None:
            raise HTTPException(400, "Categoria non trovata")
        m.categoria_id = cat.id
        m.categoria_manuale = True
    if "straordinario" in body:
        m.straordinario = bool(body["straordinario"])
    if "note" in body:
        m.note = (body["note"] or "").strip() or None
    db.commit()
    return movimento_json(m, mappa_categorie(db))


@router.get("/movimenti/{movimento_id}/proposta-regola")
def proposta_regola(movimento_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Regola suggerita per classificare i movimenti simili a questo: controparte che inizia con
    il nome (se c'è), altrimenti descrizione che inizia con le prime parole; segno del movimento;
    priorità appena prima della regola che oggi lo classifica (così la nuova vince)."""
    m = db.get(TesoreriaMovimento, movimento_id)
    if not m:
        raise HTTPException(404, "Movimento non trovato")
    if m.controparte:
        campo, valore = "controparte", m.controparte.strip()
    else:
        campo, valore = "descrizione", " ".join(m.descrizione.split()[:PAROLE_PROPOSTA])
    regole = (
        db.query(TesoreriaRegola).join(TesoreriaCategoria)
        .filter(TesoreriaRegola.attiva.is_(True), TesoreriaCategoria.attivo.is_(True))
        .order_by(TesoreriaRegola.priorita, TesoreriaRegola.id).all()
    )
    attuale = next((r for r in regole if corrisponde(RegolaClassificazione.da_modello(r), m.descrizione,
                                                       m.controparte or "", m.importo)), None)
    if attuale is not None:
        priorita = attuale.priorita - 1
    else:
        priorita = (max((r.priorita for r in regole), default=0)) + 10
    return {
        "categoria_id": m.categoria_id,
        "campo": campo, "operatore": "inizia", "valori": [valore], "valori_anche": None,
        "segno": "entrata" if m.importo > 0 else "uscita",
        "priorita": priorita,
        "regola_attuale_id": attuale.id if attuale else None,
    }
