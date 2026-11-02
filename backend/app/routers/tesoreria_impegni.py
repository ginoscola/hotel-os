"""Tesoreria — impegni futuri (Fase 3, blocco A): calendario fiscale, credito IVA, abbinamento con la banca,
avviso TARI. Calcoli in services/tesoreria_calendario.py; qui la lettura dei dati dagli altri moduli
(Dipendenti, Corrispettivi, contabilità USALI) tramite le loro funzioni e la scrittura.

I dati fiscali reali (imposte dichiarate, credito IVA, TARI, F24 storici, tributi fissi) stanno in
`app_config['tesoreria_fiscale_parametri']`, non nel codice né nelle migrazioni.
"""

import hashlib
import json
import shutil
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import AppConfig, User
from app.models.tesoreria import TesoreriaImpegno
from app.routers.dipendenti import costi_f24_per_mese
from app.routers.tesoreria_impegni_abbina import abbina_impegni, importo_impegno
from app.routers.tesoreria_import import _leggi_anteprima, _pulisci_anteprime_scadute
from app.routers.tesoreria_kpi import _tassa_incassata_per_mese
from app.routers.tesoreria_piani import sincronizza_piani
from app.routers.tesoreria_shared import euro, nome_sicuro, puo_importare, puo_modificare, puo_vedere, storage_dir
from app.services.tesoreria_calendario import (
    ZERO, DatiFiscali, TrancheCredito, genera_scadenze, reddito_anno_stimato, simula_credito,
)
from app.services.tesoreria_parser import ErroreImportTesoreria
from app.services.tesoreria_tari_parser import parse_avviso_tari
from app.services.usali_contabile_kpi import risultato_per_mese

router = APIRouter()

CHIAVE_PARAMETRI = "tesoreria_fiscale_parametri"
PARAMETRI_DEFAULT = {
    "orizzonte": "2027-12-31",
    "giorno_tassa_soggiorno": 15,
    "acconti_mese": 7,
    "acconti_giorno": 20,
    "aliquota_ires": 0.24,
    "iva_agosto": {},                      # {anno: IVA di agosto versata}
    "imposte": {"ires": {}, "irap": {}},   # {tipo: {anno: importo da dichiarazione}}
    "tari_totali": {},                     # {anno: totale dell'anno}
    "f24_storico": {},                     # {'AAAA-MM' mese di paga: dovuto lordo dalle quietanze}
    "fissi": [],                           # [{codice, descrizione, mese, giorno, importo}]
    "crediti_iva": [],                     # [{importo, disponibile_dal, anticipabile_dal?}]
}


def leggi_parametri(db: Session) -> dict:
    parametri = json.loads(json.dumps(PARAMETRI_DEFAULT))
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_PARAMETRI).first()
    if riga:
        try:
            parametri.update({k: v for k, v in json.loads(riga.value).items() if k in PARAMETRI_DEFAULT})
        except (ValueError, TypeError, AttributeError):
            pass   # config corrotta: restano i default
    return parametri


def _dec(v) -> Decimal:
    return Decimal(str(v))


def _anni_contabili(db: Session, anni: range) -> dict:
    return {a: r for a in anni if (r := risultato_per_mese(db, a))}


