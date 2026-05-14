"""Modelli SQLAlchemy per hotel, stagioni, dati di revenue giornalieri e sessioni di import."""

from sqlalchemy import Boolean, Column, Integer, String, Float, Date, ForeignKey, UniqueConstraint, Text, JSON, DateTime, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


# ---------------------------------------------------------------------------
# Architettura modulare
# ---------------------------------------------------------------------------

class Module(Base):
    """Modulo applicativo (Revenue, Budget, USALI, ecc.)."""

    __tablename__ = "modules"

    id = Column(Integer, primary_key=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(50), nullable=True)
    route = Column(String(100), nullable=True)
    ordine = Column(Integer, nullable=False, default=0)
    attivo = Column(Boolean, nullable=False, default=True)
    colore = Column(String(20), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    permissions = relationship("ModulePermission", back_populates="module", cascade="all, delete-orphan")
    source_connections = relationship("DataConnection", foreign_keys="DataConnection.source_module", back_populates="source")
    target_connections = relationship("DataConnection", foreign_keys="DataConnection.target_module", back_populates="target")


class ModulePermission(Base):
    """Permessi per ruolo su ciascun modulo."""

    __tablename__ = "module_permissions"

    id = Column(Integer, primary_key=True)
    module_code = Column(String(50), ForeignKey("modules.code", ondelete="CASCADE"), nullable=False)
    ruolo = Column(String(20), nullable=False)
    puo_vedere = Column(Boolean, nullable=False, default=True)
    puo_modificare = Column(Boolean, nullable=False, default=False)
    puo_importare = Column(Boolean, nullable=False, default=False)

    module = relationship("Module", back_populates="permissions")

    __table_args__ = (
        UniqueConstraint("module_code", "ruolo", name="uq_module_ruolo"),
    )


class DataConnection(Base):
    """Mappa delle interconnessioni dati tra moduli (metadati per futura implementazione)."""

    __tablename__ = "data_connections"

    id = Column(Integer, primary_key=True)
    source_module = Column(String(50), ForeignKey("modules.code", ondelete="CASCADE"), nullable=False)
    target_module = Column(String(50), ForeignKey("modules.code", ondelete="CASCADE"), nullable=False)
    description = Column(Text, nullable=True)
    attivo = Column(Boolean, nullable=False, default=True)

    source = relationship("Module", foreign_keys=[source_module], back_populates="source_connections")
    target = relationship("Module", foreign_keys=[target_module], back_populates="target_connections")


# ---------------------------------------------------------------------------
# Configurazione applicazione
# ---------------------------------------------------------------------------

class AppConfig(Base):
    """Parametri di configurazione modificabili senza deploy."""

    __tablename__ = "app_config"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class User(Base):
    """Utenti dell'applicazione con ruolo e stato di accesso."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    ruolo = Column(String(20), nullable=False, default='viewer', server_default='viewer')
    attivo = Column(Boolean, nullable=False, default=True, server_default='true')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Hotel e stagioni
# ---------------------------------------------------------------------------

class Hotel(Base):
    """Anagrafica hotel del gruppo."""

    __tablename__ = "hotels"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False, index=True)  # es. CLB, DPH, INT
    name = Column(String(100), nullable=False)
    default_rooms = Column(Integer, nullable=False)  # capacità standard (può variare per stagione)

    stagioni = relationship("HotelSeason", back_populates="hotel", cascade="all, delete-orphan")


class HotelSeason(Base):
    """Stagione operativa annuale di un hotel (apertura, chiusura, camere disponibili)."""

    __tablename__ = "hotel_seasons"

    id = Column(Integer, primary_key=True, index=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id"), nullable=False, index=True)
    season_year = Column(Integer, nullable=False)
    open_date = Column(Date, nullable=False)
    close_date = Column(Date, nullable=False)
    # Numero camere per questa stagione (può differire da default_rooms per ristrutturazioni ecc.)
    total_rooms = Column(Integer, nullable=False)
    notes = Column(Text, nullable=True)

    hotel = relationship("Hotel", back_populates="stagioni")

    __table_args__ = (
        UniqueConstraint("hotel_id", "season_year", name="uq_hotel_stagione_anno"),
    )


# ---------------------------------------------------------------------------
# Dati revenue giornalieri
# ---------------------------------------------------------------------------

class DailyRevenue(Base):
    """Ricavi giornalieri per singolo hotel."""

    __tablename__ = "daily_revenue"

    id = Column(Integer, primary_key=True, index=True)
    hotel_code = Column(String(20), nullable=False, index=True)  # es. CLB, DPH, INT
    data = Column(Date, nullable=False, index=True)

    # Disponibilità camere (CV = capacità, CP = vendute)
    rooms_sold = Column(Integer, nullable=False, default=0)
    rooms_available = Column(Integer, nullable=False, default=0)
    pax = Column(Integer, nullable=False, default=0)

    # Ricavi calcolati dalla coppia di file
    revenue_rooms = Column(Float, nullable=False, default=0.0)  # RICAVI TRAT file2
    revenue_fnb = Column(Float, nullable=False, default=0.0)    # file1 - file2, mai negativo
    revenue_extra = Column(Float, nullable=False, default=0.0)  # EXTRA TRATT
    revenue_total = Column(Float, nullable=False, default=0.0)  # rooms + fnb + extra

    nome_file = Column(String(255), nullable=True)
    # Data di snapshot del forecast (estratta dal nome file: YYYYMMDD_...)
    snapshot_date = Column(Date, nullable=True)
    # True se importato come dato di test (cancellabile dall'area admin)
    is_test = Column(Boolean, nullable=False, default=False, server_default="false")
    # FK verso hotels (nullable per compatibilità con righe precedenti alla migrazione)
    hotel_id = Column(Integer, ForeignKey("hotels.id"), nullable=True, index=True)

    __table_args__ = (
        UniqueConstraint("hotel_code", "data", "snapshot_date", name="uq_hotel_data_snapshot"),
    )


# ---------------------------------------------------------------------------
# Sessioni di import
# ---------------------------------------------------------------------------

class ImportSession(Base):
    """Registro delle sessioni di importazione file per hotel e data snapshot."""

    __tablename__ = "imports"

    id = Column(Integer, primary_key=True)
    hotel_code = Column(String(20), nullable=False)
    # Data del forecast (estratta dal prefisso YYYYMMDD_ del nome file)
    snapshot_date = Column(Date, nullable=False)
    file1_nome = Column(String(255), nullable=True)
    file2_nome = Column(String(255), nullable=True)
    righe_lette = Column(Integer, default=0)
    righe_inserite = Column(Integer, default=0)
    righe_aggiornate = Column(Integer, default=0)
    righe_scartate = Column(Integer, default=0)
    # Lista di anomalie serializzata come JSON
    anomalie = Column(JSON, nullable=True)
    # success / warning / error
    stato = Column(String(20), default="success")
    created_at = Column(DateTime, server_default=func.now())
    # True se importato come dato di test (cancellabile dall'area admin)
    is_test = Column(Boolean, nullable=False, default=False, server_default="false")

    __table_args__ = (
        UniqueConstraint("hotel_code", "snapshot_date", name="uq_import_hotel_snapshot"),
    )


# ---------------------------------------------------------------------------
# Budget settimanale
# ---------------------------------------------------------------------------

class BudgetEntry(Base):
    """Budget settimanale per hotel, anno e versione."""

    __tablename__ = "budget_entries"

    id = Column(Integer, primary_key=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id"), nullable=True, index=True)
    season_year = Column(Integer, nullable=False)
    week_start = Column(Date, nullable=False)
    version = Column(String(20), nullable=False, default='v1', server_default='v1')
    rooms_sold_budget = Column(Integer, nullable=True)
    revenue_rooms_budget = Column(Numeric(12, 2), nullable=True)
    revenue_fnb_budget = Column(Numeric(12, 2), nullable=True)
    revenue_extra_budget = Column(Numeric(12, 2), nullable=True)
    revenue_total_budget = Column(Numeric(12, 2), nullable=True)
    notes = Column(Text, nullable=True)

    hotel = relationship("Hotel")

    __table_args__ = (
        UniqueConstraint("hotel_id", "season_year", "week_start", "version",
                         name="uq_budget_hotel_settimana"),
    )
