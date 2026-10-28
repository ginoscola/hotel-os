"""Tesoreria — configurazione: conti (fido e scadenza), saldi manuali, categorie, regole di
classificazione con prova su movimenti reali e ricalcolo (le categorie manuali non si toccano)."""

import re
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tesoreria import (
    CAMPI_REGOLA, OPERATORI_REGOLA, SEGNI_REGOLA, TIPI_CATEGORIA, TIPI_CONTO, TesoreriaCategoria,
    TesoreriaConto, TesoreriaMovimento, TesoreriaRegola, TesoreriaSaldo,
)
from app.routers.tesoreria_shared import (
    CATEGORIA_RIPIEGO, euro, id_ripiego, mappa_categorie, movimento_json, puo_modificare, puo_vedere,
    regole_attive, ricalcola_categorie,
)
from app.services.tesoreria_classificatore import RegolaClassificazione, classifica, corrisponde

router = APIRouter()

ESEMPI_PROVA = 20


def _decimale(valore, campo: str, ammetti_none: bool = False) -> Optional[Decimal]:
    if valore is None or valore == "":
        if ammetti_none:
            return None
        raise HTTPException(400, f"{campo}: valore obbligatorio")
    try:
        return Decimal(str(valore)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise HTTPException(400, f"{campo}: importo non valido")


def _data(valore, campo: str, ammetti_none: bool = False) -> Optional[date]:
    if not valore:
        if ammetti_none:
            return None
        raise HTTPException(400, f"{campo}: data obbligatoria")
    try:
        return date.fromisoformat(str(valore))
    except ValueError:
        raise HTTPException(400, f"{campo}: data non valida (AAAA-MM-GG)")


def _colore(valore) -> Optional[str]:
    if not valore:
        return None
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(valore)):
        raise HTTPException(400, "Colore non valido (formato #rrggbb)")
    return str(valore).lower()


# ── Conti ───────────────────────────────────────────────────────────────────────

def _conto_json(c: TesoreriaConto, ultimo: Optional[TesoreriaSaldo] = None) -> dict:
    return {
        "id": c.id, "codice": c.codice, "nome": c.nome, "banca": c.banca, "tipo": c.tipo, "iban": c.iban,
        "fido": euro(c.fido), "fido_scadenza": c.fido_scadenza.isoformat() if c.fido_scadenza else None,
        "ha_import": c.ha_import, "testo_addebito": c.testo_addebito, "colore": c.colore, "ordine": c.ordine, "attivo": c.attivo, "note": c.note,
        "ultimo_saldo": (
            {"data": ultimo.data.isoformat(), "saldo": euro(ultimo.saldo), "origine": ultimo.origine}
            if ultimo else None
        ),
    }


