"""Tesoreria — lettura dell'avviso TARI del Comune (PDF con testo arrivato per PEC).

Dalla tabella "Riepilogo e scadenze dei versamenti": rata, scadenza, importo. Se c'è la RATA UNICA è l'unica
considerata (è come viene pagato l'avviso, le rate numerate sono l'alternativa). Le scansioni non hanno testo:
errore esplicito, l'importo va inserito a mano.
"""

import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

import pdfplumber

from app.services.tesoreria_parser import ErroreImportTesoreria

_INTESTAZIONE = re.compile(r"n\.\s*(\d+)\s+del\s+(\d{2}-\d{2}-\d{4})\s+ANNO\s+(\d{4})\.?\s*Emissione a (\w+)", re.I)
_RATA = re.compile(r"^(RATA UNICA|\d+)\s+(\d{2}-\d{2}-\d{4})\s+([\d.]+,\d{2})\s*$", re.I | re.M)
_TOTALE = re.compile(r"Totale Avviso\s+([\d.]+,\d{2})", re.I)


@dataclass
class RataTari:
    numero: str
    scadenza: date
    importo: Decimal


@dataclass
class AvvisoTari:
    numero: str
    data_avviso: date
    anno: int
    fase: str           # 'acconto' | 'conguaglio'
    totale: Decimal
    rate: list


def _num(testo: str) -> Decimal:
    return Decimal(testo.replace(".", "").replace(",", "."))


def _data(testo: str) -> date:
    return datetime.strptime(testo, "%d-%m-%Y").date()


def parse_avviso_tari(contenuto: bytes) -> AvvisoTari:
    try:
        with pdfplumber.open(io.BytesIO(contenuto)) as pdf:
            testo = "\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as e:
        raise ErroreImportTesoreria(f"PDF non leggibile: {e}")
    if not testo.strip():
        raise ErroreImportTesoreria("Il PDF non contiene testo (scansione): inserire gli importi a mano")
    testa = _INTESTAZIONE.search(testo)
    totale = _TOTALE.search(testo)
    inizio = testo.find("Riepilogo e scadenze dei versamenti")
    if not testa or not totale or inizio < 0:
        raise ErroreImportTesoreria("Non sembra un avviso TARI nel formato atteso: inserire gli importi a mano")
    fine = testo.find("Situazione precedenti", inizio)
    righe = _RATA.findall(testo[inizio:fine if fine > 0 else None])
    rate = [RataTari(n.upper(), _data(d), _num(i)) for n, d, i in righe]
    unica = [r for r in rate if r.numero == "RATA UNICA"]
    rate = unica or rate
    if not rate:
        raise ErroreImportTesoreria("Nessuna rata trovata nell'avviso: inserire gli importi a mano")
    tot = _num(totale.group(1))
    if abs(sum(r.importo for r in rate) - tot) > Decimal("0.01"):
        raise ErroreImportTesoreria(f"Le rate non sommano al totale dell'avviso ({tot}): inserire gli importi a mano")
    fase = "conguaglio" if testa.group(4).lower().startswith("congua") else "acconto"
    return AvvisoTari(testa.group(1), _data(testa.group(2)), int(testa.group(3)), fase, tot, rate)
