"""
Calcolo KPI alberghieri da totali aggregati.

Tutte le funzioni accettano totali (non medie) e restituiscono None in caso di
divisione per zero, mai un'eccezione. Le incidenze sono espresse in percentuale (0-100).

Uso tipico:
    kpi = calcola_kpi(rooms_sold=120, rooms_available=315, ...)
    kpi = kpi_da_riga(riga_revenue)   # scorciatoia per singola RigaRevenue
"""

from dataclasses import dataclass
from typing import List, Optional

# Importazione circolare evitata: RigaRevenue viene importata solo nel type hint
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.services.file_parser import RigaRevenue


@dataclass
class TotaliRighe:
    """Somme aggregate di una lista di RigaRevenue — input per calcola_kpi."""
    rooms_sold: int
    rooms_available: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float


def aggrega_totali_righe(righe: "List[RigaRevenue]") -> TotaliRighe:
    """
    Somma i valori di una lista di RigaRevenue.
    Unica sorgente di verità per l'aggregazione: usata da dashboard e upload.
    """
    return TotaliRighe(
        rooms_sold=sum(r.rooms_sold for r in righe),
        rooms_available=sum(r.rooms_available for r in righe),
        revenue_rooms=sum(r.revenue_rooms for r in righe),
        revenue_fnb=sum(r.revenue_fnb for r in righe),
        revenue_extra=sum(r.revenue_extra for r in righe),
        revenue_total=sum(r.revenue_total for r in righe),
    )


@dataclass
class KPICalcolati:
    """
    Tutti i KPI calcolati per un periodo (giorno, settimana o stagione).
    Valori in euro o percentuale come indicato; None se il denominatore è zero.
    """
    occupancy: Optional[float]        # % (0-100)  = rooms_sold / rooms_available
    adr: Optional[float]              # €           = revenue_rooms / rooms_sold
    revpar: Optional[float]           # €           = revenue_rooms / rooms_available
    trevpar: Optional[float]          # €           = revenue_total / rooms_available
    rmc: Optional[float]              # €           = revenue_total / rooms_sold
    inc_fnb: Optional[float]          # % (0-100)  = revenue_fnb / revenue_total
    inc_rooms: Optional[float]        # % (0-100)  = revenue_rooms / revenue_total
    inc_extra: Optional[float]        # % (0-100)  = revenue_extra / revenue_total
    fnb_per_camera: Optional[float]   # €           = revenue_fnb / rooms_sold
    extra_per_camera: Optional[float] # €           = revenue_extra / rooms_sold


def _safe_div(numeratore: float, denominatore: float) -> Optional[float]:
    """Divisione sicura: restituisce None se il denominatore è zero o negativo."""
    if denominatore <= 0:
        return None
    return numeratore / denominatore


def calcola_kpi(
    rooms_sold: int,
    rooms_available: int,
    revenue_rooms: float,
    revenue_fnb: float,
    revenue_extra: float,
    revenue_total: float,
) -> KPICalcolati:
    """
    Calcola tutti i KPI dai totali del periodo.
    Parametri attesi come somme, non medie: usare i totali di giorno/settimana/stagione.
    """
    return KPICalcolati(
        occupancy=_safe_div(rooms_sold * 100.0, rooms_available),
        adr=_safe_div(revenue_rooms, rooms_sold),
        revpar=_safe_div(revenue_rooms, rooms_available),
        trevpar=_safe_div(revenue_total, rooms_available),
        rmc=_safe_div(revenue_total, rooms_sold),
        inc_fnb=_safe_div(revenue_fnb * 100.0, revenue_total),
        inc_rooms=_safe_div(revenue_rooms * 100.0, revenue_total),
        inc_extra=_safe_div(revenue_extra * 100.0, revenue_total),
        fnb_per_camera=_safe_div(revenue_fnb, rooms_sold),
        extra_per_camera=_safe_div(revenue_extra, rooms_sold),
    )


def kpi_da_riga(riga: "RigaRevenue") -> KPICalcolati:
    """Scorciatoia: calcola i KPI direttamente da una RigaRevenue."""
    return calcola_kpi(
        rooms_sold=riga.rooms_sold,
        rooms_available=riga.rooms_available,
        revenue_rooms=riga.revenue_rooms,
        revenue_fnb=riga.revenue_fnb,
        revenue_extra=riga.revenue_extra,
        revenue_total=riga.revenue_total,
    )
