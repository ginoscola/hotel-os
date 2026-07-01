"""Modelli database per il modulo Corrispettivi v4 (tabella unificata documenti)."""

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class CorrispettiviImport(Base):
    """Sessione di import: un record per ogni file Excel caricato."""
    __tablename__ = "corrispettivi_imports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nome_file = Column(String(255), nullable=True)
    data_da = Column(Date, nullable=False)
    data_a = Column(Date, nullable=False)
    tipo_import = Column(String(20), nullable=False)       # 'excel' | 'manuale'
    strutture_presenti = Column(ARRAY(String), nullable=True)
    n_scontrini = Column(Integer, nullable=False, default=0)
    n_fatture = Column(Integer, nullable=False, default=0)
    n_esclusi = Column(Integer, nullable=False, default=0)
    is_test = Column(Boolean, nullable=False, default=False)
    imported_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    documenti = relationship("CorrispettiviDocumento", back_populates="importazione",
                              foreign_keys="CorrispettiviDocumento.import_id")


class CorrispettiviDocumento(Base):
    """
    Tabella analitica unificata per tutti i documenti corrispettivi.

    tipo: 'scontrino' | 'fattura' | 'escluso'
    I documenti esclusi (CP/FD/altro) vengono salvati per audit ma non
    compaiono nei report fiscali.
    """
    __tablename__ = "corrispettivi_documenti"

    id = Column(Integer, primary_key=True, autoincrement=True)
    import_id = Column(Integer, ForeignKey("corrispettivi_imports.id", ondelete="SET NULL"),
                       nullable=True)
    data_documento = Column(Date, nullable=False)
    numero = Column(Integer, nullable=True)
    suffisso = Column(String(20), nullable=False, default='')
    tipo = Column(String(20), nullable=False)    # 'scontrino' | 'fattura' | 'escluso'
    struttura_code = Column(String(20), nullable=False)
    intestazione = Column(Text, nullable=True)
    camera = Column(Text, nullable=True)
    totale_lordo = Column(Numeric(12, 2), nullable=False, default=0)
    incassato = Column(Numeric(12, 2), nullable=False, default=0)
    deposito = Column(Numeric(12, 2), nullable=False, default=0)
    sospeso = Column(Numeric(12, 2), nullable=False, default=0)
    abbuono = Column(Numeric(12, 2), nullable=False, default=0)
    imponibile = Column(Numeric(12, 2), nullable=False, default=0)
    iva = Column(Numeric(12, 2), nullable=False, default=0)
    aliquota_pct = Column(Numeric(5, 2), nullable=False, default=0)
    # Valore esatto tassa di soggiorno (solo formato esteso Welcome PMS; NULL se non disponibile)
    tassa_soggiorno = Column(Numeric(12, 2), nullable=True)
    categoria = Column(String(30), nullable=True)
    codice_prenotazione = Column(Text, nullable=True)
    tipo_pagamento = Column(Text, nullable=True)
    categoria_pagamento = Column(String(100), nullable=True)
    conto_anticipato = Column(Boolean, nullable=False, default=False)
    acconto = Column(Boolean, nullable=False, default=False)
    annullato = Column(Boolean, nullable=False, default=False)
    ospiti = Column(Text, nullable=True)
    note = Column(Text, nullable=True)
    motivo_esclusione = Column(Text, nullable=True)

    # Colonne formato esteso Welcome PMS (NULL se file in formato base 18 colonne)
    sigla = Column(Text, nullable=True)
    numero_scontrino = Column(Text, nullable=True)
    arrivo = Column(Date, nullable=True)
    partenza = Column(Date, nullable=True)
    ubicazione_istat = Column(Text, nullable=True)
    voucher = Column(Text, nullable=True)
    nome_file_pms = Column(Text, nullable=True)
    stato_fe = Column(Text, nullable=True)
    modalita = Column(Text, nullable=True)
    importo_bollo = Column(Numeric(12, 2), nullable=True)
    tipo_documento_fe = Column(Text, nullable=True)
    numero_documento_fe = Column(Text, nullable=True)
    nazione = Column(Text, nullable=True)
    ora_stampa = Column(Text, nullable=True)
    contabilizzato_mexal = Column(Text, nullable=True)
    causale_cancellazione = Column(Text, nullable=True)
    maschera_conto = Column(Text, nullable=True)
    data_creazione_doc = Column(Date, nullable=True)
    utente_creazione = Column(Text, nullable=True)

    # Campi audit per modifiche manuali
    modificato_manualmente = Column(Boolean, nullable=False, default=False)
    totale_lordo_originale = Column(Numeric(12, 2), nullable=True)
    imponibile_originale = Column(Numeric(12, 2), nullable=True)
    iva_originale = Column(Numeric(12, 2), nullable=True)
    categoria_originale = Column(String(30), nullable=True)
    modifica_note = Column(Text, nullable=True)
    modificato_da = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    modificato_at = Column(DateTime(timezone=True), nullable=True)

    is_test = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('struttura_code', 'data_documento', 'numero', 'suffisso',
                         name='uq_documento'),
    )

    importazione = relationship("CorrispettiviImport", back_populates="documenti",
                                 foreign_keys=[import_id])


