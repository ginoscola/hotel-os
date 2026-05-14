"""
Aggregazione settimanale dei dati giornalieri degli hotel.

Settimana commerciale: sabato → venerdì (settimana_di restituisce il sabato di inizio).
I KPI vengono calcolati sempre sui TOTALI settimanali, mai come media dei KPI giornalieri.

Gestione stagioni: se l'hotel apre o chiude a metà settimana, la settimana "parziale"
viene inclusa con i giorni effettivamente presenti (giorni < 7). Le settimane parziali
sono identificate dal campo `settimana_completa = False`.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from typing import Dict, List, Optional

from app.services.file_parser import RigaRevenue
from app.services.kpi_calculator import KPICalcolati, calcola_kpi


@lru_cache(maxsize=1)
def _leggi_week_start() -> int:
    """Legge week_start_weekday da app_config; fallback a 5 (sabato).

    Il risultato è cached in-process per tutta la durata del processo.
    Resettabile con _reset_week_start_cache() (usato nei test).
    """
    try:
        from app.database import SessionLocal
        from app.models.revenue import AppConfig
        db = SessionLocal()
        try:
            row = db.query(AppConfig).filter(AppConfig.key == 'week_start_weekday').first()
            if row is not None:
                return int(row.value)
        finally:
            db.close()
    except Exception:
        pass
    return 5


def _reset_week_start_cache() -> None:
    """Resetta la cache del week_start_weekday (usato nei test)."""
    _leggi_week_start.cache_clear()


def settimana_di(data: date) -> date:
    """
    Restituisce il giorno di inizio settimana commerciale per 'data'.

    Il giorno di inizio è letto da app_config (chiave 'week_start_weekday');
    default sabato (weekday=5) se la chiave non esiste.
    weekday(): Lun=0, Mar=1, Mer=2, Gio=3, Ven=4, Sab=5, Dom=6
    """
    ws = _leggi_week_start()
    return data - timedelta(days=(data.weekday() - ws) % 7)


@dataclass
class AggregatoSettimanale:
    """Totali e KPI per una settimana commerciale di un singolo hotel."""

    hotel_code: str
    week_start: date          # sabato di apertura settimana
    week_end: date            # venerdì di chiusura settimana (week_start + 6 giorni)
    giorni: int               # giorni effettivi con dati (≤ 7; < 7 per settimane di apertura/chiusura)
    settimana_completa: bool  # True solo se giorni == 7
    rooms_sold: int
    rooms_available: int
    pax: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float
    kpi: KPICalcolati


def aggrega_settimane(righe: List[RigaRevenue]) -> List[AggregatoSettimanale]:
    """
    Raggruppa i dati giornalieri in settimane commerciali (sabato→venerdì).

    I KPI sono calcolati sui totali settimanali (non come media dei KPI giornalieri).
    Restituisce le settimane ordinate cronologicamente.
    """
    if not righe:
        return []

    hotel_code = righe[0].hotel_code

    # Raggruppa per sabato d'inizio settimana
    per_settimana: Dict[date, List[RigaRevenue]] = defaultdict(list)
    for riga in righe:
        per_settimana[settimana_di(riga.data)].append(riga)

    risultati: List[AggregatoSettimanale] = []
    for ws in sorted(per_settimana):
        giorni_settimana = per_settimana[ws]
        n_giorni = len(giorni_settimana)

        # Somma i totali — MAI usare medie semplici
        tot_rooms_sold = sum(r.rooms_sold for r in giorni_settimana)
        tot_rooms_available = sum(r.rooms_available for r in giorni_settimana)
        tot_pax = sum(r.pax for r in giorni_settimana)
        tot_rev_rooms = sum(r.revenue_rooms for r in giorni_settimana)
        tot_rev_fnb = sum(r.revenue_fnb for r in giorni_settimana)
        tot_rev_extra = sum(r.revenue_extra for r in giorni_settimana)
        tot_rev_total = sum(r.revenue_total for r in giorni_settimana)

        risultati.append(
            AggregatoSettimanale(
                hotel_code=hotel_code,
                week_start=ws,
                week_end=ws + timedelta(days=6),
                giorni=n_giorni,
                settimana_completa=(n_giorni == 7),
                rooms_sold=tot_rooms_sold,
                rooms_available=tot_rooms_available,
                pax=tot_pax,
                revenue_rooms=round(tot_rev_rooms, 4),
                revenue_fnb=round(tot_rev_fnb, 4),
                revenue_extra=round(tot_rev_extra, 4),
                revenue_total=round(tot_rev_total, 4),
                kpi=calcola_kpi(
                    tot_rooms_sold,
                    tot_rooms_available,
                    tot_rev_rooms,
                    tot_rev_fnb,
                    tot_rev_extra,
                    tot_rev_total,
                ),
            )
        )

    return risultati
