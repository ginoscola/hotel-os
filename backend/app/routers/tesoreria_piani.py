"""Tesoreria — piani (Fase 3, blocco B): affitti con rate in data e percentuale, mutuo, ricorrenti, interventi, carte.

I piani sono la fonte; `sincronizza_piani()` ne ricava gli impegni (fonte 'piano') a ogni modifica. Una correzione fatta
sull'impegno (importo confermato, data spostata) e gli impegni pagati non vengono sovrascritti.
Il blocco C userà gli impegni per togliere dalla stima storica ciò che è già coperto.
"""

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tesoreria import (
    STATI_INTERVENTO, TesoreriaCategoria, TesoreriaConto, TesoreriaContrattoAffitto, TesoreriaImpegno,
    TesoreriaIntervento, TesoreriaInterventoScadenza, TesoreriaRataAffitto, TesoreriaRataMutuo, TesoreriaRicorrente, TesoreriaSaldo,
)
from app.routers.tesoreria_impegni_abbina import abbina_impegni, importo_impegno
from app.routers.tesoreria_report import _addebiti_candidati
from app.routers.tesoreria_scadenzario_report import stato_scadenze
from app.routers.tesoreria_shared import euro, puo_importare, puo_modificare, puo_vedere
from app.services.tesoreria_parser import ErroreImportTesoreria
from app.services.tesoreria_piani import (
    TOLLERANZA_PERCENTUALE, data_addebito_carta, date_ricorrente, fine_mese, importi_rate, nome_corrisponde, parse_piano_mutuo,
)
from app.services.tesoreria_report import stato_carta

router = APIRouter()

ORIZZONTE_DEFAULT = date(2027, 12, 31)
FINANZIAMENTO_DEFAULT = "036/307528"
SPESE_RATA_DEFAULT = Decimal("1.50")
CENTO = Decimal(100)


def _orizzonte(db: Session) -> date:
    from app.routers.tesoreria_impegni import leggi_parametri   # evita l'import circolare con gli impegni
    return date.fromisoformat(leggi_parametri(db)["orizzonte"])


def _decimale(valore, nome: str) -> Decimal:
    try:
        return Decimal(str(valore).replace(",", "."))
    except (InvalidOperation, ValueError):
        raise HTTPException(400, f"{nome} non valido: {valore!r}")


# ── Generazione degli impegni ───────────────────────────────────────────────────

def _previsti_affitti(db: Session) -> list:
    out = []
    for c in db.query(TesoreriaContrattoAffitto).filter(TesoreriaContrattoAffitto.attivo.is_(True)):
        rate = db.query(TesoreriaRataAffitto).filter(TesoreriaRataAffitto.contratto_id == c.id) \
            .order_by(TesoreriaRataAffitto.anno_competenza, TesoreriaRataAffitto.data_prevista, TesoreriaRataAffitto.id).all()
        for anno in sorted({r.anno_competenza for r in rate}):
            dell_anno = [r for r in rate if r.anno_competenza == anno]
            for r, importo in zip(dell_anno, importi_rate(c.canone_annuo, [x.percentuale for x in dell_anno])):
                out.append(dict(codice=f"affitto:{c.codice}:{r.id}", tipo="affitto", competenza=str(anno),
                                descrizione=f"Affitto {c.codice} canone {anno}", data=r.data_prevista, importo=importo,
                                base=f"{r.percentuale.normalize():f}% del canone", stato="confermato"))
    return out


def _previsti_mutuo(db: Session, orizzonte: date) -> list:
    return [
        dict(codice=f"mutuo:{r.finanziamento}:{r.numero}", tipo="mutuo", competenza=r.data_scadenza.strftime("%Y-%m"),
             descrizione=f"Rata mutuo {r.finanziamento} n. {r.numero}", data=r.data_scadenza, importo=r.importo + r.spese,
             base=f"Piano della banca (spese {r.spese} € comprese)", stato="confermato")
        for r in db.query(TesoreriaRataMutuo).filter(TesoreriaRataMutuo.pagata_il.is_(None),
                                                     TesoreriaRataMutuo.data_scadenza <= orizzonte)
    ]