class CorrispettiviManuale(Base):
    """Inserimento manuale corrispettivi per MMS (Maremosso) e BON (Buona Onda)."""
    __tablename__ = "corrispettivi_manuali"

    id = Column(Integer, primary_key=True, autoincrement=True)
    data_giorno = Column(Date, nullable=False)
    struttura_code = Column(String(20), nullable=False)    # 'MMS' o 'BON'
    arrangiamenti_lordo = Column(Numeric(12, 2), nullable=False, default=0)
    note = Column(Text, nullable=True)
    is_test = Column(Boolean, nullable=False, default=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                         onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('data_giorno', 'struttura_code', name='uq_manuale_giorno_struttura'),
    )


class RtChiusura(Base):
    """Chiusura giornaliera del Registratore Telematico (RT) inserita manualmente."""
    __tablename__ = "rt_chiusure"

    id = Column(Integer, primary_key=True, autoincrement=True)
    data_chiusura = Column(Date, nullable=False)
    # RT1 = DPH+CLB (unica RT fisica), RT2 = INT
    rt_code = Column(String(10), nullable=False)
    # Totale giornaliero obbligatorio
    totale_giorno = Column(Numeric(12, 2), nullable=False)
    # Breakdown per natura IVA (opzionali)
    totale_10 = Column(Numeric(12, 2), nullable=True)      # arrangiamenti 10%
    totale_22 = Column(Numeric(12, 2), nullable=True)      # shop 22%
    totale_ts = Column(Numeric(12, 2), nullable=True)      # tassa soggiorno esente
    totale_penali = Column(Numeric(12, 2), nullable=True)  # penali esente
    # Dettaglio da import CORRISP.xml (AdE) — opzionali, assenti su righe manuali pre-esistenti
    progressivo = Column(Integer, nullable=True)
    imponibile_10 = Column(Numeric(12, 2), nullable=True)
    imposta_10 = Column(Numeric(12, 2), nullable=True)
    imponibile_22 = Column(Numeric(12, 2), nullable=True)
    imposta_22 = Column(Numeric(12, 2), nullable=True)
    esente_n1 = Column(Numeric(12, 2), nullable=True)
    tassa_soggiorno_nrs = Column(Numeric(12, 2), nullable=True)
    num_documenti = Column(Integer, nullable=True)
    pagato_contanti = Column(Numeric(12, 2), nullable=True)
    pagato_elettronico = Column(Numeric(12, 2), nullable=True)
    # True per righe inserite/corrette a mano: l'import XML non le sovrascrive mai
    modificato_manualmente = Column(Boolean, nullable=False, default=False)
    note = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('data_chiusura', 'rt_code', name='uq_rt_chiusura_data_codice'),
    )
