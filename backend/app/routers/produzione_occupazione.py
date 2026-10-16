"""Sotto-router Statistiche Produzione — tab "Occupazione e Consumo".

Dati mensili di occupazione/consumo per struttura (formato della maschera "Dati di Occupazione
o Consumo" del gestionale contabile). Du Parc e Maremosso sono una struttura sola (DPH), come
nel Conto Economico USALI.

Voci automatiche, calcolate a query-time (mai salvate, salvo correzione manuale):
- Camere Vendibili  → hotel_seasons.total_rooms × giorni di apertura nel mese
- Camere Occupate / Clienti Presenze → daily_revenue (snapshot più recente, produzione_mensile())
- Arrivi Camere / Arrivi Clienti → import Welcome "Prenotazioni non disdette"
  (prenotazioni_cancellate con cancellata=false, una riga = una camera, pax = clienti)
- Colazione → conteggio pasti (quota colazione + colazione extra)
- Ristorante → conteggio pasti pranzo + cena (solo ospiti hotel: i clienti esterni del
  Mare Mosso non hanno un conteggio persone, solo l'incasso)
Voci manuali: utenze, altri reparti, tutto BON.

Una riga in prod_occupazione_consumi su una voce automatica è una correzione che sostituisce il
calcolo; valore=null nel PUT la cancella e ripristina il valore automatico.

Endpoint:
  GET /produzione/occupazione-consumi?struttura=&anno=
  PUT /produzione/occupazione-consumi   (admin) {struttura_code, anno, mese, voce_code, valore|null}
"""
import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.prenotazioni import PrenotazioneCancellata
from app.models.produzione import ProdCategoria, ProdOccupazioneConsumo
from app.models.revenue import Hotel, HotelSeason
from app.routers.produzione_report import _carica_conta_come_pasto, _conta_pasti
from app.routers.produzione_shared import STRUTTURE_HOTEL, query_report
from app.services.usali_contabile_kpi import produzione_mensile

router = APIRouter(dependencies=[Depends(richiedi_utente_attivo)])

STRUTTURE = STRUTTURE_HOTEL + ['BON']

# (voce_code, reparto, dato, sorgente automatica | None = manuale). Ordine = ordine a schermo.
_VOCI_HOTEL = [
    ('altri_reparti_presenze', 'Altri Reparti Operativi', 'Clienti Presenze', None),
    ('camere_arrivi', 'Camere', 'Arrivi Camere', 'arrivi_camere'),
    ('camere_arrivi_clienti', 'Camere', 'Arrivi Clienti', 'arrivi_clienti'),
    ('camere_occupate', 'Camere', 'Camere Occupate', 'camere_occupate'),
    ('camere_vendibili', 'Camere', 'Camere Vendibili', 'camere_vendibili'),
    ('camere_presenze', 'Camere', 'Clienti Presenze', 'presenze'),
    ('colazione_presenze', 'Colazione', 'Clienti Presenze', 'colazioni'),
    ('ristorante_presenze', 'Ristorante', 'Clienti Presenze', 'pasti_ristorante'),
]
_VOCI_UTENZE = [
    ('utenze_kwh', 'Utenze', 'kWh - Energia', None),
    ('utenze_acqua_m3', 'Utenze', 'Metri Cubi - Acqua', None),
    ('utenze_gas_smc', 'Utenze', 'Standard Metro Cubo - Gas', None),
]


def voci_struttura(struttura: str) -> list[tuple]:
    if struttura == 'BON':
        return [('ristorante_presenze', 'Ristorante', 'Clienti Presenze', None)] + _VOCI_UTENZE
    return _VOCI_HOTEL + _VOCI_UTENZE


def _camere_vendibili(db: Session, struttura: str, anno: int) -> dict[int, Optional[int]]:
    """Camere della stagione × giorni di apertura nel mese (0 fuori stagione, None senza stagione)."""
    hotel = db.query(Hotel).filter_by(code=struttura).first()
    stagione = hotel and db.query(HotelSeason).filter_by(hotel_id=hotel.id, season_year=anno).first()
    if not stagione or not stagione.total_rooms:
        return {m: None for m in range(1, 13)}
    out = {}
    for m in range(1, 13):
        inizio = max(date(anno, m, 1), stagione.open_date)
        fine = min(date(anno, m, calendar.monthrange(anno, m)[1]), stagione.close_date)
        giorni = (fine - inizio).days + 1 if fine >= inizio else 0
        out[m] = stagione.total_rooms * giorni
    return out


def _arrivi(db: Session, struttura: str, anno: int) -> dict[int, tuple[int, int]]:
    righe = (
        db.query(extract('month', PrenotazioneCancellata.arrivo).label('mese'),
                 func.count(PrenotazioneCancellata.id), func.sum(PrenotazioneCancellata.pax))
        .filter(PrenotazioneCancellata.hotel_code == struttura,
                PrenotazioneCancellata.cancellata.is_(False),
                PrenotazioneCancellata.is_test.is_(False),
                extract('year', PrenotazioneCancellata.arrivo) == anno)
        .group_by('mese')
        .all()
    )
    return {int(m): (int(n or 0), int(pax or 0)) for m, n, pax in righe}


