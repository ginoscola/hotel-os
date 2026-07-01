"""
Import budget da file Excel.

Legge un .xlsx con colonne flessibili (mapping case-insensitive).
Restituisce lista di dict pronti per l'upsert in budget_entries.
Segnala righe non parsate con motivo.

Mapping colonne supportato:
    week_start       → 'settimana', 'week', 'data', 'dal', 'inizio'
    camere_vendute   → 'camere', 'cam.vend', 'cam. vend', 'rooms sold', 'vendute', 'cam_vend'
    occupancy        → 'occupancy%', 'occup%', 'occ%'
    adr              → 'adr', 'prezzo medio', 'tariffa media', 'prezzo_medio'
    adr_fnb          → 'adr f&b', 'adr fnb', 'f&b/cam', 'fnb/cam', 'adr_fnb'
    adr_extra        → 'adr extra', 'extra/cam', 'adr_extra'
    note             → 'note', 'notes', 'osservazioni'
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Optional

try:
    import openpyxl
    OPENPYXL_OK = True
except ImportError:
    OPENPYXL_OK = False


# ---------------------------------------------------------------------------
# Mapping nomi colonna → campo normalizzato
# ---------------------------------------------------------------------------

_MAPPING: dict[str, str] = {
    # week_start
    'settimana': 'week_start', 'week': 'week_start', 'data': 'week_start',
    'dal': 'week_start', 'inizio': 'week_start', 'week_start': 'week_start',
    # camere_vendute
    'camere': 'camere_vendute', 'cam.vend': 'camere_vendute',
    'cam. vend': 'camere_vendute', 'rooms sold': 'camere_vendute',
    'vendute': 'camere_vendute', 'cam_vend': 'camere_vendute',
    'camere_vendute': 'camere_vendute', 'rooms_sold': 'camere_vendute',
    # adr
    'adr': 'adr', 'prezzo medio': 'adr', 'tariffa media': 'adr',
    'prezzo_medio': 'adr', 'tariffa_media': 'adr',
    # adr_fnb (€ F&B per camera venduta)
    'adr f&b': 'adr_fnb', 'adr fnb': 'adr_fnb', 'f&b/cam': 'adr_fnb',
    'fnb/cam': 'adr_fnb', 'adr_fnb': 'adr_fnb', 'f&b cam': 'adr_fnb',
    # adr_extra (€ Extra per camera venduta)
    'adr extra': 'adr_extra', 'extra/cam': 'adr_extra', 'adr_extra': 'adr_extra',
    'extra cam': 'adr_extra',
    # occupancy (alternativa a camere_vendute)
    'occupancy%': 'occupancy', 'occup%': 'occupancy', 'occupancy': 'occupancy',
    '% occupancy': 'occupancy', 'occup. %': 'occupancy', 'occ%': 'occupancy',
    # note
    'note': 'note', 'notes': 'note', 'osservazioni': 'note',
}


def _normalizza_header(h: Any) -> str:
    """Normalizza un header di colonna per il lookup nel mapping."""
    return re.sub(r'\s+', ' ', str(h).strip().lower())


def _to_date(v: Any) -> Optional[date]:
    """Converte un valore cella in date; accetta datetime, date e stringhe."""
    if v is None:
        return None
    if hasattr(v, 'date'):  # datetime
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%d/%m/%y'):
        try:
            from datetime import datetime
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _to_float(v: Any) -> Optional[float]:
    """Converte un valore cella in float; accetta virgola come decimale."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(',', '.').replace('%', '').strip()
    try:
        return float(s)
    except ValueError:
        return None


def _to_int(v: Any) -> Optional[int]:
    f = _to_float(v)
    return int(round(f)) if f is not None else None


# ---------------------------------------------------------------------------
# Funzione principale
# ---------------------------------------------------------------------------

def importa_budget_excel(
    file_bytes: bytes,
    version: str = 'v1',
) -> dict:
    """
    Legge un file Excel e restituisce:
    {
        'righe': [{week_start, camere_vendute, adr, pct_fnb, pct_extra, note}, ...],
        'righe_non_parsate': [{'riga': N, 'motivo': '...', 'raw': '...'}, ...],
        'n_righe_lette': int,
        'n_righe_ok': int,
    }
    """
    if not OPENPYXL_OK:
        raise RuntimeError("openpyxl non installato — installare con: pip install openpyxl")

    import io
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb.active

    righe_dati = list(ws.iter_rows(values_only=True))
    if not righe_dati:
        return {'righe': [], 'righe_non_parsate': [], 'n_righe_lette': 0, 'n_righe_ok': 0}

    # Trova riga header (la prima con almeno 2 celle non vuote)
    header_idx = None
    campo_per_col: dict[int, str] = {}

    for i, riga in enumerate(righe_dati):
        candidati = {}
        for j, cella in enumerate(riga):
            if cella is None:
                continue
            norm = _normalizza_header(cella)
            if norm in _MAPPING:
                candidati[j] = _MAPPING[norm]
        if len(candidati) >= 2:
            header_idx = i
            campo_per_col = candidati
            break

    if header_idx is None:
        return {
            'righe': [],
            'righe_non_parsate': [{'riga': 1, 'motivo': 'Intestazione non riconosciuta', 'raw': ''}],
            'n_righe_lette': len(righe_dati),
            'n_righe_ok': 0,
        }

    righe_ok = []
    righe_non_parsate = []

    for i, riga in enumerate(righe_dati[header_idx + 1:], start=header_idx + 2):
        # Salta righe completamente vuote
        if all(v is None for v in riga):
            continue

        row_dict: dict[str, Any] = {}
        for col_idx, campo in campo_per_col.items():
            if col_idx < len(riga):
                row_dict[campo] = riga[col_idx]

        # week_start obbligatorio
        ws_val = _to_date(row_dict.get('week_start'))
        if ws_val is None:
            righe_non_parsate.append({
                'riga': i,
                'motivo': 'Data settimana mancante o non parsabile',
                'raw': str(row_dict.get('week_start', '')),
            })
            continue

        righe_ok.append({
            'week_start': ws_val,
            'camere_vendute': _to_int(row_dict.get('camere_vendute')),
            'occupancy': _to_float(row_dict.get('occupancy')),
            'adr': _to_float(row_dict.get('adr')),
            'adr_fnb': _to_float(row_dict.get('adr_fnb')),
            'adr_extra': _to_float(row_dict.get('adr_extra')),
            'note': str(row_dict['note']).strip() if row_dict.get('note') else None,
            'version': version,
        })

    return {
        'righe': righe_ok,
        'righe_non_parsate': righe_non_parsate,
        'n_righe_lette': len(righe_dati) - header_idx - 1,
        'n_righe_ok': len(righe_ok),
    }