def _previsti_ricorrenti(db: Session, oggi: date, orizzonte: date) -> list:
    out = []
    for r in db.query(TesoreriaRicorrente).filter(TesoreriaRicorrente.attivo.is_(True)):
        for d in date_ricorrente(oggi, orizzonte, r.giorno, r.mesi, r.data_da, r.data_a):
            out.append(dict(codice=f"ricorrente:{r.id}:{d:%Y-%m}", tipo="ricorrente", competenza=d.strftime("%Y-%m"),
                            descrizione=r.descrizione, data=d, importo=r.importo, base="Ricorrente", stato="stimato"))
    return out


def _fatture_collegate(db: Session, intervento_id: int) -> list:
    return db.query(TesoreriaInterventoScadenza).filter(TesoreriaInterventoScadenza.intervento_id == intervento_id).all()


def residuo_intervento(db: Session, i: TesoreriaIntervento) -> Optional[Decimal]:
    """Stima meno le fatture collegate, già tra le uscite certe dello scadenzario. Mai sotto zero."""
    if i.importo_stimato is None:
        return None
    collegato = sum((f.importo for f in _fatture_collegate(db, i.id)), Decimal(0))
    return max(i.importo_stimato - collegato, Decimal(0))


def _previsti_interventi(db: Session) -> list:
    out = []
    for i in db.query(TesoreriaIntervento).filter(TesoreriaIntervento.inclusa_in_previsione.is_(True)):
        residuo = residuo_intervento(db, i)
        if residuo and i.mese_previsto is not None and i.stato != "pagato":
            out.append(dict(codice=f"intervento:{i.id}", tipo="intervento", competenza=i.mese_previsto.strftime("%Y-%m"),
                            descrizione=f"Intervento: {i.descrizione}", data=fine_mese(i.mese_previsto), importo=residuo,
                            base=f"Intervento ({i.stato})", stato="stimato"))
    return out


def _previsti_carte(db: Session, oggi: date) -> list:
    """L'ultimo estratto inserito e non ancora addebitato è un'uscita certa. I mesi dopo li stima il blocco C."""
    out = []
    for c in db.query(TesoreriaConto).filter(TesoreriaConto.tipo == "carta_credito", TesoreriaConto.attivo.is_(True)):
        s = db.query(TesoreriaSaldo).filter(TesoreriaSaldo.conto_id == c.id, TesoreriaSaldo.data <= oggi) \
            .order_by(TesoreriaSaldo.data.desc()).first()
        if s is None or not s.saldo:
            continue
        stato = stato_carta(s.data, s.saldo, _addebiti_candidati(db, s.data, s.saldo), c.testo_addebito, oggi)
        if stato["stato"] == "da_addebitare":
            out.append(dict(codice=f"carta:{c.codice}:{s.data}", tipo="carta", competenza=s.data.strftime("%Y-%m"),
                            descrizione=f"Estratto {c.nome} del {s.data:%d/%m/%Y}",
                            data=data_addebito_carta(s.data, c.giorno_addebito, oggi), importo=s.saldo,
                            base="Estratto inserito", stato="confermato"))
    return out


STATI_PAGATA = ("pagata_banca", "pagata_manuale")


def _aggiorna_interventi_pagati(db: Session, oggi: date) -> None:
    """Intervento pagato: fatture a coprire tutta la stima, tutte pagate o uscite dallo scadenzario."""
    collegati = db.query(TesoreriaIntervento).join(
        TesoreriaInterventoScadenza, TesoreriaInterventoScadenza.intervento_id == TesoreriaIntervento.id,
    ).filter(TesoreriaIntervento.stato != "pagato").distinct().all()
    if not collegati:
        return
    aperte = {s["chiave"]: s["stato"] for s in stato_scadenze(db, oggi)["scadenze"]}
    for i in collegati:
        fatture = _fatture_collegate(db, i.id)
        pagate = all(f.chiave not in aperte or aperte[f.chiave] in STATI_PAGATA for f in fatture)
        if pagate and residuo_intervento(db, i) == 0:
            i.stato = "pagato"


