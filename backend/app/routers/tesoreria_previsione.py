"""Tesoreria — previsione di cassa (Fase 3, blocco C): raccoglie saldo, storico banca, Budget, impegni e scadenzario e
chiama services/tesoreria_previsione.py. Tutto calcolato alla richiesta: una modifica al Budget o agli impegni vale subito.
"""

import json
import logging
from datetime import date, timedelta
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
    TesoreriaAdvertising, TesoreriaAdvertisingMese, TesoreriaCategoria, TesoreriaConto, TesoreriaImpegno, TesoreriaIntervento, TesoreriaMovimento,
    TesoreriaPrevisioneSalvata, TesoreriaRicorrente,
)
from app.routers.corrispettivi_documenti import _risposta_tabella
from app.routers.budget import ricavi_budget_anno, ricavi_consuntivo_anno
from app.routers.dipendenti import netti_per_mese
from app.routers.corrispettivi_report import report_fatturati
from app.routers.tesoreria_impegni import leggi_parametri as leggi_parametri_fiscali
from app.routers.tesoreria_impegni_abbina import importo_impegno
from app.routers.tesoreria_report import TIPI_BANCA, _saldi_e_movimenti
from app.routers.tesoreria_fatture_stato import stato_fatture
from app.routers.tesoreria_scadenzario_report import stato_scadenze
from app.services.tesoreria_fatture import CATEGORIA_DI_MODALITA
from app.routers.tesoreria_piani import rate_intervento
from app.routers.tesoreria_caparre import caparre_db, caparre_per_mese, senza_periodo_db
from app.routers.tesoreria_shared import cella_importo, euro, puo_modificare, puo_vedere
from app.services.budget_ristoranti import totale_budget_anno
from app.services.tesoreria_previsione import (
    GRUPPI_CRESCITA, SCENARI, TIPI_FISCO, Certa, DatiPrevisione, applica_prova, calcola_scenario, fattore_budget, fine_mese,
    cedolini_mancanti, certe_stipendi, mesi_tra, parametri_default, rettifica_caparre, totali_per_anno,
)
from app.services.tesoreria_piani import advertising_per_addebito, anno_calendario
from app.services.tesoreria_report import TIPI_ANNO, anno_prima
from app.services.tesoreria_saldi import saldo_a_data
from app.utils.locale_it import MESI_IT

router = APIRouter()
log = logging.getLogger(__name__)

# Salvataggio automatico: un estratto conto "arriva a fine mese" se la sua ultima data è al massimo a tanti giorni
# dall'ultimo giorno del mese prima (l'XML non ha i giorni senza movimenti: weekend, festivi).
TOLLERANZA_FINE_MESE = 4
GIORNO_AVVISO_SALVATE = 8   # dal giorno 8 avviso se il mese non ha ancora una previsione salvata

CHIAVE_PARAMETRI = "tesoreria_previsione_parametri"
GRUPPO_DA_TIPO = {"affitto": "affitti", "mutuo": "mutuo", "ricorrente": "ricorrenti", "intervento": "interventi", "carta": "carte", "compenso": "compensi", "advertising": "advertising"}
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
    # Fase 5: fatture arrivate allo SDI e non ancora nello scadenzario (al netto delle note di credito)
    for r, importo in stato_fatture(db, oggi)["debiti"]:
        out.append(Certa(r.data_scadenza, importo, "fatture", CATEGORIA_DI_MODALITA.get(r.tipo_pagamento, "fornitori_bonifici"),
                         codice=r.chiave))
    return out


def _advertising_addebitato(db: Session) -> dict:
    righe = db.query(TesoreriaAdvertising.anno, TesoreriaAdvertisingMese.mese, TesoreriaAdvertisingMese.importo).join(
        TesoreriaAdvertisingMese, TesoreriaAdvertisingMese.advertising_id == TesoreriaAdvertising.id)
    return advertising_per_addebito([(anno_calendario(a, m), m, imp) for a, m, imp in righe])


def dati_previsione(db: Session, oggi: date) -> DatiPrevisione:
    orizzonte = date.fromisoformat(leggi_parametri_fiscali(db)["orizzonte"])
    conti = db.query(TesoreriaConto).filter(TesoreriaConto.tipo.in_(TIPI_BANCA), TesoreriaConto.attivo.is_(True)).all()
    saldi, movimenti = _saldi_e_movimenti(db, [c.id for c in conti])
    saldo = sum((saldo_a_data(oggi, saldi[c.id], movimenti[c.id]) or Decimal(0) for c in conti), Decimal(0))
    entrate, uscite = _storico_banca(db)
    ricavi, budget = _ricavi_e_budget(db, range(oggi.year - 1, orizzonte.year + 1))
    certe = _certe(db, oggi) + certe_stipendi(netti_per_mese(db), uscite.get("personale", {}), oggi)
    return DatiPrevisione(
        oggi=oggi, orizzonte=orizzonte, saldo_iniziale=saldo, entrate=entrate, uscite=uscite, certe=certe,
        budget=budget, ricavi=ricavi, fidi=[(c.fido, c.fido_scadenza) for c in conti if c.fido],
        parametri=leggi_parametri(db), advertising=_advertising_addebitato(db), caparre=_caparre(db, oggi, orizzonte),
    )


