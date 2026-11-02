"""Tesoreria — previsione di cassa (Fase 3, blocco C): raccoglie saldo, storico banca, Budget, impegni e scadenzario e
chiama services/tesoreria_previsione.py. Tutto calcolato alla richiesta: una modifica al Budget o agli impegni vale subito.
"""

import json
from datetime import date
from decimal import Decimal

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import AppConfig
from app.models.revenue import User
from app.models.tesoreria import (
    TesoreriaCategoria, TesoreriaConto, TesoreriaImpegno, TesoreriaIntervento, TesoreriaMovimento,
    TesoreriaPrevisioneSalvata, TesoreriaRicorrente,
)
from app.routers.corrispettivi_documenti import _risposta_tabella
from app.routers.budget import ricavi_budget_anno, ricavi_consuntivo_anno
from app.routers.corrispettivi_report import report_fatturati
from app.routers.tesoreria_impegni import leggi_parametri as leggi_parametri_fiscali
from app.routers.tesoreria_impegni_abbina import importo_impegno
from app.routers.tesoreria_report import TIPI_BANCA, _saldi_e_movimenti
from app.routers.tesoreria_scadenzario_report import stato_scadenze
from app.routers.tesoreria_piani import rate_intervento
from app.routers.tesoreria_shared import cella_importo, euro, puo_modificare, puo_vedere
from app.services.budget_ristoranti import totale_budget_anno
from app.services.tesoreria_previsione import (
    GRUPPI_CRESCITA, SCENARI, TIPI_FISCO, Certa, DatiPrevisione, applica_prova, calcola_scenario, fattore_budget, fine_mese,
    mesi_tra, parametri_default,
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
        out.append(Certa(i.data_scadenza, da_pagare, gruppo, categoria, i.id, i.codice))
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


def _storico_saldi(db: Session, oggi: date, n_mesi: int = 12) -> list:
    """Saldo reale dei conti a fine mese, ultimi `n_mesi` mesi conclusi."""
    conti = db.query(TesoreriaConto).filter(TesoreriaConto.tipo.in_(TIPI_BANCA), TesoreriaConto.attivo.is_(True)).all()
    saldi, movimenti = _saldi_e_movimenti(db, [c.id for c in conti])
    y, m = oggi.year, oggi.month
    inizio = (y - 1, m) if m > 1 else (y - 2, 12)
    out = []
    for a, me in mesi_tra(date(inizio[0], inizio[1], 1), oggi)[:n_mesi]:
        fine = fine_mese(a, me)
        if fine >= oggi:
            continue
        valori = [saldo_a_data(fine, saldi[c.id], movimenti[c.id]) for c in conti]
        if all(v is None for v in valori):
            continue
        out.append({"anno": a, "mese": me, "saldo": euro(sum((v or Decimal(0) for v in valori), Decimal(0)))})
    return out


def _risposta(d: DatiPrevisione, db: Session) -> dict:
    scenari = {nome: [_riga_json(r) for r in calcola_scenario(d, nome)] for nome in SCENARI}
    minimi = {nome: min(righe, key=lambda r: r["saldo_finale"]) for nome, righe in scenari.items()}
    anno_budget = max(d.budget) if d.budget else None
    return {
        "oggi": d.oggi.isoformat(), "saldo_iniziale": euro(d.saldo_iniziale),
        "budget": {str(a): euro(v) for a, v in d.budget.items()}, "ricavi": {str(a): euro(v) for a, v in d.ricavi.items()},
        "fattore_budget": round(float(fattore_budget(anno_budget, d.budget, d.ricavi)), 4) if anno_budget else None,
        "parametri": d.parametri, "scenari": scenari, "storico": _storico_saldi(db, d.oggi),
        "minimi": {nome: {"anno": r["anno"], "mese": r["mese"], "saldo": r["saldo_finale"], "stato": r["stato"]} for nome, r in minimi.items()},
    }


class ProvaIn(BaseModel):
    sposta: dict[int, date] = {}            # {id impegno: nuova data}
    interventi_on: list[int] = []
    interventi_off: list[int] = []


class SalvaIn(BaseModel):
    nota: Optional[str] = None


@router.get("/previsione")
def previsione(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    return _risposta(dati_previsione(db, date.today()), db)


@router.post("/previsione/prova")
def prova(corpo: ProvaIn, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    """Previsione con date spostate o interventi accesi/spenti, senza salvare nulla."""
    d = dati_previsione(db, date.today())
    aggiungi = []
    for intervento in db.query(TesoreriaIntervento).filter(TesoreriaIntervento.id.in_(corpo.interventi_on or [0])):
        if not intervento.inclusa_in_previsione:
            aggiungi += [Certa(r.data_prevista, residuo, "interventi") for r, _, residuo in rate_intervento(db, intervento) if residuo > 0]
    togli = {c.codice for c in d.certe if c.codice and any(c.codice.startswith(f"intervento:{i}:") for i in corpo.interventi_off)}
    d.certe = applica_prova(d.certe, corpo.sposta, togli, aggiungi)
    return _risposta(d, db)


@router.post("/previsione/salva")
def salva(corpo: SalvaIn, db: Session = Depends(get_db), utente: User = Depends(puo_modificare)):
    oggi = date.today()
    s = TesoreriaPrevisioneSalvata(data_riferimento=oggi, nota=(corpo.nota or "").strip()[:255] or None,
                                   dati=_risposta(dati_previsione(db, oggi), db), utente_id=getattr(utente, "id", None))
    db.add(s)
    db.commit()
    return _salvata_json(s)


def _salvata_json(s: TesoreriaPrevisioneSalvata) -> dict:
    return {"id": s.id, "data_riferimento": s.data_riferimento.isoformat(), "nota": s.nota, "minimi": s.dati.get("minimi")}


@router.get("/previsione/salvate")
def lista_salvate(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    righe = db.query(TesoreriaPrevisioneSalvata).order_by(TesoreriaPrevisioneSalvata.id.desc()).all()
    return [_salvata_json(s) for s in righe]


@router.get("/previsione/salvate/{salvata_id}")
def dettaglio_salvata(salvata_id: int, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    s = db.get(TesoreriaPrevisioneSalvata, salvata_id)
    if s is None:
        raise HTTPException(404, "Previsione salvata non trovata")
    return {**_salvata_json(s), "dati": s.dati}


@router.delete("/previsione/salvate/{salvata_id}")
def elimina_salvata(salvata_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    s = db.get(TesoreriaPrevisioneSalvata, salvata_id)
    if s is None:
        raise HTTPException(404, "Previsione salvata non trovata")
    db.delete(s)
    db.commit()
    return {"ok": True}


COLONNE_CERTE = (("fisco", "Fisco"), ("affitti", "Affitti"), ("mutuo", "Mutuo"), ("ricorrenti", "Ricorrenti"),
                 ("interventi", "Interventi"), ("carte", "Carte (estratti)"), ("fornitori", "Fornitori (scadenzario)"))
COLONNE_STIMATE = (("fornitori", "Fornitori stimati"), ("personale", "Personale"), ("utenze", "Utenze"),
                   ("marketing", "Marketing"), ("carte", "Carte stimate"), ("altre", "Altre"))


@router.get("/previsione/export")
def export(scenario: str = Query("realista"), formato: str = Query("xlsx"), db: Session = Depends(get_db), _=Depends(puo_vedere)):
    if scenario not in SCENARI:
        raise HTTPException(400, "Scenario non valido")
    righe_calc = calcola_scenario(dati_previsione(db, date.today()), scenario)
    intestazioni = (["Mese", "Saldo iniziale", "Entrate (stima)"] + [n for _k, n in COLONNE_CERTE]
                    + [n for _k, n in COLONNE_STIMATE] + ["Saldo finale", "Cassa libera a 90 gg"])
    righe = []
    for r in righe_calc:
        righe.append([
            f"{r['mese']:02d}/{r['anno']}", cella_importo(r["saldo_iniziale"], formato), cella_importo(r["entrate"], formato),
            *[cella_importo(r["uscite_certe"].get(k, 0), formato) for k, _n in COLONNE_CERTE],
            *[cella_importo(r["uscite_stimate"].get(k, 0), formato) for k, _n in COLONNE_STIMATE],
            cella_importo(r["saldo_finale"], formato), cella_importo(r["cassa_libera"], formato),
        ])
    n = len(intestazioni)
    return _risposta_tabella(formato, f"previsione_{scenario}", f"Previsione di cassa, scenario {scenario} (stima)", intestazioni, righe,
                             larghezze_pdf=[1.2] + [1] * (n - 1), numeriche_pdf=tuple(range(1, n)))


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
