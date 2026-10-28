"""Tesoreria — posizione attuale (con avvisi di freschezza), consuntivo, soglie degli avvisi.

Collegamento con Corrispettivi: i contanti in cassa sono la "Cassa reale" di gruppo letta da
`riepilogo_cassa()` (`corrispettivi_cassa.py`), chiamata come funzione — mai riaggregata qui.
"""

import json
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import AppConfig
from app.models.tesoreria import (
    TesoreriaCategoria, TesoreriaConto, TesoreriaImport, TesoreriaMovimento, TesoreriaSaldo,
)
from app.routers.corrispettivi_cassa import riepilogo_cassa
from app.routers.tesoreria_shared import euro, id_ripiego, puo_modificare, puo_vedere
from app.services.tesoreria_report import (
    CHIAVE_SOGLIE, SOGLIE_DEFAULT, ZERO, aggrega, anno_prima, giorno_prima, mesi_tra, stato_fido,
    ultimo_giorno_mese, valida_soglie,
)
from app.services.tesoreria_saldi import saldo_a_data, verifica_saldi
from app.utils.locale_it import MESI_IT, formatta_data_it, formatta_euro_it

router = APIRouter()

CATEGORIA_GIROCONTI = "giroconti"
TIPI_BANCA = ("conto",)


# ── Soglie avvisi ───────────────────────────────────────────────────────────────

def leggi_soglie(db: Session) -> dict:
    soglie = dict(SOGLIE_DEFAULT)
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_SOGLIE).first()
    if riga:
        try:
            soglie.update(valida_soglie(json.loads(riga.value)))
        except (ValueError, TypeError):
            pass   # config corrotta: restano i default
    return soglie


