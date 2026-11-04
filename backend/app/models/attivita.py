"""Attività ricorrenti (scadenziario operativo): solo le spunte fatte a mano.

Il catalogo delle attività è nel codice (`services/attivita.py`) e le frequenze modificate da Admin stanno in
`app_config['attivita_parametri']`. Lo stato "fatta" si ricava quasi sempre dagli import dei moduli; questa tabella
serve per le attività che HotelOS non può verificare e per segnare fatta a mano una scadenza (es. una settimana senza
file da caricare).
"""

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint, func

from app.database import Base


class AttivitaFatta(Base):
    __tablename__ = "attivita_fatte"

    id = Column(Integer, primary_key=True)
    codice = Column(String(40), nullable=False)          # codice dell'attività nel catalogo
    scadenza = Column(Date, nullable=False)              # scadenza dell'occorrenza segnata fatta
    utente_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("codice", "scadenza", name="uq_attivita_fatta"),)
