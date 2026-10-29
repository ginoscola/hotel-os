"""Tesoreria — abbinamento delle scadenze Passcom con la banca (Fase 2).

La logica è in `services/tesoreria_abbinamento.abbina()` (pura). Qui: la fotografia corrente, le
esclusioni (confermati, scartati, pagate a mano), il salvataggio e gli endpoint di revisione.

- `ricalcola_abbinamenti(db)`: cancella gli abbinamenti `automatico`/`proposto` e li ricalcola sulla
  fotografia corrente. Chiamata dopo ogni import (scadenzario o estratto conto) e dal pulsante. Non fa commit.
- Conferma → `confermato` + impara il nome del fornitore in banca (`tesoreria_fornitori_banca`).
- Scarta → `scartato`: le stesse coppie scadenza/movimento non vengono più proposte.
- Abbinamento manuale: l'utente sceglie scadenze e movimenti → `confermato` (regola 'manuale').
- Pagate a mano (selezione multipla): contanti, carta o altro non visibile in conto corrente.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tesoreria import (
    TesoreriaAbbinamento, TesoreriaAbbinamentoMovimento, TesoreriaAbbinamentoScadenza, TesoreriaConto,
    TesoreriaFornitoreBanca, TesoreriaMovimento, TesoreriaPagataManuale, TesoreriaScadenza, TesoreriaScadImport,
)
from app.routers.tesoreria_shared import euro, puo_modificare, puo_vedere
from app.services.tesoreria_abbinamento import (
    ABI_PAGAMENTI, MovimentoUscita, ScadenzaDaAbbinare, abbina, forza_nome, normalizza_nome,
)
from app.services.tesoreria_scadenzario import e_residuo, per_fornitore, unisci_fotografia

router = APIRouter()

STATI_ATTIVI = ("automatico", "proposto", "confermato")
FINESTRA_CANDIDATI = 90            # giorni attorno alla scadenza per l'abbinamento manuale


# ── Fotografia corrente ─────────────────────────────────────────────────────────

def fotografia_corrente(db: Session) -> tuple:
    """(data della fotografia più recente, scadenze): per ogni anno contabile l'import con la data più
    recente, uniti senza doppioni di chiave. (None, []) se non c'è nessuno scadenzario."""
    ultimi = {}
    for imp in db.query(TesoreriaScadImport).order_by(TesoreriaScadImport.data_fotografia, TesoreriaScadImport.id):
        ultimi[imp.anno_contabile] = imp
    if not ultimi:
        return None, []
    gruppi = [
        db.query(TesoreriaScadenza).filter(TesoreriaScadenza.import_id == imp.id).order_by(TesoreriaScadenza.id).all()
        for imp in ultimi.values()
    ]
    return max(i.data_fotografia for i in ultimi.values()), unisci_fotografia(gruppi)


def _alias(db: Session) -> dict:
    out = {}
    for codice, nome in db.query(TesoreriaFornitoreBanca.codice_fornitore, TesoreriaFornitoreBanca.nome_banca):
        out.setdefault(codice, set()).add(nome)
    return out


def _chiavi_in(db: Session, stati) -> set:
    return {k for (k,) in db.query(TesoreriaAbbinamentoScadenza.chiave)
            .join(TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoScadenza.abbinamento_id)
            .filter(TesoreriaAbbinamento.stato.in_(stati))}


def _movimenti_in(db: Session, stati) -> set:
    return {m for (m,) in db.query(TesoreriaAbbinamentoMovimento.movimento_id)
            .join(TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoMovimento.abbinamento_id)
            .filter(TesoreriaAbbinamento.stato.in_(stati))}


