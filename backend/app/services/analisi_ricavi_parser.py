"""Parser CSV per il modulo Analisi Ricavi.

Auto-rileva il tipo di file (trattamenti vs reparti) dalla prima riga di intestazione.
Gestisce encoding Windows-1252 / UTF-8 con BOM e il problema dei simboli € corrotti.

Formato file trattamenti:
  Trattamento Non Def;Valore
  BB;5.053,30 €

Formato file reparti:
  Reparto;Venduto;Venduto %
  Bar;11,50 €;0,10%
"""

import io
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional, Tuple


@dataclass
class RigaTrattamento:
    codice: str
    valore: Decimal


@dataclass
class RigaReparto:
    reparto: str
    valore: Decimal
    valore_pct: Optional[float]  # percentuale dal file (opzionale, ricalcolata in API)


@dataclass
class RisultatoParsing:
    tipo: str                                   # 'trattamenti' | 'reparti'
    trattamenti: List[RigaTrattamento] = field(default_factory=list)
    reparti: List[RigaReparto] = field(default_factory=list)
    n_righe: int = 0
    totale: Decimal = Decimal('0')
    warnings: List[str] = field(default_factory=list)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _decodifica(raw: bytes) -> str:
    """Prova UTF-8 con BOM, poi UTF-8 puro, poi latin-1 (Windows-1252)."""
    for enc in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('latin-1', errors='replace')


def _pulisci_valore(s: str) -> Optional[Decimal]:
    """Estrae il valore numerico da una stringa in formato italiano.

    Gestisce: '1.888,84 €', '1.888,84Â â¬', '5.053,30', '0,10%'.
    Formato italiano: punto = migliaia, virgola = decimale.
    """
    s = s.strip()
    # Estrai la prima sequenza numerica (cifre, punti, virgole)
    match = re.search(r'[\d.,]+', s)
    if not match:
        return None
    num_str = match.group(0)
    # Rimuovi punti delle migliaia, converti virgola decimale in punto
    num_str = num_str.replace('.', '').replace(',', '.')
    try:
        return Decimal(num_str)
    except Exception:
        return None


def _rileva_tipo(prima_riga: str) -> Optional[str]:
    """Rileva il tipo di file dall'intestazione."""
    riga = prima_riga.lower().strip()
    if 'trattamento' in riga or ('valore' in riga and 'venduto' not in riga):
        return 'trattamenti'
    if 'reparto' in riga or 'venduto' in riga:
        return 'reparti'
    return None


# ── Parser principale ─────────────────────────────────────────────────────────

def parse_csv(raw: bytes, filename: str = '') -> RisultatoParsing:
    """Parsa un file CSV e restituisce RisultatoParsing con tipo auto-rilevato."""
    testo = _decodifica(raw)
    righe = [r.strip() for r in testo.splitlines() if r.strip()]

    if not righe:
        raise ValueError(f"File vuoto: {filename}")

    # Separatore: prova ; poi ,
    sep = ';' if ';' in righe[0] else ','

    intestazione = righe[0]
    tipo = _rileva_tipo(intestazione)
    if tipo is None:
        raise ValueError(
            f"Impossibile rilevare il tipo di file da '{intestazione}'. "
            f"Atteso 'Trattamento...;Valore' oppure 'Reparto;Venduto;Venduto %'."
        )

    risultato = RisultatoParsing(tipo=tipo)
    dati = righe[1:]  # salta intestazione

    for i, riga in enumerate(dati, start=2):
        colonne = [c.strip() for c in riga.split(sep)]
        if len(colonne) < 2:
            risultato.warnings.append(f"Riga {i} ignorata (colonne insufficienti): {riga!r}")
            continue

        if tipo == 'trattamenti':
            codice = colonne[0].strip()
            if not codice:
                continue
            valore = _pulisci_valore(colonne[1])
            if valore is None:
                risultato.warnings.append(f"Riga {i}: valore non leggibile per '{codice}'")
                continue
            risultato.trattamenti.append(RigaTrattamento(codice=codice, valore=valore))
            risultato.totale += valore
            risultato.n_righe += 1

        else:  # reparti
            reparto = colonne[0].strip()
            if not reparto:
                continue
            valore = _pulisci_valore(colonne[1])
            if valore is None:
                risultato.warnings.append(f"Riga {i}: valore non leggibile per reparto '{reparto}'")
                continue
            pct = None
            if len(colonne) >= 3:
                pct_val = _pulisci_valore(colonne[2])
                if pct_val is not None:
                    pct = float(pct_val)
            risultato.reparti.append(RigaReparto(reparto=reparto, valore=valore, valore_pct=pct))
            risultato.totale += valore
            risultato.n_righe += 1

    return risultato


def auto_rileva_coppia(files: list) -> Tuple[Optional[RisultatoParsing], Optional[RisultatoParsing]]:
    """Riceve una lista di (filename, raw_bytes) e restituisce (trattamenti, reparti).

    Rileva automaticamente quale file è quale dal contenuto.
    Errore se entrambi i file sono dello stesso tipo.
    """
    parsed = []
    for filename, raw in files:
        try:
            r = parse_csv(raw, filename)
            parsed.append((filename, r))
        except ValueError as e:
            raise ValueError(f"Errore nel file '{filename}': {e}")

    trattamenti = next((r for _, r in parsed if r.tipo == 'trattamenti'), None)
    reparti = next((r for _, r in parsed if r.tipo == 'reparti'), None)

    if len(parsed) == 2:
        tipi = [r.tipo for _, r in parsed]
        if tipi[0] == tipi[1]:
            raise ValueError(
                f"Entrambi i file risultano di tipo '{tipi[0]}'. "
                "Caricare un file trattamenti e un file reparti."
            )

    return trattamenti, reparti
