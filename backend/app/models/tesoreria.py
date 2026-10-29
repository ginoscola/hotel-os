"""Modello database del modulo Tesoreria (flusso di cassa di KM di Mare S.r.l.).

Fase 1: conti (banche, carte, prepagata), saldi noti, import degli estratti conto bancari (XML CBI),
movimenti, categorie e regole di classificazione.

- I movimenti arrivano solo dagli estratti conto: la banca è la fonte di verità per il passato.
- Antiduplicato: `impronta` univoca per conto = riferimento univoco della banca (`AcctSvcrRef`)
  quando presente, altrimenti hash dei dati del movimento + indice di occorrenza nel file.
- Saldi: saldo a fine giornata (data contabile). Dall'XML arriva il saldo di chiusura di ogni giorno
  con movimenti; carte e prepagata hanno solo saldi inseriti a mano.
- Importi `Numeric(14,2)`, letti come `Decimal`: mai float.

Fase 2: fotografie dello scadenzario fornitori Passcom ("da pagare"). Ogni import è una fotografia
delle scadenze aperte a una data; più file con la stessa data compongono la stessa fotografia (anno
contabile vecchio + nuovo a cavallo d'anno). Le scadenze sono identificate da `chiave` (codice
fornitore + protocollo + data scadenza + importo), stabile tra una fotografia e l'altra: abbinamenti
con la banca e pagamenti segnati a mano si legano alla chiave, non alla riga importata.
"""

from sqlalchemy import (
    JSON, Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.database import Base

TIPI_CONTO = ("conto", "carta_credito", "prepagata", "cassa")
TIPI_CATEGORIA = ("entrata", "uscita", "neutra")
CAMPI_REGOLA = ("descrizione", "controparte")
OPERATORI_REGOLA = ("inizia", "contiene")
SEGNI_REGOLA = ("entrata", "uscita", "entrambi")
ORIGINI_SALDO = ("import", "manuale")


class TesoreriaConto(Base):
    __tablename__ = "tesoreria_conti"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    codice        = Column(String(20), nullable=False, unique=True)     # es. '095081', 'AMEX'
    nome          = Column(String(100), nullable=False)
    banca         = Column(String(100), nullable=True)
    tipo          = Column(String(20), nullable=False)                  # TIPI_CONTO
    iban          = Column(String(34), nullable=True, unique=True)      # riconosce il conto dall'XML
    fido          = Column(Numeric(14, 2), nullable=False, default=0, server_default="0")
    fido_scadenza = Column(Date, nullable=True)                         # NULL = sempre conteggiato
    ha_import     = Column(Boolean, nullable=False, default=False, server_default="false")
    # Carte di credito: testo dell'addebito nell'estratto conto bancario (riconosce il pagamento)
    testo_addebito = Column(String(100), nullable=True)
    colore        = Column(String(7), nullable=True)
    ordine        = Column(Integer, nullable=False, default=0, server_default="0")
    attivo        = Column(Boolean, nullable=False, default=True, server_default="true")
    note          = Column(Text, nullable=True)


class TesoreriaImport(Base):
    """Log degli import di estratti conto, con il file originale su disco."""
    __tablename__ = "tesoreria_import"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    conto_id        = Column(Integer, ForeignKey("tesoreria_conti.id"), nullable=False)
    nome_file       = Column(String(255), nullable=False)
    sha256          = Column(String(64), nullable=False, index=True)
    percorso        = Column(String(500), nullable=True)
    data_da         = Column(Date, nullable=True)
    data_a          = Column(Date, nullable=True)
    n_movimenti     = Column(Integer, nullable=False, default=0, server_default="0")   # nel file
    n_nuovi         = Column(Integer, nullable=False, default=0, server_default="0")   # inseriti
    n_gia_presenti  = Column(Integer, nullable=False, default=0, server_default="0")
    n_saldi         = Column(Integer, nullable=False, default=0, server_default="0")
    avvisi          = Column(JSON, nullable=True)
    note            = Column(Text, nullable=True)
    utente_id       = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())


class TesoreriaSaldo(Base):
    """Saldo a fine giornata di un conto. Uno per (conto, data)."""
    __tablename__ = "tesoreria_saldi"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    conto_id   = Column(Integer, ForeignKey("tesoreria_conti.id"), nullable=False)
    data       = Column(Date, nullable=False)
    saldo      = Column(Numeric(14, 2), nullable=False)
    origine    = Column(String(10), nullable=False)                     # ORIGINI_SALDO
    import_id  = Column(Integer, ForeignKey("tesoreria_import.id", ondelete="SET NULL"), nullable=True)
    note       = Column(Text, nullable=True)
    utente_id  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("conto_id", "data", name="uq_tesoreria_saldo_conto_data"),)


class TesoreriaCategoria(Base):
    __tablename__ = "tesoreria_categorie"

    id                   = Column(Integer, primary_key=True, autoincrement=True)
    codice               = Column(String(40), nullable=False, unique=True)
    nome                 = Column(String(100), nullable=False)
    tipo                 = Column(String(10), nullable=False)           # TIPI_CATEGORIA
    colore               = Column(String(7), nullable=True)
    ordine               = Column(Integer, nullable=False, default=0, server_default="0")
    escludi_da_operativo = Column(Boolean, nullable=False, default=False, server_default="false")
    attivo               = Column(Boolean, nullable=False, default=True, server_default="true")


