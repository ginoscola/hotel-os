"""Schemi Pydantic per validazione e serializzazione dei dati revenue e stagioni."""

from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Hotel
# ---------------------------------------------------------------------------

class HotelBase(BaseModel):
    code: str
    name: str
    default_rooms: int


class HotelRead(HotelBase):
    id: int
    rt_ip: Optional[str] = None
    stagione_corrente: Optional["HotelSeasonRead"] = None

    model_config = {"from_attributes": True}


class HotelCreate(BaseModel):
    """Schema per la creazione di un nuovo hotel."""
    code: str
    name: str
    default_rooms: int


class HotelUpdate(BaseModel):
    """Schema per l'aggiornamento parziale di un hotel."""
    name: Optional[str] = None
    default_rooms: Optional[int] = None


# ---------------------------------------------------------------------------
# Stagione
# ---------------------------------------------------------------------------

class HotelSeasonBase(BaseModel):
    season_year: int
    open_date: date
    close_date: date
    total_rooms: int
    notes: Optional[str] = None

    @field_validator("close_date")
    @classmethod
    def close_dopo_open(cls, close: date, info) -> date:
        open_d = info.data.get("open_date")
        if open_d and close <= open_d:
            raise ValueError("close_date deve essere successiva a open_date")
        return close

    @field_validator("total_rooms")
    @classmethod
    def camere_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("total_rooms deve essere maggiore di zero")
        return v


class HotelSeasonCreate(HotelSeasonBase):
    pass


class HotelSeasonRead(HotelSeasonBase):
    id: int
    hotel_id: int

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Revenue giornaliero
# ---------------------------------------------------------------------------

class RigaGiornaliera(BaseModel):
    hotel_code: str
    data: date
    rooms_sold: int
    rooms_available: int
    pax: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float


class KPIGiornalieri(BaseModel):
    hotel_code: str
    data: date
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
    inc_fnb: Optional[float]
    inc_rooms: Optional[float]
    inc_extra: Optional[float]


# ---------------------------------------------------------------------------
# Report importazione
# ---------------------------------------------------------------------------

class AnomaliaImport(BaseModel):
    """Anomalia rilevata durante l'importazione di una singola riga."""
    tipo: str        # es. 'revenue_rooms_negativo', 'camere_senza_ricavi'
    data: date
    descrizione: str


class KPIPeriodo(BaseModel):
    """KPI calcolati dai totali aggregati del periodo importato (non medie semplici)."""
    rooms_sold: int
    rooms_available: int
    occupancy: Optional[float]
    adr: Optional[float]
    revpar: Optional[float]
    trevpar: Optional[float]
    rmc: Optional[float]
    inc_rooms: Optional[float]
    inc_fnb: Optional[float]
    inc_extra: Optional[float]
    fnb_per_camera: Optional[float]
    extra_per_camera: Optional[float]


class RisultatoUpload(BaseModel):
    hotel_code: str
    # Contatori righe
    righe_lette: int           # totale righe dati nel file (senza intestazione)
    righe_importate: int       # righe effettivamente salvate nel DB (= inserite + aggiornate)
    righe_inserite: int        # nuovi record
    righe_aggiornate: int      # record già esistenti aggiornati
    righe_scartate: int        # SDLY / LY / formato non valido
    righe_fuori_stagione: int  # data valida ma fuori dal periodo di apertura
    # Periodo
    periodo_da: Optional[date]
    periodo_a: Optional[date]
    # Data snapshot estratta dal nome file
    snapshot_date: Optional[date] = None
    # KPI aggregati del periodo
    kpi_periodo: Optional[KPIPeriodo]
    # Anomalie e avvisi
    anomalie: List[AnomaliaImport]
    warnings: List[str]        # date fuori stagione scartate con motivo
    messaggio: str


class ImportSessionRead(BaseModel):
    """Schema di lettura per una sessione di import registrata nel DB."""
    id: int
    hotel_code: str
    snapshot_date: date
    file1_nome: Optional[str]
    file2_nome: Optional[str]
    righe_lette: int
    righe_inserite: int
    righe_aggiornate: int
    righe_scartate: int
    anomalie: Optional[list]
    stato: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RisultatoBulk(BaseModel):
    """Esito dell'importazione di una singola coppia di file nel bulk import."""
    hotel_code: str
    snapshot_date: date
    file1_nome: str
    file2_nome: str
    stato: str                          # "importato", "saltato", "errore"
    motivo: Optional[str] = None
    righe_inserite: int = 0
    righe_aggiornate: int = 0
    righe_scartate: int = 0
    anomalie: List[AnomaliaImport] = []


class BulkImportResponse(BaseModel):
    """Risposta aggregata del bulk import."""
    cartella: str
    file_trovati: int
    coppie_trovate: int
    coppie_importate: int
    coppie_saltate: int
    coppie_errore: int
    risultati: List[RisultatoBulk]
