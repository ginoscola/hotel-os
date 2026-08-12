"""Sotto-router Statistiche Produzione — report giornaliero/settimanale/mensile/canali/
trattamenti/tipo-ospite + liste valori distinti per i filtri UI.

Montato sotto /produzione dall'aggregatore produzione.py.
"""
import calendar
from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.produzione import ProdCategoria, ProdDettaglioCategoria, ProdRiga
from app.routers.produzione_shared import STRUTTURE_HOTEL, aggrega, query_report
from app.services.prod_parser import _carica_mapping_dettagli, _categoria_id_da_articolo
from app.services.weekly_aggregator import settimana_di

router = APIRouter(dependencies=[Depends(richiedi_utente_attivo)])


def _categorie_attive(db: Session) -> list[ProdCategoria]:
    return (
        db.query(ProdCategoria)
        .filter(ProdCategoria.includi_report.is_(True), ProdCategoria.attivo.is_(True))
        .order_by(ProdCategoria.ordine)
        .all()
    )


def _per_categoria(righe: list[ProdRiga], categorie: list[ProdCategoria]) -> dict:
    cat_by_id = {c.id: c for c in categorie}
    per_cat: dict[str, list[ProdRiga]] = defaultdict(list)
    for r in righe:
        cat = cat_by_id.get(r.categoria_id)
        per_cat[cat.code if cat else 'altro'].append(r)

    out = {}
    for cat in categorie:
        rr = per_cat.get(cat.code, [])
        out[cat.code] = aggrega(rr)
    return out


def _raggruppa_per_giorno_struttura(
    db: Session, righe: list[ProdRiga], data_da: date, data_a: date,
    per_settimana: bool = False,
) -> list[dict]:
    categorie = _categorie_attive(db)
    gruppi: dict[tuple, list[ProdRiga]] = defaultdict(list)
    for r in righe:
        chiave_data = settimana_di(r.data_riferimento) if per_settimana else r.data_riferimento
        gruppi[(chiave_data, r.struttura_code)].append(r)

    out = []
    for (chiave_data, sc), rr in sorted(gruppi.items()):
        voce = {
            'struttura_code': sc,
            'per_categoria': _per_categoria(rr, categorie),
            'totale': aggrega(rr),
        }
        if per_settimana:
            voce['week_start'] = chiave_data.isoformat()
        else:
            voce['data'] = chiave_data.isoformat()
        out.append(voce)
    return out


