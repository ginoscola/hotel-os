"""Sotto-router Statistiche Produzione — Ricavi per camera.

Montato sotto /produzione dall'aggregatore produzione.py.

Ricavi per singola camera in un periodo, scomposti per categoria di ricavo o per
tipo di trattamento. Fonte: `prod_righe` (registro gestionale, maturato notte per
notte) — NON il registro fiscale di Corrispettivi (fatturato alla partenza). I due
non coincidono sul singolo mese solare per i soggiorni a cavallo di fine mese
(effetto marcato sugli hotel a pacchetto settimanale); riconciliano sulla stagione.

Riusa `query_report()` di produzione_shared (stessi filtri della view v_prod_report:
is_riassetto=false, categoria.includi_report=true — quindi voucher pensione e
riassetti restano esclusi), `_categorie_attive()` di produzione_report e `_risposta()`
di produzione_export.

Endpoint:
  GET /produzione/ricavi-camere         → tabella camera × (categoria | trattamento)
  GET /produzione/ricavi-camere/export  → export xlsx/csv/pdf della stessa tabella
"""
import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import richiedi_utente_attivo
from app.database import get_db
from app.models.produzione import ProdRiga
from app.models.rooms import Room
from app.routers.corrispettivi_shared import NOME_STRUTTURA  # sole costanti condivise
from app.routers.produzione_export import _risposta
from app.routers.produzione_report import _categorie_attive
from app.routers.produzione_shared import STRUTTURE_HOTEL, query_report

router = APIRouter()

# Ordine "logico" dei trattamenti (dal più leggero al più completo). I valori non
# previsti finiscono in coda in ordine alfabetico; None → 'n/d', sempre ultimo.
_ORDINE_TRATTAMENTI = [
    'Solo Pernottamento', 'OTA-Solo Pernottamento',
    'Bed & Breakfast', 'OTA-Bed & Breakfast',
    'Mezza Pensione', 'Mezza Pensione AI',
    'Pensione Completa', 'All-Inclusive',
]
_TRATT_ND = 'n/d'


def _z() -> dict:
    return {'lordo': 0.0, 'imponibile': 0.0, 'iva': 0.0}


def _somma(acc: dict, lordo, imponibile, iva) -> None:
    acc['lordo'] += float(lordo or 0)
    acc['imponibile'] += float(imponibile or 0)
    acc['iva'] += float(iva or 0)


def _arr(agg: dict) -> dict:
    return {k: round(v, 2) for k, v in agg.items()}


def _anno_corrente_range() -> tuple:
    y = date.today().year
    return date(y, 1, 1), date(y, 12, 31)


def _num_camera(code: str):
    """Numero della camera senza il prefisso hotel (D101 → 101). Le camere senza
    cifre (FUEGO, AIRE, ...) vanno in fondo."""
    m = re.search(r'\d+', code or '')
    return int(m.group()) if m else float('inf')


def _ordina_trattamenti(valori: set) -> list:
    noti = [t for t in _ORDINE_TRATTAMENTI if t in valori]
    altri = sorted(v for v in valori if v not in _ORDINE_TRATTAMENTI and v != _TRATT_ND)
    coda = [_TRATT_ND] if _TRATT_ND in valori else []
    return noti + altri + coda