def dati_fiscali(db: Session, parametri: dict, anno_fine: int) -> DatiFiscali:
    dati = DatiFiscali(f24_cedolini=costi_f24_per_mese(db), fissi=parametri["fissi"])
    for chiave, valore in parametri["f24_storico"].items():
        anno, mese = chiave.split("-")
        dati.f24_storico[(int(anno), int(mese))] = _dec(valore)

    dati.iva_agosto = {int(a): _dec(v) for a, v in parametri["iva_agosto"].items()}
    contabili = _anni_contabili(db, range(2024, anno_fine + 1))

    for anno in range(2025, anno_fine + 1):
        for mese, importo in _tassa_incassata_per_mese(db, anno).items():
            dati.tassa_incassata[(anno, mese)] = importo

    dati.imposte = {t: {int(a): _dec(v) for a, v in parametri["imposte"].get(t, {}).items()} for t in ("ires", "irap")}
    # Anni senza dichiarazione: IRES dall'utile contabile, IRAP pari all'ultima nota (l'imponibile non è stimabile)
    for anno, risultati in contabili.items():
        reddito = reddito_anno_stimato(risultati)
        if anno not in dati.imposte["ires"] and reddito is not None:
            dati.imposte["ires"][anno] = max(reddito, Decimal(0)) * _dec(parametri["aliquota_ires"])
            dati.imposte_stimate.add(("ires", anno))
        note = [a for a in dati.imposte["irap"] if a < anno]
        if anno not in dati.imposte["irap"] and note:
            dati.imposte["irap"][anno] = dati.imposte["irap"][max(note)]
            dati.imposte_stimate.add(("irap", anno))

    dati.tari_totali = {int(a): _dec(v) for a, v in parametri["tari_totali"].items()}
    for (codice,) in db.query(TesoreriaImpegno.codice).filter(TesoreriaImpegno.tipo == "tari",
                                                              TesoreriaImpegno.fonte == "avviso").all():
        _, anno, fase, *_ = codice.split(":")
        dati.tari_avvisi.add((int(anno), fase))
    return dati


def _tranche(parametri: dict) -> list:
    return [
        TrancheCredito(_dec(c["importo"]), date.fromisoformat(c["disponibile_dal"]),
                       date.fromisoformat(c["anticipabile_dal"]) if c.get("anticipabile_dal") else None)
        for c in parametri["crediti_iva"]
    ]


def ricalcola_credito(db: Session, oggi: date) -> Optional[Decimal]:
    """Riassegna il credito IVA agli impegni non pagati da oggi in poi. Non fa commit. Restituisce il residuo."""
    impegni = db.query(TesoreriaImpegno).filter(TesoreriaImpegno.stato != "pagato",
                                                TesoreriaImpegno.data_scadenza >= oggi).all()
    coperti, residuo = simula_credito(
        [(i.id, i.data_scadenza, importo_impegno(i), i.compensabile) for i in impegni], _tranche(leggi_parametri(db)),
    )
    for i in impegni:
        i.coperto_credito = coperti.get(i.id, ZERO)
    return residuo


def _json(i: TesoreriaImpegno) -> dict:
    importo = importo_impegno(i)
    coperto = i.stato != "pagato" and importo > 0 and i.coperto_credito >= importo
    return {
        "id": i.id, "codice": i.codice, "tipo": i.tipo, "fonte": i.fonte, "descrizione": i.descrizione,
        "competenza": i.competenza, "data_scadenza": i.data_scadenza.isoformat(), "data_manuale": i.data_manuale,
        "importo_stimato": euro(i.importo_stimato), "importo_confermato": euro(i.importo_confermato),
        "importo": euro(importo), "coperto_credito": euro(i.coperto_credito),
        "da_pagare": euro(max(importo - i.coperto_credito, ZERO)), "base_stima": i.base_stima,
        "compensabile": i.compensabile, "stato": i.stato, "stato_vista": "coperto" if coperto else i.stato,
        "movimento_id": i.movimento_id, "abbinamento": i.abbinamento, "nota": i.nota,
    }


# ── Generazione ─────────────────────────────────────────────────────────────────