def _coppie_scartate(db: Session) -> set:
    scad = {}
    for abb_id, chiave in db.query(TesoreriaAbbinamentoScadenza.abbinamento_id, TesoreriaAbbinamentoScadenza.chiave) \
            .join(TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoScadenza.abbinamento_id) \
            .filter(TesoreriaAbbinamento.stato == "scartato"):
        scad.setdefault(abb_id, []).append(chiave)
    coppie = set()
    for abb_id, mov_id in db.query(TesoreriaAbbinamentoMovimento.abbinamento_id, TesoreriaAbbinamentoMovimento.movimento_id) \
            .filter(TesoreriaAbbinamentoMovimento.abbinamento_id.in_(list(scad) or [0])):
        coppie.update((k, mov_id) for k in scad[abb_id])
    return coppie


def _uscite_pagamento(db: Session, esclusi: set, da: Optional[date] = None, a: Optional[date] = None) -> list:
    q = db.query(TesoreriaMovimento).join(TesoreriaConto, TesoreriaConto.id == TesoreriaMovimento.conto_id) \
        .filter(TesoreriaConto.tipo == "conto", TesoreriaMovimento.importo < 0,
                TesoreriaMovimento.causale_abi.in_(ABI_PAGAMENTI))
    if da:
        q = q.filter(TesoreriaMovimento.data_contabile >= da)
    if a:
        q = q.filter(TesoreriaMovimento.data_contabile <= a)
    return [MovimentoUscita(id=m.id, data=m.data_contabile, importo=m.importo, causale_abi=m.causale_abi,
                            controparte=m.controparte, testo=f"{m.causale or ''} {m.descrizione}")
            for m in q if m.id not in esclusi]


def _da_abbinare(scadenze: list, data_foto: date, escluse: set) -> list:
    """Scadenze aperte da abbinare: senza pareggi, fornitori saldati, residui, confermate e pagate a mano.
    Le note di credito restano: entrano nelle somme delle Ri.Ba. (MARR)."""
    saldati = {f["codice_fornitore"] for f in per_fornitore(scadenze, data_foto) if f["netto"] <= 0}
    return [
        ScadenzaDaAbbinare(chiave=s.chiave, data_scadenza=s.data_scadenza, tipo_pagamento=s.tipo_pagamento,
                           codice_fornitore=s.codice_fornitore, fornitore=s.fornitore, importo=s.importo,
                           numero_documento=s.numero_documento, data_documento=s.data_documento)
        for s in scadenze
        if not s.pareggio and s.codice_fornitore not in saldati
        and not e_residuo(s, data_foto) and s.chiave not in escluse
    ]


def _crea(db: Session, stato: str, regola: str, nota: Optional[str], scadenze: list, movimenti_id: list,
          utente_id=None) -> TesoreriaAbbinamento:
    abb = TesoreriaAbbinamento(stato=stato, regola=regola, nota=nota or None,
                               codice_fornitore=scadenze[0].codice_fornitore, fornitore=scadenze[0].fornitore,
                               utente_id=utente_id,
                               confermato_at=datetime.now(timezone.utc) if stato == "confermato" else None)
    db.add(abb)
    db.flush()
    db.bulk_insert_mappings(TesoreriaAbbinamentoScadenza, [
        {"abbinamento_id": abb.id, "chiave": s.chiave, "data_scadenza": s.data_scadenza,
         "data_documento": s.data_documento, "numero_documento": s.numero_documento,
         "tipo_pagamento": s.tipo_pagamento, "importo": s.importo} for s in scadenze
    ])
    db.bulk_insert_mappings(TesoreriaAbbinamentoMovimento,
                            [{"abbinamento_id": abb.id, "movimento_id": m} for m in movimenti_id])
    return abb


