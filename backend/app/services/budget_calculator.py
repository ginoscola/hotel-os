"""
Calcolo KPI budget da 4 input manuali.

Input manuali:
    occupancy_pct  — % occupazione desiderata (0-100), da cui si ricavano le notti
    adr            — prezzo medio camera €
    adr_fnb        — F&B medio per camera venduta € (es. 45.00)
    adr_extra      — Extra medio per camera venduta € (es. 12.00)

Logica:
    camere_vendute  = round(occupancy_pct / 100 * rooms_available)
    revenue_rooms   = camere_vendute * adr
    revenue_fnb     = camere_vendute * adr_fnb
    revenue_extra   = camere_vendute * adr_extra
    revenue_total   = revenue_rooms + revenue_fnb + revenue_extra

Le incidenze (inc_rooms, inc_fnb, inc_extra) sono KPI derivati, non input.
Divisioni per zero → None (usa _safe_div, mai eccezione).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional


def _safe_div(num, den) -> Optional[float]:
    """Restituisce num/den oppure None se num o den è None o den è zero."""
    if num is None or den is None or den == 0:
        return None
    return num / den


@dataclass
class KPIBudget:
    """Tutti i valori budget calcolati dai 4 input manuali."""
    rooms_sold: Optional[int]         # derivato da occupancy × rooms_available
    revenue_rooms: Optional[float]
    revenue_fnb: Optional[float]
    revenue_extra: Optional[float]
    revenue_total: Optional[float]
    occupancy: Optional[float]        # 0-100 (input, restituito invariato)
    adr: Optional[float]
    adr_fnb: Optional[float]          # input (€ per camera venduta)
    adr_extra: Optional[float]        # input (€ per camera venduta)
    revpar: Optional[float]
    trevpar: Optional[float]
    rmc: Optional[float]
    inc_rooms: Optional[float]        # 0-100 (derivato)
    inc_fnb: Optional[float]          # 0-100 (derivato)
    inc_extra: Optional[float]        # 0-100 (derivato)


def calcola_kpi_budget(
    occupancy_pct: Optional[float],
    adr: Optional[float],
    adr_fnb: Optional[float],
    adr_extra: Optional[float],
    rooms_available: Optional[int],
) -> KPIBudget:
    """
    Calcola tutti i KPI budget dai 4 input.

    occupancy_pct: % occupazione (0-100) — input principale
    adr:           prezzo medio camera €
    adr_fnb:       F&B medio per camera venduta €
    adr_extra:     Extra medio per camera venduta €
    rooms_available: camere disponibili nella settimana (total_rooms × giorni)
    """
    adr_f     = float(adr)     if adr     is not None else None
    adr_fnb_f = float(adr_fnb) if adr_fnb is not None else 0.0
    adr_ext_f = float(adr_extra) if adr_extra is not None else 0.0
    ra        = int(rooms_available) if rooms_available is not None else None

    # Camere vendute derivate dall'occupazione
    if occupancy_pct is not None and ra is not None:
        rs = round(float(occupancy_pct) / 100.0 * ra)
    else:
        rs = None

    # Revenue per componente
    if rs is not None and adr_f is not None:
        rev_rooms = rs * adr_f
        rev_fnb   = rs * adr_fnb_f
        rev_extra = rs * adr_ext_f
        rev_total = rev_rooms + rev_fnb + rev_extra
    else:
        rev_rooms = None
        rev_fnb   = None
        rev_extra = None
        rev_total = None

    revpar  = _safe_div(rev_rooms, ra)
    trevpar = _safe_div(rev_total, ra)
    rmc     = _safe_div(rev_total, rs)
    inc_rooms = _safe_div((rev_rooms or 0) * 100.0, rev_total)
    inc_fnb   = _safe_div((rev_fnb   or 0) * 100.0, rev_total)
    inc_extra = _safe_div((rev_extra or 0) * 100.0, rev_total)

    return KPIBudget(
        rooms_sold=rs,
        revenue_rooms=rev_rooms,
        revenue_fnb=rev_fnb,
        revenue_extra=rev_extra,
        revenue_total=rev_total,
        occupancy=float(occupancy_pct) if occupancy_pct is not None else None,
        adr=adr_f,
        adr_fnb=adr_fnb_f if adr_fnb is not None else None,
        adr_extra=adr_ext_f if adr_extra is not None else None,
        revpar=revpar,
        trevpar=trevpar,
        rmc=rmc,
        inc_rooms=inc_rooms,
        inc_fnb=inc_fnb,
        inc_extra=inc_extra,
    )


def calcola_mese_contabile(week_start: date, week_end: date) -> tuple[int, int]:
    """
    Restituisce (mese, anno) del mese contabile della settimana.

    Regola: il mese con più giorni nella settimana.
    Con 7 giorni c'è sempre un mese con almeno 4 giorni (no parità).
    """
    conteggi: dict[tuple[int, int], int] = {}
    giorno = week_start
    while giorno <= week_end:
        chiave = (giorno.year, giorno.month)
        conteggi[chiave] = conteggi.get(chiave, 0) + 1
        giorno += timedelta(days=1)
    anno, mese = max(conteggi, key=lambda k: conteggi[k])
    return mese, anno