def genera_impegni(db: Session, oggi: date) -> dict:
    """Aggiorna le scadenze da oggi all'orizzonte. Non tocca importi confermati, date spostate, pagati, avvisi
    e voci manuali. Cancella le stime non più previste. Non fa commit."""
    parametri = leggi_parametri(db)
    orizzonte = date.fromisoformat(parametri["orizzonte"])
    dati = dati_fiscali(db, parametri, orizzonte.year)
    previste = genera_scadenze(oggi, orizzonte, dati, (parametri["acconti_mese"], parametri["acconti_giorno"]),
                               parametri["giorno_tassa_soggiorno"])
    esistenti = {i.codice: i for i in db.query(TesoreriaImpegno).all()}
    n_nuovi = n_aggiornati = 0
    for p in previste:
        i = esistenti.get(p.codice)
        if i is None:
            db.add(TesoreriaImpegno(codice=p.codice, tipo=p.tipo, fonte="calendario", descrizione=p.descrizione,
                                    competenza=p.competenza, data_scadenza=p.data, importo_stimato=p.importo,
                                    base_stima=p.base, compensabile=p.compensabile, stato="stimato"))
            n_nuovi += 1
        elif i.fonte == "calendario" and i.stato != "pagato":
            i.importo_stimato, i.base_stima, i.descrizione = p.importo, p.base, p.descrizione
            if not i.data_manuale:
                i.data_scadenza = p.data
            n_aggiornati += 1
    codici = {p.codice for p in previste}
    n_rimossi = 0
    for i in esistenti.values():
        if (i.fonte == "calendario" and i.codice not in codici and i.stato == "stimato" and not i.data_manuale
                and i.movimento_id is None and i.data_scadenza >= oggi):
            db.delete(i)
            n_rimossi += 1
    db.flush()
    residuo = ricalcola_credito(db, oggi)
    return {"n_nuovi": n_nuovi, "n_aggiornati": n_aggiornati, "n_rimossi": n_rimossi,
            "credito_residuo": euro(residuo)}


# ── Endpoint ────────────────────────────────────────────────────────────────────

class ImpegnoManuale(BaseModel):
    descrizione: str
    data_scadenza: date
    importo: Decimal
    tipo: str = "altro"
    competenza: Optional[str] = None
    compensabile: bool = False
    nota: Optional[str] = None


class ImpegnoModifica(BaseModel):
    importo_confermato: Optional[Decimal] = None
    togli_conferma: bool = False
    data_scadenza: Optional[date] = None
    ripristina_data: bool = False
    nota: Optional[str] = None


class AzioneAbbinamento(BaseModel):
    azione: str   # conferma | scarta | annulla


class ConfermaTari(BaseModel):
    token: str
    fase: Optional[str] = None


@router.get("/impegni")
def lista_impegni(data_da: Optional[date] = Query(None), data_a: Optional[date] = Query(None),
                  tipo: Optional[str] = Query(None), db: Session = Depends(get_db), _=Depends(puo_vedere)):
    q = db.query(TesoreriaImpegno)
    if data_da:
        q = q.filter(TesoreriaImpegno.data_scadenza >= data_da)
    if data_a:
        q = q.filter(TesoreriaImpegno.data_scadenza <= data_a)
    if tipo:
        q = q.filter(TesoreriaImpegno.tipo == tipo)
    righe = q.order_by(TesoreriaImpegno.data_scadenza, TesoreriaImpegno.codice).all()
    return {
        "impegni": [_json(i) for i in righe],
        "totale": euro(sum((importo_impegno(i) for i in righe), ZERO)),
        "coperto_credito": euro(sum((i.coperto_credito for i in righe), ZERO)),
        "da_pagare": euro(sum((max(importo_impegno(i) - i.coperto_credito, ZERO) for i in righe), ZERO)),
    }


@router.get("/impegni/parametri")
def get_parametri(db: Session = Depends(get_db), _=Depends(puo_vedere)):
    return leggi_parametri(db)


