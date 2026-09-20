"""Cancellazioni — import riga-per-riga da export Welcome PMS ("Elenco Prenotazioni" o,
in formato legacy, "PrenotazioniWeb").

Dato reale (una riga = una camera cancellata), non derivato per confronto di snapshot —
sostituisce la stima "picco vs attuale" che esisteva in Forecast (`_cancellazioni_hotel`,
rimossa dopo il confronto: il dato reale mostrava un numero di camere/revenue perso molto
più alto, perché la stima nettava le cancellazioni contro le nuove prenotazioni sulla
stessa data — vedi CLAUDE.md, sezione Forecast). Limite noto del formato "PrenotazioniWeb":
l'export Welcome non espone né un ID prenotazione interno univoco né la data di
cancellazione — solo la data di prenotazione originale — quindi non è possibile costruire
un incrocio mese prenotazione × mese cancellazione, solo il totale cancellato per mese di
prenotazione. Il formato "Elenco Prenotazioni" non ha questo limite (ID e data
cancellazione nativi).

⚠️ Nonostante il nome, dal `prenot008_2026` la tabella `prenotazioni_cancellate` può contenere
anche prenotazioni MAI cancellate (colonna `cancellata`) — Welcome non permette di esportare in
un solo file "tutte le prenotazioni" con lo stato incluso: bisogna generare due file separati
(stessa struttura), uno per le disdette (`tipo='disdetta'` in fase di import) e uno per le
prenotazioni ancora valide (`tipo='non_disdetta'`). Non è stata scelta una tabella separata per le
"non disdette" perché con import settimanali futuri la stessa prenotazione può passare da valida a
cancellata da una settimana all'altra: la logica di identità/reimport già esistente (hotel+codice
prenotazione+camera) aggiorna il flag `cancellata` sulla stessa riga invece di dover riconciliare
due tabelle indipendenti. Il nome tabella non è stato cambiato per non toccare tutti i punti del
codice che già la referenziano — la sua semantica reale oggi è "prenotazioni importate da Welcome",
il valore di `cancellata` distingue le due categorie.
"""

from sqlalchemy import (
    JSON, Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String,
    UniqueConstraint, func,
)
from sqlalchemy.orm import relationship

from app.database import Base


class PrenotazioneCancellataImport(Base):
    """Sessione di import di un export Welcome di prenotazioni cancellate."""

    __tablename__ = "prenotazioni_cancellate_imports"

    id = Column(Integer, primary_key=True)
    nome_file = Column(String(255), nullable=False)
    # Mese/anno dichiarati in fase di upload — per il formato "PrenotazioniWeb" validano le righe
    # (vedi services/prenotazioni_parser.py); per "Elenco Prenotazioni" sono solo un'etichetta
    # (mese nullable: NULL = import di più mesi/intera stagione in un colpo solo, es. il "mega
    # import" di fine stagione — non usato per filtrare i report, che leggono sempre le date reali
    # riga per riga).
    mese = Column(Integer, nullable=True)
    anno = Column(Integer, nullable=False)
    # 'disdetta' (comportamento storico) o 'non_disdetta' — quale dei due file separati che
    # Welcome costringe a generare è stato caricato (vedi docstring del modulo). Determina il
    # valore di PrenotazioneCancellata.cancellata scritto per tutte le righe di questo import.
    tipo = Column(String(20), nullable=False, server_default="disdetta")
    n_righe_totali = Column(Integer, nullable=False, default=0)
    n_righe_valide = Column(Integer, nullable=False, default=0)
    n_righe_fuori_mese = Column(Integer, nullable=False, default=0)
    is_test = Column(Boolean, nullable=False, default=False)
    imported_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    righe = relationship(
        "PrenotazioneCancellata", back_populates="import_", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("mese", "anno", "nome_file", "tipo", name="uq_prenotazioni_cancellate_import"),
    )


