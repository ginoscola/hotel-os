"""Lettura del foglio "Storico" del file `Storico_fatturato_WAVE_2022-2025.xlsx` (indice WAVE).

Una riga per struttura × anno × mese; il dato importato è la colonna "Netto (€, IVA esclusa, senza tassa)".
Colonne cercate per intestazione (non per posizione). Righe ignorate con avviso: struttura sconosciuta, anni da
`PRIMO_ANNO_HOTELOS` in poi (letti dai Corrispettivi, mai dallo storico), mesi fuori da aprile–settembre, netto
vuoto. La riga di legenda in fondo (senza anno né mese) è ignorata senza avviso.
"""

import io
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Optional

import openpyxl

from app.services.wave import MESI_WAVE
from app.utils.locale_it import MESI_IT

FOGLIO = "Storico"
STRUTTURE = ('DPH', 'CLB', 'INT', 'MMS', 'BON')
PRIMO_ANNO_HOTELOS = 2026

# chiave → prefisso dell'intestazione (minuscolo)
COLONNE = {
    'struttura': 'struttura',
    'anno': 'anno',
    'mese': 'mese',
    'lordo': 'lordo totale',
    'tassa': 'tassa di soggiorno',
    'netto': 'netto',
    'metodo': 'metodo',
    'fonte': 'fonte',
    'note': 'note',
}
OBBLIGATORIE = ('struttura', 'anno', 'mese', 'netto')


class ErroreImportWave(ValueError):
    pass


@dataclass
class RigaStorico:
    struttura_code: str
    anno: int
    mese: int
    netto: Decimal
    lordo: Optional[Decimal]
    tassa_soggiorno: Optional[Decimal]
    metodo: Optional[str]
    fonte: Optional[str]
    note: Optional[str]


def _decimale(v, decimali: int) -> Optional[Decimal]:
    if v is None or v == '':
        return None
    try:
        return Decimal(str(v)).quantize(Decimal(1).scaleb(-decimali))
    except InvalidOperation:
        raise ErroreImportWave(f"Valore numerico non valido: {v!r}")


def _testo(v) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _mese(v) -> Optional[int]:
    if isinstance(v, (int, float)) and 1 <= int(v) <= 12:
        return int(v)
    s = (_testo(v) or '').lower()[:3]
    return MESI_IT.index(s) + 1 if s in MESI_IT else None


def parse_storico(contenuto: bytes) -> tuple[list[RigaStorico], list[str]]:
    """→ (righe, avvisi). Errore bloccante se il foglio o le colonne obbligatorie mancano, o se una stessa
    struttura/anno/mese compare due volte."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(contenuto), data_only=True, read_only=True)
    except Exception:
        raise ErroreImportWave("Il file non è un Excel (.xlsx) leggibile")
    if FOGLIO not in wb.sheetnames:
        raise ErroreImportWave(f"Foglio \"{FOGLIO}\" non trovato nel file")
    righe_xls = list(wb[FOGLIO].iter_rows(values_only=True))
    if not righe_xls:
        raise ErroreImportWave(f"Il foglio \"{FOGLIO}\" è vuoto")

    intestazione = [(_testo(c) or '').lower() for c in righe_xls[0]]
    indici = {}
    for chiave, prefisso in COLONNE.items():
        for i, nome in enumerate(intestazione):
            if nome.startswith(prefisso) and i not in indici.values():
                indici[chiave] = i
                break
    mancanti = [c for c in OBBLIGATORIE if c not in indici]
    if mancanti:
        raise ErroreImportWave(f"Colonne mancanti nel foglio \"{FOGLIO}\": {', '.join(mancanti)}")

    def cella(riga, chiave):
        i = indici.get(chiave)
        return riga[i] if i is not None and i < len(riga) else None

    righe, avvisi, viste = [], [], set()
    for n, riga in enumerate(righe_xls[1:], start=2):
        anno_v, mese_v = cella(riga, 'anno'), cella(riga, 'mese')
        if anno_v is None and mese_v is None:
            continue                                    # riga vuota o legenda
        struttura = (_testo(cella(riga, 'struttura')) or '').upper()
        rif = f"Riga {n}"
        if struttura not in STRUTTURE:
            avvisi.append(f"{rif}: struttura \"{struttura}\" sconosciuta, ignorata")
            continue
        try:
            anno = int(anno_v)
        except (TypeError, ValueError):
            avvisi.append(f"{rif}: anno non valido ({anno_v!r}), ignorata")
            continue
        mese = _mese(mese_v)
        if mese is None:
            avvisi.append(f"{rif}: mese non valido ({mese_v!r}), ignorata")
            continue
        if anno >= PRIMO_ANNO_HOTELOS:
            avvisi.append(f"{rif}: {struttura} {anno} ignorata — dal {PRIMO_ANNO_HOTELOS} i dati vengono dai "
                          "Corrispettivi di HotelOS")
            continue
        if mese not in MESI_WAVE:
            avvisi.append(f"{rif}: {struttura} {MESI_IT[mese - 1]} {anno} ignorata (fuori da aprile–settembre)")
            continue
        netto = _decimale(cella(riga, 'netto'), 4)
        if netto is None:
            avvisi.append(f"{rif}: {struttura} {MESI_IT[mese - 1]} {anno} senza netto, ignorata")
            continue
        chiave = (struttura, anno, mese)
        if chiave in viste:
            raise ErroreImportWave(f"{rif}: {struttura} {MESI_IT[mese - 1]} {anno} compare due volte")
        viste.add(chiave)
        righe.append(RigaStorico(
            struttura_code=struttura, anno=anno, mese=mese, netto=netto,
            lordo=_decimale(cella(riga, 'lordo'), 2),
            tassa_soggiorno=_decimale(cella(riga, 'tassa'), 2),
            metodo=_testo(cella(riga, 'metodo')), fonte=_testo(cella(riga, 'fonte')),
            note=_testo(cella(riga, 'note')),
        ))
    if not righe:
        raise ErroreImportWave("Nessuna riga valida nel foglio Storico")
    return righe, avvisi
