"""Modello per le soglie dei tachimetri KPI della Home / Cruscotto gruppo."""

from sqlalchemy import Boolean, Column, Integer, Numeric, String, UniqueConstraint

from app.database import Base


class DashboardKpiSoglia(Base):
    """Cutoff rosso/arancio/verde di un tachimetro del cruscotto — editabile da admin.

    direzione:
      'alto_meglio'  → verde sopra soglia_arancione, rosso sotto soglia_rossa (es. occupancy)
      'basso_meglio' → verde sotto soglia_arancione, rosso sopra soglia_rossa (es. labor_cost_ratio)
      'target'       → gauge bidirezionale centrato su `target` (es. Δ RT-PMS, target=0;
                        vs-budget, target=100): verde entro ±soglia_arancione dal target,
                        arancio entro ±soglia_rossa, rosso oltre.
    hotel_code NULL = soglia di default (gruppo); valorizzato = override per singolo hotel.
    mese NULL = soglia "piatta" (usata per i gauge di stagione, es. Occupancy stagione, e come
    fallback se manca la riga specifica del mese); 1-12 = override per singolo mese solare (es.
    Occupancy/ADR per mese, dove maggio e agosto hanno aspettative molto diverse). _gauge() in
    routers/home.py cerca prima (kpi_code, mese), poi ricade su (kpi_code, mese=NULL).
    """

    __tablename__ = "dashboard_kpi_soglie"

    id = Column(Integer, primary_key=True)
    kpi_code = Column(String(50), nullable=False)
    hotel_code = Column(String(20), nullable=True)
    mese = Column(Integer, nullable=True)
    direzione = Column(String(20), nullable=False, default='alto_meglio', server_default='alto_meglio')
    unita = Column(String(10), nullable=False, default='perc', server_default='perc')  # 'perc' | 'euro' | 'ratio'
    target = Column(Numeric(12, 2), nullable=True)
    soglia_rossa = Column(Numeric(12, 2), nullable=False)
    soglia_arancione = Column(Numeric(12, 2), nullable=False)
    ordine = Column(Integer, nullable=False, default=0, server_default='0')
    attivo = Column(Boolean, nullable=False, default=True, server_default='true')

    __table_args__ = (
        UniqueConstraint('kpi_code', 'hotel_code', 'mese', name='uq_dashboard_kpi_soglia'),
    )
