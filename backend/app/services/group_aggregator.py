"""
Aggregazione di gruppo: somma dei dati di tutti gli hotel attivi per periodo o settimana.

Regola fondamentale: ADR, occupancy e RevPAR di gruppo si calcolano dai TOTALI aggregati,
MAI come media semplice dei KPI dei singoli hotel.

Gestione date di apertura eterogenee:
  - Ogni hotel contribuisce solo nei giorni in cui ha dati
  - La somma di rooms_available riflette automaticamente i giorni di apertura effettivi
  - Settimane con un solo hotel aperto risultano con rooms_available proporzionalmente inferiori

Uso tipico:
    hotel_dati = {'CLB': righe_clb, 'DPH': righe_dph, 'INT': righe_int}
    totale = aggrega_gruppo_periodo(hotel_dati)
    per_settimana = aggrega_gruppo_settimanale(hotel_dati)
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Optional

from app.services.file_parser import RigaRevenue
from app.services.kpi_calculator import KPICalcolati, calcola_kpi
from app.services.weekly_aggregator import AggregatoSettimanale, aggrega_settimane


@dataclass
class AggregatoGruppo:
    """Totali e KPI aggregati per tutti gli hotel del gruppo in un periodo."""

    period_start: date
    period_end: date
    hotel_codes: List[str]       # hotel inclusi nell'aggregazione
    giorni_hotel: int            # somma dei giorni-hotel (es. 3 hotel × 30 giorni = 90)
    rooms_sold: int
    rooms_available: int
    pax: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float
    kpi: KPICalcolati


@dataclass
class AggregatoGruppoSettimanale:
    """Totali e KPI di gruppo per una settimana commerciale."""

    week_start: date
    week_end: date
    hotel_codes: List[str]       # hotel con dati in questa settimana
    giorni_hotel: int
    rooms_sold: int
    rooms_available: int
    pax: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float
    kpi: KPICalcolati
    per_hotel: Dict[str, AggregatoSettimanale]  # breakdown per singolo hotel


def aggrega_gruppo_periodo(
    hotel_righe: Dict[str, List[RigaRevenue]],
    data_da: Optional[date] = None,
    data_a: Optional[date] = None,
) -> Optional[AggregatoGruppo]:
    """
    Aggrega tutti gli hotel per un periodo.

    Se data_da/data_a non sono fornite, usa il range completo dei dati disponibili.
    Restituisce None se non ci sono dati.
    """
    tutte: List[RigaRevenue] = []
    for righe in hotel_righe.values():
        for r in righe:
            if data_da and r.data < data_da:
                continue
            if data_a and r.data > data_a:
                continue
            tutte.append(r)

    if not tutte:
        return None

    hotel_codes = sorted({r.hotel_code for r in tutte})
    date_nel_periodo = [r.data for r in tutte]

    return AggregatoGruppo(
        period_start=min(date_nel_periodo),
        period_end=max(date_nel_periodo),
        hotel_codes=hotel_codes,
        giorni_hotel=len(tutte),
        rooms_sold=sum(r.rooms_sold for r in tutte),
        rooms_available=sum(r.rooms_available for r in tutte),
        pax=sum(r.pax for r in tutte),
        revenue_rooms=round(sum(r.revenue_rooms for r in tutte), 4),
        revenue_fnb=round(sum(r.revenue_fnb for r in tutte), 4),
        revenue_extra=round(sum(r.revenue_extra for r in tutte), 4),
        revenue_total=round(sum(r.revenue_total for r in tutte), 4),
        kpi=calcola_kpi(
            rooms_sold=sum(r.rooms_sold for r in tutte),
            rooms_available=sum(r.rooms_available for r in tutte),
            revenue_rooms=sum(r.revenue_rooms for r in tutte),
            revenue_fnb=sum(r.revenue_fnb for r in tutte),
            revenue_extra=sum(r.revenue_extra for r in tutte),
            revenue_total=sum(r.revenue_total for r in tutte),
        ),
    )


def aggrega_gruppo_settimanale(
    hotel_righe: Dict[str, List[RigaRevenue]],
) -> List[AggregatoGruppoSettimanale]:
    """
    Aggrega tutti gli hotel settimana per settimana (sabato→venerdì).

    Per ogni settimana in cui almeno un hotel ha dati:
    - somma rooms_sold, rooms_available, revenue_* di tutti gli hotel presenti
    - calcola i KPI dai totali aggregati (non dalla media dei KPI per hotel)
    - include il breakdown per_hotel con l'AggregatoSettimanale di ciascuno

    Hotel con date di apertura diverse contribuiscono solo nelle settimane in cui
    hanno dati: rooms_available è automaticamente corretto.
    """
    # Calcola le settimane per ogni hotel
    settimane_per_hotel: Dict[str, Dict[date, AggregatoSettimanale]] = {}
    for codice, righe in hotel_righe.items():
        settimanali = aggrega_settimane(righe)
        settimane_per_hotel[codice] = {s.week_start: s for s in settimanali}

    # Raccoglie tutti i week_start tra gli hotel
    tutti_week_start: set[date] = set()
    for d in settimane_per_hotel.values():
        tutti_week_start.update(d.keys())

    risultati: List[AggregatoGruppoSettimanale] = []

    for ws in sorted(tutti_week_start):
        hotel_in_settimana: Dict[str, AggregatoSettimanale] = {}
        for codice, per_ws in settimane_per_hotel.items():
            if ws in per_ws:
                hotel_in_settimana[codice] = per_ws[ws]

        if not hotel_in_settimana:
            continue

        # week_end è sempre sabato + 6 giorni (venerdì)
        first = next(iter(hotel_in_settimana.values()))
        we = first.week_end

        tot_rooms_sold = sum(s.rooms_sold for s in hotel_in_settimana.values())
        tot_rooms_available = sum(s.rooms_available for s in hotel_in_settimana.values())
        tot_pax = sum(s.pax for s in hotel_in_settimana.values())
        tot_rev_rooms = sum(s.revenue_rooms for s in hotel_in_settimana.values())
        tot_rev_fnb = sum(s.revenue_fnb for s in hotel_in_settimana.values())
        tot_rev_extra = sum(s.revenue_extra for s in hotel_in_settimana.values())
        tot_rev_total = sum(s.revenue_total for s in hotel_in_settimana.values())
        giorni_hotel = sum(s.giorni for s in hotel_in_settimana.values())

        risultati.append(
            AggregatoGruppoSettimanale(
                week_start=ws,
                week_end=we,
                hotel_codes=sorted(hotel_in_settimana.keys()),
                giorni_hotel=giorni_hotel,
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
                per_hotel=hotel_in_settimana,
            )
        )

    return risultati