def ricalcola_abbinamenti(db: Session) -> dict:
    """Ricalcola gli abbinamenti automatici e proposti sulla fotografia corrente. Non fa commit."""
    db.query(TesoreriaAbbinamento).filter(TesoreriaAbbinamento.stato.in_(("automatico", "proposto"))) \
        .delete(synchronize_session=False)
    # abbinamenti rimasti senza movimenti (import della banca eliminato)
    senza = db.query(TesoreriaAbbinamento.id).outerjoin(
        TesoreriaAbbinamentoMovimento, TesoreriaAbbinamentoMovimento.abbinamento_id == TesoreriaAbbinamento.id,
    ).filter(TesoreriaAbbinamentoMovimento.id.is_(None))
    db.query(TesoreriaAbbinamento).filter(TesoreriaAbbinamento.id.in_(senza.scalar_subquery())) \
        .delete(synchronize_session=False)
    db.flush()

    data_foto, scadenze = fotografia_corrente(db)
    if not scadenze:
        return {"n_automatici": 0, "n_proposti": 0, "n_scadenze_automatiche": 0, "n_scadenze_proposte": 0}
    escluse = _chiavi_in(db, ("confermato",)) | {k for (k,) in db.query(TesoreriaPagataManuale.chiave)}
    da = _da_abbinare(scadenze, data_foto, escluse)
    movimenti = _uscite_pagamento(db, _movimenti_in(db, ("confermato",)))
    per_chiave = {s.chiave: s for s in da}
    proposte = abbina(da, movimenti, _alias(db), _coppie_scartate(db))
    for p in proposte:
        _crea(db, p.stato, p.regola, p.nota, [per_chiave[k] for k in p.chiavi], p.movimenti)
    db.flush()
    conta = lambda stato, campo: sum(len(getattr(p, campo)) if campo else 1 for p in proposte if p.stato == stato)
    return {"n_automatici": conta("automatico", None), "n_proposti": conta("proposto", None),
            "n_scadenze_automatiche": conta("automatico", "chiavi"), "n_scadenze_proposte": conta("proposto", "chiavi")}


def _impara_nomi(db: Session, abb: TesoreriaAbbinamento):
    movimenti = db.query(TesoreriaMovimento).join(
        TesoreriaAbbinamentoMovimento, TesoreriaAbbinamentoMovimento.movimento_id == TesoreriaMovimento.id,
    ).filter(TesoreriaAbbinamentoMovimento.abbinamento_id == abb.id)
    for m in movimenti:
        nome = normalizza_nome(m.controparte)
        if not nome or forza_nome(abb.fornitore, m.controparte) == 2:
            continue                    # nessun nome, o già riconosciuto senza alias
        esiste = db.query(TesoreriaFornitoreBanca).filter_by(codice_fornitore=abb.codice_fornitore,
                                                            nome_banca=nome).first()
        if not esiste:
            db.add(TesoreriaFornitoreBanca(codice_fornitore=abb.codice_fornitore, nome_banca=nome,
                                           nome_originale=m.controparte))
            db.flush()


# ── Serializzazione ─────────────────────────────────────────────────────────────

def _abbinamenti_json(db: Session, abbinamenti: list) -> list:
    ids = [a.id for a in abbinamenti] or [0]
    scad, mov = {}, {}
    for s in db.query(TesoreriaAbbinamentoScadenza).filter(TesoreriaAbbinamentoScadenza.abbinamento_id.in_(ids)) \
            .order_by(TesoreriaAbbinamentoScadenza.data_scadenza, TesoreriaAbbinamentoScadenza.id):
        scad.setdefault(s.abbinamento_id, []).append(s)
    for abb_id, m in db.query(TesoreriaAbbinamentoMovimento.abbinamento_id, TesoreriaMovimento) \
            .join(TesoreriaMovimento, TesoreriaMovimento.id == TesoreriaAbbinamentoMovimento.movimento_id) \
            .filter(TesoreriaAbbinamentoMovimento.abbinamento_id.in_(ids)).order_by(TesoreriaMovimento.data_contabile):
        mov.setdefault(abb_id, []).append(m)
    out = []
    for a in abbinamenti:
        ss, mm = scad.get(a.id, []), mov.get(a.id, [])
        tot_s = sum((s.importo for s in ss), Decimal("0"))
        tot_m = -sum((m.importo for m in mm), Decimal("0"))
        out.append({
            "id": a.id, "stato": a.stato, "regola": a.regola, "nota": a.nota,
            "codice_fornitore": a.codice_fornitore, "fornitore": a.fornitore,
            "totale_scadenze": euro(tot_s), "totale_movimenti": euro(tot_m), "differenza": euro(tot_m - tot_s),
            "n_scadenze": len(ss),
            "scadenze": [{"chiave": s.chiave, "data_scadenza": s.data_scadenza.isoformat(),
                          "data_documento": s.data_documento.isoformat() if s.data_documento else None,
                          "numero_documento": s.numero_documento, "tipo_pagamento": s.tipo_pagamento,
                          "importo": euro(s.importo)} for s in ss],
            "movimenti": [{"id": m.id, "conto_id": m.conto_id, "data_contabile": m.data_contabile.isoformat(),
                           "importo": euro(m.importo), "controparte": m.controparte, "causale": m.causale,
                           "causale_abi": m.causale_abi} for m in mm],
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "confermato_at": a.confermato_at.isoformat() if a.confermato_at else None,
        })
    return out


