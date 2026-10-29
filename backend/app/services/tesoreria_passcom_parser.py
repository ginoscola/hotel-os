"""Parser dello scadenzario fornitori Passcom (stampa "Scadenzario fornitori", modulo SCADDOC, export Excel).

Formato: XML **SpreadsheetML 2003** (`<?mso-application progid="Excel.Sheet"?>`), encoding windows-1252,
foglio `-Scaddoc`. Non è un xlsx. Le celle hanno `ss:Index` espliciti (le colonne vuote mancano):
si legge per indice di colonna, mai per posizione.

Righe (colonne verificate sul file reale, 28/10/2026):
- intestazione: 1='Azienda:', 2=azienda, 3='Data di Stampa:', 4=gg/mm/aaaa;
- gruppo: 1='Data Scadenza', 2=gg/mm/aaaa → data delle righe di dettaglio che seguono;
- dettaglio (colonne 13–15): 5=tipo pagamento (RIMESSA, RIC.BANC., ADDEB. C/C, BONIFICO, CONTANTI o
  `*PAREGGIO*`), 6=tipo documento (FR, NR, PG, ...; assente nei pareggi), 7=registro IVA (1 Italia,
  8 estero), 9=numero documento, 10=data documento gg/mm/aa, 11=data registrazione gg/mm/aa,
  12=protocollo (es. 'A01/001900 44846'; assente nei pareggi), 13=codice conto fornitore, 14=ragione
  sociale, 15=importo con punto decimale (note di credito e pareggi già con il segno);
- descrizione: 2='DESCRIZIONE TESTATA:', 3=testo → appartiene alla scadenza precedente;
- totale: 13='Totale', 14=importo → quadratura con la somma delle righe (±0,01), altrimenti errore.
Le righe con la sola colonna 4 (e la colonna 4 delle righe di descrizione) sono il resto della ragione
sociale andato a capo nella stampa: la colonna 14 è già completa, quindi si ignorano.

Il file deve essere quello "da pagare" (stato rata vuoto). Lo scadenzario delle rate pagate (colonna 4 =
'P', colonna 3 = data pagamento) viene rifiutato: servirà in Fase 4.

`chiave` di una scadenza = codice fornitore | protocollo | data scadenza | importo (+ '#n' dalla seconda
occorrenza identica nello stesso file, per i pareggi senza protocollo).

Funzioni pure (nessun accesso DB): `parse_scadenzario(contenuto: bytes)`.
"""

from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional
from xml.etree import ElementTree as ET

from app.services.tesoreria_parser import ErroreImportTesoreria

NS = "urn:schemas-microsoft-com:office:spreadsheet"
FOGLIO = "-Scaddoc"
PAREGGIO = "*PAREGGIO*"
TOLLERANZA = Decimal("0.01")


@dataclass
class ScadenzaPasscom:
    chiave: str
    data_scadenza: date
    tipo_pagamento: str
    pareggio: bool
    tipo_documento: Optional[str]
    registro: Optional[str]
    numero_documento: Optional[str]
    data_documento: Optional[date]
    data_registrazione: Optional[date]
    protocollo: Optional[str]
    codice_fornitore: str
    fornitore: str
    importo: Decimal
    descrizione: Optional[str] = None


@dataclass
class RisultatoScadenzario:
    azienda: Optional[str]
    data_stampa: Optional[date]
    scadenze: list                      # [ScadenzaPasscom], nell'ordine del file
    totale: Decimal                     # totale dichiarato nel file (= somma delle righe)
    avvisi: list = field(default_factory=list)

    @property
    def scadenza_da(self) -> Optional[date]:
        return min((s.data_scadenza for s in self.scadenze), default=None)

    @property
    def scadenza_a(self) -> Optional[date]:
        return max((s.data_scadenza for s in self.scadenze), default=None)


# ── Utility ────────────────────────────────────────────────────────────────────

def _celle(riga) -> dict:
    """{indice colonna: testo} della riga, rispettando `ss:Index` (le celle vuote mancano)."""
    out, indice = {}, 0
    for cella in riga.findall(f"{{{NS}}}Cell"):
        esplicito = cella.get(f"{{{NS}}}Index")
        indice = int(esplicito) if esplicito else indice + 1
        dato = cella.find(f"{{{NS}}}Data")
        if dato is not None and dato.text is not None and dato.text.strip() != "":
            out[indice] = dato.text
    return out


def _data(valore: Optional[str], contesto: str) -> Optional[date]:
    """'gg/mm/aaaa' o 'gg/mm/aa' (anni a due cifre = 2000+)."""
    if not valore or not valore.strip():
        return None
    try:
        g, m, a = (int(x) for x in valore.strip().split("/"))
        return date(a + 2000 if a < 100 else a, m, g)
    except (ValueError, TypeError):
        raise ErroreImportTesoreria(f"Data non valida ({contesto}): {valore!r}")


