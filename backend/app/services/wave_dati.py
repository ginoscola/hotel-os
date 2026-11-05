"""Valori mensili e riferimento dell'indice WAVE, letti dal DB.

Fonti del fatturato per data documento (stessa natura dello storico):
- anni prima di `PRIMO_ANNO_HOTELOS`: tabella `wave_storico` (import del file Excel);
- dal `PRIMO_ANNO_HOTELOS`: `arrangiamenti` (IVA inclusa, senza tassa, penali e shop) di `report_fatturati()` dei
  Corrispettivi ÷ 1,10, sia per gli hotel sia per MMS/BON (corrispettivi manuali). Mai salvati in `wave_storico`.
Un anno dei Corrispettivi concorre al riferimento solo a stagione chiusa (`fine_stagione()`).
"""

from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.models.revenue import Hotel, HotelSeason
from app.models.wave import WaveStorico
from app.routers.corrispettivi_report import report_fatturati
from app.services.wave import MESI_WAVE, PERIODI, riferimenti, riferimento_stagione, valori_per_periodo
from app.services.wave_import import PRIMO_ANNO_HOTELOS, STRUTTURE

IVA = 1.10
# Ristoranti: la stagione è quella dell'hotel in cui operano (Mare Mosso al Du Parc, Buona Onda all'International)
HOTEL_DI_STRUTTURA = {'DPH': 'DPH', 'CLB': 'CLB', 'INT': 'INT', 'MMS': 'DPH', 'BON': 'INT'}


def fine_stagione(db: Session, struttura: str, anno: int) -> date:
    """Data di chiusura della stagione in `hotel_seasons`; senza stagione registrata, il 30/9."""
    s = (db.query(HotelSeason.close_date)
         .join(Hotel, Hotel.id == HotelSeason.hotel_id)
         .filter(Hotel.code == HOTEL_DI_STRUTTURA[struttura], HotelSeason.season_year == anno)
         .first())
    return s[0] if s else date(anno, 9, 30)


def lordo_storico_anno(db: Session, anno: int) -> Optional[float]:
    """Fatturato IVA inclusa (netto storico × 1,10) di hotel e ristoranti in un anno precedente a HotelOS, aprile–
    settembre. Usato dalla previsione di Tesoreria quando mancano i dati Revenue/Corrispettivi di quell'anno."""
    if anno >= PRIMO_ANNO_HOTELOS:
        return None
    righe = [float(r.netto) for r in db.query(WaveStorico).filter(WaveStorico.anno == anno)
             if r.struttura_code in STRUTTURE and r.mese in MESI_WAVE]
    return round(sum(righe) * IVA, 2) if righe else None


def valori_mensili(db: Session, oggi: date) -> dict:
    """→ {struttura: {anno: {'fonte': 'storico'|'corrispettivi', 'in_corso': bool, 'mesi': {mese: netto}}}}.
    Solo anni con almeno un mese di aprile–settembre."""
    out = {s: {} for s in STRUTTURE}
    for r in db.query(WaveStorico).filter(WaveStorico.anno < PRIMO_ANNO_HOTELOS):
        if r.struttura_code not in out or r.mese not in MESI_WAVE:
            continue
        anno = out[r.struttura_code].setdefault(r.anno, {'fonte': 'storico', 'in_corso': False, 'mesi': {}})
        anno['mesi'][r.mese] = float(r.netto)

    for a in range(PRIMO_ANNO_HOTELOS, oggi.year + 1):
        report = report_fatturati(anno=a, lordo=True, is_test=False, db=db, _=None)
        for m in report['mesi']:
            if m['mese'] not in MESI_WAVE:
                continue
            for codice, valori in m['per_struttura'].items():
                if codice not in out:
                    continue
                anno = out[codice].setdefault(a, {'fonte': 'corrispettivi', 'mesi': {},
                                                  'in_corso': oggi <= fine_stagione(db, codice, a)})
                anno['mesi'][m['mese']] = round(valori['arrangiamenti'] / IVA, 4)
    return out


def riferimento_anno(db: Session, anno: int, oggi: Optional[date] = None) -> dict:
    """Riferimento WAVE di ogni struttura per l'anno `anno` (migliore degli anni precedenti, stagioni in corso
    escluse) + i valori per periodo di tutti gli anni disponibili, per il confronto a schermo."""
    oggi = oggi or date.today()
    dati = valori_mensili(db, oggi)
    strutture = []
    for codice in STRUTTURE:
        anni = dati[codice]
        per_periodo = {a: valori_per_periodo(v['mesi']) for a, v in anni.items()}
        concorrono = {a: p for a, p in per_periodo.items() if not anni[a]['in_corso']}
        rif = riferimenti(concorrono, anno)
        periodi = []
        for cod_periodo, etichetta, mesi in PERIODI:
            periodi.append({
                'periodo': cod_periodo, 'etichetta': etichetta, 'mesi': list(mesi),
                'valori': {a: per_periodo[a].get(cod_periodo) for a in sorted(per_periodo)},
                **rif[cod_periodo],
            })
        strutture.append({
            'struttura_code': codice,
            'anni': [{'anno': a, 'fonte': anni[a]['fonte'], 'in_corso': anni[a]['in_corso'],
                      'concorre': a < anno and not anni[a]['in_corso'],
                      'stagione': sum(per_periodo[a].values()) if per_periodo[a] else None}
                     for a in sorted(anni)],
            'periodi': periodi,
            'riferimento': rif,
            'riferimento_stagione': riferimento_stagione(rif),
        })
    return {'anno': anno, 'strutture': strutture}
