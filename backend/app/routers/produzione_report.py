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
from sqlalchemy import Integer, cast, extract, func, literal_column
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.produzione import ProdCategoria, ProdDettaglioCategoria, ProdRiga
from app.routers.produzione_shared import STRUTTURE_HOTEL, aggrega_somme, query_report, somme_per
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


# Mese di data_riferimento come intero, da usare come chiave di GROUP BY (senza parametri
# legati, quindi identico nella SELECT e nel GROUP BY).
MESE = cast(extract('month', ProdRiga.data_riferimento), Integer)


def _per_categoria(somme_per_cat: dict, categorie: list[ProdCategoria]) -> dict:
    """{categoria_id: [tuple di somme_per()]} → {code categoria attiva: aggregato}.

    Le righe di categorie non attive non compaiono nel dettaglio (restano nel totale)."""
    cat_by_id = {c.id: c for c in categorie}
    per_code: dict[str, list] = defaultdict(list)
    for cat_id, valori in somme_per_cat.items():
        cat = cat_by_id.get(cat_id)
        per_code[cat.code if cat else 'altro'].extend(valori)
    return {cat.code: aggrega_somme(per_code.get(cat.code, [])) for cat in categorie}


def _raggruppa_per_giorno_struttura(db: Session, q, per_settimana: bool = False) -> list[dict]:
    """`q` = query_report(); somme per (giorno, struttura, categoria) dal database, poi
    ricomposte per settimana commerciale in Python (settimana_di legge app_config)."""
    categorie = _categorie_attive(db)
    somme = somme_per(q, ProdRiga.data_riferimento, ProdRiga.struttura_code, ProdRiga.categoria_id)
    gruppi: dict[tuple, dict] = defaultdict(lambda: defaultdict(list))
    for (giorno, sc, cat_id), valori in somme.items():
        chiave_data = settimana_di(giorno) if per_settimana else giorno
        gruppi[(chiave_data, sc)][cat_id].append(valori)

    out = []
    for (chiave_data, sc), per_cat in sorted(gruppi.items()):
        voce = {
            'struttura_code': sc,
            'per_categoria': _per_categoria(per_cat, categorie),
            'totale': aggrega_somme(v for vv in per_cat.values() for v in vv),
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
    q = query_report(db, data_da, data_a, struttura_code, categoria_code, canale, trattamento, is_test)
    return _raggruppa_per_giorno_struttura(db, q, per_settimana=False)


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
    q = query_report(db, data_da, data_a, struttura_code, categoria_code, canale, trattamento, is_test)
    return _raggruppa_per_giorno_struttura(db, q, per_settimana=True)


def _totale_mese(db: Session, anno: int, mese: int, struttura_code: Optional[str], is_test: bool) -> Optional[dict]:
    da = date(anno, mese, 1)
    a = date(anno, mese, calendar.monthrange(anno, mese)[1])
    somme = somme_per(query_report(db, da, a, struttura_code, None, None, None, is_test))
    valori = somme.get((), (0, 0, 0, 0))
    if not valori[3]:
        return None
    return aggrega_somme([valori])


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

    q = query_report(db, date(anno, 1, 1), date(anno, 12, 31), struttura_code, None, canale, trattamento, is_test)
    per_mese: dict[int, list] = defaultdict(list)
    per_mese_struttura: dict[tuple, dict] = defaultdict(lambda: defaultdict(list))
    for (m, sc, cat_id), valori in somme_per(q, MESE, ProdRiga.struttura_code, ProdRiga.categoria_id).items():
        per_mese[m].append(valori)
        per_mese_struttura[(m, sc)][cat_id].append(valori)

    mesi_out = []
    for m in range(1, 13):
        per_struttura = {}
        for sc in strutture:
            per_cat = per_mese_struttura.get((m, sc), {})
            per_struttura[sc] = {
                'totale': aggrega_somme(v for vv in per_cat.values() for v in vv),
                'per_categoria': _per_categoria(per_cat, categorie),
            }
        mesi_out.append({'mese': m, 'per_struttura': per_struttura, 'totale': aggrega_somme(per_mese.get(m, []))})

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


CODICI_PASTI = ['colazione', 'colazione_extra', 'pranzo', 'cena']


def _carica_conta_come_pasto(db: Session) -> set[str]:
    """Dettaglio_originale (normalizzato lower/trim) delle voci di mapping marcate
    conta_come_pasto=true — solo queste rappresentano un pasto vero (una riga a persona/pasto,
    es. "Quota Cena"), non i singoli piatti/bevande/coperti mappati nella stessa categoria
    colazione/pranzo/cena per finalità di ricavo (vedi migrazione prod006_2026)."""
    righe = db.query(ProdDettaglioCategoria).filter(ProdDettaglioCategoria.conta_come_pasto.is_(True)).all()
    return {r.dettaglio_originale.strip().lower() for r in righe}


def conteggio_vuoto() -> dict:
    out = {code: 0 for code in CODICI_PASTI}
    out['totale'] = 0
    return out


def _somma_conteggi(conteggi) -> dict:
    out = conteggio_vuoto()
    for c in conteggi:
        for code in CODICI_PASTI + ['totale']:
            out[code] += c[code]
    return out


def conta_pasti_per(db: Session, q, *chiavi) -> dict[tuple, dict]:
    """Conta (non somma importi) solo le righe 'quota' delle 4 categorie pasto — un Oid Welcome
    con dettaglio_originale marcato conta_come_pasto=true è un pasto/persona vero; le altre righe
    della stessa categoria (piatti/bevande/coperti) sono escluse dal conteggio.

    `q` = query_report(). Il database conta per (chiavi, categoria, dettaglio_originale); il
    confronto con le voci conta_come_pasto (strip/lower) resta in Python sui pochi valori
    distinti, identico a prima. Restituisce solo le chiavi con almeno un pasto."""
    categorie_pasto = {
        c.id: c.code for c in db.query(ProdCategoria).filter(ProdCategoria.code.in_(CODICI_PASTI)).all()
    }
    conta_pasto = _carica_conta_come_pasto(db)
    righe = (
        q.filter(ProdRiga.categoria_id.in_(list(categorie_pasto)))
        .with_entities(*chiavi, ProdRiga.categoria_id, ProdRiga.dettaglio_originale, func.count(ProdRiga.id))
        .group_by(*chiavi, ProdRiga.categoria_id, ProdRiga.dettaglio_originale)
        .all()
    )
    n = len(chiavi)
    out: dict[tuple, dict] = {}
    for r in righe:
        cat_id, dettaglio, quante = r[n], r[n + 1], r[n + 2]
        if (dettaglio or '').strip().lower() not in conta_pasto:
            continue
        conteggio = out.setdefault(tuple(r[:n]), conteggio_vuoto())
        conteggio[categorie_pasto[cat_id]] += quante
        conteggio['totale'] += quante
    return out


@router.get("/report/conteggio-pasti")
def report_conteggio_pasti(
    anno: int = Query(..., ge=2020, le=2035),
    struttura_code: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Conteggio (non ricavo) di colazioni/colazione extra/pranzi/cene per mese, struttura
    (solo DPH/CLB/INT, coerente col resto del modulo — BON escluso) e complessivo gruppo."""
    strutture = [struttura_code] if struttura_code else STRUTTURE_HOTEL
    q = query_report(db, date(anno, 1, 1), date(anno, 12, 31), struttura_code, None, None, None, is_test)
    conteggi = conta_pasti_per(db, q, MESE, ProdRiga.struttura_code)

    mesi_out = []
    for m in range(1, 13):
        per_struttura = {sc: conteggi.get((m, sc)) or conteggio_vuoto() for sc in strutture}
        mesi_out.append({'mese': m, 'per_struttura': per_struttura, 'totale': _somma_conteggi(per_struttura.values())})

    totale_anno = {code: sum(mo['totale'][code] for mo in mesi_out) for code in CODICI_PASTI + ['totale']}
    return {'anno': anno, 'mesi': mesi_out, 'totale_anno': totale_anno}


def _per_dimensione(
    db: Session, campo: str, data_da: date, data_a: date,
    struttura_code: Optional[str], is_test: bool,
) -> list[dict]:
    q = query_report(db, data_da, data_a, struttura_code, None, None, None, is_test)
    # NULL e '' confluiscono in 'Non specificato' (costanti come literal_column: un parametro
    # legato renderebbe diverse la SELECT e il GROUP BY per PostgreSQL).
    valore = func.coalesce(
        func.nullif(getattr(ProdRiga, campo), literal_column("''")), literal_column("'Non specificato'"),
    )
    somme = somme_per(q, valore, ProdRiga.struttura_code)
    prenotazioni = dict(
        q.with_entities(valore, func.count(func.distinct(func.nullif(ProdRiga.codice_prenotazione, literal_column("''")))))
        .group_by(valore)
        .all()
    )
    per_valore: dict[str, dict] = defaultdict(dict)
    for (v, sc), valori in somme.items():
        per_valore[v][sc] = valori
    totale_lordo = sum(valori[0] for valori in somme.values())

    out = []
    for v, per_sc in per_valore.items():
        lordo = sum(valori[0] for valori in per_sc.values())
        totale = aggrega_somme(per_sc.values())
        out.append({
            campo: v,
            'lordo': totale['lordo'],
            'n_prenotazioni': prenotazioni.get(v, 0),
            'n_righe': totale['n_righe'],
            'pct_totale': round(float(lordo / totale_lordo * 100), 2) if totale_lordo else 0.0,
            'per_struttura': {sc: aggrega_somme([per_sc[sc]] if sc in per_sc else []) for sc in STRUTTURE_HOTEL},
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
    conta_come_pasto: bool = False


@router.get("/mapping-dettagli")
def lista_mapping(db: Session = Depends(get_db)):
    """Mapping testo Welcome (Articolo) -> categoria — non hardcoded, gestito da admin."""
    righe = db.query(ProdDettaglioCategoria).order_by(ProdDettaglioCategoria.dettaglio_originale).all()
    return [
        {'id': r.id, 'dettaglio_originale': r.dettaglio_originale,
         'categoria_id': r.categoria_id, 'categoria_code': r.categoria.code, 'categoria_name': r.categoria.name,
         'categoria_da_prezzo': r.categoria_da_prezzo, 'conta_come_pasto': r.conta_come_pasto}
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
        conta_come_pasto=body.conta_come_pasto,
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
    riga.conta_come_pasto = body.conta_come_pasto
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