@router.get("/conti")
def lista_conti(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    ultime = db.query(TesoreriaSaldo.conto_id, func.max(TesoreriaSaldo.data).label("data")) \
        .group_by(TesoreriaSaldo.conto_id).subquery()
    saldi = {
        s.conto_id: s for s in db.query(TesoreriaSaldo).join(
            ultime, (ultime.c.conto_id == TesoreriaSaldo.conto_id) & (ultime.c.data == TesoreriaSaldo.data))
    }
    conti = db.query(TesoreriaConto).order_by(TesoreriaConto.ordine, TesoreriaConto.id).all()
    return [_conto_json(c, saldi.get(c.id)) for c in conti]


def _applica_conto(c: TesoreriaConto, body: dict, db: Session):
    if "codice" in body:
        c.codice = (body["codice"] or "").strip()
    if "nome" in body:
        c.nome = (body["nome"] or "").strip()
    if not c.codice or not c.nome:
        raise HTTPException(400, "Codice e nome obbligatori")
    if "tipo" in body:
        c.tipo = body["tipo"]
    if c.tipo not in TIPI_CONTO:
        raise HTTPException(400, f"Tipo conto non valido: {', '.join(TIPI_CONTO)}")
    if "banca" in body:
        c.banca = (body["banca"] or "").strip() or None
    if "iban" in body:
        c.iban = re.sub(r"\s", "", body["iban"] or "").upper() or None
    if "fido" in body:
        c.fido = _decimale(body["fido"] or 0, "Fido")
        if c.fido < 0:
            raise HTTPException(400, "Il fido non può essere negativo")
    if "testo_addebito" in body:
        c.testo_addebito = (body["testo_addebito"] or "").strip()[:100] or None
    if "fido_scadenza" in body:
        c.fido_scadenza = _data(body["fido_scadenza"], "Scadenza fido", ammetti_none=True)
    for campo in ("ha_import", "attivo"):
        if campo in body:
            setattr(c, campo, bool(body[campo]))
    if "colore" in body:
        c.colore = _colore(body["colore"])
    if "ordine" in body:
        c.ordine = int(body["ordine"] or 0)
    if "note" in body:
        c.note = (body["note"] or "").strip() or None
    if c.ha_import and not c.iban:
        raise HTTPException(400, "Un conto con import degli estratti conto richiede l'IBAN")
    with db.no_autoflush:   # il controllo non deve scrivere prima l'oggetto che sta validando
        doppioni = db.query(TesoreriaConto)
        if c.id is not None:
            doppioni = doppioni.filter(TesoreriaConto.id != c.id)
        if doppioni.filter(TesoreriaConto.codice == c.codice).first():
            raise HTTPException(409, f"Esiste già un conto con codice {c.codice}")
        if c.iban and doppioni.filter(TesoreriaConto.iban == c.iban).first():
            raise HTTPException(409, f"Esiste già un conto con IBAN {c.iban}")


@router.post("/conti")
def crea_conto(body: dict = Body(...), db: Session = Depends(get_db), _=Depends(puo_modificare)):
    c = TesoreriaConto(fido=0, ha_import=False, attivo=True, ordine=0)
    _applica_conto(c, body, db)
    db.add(c)
    db.commit()
    return _conto_json(c)


@router.put("/conti/{conto_id}")
def aggiorna_conto(conto_id: int, body: dict = Body(...), db: Session = Depends(get_db),
                   _=Depends(puo_modificare)):
    c = db.get(TesoreriaConto, conto_id)
    if not c:
        raise HTTPException(404, "Conto non trovato")
    _applica_conto(c, body, db)
    db.commit()
    return _conto_json(c)


# ── Saldi ───────────────────────────────────────────────────────────────────────

def _saldo_json(s: TesoreriaSaldo) -> dict:
    return {"id": s.id, "conto_id": s.conto_id, "data": s.data.isoformat(), "saldo": euro(s.saldo),
            "origine": s.origine, "import_id": s.import_id, "note": s.note}


@router.get("/saldi")
def lista_saldi(conto_id: Optional[int] = None, origine: Optional[str] = None, limite: int = 200,
                db: Session = Depends(get_db), _=Depends(puo_vedere)):
    q = db.query(TesoreriaSaldo)
    if conto_id:
        q = q.filter(TesoreriaSaldo.conto_id == conto_id)
    if origine:
        q = q.filter(TesoreriaSaldo.origine == origine)
    return [_saldo_json(s) for s in q.order_by(TesoreriaSaldo.data.desc(), TesoreriaSaldo.id.desc())
            .limit(max(1, min(limite, 2000)))]


@router.post("/saldi")
def salva_saldo_manuale(body: dict = Body(...), db: Session = Depends(get_db), utente=Depends(puo_modificare)):
    """Saldo a fine giornata inserito a mano (carte, prepagata, o un conto senza estratto).
    Per le carte di credito = speso non ancora addebitato, positivo. Upsert su (conto, data);
    un saldo arrivato da un estratto conto non si sovrascrive a mano."""
    conto = db.get(TesoreriaConto, body.get("conto_id"))
    if not conto:
        raise HTTPException(400, "Conto non trovato")
    giorno = _data(body.get("data"), "Data")
    valore = _decimale(body.get("saldo"), "Saldo")
    s = db.query(TesoreriaSaldo).filter_by(conto_id=conto.id, data=giorno).first()
    if s and s.origine == "import":
        raise HTTPException(409, "Per questa data c'è già il saldo dell'estratto conto: non modificabile a mano")
    if s is None:
        s = TesoreriaSaldo(conto_id=conto.id, data=giorno, origine="manuale")
        db.add(s)
    s.saldo = valore
    s.note = (body.get("note") or "").strip() or None
    s.utente_id = getattr(utente, "id", None)
    db.commit()
    return _saldo_json(s)


@router.delete("/saldi/{saldo_id}")
def elimina_saldo_manuale(saldo_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    s = db.get(TesoreriaSaldo, saldo_id)
    if not s:
        raise HTTPException(404, "Saldo non trovato")
    if s.origine != "manuale":
        raise HTTPException(409, "Solo i saldi inseriti a mano si eliminano: quelli da estratto conto "
                                 "si tolgono eliminando l'import")
    db.delete(s)
    db.commit()
    return {"eliminato": saldo_id}


# ── Categorie ───────────────────────────────────────────────────────────────────

def _categoria_json(c: TesoreriaCategoria, n_mov: int = 0, n_regole: int = 0) -> dict:
    return {"id": c.id, "codice": c.codice, "nome": c.nome, "tipo": c.tipo, "colore": c.colore,
            "ordine": c.ordine, "escludi_da_operativo": c.escludi_da_operativo, "attivo": c.attivo,
            "n_movimenti": n_mov, "n_regole": n_regole, "protetta": c.codice == CATEGORIA_RIPIEGO}


@router.get("/categorie")
def lista_categorie(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    n_mov = dict(db.query(TesoreriaMovimento.categoria_id, func.count()).group_by(TesoreriaMovimento.categoria_id))
    n_reg = dict(db.query(TesoreriaRegola.categoria_id, func.count()).group_by(TesoreriaRegola.categoria_id))
    return [_categoria_json(c, n_mov.get(c.id, 0), n_reg.get(c.id, 0))
            for c in db.query(TesoreriaCategoria).order_by(TesoreriaCategoria.ordine, TesoreriaCategoria.id)]


def _applica_categoria(c: TesoreriaCategoria, body: dict, db: Session):
    if "codice" in body and c.codice != CATEGORIA_RIPIEGO:
        c.codice = re.sub(r"[^a-z0-9_]", "_", (body["codice"] or "").strip().lower())
    if "nome" in body:
        c.nome = (body["nome"] or "").strip()
    if not c.codice or not c.nome:
        raise HTTPException(400, "Codice e nome obbligatori")
    if "tipo" in body:
        c.tipo = body["tipo"]
    if c.tipo not in TIPI_CATEGORIA:
        raise HTTPException(400, f"Tipo categoria non valido: {', '.join(TIPI_CATEGORIA)}")
    if "colore" in body:
        c.colore = _colore(body["colore"])
    if "ordine" in body:
        c.ordine = int(body["ordine"] or 0)
    if "escludi_da_operativo" in body:
        c.escludi_da_operativo = bool(body["escludi_da_operativo"])
    if "attivo" in body:
        if c.codice == CATEGORIA_RIPIEGO and not body["attivo"]:
            raise HTTPException(400, "La categoria 'Da classificare' non si può disattivare")
        c.attivo = bool(body["attivo"])
    with db.no_autoflush:
        doppioni = db.query(TesoreriaCategoria).filter(TesoreriaCategoria.codice == c.codice)
        if c.id is not None:
            doppioni = doppioni.filter(TesoreriaCategoria.id != c.id)
        if doppioni.first():
            raise HTTPException(409, f"Esiste già una categoria con codice {c.codice}")


@router.post("/categorie")
def crea_categoria(body: dict = Body(...), db: Session = Depends(get_db), _=Depends(puo_modificare)):
    massimo = db.query(func.max(TesoreriaCategoria.ordine)).scalar() or 0
    c = TesoreriaCategoria(ordine=massimo + 1, escludi_da_operativo=False, attivo=True)
    _applica_categoria(c, body, db)
    db.add(c)
    db.commit()
    return _categoria_json(c)


@router.put("/categorie/{categoria_id}")
def aggiorna_categoria(categoria_id: int, body: dict = Body(...), db: Session = Depends(get_db),
                       _=Depends(puo_modificare)):
    c = db.get(TesoreriaCategoria, categoria_id)
    if not c:
        raise HTTPException(404, "Categoria non trovata")
    _applica_categoria(c, body, db)
    db.commit()
    return _categoria_json(c)


@router.delete("/categorie/{categoria_id}")
def elimina_categoria(categoria_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Solo se nessun movimento e nessuna regola la usa; altrimenti disattivarla."""
    c = db.get(TesoreriaCategoria, categoria_id)
    if not c:
        raise HTTPException(404, "Categoria non trovata")
    if c.codice == CATEGORIA_RIPIEGO:
        raise HTTPException(400, "La categoria 'Da classificare' non si può eliminare")
    n_mov = db.query(TesoreriaMovimento).filter(TesoreriaMovimento.categoria_id == c.id).count()
    n_reg = db.query(TesoreriaRegola).filter(TesoreriaRegola.categoria_id == c.id).count()
    if n_mov or n_reg:
        raise HTTPException(409, f"Categoria in uso ({n_mov} movimenti, {n_reg} regole): disattivarla invece")
    db.delete(c)
    db.commit()
    return {"eliminata": categoria_id}


# ── Regole ──────────────────────────────────────────────────────────────────────

def _regola_json(r: TesoreriaRegola, categorie: dict) -> dict:
    cat = categorie.get(r.categoria_id)
    return {"id": r.id, "categoria_id": r.categoria_id, "categoria_nome": cat.nome if cat else None,
            "priorita": r.priorita, "campo": r.campo, "operatore": r.operatore, "valori": r.valori or [],
            "valori_anche": r.valori_anche or [], "segno": r.segno, "attiva": r.attiva, "note": r.note}


def _lista_testi(valore, campo: str, obbligatoria: bool) -> Optional[list]:
    if isinstance(valore, str):
        valore = valore.split("\n")
    testi = [str(v).strip() for v in (valore or []) if str(v).strip()]
    if obbligatoria and not testi:
        raise HTTPException(400, f"{campo}: almeno un valore")
    return testi or None


def _applica_regola(r: TesoreriaRegola, body: dict, db: Session):
    if "categoria_id" in body:
        if not db.get(TesoreriaCategoria, body["categoria_id"]):
            raise HTTPException(400, "Categoria non trovata")
        r.categoria_id = body["categoria_id"]
    if not r.categoria_id:
        raise HTTPException(400, "Categoria obbligatoria")
    if "priorita" in body:
        r.priorita = int(body["priorita"])
    if "campo" in body:
        r.campo = body["campo"]
    if "operatore" in body:
        r.operatore = body["operatore"]
    if "segno" in body:
        r.segno = body["segno"]
    if r.campo not in CAMPI_REGOLA or r.operatore not in OPERATORI_REGOLA or r.segno not in SEGNI_REGOLA:
        raise HTTPException(400, "Campo, operatore o segno non validi")
    if "valori" in body:
        r.valori = _lista_testi(body["valori"], "Valori", obbligatoria=True)
    if not r.valori:
        raise HTTPException(400, "Valori: almeno un valore")
    if "valori_anche" in body:
        r.valori_anche = _lista_testi(body["valori_anche"], "Valori aggiuntivi", obbligatoria=False)
    if "attiva" in body:
        r.attiva = bool(body["attiva"])
    if "note" in body:
        r.note = (body["note"] or "").strip()[:255] or None


@router.get("/regole")
def lista_regole(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    categorie = mappa_categorie(db)
    return [_regola_json(r, categorie)
            for r in db.query(TesoreriaRegola).order_by(TesoreriaRegola.priorita, TesoreriaRegola.id)]


def _con_ricalcolo(db: Session, body: dict) -> Optional[dict]:
    """`ricalcola: true` nel body → riapplica subito le regole ai movimenti non manuali."""
    if not body.get("ricalcola"):
        return None
    db.flush()
    return ricalcola_categorie(db)


@router.post("/regole")
def crea_regola(body: dict = Body(...), db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = TesoreriaRegola(attiva=True, segno="entrambi", operatore="contiene", campo="descrizione")
    if "priorita" not in body:
        r.priorita = (db.query(func.max(TesoreriaRegola.priorita)).scalar() or 0) + 10
    _applica_regola(r, body, db)
    db.add(r)
    ricalcolo = _con_ricalcolo(db, body)
    db.commit()
    return {**_regola_json(r, mappa_categorie(db)), "ricalcolo": ricalcolo}


@router.put("/regole/{regola_id}")
def aggiorna_regola(regola_id: int, body: dict = Body(...), db: Session = Depends(get_db),
                    _=Depends(puo_modificare)):
    r = db.get(TesoreriaRegola, regola_id)
    if not r:
        raise HTTPException(404, "Regola non trovata")
    _applica_regola(r, body, db)
    ricalcolo = _con_ricalcolo(db, body)
    db.commit()
    return {**_regola_json(r, mappa_categorie(db)), "ricalcolo": ricalcolo}


@router.delete("/regole/{regola_id}")
def elimina_regola(regola_id: int, ricalcola: bool = False, db: Session = Depends(get_db),
                   _=Depends(puo_modificare)):
    r = db.get(TesoreriaRegola, regola_id)
    if not r:
        raise HTTPException(404, "Regola non trovata")
    db.delete(r)
    ricalcolo = _con_ricalcolo(db, {"ricalcola": ricalcola})
    db.commit()
    return {"eliminata": regola_id, "ricalcolo": ricalcolo}


@router.post("/regole/prova")
def prova_regola(body: dict = Body(...), db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Effetto di una regola (nuova o modificata, `id` facoltativo) senza salvarla: movimenti che
    corrisponderebbero, quanti cambierebbero categoria inserendola alla sua priorità tra le altre
    regole attive, con esempi. I movimenti classificati a mano non cambiano mai."""
    bozza = TesoreriaRegola(attiva=True, segno="entrambi", operatore="contiene", campo="descrizione",
                            priorita=body.get("priorita", 0))
    _applica_regola(bozza, body, db)
    prova = RegolaClassificazione.da_modello(bozza)
    escludi = body.get("id")
    altre = [r for r in db.query(TesoreriaRegola).join(TesoreriaCategoria)
             .filter(TesoreriaRegola.attiva.is_(True), TesoreriaCategoria.attivo.is_(True))
             .order_by(TesoreriaRegola.priorita, TesoreriaRegola.id) if r.id != escludi]
    regole = sorted([RegolaClassificazione.da_modello(r) for r in altre] + [prova],
                    key=lambda x: x.priorita)
    ripiego = id_ripiego(db)
    categorie = mappa_categorie(db)

    corrispondenti, cambierebbero, da_dove = [], [], Counter()
    for m in db.query(TesoreriaMovimento).order_by(TesoreriaMovimento.data_contabile.desc()):
        if not corrisponde(prova, m.descrizione, m.controparte or "", m.importo):
            continue
        corrispondenti.append(m)
        if m.categoria_manuale:
            continue
        nuova = classifica(m.descrizione, m.controparte or "", m.importo, regole) or ripiego
        if nuova != m.categoria_id:
            cambierebbero.append(m)
            cat = categorie.get(m.categoria_id)
            da_dove[cat.nome if cat else "Da classificare"] += 1
    return {
        "n_corrispondenti": len(corrispondenti),
        "importo_corrispondenti": euro(sum((m.importo for m in corrispondenti), Decimal("0.00"))),
        "n_manuali": sum(1 for m in corrispondenti if m.categoria_manuale),
        "n_cambierebbero": len(cambierebbero),
        "da_categorie": [{"categoria": k, "n": v} for k, v in da_dove.most_common()],
        "esempi": [movimento_json(m, categorie) for m in (cambierebbero or corrispondenti)[:ESEMPI_PROVA]],
    }


@router.post("/ricalcola")
def ricalcola(db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Riapplica le regole attive a tutti i movimenti non classificati a mano."""
    esito = ricalcola_categorie(db, regole_attive(db))
    db.commit()
    return esito
