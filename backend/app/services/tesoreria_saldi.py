"""Saldi dei conti: saldo a una data qualsiasi e verifica di coerenza tra saldi noti e movimenti.

Saldo = saldo a fine giornata per data contabile. Si parte dal saldo noto più vicino: il più recente
non successivo alla data (in avanti: + movimenti), altrimenti il primo successivo (all'indietro:
− movimenti).

Funzioni pure (nessun accesso DB): saldi come {date: Decimal}, movimenti come [(date, Decimal)].
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional


@dataclass
class Discrepanza:
    data_da: date                       # saldo noto di partenza
    data_a: date                        # saldo noto successivo
    saldo_da: Decimal
    saldo_a: Decimal
    movimenti: Decimal                  # somma dei movimenti in (data_da, data_a]

    @property
    def differenza(self) -> Decimal:
        """Quanto manca ai movimenti per tornare: ≠ 0 = file o periodo mancante."""
        return self.saldo_a - self.saldo_da - self.movimenti


def _somma(movimenti: list, dopo: date, fino_a: date) -> Decimal:
    return sum((imp for d, imp in movimenti if dopo < d <= fino_a), Decimal("0.00"))


def saldo_a_data(giorno: date, saldi: dict, movimenti: list) -> Optional[Decimal]:
    """Saldo a fine giornata di `giorno`. None se non c'è nessun saldo noto."""
    if not saldi:
        return None
    precedenti = [d for d in saldi if d <= giorno]
    if precedenti:
        base = max(precedenti)
        return saldi[base] + _somma(movimenti, base, giorno)
    base = min(saldi)
    return saldi[base] - _somma(movimenti, giorno, base)


def verifica_saldi(saldi: dict, movimenti: list) -> list:
    """Coppie di saldi noti consecutivi che non tornano con i movimenti in mezzo."""
    date_ordinate = sorted(saldi)
    errori = []
    for da, a in zip(date_ordinate, date_ordinate[1:]):
        mov = _somma(movimenti, da, a)
        if saldi[a] - saldi[da] != mov:
            errori.append(Discrepanza(da, a, saldi[da], saldi[a], mov))
    return errori
