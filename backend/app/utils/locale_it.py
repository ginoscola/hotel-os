"""Costanti e funzioni di localizzazione italiana condivise in tutto il backend."""

from datetime import date
from typing import Optional


MESI_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]

GIORNI_IT = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"]


def formatta_data_it(d: Optional[date]) -> Optional[str]:
    """Formatta una data come '5 mag 2026'. Restituisce None se d è None."""
    if d is None:
        return None
    return f"{d.day} {MESI_IT[d.month - 1]} {d.year}"
