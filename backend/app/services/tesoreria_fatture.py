"""Fatture ricevute ↔ scadenzario Passcom (modulo Tesoreria, Fase 5, blocco B). Funzioni pure, nessun accesso DB.

**Numero in Passcom** = ultime 6 cifre del numero della fattura, senza zeri iniziali (verificato su 1.107 coppie
reali: 'BA046401' → '46401', '991/2026' → '912026', '351697231' → '697231'). Una fattura è nello scadenzario se
c'è una scadenza con lo stesso numero Passcom e la stessa data documento, di un fornitore con nome compatibile (o
già abbinato a quella partita IVA). Sui dati 2025–2026 si trovano 1.122 delle 1.143 scadenze Passcom: le altre
21 sono fatture estere (Meta, Google) che lo SDI mostra solo come autofattura.

**Stato** di una fattura (in quest'ordine, decisione dell'utente 05/11/2026 per "da registrare"):
`autofattura` (TD16–19…, non è un debito) · `in_scadenzario` (la segue Passcom) · `pagata_banca` · `pagata_manuale` ·
`pagata_carta` (fornitore pagato sempre con carta) · `da_confermare` (pagamento proposto) · `da_registrare` (ricevuta
dopo l'ultima data di registrazione dello studio − 15 giorni: debito certo non ancora registrato) · `da_verificare`
(ricevuta nei 60 giorni prima: assente da Passcom senza pagamento trovato, da guardare) · `chiusa` (più vecchia:
non più aperta in Passcom, quindi registrata e chiusa dallo studio).
"""

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from statistics import median
from typing import Optional

ZERO = Decimal("0.00")
GIORNI_MARGINE_REGISTRAZIONE = 15
GIORNI_DA_VERIFICARE = 60
GIORNI_PAGAMENTO_RIPIEGO = 30
PREFISSO_CHIAVE = "XML:"

STATI_DEBITO = ("da_registrare",)        # entrano in previsione ("da confermare" ha già un pagamento probabile in banca)
STATI_PAGATA = ("pagata_banca", "pagata_manuale", "pagata_carta")

# ModalitaPagamento FatturaPA → modalità come in Passcom (per il motore di abbinamento con la banca)
MODALITA_PASSCOM = {
    "MP12": "RIC.BANC.", "MP05": "BONIFICO", "MP19": "ADDEB. C/C", "MP20": "ADDEB. C/C", "MP21": "ADDEB. C/C",
    "MP02": "ASSEGNO", "MP01": "CONTANTI", "MP08": "CARTA", "MP09": "RID",
}
NOMI_MODALITA = {
    "MP01": "Contanti", "MP02": "Assegno", "MP05": "Bonifico", "MP08": "Carta", "MP12": "Ri.Ba.",
    "MP19": "Addebito diretto", "MP20": "Addebito diretto", "MP21": "Addebito diretto",
}
CATEGORIA_DI_MODALITA = {"RIC.BANC.": "fornitori_riba", "ADDEB. C/C": "fornitori_sdd", "ASSEGNO": "assegni"}


def numero_passcom(numero: Optional[str]) -> str:
    """Numero della fattura come lo registra Passcom: ultime 6 cifre, senza zeri iniziali."""
    return "".join(re.findall(r"\d", numero or ""))[-6:].lstrip("0")


def chiave_rata(impronta: str, numero_rata: int) -> str:
    return f"{PREFISSO_CHIAVE}{impronta}#{numero_rata}"


def limite_da_registrare(ultima_registrazione: Optional[date]) -> Optional[date]:
    return ultima_registrazione - timedelta(days=GIORNI_MARGINE_REGISTRAZIONE) if ultima_registrazione else None


def indice_passcom(scadenze) -> dict:
    """{(numero Passcom, data documento): [scadenze]} senza pareggi."""
    out = defaultdict(list)
    for s in scadenze:
        if not s.pareggio and s.numero_documento and s.data_documento:
            out[(s.numero_documento.lstrip("0"), s.data_documento)].append(s)
    return out


def trova_in_passcom(fattura, indice: dict, codice_noto: Optional[str], forza_nome) -> list:
    """Scadenze Passcom della fattura: stesso numero e data, nome compatibile o codice fornitore già noto."""
    righe = indice.get((numero_passcom(fattura.numero), fattura.data_documento), [])
    return [s for s in righe if (codice_noto and s.codice_fornitore == codice_noto)
            or forza_nome(fattura.cedente_denominazione, s.fornitore) >= 1]


def giorni_abituali(fatture_rate) -> dict:
    """{partita IVA: giorni tipici tra data documento e scadenza} dalle rate con data delle sue fatture."""
    per_piva = defaultdict(list)
    for piva, data_doc, data_scad in fatture_rate:
        if piva and data_scad and data_doc and data_scad >= data_doc:
            per_piva[piva].append((data_scad - data_doc).days)
    return {p: int(median(v)) for p, v in per_piva.items()}


