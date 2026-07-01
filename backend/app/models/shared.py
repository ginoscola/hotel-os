"""Modelli condivisi tra moduli — tabelle di lookup e configurazione globale.

Queste tabelle NON sono prefissate con il nome di un singolo modulo:
sono progettate per essere riutilizzate da qualsiasi parte del sistema.
"""

from sqlalchemy import Boolean, Column, Integer, String
from app.database import Base


class TipoPagamento(Base):
    """Tipi di pagamento accettati — lookup condiviso tra tutti i moduli."""
    __tablename__ = "tipi_pagamento"

    id = Column(Integer, primary_key=True, autoincrement=True)
    codice = Column(String(100), nullable=False, unique=True)   # es. "XPAY-Nexi"
    descrizione = Column(String(100), nullable=False)           # stessa del codice o alias
    categoria = Column(String(100), nullable=False)             # es. "Carta di credito"
    attivo = Column(Boolean, nullable=False, default=True)
    ordine = Column(Integer, nullable=False, default=0)
