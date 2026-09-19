"""Cancellazioni reali — import riga-per-riga da export Welcome PMS ("PrenotazioniWeb"),
filtrato lato Welcome per mese di prenotazione + stato eliminata/cancellata.

Fonte alternativa/complementare alla stima "picco vs attuale" di Forecast (vedi
routers/forecast.py, _cancellazioni_hotel): qui il dato è reale (una riga = una camera
cancellata), non derivato per confronto di snapshot. Limite noto: l'export Welcome non
espone né un ID prenotazione interno univoco né la data di cancellazione — solo la data
di prenotazione originale — quindi non è possibile costruire un incrocio mese
prenotazione × mese cancellazione, solo il totale cancellato per mese di prenotazione.
"""

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String,
    UniqueConstraint, func,
)
from sqlalchemy.orm import relationship

from app.database import Base


class PrenotazioneCancellataImport(Base):
    """Sessione di import di un export Welcome di prenotazioni cancellate."""

    __tablename__ = "prenotazioni_cancellate_imports"

    id = Column(Integer, primary_key=True)
    nome_file = Column(String(255), nullable=False)
    # Mese/anno di prenotazione dichiarati in fase di upload (usati solo per il controllo
    # di coerenza sulle righe — vedi services/prenotazioni_parser.py — non per il filtro
    # dei report, che usano sempre data_prenotazione reale della riga).
    mese = Column(Integer, nullable=False)
    anno = Column(Integer, nullable=False)
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
        UniqueConstraint("mese", "anno", "nome_file", name="uq_prenotazioni_cancellate_import"),
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
    trattamento = Column(String(20), nullable=True)
    mercato = Column(String(50), nullable=True)
    importo = Column(Float, nullable=False, default=0.0)
    is_test = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    import_ = relationship("PrenotazioneCancellataImport", back_populates="righe")

    __table_args__ = (
        UniqueConstraint(
            "is_test", "hotel_code", "codice_ota", "data_prenotazione", "arrivo", "partenza",
            "tipo_camera", "importo", "cliente",
            name="uq_prenotazione_cancellata_dedup",
        ),
    )