@dataclass
class RataXml:
    """Rata da pagare di una fattura non registrata: stessi attributi di una scadenza Passcom per il motore."""
    chiave: str
    impronta: str
    numero_rata: int
    data_scadenza: date
    data_stimata: bool                  # scadenza assente nel file: data documento + giorni abituali
    tipo_pagamento: str                 # modalità alla Passcom (RIC.BANC., BONIFICO...)
    codice_fornitore: str               # codice Passcom se noto, altrimenti 'PIVA:...'
    fornitore: str
    importo: Decimal                    # negativo per le note di credito
    numero_documento: Optional[str]
    data_documento: Optional[date]


def rate_da_pagare(f, codice_fornitore: str, giorni: Optional[int]) -> list:
    """Rate di una fattura. Da pagare = Σ rate del file (al netto di ritenute, acconti...), altrimenti
    totale − ritenuta. Senza data di scadenza: data documento + giorni abituali del fornitore (o 30)."""
    segno = -1 if f.nota_credito else 1
    ripiego = f.data_documento + timedelta(days=giorni if giorni is not None else GIORNI_PAGAMENTO_RIPIEGO)
    rate = [r for r in f.rate if r.importo is not None]
    if not rate or len(rate) != len(f.rate):
        modalita = next((r.modalita for r in f.rate if r.modalita), None)
        data = next((r.data_scadenza for r in f.rate if r.data_scadenza), None)
        voci = [(1, modalita, data, f.totale - (f.ritenuta or ZERO))]
    else:
        voci = [(r.numero, r.modalita, r.data_scadenza, r.importo) for r in rate]
    out = []
    for numero, modalita, data, importo in voci:
        if importo == 0:
            continue
        out.append(RataXml(
            chiave=chiave_rata(f.impronta, numero), impronta=f.impronta, numero_rata=numero,
            data_scadenza=data or ripiego, data_stimata=data is None,
            # senza modalità nel file nessun canale principale: in banca si cerca con la finestra larga, da confermare
            tipo_pagamento=MODALITA_PASSCOM.get(modalita, "BONIFICO") if modalita else "NON INDICATA",
            codice_fornitore=codice_fornitore, fornitore=f.cedente_denominazione, importo=segno * abs(importo),
            numero_documento=f.numero, data_documento=f.data_documento,
        ))
    return out


def stato_fattura(f, in_passcom: bool, stati_abbinamento: set, pagata_a_mano: bool, carta: bool,
                  limite: Optional[date], oggi: date) -> str:
    """`stati_abbinamento`: stati degli abbinamenti con la banca delle rate della fattura. Ordine nel docstring."""
    if f.autofattura:
        return "autofattura"
    if in_passcom:
        return "in_scadenzario"
    if stati_abbinamento & {"automatico", "confermato"}:
        return "pagata_banca"
    if pagata_a_mano:
        return "pagata_manuale"
    if carta:
        return "pagata_carta"
    if "proposto" in stati_abbinamento:
        return "da_confermare"
    ricevuta = data_ricevuta(f)
    if limite and ricevuta >= limite:
        return "da_registrare"
    if ricevuta >= (limite or oggi) - timedelta(days=GIORNI_DA_VERIFICARE):
        return "da_verificare"
    return "chiusa"


def data_ricevuta(f) -> date:
    return f.data_ricezione.date() if f.data_ricezione else f.data_documento


def impronta_da_chiave(chiave: str) -> Optional[str]:
    if not chiave.startswith(PREFISSO_CHIAVE):
        return None
    return chiave[len(PREFISSO_CHIAVE):].rsplit("#", 1)[0]


def da_abbinare(ricevuta: date, limite: Optional[date], oggi: date) -> bool:
    """Le fatture più vecchie della finestra "da verificare" non si cercano in banca (chiuse dallo studio)."""
    return ricevuta >= (limite or oggi) - timedelta(days=GIORNI_DA_VERIFICARE)


def compensa_note(rate: list) -> list:
    """Debiti da registrare per fornitore: le note di credito riducono le rate dello stesso fornitore dalla più
    vicina; il credito che avanza si ignora (non è un incasso). Restituisce [(rata, importo residuo > 0)]."""
    per_forn = defaultdict(list)
    for r in rate:
        per_forn[r.codice_fornitore].append(r)
    out = []
    for gruppo in per_forn.values():
        credito = -sum((r.importo for r in gruppo if r.importo < 0), ZERO)
        for r in sorted((r for r in gruppo if r.importo > 0), key=lambda r: r.data_scadenza):
            usato = min(credito, r.importo)
            credito -= usato
            if r.importo - usato > 0:
                out.append((r, r.importo - usato))
    return sorted(out, key=lambda x: x[0].data_scadenza)