@router.get("/righe")
def righe_analitiche(
    data_da: date = Query(...),
    data_a: date = Query(...),
    struttura_code: Optional[str] = Query(None),
    categoria_code: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Righe analitiche di dettaglio (per il drawer di Produzione giornaliera)."""
    righe = query_report(db, data_da, data_a, struttura_code, categoria_code, None, None, is_test).all()
    return [
        {
            'id': r.id,
            'data': r.data_riferimento.isoformat(),
            'camera': r.camera,
            'dettaglio_originale': r.dettaglio_originale,
            'ospite': r.ospite,
            'trattamento': r.trattamento,
            'canale': r.canale,
            'lordo': float(r.prezzo_lordo),
            'imponibile': float(r.imponibile),
            'iva': float(r.iva),
        }
        for r in righe
    ]


@router.get("/report/giornaliero")
def report_giornaliero(
    data_da: date = Query(...),
    data_a: date = Query(...),
    struttura_code: Optional[str] = Query(None),
    categoria_code: Optional[str] = Query(None),
    canale: Optional[str] = Query(None),
    trattamento: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    righe = query_report(db, data_da, data_a, struttura_code, categoria_code, canale, trattamento, is_test).all()
    return _raggruppa_per_giorno_struttura(db, righe, data_da, data_a, per_settimana=False)


@router.get("/report/settimanale")
def report_settimanale(
    data_da: date = Query(...),
    data_a: date = Query(...),
    struttura_code: Optional[str] = Query(None),
    categoria_code: Optional[str] = Query(None),
    canale: Optional[str] = Query(None),
    trattamento: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Aggregata per settimana commerciale (sab-ven, week_start_weekday da app_config)."""
    righe = query_report(db, data_da, data_a, struttura_code, categoria_code, canale, trattamento, is_test).all()
    return _raggruppa_per_giorno_struttura(db, righe, data_da, data_a, per_settimana=True)


def _totale_mese(db: Session, anno: int, mese: int, struttura_code: Optional[str], is_test: bool) -> Optional[dict]:
    da = date(anno, mese, 1)
    a = date(anno, mese, calendar.monthrange(anno, mese)[1])
    righe = query_report(db, da, a, struttura_code, None, None, None, is_test).all()
    if not righe:
        return None
    return aggrega(righe)


@router.get("/report/mensile")
def report_mensile(
    anno: int = Query(..., ge=2020, le=2035),
    mese: Optional[int] = Query(None, ge=1, le=12),
    struttura_code: Optional[str] = Query(None),
    canale: Optional[str] = Query(None),
    trattamento: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Aggregata per mese solare. Senza `mese`: tutti i 12 mesi dell'anno (tabella riepilogo).
    Con `mese`: aggiunge confronto col mese precedente e con lo stesso mese dell'anno precedente."""
    categorie = _categorie_attive(db)
    strutture = [struttura_code] if struttura_code else STRUTTURE_HOTEL

    mesi_out = []
    for m in range(1, 13):
        da = date(anno, m, 1)
        a = date(anno, m, calendar.monthrange(anno, m)[1])
        righe = query_report(db, da, a, struttura_code, None, canale, trattamento, is_test).all()
        per_struttura = {}
        for sc in strutture:
            rr = [r for r in righe if r.struttura_code == sc]
            per_struttura[sc] = {'totale': aggrega(rr), 'per_categoria': _per_categoria(rr, categorie)}
        mesi_out.append({'mese': m, 'per_struttura': per_struttura, 'totale': aggrega(righe)})

    # totale_anno: somma dei totali mensili già calcolati (evita una seconda query)
    totale_anno = {
        'lordo': round(sum(mo['totale']['lordo'] for mo in mesi_out), 2),
        'imponibile': round(sum(mo['totale']['imponibile'] for mo in mesi_out), 2),
        'iva': round(sum(mo['totale']['iva'] for mo in mesi_out), 2),
        'n_righe': sum(mo['totale']['n_righe'] for mo in mesi_out),
    }
    risposta = {'anno': anno, 'mesi': mesi_out, 'totale_anno': totale_anno}

    if mese:
        prec_mese, prec_anno = (mese - 1, anno) if mese > 1 else (12, anno - 1)
        risposta['confronto_mese_precedente'] = _totale_mese(db, prec_anno, prec_mese, struttura_code, is_test)
        risposta['confronto_anno_precedente'] = _totale_mese(db, anno - 1, mese, struttura_code, is_test)

    return risposta


def _per_dimensione(
    db: Session, campo: str, data_da: date, data_a: date,
    struttura_code: Optional[str], is_test: bool,
) -> list[dict]:
    righe = query_report(db, data_da, data_a, struttura_code, None, None, None, is_test).all()
    totale_lordo = sum(float(r.prezzo_lordo) for r in righe)

    gruppi: dict[str, list[ProdRiga]] = defaultdict(list)
    for r in righe:
        valore = getattr(r, campo) or 'Non specificato'
        gruppi[valore].append(r)

    out = []
    for valore, rr in gruppi.items():
        lordo = sum(float(x.prezzo_lordo) for x in rr)
        per_struttura = {sc: aggrega([x for x in rr if x.struttura_code == sc]) for sc in STRUTTURE_HOTEL}
        out.append({
            campo: valore,
            'lordo': round(lordo, 2),
            'n_prenotazioni': len({x.codice_prenotazione for x in rr if x.codice_prenotazione}),
            'n_righe': len(rr),
            'pct_totale': round(lordo / totale_lordo * 100, 2) if totale_lordo else 0.0,
            'per_struttura': per_struttura,
        })
    out.sort(key=lambda x: -x['lordo'])
    return out


@router.get("/report/canali")
def report_canali(
    data_da: date = Query(...),
    data_a: date = Query(...),
    struttura_code: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    return {'per_canale': _per_dimensione(db, 'canale', data_da, data_a, struttura_code, is_test)}


@router.get("/report/trattamenti")
def report_trattamenti(
    data_da: date = Query(...),
    data_a: date = Query(...),
    struttura_code: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    return {'per_trattamento': _per_dimensione(db, 'trattamento', data_da, data_a, struttura_code, is_test)}


@router.get("/report/tipo-ospite")
def report_tipo_ospite(
    data_da: date = Query(...),
    data_a: date = Query(...),
    struttura_code: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    return {'per_tipo_ospite': _per_dimensione(db, 'tipo_ospite', data_da, data_a, struttura_code, is_test)}


@router.get("/categorie")
def lista_categorie(db: Session = Depends(get_db)):
    cats = db.query(ProdCategoria).order_by(ProdCategoria.ordine).all()
    return [
        {
            'id': c.id, 'code': c.code, 'name': c.name, 'descrizione': c.descrizione,
            'includi_report': c.includi_report, 'ordine': c.ordine, 'colore': c.colore,
            'attivo': c.attivo,
            'tariffa_riferimento': float(c.tariffa_riferimento) if c.tariffa_riferimento is not None else None,
        }
        for c in cats
    ]


class CategoriaInput(BaseModel):
    code: str
    name: str
    descrizione: Optional[str] = None
    includi_report: bool = True
    ordine: int = 0
    colore: Optional[str] = None
    attivo: bool = True
    tariffa_riferimento: Optional[float] = None


class CategoriaUpdate(BaseModel):
    name: Optional[str] = None
    descrizione: Optional[str] = None
    includi_report: Optional[bool] = None
    ordine: Optional[int] = None
    colore: Optional[str] = None
    attivo: Optional[bool] = None
    tariffa_riferimento: Optional[float] = None


@router.post("/categorie")
def crea_categoria(body: CategoriaInput, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    if db.query(ProdCategoria).filter(ProdCategoria.code == body.code).first():
        raise HTTPException(status_code=400, detail=f"Categoria '{body.code}' già esistente")
    cat = ProdCategoria(**body.model_dump())
    db.add(cat)
    db.commit()
    return {'id': cat.id}


@router.put("/categorie/{categoria_id}")
def aggiorna_categoria(categoria_id: int, body: CategoriaUpdate, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    cat = db.query(ProdCategoria).filter(ProdCategoria.id == categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoria non trovata")
    for campo, valore in body.model_dump(exclude_unset=True).items():
        setattr(cat, campo, valore)
    db.commit()
    return {'id': cat.id}


class MappingInput(BaseModel):
    dettaglio_originale: str
    categoria_id: int
    categoria_da_prezzo: bool = False


@router.get("/mapping-dettagli")
def lista_mapping(db: Session = Depends(get_db)):
    """Mapping testo Welcome (Articolo) -> categoria — non hardcoded, gestito da admin."""
    righe = db.query(ProdDettaglioCategoria).order_by(ProdDettaglioCategoria.dettaglio_originale).all()
    return [
        {'id': r.id, 'dettaglio_originale': r.dettaglio_originale,
         'categoria_id': r.categoria_id, 'categoria_code': r.categoria.code, 'categoria_name': r.categoria.name,
         'categoria_da_prezzo': r.categoria_da_prezzo}
        for r in righe
    ]


@router.get("/altro-da-smistare")
def altro_da_smistare(db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    """Voci non ancora mappate (finiscono in 'Altro'), ordinate per importo totale decrescente —
    per capire da dove conviene iniziare a smistare (es. Spiaggia/Bar valgono molto di più di
    una voce isolata da 5€). Solo dati reali (is_test=false), su tutti gli import."""
    mappate = {r.dettaglio_originale.strip().lower() for r in db.query(ProdDettaglioCategoria).all()}
    righe = (
        db.query(
            ProdRiga.dettaglio_originale,
            func.count(ProdRiga.id).label('n_righe'),
            func.sum(ProdRiga.prezzo_lordo).label('totale_lordo'),
        )
        .join(ProdCategoria, ProdCategoria.id == ProdRiga.categoria_id)
        .filter(ProdCategoria.code == 'altro', ProdRiga.is_test.is_(False), ProdRiga.is_riassetto.is_(False))
        .group_by(ProdRiga.dettaglio_originale)
        .all()
    )
    non_mappate = [
        {'dettaglio_originale': r.dettaglio_originale, 'n_righe': r.n_righe, 'totale_lordo': float(r.totale_lordo or 0)}
        for r in righe
        if (r.dettaglio_originale or '').strip().lower() not in mappate
    ]
    non_mappate.sort(key=lambda x: -x['totale_lordo'])
    return non_mappate


@router.post("/mapping-dettagli")
def crea_mapping(body: MappingInput, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    esiste = db.query(ProdDettaglioCategoria).filter(
        func.lower(ProdDettaglioCategoria.dettaglio_originale) == body.dettaglio_originale.strip().lower()
    ).first()
    if esiste:
        raise HTTPException(status_code=400, detail=f"Mapping per '{body.dettaglio_originale}' già esistente")
    riga = ProdDettaglioCategoria(
        dettaglio_originale=body.dettaglio_originale.strip(),
        categoria_id=body.categoria_id, categoria_da_prezzo=body.categoria_da_prezzo,
    )
    db.add(riga)
    db.commit()
    return {'id': riga.id}


@router.put("/mapping-dettagli/{mapping_id}")
def aggiorna_mapping(mapping_id: int, body: MappingInput, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    riga = db.query(ProdDettaglioCategoria).filter(ProdDettaglioCategoria.id == mapping_id).first()
    if not riga:
        raise HTTPException(status_code=404, detail="Mapping non trovato")
    riga.dettaglio_originale = body.dettaglio_originale.strip()
    riga.categoria_id = body.categoria_id
    riga.categoria_da_prezzo = body.categoria_da_prezzo
    db.commit()
    return {'id': riga.id}


@router.delete("/mapping-dettagli/{mapping_id}")
def elimina_mapping(mapping_id: int, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    riga = db.query(ProdDettaglioCategoria).filter(ProdDettaglioCategoria.id == mapping_id).first()
    if not riga:
        raise HTTPException(status_code=404, detail="Mapping non trovato")
    db.delete(riga)
    db.commit()
    return {'eliminato': mapping_id}


@router.post("/ricalcola-categorie")
def ricalcola_categorie(db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    """Riassegna categoria_id a tutte le prod_righe esistenti applicando il mapping attuale.

    categoria_id viene scritto una sola volta in fase di import (prod_parser.parse_xlsx),
    leggendo prod_dettaglio_categoria in quel momento: una modifica al mapping fatta dopo
    (es. smistare 'Caffè' da Altro a Bar Caffetteria) non tocca le righe già salvate, che
    restano nella vecchia categoria finché non si ricalcola esplicitamente qui — senza dover
    ri-importare i file originali.
    """
    categorie_by_id = {c.id: c for c in db.query(ProdCategoria).all()}
    mapping_dettagli = _carica_mapping_dettagli(db)

    n_aggiornate = 0
    righe = db.query(ProdRiga).filter(ProdRiga.is_test.is_(False)).all()
    for r in righe:
        nuova_categoria_id = _categoria_id_da_articolo(
            r.dettaglio_originale, float(r.prezzo_lordo), mapping_dettagli, categorie_by_id,
        )
        if nuova_categoria_id != r.categoria_id:
            r.categoria_id = nuova_categoria_id
            n_aggiornate += 1
    db.commit()
    return {'n_righe_esaminate': len(righe), 'n_righe_aggiornate': n_aggiornate}


def _valori_distinti(db: Session, campo) -> list[str]:
    righe = db.query(campo).filter(campo.isnot(None), ProdRiga.is_test.is_(False)).distinct().all()
    return sorted({r[0] for r in righe if r[0]})


@router.get("/canali/lista")
def lista_canali(db: Session = Depends(get_db)):
    return _valori_distinti(db, ProdRiga.canale)


@router.get("/trattamenti/lista")
def lista_trattamenti(db: Session = Depends(get_db)):
    return _valori_distinti(db, ProdRiga.trattamento)


@router.get("/tipi-ospite/lista")
def lista_tipi_ospite(db: Session = Depends(get_db)):
    return _valori_distinti(db, ProdRiga.tipo_ospite)