def _caparre(db: Session, oggi: date, orizzonte: date) -> dict:
    """{(y, m) di arrivo: (caparre in banca oggi, per (y-1, m) un anno fa)} dei mesi della previsione. Il confronto
    vale solo se gli estratti conto partono almeno da gennaio di due anni prima dell'arrivo (le caparre arrivano
    fino a ~18 mesi prima)."""
    primo = db.query(func.min(TesoreriaMovimento.data_contabile)).scalar()
    caparre, senza = caparre_db(db), senza_periodo_db(db)
    ap = anno_prima(oggi)
    stagioni = {}
    out = {}
    for y, m in mesi_tra(oggi, orizzonte):
        if y not in stagioni:       # caparre per mese di arrivo, senza periodo comprese (distribuite)
            stagioni[y] = (caparre_per_mese(caparre, senza, y, oggi), caparre_per_mese(caparre, senza, y - 1, ap))
        ora, rif = stagioni[y][0].get(m, Decimal(0)), stagioni[y][1].get(m, Decimal(0))
        if ora or rif:
            out[(y, m)] = (ora, rif if primo and primo <= date(y - 2, 1, 31) else None)
    return out


def _riga_json(r: dict) -> dict:
    return {
        "anno": r["anno"], "mese": r["mese"], "stato": r["stato"], "fido": euro(r["fido"]),
        **{k: euro(r[k]) for k in ("saldo_iniziale", "entrate", "rettifica_caparre", "totale_certe", "totale_stimate",
                                   "saldo_finale", "cassa_impegnata_90", "cassa_libera")},
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


def _totale_json(t: dict) -> dict:
    return {"anno": t["anno"], "etichetta": t["etichetta"], "n_mesi": t["n_mesi"], "completo": t["completo"],
            "dal": {"anno": t["dal"][0], "mese": t["dal"][1]}, "al": {"anno": t["al"][0], "mese": t["al"][1]},
            **{k: euro(t[k]) for k in ("saldo_iniziale", "entrate", "totale_certe", "totale_stimate", "saldo_finale")}}


def _risposta(d: DatiPrevisione, db: Session) -> dict:
    calcolati = {nome: calcola_scenario(d, nome) for nome in SCENARI}
    scenari = {nome: [_riga_json(r) for r in righe] for nome, righe in calcolati.items()}
    totali_anno = {tipo: {nome: [_totale_json(t) for t in totali_per_anno(righe, tipo)] for nome, righe in calcolati.items()}
                   for tipo in TIPI_ANNO}
    minimi = {nome: min(righe, key=lambda r: r["saldo_finale"]) for nome, righe in scenari.items()}
    anno_budget = max(d.budget) if d.budget else None
    mancanti = cedolini_mancanti(netti_per_mese(db), d.oggi)
    avvisi = [f"Cedolini di {MESI_IT[mancanti[1] - 1]} {mancanti[0]} non importati: gli stipendi del mese dopo sono "
              "stimati dallo storico della banca (Dipendenti → Import PDF)"] if mancanti else []
    if d.oggi.day >= GIORNO_AVVISO_SALVATE and not salvata_nel_mese(db, d.oggi):
        prima = d.oggi.replace(day=1) - timedelta(days=1)
        avvisi.append(f"Nessuna previsione salvata a {MESI_IT[d.oggi.month - 1]}: si salva da sola caricando un estratto "
                      f"conto che arriva a fine {MESI_IT[prima.month - 1]}, oppure con «Salva previsione» qui sotto")
    return {
        "avvisi": avvisi,
        "oggi": d.oggi.isoformat(), "saldo_iniziale": euro(d.saldo_iniziale),
        "budget": {str(a): euro(v) for a, v in d.budget.items()}, "ricavi": {str(a): euro(v) for a, v in d.ricavi.items()},
        "fattore_budget": round(float(fattore_budget(anno_budget, d.budget, d.ricavi)), 4) if anno_budget else None,
        "parametri": d.parametri, "scenari": scenari, "totali_anno": totali_anno, "storico": _storico_saldi(db, d.oggi),
        "caparre": [{"anno": y, "mese": m, "incassate": euro(ora), "anno_prima": euro(rif),
                     "fattore": round(float(fattore_budget(y, d.budget, d.ricavi)), 4),
                     "rettifica": euro(rettifica_caparre(d, y, m))} for (y, m), (ora, rif) in sorted(d.caparre.items())],
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


def salva_previsione(db: Session, oggi: date, nota: Optional[str], utente_id: Optional[int]) -> TesoreriaPrevisioneSalvata:
    s = TesoreriaPrevisioneSalvata(data_riferimento=oggi, nota=(nota or "").strip()[:255] or None,
                                   dati=_risposta(dati_previsione(db, oggi), db), utente_id=utente_id)
    db.add(s)
    db.commit()
    return s


def salvata_nel_mese(db: Session, oggi: date) -> bool:
    return db.query(TesoreriaPrevisioneSalvata.id).filter(
        TesoreriaPrevisioneSalvata.data_riferimento >= oggi.replace(day=1),
        TesoreriaPrevisioneSalvata.data_riferimento <= oggi).first() is not None


def arriva_a_fine_mese(data_a: Optional[date], oggi: date) -> bool:
    """L'estratto copre la fine del mese prima di oggi (anche se l'ultimo movimento è qualche giorno prima)."""
    fine_prima = oggi.replace(day=1) - timedelta(days=1)
    return data_a is not None and data_a >= fine_prima - timedelta(days=TOLLERANZA_FINE_MESE)


def salva_automatica(db: Session, data_a: Optional[date], nome_file: str, utente_id: Optional[int],
                     oggi: Optional[date] = None) -> Optional[int]:
    """Dopo l'import di un estratto conto: salva la previsione del mese se non c'è ancora e l'estratto arriva a fine
    del mese prima (saldo di partenza aggiornato). Un errore qui non deve annullare l'import: lo registra e basta."""
    oggi = oggi or date.today()
    try:
        if not arriva_a_fine_mese(data_a, oggi) or salvata_nel_mese(db, oggi):
            return None
        return salva_previsione(db, oggi, f"Automatica (estratto conto {nome_file})", utente_id).id
    except Exception:
        db.rollback()
        log.exception("Salvataggio automatico della previsione non riuscito")
        return None


@router.post("/previsione/salva")
def salva(corpo: SalvaIn, db: Session = Depends(get_db), utente: User = Depends(puo_modificare)):
    return _salvata_json(salva_previsione(db, date.today(), corpo.nota, getattr(utente, "id", None)))


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
                 ("interventi", "Interventi"), ("compensi", "Compensi soci"), ("advertising", "Advertising (carta)"), ("carte", "Carte (estratti)"), ("stipendi", "Stipendi netti"),
                 ("fornitori", "Fornitori (scadenzario)"), ("fatture", "Fatture da registrare"))
COLONNE_STIMATE = (("fornitori", "Fornitori stimati"), ("personale", "Personale"), ("utenze", "Utenze"),
                   ("marketing", "Marketing"), ("carte", "Carte stimate"), ("altre", "Altre"))


@router.get("/previsione/export")
def export(scenario: str = Query("realista"), formato: str = Query("xlsx"), tipo_anno: str = Query("solare"),
           db: Session = Depends(get_db), _=Depends(puo_vedere)):
    if scenario not in SCENARI or tipo_anno not in TIPI_ANNO:
        raise HTTPException(400, "Scenario o tipo di anno non valido")
    righe_calc = calcola_scenario(dati_previsione(db, date.today()), scenario)
    totali = {t["al"]: t for t in totali_per_anno(righe_calc, tipo_anno)}
    intestazioni = (["Mese", "Saldo iniziale", "Entrate (stima)"] + [n for _k, n in COLONNE_CERTE]
                    + [n for _k, n in COLONNE_STIMATE] + ["Saldo finale", "Cassa libera a 90 gg"])
    righe, somme = [], None
    for r in righe_calc:
        valori = ([r["entrate"]] + [r["uscite_certe"].get(k, Decimal(0)) for k, _n in COLONNE_CERTE]
                  + [r["uscite_stimate"].get(k, Decimal(0)) for k, _n in COLONNE_STIMATE])
        somme = valori if somme is None else [a + b for a, b in zip(somme, valori)]
        righe.append([f"{r['mese']:02d}/{r['anno']}", cella_importo(r["saldo_iniziale"], formato),
                      *[cella_importo(v, formato) for v in valori],
                      cella_importo(r["saldo_finale"], formato), cella_importo(r["cassa_libera"], formato)])
        t = totali.get((r["anno"], r["mese"]))
        if t:      # riga di totale dopo l'ultimo mese di ogni anno (solare o alberghiero)
            nome = f"TOTALE {t['etichetta']}" + ("" if t["completo"] else f" ({t['n_mesi']} mesi)")
            righe.append([nome, cella_importo(t["saldo_iniziale"], formato), *[cella_importo(v, formato) for v in somme],
                          cella_importo(t["saldo_finale"], formato), ""])
            somme = None
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
