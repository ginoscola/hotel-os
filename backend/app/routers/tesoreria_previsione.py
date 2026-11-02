"""Tesoreria — previsione di cassa (Fase 3, blocco C): raccoglie saldo, storico banca, Budget, impegni e scadenzario e
chiama services/tesoreria_previsione.py. Tutto calcolato alla richiesta: una modifica al Budget o agli impegni vale subito.
"""

import json
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import AppConfig
from app.models.tesoreria import (
    TesoreriaCategoria, TesoreriaConto, TesoreriaImpegno, TesoreriaMovimento, TesoreriaRicorrente,
)
from app.routers.budget import ricavi_budget_anno, ricavi_consuntivo_anno
from app.routers.corrispettivi_report import report_fatturati
from app.routers.tesoreria_impegni import leggi_parametri as leggi_parametri_fiscali
from app.routers.tesoreria_impegni_abbina import importo_impegno
from app.routers.tesoreria_report import TIPI_BANCA, _saldi_e_movimenti
from app.routers.tesoreria_scadenzario_report import stato_scadenze
from app.routers.tesoreria_shared import euro, puo_modificare, puo_vedere
from app.services.budget_ristoranti import totale_budget_anno
from app.services.tesoreria_previsione import (
    GRUPPI_CRESCITA, SCENARI, TIPI_FISCO, Certa, DatiPrevisione, calcola_scenario, fattore_budget, parametri_default,
)
from app.services.tesoreria_saldi import saldo_a_data

router = APIRouter()

CHIAVE_PARAMETRI = "tesoreria_previsione_parametri"
GRUPPO_DA_TIPO = {"affitto": "affitti", "mutuo": "mutuo", "ricorrente": "ricorrenti", "intervento": "interventi", "carta": "carte"}
STATI_SCADENZA_APERTA = ("aperta", "scaduta", "da_confermare")


def leggi_parametri(db: Session) -> dict:
    parametri = parametri_default()
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_PARAMETRI).first()
    if riga:
        try:
            salvati = json.loads(riga.value)
            parametri["crescita"].update(salvati.get("crescita", {}))
            for nome, valori in salvati.get("scenari", {}).items():
                if nome in parametri["scenari"]:
                    parametri["scenari"][nome].update(valori)
        except (ValueError, TypeError, AttributeError):
            pass   # config corrotta: restano i default
    return parametri


def _valida(corpo: dict) -> None:
    for gruppo, valore in corpo.get("crescita", {}).items():
        if gruppo not in GRUPPI_CRESCITA:
            raise HTTPException(400, f"Gruppo sconosciuto: {gruppo}")
        if valore is not None and not isinstance(valore, (int, float)):
            raise HTTPException(400, f"Crescita non valida per {gruppo}")
    for nome, valori in corpo.get("scenari", {}).items():
        if nome not in SCENARI:
            raise HTTPException(400, f"Scenario sconosciuto: {nome}")
        for chiave, valore in valori.items():
            if chiave not in ("incassi_pct", "uscite_stimate_pct") or not isinstance(valore, (int, float)):
                raise HTTPException(400, f"Parametro non valido nello scenario {nome}: {chiave}")


def _storico_banca(db: Session) -> tuple:
    anno, mese = extract("year", TesoreriaMovimento.data_contabile), extract("month", TesoreriaMovimento.data_contabile)
    conti_banca = db.query(TesoreriaConto.id).filter(TesoreriaConto.tipo.in_(TIPI_BANCA))
    base = db.query(anno, mese, func.sum(TesoreriaMovimento.importo)).join(
        TesoreriaCategoria, TesoreriaCategoria.id == TesoreriaMovimento.categoria_id,
    ).filter(TesoreriaMovimento.conto_id.in_(conti_banca), TesoreriaCategoria.escludi_da_operativo.is_(False))
    entrate = {(int(a), int(m)): v for a, m, v in base.filter(TesoreriaMovimento.importo > 0).group_by(anno, mese)}
    uscite = {}
    righe = db.query(TesoreriaCategoria.codice, anno, mese, func.sum(TesoreriaMovimento.importo)).join(
        TesoreriaCategoria, TesoreriaCategoria.id == TesoreriaMovimento.categoria_id,
    ).filter(TesoreriaMovimento.conto_id.in_(conti_banca), TesoreriaMovimento.importo < 0,
             TesoreriaMovimento.straordinario.is_(False)).group_by(TesoreriaCategoria.codice, anno, mese)
    for codice, a, m, v in righe:
        uscite.setdefault(codice, {})[(int(a), int(m))] = -v
    return entrate, uscite


def _ricavi_e_budget(db: Session, anni: range) -> tuple:
    """Hotel (dati Revenue) + ristoranti (incassi manuali), IVA inclusa: stessa base del Budget."""
    ricavi, budget = {}, {}
    for anno in anni:
        hotel = ricavi_consuntivo_anno(db, anno)
        if hotel:
            r = report_fatturati(anno=anno, lordo=True, is_test=False, db=db, _=None)
            ricavi[anno] = hotel + Decimal(str(round(sum(m["totale_ristoranti"] for m in r["mesi"]), 2)))
        b = ricavi_budget_anno(db, anno) + totale_budget_anno(db, anno)
        if b:
            budget[anno] = b
    return ricavi, budget


