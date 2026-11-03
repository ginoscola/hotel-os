"""Tesoreria — calcoli dei piani (Fase 3, blocco B): importi delle rate d'affitto, date dei ricorrenti, degli
interventi e degli addebiti carta, lettura del piano di ammortamento. Nessun accesso al DB."""

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

import xlrd

from app.services.tesoreria_calendario import primo_lavorativo
from app.services.tesoreria_parser import ErroreImportTesoreria

CENT = Decimal("0.01")
CENTO = Decimal(100)
TOLLERANZA_PERCENTUALE = Decimal("0.001")


def importi_rate(canone: Decimal, percentuali: list) -> list:
    """Importo di ogni rata in ordine. Se le percentuali fanno 100 l'ultima assorbe l'arrotondamento: il totale
    torna sempre uguale al canone."""
    importi = [(canone * p / CENTO).quantize(CENT, rounding=ROUND_HALF_UP) for p in percentuali]
    if importi and abs(sum(percentuali) - CENTO) <= TOLLERANZA_PERCENTUALE:
        importi[-1] = canone - sum(importi[:-1])
    return importi


def percentuali_effettive(percentuali: list, ultima_bloccata: bool = False) -> list:
    """Percentuali in ordine di data. Con almeno due rate l'ultima è automatica e chiude il 100%; una rata sola resta
    com'è (il resto è da pianificare), e così l'ultima se già pagata."""
    if len(percentuali) < 2 or ultima_bloccata:
        return list(percentuali)
    return [*percentuali[:-1], CENTO - sum(percentuali[:-1])]


def importi_rate_intervento(stima: Decimal, percentuali: list, fatturato: Decimal) -> list:
    """[(importo della rata, quanto ne resta da fatturare)] in ordine di data: le fatture collegate coprono prima le rate più vicine."""
    out = []
    for importo in importi_rate(stima, percentuali):
        coperto = min(importo, fatturato)
        fatturato -= coperto
        out.append((importo, importo - coperto))
    return out


def _giorno_nel_mese(anno: int, mese: int, giorno: int) -> date:
    return date(anno, mese, min(giorno, calendar.monthrange(anno, mese)[1]))


def date_ricorrente(da: date, a: date, giorno: int, mesi: list, data_da: Optional[date], data_a: Optional[date]) -> list:
    """Date lavorative del ricorrente in [da, a], rispettando il suo periodo di validità."""
    out = []
    for anno in range(da.year, a.year + 1):
        for mese in sorted(mesi):
            d = primo_lavorativo(_giorno_nel_mese(anno, mese, giorno))
            if da <= d <= a and (not data_da or d >= data_da) and (not data_a or d <= data_a):
                out.append(d)
    return out


def data_addebito_advertising(anno: int, mese: int, giorno: Optional[int]) -> date:
    """La spesa di un mese finisce nell'estratto che si addebita il mese dopo (AMEX chiude il 6 e addebita il 27,
    BCC chiude il 28 e addebita il 26 del mese dopo). Senza giorno di addebito: fine del mese dopo."""
    anno, mese = (anno, mese + 1) if mese < 12 else (anno + 1, 1)
    return primo_lavorativo(_giorno_nel_mese(anno, mese, giorno or 31))


def advertising_per_addebito(piani: list) -> dict:
    """{(anno, mese dell'addebito): importo} da [(anno, mese della spesa, importo)]: quanto degli addebiti carta
    di quel mese era advertising."""
    out = {}
    for anno, mese, importo in piani:
        chiave = (anno, mese + 1) if mese < 12 else (anno + 1, 1)
        out[chiave] = out.get(chiave, Decimal(0)) + importo
    return out


MESI_STAGIONE = (10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9)


def anno_calendario(stagione: int, mese: int) -> int:
    """Anno solare di un mese della stagione (anno alberghiero `stagione` = 1/10 dell'anno prima – 30/9)."""
    return stagione - 1 if mese >= 10 else stagione


