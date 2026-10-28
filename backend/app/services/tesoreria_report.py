"""Tesoreria — calcoli della posizione attuale e del consuntivo. Funzioni pure (nessun accesso DB).

- Soglie degli avvisi di freschezza: default + valori salvati in `app_config` (chiave CHIAVE_SOGLIE).
- Fido: conteggiato nella disponibilità fino al giorno di scadenza compreso; avviso arancione nei
  giorni di preavviso, rosso da scaduto. Scadenza vuota = sempre conteggiato, nessun avviso.
- Consuntivo: entrate/uscite/netto **operativi** = categorie senza `escludi_da_operativo`; le altre
  (erogazione mutuo, giroconti…) in "non operativi". Con tutti i conti i giroconti tra conti propri
  sono tolti del tutto (le due gambe si compensano) e restituiti a parte per la quadratura:
  saldo fine − saldo inizio = netto operativo + non operativi + giroconti esclusi.
"""

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

CHIAVE_SOGLIE = "tesoreria_soglie_avvisi"
SOGLIE_DEFAULT = {
    "giorni_estratto": 7,          # ultimo estratto conto caricato più vecchio di così → avviso
    "giorni_saldo_carta": 35,      # ultimo saldo manuale di carte/prepagate più vecchio → avviso
    "giorni_preavviso_fido": 60,   # fido in scadenza entro → avviso arancione
}
ZERO = Decimal("0.00")


def valida_soglie(valori: dict) -> dict:
    """Solo chiavi note, interi tra 1 e 365. ValueError altrimenti."""
    out = {}
    for chiave, valore in (valori or {}).items():
        if chiave not in SOGLIE_DEFAULT:
            raise ValueError(f"Soglia sconosciuta: {chiave}")
        try:
            numero = int(valore)
        except (TypeError, ValueError):
            raise ValueError(f"{chiave}: numero di giorni non valido")
        if not 1 <= numero <= 365:
            raise ValueError(f"{chiave}: tra 1 e 365 giorni")
        out[chiave] = numero
    return out


def anno_prima(giorno: date) -> date:
    """Stesso giorno dell'anno precedente (29/02 → 28/02)."""
    try:
        return giorno.replace(year=giorno.year - 1)
    except ValueError:
        return giorno.replace(year=giorno.year - 1, day=28)


def stato_fido(fido: Decimal, scadenza: Optional[date], giorno: date, preavviso: int) -> dict:
    """{conteggiato, livello: None|'arancione'|'rosso', giorni_alla_scadenza}."""
    if not fido or fido <= 0:
        return {"conteggiato": False, "livello": None, "giorni_alla_scadenza": None}
    if scadenza is None:
        return {"conteggiato": True, "livello": None, "giorni_alla_scadenza": None}
    giorni = (scadenza - giorno).days
    if giorni < 0:
        return {"conteggiato": False, "livello": "rosso", "giorni_alla_scadenza": giorni}
    return {"conteggiato": True, "livello": "arancione" if giorni <= preavviso else None,
            "giorni_alla_scadenza": giorni}


def mesi_tra(da: date, a: date) -> list:
    """[(anno, mese)] dal mese di `da` a quello di `a` compresi."""
    out, anno, mese = [], da.year, da.month
    while (anno, mese) <= (a.year, a.month):
        out.append((anno, mese))
        anno, mese = (anno + 1, 1) if mese == 12 else (anno, mese + 1)
    return out


def ultimo_giorno_mese(anno: int, mese: int) -> date:
    return date(anno, mese, calendar.monthrange(anno, mese)[1])


# ── Consuntivo ──────────────────────────────────────────────────────────────────

@dataclass
class TotaliCategoria:
    n: int = 0
    entrate: Decimal = ZERO
    uscite: Decimal = ZERO

    @property
    def netto(self) -> Decimal:
        return self.entrate + self.uscite

    def aggiungi(self, importo: Decimal):
        self.n += 1
        if importo > 0:
            self.entrate += importo
        else:
            self.uscite += importo


@dataclass
class Aggregato:
    per_categoria: dict = field(default_factory=lambda: defaultdict(TotaliCategoria))
    per_mese: dict = field(default_factory=lambda: defaultdict(TotaliCategoria))   # solo operativi
    operativi: TotaliCategoria = field(default_factory=TotaliCategoria)
    non_operativi: TotaliCategoria = field(default_factory=TotaliCategoria)
    giroconti_esclusi: TotaliCategoria = field(default_factory=TotaliCategoria)


def aggrega(movimenti: list, non_operative: set, escluse: set, ripiego: Optional[int]) -> Aggregato:
    """`movimenti` = [(data, importo, categoria_id)]. `non_operative` = id categorie con
    escludi_da_operativo; `escluse` = id categorie tolte del tutto (giroconti con tutti i conti).
    Categoria NULL → `ripiego` (Da classificare)."""
    agg = Aggregato()
    for giorno, importo, cat_id in movimenti:
        cat_id = cat_id if cat_id is not None else ripiego
        if cat_id in escluse:
            agg.giroconti_esclusi.aggiungi(importo)
            continue
        agg.per_categoria[cat_id].aggiungi(importo)
        if cat_id in non_operative:
            agg.non_operativi.aggiungi(importo)
        else:
            agg.operativi.aggiungi(importo)
            agg.per_mese[(giorno.year, giorno.month)].aggiungi(importo)
    return agg


def giorno_prima(giorno: date) -> date:
    return giorno - timedelta(days=1)


# ── Carte di credito: estratto addebitato o no ─────────────────────────────────

FINESTRA_ADDEBITO_CARTA = 45   # giorni dopo la chiusura entro cui cercare l'addebito in banca


def stato_carta(chiusura: date, importo_estratto: Decimal, candidati: list, testo_addebito: Optional[str],
                giorno: date) -> dict:
    """Saldo di una carta di credito al `giorno` dato l'ultimo estratto (chiusura + importo dovuto).

    L'estratto è pagato se in banca c'è un'uscita di pari importo, dopo la chiusura, entro
    FINESTRA_ADDEBITO_CARTA giorni e non oltre `giorno`, con `testo_addebito` nella descrizione
    (se impostato). `candidati` = [(data, importo, descrizione)] dei movimenti bancari.
    Restituisce {saldo, stato: 'nessun_debito'|'da_addebitare'|'addebitato', data_addebito}.
    """
    if not importo_estratto:
        return {"saldo": ZERO, "stato": "nessun_debito", "data_addebito": None}
    limite = min(giorno, chiusura + timedelta(days=FINESTRA_ADDEBITO_CARTA))
    testo = (testo_addebito or "").strip().upper()
    for data_mov, importo, descrizione in sorted(candidati, key=lambda c: c[0]):
        if (chiusura < data_mov <= limite and importo == -importo_estratto
                and (not testo or testo in (descrizione or "").upper())):
            return {"saldo": ZERO, "stato": "addebitato", "data_addebito": data_mov}
    return {"saldo": importo_estratto, "stato": "da_addebitare", "data_addebito": None}
