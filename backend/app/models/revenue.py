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

    module_permissions = relationship("UserModulePermission", back_populates="user", cascade="all, delete-orphan")


class UserModulePermission(Base):
    """Override permessi modulo per singolo utente (sovrascrive il permesso di ruolo)."""

    __tablename__ = "user_module_permissions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    module_code = Column(String(50), ForeignKey("modules.code", ondelete="CASCADE"), nullable=False)
    puo_vedere = Column(Boolean, nullable=False, default=True)

    user = relationship("User", back_populates="module_permissions")

    __table_args__ = (
        UniqueConstraint("user_id", "module_code", name="uq_user_module"),
    )


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
    rt_printer_id = Column(Integer, ForeignKey("rt_printers.id", ondelete="SET NULL"), nullable=True)

    stagioni = relationship("HotelSeason", back_populates="hotel", cascade="all, delete-orphan")
    rooms    = relationship("Room", back_populates="hotel", cascade="all, delete-orphan")
    rt_printer = relationship("RtPrinter", back_populates="hotels")


class RtPrinter(Base):
    """Registratore telematico Epson FP-81 II condiviso da uno o più hotel."""

    __tablename__ = "rt_printers"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(100), nullable=False)
    ip = Column(String(50), unique=True, nullable=False)

    hotels = relationship("Hotel", back_populates="rt_printer")


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
    """Budget settimanale per hotel, anno e versione.

    4 input manuali → tutti i KPI calcolati automaticamente da budget_calculator.
    """

    __tablename__ = "budget_entries"

    id = Column(Integer, primary_key=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id"), nullable=True, index=True)
    season_year = Column(Integer, nullable=False)
    week_start = Column(Date, nullable=False)
    version = Column(String(20), nullable=False, default='v1', server_default='v1')

    # 4 input manuali (rooms_sold_budget = camere_vendute_budget)
    rooms_sold_budget = Column(Integer, nullable=True)
    adr_budget = Column(Numeric(10, 2), nullable=True)
    adr_fnb_budget   = Column(Numeric(10, 2), nullable=True)   # € F&B per camera venduta
    adr_extra_budget = Column(Numeric(10, 2), nullable=True)   # € Extra per camera venduta

    # Camere disponibili nella settimana (total_rooms × giorni apertura)
    rooms_available_budget = Column(Integer, nullable=True)

    # Revenue calcolata
    revenue_rooms_budget = Column(Numeric(12, 2), nullable=True)
    revenue_fnb_budget = Column(Numeric(12, 2), nullable=True)
    revenue_extra_budget = Column(Numeric(12, 2), nullable=True)
    revenue_total_budget = Column(Numeric(12, 2), nullable=True)

    # KPI calcolati
    occupancy_budget = Column(Numeric(5, 4), nullable=True)
    revpar_budget = Column(Numeric(10, 2), nullable=True)
    trevpar_budget = Column(Numeric(10, 2), nullable=True)
    rmc_budget = Column(Numeric(10, 2), nullable=True)
    inc_rooms_budget = Column(Numeric(5, 4), nullable=True)
    inc_fnb_budget = Column(Numeric(5, 4), nullable=True)
    inc_extra_budget = Column(Numeric(5, 4), nullable=True)

    # Mese contabile (mese con più giorni nella settimana commerciale)
    mese_contabile = Column(Integer, nullable=True)
    anno_contabile = Column(Integer, nullable=True)

    notes = Column(Text, nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    hotel = relationship("Hotel")

    __table_args__ = (
        UniqueConstraint("hotel_id", "season_year", "week_start", "version",
                         name="uq_budget_hotel_settimana"),
    )


class BudgetConfig(Base):
    """Parametri di configurazione del budget per hotel, anno e versione."""

    __tablename__ = "budget_config"

    id = Column(Integer, primary_key=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id"), nullable=True, index=True)
    season_year = Column(Integer, nullable=False)
    version = Column(String(20), nullable=False, default='v1', server_default='v1')
    costo_pasto = Column(Numeric(8, 2), nullable=True)
    costo_colazione = Column(Numeric(8, 2), nullable=True)
    altro_rev_presenza = Column(Numeric(8, 2), nullable=True)
    notti_medie_soggiorno = Column(Numeric(4, 2), nullable=True)
    note = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    hotel = relationship("Hotel")

    __table_args__ = (
        UniqueConstraint("hotel_id", "season_year", "version", name="uq_budget_config"),
    )


# ---------------------------------------------------------------------------
# Modulo Spese Dipendenti
# ---------------------------------------------------------------------------

class Employee(Base):
    """Anagrafica dipendenti."""

    __tablename__ = "employees"

    id = Column(Integer, primary_key=True)
    codice_fiscale = Column(String(20), unique=True, nullable=False)
    cognome = Column(String(100), nullable=False)
    nome = Column(String(100), nullable=False)
    indirizzo = Column(Text, nullable=True)
    qualifica = Column(String(100), nullable=True)
    mansione = Column(String(100), nullable=True)
    livello = Column(String(20), nullable=True)
    email = Column(String(200), nullable=True)
    cellulare = Column(String(30), nullable=True)
    attivo = Column(Boolean, default=True, nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cc_defaults = relationship("EmployeeCCDefault", back_populates="employee")
    monthly_records = relationship("EmployeeMonthly", back_populates="employee")


class CostCenter(Base):
    """Centro di costo (struttura o reparto)."""

    __tablename__ = "cost_centers"

    id = Column(Integer, primary_key=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    tipo = Column(String(50), nullable=False, default="struttura")
    parent_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id"), nullable=True)
    attivo = Column(Boolean, default=True, nullable=False)
    ordine = Column(Integer, default=0, nullable=False)

    hotel = relationship("Hotel")
    children = relationship("CostCenter")


class EmployeeCCDefault(Base):
    """Default di ripartizione CC per dipendente con decorrenza a livello di mese.

    Sostituisce employee_cost_center. La granularità è (anno, mese) per evitare
    conflitti su salvataggi multipli nello stesso giorno.
    anno_fine/mese_fine NULL = assegnazione ancora attiva.
    """

    __tablename__ = "employee_cc_default"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=False)
    percentuale = Column(Numeric(5, 2), nullable=False)
    anno_inizio = Column(Integer, nullable=False)
    mese_inizio = Column(Integer, nullable=False)
    anno_fine = Column(Integer, nullable=True)
    mese_fine = Column(Integer, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    employee = relationship("Employee", back_populates="cc_defaults")
    cost_center = relationship("CostCenter")

    __table_args__ = (
        UniqueConstraint("employee_id", "cost_center_id", "anno_inizio", "mese_inizio",
                         name="uq_emp_cc_default_decorrenza"),
    )


class PayrollImport(Base):
    """Registro dei caricamenti PDF mensili."""

    __tablename__ = "payroll_imports"

    id = Column(Integer, primary_key=True)
    nome_file = Column(String(255), nullable=False)
    mese = Column(Integer, nullable=False)
    anno = Column(Integer, nullable=False)
    societa = Column(String(200), nullable=True)
    n_dipendenti = Column(Integer, nullable=True)
    totale_netto = Column(Numeric(12, 2), nullable=True)
    totale_lordo = Column(Numeric(12, 2), nullable=True)
    totale_costo_aziendale = Column(Numeric(12, 2), nullable=True)
    stato = Column(String(20), default="importato", nullable=False)
    is_test = Column(Boolean, default=False, nullable=False)
    imported_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    entries = relationship("PayrollEntry", back_populates="payroll_import",
                           cascade="all, delete-orphan")
    monthly_records = relationship("EmployeeMonthly", back_populates="payroll_import",
                                   cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("mese", "anno", "societa",
                         name="uq_payroll_mese_anno_societa"),
    )


class PayrollCostType(Base):
    """Tipo di voce di costo (ret_netta, irpef, tfr, ecc.)."""

    __tablename__ = "payroll_cost_types"

    id = Column(Integer, primary_key=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    categoria = Column(String(50), nullable=False)
    segno = Column(String(10), default="positivo", nullable=False)
    ordine = Column(Integer, default=0, nullable=False)
    attivo = Column(Boolean, default=True, nullable=False)


class PayrollEntry(Base):
    """Voce di costo per singolo dipendente in un mese specifico."""

    __tablename__ = "payroll_entries"

    id = Column(Integer, primary_key=True)
    import_id = Column(Integer, ForeignKey("payroll_imports.id", ondelete="CASCADE"), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    cost_type_id = Column(Integer, ForeignKey("payroll_cost_types.id"), nullable=False)
    importo = Column(Numeric(12, 2), default=0, nullable=False)

    payroll_import = relationship("PayrollImport", back_populates="entries")
    employee = relationship("Employee")
    cost_type = relationship("PayrollCostType")

    __table_args__ = (
        UniqueConstraint("import_id", "employee_id", "cost_type_id",
                         name="uq_entry_import_emp_type"),
    )


class EmployeeMonthly(Base):
    """Riepilogo mensile per dipendente con centro di costo."""

    __tablename__ = "employee_monthly"

    id = Column(Integer, primary_key=True)
    import_id = Column(Integer, ForeignKey("payroll_imports.id", ondelete="CASCADE"), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    percentuale_cc = Column(Numeric(5, 2), default=100.00, nullable=False)
    retribuzione_netta = Column(Numeric(12, 2), nullable=True)
    totale_lordo = Column(Numeric(12, 2), nullable=True)
    costo_aziendale = Column(Numeric(12, 2), nullable=True)
    incidenza_percentuale = Column(Numeric(6, 2), nullable=True)
    override_manuale = Column(Boolean, default=False, nullable=False)
    note = Column(Text, nullable=True)

    payroll_import = relationship("PayrollImport", back_populates="monthly_records")
    employee = relationship("Employee", back_populates="monthly_records")
    cost_center = relationship("CostCenter")

    __table_args__ = (
        UniqueConstraint("import_id", "employee_id", name="uq_monthly_import_emp"),
    )


class EmployeeCostCenterMonthly(Base):
    """Assegnazione centro di costo per un dipendente in un mese specifico.

    Può includere split su più centri (somma percentuali = 100).
    Se override_manuale=False, è stata copiata dalle assegnazioni default.
    """

    __tablename__ = "employee_cost_center_monthly"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    import_id = Column(Integer, ForeignKey("payroll_imports.id", ondelete="CASCADE"), nullable=False)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=False)
    percentuale = Column(Numeric(5, 2), nullable=False)
    override_manuale = Column(Boolean, default=False, nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    employee = relationship("Employee")
    cost_center = relationship("CostCenter")
    payroll_import = relationship("PayrollImport")

    __table_args__ = (
        UniqueConstraint("employee_id", "import_id", "cost_center_id",
                         name="uq_eccm_emp_import_cc"),
    )


# ---------------------------------------------------------------------------
# Modulo Forecast & OTB
# ---------------------------------------------------------------------------

class ForecastMaturato(Base):
    """Maturato mensile inserito manualmente: revenue confermata al giorno X.

    Override del dato OTB calcolato da daily_revenue.
    Un solo record attivo per (hotel_id, anno, mese): aggiornato con nuovi dati.
    """

    __tablename__ = "forecast_maturato"

    id = Column(Integer, primary_key=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False)
    anno = Column(Integer, nullable=False)
    mese = Column(Integer, nullable=False)                      # 1-12
    data_riferimento = Column(Date, nullable=False)             # "al giorno X"
    maturato_revenue = Column(Numeric(12, 2), nullable=False)
    maturato_room_nights = Column(Integer, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    hotel = relationship("Hotel")

    __table_args__ = (
        UniqueConstraint("hotel_id", "anno", "mese",
                         name="uq_forecast_maturato_hotel_anno_mese"),
    )


class ForecastBudget(Base):
    """Budget mensile per hotel, anno e mese (1-12)."""

    __tablename__ = "forecast_budget"

    id = Column(Integer, primary_key=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False)
    anno = Column(Integer, nullable=False)
    mese = Column(Integer, nullable=False)                  # 1-12
    budget_revenue = Column(Numeric(12, 2), nullable=False, default=0)
    budget_room_nights = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    hotel = relationship("Hotel")

    __table_args__ = (
        UniqueConstraint("hotel_id", "anno", "mese",
                         name="uq_forecast_budget_hotel_anno_mese"),
    )


class ForecastPickupConfig(Base):
    """Pickup rate mensile: percentuale di incremento del forecast rispetto all'OTB."""

    __tablename__ = "forecast_pickup_config"

    id = Column(Integer, primary_key=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False)
    anno = Column(Integer, nullable=False)
    mese = Column(Integer, nullable=False)                  # 1-12
    pickup_rate = Column(Numeric(6, 4), nullable=False)     # es. 0.15 = +15% sopra OTB
    note = Column(Text, nullable=True)

    hotel = relationship("Hotel")

    __table_args__ = (
        UniqueConstraint("hotel_id", "anno", "mese",
                         name="uq_forecast_pickup_hotel_anno_mese"),
    )