def _scadenze_correnti(db: Session, chiavi: list) -> list:
    if not chiavi:
        raise HTTPException(400, "Nessuna scadenza indicata")
    _, scadenze = fotografia_corrente(db)
    per_chiave = {s.chiave: s for s in scadenze}
    mancanti = [k for k in chiavi if k not in per_chiave]
    if mancanti:
        raise HTTPException(400, f"Scadenze non presenti nell'ultimo scadenzario: {len(mancanti)}")
    return [per_chiave[k] for k in dict.fromkeys(chiavi)]


def _togli_automatici(db: Session, chiavi: list):
    """Elimina gli abbinamenti automatici/proposti che coinvolgono queste scadenze."""
    ids = db.query(TesoreriaAbbinamentoScadenza.abbinamento_id).join(
        TesoreriaAbbinamento, TesoreriaAbbinamento.id == TesoreriaAbbinamentoScadenza.abbinamento_id,
    ).filter(TesoreriaAbbinamentoScadenza.chiave.in_(chiavi),
             TesoreriaAbbinamento.stato.in_(("automatico", "proposto")))
    db.query(TesoreriaAbbinamento).filter(TesoreriaAbbinamento.id.in_(ids.scalar_subquery())) \
        .delete(synchronize_session=False)


def _ids(body: dict) -> list:
    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids or not all(isinstance(i, int) for i in ids):
        raise HTTPException(400, "Indicare gli abbinamenti (ids)")
    return ids


# ── Endpoint ────────────────────────────────────────────────────────────────────

@router.get("/scadenzario/abbinamenti")
def elenco_abbinamenti(
    stato: Optional[str] = Query(None, pattern="^(automatico|proposto|confermato|scartato)$"),
    codice_fornitore: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(puo_vedere),
):
    q = db.query(TesoreriaAbbinamento)
    if stato:
        q = q.filter(TesoreriaAbbinamento.stato == stato)
    if codice_fornitore:
        q = q.filter(TesoreriaAbbinamento.codice_fornitore == codice_fornitore)
    conteggi = dict(db.query(TesoreriaAbbinamento.stato, func.count(TesoreriaAbbinamento.id))
                    .group_by(TesoreriaAbbinamento.stato).all())
    return {"conteggi": {s: conteggi.get(s, 0) for s in ("automatico", "proposto", "confermato", "scartato")},
            "abbinamenti": _abbinamenti_json(db, q.order_by(TesoreriaAbbinamento.fornitore, TesoreriaAbbinamento.id).all())}


@router.post("/scadenzario/abbinamenti/ricalcola")
def ricalcola(db: Session = Depends(get_db), _=Depends(puo_modificare)):
    esito = ricalcola_abbinamenti(db)
    db.commit()
    return esito


