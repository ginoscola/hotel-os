"""Tesoreria — stima dell'IVA mensile da vendite e acquisti (Fase 5, blocco C). Funzioni pure, nessun accesso DB.

Liquidazione del mese = IVA sulle vendite − IVA sugli acquisti + credito riportato dal mese prima; si versa il 16 del
mese dopo solo se positiva (sotto 25,82 € il versamento passa al mese dopo), altrimenti il credito passa al mese dopo.
Ogni gennaio si riparte da zero: il credito dell'anno prima esce con la dichiarazione e si usa in F24 (tranche del
calendario fiscale, inserite a mano).

- Vendite: Corrispettivi (scontrini, fatture Welcome, incassi Mare Mosso e Buona Onda). Caparre ed estratti conto di
  Welcome restano fuori: non sono documenti fiscali (verificato: IVA degli scontrini di agosto 2026 = IVA trasmessa
  dalle stampanti fiscali, 61.073 € contro 61.054 €).
- Acquisti: fatture ricevute dallo SDI, nel **mese di ricezione** (la regola "ricevuta entro il 15 del mese dopo → mese
  prima" torna peggio con il versato reale), note di credito in meno, autofatture escluse (IVA a debito e a credito).

Collaudo sul 2026: gennaio–luglio a credito ✓, agosto 7.811 € contro 5.281,61 € versati, settembre a credito ✓. Sul
2025 l'IVA delle fatture SDI (autofatture comprese) è 235.549 € contro 258.352 € detraibili in dichiarazione: ~9% di
acquisti con IVA fuori dallo SDI, quindi la stima tende a sopravvalutare il dovuto.

Scelta dell'utente (05/11/2026, opzione 1): la stima dai dati vale solo per i **mesi conclusi con dati completi**; i
mesi futuri restano come prima (agosto = ultimo agosto versato, gli altri a credito).
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

ZERO = Decimal("0.00")
SOGLIA_VERSAMENTO = Decimal("25.82")
GIORNI_MARGINE_FATTURE = 3          # mese di acquisti completo se l'ultima fattura è arrivata da 3 giorni prima della fine
TIPI_AUTOFATTURA_IVA = ("TD16", "TD17", "TD18", "TD19", "TD20", "TD21", "TD22", "TD23", "TD26", "TD27", "TD28")
TIPI_NOTA = ("TD04", "TD08")


def fine_mese(y: int, m: int) -> date:
    return (date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)) - timedelta(days=1)


def iva_acquisti_per_mese(fatture) -> dict:
    """`fatture`: [(tipo documento, imposta, giorno di ricezione)]. {(anno, mese): IVA detraibile}."""
    out = {}
    for tipo, imposta, ricevuta in fatture:
        if tipo in TIPI_AUTOFATTURA_IVA or imposta is None:
            continue
        chiave = (ricevuta.year, ricevuta.month)
        out[chiave] = out.get(chiave, ZERO) + (-imposta if tipo in TIPI_NOTA else imposta)
    return out


def acquisti_completi(y: int, m: int, ultima_ricezione: Optional[date], oggi: date) -> bool:
    fine = fine_mese(y, m)
    return fine < oggi and ultima_ricezione is not None and ultima_ricezione >= fine - timedelta(days=GIORNI_MARGINE_FATTURE)


def vendite_complete(y: int, m: int, vendite_lorde: Decimal, in_stagione: bool, oggi: date) -> bool:
    """Mese concluso; se è in stagione deve avere incassi (altrimenti i Corrispettivi non sono ancora stati importati)."""
    return fine_mese(y, m) < oggi and (not in_stagione or vendite_lorde > 0)


@dataclass
class MeseIva:
    anno: int
    mese: int
    vendite: Optional[Decimal]          # IVA sulle vendite (None se manca il dato)
    acquisti: Optional[Decimal]         # IVA sugli acquisti
    completo: bool                      # dati del mese completi
    credito_precedente: Optional[Decimal] = None   # ≤ 0: credito riportato dal mese prima (> 0: versamento rinviato)
    saldo: Optional[Decimal] = None
    versamento: Optional[Decimal] = None
    credito_dopo: Optional[Decimal] = None

    @property
    def scadenza(self) -> date:
        return date(self.anno + 1, 1, 16) if self.mese == 12 else date(self.anno, self.mese + 1, 16)


def liquidazioni(anno: int, vendite: dict, acquisti: dict, completi: set) -> list:
    """12 mesi dell'anno. La catena si ferma al primo mese non completo: da lì in poi niente stima (il credito
    riportato non sarebbe noto)."""
    out, riporto, catena = [], ZERO, True
    for m in range(1, 13):
        v, a = vendite.get((anno, m)), acquisti.get((anno, m))
        completo = (anno, m) in completi
        riga = MeseIva(anno, m, v, a, completo)
        catena = catena and completo
        if catena:
            saldo = (v or ZERO) - (a or ZERO) + riporto
            riga.credito_precedente, riga.saldo = riporto, saldo
            if saldo > SOGLIA_VERSAMENTO:
                riga.versamento, riporto = saldo, ZERO
            else:
                riga.versamento, riporto = ZERO, saldo
            riga.credito_dopo = riporto
        out.append(riga)
    return out


def credito_fine_anno(righe: list) -> Optional[Decimal]:
    """Credito a dicembre (positivo) se la catena arriva a fine anno, altrimenti None."""
    if not righe or righe[-1].credito_dopo is None:
        return None
    return max(-righe[-1].credito_dopo, ZERO)