@router.put("/impegni/parametri")
def put_parametri(corpo: dict, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    sconosciute = set(corpo) - set(PARAMETRI_DEFAULT)
    if sconosciute:
        raise HTTPException(400, f"Parametri sconosciuti: {', '.join(sorted(sconosciute))}")
    parametri = {**leggi_parametri(db), **corpo}
    riga = db.query(AppConfig).filter(AppConfig.key == CHIAVE_PARAMETRI).first()
    if riga:
        riga.value = json.dumps(parametri)
    else:
        db.add(AppConfig(key=CHIAVE_PARAMETRI, value=json.dumps(parametri)))
    db.commit()
    return parametri


@router.post("/impegni/genera")
def genera(db: Session = Depends(get_db), _=Depends(puo_modificare)):
    oggi = date.today()
    esito = genera_impegni(db, oggi)
    esito["piani"] = sincronizza_piani(db, oggi)
    esito["abbinamenti"] = abbina_impegni(db)
    db.commit()
    return esito


@router.post("/impegni/abbina")
def abbina(db: Session = Depends(get_db), _=Depends(puo_modificare)):
    esito = abbina_impegni(db)
    db.commit()
    return esito


@router.post("/impegni")
def crea_impegno(corpo: ImpegnoManuale, db: Session = Depends(get_db), utente: User = Depends(puo_modificare)):
    i = TesoreriaImpegno(
        codice=f"manuale:{uuid.uuid4().hex[:16]}", tipo=corpo.tipo, fonte="manuale", descrizione=corpo.descrizione,
        competenza=corpo.competenza, data_scadenza=corpo.data_scadenza, data_manuale=True,
        importo_stimato=corpo.importo, importo_confermato=corpo.importo, compensabile=corpo.compensabile,
        stato="confermato", nota=corpo.nota, utente_id=getattr(utente, "id", None),
    )
    db.add(i)
    db.flush()
    ricalcola_credito(db, date.today())
    db.commit()
    return _json(i)


def _impegno_o_404(db: Session, impegno_id: int) -> TesoreriaImpegno:
    i = db.get(TesoreriaImpegno, impegno_id)
    if i is None:
        raise HTTPException(404, "Impegno non trovato")
    return i


@router.put("/impegni/{impegno_id}")
def modifica_impegno(impegno_id: int, corpo: ImpegnoModifica, db: Session = Depends(get_db),
                     utente: User = Depends(puo_modificare)):
    i = _impegno_o_404(db, impegno_id)
    if corpo.togli_conferma:
        i.importo_confermato = None
        if i.stato == "confermato":
            i.stato = "stimato"
    elif corpo.importo_confermato is not None:
        i.importo_confermato = corpo.importo_confermato
        if i.stato == "stimato":
            i.stato = "confermato"
    if corpo.ripristina_data:
        i.data_manuale = False
    elif corpo.data_scadenza is not None:
        i.data_scadenza, i.data_manuale = corpo.data_scadenza, True
    if corpo.nota is not None:
        i.nota = corpo.nota or None
    i.utente_id = getattr(utente, "id", None)
    db.flush()
    ricalcola_credito(db, date.today())
    db.commit()
    return _json(i)


@router.delete("/impegni/{impegno_id}")
def elimina_impegno(impegno_id: int, db: Session = Depends(get_db), _=Depends(puo_modificare)):
    i = _impegno_o_404(db, impegno_id)
    if i.fonte in ("calendario", "piano"):
        raise HTTPException(400, "Le scadenze del calendario e dei piani non si eliminano: correggere importo o data")
    db.delete(i)
    db.flush()
    ricalcola_credito(db, date.today())
    db.commit()
    return {"ok": True}


@router.post("/impegni/{impegno_id}/abbinamento")
def scegli_abbinamento(impegno_id: int, corpo: AzioneAbbinamento, db: Session = Depends(get_db),
                       _=Depends(puo_modificare)):
    i = _impegno_o_404(db, impegno_id)
    if corpo.azione not in ("conferma", "scarta", "annulla"):
        raise HTTPException(400, "Azione non valida")
    if corpo.azione == "conferma" and i.movimento_id is None:
        raise HTTPException(400, "Nessun movimento da confermare")
    # Un addebito chiude tutti gli F24 della stessa scadenza: la scelta vale per l'intero gruppo
    gruppo = [i] if i.movimento_id is None else db.query(TesoreriaImpegno).filter(
        TesoreriaImpegno.movimento_id == i.movimento_id).all()
    for g in gruppo:
        if corpo.azione == "conferma":
            g.abbinamento, g.stato = "confermato", "pagato"
        else:
            g.movimento_id, g.abbinamento = None, "scartato" if corpo.azione == "scarta" else None
            g.stato = "confermato" if g.importo_confermato is not None else "stimato"
    db.commit()
    return [_json(g) for g in gruppo]


# ── Avviso TARI ─────────────────────────────────────────────────────────────────

def _leggi_avviso_o_400(contenuto: bytes):
    try:
        return parse_avviso_tari(contenuto)
    except ErroreImportTesoreria as e:
        raise HTTPException(400, str(e))


@router.post("/impegni/tari/anteprima")
async def anteprima_tari(file: UploadFile = File(...), _=Depends(puo_importare)):
    contenuto = await file.read()
    if not contenuto:
        raise HTTPException(400, "File vuoto")
    avviso = _leggi_avviso_o_400(contenuto)
    _pulisci_anteprime_scadute()
    token = uuid.uuid4().hex
    d = storage_dir() / "_anteprima" / token
    d.mkdir(parents=True, exist_ok=True)
    (d / "file.xml").write_bytes(contenuto)      # nome fisso dell'area anteprime, anche per i PDF
    (d / "meta.json").write_text(json.dumps({"nome_file": nome_sicuro(file.filename), "tipo": "tari",
                                             "sha256": hashlib.sha256(contenuto).hexdigest()}))
    return {
        "token": token, "numero": avviso.numero, "data_avviso": avviso.data_avviso.isoformat(), "anno": avviso.anno,
        "fase": avviso.fase, "totale": euro(avviso.totale),
        "rate": [{"numero": r.numero, "scadenza": r.scadenza.isoformat(), "importo": euro(r.importo)}
                 for r in avviso.rate],
    }


@router.post("/impegni/tari/conferma")
def conferma_tari(corpo: ConfermaTari, db: Session = Depends(get_db), utente: User = Depends(puo_importare)):
    d, meta, contenuto = _leggi_anteprima(corpo.token)
    if meta.get("tipo") != "tari":
        raise HTTPException(400, "Il token non è di un avviso TARI")
    avviso = _leggi_avviso_o_400(contenuto)
    fase = corpo.fase or avviso.fase
    if fase not in ("acconto", "conguaglio"):
        raise HTTPException(400, "Fase non valida")

    cartella = storage_dir() / "tari" / str(avviso.anno)
    cartella.mkdir(parents=True, exist_ok=True)
    (cartella / f"{avviso.numero}_{meta['nome_file']}").write_bytes(contenuto)

    # L'avviso sostituisce la stima della stessa fase e un eventuale avviso precedente non ancora pagato
    prefisso = f"tari:{avviso.anno}:{fase}"
    db.query(TesoreriaImpegno).filter(TesoreriaImpegno.codice.like(f"{prefisso}%"),
                                      TesoreriaImpegno.stato != "pagato").delete(synchronize_session=False)
    pagati = {c for (c,) in db.query(TesoreriaImpegno.codice).filter(TesoreriaImpegno.codice.like(f"{prefisso}%"))}
    creati = []
    for n, r in enumerate(avviso.rate, start=1):
        codice = f"{prefisso}:{n}"
        if codice in pagati:
            continue
        i = TesoreriaImpegno(
            codice=codice, tipo="tari", fonte="avviso", competenza=str(avviso.anno),
            descrizione=f"TARI {avviso.anno} {fase} (avviso {avviso.numero})", data_scadenza=r.scadenza,
            importo_stimato=r.importo, importo_confermato=r.importo, base_stima=f"Avviso n. {avviso.numero}",
            compensabile=False, stato="confermato", utente_id=getattr(utente, "id", None),
        )
        db.add(i)
        creati.append(i)
    db.flush()
    ricalcola_credito(db, date.today())
    db.commit()
    shutil.rmtree(d, ignore_errors=True)
    return {"impegni": [_json(i) for i in creati]}
