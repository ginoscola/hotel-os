"""Tesoreria — scheda KPI: andamento del saldo, punto più basso e uso del fido, mesi di autonomia,
costo degli incassi, peso delle uscite sugli incassi, tassa di soggiorno incassata e versata.

Riusa `consuntivo()` e `posizione()` (tesoreria_report) e, per la tassa di soggiorno incassata,
`report_totali()` di Corrispettivi (differenza tra totale con e senza tassa di soggiorno, per mese):
nessuna query duplicata sulle tabelle di Corrispettivi.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tesoreria import TesoreriaCategoria, TesoreriaConto, TesoreriaMovimento
from app.routers.corrispettivi_report import report_totali
from app.routers.tesoreria_report import TIPI_BANCA, _saldi_e_movimenti, consuntivo, posizione
from app.routers.tesoreria_shared import euro, puo_vedere
from app.services.tesoreria_report import (
    ZERO, anno_prima, inverno_di_riferimento, mesi_di_autonomia, minimo_serie, serie_saldi,
)
from app.utils.locale_it import MESI_IT

router = APIRouter()

# Codici ABI delle commissioni sugli incassi POS (PagoBancomat e circuiti internazionali, mensili)
CODICI_COMMISSIONI_POS = ("16//60", "16//63")
CATEGORIA_POS = "incassi_pos"
CATEGORIA_BANCA = "banca"
CATEGORIA_TASSA = "tassa_soggiorno"
GIORNI_PER_MESE = Decimal("30.44")


def _pct(parte, totale) -> Optional[float]:
    return round(float(parte) / float(totale) * 100, 2) if totale else None


def _somma_categoria(db: Session, codice: str, da: date, a: date) -> Decimal:
    return db.query(func.coalesce(func.sum(TesoreriaMovimento.importo), 0)) \
        .join(TesoreriaCategoria, TesoreriaCategoria.id == TesoreriaMovimento.categoria_id) \
        .filter(TesoreriaCategoria.codice == codice, TesoreriaMovimento.data_contabile >= da,
                TesoreriaMovimento.data_contabile <= a).scalar()


def _commissioni_pos(db: Session, da: date, a: date) -> Decimal:
    return db.query(func.coalesce(func.sum(TesoreriaMovimento.importo), 0)) \
        .filter(TesoreriaMovimento.causale_abi.in_(CODICI_COMMISSIONI_POS),
                TesoreriaMovimento.data_contabile >= da, TesoreriaMovimento.data_contabile <= a).scalar()


def _tassa_incassata_per_mese(db: Session, anno: int) -> dict:
    """{mese: tassa di soggiorno incassata} dai Corrispettivi (vuoto se l'anno non ha dati)."""
    con = report_totali(anno=anno, lordo=True, con_ts=True, is_test=False, db=db, _=None)
    senza = report_totali(anno=anno, lordo=True, con_ts=False, is_test=False, db=db, _=None)

    def totale(r, mese):
        return (r["scontrini"]["totale_mese"].get(str(mese), 0) or 0) + (r["fatture"]["totale_mese"].get(str(mese), 0) or 0)

    return {m["mese"]: Decimal(str(round(totale(con, m["mese"]) - totale(senza, m["mese"]), 2))) for m in con["mesi"]}


@router.get("/kpi")
def kpi(anno: Optional[int] = Query(None, ge=2020, le=2100), db: Session = Depends(get_db), _=Depends(puo_vedere)):
    oggi = date.today()
    anno = anno or oggi.year
    fine = min(date(anno, 12, 31), oggi)
    inizio = date(anno, 1, 1)
    ap_inizio, ap_fine, ap_fine_anno = date(anno - 1, 1, 1), anno_prima(fine), date(anno - 1, 12, 31)

    # ── 1-2. Andamento del saldo, punto più basso, uso del fido ────────────────
    conti = db.query(TesoreriaConto).filter(TesoreriaConto.tipo.in_(TIPI_BANCA),
                                            TesoreriaConto.attivo.is_(True)).all()
    saldi, _mov = _saldi_e_movimenti(db, [c.id for c in conti])
    serie = serie_saldi([saldi[c.id] for c in conti], inizio, fine)
    serie_ap = serie_saldi([saldi[c.id] for c in conti], ap_inizio, ap_fine_anno)
    andamento = []
    for g, v in serie.items():
        try:
            g_ap = g.replace(year=g.year - 1)
        except ValueError:      # 29 febbraio
            continue
        andamento.append({"data": g.isoformat(), "etichetta": g.strftime("%d/%m"),
                          "saldo": euro(v), "saldo_ap": euro(serie_ap.get(g_ap))})

    def _minimo(s):
        m = minimo_serie(s)
        return {"data": m[0].isoformat(), "saldo": euro(m[1])} if m else None

    fido = []
    for c in conti:
        if not c.fido:
            continue
        righe = {}
        for chiave, (da, a) in {"anno": (inizio, fine), "ap": (ap_inizio, ap_fine)}.items():
            s = serie_saldi([saldi[c.id]], da, a)
            valori = [v for v in s.values() if v is not None]
            minimo = min(valori) if valori else None
            utilizzo = -minimo if minimo is not None and minimo < 0 else ZERO
            righe[chiave] = {"saldo_minimo": euro(minimo), "giorni_sotto_zero": sum(1 for v in valori if v < 0),
                             "utilizzo_massimo": euro(utilizzo), "utilizzo_pct": _pct(utilizzo, c.fido)}
        fido.append({"conto_id": c.id, "nome": c.nome, "fido": euro(c.fido), **righe})

    # ── 3. Mesi di autonomia ────────────────────────────────────────────────────
    pos = posizione(giorno=oggi, db=db, _=None)
    inv_da, inv_a = inverno_di_riferimento(oggi)
    inverno = consuntivo(data_da=inv_da, data_a=inv_a, conto_id=None, db=db, _=None)
    netti = [Decimal(str(m["netto_operativo"])) for m in inverno["mensile"]]
    auto = mesi_di_autonomia(Decimal(str(pos["liquidita_netta"])), netti)
    autonomia = {
        "liquidita_netta": pos["liquidita_netta"],
        "inverno_da": inv_da.isoformat(), "inverno_a": inv_a.isoformat(),
        "inverno_completo": inverno["copertura_dal"] is not None and inverno["copertura_dal"] <= inv_da.isoformat(),
        "consumo_mensile": euro(auto["consumo_mensile"]) if auto else None,
        "mesi": round(float(auto["mesi"]), 1) if auto else None,
        "data_esaurimento": (oggi + timedelta(days=int(auto["mesi"] * GIORNI_PER_MESE))).isoformat()
        if auto and auto["mesi"] > 0 else None,
    }

    # ── 6. Costo degli incassi ──────────────────────────────────────────────────
    att = consuntivo(data_da=inizio, data_a=fine, conto_id=None, db=db, _=None)
    prec = consuntivo(data_da=ap_inizio, data_a=ap_fine, conto_id=None, db=db, _=None)

    def _costo(da, a, c):
        incassi_pos = _somma_categoria(db, CATEGORIA_POS, da, a)
        commissioni = -_commissioni_pos(db, da, a)
        banca = -_somma_categoria(db, CATEGORIA_BANCA, da, a)
        entrate = Decimal(str(c["kpi"]["entrate"]["valore"] or 0))
        return {"incassi_pos": euro(incassi_pos), "commissioni_pos": euro(commissioni),
                "commissioni_pos_pct": _pct(commissioni, incassi_pos),
                "costi_banca": euro(banca), "entrate_operative": euro(entrate), "costi_banca_pct": _pct(banca, entrate)}

    costo_incassi = {"anno": _costo(inizio, fine, att), "ap": _costo(ap_inizio, ap_fine, prec)}

    # ── 8. Peso delle uscite sugli incassi ─────────────────────────────────────
    entrate_att = att["kpi"]["entrate"]["valore"] or 0
    entrate_prec = prec["kpi"]["entrate"]["valore"] or 0
    uscite_prec = {r["categoria_id"]: r["uscite"] for r in prec["categorie"]}
    peso = []
    for r in att["categorie"]:
        # solo categorie di uscita (gli storni dentro una categoria di entrata non sono un costo)
        if not r["operativa"] or r["tipo"] == "entrata" or not r["uscite"] and not uscite_prec.get(r["categoria_id"]):
            continue
        u, u_ap = -(r["uscite"] or 0), -(uscite_prec.get(r["categoria_id"]) or 0)
        p, p_ap = _pct(u, entrate_att), _pct(u_ap, entrate_prec)
        peso.append({"categoria_id": r["categoria_id"], "nome": r["nome"], "colore": r["colore"],
                     "uscite": round(u, 2), "pct": p, "uscite_ap": round(u_ap, 2), "pct_ap": p_ap,
                     "delta_punti": round(p - p_ap, 2) if p is not None and p_ap is not None else None})
    peso.sort(key=lambda x: -x["uscite"])

    # ── 10. Tassa di soggiorno incassata e versata ─────────────────────────────
    incassata = _tassa_incassata_per_mese(db, anno)
    versata = defaultdict(lambda: ZERO)
    for mese, somma in db.query(extract("month", TesoreriaMovimento.data_contabile), func.sum(TesoreriaMovimento.importo)) \
            .join(TesoreriaCategoria, TesoreriaCategoria.id == TesoreriaMovimento.categoria_id) \
            .filter(TesoreriaCategoria.codice == CATEGORIA_TASSA, TesoreriaMovimento.data_contabile >= inizio,
                    TesoreriaMovimento.data_contabile <= date(anno, 12, 31)) \
            .group_by(extract("month", TesoreriaMovimento.data_contabile)):
        versata[int(mese)] = -somma
    mesi_tassa, cumulata = [], ZERO
    for mese in sorted(set(incassata) | set(versata)):
        inc, ver = incassata.get(mese, ZERO), versata.get(mese, ZERO)
        cumulata += inc - ver
        mesi_tassa.append({"mese": mese, "etichetta": MESI_IT[mese - 1], "incassata": euro(inc),
                           "versata": euro(ver), "da_versare_cumulato": euro(cumulata)})
    tot_inc, tot_ver = sum(incassata.values(), ZERO), sum(versata.values(), ZERO)
    tassa = {"disponibile": bool(incassata), "incassata": euro(tot_inc), "versata": euro(tot_ver),
             "da_versare": euro(tot_inc - tot_ver), "mesi": mesi_tassa}

    return {
        "anno": anno, "fino_al": fine.isoformat(), "ap_fino_al": ap_fine.isoformat(),
        "andamento": andamento,
        "minimo": {"anno": _minimo(serie), "ap_stesso_periodo": _minimo({g: v for g, v in serie_ap.items() if g <= ap_fine}),
                   "ap_intero": _minimo(serie_ap)},
        "fido": fido,
        "autonomia": autonomia,
        "costo_incassi": costo_incassi,
        "peso_uscite": peso,
        "tassa_soggiorno": tassa,
    }