@router.post("/scadenzario/abbinamenti/conferma")
def conferma_abbinamenti(body: dict = Body(...), db: Session = Depends(get_db), utente=Depends(puo_modificare)):
    abbinamenti = db.query(TesoreriaAbbinamento).filter(TesoreriaAbbinamento.id.in_(_ids(body))).all()
    for a in abbinamenti:
        if a.stato in ("automatico", "proposto"):
            a.stato, a.confermato_at, a.utente_id = "confermato", datetime.now(timezone.utc), getattr(utente, "id", None)
            _impara_nomi(db, a)
    db.commit()
    return {"confermati": [a.id for a in abbinamenti if a.stato == "confermato"]}


@router.post("/scadenzario/abbinamenti/scarta")
def scarta_abbinamenti(body: dict = Body(...), db: Session = Depends(get_db), utente=Depends(puo_modificare)):
    abbinamenti = db.query(TesoreriaAbbinamento).filter(TesoreriaAbbinamento.id.in_(_ids(body))).all()
    for a in abbinamenti:
        if a.stato in ("automatico", "proposto"):
            a.stato, a.utente_id = "scartato", getattr(utente, "id", None)
    db.flush()
    esito = ricalcola_abbinamenti(db)    # le scadenze liberate possono avere un'altra proposta
    db.commit()
    return {"scartati": [a.id for a in abbinamenti if a.stato == "scartato"], "ricalcolo": esito}


