"""Modello database per il modulo USALI (Conto Economico per struttura)."""

from sqlalchemy import Column, DateTime, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base


class UsaliVoceManuali(Base):
    """Voci manuali del Conto Economico USALI per struttura/mese.

    Le voci auto-calcolate (ricavi camere, ricavi F&B) non vengono salvate qui:
    vengono lette direttamente da daily_revenue e corrispettivi a query-time.
    """
    __tablename__ = "usali_voci_manuali"

    id = Column(Integer, primary_key=True, autoincrement=True)
    struttura_code = Column(String(10), nullable=False)
    anno = Column(Integer, nullable=False)
    mese = Column(Integer, nullable=False)
    voce_code = Column(String(50), nullable=False)
    valore = Column(Numeric(14, 2), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('struttura_code', 'anno', 'mese', 'voce_code',
                         name='uq_usali_struttura_anno_mese_voce'),
    )
