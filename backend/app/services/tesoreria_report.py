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


# ── KPI ─────────────────────────────────────────────────────────────────────────

def serie_saldi(saldi_per_conto: list, da: date, a: date) -> dict:
    """{giorno: saldo totale} dal `da` all'`a` sommando i conti; ogni conto ha i saldi a fine giornata
    dei giorni con movimenti ({data: Decimal}) e tiene il valore fino al saldo noto successivo.
    Prima del primo saldo noto un conto vale 0 se è nato a zero (es. conto POS aperto ad aprile 2025),
    altrimenti il giorno è None (dato mancante)."""
    stati = []
    for saldi in saldi_per_conto:
        date_note = sorted(saldi)
        stati.append({"date": date_note, "saldi": saldi, "i": 0, "corrente": None})
    serie = {}
    giorno = da
    while giorno <= a:
        totale, mancante = ZERO, False
        for st in stati:
            while st["i"] < len(st["date"]) and st["date"][st["i"]] <= giorno:
                st["corrente"] = st["saldi"][st["date"][st["i"]]]
                st["i"] += 1
            if st["corrente"] is not None:
                totale += st["corrente"]
            elif st["date"] and st["saldi"][st["date"][0]] == 0:
                continue
            elif st["date"]:
                mancante = True
        serie[giorno] = None if mancante else totale
        giorno += timedelta(days=1)
    return serie


def minimo_serie(serie: dict) -> Optional[tuple]:
    """(giorno, saldo) del saldo più basso; a parità il primo giorno. None se non ci sono dati."""
    validi = [(g, v) for g, v in sorted(serie.items()) if v is not None]
    return min(validi, key=lambda x: x[1]) if validi else None


def inverno_di_riferimento(oggi: date) -> tuple:
    """Ultimo periodo senza stagione completo (1 ottobre – 30 aprile) prima di `oggi`."""
    anno_fine = oggi.year if oggi >= date(oggi.year, 5, 1) else oggi.year - 1
    return date(anno_fine - 1, 10, 1), date(anno_fine, 4, 30)


def mesi_di_autonomia(liquidita: Decimal, netti_mensili: list) -> Optional[dict]:
    """Per quanti mesi la liquidità copre il consumo medio di cassa dei mesi senza stagione
    (media dei netti operativi mensili, negativi = consumo). None se in quei mesi la cassa non cala."""
    if not netti_mensili:
        return None
    consumo = -sum(netti_mensili, ZERO) / len(netti_mensili)
    if consumo <= 0:
        return None
    return {"consumo_mensile": consumo, "mesi": liquidita / consumo if liquidita > 0 else ZERO}


# ── Tassa di soggiorno per trimestre ───────────────────────────────────────────

TRIMESTRI = ((1, 2, 3), (4, 5, 6), (7, 8, 9), (10, 11, 12))


def tassa_per_trimestre(incassata: dict, versamenti: list, anno: int, oggi: date) -> dict:
    """Tassa di soggiorno incassata e versata per trimestre (il Comune si paga a trimestre).

    `incassata` = {mese: Decimal} dell'anno; `versamenti` = [(data, importo positivo)] dal 1/4
    dell'anno al 31/3 dell'anno dopo: un versamento vale per il trimestre **precedente** a quello in
    cui è fatto (aprile–giugno si versa a luglio). Stato del trimestre: 'aperto' (non ancora finito),
    'versato', 'da_versare' (finito, incassato e senza versamento), 'nessuna' (niente incassato).
    "Da versare" = incassato dei trimestri aperti o non versati; "scarto" = incassato − versato dei
    trimestri versati (documenti per data di check-out vs presenze dichiarate, esenzioni, rettifiche).
    """
    versati = defaultdict(lambda: ZERO)
    date_versamento = defaultdict(list)
    for giorno, importo in versamenti:
        indice = (giorno.month - 1) // 3 - 1          # trimestre precedente
        anno_rif = giorno.year
        if indice < 0:
            indice, anno_rif = 3, giorno.year - 1
        if anno_rif != anno:
            continue
        versati[indice] += importo
        date_versamento[indice].append(giorno)

    righe, da_versare, scarto = [], ZERO, ZERO
    for i, mesi in enumerate(TRIMESTRI):
        inc = sum((incassata.get(m, ZERO) for m in mesi), ZERO)
        ver = versati.get(i, ZERO)
        fine_trimestre = ultimo_giorno_mese(anno, mesi[-1])
        if ver:
            stato = "versato"
            scarto += inc - ver
        elif oggi <= fine_trimestre:
            stato = "aperto" if inc else "nessuna"
        else:
            stato = "da_versare" if inc else "nessuna"
        if stato in ("aperto", "da_versare"):
            da_versare += inc
        righe.append({"trimestre": i + 1, "mesi": mesi, "incassata": inc, "versata": ver, "stato": stato,
                      "date_versamento": sorted(date_versamento.get(i, [])),
                      "scarto": inc - ver if stato == "versato" else None})
    return {"trimestri": righe, "da_versare": da_versare, "scarto": scarto}
