"""Modelli database per il modulo Analisi Ricavi (trattamenti e reparti mensili)."""

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class TrattamentoClassificazione(Base):
    """Mapping globale codice trattamento → nome display + macro-categoria."""
    __tablename__ = "trattamenti_classificazione"

    codice = Column(String(50), primary_key=True)
    nome_display = Column(String(100), nullable=False)
    categoria = Column(String(50), nullable=True)       # NULL = non classificato
    escludi = Column(Boolean, nullable=False, default=False)  # True = ridistribuisci
    ordine = Column(Integer, nullable=False, default=0)
    colore = Column(String(7), nullable=True)           # hex #RRGGBB, NULL = default palette
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now())


class AnalisiRicaviImport(Base):
    """Sessione di import: una per hotel/mese."""
    __tablename__ = "analisi_ricavi_imports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    hotel_id = Column(Integer, ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False)
    anno = Column(Integer, nullable=False)
    mese = Column(Integer, nullable=False)
    granularita = Column(String(20), nullable=False, default="mensile")
    settimana_inizio = Column(Date, nullable=True)       # per futura espansione settimanale
    filename_trattamenti = Column(String(255), nullable=True)
    filename_reparti = Column(String(255), nullable=True)
    n_trattamenti = Column(Integer, nullable=False, default=0)
    n_reparti = Column(Integer, nullable=False, default=0)
    is_test = Column(Boolean, nullable=False, default=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    trattamenti = relationship("AnalisiRicaviTrattamento", back_populates="import_sessione",
                               cascade="all, delete-orphan")
    reparti = relationship("AnalisiRicaviReparto", back_populates="import_sessione",
                           cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('hotel_id', 'anno', 'mese', 'granularita',
                         name='uq_analisi_ricavi_hotel_mese'),
    )


class AnalisiRicaviTrattamento(Base):
    """Ricavi per tipo di trattamento (listino) per hotel/mese."""
    __tablename__ = "analisi_ricavi_trattamenti"

    id = Column(Integer, primary_key=True, autoincrement=True)
    import_id = Column(Integer, ForeignKey("analisi_ricavi_imports.id", ondelete="CASCADE"),
                       nullable=False)
    hotel_id = Column(Integer, ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False)
    anno = Column(Integer, nullable=False)
    mese = Column(Integer, nullable=False)
    codice = Column(String(50), nullable=False)
    valore = Column(Numeric(12, 2), nullable=False)
    modificato_manualmente = Column(Boolean, nullable=False, default=False)
    valore_originale = Column(Numeric(12, 2), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now())

    import_sessione = relationship("AnalisiRicaviImport", back_populates="trattamenti")

    __table_args__ = (
        UniqueConstraint('hotel_id', 'anno', 'mese', 'codice',
                         name='uq_analisi_trattamento_hotel_mese_codice'),
    )


class AnalisiRicaviReparto(Base):
    """Ricavi per reparto per hotel/mese."""
    __tablename__ = "analisi_ricavi_reparti"

    id = Column(Integer, primary_key=True, autoincrement=True)
    import_id = Column(Integer, ForeignKey("analisi_ricavi_imports.id", ondelete="CASCADE"),
                       nullable=False)
    hotel_id = Column(Integer, ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False)
    anno = Column(Integer, nullable=False)
    mese = Column(Integer, nullable=False)
    reparto = Column(String(100), nullable=False)
    valore = Column(Numeric(12, 2), nullable=False)
    modificato_manualmente = Column(Boolean, nullable=False, default=False)
    valore_originale = Column(Numeric(12, 2), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now())

    import_sessione = relationship("AnalisiRicaviImport", back_populates="reparti")

    __table_args__ = (
        UniqueConstraint('hotel_id', 'anno', 'mese', 'reparto',
                         name='uq_analisi_reparto_hotel_mese_reparto'),
    )
