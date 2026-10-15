"""Modello database per il Conto Economico USALI contabile (import mensile dal gestionale).

Distinto dal Conto Economico "interno" di usali.py (calcolato da daily_revenue/Dipendenti/voci
manuali): qui la fonte è l'export del gestionale contabile, già riclassificato USALI, salvato a
livello di singolo conto/mese. Le righe sono dato grezzo, mai modificate dopo l'import: ogni
nuovo import sostituisce le righe dei (struttura, anno, mese) che contiene.
"""

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.database import Base


class UsaliStrutturaGestionale(Base):
    """Id struttura del gestionale (es. 128) → struttura HotelOS (es. DPH)."""
    __tablename__ = "usali_struttura_gestionale"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    id_gestionale  = Column(Integer, nullable=False, unique=True)
    struttura_code = Column(String(10), nullable=False)
    note           = Column(String(200), nullable=True)


class UsaliImport(Base):
    """Log degli import: resta anche quando un import successivo ne sostituisce le righe."""
    __tablename__ = "usali_import"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    struttura_code    = Column(String(10), nullable=False)
    nome_file_xlsx    = Column(String(255), nullable=False)
    nome_file_csv     = Column(String(255), nullable=True)
    sha256            = Column(String(64), nullable=False, index=True)   # dell'xlsx (fonte importi)
    sha256_csv        = Column(String(64), nullable=True)
    percorso_xlsx     = Column(String(500), nullable=True)   # file originali su disco
    percorso_csv      = Column(String(500), nullable=True)
    utente_id         = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    periodi           = Column(JSON, nullable=False)          # ["2026-01", "2026-02", ...]
    n_righe           = Column(Integer, nullable=False, default=0, server_default="0")
    quadratura_ok     = Column(Boolean, nullable=False, default=False, server_default="false")
    csv_arricchito    = Column(Boolean, nullable=False, default=False, server_default="false")
    avvisi            = Column(JSON, nullable=True)
    note              = Column(Text, nullable=True)


class UsaliRiga(Base):
    """Un conto (foglia della pivot) per un mese. Dato grezzo, mai modificato."""
    __tablename__ = "usali_riga"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    import_id      = Column(Integer, ForeignKey("usali_import.id", ondelete="SET NULL"), nullable=True)
    struttura_code = Column(String(10), nullable=False)
    anno           = Column(Integer, nullable=False)
    mese           = Column(Integer, nullable=False)
    ordine         = Column(Integer, nullable=False, default=0, server_default="0")   # riga nel file: ordine di stampa
    percorso       = Column(JSON, nullable=False)                 # nomi dalla radice alla foglia
    percorso_testo = Column(String(1000), nullable=False, index=True)
    sezione        = Column(String(50), nullable=True)
    reparto        = Column(String(150), nullable=True)
    sottoreparto   = Column(String(300), nullable=True)
    conto_nome     = Column(String(200), nullable=False)
    id_conti       = Column(Integer, nullable=True)
    id_reparto     = Column(Integer, nullable=True)
    tipo           = Column(String(10), nullable=False)           # 'ricavo' | 'costo'
    ammortamento   = Column(Boolean, nullable=False, default=False, server_default="false")
    # 4 decimali, non 2: il gestionale ripartisce costi condivisi con frazioni di centesimo;
    # arrotondando ogni conto al centesimo i totali mensili sbagliavano di qualche cent.
    importo        = Column(Numeric(14, 4), nullable=False, default=0, server_default="0")

    __table_args__ = (
        Index("ix_usali_riga_struttura_periodo", "struttura_code", "anno", "mese"),
    )


class UsaliSegmento(Base):
    """Segmento di reporting dentro una struttura (oggi: un solo 'Du Parc + Maremosso')."""
    __tablename__ = "usali_segmento"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    struttura_code = Column(String(10), nullable=False)
    nome           = Column(String(100), nullable=False)

    __table_args__ = (
        UniqueConstraint("struttura_code", "nome", name="uq_usali_segmento_struttura_nome"),
    )


class UsaliRegolaSegmento(Base):
    """Regola di assegnazione riga → segmento, applicata in lettura (mai salvata sulle righe).

    tipo_match: 'percorso_prefisso' (sotto-percorso contiguo, es. 'Food & Beverage > Ristorante';
    '' = tutto), 'id_conti', 'id_reparto', 'nome_contiene'. Priorità più alta vince; le regole
    vincenti per una riga devono sommare al 100%.
    valida_dal/valida_al: 'YYYY-MM' (valida_al NULL = senza scadenza).
    """
    __tablename__ = "usali_regola_segmento"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    struttura_code = Column(String(10), nullable=False)
    priorita       = Column(Integer, nullable=False, default=0, server_default="0")
    tipo_match     = Column(String(30), nullable=False)
    pattern        = Column(String(500), nullable=False, default="", server_default="")
    segmento_id    = Column(Integer, ForeignKey("usali_segmento.id", ondelete="CASCADE"), nullable=False)
    percentuale    = Column(Numeric(5, 2), nullable=False, default=100, server_default="100")
    valida_dal     = Column(String(7), nullable=False, default="2000-01", server_default="2000-01")
    valida_al      = Column(String(7), nullable=True)


class UsaliCategoriaKpi(Base):
    """Conto (eventualmente ristretto a un reparto) → categoria KPI.

    categoria: 'personale' | 'food' | 'beverage' | 'commissioni' | 'utenze' | 'altro'.
    reparto '' = qualunque reparto. Match case-insensitive sul nome conto.
    """
    __tablename__ = "usali_categoria_kpi"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    conto_nome = Column(String(200), nullable=False)
    reparto    = Column(String(150), nullable=False, default="", server_default="")
    categoria  = Column(String(20), nullable=False)

    __table_args__ = (
        UniqueConstraint("conto_nome", "reparto", name="uq_usali_categoria_kpi_conto_reparto"),
    )