def sincronizza_piani(db: Session, oggi: date) -> dict:
    """Allinea gli impegni di fonte 'piano' ai piani. Non fa commit."""
    _aggiorna_interventi_pagati(db, oggi)
    orizzonte = _orizzonte(db)
    previsti = (_previsti_affitti(db) + _previsti_mutuo(db, orizzonte) + _previsti_ricorrenti(db, oggi, orizzonte)
                + _previsti_interventi(db) + _previsti_carte(db, oggi))
    esistenti = {i.codice: i for i in db.query(TesoreriaImpegno).filter(TesoreriaImpegno.fonte == "piano")}
    n_nuovi = n_aggiornati = 0
    for p in previsti:
        i = esistenti.get(p["codice"])
        if i is None:
            db.add(TesoreriaImpegno(codice=p["codice"], tipo=p["tipo"], fonte="piano", descrizione=p["descrizione"],
                                    competenza=p["competenza"], data_scadenza=p["data"], importo_stimato=p["importo"],
                                    base_stima=p["base"], compensabile=False, stato=p["stato"]))
            n_nuovi += 1
        elif i.stato != "pagato":
            i.importo_stimato, i.base_stima, i.descrizione, i.competenza = p["importo"], p["base"], p["descrizione"], p["competenza"]
            if not i.data_manuale:
                i.data_scadenza = p["data"]
            n_aggiornati += 1
    codici = {p["codice"] for p in previsti}
    n_rimossi = 0
    for codice, i in esistenti.items():
        if codice in codici or i.stato == "pagato":
            continue
        db.delete(i)
        n_rimossi += 1
    db.flush()
    return {"n_nuovi": n_nuovi, "n_aggiornati": n_aggiornati, "n_rimossi": n_rimossi}


def _applica(db: Session) -> None:
    sincronizza_piani(db, date.today())
    abbina_impegni(db)
    db.commit()


# ── Affitti ─────────────────────────────────────────────────────────────────────

def _contratto_o_404(db, contratto_id) -> TesoreriaContrattoAffitto:
    c = db.get(TesoreriaContrattoAffitto, contratto_id)
    if c is None:
        raise HTTPException(404, "Contratto non trovato")
    return c


def _rata_o_404(db, rata_id) -> TesoreriaRataAffitto:
    r = db.get(TesoreriaRataAffitto, rata_id)
    if r is None:
        raise HTTPException(404, "Rata non trovata")
    return r


def _impegno_rata(db, contratto, rata_id) -> Optional[TesoreriaImpegno]:
    return db.query(TesoreriaImpegno).filter(TesoreriaImpegno.codice == f"affitto:{contratto.codice}:{rata_id}").first()


def _verifica_percentuali(db, contratto_id, anno, percentuale, escludi=None):
    altre = db.query(TesoreriaRataAffitto).filter(TesoreriaRataAffitto.contratto_id == contratto_id,
                                                  TesoreriaRataAffitto.anno_competenza == anno)
    totale = sum((r.percentuale for r in altre if r.id != escludi), Decimal(0)) + percentuale
    if percentuale <= 0 or totale > CENTO + TOLLERANZA_PERCENTUALE:
        raise HTTPException(400, f"Le rate del canone {anno} supererebbero il 100% ({totale.normalize():f}%)")


def _contratto_json(db, c: TesoreriaContrattoAffitto) -> dict:
    rate = db.query(TesoreriaRataAffitto).filter(TesoreriaRataAffitto.contratto_id == c.id) \
        .order_by(TesoreriaRataAffitto.anno_competenza, TesoreriaRataAffitto.data_prevista, TesoreriaRataAffitto.id).all()
    anni = []
    righe = []
    for anno in sorted({r.anno_competenza for r in rate}):
        dell_anno = [r for r in rate if r.anno_competenza == anno]
        pagato = Decimal(0)
        for r, importo in zip(dell_anno, importi_rate(c.canone_annuo, [x.percentuale for x in dell_anno])):
            i = _impegno_rata(db, c, r.id)
            effettivo = importo_impegno(i) if i else importo
            if i and i.stato == "pagato":
                pagato += effettivo
            righe.append({"id": r.id, "anno_competenza": anno, "data_prevista": (i.data_scadenza if i else r.data_prevista).isoformat(),
                          "percentuale": float(r.percentuale), "importo": euro(effettivo), "nota": r.nota,
                          "stato": i.stato if i else "stimato", "abbinamento": i.abbinamento if i else None})
        pianificato = sum((x.percentuale for x in dell_anno), Decimal(0))
        anni.append({"anno": anno, "canone": euro(c.canone_annuo), "pagato": euro(pagato), "residuo": euro(c.canone_annuo - pagato),
                     "percentuale_pianificata": float(pianificato),
                     "da_pianificare": euro(max(c.canone_annuo * (CENTO - pianificato) / CENTO, Decimal(0)))})
    return {"id": c.id, "codice": c.codice, "controparte": c.controparte, "nomi_banca": c.nomi_banca,
            "canone_annuo": euro(c.canone_annuo), "note": c.note, "attivo": c.attivo, "rate": righe, "anni": anni}