def _importo(valore: Optional[str], contesto: str) -> Decimal:
    """Importo con punto decimale ('-150.00'); accetta anche il formato italiano '1.234,56'."""
    testo = (valore or "").strip()
    if "," in testo:
        testo = testo.replace(".", "").replace(",", ".")
    try:
        return Decimal(testo).quantize(TOLLERANZA)
    except InvalidOperation:
        raise ErroreImportTesoreria(f"Importo non valido ({contesto}): {valore!r}")


def _pulito(valore: Optional[str]) -> Optional[str]:
    if valore is None:
        return None
    testo = " ".join(valore.split())
    return testo or None


# ── Parser ─────────────────────────────────────────────────────────────────────

def parse_scadenzario(contenuto: bytes) -> RisultatoScadenzario:
    try:
        radice = ET.fromstring(contenuto)
    except ET.ParseError as e:
        raise ErroreImportTesoreria(f"File non leggibile come XML: {e}")
    if radice.tag != f"{{{NS}}}Workbook":
        raise ErroreImportTesoreria("Il file non è uno scadenzario Passcom (esportazione Excel XML).")
    foglio = next((w for w in radice.findall(f"{{{NS}}}Worksheet") if w.get(f"{{{NS}}}Name") == FOGLIO), None)
    if foglio is None:
        raise ErroreImportTesoreria(
            f"Foglio '{FOGLIO}' non trovato: il file non è lo scadenzario fornitori di Passcom (modulo SCADDOC).")

    azienda = data_stampa = None
    data_scadenza = None
    totale_file = None
    scadenze: list = []
    occorrenze: Counter = Counter()
    ignorate = 0

    for n_riga, riga in enumerate(foglio.iter(f"{{{NS}}}Row"), start=1):
        c = _celle(riga)
        if not c:
            continue
        contesto = f"riga {riga.get(f'{{{NS}}}Index') or n_riga}"

        if c.get(1) == "Azienda:":
            azienda = _pulito(c.get(2))
            if c.get(3) == "Data di Stampa:":
                data_stampa = _data(c.get(4), contesto)
        elif c.get(1) == "Data Scadenza" and 2 in c:
            data_scadenza = _data(c[2], contesto)
        elif c.get(13) == "Totale":
            totale_file = _importo(c.get(14), contesto)
        elif c.get(2) == "DESCRIZIONE TESTATA:":
            testo = _pulito(c.get(3))
            if testo and scadenze:
                prec = scadenze[-1]
                prec.descrizione = f"{prec.descrizione} {testo}" if prec.descrizione else testo
        elif 15 in c and 14 in c:
            if c.get(4, "").strip() or c.get(3, "").strip():
                raise ErroreImportTesoreria(
                    "Il file contiene rate già pagate (colonna Stato/Data pag valorizzata): caricare lo "
                    "scadenzario delle sole rate da pagare (stato rata vuoto).")
            if data_scadenza is None:
                raise ErroreImportTesoreria(f"Riga di scadenza prima di qualsiasi 'Data Scadenza' ({contesto}).")
            tipo_pag = _pulito(c.get(5))
            codice = _pulito(c.get(13))
            if not tipo_pag or not codice:
                raise ErroreImportTesoreria(f"Tipo pagamento o codice fornitore mancante ({contesto}).")
            importo = _importo(c[15], contesto)
            protocollo = _pulito(c.get(12))
            base = f"{codice}|{protocollo or ''}|{data_scadenza.isoformat()}|{importo}"
            occorrenze[base] += 1
            chiave = base if occorrenze[base] == 1 else f"{base}#{occorrenze[base]}"
            scadenze.append(ScadenzaPasscom(
                chiave=chiave, data_scadenza=data_scadenza, tipo_pagamento=tipo_pag,
                pareggio=tipo_pag == PAREGGIO, tipo_documento=_pulito(c.get(6)), registro=_pulito(c.get(7)),
                numero_documento=_pulito(c.get(9)), data_documento=_data(c.get(10), contesto),
                data_registrazione=_data(c.get(11), contesto), protocollo=protocollo,
                codice_fornitore=codice, fornitore=_pulito(c[14]), importo=importo,
            ))
        elif set(c) <= {4}:
            continue                    # resto della ragione sociale andato a capo
        elif c.get(1) in ("Ordine:", "Data pag", "Scadenzario Fornitori", "Fine Stampa"):
            continue                    # intestazioni della stampa
        else:
            ignorate += 1

    if totale_file is None:
        raise ErroreImportTesoreria("Riga 'Totale' non trovata: il file sembra incompleto.")
    if not scadenze:
        raise ErroreImportTesoreria("Nessuna scadenza trovata nel file.")
    somma = sum((s.importo for s in scadenze), Decimal("0"))
    if abs(somma - totale_file) > TOLLERANZA:
        raise ErroreImportTesoreria(
            f"Il totale del file ({totale_file}) non coincide con la somma delle scadenze ({somma}).")

    avvisi = []
    if ignorate:
        avvisi.append(f"{ignorate} righe non riconosciute ignorate.")
    if data_stampa is None:
        avvisi.append("Data di stampa non trovata nell'intestazione.")
    return RisultatoScadenzario(azienda=azienda, data_stampa=data_stampa, scadenze=scadenze,
                                totale=totale_file, avvisi=avvisi)
