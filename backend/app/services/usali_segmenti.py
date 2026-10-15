"""Assegnazione delle righe USALI contabili ai segmenti (es. Hotel / Maremosso), in lettura.

Le regole (`usali_regola_segmento`) non vengono mai applicate in fase di import: cambiandole,
tutto lo storico viene risegmentato senza reimportare nulla.

Algoritmo per ogni riga: tra le regole della sua struttura, valide nel suo anno-mese e che la
intercettano, si tengono solo quelle con la priorità più alta; le loro percentuali devono
sommare a 100 (ripartizione di costi condivisi, es. utenze 70/30). Righe senza regole o con
somma ≠ 100 → errore esplicito, mai scartate in silenzio.

Le righe possono essere oggetti (UsaliRiga) o dict con le stesse chiavi.
"""

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

QUANTO = Decimal("0.0001")


@dataclass
class QuotaSegmento:
    riga: object
    segmento_id: int
    importo: Decimal


@dataclass
class ErroreSegmento:
    riga: object
    motivo: str


def _attr(riga, nome):
    return riga[nome] if isinstance(riga, dict) else getattr(riga, nome)


def _periodo(anno: int, mese: int) -> str:
    return f"{anno:04d}-{mese:02d}"


def _regola_attr(regola, nome):
    return regola[nome] if isinstance(regola, dict) else getattr(regola, nome)


def regola_intercetta(regola, riga) -> bool:
    tipo = _regola_attr(regola, "tipo_match")
    pattern = (_regola_attr(regola, "pattern") or "").strip()

    if tipo == "percorso_prefisso":
        # Sotto-percorso contiguo, case-insensitive: 'Food & Beverage > Ristorante' intercetta
        # sia i ricavi sia i costi di quel reparto. Pattern vuoto = tutto (regola catch-all).
        if not pattern:
            return True
        cercato = [p.strip().lower() for p in pattern.split(">")]
        percorso = [str(p).lower() for p in _attr(riga, "percorso")]
        n = len(cercato)
        return any(percorso[i:i + n] == cercato for i in range(len(percorso) - n + 1))
    if tipo == "id_conti":
        v = _attr(riga, "id_conti")
        return v is not None and str(v) == pattern
    if tipo == "id_reparto":
        v = _attr(riga, "id_reparto")
        return v is not None and str(v) == pattern
    if tipo == "nome_contiene":
        return bool(pattern) and pattern.lower() in str(_attr(riga, "conto_nome")).lower()
    raise ValueError(f"tipo_match sconosciuto: {tipo}")


def _valida(regola, periodo: str) -> bool:
    dal = _regola_attr(regola, "valida_dal") or "0000-00"
    al = _regola_attr(regola, "valida_al")
    return dal <= periodo and (al is None or periodo <= al)


def assegna_segmenti(righe, regole) -> tuple:
    """→ (quote: list[QuotaSegmento], errori: list[ErroreSegmento]).

    La somma delle quote di una riga è sempre esattamente il suo importo (l'arrotondamento
    della ripartizione va sull'ultima quota).
    """
    per_struttura = {}
    for regola in regole:
        per_struttura.setdefault(_regola_attr(regola, "struttura_code"), []).append(regola)

    quote, errori = [], []
    for riga in righe:
        periodo = _periodo(_attr(riga, "anno"), _attr(riga, "mese"))
        candidate = [
            r for r in per_struttura.get(_attr(riga, "struttura_code"), [])
            if _valida(r, periodo) and regola_intercetta(r, riga)
        ]
        if not candidate:
            errori.append(ErroreSegmento(riga, "nessuna regola di segmento la intercetta"))
            continue
        top = max(_regola_attr(r, "priorita") for r in candidate)
        vincenti = [r for r in candidate if _regola_attr(r, "priorita") == top]
        somma_pct = sum(Decimal(str(_regola_attr(r, "percentuale"))) for r in vincenti)
        if somma_pct != Decimal("100"):
            errori.append(ErroreSegmento(
                riga, f"le regole con priorità {top} sommano a {somma_pct}% invece di 100%"
            ))
            continue

        importo = Decimal(str(_attr(riga, "importo")))
        residuo = importo
        for i, r in enumerate(vincenti):
            if i == len(vincenti) - 1:
                parte = residuo
            else:
                pct = Decimal(str(_regola_attr(r, "percentuale")))
                parte = (importo * pct / 100).quantize(QUANTO, rounding=ROUND_HALF_UP)
                residuo -= parte
            quote.append(QuotaSegmento(riga, _regola_attr(r, "segmento_id"), parte))
    return quote, errori
