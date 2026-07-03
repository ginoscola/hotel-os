"""Costanti e helper condivisi tra i sotto-router del modulo Corrispettivi
(corrispettivi_import.py, corrispettivi_documenti.py, corrispettivi_report.py,
corrispettivi_rt.py) e dall'aggregatore corrispettivi.py.

Nessun endpoint qui: solo dati puri, per evitare import circolari tra i sotto-router.
"""
from decimal import Decimal
from typing import List

STRUTTURE_HOTEL: List[str] = ['DPH', 'CLB', 'INT']
STRUTTURE_MANUALI: List[str] = ['MMS', 'BON']
STRUTTURE_ORDINE: List[str] = STRUTTURE_HOTEL + STRUTTURE_MANUALI

NOME_STRUTTURA = {
    'DPH': 'Hotel Du Parc',
    'CLB': 'Club Hotel',
    'INT': 'Hotel International',
    'MMS': 'Maremosso',
    'BON': 'Buona Onda',
}

CATEGORIE: List[str] = ['arrangiamenti', 'tassa_soggiorno', 'penali', 'shop', 'altro']

IVA_MANUALI_PCT = 10.0


def _to_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _d(v) -> Decimal:
    try:
        f = float(v or 0)
        if f != f:  # NaN
            f = 0.0
        return Decimal(str(round(f, 2)))
    except (TypeError, ValueError):
        return Decimal('0')