class TesoreriaRegola(Base):
    """Regola di classificazione: vince la prima (priorità più bassa) che corrisponde.

    Corrisponde se `campo` (descrizione o controparte) inizia con / contiene almeno uno di `valori`
    e, se `valori_anche` è valorizzato, lo stesso campo contiene anche almeno uno di quelli;
    `segno` limita a entrate o uscite. Confronto senza distinzione maiuscole/minuscole.
    """
    __tablename__ = "tesoreria_regole"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    categoria_id  = Column(Integer, ForeignKey("tesoreria_categorie.id", ondelete="CASCADE"), nullable=False)
    priorita      = Column(Integer, nullable=False)
    campo         = Column(String(15), nullable=False)                  # CAMPI_REGOLA
    operatore     = Column(String(10), nullable=False)                  # OPERATORI_REGOLA
    valori        = Column(JSON, nullable=False)                        # ["BOOKING", "THEFORK", ...]
    valori_anche  = Column(JSON, nullable=True)
    segno         = Column(String(10), nullable=False, default="entrambi", server_default="entrambi")
    attiva        = Column(Boolean, nullable=False, default=True, server_default="true")
    note          = Column(String(255), nullable=True)


class TesoreriaMovimento(Base):
    __tablename__ = "tesoreria_movimenti"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    conto_id          = Column(Integer, ForeignKey("tesoreria_conti.id"), nullable=False)
    # Import che ha inserito il movimento per primo: eliminandolo, il movimento sparisce.
    import_id         = Column(Integer, ForeignKey("tesoreria_import.id", ondelete="CASCADE"), nullable=True)
    data_contabile    = Column(Date, nullable=False)
    data_valuta       = Column(Date, nullable=True)
    importo           = Column(Numeric(14, 2), nullable=False)          # negativo = uscita
    descrizione       = Column(Text, nullable=False)                    # testo completo della banca
    controparte       = Column(String(200), nullable=True)              # solo il nome
    causale           = Column(Text, nullable=True)                     # solo la causale
    causale_abi       = Column(String(10), nullable=True)               # es. '48//00'
    riferimento_banca = Column(String(50), nullable=True)               # AcctSvcrRef
    impronta          = Column(String(80), nullable=False)
    categoria_id      = Column(Integer, ForeignKey("tesoreria_categorie.id", ondelete="SET NULL"), nullable=True)
    categoria_manuale = Column(Boolean, nullable=False, default=False, server_default="false")
    straordinario     = Column(Boolean, nullable=False, default=False, server_default="false")
    note              = Column(Text, nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("conto_id", "impronta", name="uq_tesoreria_movimento_impronta"),
        Index("ix_tesoreria_movimenti_conto_data", "conto_id", "data_contabile"),
        Index("ix_tesoreria_movimenti_categoria", "categoria_id"),
    )


class TesoreriaScadImport(Base):
    """Fotografia dello scadenzario fornitori Passcom (un file), con il file originale su disco."""
    __tablename__ = "tesoreria_scad_import"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    data_fotografia = Column(Date, nullable=False, index=True)          # default: data di stampa
    data_stampa     = Column(Date, nullable=True)
    # Anno contabile di Passcom = anno dell'ultima data di registrazione del file. Stessa data e stesso
    # anno contabile = stesso file riscaricato: il nuovo sostituisce il vecchio (con conferma).
    anno_contabile  = Column(Integer, nullable=True)
    nome_file       = Column(String(255), nullable=False)
    sha256          = Column(String(64), nullable=False, index=True)
    percorso        = Column(String(500), nullable=True)
    n_righe         = Column(Integer, nullable=False, default=0, server_default="0")
    totale          = Column(Numeric(14, 2), nullable=False, default=0, server_default="0")
    scadenza_da     = Column(Date, nullable=True)
    scadenza_a      = Column(Date, nullable=True)
    avvisi          = Column(JSON, nullable=True)
    note            = Column(Text, nullable=True)
    utente_id       = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())


class TesoreriaScadenza(Base):
    """Una scadenza aperta di una fotografia (riga di dettaglio dello scadenzario Passcom)."""
    __tablename__ = "tesoreria_scadenze"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    import_id          = Column(Integer, ForeignKey("tesoreria_scad_import.id", ondelete="CASCADE"), nullable=False)
    chiave             = Column(String(160), nullable=False)
    data_scadenza      = Column(Date, nullable=False)
    tipo_pagamento     = Column(String(20), nullable=False)             # RIMESSA, RIC.BANC., ... o *PAREGGIO*
    pareggio           = Column(Boolean, nullable=False, default=False, server_default="false")
    tipo_documento     = Column(String(5), nullable=True)               # FR, NR, PG, ... (NULL per i pareggi)
    registro           = Column(String(5), nullable=True)               # registro IVA (1 Italia, 8 estero)
    numero_documento   = Column(String(30), nullable=True)
    data_documento     = Column(Date, nullable=True)
    data_registrazione = Column(Date, nullable=True)
    protocollo         = Column(String(40), nullable=True)
    codice_fornitore   = Column(String(20), nullable=False)             # es. '601.00073'
    fornitore          = Column(String(200), nullable=False)
    importo            = Column(Numeric(14, 2), nullable=False)         # note di credito e pareggi con segno
    descrizione        = Column(Text, nullable=True)                    # DESCRIZIONE TESTATA

    __table_args__ = (
        UniqueConstraint("import_id", "chiave", name="uq_tesoreria_scadenza_import_chiave"),
        Index("ix_tesoreria_scadenze_chiave", "chiave"),
        Index("ix_tesoreria_scadenze_fornitore", "codice_fornitore"),
    )