class ContrattoIn(BaseModel):
    codice: Optional[str] = None
    controparte: Optional[str] = None
    nomi_banca: Optional[list[str]] = None
    canone_annuo: Optional[str] = None
    note: Optional[str] = None
    attivo: Optional[bool] = None


class RataIn(BaseModel):
    anno_competenza: Optional[int] = None
    data_prevista: Optional[date] = None
    percentuale: Optional[str] = None
    nota: Optional[str] = None


@router.get("/piani/affitti")
def lista_affitti(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    contratti = db.query(TesoreriaContrattoAffitto).order_by(TesoreriaContrattoAffitto.codice).all()
    return [_contratto_json(db, c) for c in contratti]


@router.post("/piani/affitti")
def crea_contratto(corpo: ContrattoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    if not corpo.codice or not corpo.controparte or corpo.canone_annuo is None:
        raise HTTPException(400, "Codice, controparte e canone sono obbligatori")
    if db.query(TesoreriaContrattoAffitto).filter(TesoreriaContrattoAffitto.codice == corpo.codice).first():
        raise HTTPException(409, f"Contratto {corpo.codice} già presente")
    c = TesoreriaContrattoAffitto(codice=corpo.codice, controparte=corpo.controparte, nomi_banca=corpo.nomi_banca or [corpo.controparte],
                                  canone_annuo=_decimale(corpo.canone_annuo, "Canone"), note=corpo.note)
    db.add(c)
    db.commit()
    return _contratto_json(db, c)


@router.put("/piani/affitti/{contratto_id}")
def modifica_contratto(contratto_id: int, corpo: ContrattoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    c = _contratto_o_404(db, contratto_id)
    if corpo.controparte is not None:
        c.controparte = corpo.controparte
    if corpo.nomi_banca is not None:
        c.nomi_banca = corpo.nomi_banca
    if corpo.canone_annuo is not None:
        c.canone_annuo = _decimale(corpo.canone_annuo, "Canone")
    if corpo.note is not None:
        c.note = corpo.note or None
    if corpo.attivo is not None:
        c.attivo = corpo.attivo
    db.flush()
    _applica(db)
    return _contratto_json(db, c)


@router.post("/piani/affitti/{contratto_id}/rate")
def crea_rata(contratto_id: int, corpo: RataIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    c = _contratto_o_404(db, contratto_id)
    if corpo.anno_competenza is None or corpo.data_prevista is None or corpo.percentuale is None:
        raise HTTPException(400, "Anno, data e percentuale sono obbligatori")
    percentuale = _decimale(corpo.percentuale, "Percentuale")
    _verifica_percentuali(db, c.id, corpo.anno_competenza, percentuale)
    db.add(TesoreriaRataAffitto(contratto_id=c.id, anno_competenza=corpo.anno_competenza, data_prevista=corpo.data_prevista,
                                percentuale=percentuale, nota=corpo.nota))
    db.flush()
    _applica(db)
    return _contratto_json(db, c)


@router.put("/piani/affitti/rate/{rata_id}")
def modifica_rata(rata_id: int, corpo: RataIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = _rata_o_404(db, rata_id)
    c = _contratto_o_404(db, r.contratto_id)
    i = _impegno_rata(db, c, r.id)
    if i and i.stato == "pagato":
        raise HTTPException(409, "Rata già pagata: annullare prima l'abbinamento con la banca")
    if corpo.percentuale is not None:
        percentuale = _decimale(corpo.percentuale, "Percentuale")
        _verifica_percentuali(db, c.id, r.anno_competenza, percentuale, escludi=r.id)
        r.percentuale = percentuale
    if corpo.data_prevista is not None:
        r.data_prevista = corpo.data_prevista
        if i:
            i.data_manuale = False      # da Admin vale la data del piano
    if corpo.nota is not None:
        r.nota = corpo.nota or None
    db.flush()
    _applica(db)
    return _contratto_json(db, c)


@router.delete("/piani/affitti/rate/{rata_id}")
def elimina_rata(rata_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = _rata_o_404(db, rata_id)
    c = _contratto_o_404(db, r.contratto_id)
    i = _impegno_rata(db, c, r.id)
    if i and i.stato == "pagato":
        raise HTTPException(409, "Rata già pagata: non si elimina")
    db.delete(r)
    db.flush()
    _applica(db)
    return _contratto_json(db, c)


# ── Mutuo ───────────────────────────────────────────────────────────────────────

@router.get("/piani/mutuo")
def piano_mutuo(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    rate = db.query(TesoreriaRataMutuo).order_by(TesoreriaRataMutuo.finanziamento, TesoreriaRataMutuo.numero).all()
    oggi = date.today()
    aperte = [r for r in rate if r.pagata_il is None and r.data_scadenza >= oggi]
    return {
        "debito_residuo": euro(sum((r.capitale for r in rate if r.pagata_il is None), Decimal(0))),
        "prossima": aperte[0].data_scadenza.isoformat() if aperte else None,
        "rate": [{"numero": r.numero, "finanziamento": r.finanziamento, "data_scadenza": r.data_scadenza.isoformat(),
                  "capitale": euro(r.capitale), "interessi": euro(r.interessi), "importo": euro(r.importo),
                  "spese": euro(r.spese), "residuo": euro(r.residuo),
                  "pagata_il": r.pagata_il.isoformat() if r.pagata_il else None} for r in rate],
    }


@router.post("/piani/mutuo")
async def carica_piano_mutuo(file: UploadFile = File(...), finanziamento: str = Query(FINANZIAMENTO_DEFAULT),
                             spese: str = Query(str(SPESE_RATA_DEFAULT)), db: Session = Depends(get_db),
                             _=Depends(puo_importare)):
    """Il tasso è variabile: ricaricando il piano si aggiornano le rate. Una rata già pagata resta com'è."""
    try:
        piano = parse_piano_mutuo(await file.read())
    except ErroreImportTesoreria as e:
        raise HTTPException(400, str(e))
    esistenti = {r.numero: r for r in db.query(TesoreriaRataMutuo).filter(TesoreriaRataMutuo.finanziamento == finanziamento)}
    importo_spese = _decimale(spese, "Spese")
    numeri = set()
    for p in piano:
        numeri.add(p.numero)
        r = esistenti.get(p.numero)
        if r is None:
            r = TesoreriaRataMutuo(finanziamento=finanziamento, numero=p.numero)
            db.add(r)
        elif r.pagata_il is not None:
            continue
        r.data_scadenza, r.capitale, r.interessi, r.importo = p.scadenza, p.capitale, p.interessi, p.importo
        r.spese, r.residuo, r.pagata_il = importo_spese, p.residuo, p.pagata_il
    for numero, r in esistenti.items():
        if numero not in numeri and r.pagata_il is None:
            db.delete(r)
    db.flush()
    _applica(db)
    return {"n_rate": len(piano), "n_pagate": sum(1 for p in piano if p.pagata_il)}


# ── Ricorrenti ──────────────────────────────────────────────────────────────────

class RicorrenteIn(BaseModel):
    descrizione: Optional[str] = None
    categoria_id: Optional[int] = None
    importo: Optional[str] = None
    giorno: Optional[int] = None
    mesi: Optional[list[int]] = None
    data_da: Optional[date] = None
    data_a: Optional[date] = None
    nota: Optional[str] = None
    attivo: Optional[bool] = None


def _ricorrente_json(r, categorie) -> dict:
    c = categorie.get(r.categoria_id)
    return {"id": r.id, "descrizione": r.descrizione, "categoria_id": r.categoria_id, "categoria": c.nome if c else None,
            "importo": euro(r.importo), "giorno": r.giorno, "mesi": r.mesi, "data_da": r.data_da.isoformat() if r.data_da else None,
            "data_a": r.data_a.isoformat() if r.data_a else None, "nota": r.nota, "attivo": r.attivo}


def _categorie(db) -> dict:
    return {c.id: c for c in db.query(TesoreriaCategoria).all()}


def _valida_ricorrente(corpo: RicorrenteIn, db):
    if corpo.giorno is not None and not 1 <= corpo.giorno <= 31:
        raise HTTPException(400, "Giorno non valido (1–31)")
    if corpo.mesi is not None and (not corpo.mesi or any(not 1 <= m <= 12 for m in corpo.mesi)):
        raise HTTPException(400, "Mesi non validi (1–12)")
    if corpo.categoria_id is not None and db.get(TesoreriaCategoria, corpo.categoria_id) is None:
        raise HTTPException(400, "Categoria non trovata")


@router.get("/piani/ricorrenti")
def lista_ricorrenti(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    categorie = _categorie(db)
    return [_ricorrente_json(r, categorie) for r in db.query(TesoreriaRicorrente).order_by(TesoreriaRicorrente.descrizione)]


@router.post("/piani/ricorrenti")
def crea_ricorrente(corpo: RicorrenteIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    _valida_ricorrente(corpo, db)
    if not corpo.descrizione or corpo.categoria_id is None or corpo.importo is None or not corpo.mesi:
        raise HTTPException(400, "Descrizione, categoria, importo e mesi sono obbligatori")
    r = TesoreriaRicorrente(descrizione=corpo.descrizione, categoria_id=corpo.categoria_id, importo=_decimale(corpo.importo, "Importo"),
                            giorno=corpo.giorno or 1, mesi=corpo.mesi, data_da=corpo.data_da, data_a=corpo.data_a, nota=corpo.nota)
    db.add(r)
    db.flush()
    _applica(db)
    return _ricorrente_json(r, _categorie(db))


@router.put("/piani/ricorrenti/{ricorrente_id}")
def modifica_ricorrente(ricorrente_id: int, corpo: RicorrenteIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = db.get(TesoreriaRicorrente, ricorrente_id)
    if r is None:
        raise HTTPException(404, "Ricorrente non trovato")
    _valida_ricorrente(corpo, db)
    for campo in ("descrizione", "categoria_id", "giorno", "mesi", "data_da", "data_a", "nota", "attivo"):
        valore = getattr(corpo, campo)
        if valore is not None:
            setattr(r, campo, valore)
    if corpo.importo is not None:
        r.importo = _decimale(corpo.importo, "Importo")
    db.flush()
    _applica(db)
    return _ricorrente_json(r, _categorie(db))


@router.delete("/piani/ricorrenti/{ricorrente_id}")
def elimina_ricorrente(ricorrente_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    r = db.get(TesoreriaRicorrente, ricorrente_id)
    if r is None:
        raise HTTPException(404, "Ricorrente non trovato")
    db.delete(r)
    db.flush()
    _applica(db)
    return {"ok": True}


# ── Interventi ──────────────────────────────────────────────────────────────────

class InterventoIn(BaseModel):
    descrizione: Optional[str] = None
    struttura_code: Optional[str] = None
    fornitore: Optional[str] = None
    importo_stimato: Optional[str] = None
    mese_previsto: Optional[str] = None     # 'AAAA-MM'; '' lo toglie
    stato: Optional[str] = None
    inclusa_in_previsione: Optional[bool] = None
    nota: Optional[str] = None


def _intervento_json(db: Session, i: TesoreriaIntervento) -> dict:
    fatture = _fatture_collegate(db, i.id)
    return {"id": i.id, "descrizione": i.descrizione, "struttura_code": i.struttura_code, "fornitore": i.fornitore,
            "importo_stimato": euro(i.importo_stimato), "mese_previsto": i.mese_previsto.strftime("%Y-%m") if i.mese_previsto else None,
            "stato": i.stato, "inclusa_in_previsione": i.inclusa_in_previsione, "nota": i.nota, "n_fatture": len(fatture),
            "fatture_collegate": euro(sum((f.importo for f in fatture), Decimal(0))), "residuo": euro(residuo_intervento(db, i))}


def _applica_intervento(i: TesoreriaIntervento, corpo: InterventoIn):
    if corpo.stato is not None and corpo.stato not in STATI_INTERVENTO:
        raise HTTPException(400, "Stato non valido")
    for campo in ("descrizione", "stato", "inclusa_in_previsione"):
        valore = getattr(corpo, campo)
        if valore is not None:
            setattr(i, campo, valore)
    for campo in ("struttura_code", "fornitore", "nota"):
        valore = getattr(corpo, campo)
        if valore is not None:
            setattr(i, campo, valore or None)
    if corpo.importo_stimato is not None:
        i.importo_stimato = _decimale(corpo.importo_stimato, "Importo") if corpo.importo_stimato != "" else None
    if corpo.mese_previsto is not None:
        try:
            i.mese_previsto = date.fromisoformat(f"{corpo.mese_previsto}-01") if corpo.mese_previsto else None
        except ValueError:
            raise HTTPException(400, "Mese non valido (AAAA-MM)")


@router.get("/piani/interventi")
def lista_interventi(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    return [_intervento_json(db, i) for i in db.query(TesoreriaIntervento).order_by(TesoreriaIntervento.id)]


@router.post("/piani/interventi")
def crea_intervento(corpo: InterventoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    if not corpo.descrizione:
        raise HTTPException(400, "La descrizione è obbligatoria")
    i = TesoreriaIntervento(descrizione=corpo.descrizione)
    _applica_intervento(i, corpo)
    db.add(i)
    db.flush()
    _applica(db)
    return _intervento_json(db, i)


@router.put("/piani/interventi/{intervento_id}")
def modifica_intervento(intervento_id: int, corpo: InterventoIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    _applica_intervento(i, corpo)
    db.flush()
    _applica(db)
    return _intervento_json(db, i)


@router.delete("/piani/interventi/{intervento_id}")
def elimina_intervento(intervento_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    db.delete(i)
    db.flush()
    _applica(db)
    return {"ok": True}


# ── Fatture collegate agli interventi ───────────────────────────────────────────

class FatturaIn(BaseModel):
    chiave: str


def _fattura_json(f: TesoreriaInterventoScadenza) -> dict:
    return {"id": f.id, "chiave": f.chiave, "fornitore": f.fornitore, "data_scadenza": f.data_scadenza.isoformat(),
            "numero_documento": f.numero_documento, "importo": euro(f.importo)}


@router.get("/piani/interventi/{intervento_id}/fatture")
def fatture_intervento(intervento_id: int, db: Session = Depends(get_db), _=Depends(puo_vedere)):
    """Collegate e collegabili: le scadenze aperte, prima quelle del fornitore previsto."""
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    gia = {c for (c,) in db.query(TesoreriaInterventoScadenza.chiave)}
    candidate = []
    for s in stato_scadenze(db, date.today())["scadenze"]:
        if s["chiave"] in gia or s["stato"] in ("pareggio", "residuo") or s["importo"] <= 0:
            continue
        candidate.append({"chiave": s["chiave"], "fornitore": s["fornitore"], "data_scadenza": s["data_scadenza"].isoformat(),
                          "numero_documento": s.get("numero_documento"), "importo": euro(Decimal(str(s["importo"]))),
                          "suggerita": bool(i.fornitore) and nome_corrisponde(s["fornitore"], [i.fornitore])})
    candidate.sort(key=lambda c: (not c["suggerita"], c["fornitore"], c["data_scadenza"]))
    return {"collegate": [_fattura_json(f) for f in _fatture_collegate(db, i.id)], "candidate": candidate[:300]}


@router.post("/piani/interventi/{intervento_id}/fatture")
def collega_fattura(intervento_id: int, corpo: FatturaIn, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    i = db.get(TesoreriaIntervento, intervento_id)
    if i is None:
        raise HTTPException(404, "Intervento non trovato")
    if db.query(TesoreriaInterventoScadenza).filter(TesoreriaInterventoScadenza.chiave == corpo.chiave).first():
        raise HTTPException(409, "Fattura già collegata a un intervento")
    s = next((x for x in stato_scadenze(db, date.today())["scadenze"] if x["chiave"] == corpo.chiave), None)
    if s is None:
        raise HTTPException(404, "Scadenza non trovata nello scadenzario attuale")
    db.add(TesoreriaInterventoScadenza(intervento_id=i.id, chiave=s["chiave"], fornitore=s["fornitore"], data_scadenza=s["data_scadenza"],
                                       numero_documento=s.get("numero_documento"), importo=Decimal(str(s["importo"]))))
    db.flush()
    _applica(db)
    return _intervento_json(db, i)


@router.delete("/piani/interventi/fatture/{fattura_id}")
def scollega_fattura(fattura_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    f = db.get(TesoreriaInterventoScadenza, fattura_id)
    if f is None:
        raise HTTPException(404, "Collegamento non trovato")
    db.delete(f)
    db.flush()
    _applica(db)
    return {"ok": True}
