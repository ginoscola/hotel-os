"""Modelli database per il modulo Corrispettivi (Fase 1: SC e SCA)."""

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class CorrispettiviImport(Base):
    """Sessione di import: un record per ogni PDF caricato."""
    __tablename__ = "corrispettivi_import"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    filename = Column(String(255), nullable=False)
    data_da = Column(Date, nullable=True)
    data_a = Column(Date, nullable=True)
    societa = Column(String(200), nullable=True)
    n_sc = Column(Integer, nullable=False, default=0)
    n_sca = Column(Integer, nullable=False, default=0)
    totale_incassato = Column(Numeric(12, 2), nullable=False, default=0)
    is_test = Column(Boolean, nullable=False, default=False)

    documenti = relationship(
        "CorrispettiviDocumento",
        back_populates="importazione",
        cascade="all, delete-orphan",
    )


class CorrispettiviDocumento(Base):
    """Singolo documento SC o SCA estratto dal PDF.

    Un pagamento doppio (split) genera due righe con lo stesso numero documento.
    """
    __tablename__ = "corrispettivi_documento"

    id = Column(Integer, primary_key=True, autoincrement=True)
    import_id = Column(
        Integer, ForeignKey("corrispettivi_import.id", ondelete="CASCADE"), nullable=False
    )
    data = Column(Date, nullable=False)
    tipo_doc = Column(String(10), nullable=False)       # SC o SCA
    numero = Column(Integer, nullable=False)
    struttura_code = Column(String(10), nullable=True)  # DPH, CLB, INT
    camera = Column(String(50), nullable=True)
    intestazione = Column(String(200), nullable=True)
    incassato = Column(Numeric(12, 2), nullable=False)
    tipo_pagamento = Column(String(50), nullable=True)
    annullato = Column(Boolean, nullable=False, default=False)
    is_test = Column(Boolean, nullable=False, default=False)

    importazione = relationship("CorrispettiviImport", back_populates="documenti")
