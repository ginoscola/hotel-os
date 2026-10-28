"""Classificazione dei movimenti bancari con le regole di `tesoreria_regole`.

Vince la prima regola attiva (in ordine di priorità) che corrisponde; nessuna → None (il chiamante
assegna "Da classificare"). La categoria assegnata a mano su un movimento non passa di qui.

Funzioni pure (nessun accesso DB): le regole arrivano come `RegolaClassificazione`.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from app.services.tesoreria_parser import normalizza


@dataclass
class RegolaClassificazione:
    categoria_id: int
    campo: str                          # 'descrizione' | 'controparte'
    operatore: str                      # 'inizia' | 'contiene'
    valori: list
    valori_anche: Optional[list] = None
    segno: str = "entrambi"             # 'entrata' | 'uscita' | 'entrambi'
    priorita: int = 0

    @classmethod
    def da_modello(cls, r) -> "RegolaClassificazione":
        return cls(categoria_id=r.categoria_id, campo=r.campo, operatore=r.operatore,
                   valori=list(r.valori or []), valori_anche=list(r.valori_anche or []) or None,
                   segno=r.segno, priorita=r.priorita)


def corrisponde(regola: RegolaClassificazione, descrizione: str, controparte: str, importo: Decimal) -> bool:
    if regola.segno == "entrata" and importo <= 0:
        return False
    if regola.segno == "uscita" and importo >= 0:
        return False
    testo = normalizza(controparte if regola.campo == "controparte" else descrizione)
    if not testo:
        return False
    valori = [v.upper() for v in regola.valori if v]
    if regola.operatore == "inizia":
        if not any(testo.startswith(v) for v in valori):
            return False
    elif not any(v in testo for v in valori):
        return False
    if regola.valori_anche:
        return any(v.upper() in testo for v in regola.valori_anche if v)
    return True


def classifica(descrizione: str, controparte: str, importo: Decimal, regole: list) -> Optional[int]:
    """Categoria della prima regola che corrisponde. `regole` già filtrate (attive) e ordinate."""
    for regola in regole:
        if corrisponde(regola, descrizione, controparte, importo):
            return regola.categoria_id
    return None