def chiudi_totale(totale: Decimal, importi: dict) -> dict:
    """{mese: importo} con l'ultimo mese della stagione (ottobre → settembre) che prende quanto manca al totale.
    Errore se gli altri lo superano."""
    if not importi:
        return {}
    ultimo = max(importi, key=MESI_STAGIONE.index)
    altri = sum((v for k, v in importi.items() if k != ultimo), Decimal(0))
    if altri > totale:
        raise ValueError(f"I mesi prima dell'ultimo superano già il totale di {altri - totale:.2f} €")
    return {**importi, ultimo: totale - altri}


def fine_mese(primo: date) -> date:
    return _giorno_nel_mese(primo.year, primo.month, 31)


def data_addebito_carta(chiusura: date, giorno: Optional[int], oggi: date) -> date:
    """Primo `giorno` del mese dopo la chiusura dell'estratto (AMEX chiude il 6 e addebita il 27, BCC chiude il 28 e
    addebita il 26 del mese dopo). Senza giorno: 30 giorni dopo la chiusura. Mai prima di oggi."""
    if giorno is None:
        d = chiusura + timedelta(days=30)
    else:
        d = _giorno_nel_mese(chiusura.year, chiusura.month, giorno)
        if d <= chiusura:
            anno, mese = (chiusura.year, chiusura.month + 1) if chiusura.month < 12 else (chiusura.year + 1, 1)
            d = _giorno_nel_mese(anno, mese, giorno)
    return max(primo_lavorativo(d), oggi)


def normalizza_nome(testo: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (testo or "").upper())


def nome_corrisponde(controparte: str, nomi: list) -> bool:
    """I nomi configurati ('HOTEL DU PARC SNC', 'HOTEL DU PARC S.A.S.') a confronto senza punti né spazi. La banca
    tronca i nomi lunghi: basta che uno sia l'inizio dell'altro, con almeno 8 caratteri."""
    c = normalizza_nome(controparte)
    for n in map(normalizza_nome, nomi or []):
        if n and len(c) >= 8 and (c.startswith(n) or n.startswith(c)):
            return True
    return False


# ── Piano di ammortamento (.xls della banca) ──────────────────────────────────

@dataclass
class RataPiano:
    numero: int
    scadenza: date
    capitale: Decimal
    interessi: Decimal
    importo: Decimal
    residuo: Optional[Decimal]
    pagata_il: Optional[date]


def _num(testo) -> Optional[Decimal]:
    testo = str(testo or "").strip()
    return Decimal(testo.replace(".", "").replace(",", ".")) if testo else None


def parse_piano_mutuo(contenuto: bytes) -> list:
    """Foglio "Lista rate mutuo": Nr. rata, Scadenza, Capitale, Interessi, Importo, Cap. residuo, Note ("Pagata il …").
    Il residuo manca sulle rate già pagate. Controlla che capitale + interessi = importo."""
    try:
        foglio = xlrd.open_workbook(file_contents=contenuto).sheet_by_index(0)
    except Exception as e:
        raise ErroreImportTesoreria(f"File .xls non leggibile: {e}")
    intestazione = next((r for r in range(min(foglio.nrows, 10)) if str(foglio.cell_value(r, 0)).strip() == "Nr. rata"), None)
    if intestazione is None:
        raise ErroreImportTesoreria("Non sembra un piano di ammortamento: manca la colonna «Nr. rata»")
    rate = []
    for r in range(intestazione + 1, foglio.nrows):
        riga = foglio.row_values(r)
        if riga[0] in ("", None):
            continue
        try:
            nota = re.search(r"Pagata il (\d{2}/\d{2}/\d{4})", str(riga[6]))
            rata = RataPiano(
                int(float(riga[0])), datetime.strptime(str(riga[1]).strip(), "%d/%m/%Y").date(), _num(riga[2]), _num(riga[3]),
                _num(riga[4]), _num(riga[5]), datetime.strptime(nota.group(1), "%d/%m/%Y").date() if nota else None,
            )
        except (ValueError, ArithmeticError, IndexError) as e:
            raise ErroreImportTesoreria(f"Riga {r + 1} non leggibile: {e}")
        if rata.capitale + rata.interessi != rata.importo:
            raise ErroreImportTesoreria(f"Rata {rata.numero}: capitale + interessi diversi dall'importo")
        rate.append(rata)
    if not rate:
        raise ErroreImportTesoreria("Nessuna rata trovata nel piano")
    return rate
