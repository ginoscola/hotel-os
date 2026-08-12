"""Statistiche Produzione — import analitico riga-per-riga da Welcome PMS (StatisticheProduzione.xlsx).

Registro gestionale, distinto dal registro fiscale di Corrispettivi (listaConti.xlsx / corrispettivi_documenti).
"""

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String,
    Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship

from app.database import Base


class ProdCategoria(Base):
    """Categoria di ricavo produzione — NON hardcoded, configurabile da admin."""

    __tablename__ = "prod_categorie"

    id                  = Column(Integer, primary_key=True)
    code                = Column(String(50), unique=True, nullable=False)
    name                = Column(String(100), nullable=False)
    descrizione         = Column(Text, nullable=True)
    includi_report      = Column(Boolean, nullable=False, default=True, server_default='true')
    ordine              = Column(Integer, nullable=False, default=0, server_default='0')
    colore              = Column(String(7), nullable=True)
    attivo              = Column(Boolean, nullable=False, default=True, server_default='true')
    # Tariffa unitaria di riferimento (es. 20.00 €/notte Parcheggio Hotel) — usata per assegnare
    # a questa categoria le righe con dettaglio "a prezzo" quando prezzo_lordo è un multiplo
    # esatto della tariffa (vedi ProdDettaglioCategoria.categoria_da_prezzo). Editabile da admin:
    # se la tariffa cambia stagione, si aggiorna qui senza toccare il parser.
    tariffa_riferimento = Column(Numeric(6, 2), nullable=True)


class ProdDettaglioCategoria(Base):
    """Mapping testo Welcome (Articolo) -> categoria — NON hardcoded, editabile da admin.

    Sostituisce il dizionario Python fisso: aggiungere/rimuovere/rimappare qualunque voce
    (es. i due tipi di parcheggio) non richiede più modifiche al parser. Match case-insensitive
    a parse-time (indice uq_prod_dettaglio_categoria_lower su lower(dettaglio_originale)).
    """

    __tablename__ = "prod_dettaglio_categoria"

    id                  = Column(Integer, primary_key=True)
    dettaglio_originale = Column(String(200), nullable=False)
    categoria_id        = Column(Integer, ForeignKey("prod_categorie.id", ondelete="CASCADE"), nullable=False)
    # True: ignora il testo, assegna in base al prezzo (multiplo esatto di una
    # tariffa_riferimento tra le categorie attive) — categoria_id resta come fallback se
    # nessuna tariffa combacia. Es. "Parcheggio extra": 91€ (=7×13) -> Parcheggio Esterno,
    # 20€ -> Parcheggio Hotel, un importo che non è multiplo di nessuna tariffa nota -> fallback.
    categoria_da_prezzo = Column(Boolean, nullable=False, default=False, server_default='false')
    created_at          = Column(DateTime(timezone=True), server_default=func.now())

    categoria = relationship("ProdCategoria")


class ProdImport(Base):
    """Sessione di import di un file StatisticheProduzione.xlsx."""

    __tablename__ = "prod_imports"

    id                 = Column(Integer, primary_key=True)
    nome_file          = Column(String(255), nullable=False)
    data_da            = Column(Date, nullable=False)
    data_a             = Column(Date, nullable=False)
    strutture_presenti = Column(ARRAY(String), nullable=True)
    n_righe_totali     = Column(Integer, nullable=False, default=0)
    n_righe_valide     = Column(Integer, nullable=False, default=0)
    n_righe_riassetto  = Column(Integer, nullable=False, default=0)
    n_righe_escluse    = Column(Integer, nullable=False, default=0)
    is_test            = Column(Boolean, nullable=False, default=False)
    imported_by        = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())

    righe = relationship("ProdRiga", back_populates="import_", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("data_da", "data_a", "nome_file", name="uq_prod_import"),
    )


class ProdRiga(Base):
    """Singola riga analitica (un addebito) da StatisticheProduzione.xlsx."""

    __tablename__ = "prod_righe"

    id                  = Column(Integer, primary_key=True)
    import_id           = Column(Integer, ForeignKey("prod_imports.id", ondelete="CASCADE"), nullable=False)
    # Identificativo univoco del singolo addebito lato Welcome (colonna 'Oid' del file) — vera
    # chiave anti-duplicati, più robusto di qualsiasi tupla di campi (vedi __table_args__).
    oid_welcome         = Column(Integer, nullable=True)

    data_riferimento    = Column(Date, nullable=False)
    data_arrivo         = Column(Date, nullable=True)
    data_partenza       = Column(Date, nullable=True)

    struttura_code      = Column(String(20), nullable=False)
    camera              = Column(String(50), nullable=True)
    tipo_camera         = Column(String(100), nullable=True)

    categoria_id        = Column(Integer, ForeignKey("prod_categorie.id"), nullable=True)
    descrizione         = Column(String(100), nullable=True)
    sotto_descrizione   = Column(String(100), nullable=True)
    dettaglio_originale = Column(String(200), nullable=True)

    is_riassetto        = Column(Boolean, nullable=False, default=False)

    prezzo_lordo        = Column(Numeric(12, 2), nullable=False, default=0)
    prezzo_netto        = Column(Numeric(12, 2), nullable=False, default=0)
    imponibile          = Column(Numeric(12, 2), nullable=False, default=0)
    iva                 = Column(Numeric(12, 2), nullable=False, default=0)
    aliquota_pct        = Column(Numeric(5, 2), nullable=False, default=0)
    quantita            = Column(Integer, nullable=False, default=1)

    codice_prenotazione = Column(String(100), nullable=True)
    ospite               = Column(String(200), nullable=True)
    trattamento          = Column(String(100), nullable=True)
    canale               = Column(String(100), nullable=True)
    segmento             = Column(String(100), nullable=True)
    tipo_ospite          = Column(String(100), nullable=True)

    is_test              = Column(Boolean, nullable=False, default=False)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())

    import_   = relationship("ProdImport", back_populates="righe")
    categoria = relationship("ProdCategoria")

    __table_args__ = (
        # Chiave globale (non per-import, così due sessioni diverse che coprono lo stesso
        # giorno non duplicano le righe) su oid_welcome, l'identificativo reale del singolo
        # addebito lato Welcome — non una tupla di campi: quando 'ospite' è vuoto (prenotazioni
        # di gruppo senza nome associato a ogni addebito, reale nel file) più righe DISTINTE
        # possono condividere identici struttura/data/camera/dettaglio/prezzo (es. 3 colazioni
        # uguali per 3 persone diverse nella stessa camera), e una tupla di campi le
        # collasserebbe erroneamente in una sola. is_test incluso: un import reale che si
        # sovrappone a dati di test non deve essere scartato come "duplicato" di quelli.
        UniqueConstraint("is_test", "oid_welcome", name="uq_prod_riga_antiduplicati"),
    )