def _calcola(
    db: Session,
    hotel_code: str,
    data_da: date,
    data_a: date,
    includi_zero: bool,
    is_test: bool,
) -> dict:
    hotel_code = (hotel_code or 'GRUPPO').upper()
    is_gruppo = hotel_code == 'GRUPPO'
    if not is_gruppo and hotel_code not in STRUTTURE_HOTEL:
        raise HTTPException(400, f"hotel_code deve essere uno di {STRUTTURE_HOTEL} o 'GRUPPO'")
    struttura = None if is_gruppo else hotel_code

    categorie = _categorie_attive(db)
    cat_by_id = {c.id: c for c in categorie}

    base = query_report(db, data_da, data_a, struttura, is_test=is_test)

    righe_cat = (
        base.with_entities(
            ProdRiga.struttura_code, ProdRiga.camera, ProdRiga.categoria_id,
            func.sum(ProdRiga.prezzo_lordo), func.sum(ProdRiga.imponibile), func.sum(ProdRiga.iva),
        )
        .group_by(ProdRiga.struttura_code, ProdRiga.camera, ProdRiga.categoria_id)
        .all()
    )
    righe_tr = (
        base.with_entities(
            ProdRiga.struttura_code, ProdRiga.camera, ProdRiga.trattamento,
            func.sum(ProdRiga.prezzo_lordo), func.sum(ProdRiga.imponibile), func.sum(ProdRiga.iva),
        )
        .group_by(ProdRiga.struttura_code, ProdRiga.camera, ProdRiga.trattamento)
        .all()
    )

    camere: dict = {}

    def _riga(sc, cam):
        key = (sc, cam)
        if key not in camere:
            camere[key] = {
                'struttura_code': sc,
                'camera': cam,
                'tipo_camera': None,
                'totale': _z(),
                'per_categoria': {c.code: _z() for c in categorie},
                'per_trattamento': {},
            }
        return camere[key]

    trattamenti_visti: set = set()

    for sc, cam, cat_id, lo, im, iv in righe_cat:
        if not cam:
            continue
        r = _riga(sc, cam)
        cat = cat_by_id.get(cat_id)
        code = cat.code if cat else 'altro'
        r['per_categoria'].setdefault(code, _z())
        _somma(r['per_categoria'][code], lo, im, iv)
        _somma(r['totale'], lo, im, iv)

    for sc, cam, tr, lo, im, iv in righe_tr:
        if not cam:
            continue
        r = _riga(sc, cam)
        nome_tr = tr or _TRATT_ND
        trattamenti_visti.add(nome_tr)
        r['per_trattamento'].setdefault(nome_tr, _z())
        _somma(r['per_trattamento'][nome_tr], lo, im, iv)

    # Camere a zero (opzionale): tutte le camere in anagrafica per la/le struttura/e
    if includi_zero:
        q_rooms = db.query(Room)
        q_rooms = (q_rooms.filter(Room.struttura_code == struttura) if struttura
                   else q_rooms.filter(Room.struttura_code.in_(STRUTTURE_HOTEL)))
        for room in q_rooms.all():
            r = _riga(room.struttura_code, room.code)
            if r['tipo_camera'] is None:
                r['tipo_camera'] = room.nome_tipo

    # tipo_camera dai dati Produzione (prevale su nome_tipo di anagrafica)
    q_tipi = db.query(ProdRiga.struttura_code, ProdRiga.camera, func.max(ProdRiga.tipo_camera)) \
        .filter(ProdRiga.is_test.is_(is_test))
    if struttura:
        q_tipi = q_tipi.filter(ProdRiga.struttura_code == struttura)
    for sc, cam, tc in q_tipi.group_by(ProdRiga.struttura_code, ProdRiga.camera).all():
        if tc and (sc, cam) in camere:
            camere[(sc, cam)]['tipo_camera'] = tc

    # Ordine numerico di camera (per struttura), dalla più bassa alla più alta.
    lista = sorted(
        camere.values(),
        key=lambda x: (x['struttura_code'], _num_camera(x['camera']), x['camera']),
    )

    # Totali complessivi
    tot_cat = {c.code: _z() for c in categorie}
    tot_tr: dict = {}
    tot = _z()
    for r in lista:
        for code, agg in r['per_categoria'].items():
            tot_cat.setdefault(code, _z())
            for k in ('lordo', 'imponibile', 'iva'):
                tot_cat[code][k] += agg[k]
        for nome_tr, agg in r['per_trattamento'].items():
            tot_tr.setdefault(nome_tr, _z())
            for k in ('lordo', 'imponibile', 'iva'):
                tot_tr[nome_tr][k] += agg[k]
        for k in ('lordo', 'imponibile', 'iva'):
            tot[k] += r['totale'][k]

    ordine_tr = _ordina_trattamenti(trattamenti_visti | set(tot_tr))

    for r in lista:
        r['totale'] = _arr(r['totale'])
        r['per_categoria'] = {k: _arr(v) for k, v in r['per_categoria'].items()}
        r['per_trattamento'] = {t: _arr(r['per_trattamento'].get(t, _z())) for t in ordine_tr}

    q_range = db.query(func.min(ProdRiga.data_riferimento), func.max(ProdRiga.data_riferimento)) \
        .filter(ProdRiga.is_test.is_(is_test), ProdRiga.is_riassetto.is_(False))
    if struttura:
        q_range = q_range.filter(ProdRiga.struttura_code == struttura)
    rng_min, rng_max = q_range.one()

    return {
        'hotel_code': hotel_code,
        'is_gruppo': is_gruppo,
        'data_da': data_da.isoformat(),
        'data_a': data_a.isoformat(),
        'data_range_disponibile': {
            'min': rng_min.isoformat() if rng_min else None,
            'max': rng_max.isoformat() if rng_max else None,
        },
        'categorie': [
            {'code': c.code, 'name': c.name, 'colore': c.colore, 'ordine': c.ordine}
            for c in categorie
        ],
        'trattamenti': ordine_tr,
        'camere': lista,
        'totale': {
            'totale': _arr(tot),
            'per_categoria': {k: _arr(v) for k, v in tot_cat.items()},
            'per_trattamento': {t: _arr(tot_tr.get(t, _z())) for t in ordine_tr},
        },
    }