def _certe(db: Session, oggi: date) -> list:
    ricorrenti = {r.id: r.categoria_id for r in db.query(TesoreriaRicorrente).all()}
    categorie = {c.id: c.codice for c in db.query(TesoreriaCategoria).all()}
    out = []
    for i in db.query(TesoreriaImpegno).filter(TesoreriaImpegno.stato != "pagato"):
        da_pagare = importo_impegno(i) - i.coperto_credito - i.coperto_altri
        if da_pagare <= 0:
            continue
        gruppo = "fisco" if i.tipo in TIPI_FISCO else GRUPPO_DA_TIPO.get(i.tipo, "altri_impegni")
        categoria = None
        if i.tipo == "ricorrente":
            categoria = categorie.get(ricorrenti.get(int(i.codice.split(":")[1])))
        elif i.tipo == "carta":
            categoria = "carte"
        out.append(Certa(i.data_scadenza, da_pagare, gruppo, categoria))
    for s in stato_scadenze(db, oggi)["scadenze"]:
        if s["stato"] in STATI_SCADENZA_APERTA and s["aperto"] > 0:
            out.append(Certa(s["data_scadenza"], Decimal(str(s["aperto"])), "fornitori", "fornitori_bonifici"))
    return out


def dati_previsione(db: Session, oggi: date) -> DatiPrevisione:
    orizzonte = date.fromisoformat(leggi_parametri_fiscali(db)["orizzonte"])
    conti = db.query(TesoreriaConto).filter(TesoreriaConto.tipo.in_(TIPI_BANCA), TesoreriaConto.attivo.is_(True)).all()
    saldi, movimenti = _saldi_e_movimenti(db, [c.id for c in conti])
    saldo = sum((saldo_a_data(oggi, saldi[c.id], movimenti[c.id]) or Decimal(0) for c in conti), Decimal(0))
    entrate, uscite = _storico_banca(db)
    ricavi, budget = _ricavi_e_budget(db, range(oggi.year - 1, orizzonte.year + 1))
    return DatiPrevisione(
        oggi=oggi, orizzonte=orizzonte, saldo_iniziale=saldo, entrate=entrate, uscite=uscite, certe=_certe(db, oggi),
        budget=budget, ricavi=ricavi, fidi=[(c.fido, c.fido_scadenza) for c in conti if c.fido],
        parametri=leggi_parametri(db),
    )


def _riga_json(r: dict) -> dict:
    return {
        "anno": r["anno"], "mese": r["mese"], "stato": r["stato"], "fido": euro(r["fido"]),
        **{k: euro(r[k]) for k in ("saldo_iniziale", "entrate", "totale_certe", "totale_stimate", "saldo_finale",
                                   "cassa_impegnata_90", "cassa_libera")},
        "uscite_certe": {k: euro(v) for k, v in r["uscite_certe"].items()},
        "uscite_stimate": {k: euro(v) for k, v in r["uscite_stimate"].items()},
    }


@router.get("/previsione")
def previsione(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    oggi = date.today()
    d = dati_previsione(db, oggi)
    scenari = {nome: [_riga_json(r) for r in calcola_scenario(d, nome)] for nome in SCENARI}
    minimi = {nome: min(righe, key=lambda r: r["saldo_finale"]) for nome, righe in scenari.items()}
    anno_budget = max(d.budget) if d.budget else None
    return {
        "oggi": oggi.isoformat(), "saldo_iniziale": euro(d.saldo_iniziale),
        "budget": {str(a): euro(v) for a, v in d.budget.items()}, "ricavi": {str(a): euro(v) for a, v in d.ricavi.items()},
        "fattore_budget": round(float(fattore_budget(anno_budget, d.budget, d.ricavi)), 4) if anno_budget else None,
        "parametri": d.parametri, "scenari": scenari,
        "minimi": {nome: {"anno": r["anno"], "mese": r["mese"], "saldo": r["saldo_finale"], "stato": r["stato"]} for nome, r in minimi.items()},
    }


@router.get("/previsione/parametri")
def get_parametri(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    return leggi_parametri(db)


@router.put("/previsione/parametri")
def put_parametri(corpo: dict, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    _valida(corpo)
    attuali = leggi_parametri(db)
    attuali["crescita"].update(corpo.get("crescita", {}))
    for nome, valori in corpo.get("scenari", {}).items():
        attuali["scenari"][nome].update(valori)
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_PARAMETRI).first()
    if riga:
        riga.value = json.dumps(attuali)
    else:
        db.add(AppConfig(key=CHIAVE_PARAMETRI, value=json.dumps(attuali)))
    db.commit()
    return attuali
