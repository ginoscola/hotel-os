"""Anagrafica camere degli hotel del gruppo."""

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Room(Base):
    """Singola camera / unità alloggio di un hotel."""

    __tablename__ = "rooms"

    id              = Column(Integer, primary_key=True)
    # Codice come appare nel PMS/PDF (es. "D101", "C048", "I418", "FUEGO")
    code            = Column(String(30), unique=True, nullable=False, index=True)
    hotel_id        = Column(Integer, ForeignKey("hotels.id"), nullable=False, index=True)
    struttura_code  = Column(String(10), nullable=False, index=True)  # DPH/CLB/INT
    tipo_risorsa    = Column(String(20), nullable=True)   # sigla tipo (es. D-COM, C-SFM)
    nome_tipo       = Column(String(100), nullable=True)  # nome leggibile (es. "comfort")
    posti_letto     = Column(Integer, nullable=True)
    letti_aggiunti  = Column(Integer, nullable=True, default=0)
    piano           = Column(Integer, nullable=True)
    attiva          = Column(Boolean, nullable=False, default=True)
    note            = Column(String(255), nullable=True)

    hotel = relationship("Hotel", back_populates="rooms")
