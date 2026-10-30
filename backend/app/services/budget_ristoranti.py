"""Budget dei ristoranti: confronto settimanale con i corrispettivi manuali e proiezione.

Importi IVA inclusa (aliquota unica 10%), come corrispettivi_manuali.arrangiamenti_lordo.
Mare Mosso = solo clienti esterni: gli ospiti Du Parc sono nel F&B del budget DPH.
Proiezione: consuntivo dove c'è, altrimenti budget (nessuna prenotazione, quindi nessun pickup).
Lo scostamento confronta solo le settimane chiuse con budget e consuntivo.
"""

from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.corrispettivi import CorrispettiviManuale
from app.models.revenue import BudgetRistorante, HotelSeason
from app.services.budget_calculator import calcola_mese_contabile
from app.services.weekly_aggregator import settimana_di

RISTORANTI = {'MMS': 'Mare Mosso — clienti esterni', 'BON': 'Buona Onda'}
SOGLIA_TREND = 0.05  # stessa soglia della proiezione hotel


def consuntivo_settimanale(anno: int, db: Session) -> dict:
    """{(struttura, week_start): incasso lordo} per le settimane che iniziano nell'anno."""
    righe = (
        db.query(CorrispettiviManuale.struttura_code, CorrispettiviManuale.data_giorno,
                 func.sum(CorrispettiviManuale.arrangiamenti_lordo))
        .filter(CorrispettiviManuale.is_test.is_(False),
                CorrispettiviManuale.struttura_code.in_(RISTORANTI),
                CorrispettiviManuale.data_giorno >= date(anno, 1, 1),
                CorrispettiviManuale.data_giorno <= date(anno, 12, 31) + timedelta(days=6))
        .group_by(CorrispettiviManuale.struttura_code, CorrispettiviManuale.data_giorno)
        .all()
    )
    risultato: dict = {}
    for struttura, giorno, importo in righe:
        ws = settimana_di(giorno)
        if ws.year == anno:
            risultato[(struttura, ws)] = risultato.get((struttura, ws), 0.0) + float(importo or 0)
    return risultato


def _settimane(anno: int, db: Session, presenti: set) -> list:
    """Settimane dalla prima apertura all'ultima chiusura degli hotel + quelle con dati."""
    aperture = (
        db.query(func.min(HotelSeason.open_date), func.max(HotelSeason.close_date))
        .filter(HotelSeason.season_year == anno)
        .first()
    )
    settimane = set(presenti)
    if aperture and aperture[0]:
        ws = settimana_di(aperture[0])
        while ws <= aperture[1]:
            settimane.add(ws)
            ws += timedelta(days=7)
    return sorted(settimane)


def _totali_vuoti() -> dict:
    return {'budget': 0.0, 'consuntivo': 0.0, 'proiezione': 0.0,
            'budget_confrontabile': 0.0, 'scostamento': 0.0, 'ha_confronto': False,
            'settimane_totali': 0, 'settimane_chiuse': 0}


def _accumula(t: dict, c: dict) -> None:
    t['budget'] += c['budget'] or 0
    t['consuntivo'] += c['consuntivo'] or 0
    t['proiezione'] += c['proiezione'] or 0
    if c['scostamento'] is not None:
        t['budget_confrontabile'] += c['budget']
        t['scostamento'] += c['scostamento']
        t['ha_confronto'] = True
    if c['budget'] is not None or c['consuntivo'] is not None:
        t['settimane_totali'] += 1
        if c['fonte'] == 'consuntivo':
            t['settimane_chiuse'] += 1


def _trend(proiezione: float, budget: float) -> Optional[str]:
    if not budget:
        return None
    scarto = (proiezione - budget) / budget
    if scarto > SOGLIA_TREND:
        return 'sopra_budget'
    return 'sotto_budget' if scarto < -SOGLIA_TREND else 'in_linea'


def _fonte(stato: str, consuntivo: Optional[float]) -> str:
    """Da dove viene il valore di proiezione della settimana."""
    if stato == 'chiusa' and consuntivo is not None:
        return 'consuntivo'
    return 'in_corso' if stato == 'in_corso' else 'budget'


def _chiudi_totali(t: dict) -> dict:
    confronto = t['ha_confronto']
    return {
        'trend': _trend(t['proiezione'], t['budget']),
        'settimane_totali': t['settimane_totali'],
        'settimane_chiuse': t['settimane_chiuse'],
        'budget': round(t['budget'], 2),
        'consuntivo': round(t['consuntivo'], 2),
        'proiezione': round(t['proiezione'], 2),
        'budget_confrontabile': round(t['budget_confrontabile'], 2),
        'scostamento': round(t['scostamento'], 2) if confronto else None,
        'scostamento_pct': (t['scostamento'] / t['budget_confrontabile']
                            if confronto and t['budget_confrontabile'] else None),
    }


def riepilogo(anno: int, version: str, db: Session, oggi: Optional[date] = None) -> dict:
    """Settimane, mesi contabili e totali per ristorante e complessivi."""
    oggi = oggi or date.today()
    budget = {
        (r.struttura_code, r.week_start): r
        for r in db.query(BudgetRistorante).filter(BudgetRistorante.season_year == anno,
                                                   BudgetRistorante.version == version)
    }
    consuntivo = consuntivo_settimanale(anno, db)
    settimane = _settimane(anno, db, {k[1] for k in budget} | {k[1] for k in consuntivo})

    chiavi = list(RISTORANTI) + ['totale']
    totali = {k: _totali_vuoti() for k in chiavi}
    mesi: dict = {}
    righe = []
    for ws in settimane:
        we = ws + timedelta(days=6)
        mese, anno_contabile = calcola_mese_contabile(ws, we)
        stato = 'chiusa' if we < oggi else ('in_corso' if ws <= oggi else 'futura')
        riga = {'week_start': ws.isoformat(), 'week_end': we.isoformat(), 'mese': mese,
                'anno_contabile': anno_contabile, 'stato': stato}
        mese_tot = mesi.setdefault((anno_contabile, mese), {k: _totali_vuoti() for k in chiavi})
        for codice in RISTORANTI:
            b = budget.get((codice, ws))
            bud = float(b.importo) if b else None
            con = consuntivo.get((codice, ws))
            cella = {
                'budget': bud,
                'note': b.note if b else None,
                'consuntivo': round(con, 2) if con is not None else None,
                'scostamento': round(con - bud, 2) if stato == 'chiusa' and bud is not None and con is not None else None,
                'proiezione': round(con, 2) if con is not None and (stato == 'chiusa' or bud is None) else bud,
                'fonte': _fonte(stato, con),
            }
            riga[codice] = cella
            for t in (totali[codice], totali['totale'], mese_tot[codice], mese_tot['totale']):
                _accumula(t, cella)
        righe.append(riga)

    return {
        'season_year': anno,
        'version': version,
        'ristoranti': [{'code': c, 'nome': n} for c, n in RISTORANTI.items()],
        'settimane': righe,
        'mesi': [{'mese': m, 'anno': a, **{k: _chiudi_totali(v) for k, v in t.items()}}
                 for (a, m), t in sorted(mesi.items())],
        'totali': {k: _chiudi_totali(v) for k, v in totali.items()},
    }


def riepilogo_gruppo(anno: int, version: str, db: Session) -> list:
    """Righe per la scheda Gruppo: solo i ristoranti con budget o consuntivo nell'anno."""
    totali = riepilogo(anno, version, db)['totali']
    return [{'struttura_code': c, 'nome': n, **totali[c]} for c, n in RISTORANTI.items()
            if totali[c]['budget'] or totali[c]['consuntivo']]
