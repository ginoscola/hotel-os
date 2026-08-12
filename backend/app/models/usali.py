"""Modello database per il modulo USALI (Conto Economico + Movimenti Attivi per struttura)."""

from sqlalchemy import Boolean, Column, DateTime, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base


class UsaliMovimentoRiga(Base):
    """Definizione di una riga di 'Movimenti Attivi' (Reparto/Conto) per struttura —
    NON hardcoded, gestita da admin (voci diverse per struttura: DPH ha Maremosso, CLB/INT
    hanno Ristorante proprio, BON un set minimo tutto manuale).
    """
    __tablename__ = "usali_movimenti_righe"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    struttura_code       = Column(String(10), nullable=False)
    reparto              = Column(String(100), nullable=False)
    conto                = Column(String(150), nullable=False)
    riga_code            = Column(String(80), nullable=False)
    # 'manuale' | 'auto_produzione' | 'auto_corrispettivi_penali' | 'auto_maremosso'
    tipo                 = Column(String(30), nullable=False, default='manuale', server_default='manuale')
    categoria_produzione = Column(String(50), nullable=True)  # code di prod_categorie, solo se auto_produzione
    ordine               = Column(Integer, nullable=False, default=0, server_default='0')
    attivo               = Column(Boolean, nullable=False, default=True, server_default='true')
    # Usata solo per righe manuali (grossup imponibile->lordo): le righe auto hanno
    # già l'IVA reale nei dati sorgente, sommata direttamente, non serve un'aliquota assunta.
    aliquota_iva         = Column(Numeric(5, 2), nullable=False, default=10, server_default='10.00')

    __table_args__ = (
        UniqueConstraint('struttura_code', 'riga_code', name='uq_usali_mov_riga_struttura'),
    )


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
