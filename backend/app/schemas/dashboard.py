"""Schemi Pydantic per le risposte dei dashboard hotel e gruppo."""

from datetime import date
from typing import List, Optional
from pydantic import BaseModel


class KPISchema(BaseModel):
    rooms_sold: int
    rooms_available: int
    occupancy: Optional[float]      # % 0-100
    adr: Optional[float]            # €
    revpar: Optional[float]         # €
    trevpar: Optional[float]        # €
    rmc: Optional[float]            # €
    inc_rooms: Optional[float]      # % 0-100
    inc_fnb: Optional[float]        # % 0-100
    inc_extra: Optional[float]      # % 0-100
    revenue_total: Optional[float]  # €


class GiornoSchema(BaseModel):
    data: date
    label: str               # "30/05 sab"
    rooms_sold: int
    rooms_available: int
    pax: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float
    occupancy: Optional[float]
    adr: Optional[float]
    revpar: Optional[float]
    trevpar: Optional[float]
    rmc: Optional[float]


class SettimanaDashboard(BaseModel):
    week_start: date
    week_end: date
    label: str               # "30/05–05/06"
    giorni: int
    settimana_completa: bool
    rooms_sold: int
    rooms_available: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float
    occupancy: Optional[float]
    adr: Optional[float]
    revpar: Optional[float]
    trevpar: Optional[float]
    rmc: Optional[float]
    inc_rooms: Optional[float]
    inc_fnb: Optional[float]
    inc_extra: Optional[float]


class DashboardHotelResponse(BaseModel):
    hotel_code: str
    hotel_name: str
    periodo_da: date
    periodo_a: date
    snapshot_date: Optional[date] = None
    settimana_ref_start: Optional[date] = None  # inizio settimana commerciale dello snapshot
    settimana_ref_end: Optional[date] = None    # fine settimana commerciale dello snapshot
    kpi_stagione: KPISchema                     # KPI aggregati su tutta la stagione
    settimane: List[SettimanaDashboard]
    giorni: List[GiornoSchema]


class ContributoHotel(BaseModel):
    hotel_code: str
    hotel_name: str
    rooms_sold: int
    rooms_available: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float
    perc_revenue: Optional[float]  # % sul totale gruppo
    occupancy: Optional[float]
    adr: Optional[float]
    revpar: Optional[float]


class SettimanGruppo(BaseModel):
    week_start: date
    week_end: date
    label: str
    hotel_attivi: List[str]
    rooms_sold: int
    rooms_available: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float
    occupancy: Optional[float]
    adr: Optional[float]
    revpar: Optional[float]
    trevpar: Optional[float]


class DashboardGruppoResponse(BaseModel):
    periodo_da: date
    periodo_a: date
    snapshot_date: Optional[date] = None
    hotel_attivi: List[str]
    kpi_gruppo: KPISchema
    contributi: List[ContributoHotel]
    settimane: List[SettimanGruppo]
    modalita: str = 'settimana'                 # 'settimana' | 'stagione'
    settimana_ref_start: Optional[date] = None  # solo modalita=settimana
    settimana_ref_end: Optional[date] = None    # solo modalita=settimana


class SnapshotGruppoItem(BaseModel):
    snapshot_date: date
    label: str          # data formattata in italiano, es. "4 mag 2026"


class ListaSnapshotGruppo(BaseModel):
    snapshots: List[SnapshotGruppoItem]  # ordinate dalla più recente


# ---------------------------------------------------------------------------
# Navigazione settimanale
# ---------------------------------------------------------------------------

class SettimanNavigazione(BaseModel):
    """Una settimana disponibile nel DB per la navigazione (prev/next)."""
    week_start: date
    week_end: date
    label: str                    # es. "10–16 mag 2026"
    snapshot_date: Optional[date]
    snapshot_label: Optional[str] # es. "5 mag 2026"
    giorni: int


class ListaSettimane(BaseModel):
    settimane: List[SettimanNavigazione]  # ordinate dalla più recente