def _pasti(db: Session, struttura: str, anno: int) -> dict[int, dict]:
    categorie_by_id = {c.id: c for c in db.query(ProdCategoria).all()}
    conta_pasto = _carica_conta_come_pasto(db)
    righe = query_report(db, date(anno, 1, 1), date(anno, 12, 31), struttura, None, None, None, False).all()
    per_mese = defaultdict(list)
    for r in righe:
        per_mese[r.data_riferimento.month].append(r)
    return {m: _conta_pasti(rr, categorie_by_id, conta_pasto) for m, rr in per_mese.items()}


def _valori_automatici(db: Session, struttura: str, anno: int) -> dict[str, dict[int, Optional[float]]]:
    """{sorgente: {mese: valore|None}} — None = dato non disponibile (mai zero inventato)."""
    if struttura not in STRUTTURE_HOTEL:
        return {}
    revenue = produzione_mensile(db, struttura, anno)
    arrivi = _arrivi(db, struttura, anno)
    pasti = _pasti(db, struttura, anno)
    vendibili = _camere_vendibili(db, struttura, anno)

    def _rev(m, campo):
        return revenue[m][campo] if revenue[m]['stato'] in ('ok', 'chiuso') else None

    out = defaultdict(dict)
    for m in range(1, 13):
        out['camere_vendibili'][m] = vendibili[m]
        out['camere_occupate'][m] = _rev(m, 'camere_vendute')
        out['presenze'][m] = _rev(m, 'presenze')
        out['arrivi_camere'][m] = arrivi[m][0] if m in arrivi else None
        out['arrivi_clienti'][m] = arrivi[m][1] if m in arrivi else None
        p = pasti.get(m)
        out['colazioni'][m] = p['colazione'] + p['colazione_extra'] if p else None
        out['pasti_ristorante'][m] = p['pranzo'] + p['cena'] if p else None
    return out


def _num(v):
    if v is None:
        return None
    f = float(v)
    return int(f) if f == int(f) else round(f, 2)


def _verifica_struttura(struttura: str):
    if struttura not in STRUTTURE:
        raise HTTPException(400, f"Struttura non valida: {struttura} (ammesse: {', '.join(STRUTTURE)})")


@router.get("/occupazione-consumi")
def get_occupazione_consumi(
    struttura: str = Query(...),
    anno: int = Query(..., ge=2020, le=2035),
    db: Session = Depends(get_db),
):
    _verifica_struttura(struttura)
    automatici = _valori_automatici(db, struttura, anno)
    manuali = {
        (r.voce_code, r.mese): r.valore
        for r in db.query(ProdOccupazioneConsumo).filter_by(struttura_code=struttura, anno=anno).all()
    }

    voci = []
    for code, reparto, dato, sorgente in voci_struttura(struttura):
        mesi = []
        for m in range(1, 13):
            auto = automatici.get(sorgente, {}).get(m) if sorgente else None
            man = manuali.get((code, m))
            mesi.append({
                'mese': m,
                'automatico': _num(auto),
                'manuale': _num(man),
                'valore': _num(man) if man is not None else _num(auto),
            })
        valori = [x['valore'] for x in mesi if x['valore'] is not None]
        voci.append({
            'voce_code': code, 'reparto': reparto, 'dato': dato,
            'tipo': 'auto' if sorgente else 'manuale',
            'mesi': mesi,
            'totale': _num(sum(valori)) if valori else None,
        })
    return {'struttura': struttura, 'anno': anno, 'voci': voci}


class ValoreInput(BaseModel):
    struttura_code: str
    anno: int
    mese: int
    voce_code: str
    valore: Optional[Decimal] = None


@router.put("/occupazione-consumi")
def put_occupazione_consumi(body: ValoreInput, db: Session = Depends(get_db), utente=Depends(richiedi_admin)):
    _verifica_struttura(body.struttura_code)
    if not 1 <= body.mese <= 12:
        raise HTTPException(400, "Mese non valido")
    if body.voce_code not in {v[0] for v in voci_struttura(body.struttura_code)}:
        raise HTTPException(400, f"Voce non valida per {body.struttura_code}: {body.voce_code}")
    if body.valore is not None and body.valore < 0:
        raise HTTPException(400, "Il valore non può essere negativo")

    riga = db.query(ProdOccupazioneConsumo).filter_by(
        struttura_code=body.struttura_code, anno=body.anno, mese=body.mese, voce_code=body.voce_code,
    ).first()
    if body.valore is None:
        if riga:
            db.delete(riga)
    elif riga:
        riga.valore = body.valore
        riga.modificato_da = getattr(utente, 'id', None)
    else:
        db.add(ProdOccupazioneConsumo(
            struttura_code=body.struttura_code, anno=body.anno, mese=body.mese,
            voce_code=body.voce_code, valore=body.valore, modificato_da=getattr(utente, 'id', None),
        ))
    db.commit()
    return {'ok': True}
