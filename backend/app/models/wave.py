"""Storico del fatturato pre-HotelOS per l'indice WAVE (Weekly Achieved Value vs Excellence).

Una riga per struttura × anno × mese: netto IVA esclusa, senza tassa di soggiorno, per data documento (stessa
natura dei corrispettivi). Solo gli anni prima di HotelOS (2022–2025): dal 2026 i valori si leggono dai
Corrispettivi e non vengono mai salvati qui. Il riferimento non è salvato: si ricalcola sempre
(`services/wave.py`).
"""

from sqlalchemy import Boolean, Column, DateTime, Integer, Numeric, String, Text, UniqueConstraint, func

from app.database import Base


class WaveStorico(Base):
    __tablename__ = "wave_storico"

    id = Column(Integer, primary_key=True)
    struttura_code = Column(String(10), nullable=False)
    anno = Column(Integer, nullable=False)
    mese = Column(Integer, nullable=False)
    # 4 decimali: il file ha valori derivati da divisioni (÷ 1,10), arrotondare solo in presentazione
    netto = Column(Numeric(14, 4), nullable=False)
    lordo = Column(Numeric(14, 2), nullable=True)          # IVA e tassa incluse, solo informativo
    tassa_soggiorno = Column(Numeric(14, 2), nullable=True)
    metodo = Column(Text, nullable=True)
    fonte = Column(Text, nullable=True)
    note = Column(Text, nullable=True)
    # Correzione a mano da Admin: il reimport del file non la tocca; `netto_originale` = valore del file
    modificato_manualmente = Column(Boolean, nullable=False, default=False, server_default='false')
    netto_originale = Column(Numeric(14, 4), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('struttura_code', 'anno', 'mese', name='uq_wave_storico'),
    )