@router.get("/ricavi-camere")
def ricavi_camere(
    hotel_code: str = Query('GRUPPO', description="DPH|CLB|INT|GRUPPO"),
    data_da: Optional[date] = Query(None, description="default: 1 gen anno corrente"),
    data_a: Optional[date] = Query(None, description="default: 31 dic anno corrente"),
    includi_zero: bool = Query(False, description="include anche le camere senza ricavi nel periodo"),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    d_da, d_a = _anno_corrente_range()
    return _calcola(db, hotel_code, data_da or d_da, data_a or d_a, includi_zero, is_test)


@router.get("/ricavi-camere/export")
def export_ricavi_camere(
    hotel_code: str = Query('GRUPPO'),
    data_da: Optional[date] = Query(None),
    data_a: Optional[date] = Query(None),
    vista: str = Query('categoria', pattern="^(categoria|trattamento)$"),
    lordo: bool = Query(True, description="True=IVA inclusa, False=imponibile"),
    includi_zero: bool = Query(False),
    formato: str = Query('xlsx', pattern="^(xlsx|csv|pdf)$"),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    """Export della tabella Ricavi Camere nella vista corrente (categoria|trattamento)."""
    d_da, d_a = _anno_corrente_range()
    data_da = data_da or d_da
    data_a = data_a or d_a
    res = _calcola(db, hotel_code, data_da, data_a, includi_zero, is_test)

    campo = 'lordo' if lordo else 'imponibile'
    is_gruppo = res['is_gruppo']

    if vista == 'trattamento':
        colonne = [t for t in res['trattamenti']
                   if res['totale']['per_trattamento'].get(t, {}).get(campo, 0)]
        etichette = list(colonne)

        def _val(r, key):
            return r['per_trattamento'].get(key, {}).get(campo, 0)
    else:
        cat_tot = res['totale']['per_categoria']
        colonne = [c['code'] for c in res['categorie'] if cat_tot.get(c['code'], {}).get(campo, 0)]
        nome_cat = {c['code']: c['name'] for c in res['categorie']}
        etichette = [nome_cat.get(c, c) for c in colonne]

        def _val(r, key):
            return r['per_categoria'].get(key, {}).get(campo, 0)

    pre = ['Struttura'] if is_gruppo else []
    intestazioni = pre + ['Camera', 'Tipo'] + etichette + ['TOTALE €']

    righe = []
    for r in res['camere']:
        riga = ([NOME_STRUTTURA.get(r['struttura_code'], r['struttura_code'])] if is_gruppo else [])
        riga += [r['camera'], r['tipo_camera'] or '']
        riga += [_val(r, k) for k in colonne]
        riga += [r['totale'][campo]]
        righe.append(riga)

    tot_riga = (['TOTALE', '', ''] if is_gruppo else ['TOTALE', ''])
    src = res['totale']['per_trattamento'] if vista == 'trattamento' else res['totale']['per_categoria']
    tot_riga += [src.get(k, {}).get(campo, 0) for k in colonne]
    tot_riga += [res['totale']['totale'][campo]]
    righe.append(tot_riga)

    nome_h = 'GRUPPO' if is_gruppo else hotel_code.upper()
    iva_txt = 'IVA inclusa' if lordo else 'IVA esclusa'
    titolo = (f"Ricavi camere — {nome_h} — {data_da.strftime('%d/%m/%Y')}–"
              f"{data_a.strftime('%d/%m/%Y')} — vista {vista} — {iva_txt}")
    nome = f"ricavi_camere_{nome_h}_{data_da.isoformat()}_{data_a.isoformat()}"
    return _risposta(formato, nome, titolo, intestazioni, righe)