@router.get("/soglie")
def get_soglie(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    return leggi_soglie(db)


@router.put("/soglie")
def put_soglie(body: dict = Body(...), db: Session = Depends(get_db), _=Depends(puo_modificare)):
    """Aggiornamento parziale: le chiavi non inviate restano."""
    try:
        nuove = valida_soglie(body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    soglie = {**leggi_soglie(db), **nuove}
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_SOGLIE).first()
    if riga is None:
        riga = AppConfig(key=CHIAVE_SOGLIE, description="Tesoreria: soglie in giorni degli avvisi di freschezza")
        db.add(riga)
    riga.value = json.dumps(soglie)
    db.commit()
    return soglie


# ── Dati comuni ─────────────────────────────────────────────────────────────────

def _saldi_e_movimenti(db: Session, conto_ids: list) -> tuple:
    """({conto_id: {data: saldo}}, {conto_id: [(data, importo)]}) per il calcolo dei saldi a data."""
    saldi, movimenti = defaultdict(dict), defaultdict(list)
    if not conto_ids:
        return saldi, movimenti
    for cid, giorno, saldo in db.query(TesoreriaSaldo.conto_id, TesoreriaSaldo.data, TesoreriaSaldo.saldo) \
            .filter(TesoreriaSaldo.conto_id.in_(conto_ids)):
        saldi[cid][giorno] = saldo
    for cid, giorno, importo in db.query(TesoreriaMovimento.conto_id, TesoreriaMovimento.data_contabile,
                                         TesoreriaMovimento.importo) \
            .filter(TesoreriaMovimento.conto_id.in_(conto_ids)):
        movimenti[cid].append((giorno, importo))
    return saldi, movimenti


def _contanti(db: Session, giorno: date) -> dict:
    """Cassa reale di Corrispettivi all'ultimo mese con dati dell'anno di `giorno` (o dell'anno prima,
    se quest'anno non ha ancora né incassi né un saldo iniziale)."""
    for anno in (giorno.year, giorno.year - 1):
        cassa = riepilogo_cassa(anno=anno, is_test=False, db=db, _=None)
        saldo_ini = cassa.get("saldo_iniziale")
        if not cassa["mesi"] and not (saldo_ini and saldo_ini["data"].startswith(str(anno))):
            continue
        if cassa["mesi"]:
            ultimo = cassa["mesi"][-1]["mese"]
            riferimento = min(ultimo_giorno_mese(anno, ultimo), giorno)
            mese_txt = f"{MESI_IT[ultimo - 1]} {anno}"
        else:
            riferimento, mese_txt = date.fromisoformat(saldo_ini["data"]), "saldo iniziale"
        return {"importo": Decimal(str(cassa["saldo_corrente"])), "data_riferimento": riferimento,
                "descrizione": mese_txt}
    return {"importo": None, "data_riferimento": None, "descrizione": None}


# ── Posizione attuale ───────────────────────────────────────────────────────────

@router.get("/posizione")
def posizione(giorno: Optional[date] = None, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    giorno = giorno or date.today()
    soglie = leggi_soglie(db)
    conti = db.query(TesoreriaConto).filter(TesoreriaConto.attivo.is_(True)) \
        .order_by(TesoreriaConto.ordine, TesoreriaConto.id).all()
    saldi, movimenti = _saldi_e_movimenti(db, [c.id for c in conti])
    ultimi_import = dict(
        db.query(TesoreriaImport.conto_id, func.max(TesoreriaImport.created_at)).group_by(TesoreriaImport.conto_id)
    )
    copertura = dict(
        db.query(TesoreriaImport.conto_id, func.max(TesoreriaImport.data_a)).group_by(TesoreriaImport.conto_id)
    )
    avvisi = []
    voci = {"banche": ZERO, "contanti_conti": ZERO, "prepagate": ZERO, "carte": ZERO, "fidi": ZERO}
    conti_out = []

    for c in conti:
        noti = {d: s for d, s in saldi[c.id].items() if d <= giorno}
        ultimo_noto = max(noti) if noti else None
        if c.tipo in TIPI_BANCA:
            saldo = saldo_a_data(giorno, saldi[c.id], movimenti[c.id])
        else:
            saldo = noti[ultimo_noto] if ultimo_noto else None
        fido = stato_fido(c.fido, c.fido_scadenza, giorno, soglie["giorni_preavviso_fido"])

        if saldo is not None:
            if c.tipo in TIPI_BANCA:
                voci["banche"] += saldo
            elif c.tipo == "cassa":
                voci["contanti_conti"] += saldo
            elif c.tipo == "prepagata":
                voci["prepagate"] += saldo
            elif c.tipo == "carta_credito":
                voci["carte"] += saldo
        if fido["conteggiato"]:
            voci["fidi"] += c.fido

        # Avvisi
        if c.ha_import:
            caricato = ultimi_import.get(c.id)
            if caricato is None:
                avvisi.append({"livello": "arancione", "tipo": "estratto", "conto_id": c.id,
                               "messaggio": f"{c.nome}: nessun estratto conto caricato"})
            else:
                giorni = (giorno - caricato.date()).days
                if giorni > soglie["giorni_estratto"]:
                    fino = copertura.get(c.id)
                    avvisi.append({
                        "livello": "arancione", "tipo": "estratto", "conto_id": c.id,
                        "messaggio": f"{c.nome}: ultimo estratto conto caricato {giorni} giorni fa "
                                     f"(movimenti fino al {formatta_data_it(fino) if fino else '—'})",
                    })
            for x in verifica_saldi(saldi[c.id], movimenti[c.id]):
                avvisi.append({
                    "livello": "rosso", "tipo": "discrepanza", "conto_id": c.id,
                    "messaggio": f"{c.nome}: i saldi del {formatta_data_it(x.data_da)} e del "
                                 f"{formatta_data_it(x.data_a)} non tornano con i movimenti "
                                 f"(differenza {formatta_euro_it(x.differenza)}): manca un estratto conto?",
                })
        elif c.tipo in ("carta_credito", "prepagata"):
            if ultimo_noto is None:
                avvisi.append({"livello": "arancione", "tipo": "saldo_manuale", "conto_id": c.id,
                               "messaggio": f"{c.nome}: nessun saldo inserito"})
            elif (giorno - ultimo_noto).days > soglie["giorni_saldo_carta"]:
                avvisi.append({"livello": "arancione", "tipo": "saldo_manuale", "conto_id": c.id,
                               "messaggio": f"{c.nome}: saldo fermo al {formatta_data_it(ultimo_noto)} "
                                            f"({(giorno - ultimo_noto).days} giorni fa)"})
        if fido["livello"] == "rosso":
            avvisi.append({"livello": "rosso", "tipo": "fido", "conto_id": c.id,
                           "messaggio": f"{c.nome}: fido scaduto il {formatta_data_it(c.fido_scadenza)}, "
                                        "non conteggiato nella disponibilità — aggiornare se rinnovato"})
        elif fido["livello"] == "arancione":
            avvisi.append({"livello": "arancione", "tipo": "fido", "conto_id": c.id,
                           "messaggio": f"{c.nome}: fido in scadenza il {formatta_data_it(c.fido_scadenza)} "
                                        f"(tra {fido['giorni_alla_scadenza']} giorni)"})

        conti_out.append({
            "id": c.id, "codice": c.codice, "nome": c.nome, "tipo": c.tipo, "colore": c.colore,
            "saldo": euro(saldo), "data_ultimo_saldo": ultimo_noto.isoformat() if ultimo_noto else None,
            "ha_import": c.ha_import, "fido": euro(c.fido),
            "fido_scadenza": c.fido_scadenza.isoformat() if c.fido_scadenza else None,
            "fido_conteggiato": fido["conteggiato"], "fido_giorni_alla_scadenza": fido["giorni_alla_scadenza"],
        })

    cassa = _contanti(db, giorno)
    if cassa["importo"] is None:
        avvisi.append({"livello": "arancione", "tipo": "contanti", "conto_id": None,
                       "messaggio": "Contanti in cassa non disponibili (Corrispettivi → Cassa senza dati)"})
    contanti = (cassa["importo"] or ZERO) + voci["contanti_conti"]
    liquidita = voci["banche"] + contanti + voci["prepagate"] - voci["carte"]

    ripiego = id_ripiego(db)
    n_da_class, imp_da_class = db.query(func.count(TesoreriaMovimento.id),
                                        func.coalesce(func.sum(TesoreriaMovimento.importo), 0)) \
        .filter((TesoreriaMovimento.categoria_id == ripiego) | TesoreriaMovimento.categoria_id.is_(None)).one()
    if n_da_class:
        avvisi.append({"livello": "info", "tipo": "da_classificare", "conto_id": None,
                       "messaggio": f"{n_da_class} movimenti da classificare"})

    ordine_livello = {"rosso": 0, "arancione": 1, "info": 2}
    return {
        "giorno": giorno.isoformat(),
        "saldo_banche": euro(voci["banche"]),
        "contanti": euro(contanti),
        "contanti_cassa_reale": euro(cassa["importo"]),
        "contanti_data_riferimento": cassa["data_riferimento"].isoformat() if cassa["data_riferimento"] else None,
        "contanti_descrizione": cassa["descrizione"],
        "prepagate": euro(voci["prepagate"]),
        "carte_da_addebitare": euro(-voci["carte"]),
        "liquidita_netta": euro(liquidita),
        "fidi": euro(voci["fidi"]),
        "disponibilita_con_fido": euro(liquidita + voci["fidi"]),
        "conti": conti_out,
        "n_da_classificare": n_da_class,
        "importo_da_classificare": euro(Decimal(imp_da_class)),
        "avvisi": sorted(avvisi, key=lambda a: ordine_livello[a["livello"]]),
        "soglie": soglie,
    }


# ── Consuntivo ──────────────────────────────────────────────────────────────────

def _somme(t) -> dict:
    return {"n": t.n, "entrate": euro(t.entrate), "uscite": euro(t.uscite), "netto": euro(t.netto)}


def _delta(attuale: Decimal, precedente: Decimal) -> dict:
    diff = attuale - precedente
    pct = (diff / abs(precedente) * 100) if precedente else None
    return {"delta": euro(diff), "delta_pct": round(float(pct), 1) if pct is not None else None}


@router.get("/consuntivo")
def consuntivo(data_da: date, data_a: date, conto_id: Optional[int] = None,
               db: Session = Depends(get_db), _=Depends(puo_vedere)):
    if data_a < data_da:
        raise HTTPException(400, "Periodo non valido: la data finale precede quella iniziale")
    q = db.query(TesoreriaConto).filter(TesoreriaConto.tipo.in_(TIPI_BANCA))
    if conto_id:
        conti = q.filter(TesoreriaConto.id == conto_id).all()
        if not conti:
            raise HTTPException(404, "Conto non trovato (il consuntivo è solo per i conti bancari)")
    else:
        conti = q.filter(TesoreriaConto.attivo.is_(True)).all()
    ids = [c.id for c in conti]
    ap_da, ap_a = anno_prima(data_da), anno_prima(data_a)

    categorie = {c.id: c for c in db.query(TesoreriaCategoria).all()}
    ripiego = id_ripiego(db)
    non_operative = {i for i, c in categorie.items() if c.escludi_da_operativo}
    escluse = set() if conto_id else {i for i, c in categorie.items() if c.codice == CATEGORIA_GIROCONTI}

    def _movimenti(da, a):
        return db.query(TesoreriaMovimento.data_contabile, TesoreriaMovimento.importo,
                        TesoreriaMovimento.categoria_id) \
            .filter(TesoreriaMovimento.conto_id.in_(ids), TesoreriaMovimento.data_contabile >= da,
                    TesoreriaMovimento.data_contabile <= a).all() if ids else []

    att = aggrega(_movimenti(data_da, data_a), non_operative, escluse, ripiego)
    prec = aggrega(_movimenti(ap_da, ap_a), non_operative, escluse, ripiego)

    saldi, movimenti = _saldi_e_movimenti(db, ids)

    def _saldo(giorno):
        valori = [saldo_a_data(giorno, saldi[i], movimenti[i]) for i in ids]
        valori = [v for v in valori if v is not None]
        return sum(valori, ZERO) if valori else None

    saldo_inizio, saldo_fine = _saldo(giorno_prima(data_da)), _saldo(data_a)
    saldo_inizio_ap, saldo_fine_ap = _saldo(giorno_prima(ap_da)), _saldo(ap_a)
    prime_date = [min(saldi[i]) for i in ids if saldi[i]]
    copertura_dal = min(prime_date) if prime_date else None

    variazione = (saldo_fine - saldo_inizio) if saldo_inizio is not None and saldo_fine is not None else None
    spiegata = att.operativi.netto + att.non_operativi.netto + att.giroconti_esclusi.netto

    righe = []
    for cat_id in set(att.per_categoria) | set(prec.per_categoria):
        cat = categorie.get(cat_id)
        a, p = att.per_categoria.get(cat_id), prec.per_categoria.get(cat_id)
        netto_a = a.netto if a else ZERO
        netto_p = p.netto if p else ZERO
        righe.append({
            "categoria_id": cat_id, "codice": cat.codice if cat else None,
            "nome": cat.nome if cat else "Da classificare", "colore": cat.colore if cat else None,
            "tipo": cat.tipo if cat else None, "ordine": cat.ordine if cat else 999,
            "operativa": cat_id not in non_operative,
            "n": a.n if a else 0, "entrate": euro(a.entrate) if a else 0.0,
            "uscite": euro(a.uscite) if a else 0.0, "netto": euro(netto_a),
            "n_ap": p.n if p else 0, "netto_ap": euro(netto_p), **_delta(netto_a, netto_p),
        })
    righe.sort(key=lambda r: (not r["operativa"], r["ordine"]))

    mensile = []
    for anno, mese in mesi_tra(data_da, data_a):
        t = att.per_mese.get((anno, mese))
        tp = prec.per_mese.get((anno - 1, mese))
        mensile.append({
            "anno": anno, "mese": mese, "etichetta": f"{MESI_IT[mese - 1][:3]} {anno}",
            "entrate": euro(t.entrate) if t else 0.0, "uscite": euro(t.uscite) if t else 0.0,
            "netto_operativo": euro(t.netto) if t else 0.0,
            "netto_operativo_ap": euro(tp.netto) if tp else 0.0,
        })

    def _kpi(attuale, precedente):
        return {"valore": euro(attuale), "anno_precedente": euro(precedente),
                **(_delta(attuale, precedente) if attuale is not None and precedente is not None
                   else {"delta": None, "delta_pct": None})}

    return {
        "data_da": data_da.isoformat(), "data_a": data_a.isoformat(),
        "ap_data_da": ap_da.isoformat(), "ap_data_a": ap_a.isoformat(),
        "conto_id": conto_id, "conti": [{"id": c.id, "codice": c.codice, "nome": c.nome} for c in conti],
        "copertura_dal": copertura_dal.isoformat() if copertura_dal else None,
        # Il primo saldo noto è la chiusura del giorno prima del primo movimento importato
        "ap_completo": bool(copertura_dal and copertura_dal <= ap_da),
        "kpi": {
            "entrate": _kpi(att.operativi.entrate, prec.operativi.entrate),
            "uscite": _kpi(att.operativi.uscite, prec.operativi.uscite),
            "netto_operativo": _kpi(att.operativi.netto, prec.operativi.netto),
            "non_operativi": _kpi(att.non_operativi.netto, prec.non_operativi.netto),
            "saldo_inizio": _kpi(saldo_inizio, saldo_inizio_ap),
            "saldo_fine": _kpi(saldo_fine, saldo_fine_ap),
        },
        "giroconti_esclusi": _somme(att.giroconti_esclusi),
        "quadratura": {
            "variazione_saldo": euro(variazione), "spiegata_dai_movimenti": euro(spiegata),
            "ok": variazione is not None and variazione == spiegata,
        },
        "categorie": righe,
        "mensile": mensile,
    }