@router.delete("/scadenzario/abbinamenti/{abbinamento_id}")
def annulla_abbinamento(abbinamento_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Annulla una scelta (confermato o scartato): l'abbinamento sparisce e si ricalcola."""
    abb = db.get(TesoreriaAbbinamento, abbinamento_id)
    if not abb:
        raise HTTPException(404, "Abbinamento non trovato")
    db.delete(abb)
    db.flush()
    esito = ricalcola_abbinamenti(db)
    db.commit()
    return {"eliminato": abbinamento_id, "ricalcolo": esito}


@router.post("/scadenzario/abbinamenti/manuale")
def abbinamento_manuale(body: dict = Body(...), db: Session = Depends(get_db), utente=Depends(puo_modificare)):
    """Abbina a mano scadenze (chiavi) e movimenti (id): diventa subito confermato."""
    scadenze = _scadenze_correnti(db, body.get("chiavi") or [])
    mov_ids = list(dict.fromkeys(body.get("movimenti") or []))
    if not mov_ids:
        raise HTTPException(400, "Nessun movimento indicato")
    if len({s.codice_fornitore for s in scadenze}) > 1:
        raise HTTPException(400, "Le scadenze devono essere dello stesso fornitore")
    movimenti = db.query(TesoreriaMovimento).filter(TesoreriaMovimento.id.in_(mov_ids)).all()
    if len(movimenti) != len(mov_ids) or any(m.importo >= 0 for m in movimenti):
        raise HTTPException(400, "Movimenti non trovati o non in uscita")
    confermate = _chiavi_in(db, ("confermato",)) & {s.chiave for s in scadenze}
    if confermate:
        raise HTTPException(409, "Alcune scadenze sono già abbinate e confermate: annullare prima quell'abbinamento")
    _togli_automatici(db, [s.chiave for s in scadenze])
    db.query(TesoreriaPagataManuale).filter(TesoreriaPagataManuale.chiave.in_([s.chiave for s in scadenze])) \
        .delete(synchronize_session=False)
    abb = _crea(db, "confermato", "manuale", (body.get("nota") or None), scadenze, mov_ids, getattr(utente, "id", None))
    _impara_nomi(db, abb)
    db.flush()
    esito = ricalcola_abbinamenti(db)
    db.commit()
    risposta = _abbinamenti_json(db, [abb])[0]
    risposta["ricalcolo"] = esito
    return risposta


@router.get("/scadenzario/movimenti-candidati")
def movimenti_candidati(chiave: str, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    """Uscite bancarie per l'abbinamento manuale di una scadenza: ±90 giorni, non già confermate,
    ordinate per somiglianza del nome, vicinanza dell'importo e della data."""
    s = _scadenze_correnti(db, [chiave])[0]
    alias = _alias(db).get(s.codice_fornitore, set())
    usati = _movimenti_in(db, ("confermato",))
    mov = _uscite_pagamento(db, usati, s.data_scadenza - timedelta(days=FINESTRA_CANDIDATI),
                            s.data_scadenza + timedelta(days=FINESTRA_CANDIDATI))
    righe = sorted(mov, key=lambda m: (-forza_nome(s.fornitore, m.controparte, alias),
                                       abs(-m.importo - s.importo), abs((m.data - s.data_scadenza).days)))[:30]
    return [{"id": m.id, "data_contabile": m.data.isoformat(), "importo": euro(m.importo),
             "controparte": m.controparte, "causale_abi": m.causale_abi, "testo": m.testo.strip()[:200],
             "forza_nome": forza_nome(s.fornitore, m.controparte, alias)} for m in righe]


@router.post("/scadenzario/pagate-manuali")
def segna_pagate(body: dict = Body(...), db: Session = Depends(get_db), utente=Depends(puo_modificare)):
    """Segna pagate a mano più scadenze insieme (data di pagamento e nota facoltative)."""
    scadenze = _scadenze_correnti(db, body.get("chiavi") or [])
    data_pag = None
    if body.get("data_pagamento"):
        try:
            data_pag = date.fromisoformat(str(body["data_pagamento"])[:10])
        except ValueError:
            raise HTTPException(400, "Data di pagamento non valida")
    confermate = _chiavi_in(db, ("confermato",)) & {s.chiave for s in scadenze}
    if confermate:
        raise HTTPException(409, f"{len(confermate)} scadenze sono già abbinate a un pagamento in banca")
    presenti = {k for (k,) in db.query(TesoreriaPagataManuale.chiave)
                .filter(TesoreriaPagataManuale.chiave.in_([s.chiave for s in scadenze]))}
    _togli_automatici(db, [s.chiave for s in scadenze])
    nuove = [s for s in scadenze if s.chiave not in presenti]
    db.bulk_insert_mappings(TesoreriaPagataManuale, [
        {"chiave": s.chiave, "data_pagamento": data_pag, "nota": (body.get("nota") or None)[:255] if body.get("nota") else None,
         "codice_fornitore": s.codice_fornitore, "fornitore": s.fornitore, "data_scadenza": s.data_scadenza,
         "data_documento": s.data_documento, "numero_documento": s.numero_documento, "importo": s.importo,
         "utente_id": getattr(utente, "id", None)} for s in nuove
    ])
    db.flush()
    esito = ricalcola_abbinamenti(db)
    db.commit()
    return {"segnate": len(nuove), "gia_segnate": len(presenti), "ricalcolo": esito}


@router.post("/scadenzario/pagate-manuali/rimuovi")
def togli_pagate(body: dict = Body(...), db: Session = Depends(get_db), _=Depends(puo_modificare)):
    chiavi = body.get("chiavi") or []
    if not chiavi:
        raise HTTPException(400, "Nessuna scadenza indicata")
    n = db.query(TesoreriaPagataManuale).filter(TesoreriaPagataManuale.chiave.in_(chiavi)) \
        .delete(synchronize_session=False)
    db.flush()
    esito = ricalcola_abbinamenti(db)
    db.commit()
    return {"rimosse": n, "ricalcolo": esito}


@router.get("/scadenzario/pagate-manuali")
def elenco_pagate(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    return [
        {"chiave": p.chiave, "data_pagamento": p.data_pagamento.isoformat() if p.data_pagamento else None,
         "nota": p.nota, "codice_fornitore": p.codice_fornitore, "fornitore": p.fornitore,
         "data_scadenza": p.data_scadenza.isoformat(), "numero_documento": p.numero_documento,
         "importo": euro(p.importo), "created_at": p.created_at.isoformat() if p.created_at else None}
        for p in db.query(TesoreriaPagataManuale).order_by(TesoreriaPagataManuale.data_scadenza)
    ]