class PrenotazioneCancellata(Base):
    """Singola camera cancellata (una riga per camera: una prenotazione multi-camera
    genera più righe con lo stesso codice_ota)."""

    __tablename__ = "prenotazioni_cancellate"

    id = Column(Integer, primary_key=True)
    import_id = Column(
        Integer, ForeignKey("prenotazioni_cancellate_imports.id", ondelete="CASCADE"), nullable=False
    )
    hotel_code = Column(String(20), nullable=False, index=True)
    # Codice Prenotazione interno di Welcome (es. "6097") — non esposto dall'export CSV attuale
    # (verificato: il pulsante "Esporta" non include questa colonna né "Data cancellazione", pur
    # mostrandole a schermo). Compilato solo se l'utente lo aggiunge a mano al CSV prima di
    # caricarlo, o se un futuro export lo includerà.
    numero_prenotazione = Column(String(50), nullable=True)
    # Vera data di cancellazione — stesso discorso: non nell'export attuale, disponibile solo se
    # inserita a mano nel CSV o esposta in futuro da Welcome.
    data_cancellazione = Column(Date, nullable=True)
    # Data dell'import in cui questa riga è stata vista per la prima volta (fallback pratico
    # quando data_cancellazione manca): con import settimanali dello stesso mese di prenotazione,
    # una riga nuova rispetto alla settimana precedente dà una finestra indicativa di ~7 giorni
    # per la cancellazione, invece di nessuna informazione temporale.
    data_rilevata = Column(Date, nullable=False)
    canale = Column(String(50), nullable=False)          # Booking.com / Mr Preno / Sito Diretto / Italcamel / altro
    canale_vendita = Column(String(100), nullable=False, default="")  # parametroCanaleVendita.descrizione
    # '' invece di NULL — nelle prenotazioni dirette/manuali non c'è un codice OTA, e NULL
    # in un vincolo UNIQUE non collide mai con un altro NULL in Postgres (stesso accorgimento
    # già in uso in prod_parser.py per lo stesso motivo).
    codice_ota = Column(String(50), nullable=False, default="")
    data_prenotazione = Column(Date, nullable=False, index=True)
    arrivo = Column(Date, nullable=False, index=True)
    partenza = Column(Date, nullable=False)
    notti = Column(Integer, nullable=False, default=0)
    pax = Column(Integer, nullable=False, default=0)
    cliente = Column(String(255), nullable=False, default="")
    email = Column(String(255), nullable=True)
    tipo_camera = Column(String(100), nullable=False, default="")
    trattamento = Column(String(100), nullable=True)
    mercato = Column(String(50), nullable=True)
    importo = Column(Float, nullable=False, default=0.0)
    # True se corretta a mano via PUT /prenotazioni-cancellate/{id} (stesso pattern di
    # corrispettivi_documenti.modificato_manualmente): protegge la riga da un reimport futuro,
    # che altrimenti la sovrascriverebbe silenziosamente con il dato (sbagliato) del file Welcome.
    modificato_manualmente = Column(Boolean, nullable=False, default=False)
    # False = prenotazione ancora valida al momento dell'import "non_disdetta"; True = cancellata
    # (comportamento storico, unica categoria esistente prima di prenot008_2026 — le righe già in
    # DB diventano tutte True via server_default in migrazione). Aggiornato dal reimport come ogni
    # altro campo (una prenotazione valida può risultare cancellata in un import successivo).
    cancellata = Column(Boolean, nullable=False, server_default="true")
    # Riga intera del file così com'è (tutte le colonne, comprese quelle non ancora mappate a un
    # campo proprio, es. Segmento/Fonte/Nazione) — non modificabile da PUT (resta lo snapshot
    # dell'import originale anche dopo una correzione manuale dei campi "veri"). NULL sulle righe
    # importate prima dell'introduzione di questo campo. Utile per dati non ancora usati oggi ma
    # che potrebbero servire in futuro, senza dover reimportare per ognuno.
    dati_grezzi = Column(JSON, nullable=True)
    is_test = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    import_ = relationship("PrenotazioneCancellataImport", back_populates="righe")

    __table_args__ = (
        # ⚠️ pax fa parte della chiave: senza, due camere diverse della stessa prenotazione con
        # stesso tipo camera e stesso importo (es. due D-Smart identiche) collidono e la seconda
        # viene scartata come falso duplicato — bug reale riscontrato al primo import vero
        # (prenotazione 127, due camere con pax 2 e 1, importo identico 432,90€), stesso tipo di
        # problema già documentato per prod_righe con ospite vuoto.
        UniqueConstraint(
            "is_test", "hotel_code", "codice_ota", "data_prenotazione", "arrivo", "partenza",
            "tipo_camera", "importo", "cliente", "pax",
            name="uq_prenotazione_cancellata_dedup",
        ),
    )
