"""
Parser per i file CSV e Excel PlanningForecast degli hotel del gruppo.

Ogni hotel produce una coppia di file:
  - File 1: RICAVI TRAT comprensivi di ristorante (rooms + F&B)
  - File 2: RICAVI TRAT solo alloggio

Le colonne chiave sono le stesse in entrambi i file indipendentemente dal tipo di camera:
  DATA, EVENTI, [colonne camere...], CV, CP, PAX, RICAVI TRAT, EXTRA TRATT, ...

Nota sulle colonne camere nel CSV:
  CV = Camere Vendibili (capacità totale, costante per hotel)
  CP = Camere con Pax (occupate/vendute nella data)
  Verificato: OCCUP% dal file = CP/CV * 100

Formule revenue applicate:
  revenue_rooms = RICAVI TRAT  (da file2)
  revenue_fnb   = RICAVI TRAT file1 - RICAVI TRAT file2  (floor a 0, mai negativo)
  revenue_extra = EXTRA TRATT  (da file1, uguale in entrambi)
  revenue_total = revenue_rooms + revenue_fnb + revenue_extra

Filtro stagionale (opzionale):
  Se open_date / close_date sono forniti a parse_coppia, le date fuori stagione
  vengono scartate con warning non bloccante (salvato in self.warnings).

Formato file supportati:
  - CSV (separatore ;, decimali con virgola) — formato originale
  - Excel .xlsx/.xls — date come datetime Python, numeri già float

Convenzione nome file:
  YYYYMMDD_PlanningForecast-HOTELCODE[12].xlsx/csv
  - YYYYMMDD      → snapshot_date (data del forecast)
  - HOTELCODE     → codice hotel (es. CLB, DPH, INT)
  - [12]          → indice file (ignorato, auto-detect via somma ricavi)
"""

import csv
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import openpyxl


_RE_DATA_IT = re.compile(r"^(\d{2}/\d{2}/\d{4})")


@dataclass
class RigaHotel:
    """Dati grezzi estratti da una singola riga valida del CSV."""

    data: date
    rooms_sold: int        # CP - camere con pax (occupate)
    rooms_available: int   # CV - camere vendibili (capacità)
    pax: int
    ricavi_trat: float
    extra_tratt: float


@dataclass
class RigaRevenue:
    """Dati revenue finali per un giorno, calcolati dalla coppia di file."""

    hotel_code: str
    data: date
    rooms_sold: int
    rooms_available: int
    pax: int
    revenue_rooms: float
    revenue_fnb: float
    revenue_extra: float
    revenue_total: float


def _converti_numero(valore: str) -> float:
    """Converte un numero in formato italiano (virgola decimale) in float."""
    valore = valore.strip().replace(",", ".")
    if not valore:
        return 0.0
    try:
        return float(valore)
    except ValueError:
        return 0.0


def _estrai_data(campo_data: str) -> Optional[date]:
    """
    Estrae la data da una stringa nel formato italiano dd/mm/yyyy.
    Restituisce None per righe SDLY, LY o con formato non valido.
    """
    campo_data = campo_data.strip()

    if "(SDLY)" in campo_data or "(LY)" in campo_data:
        return None

    match = _RE_DATA_IT.match(campo_data)
    if not match:
        return None

    try:
        return datetime.strptime(match.group(1), "%d/%m/%Y").date()
    except ValueError:
        return None


def _leggi_csv(percorso: str) -> Tuple[List[str], List[Dict[str, str]]]:
    """
    Legge un file CSV con separatore punto e virgola.
    Prova UTF-8 con BOM, UTF-8, poi latin-1 (frequente su file Windows).
    """
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with open(percorso, newline="", encoding=encoding) as f:
                reader = csv.DictReader(f, delimiter=";")
                intestazioni = reader.fieldnames or []
                righe = list(reader)
            return list(intestazioni), righe
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Impossibile decodificare il file: {percorso}")


def _leggi_excel(percorso: str) -> Tuple[List[str], List[Dict[str, str]]]:
    """
    Legge un file Excel (.xlsx/.xls) e restituisce intestazioni e righe
    nel medesimo formato di _leggi_csv, così il resto del parser funziona
    senza modifiche.

    Conversioni applicate:
      - Celle con valori datetime/date → stringa "dd/mm/yyyy" (compatibile con _estrai_data)
      - Numeri int/float → str (nessuna virgola nei file Excel, _converti_numero li gestisce)
      - None/cella vuota → stringa vuota
    """
    wb = openpyxl.load_workbook(percorso, data_only=True)
    ws = wb.worksheets[0]  # usa sempre il primo foglio

    righe_ws = list(ws.iter_rows(values_only=True))
    if not righe_ws:
        return [], []

    # Prima riga = intestazioni
    intestazioni = [str(c) if c is not None else "" for c in righe_ws[0]]

    righe: List[Dict[str, str]] = []
    for riga_tuple in righe_ws[1:]:
        riga_dict: Dict[str, str] = {}
        for intestazione, valore in zip(intestazioni, riga_tuple):
            if valore is None:
                riga_dict[intestazione] = ""
            elif isinstance(valore, (datetime, date)):
                # Converte in stringa italiana dd/mm/yyyy, compatibile con _estrai_data
                if isinstance(valore, datetime):
                    riga_dict[intestazione] = valore.strftime("%d/%m/%Y")
                else:
                    riga_dict[intestazione] = valore.strftime("%d/%m/%Y")
            elif isinstance(valore, (int, float)):
                # I numeri Excel non hanno virgola decimale italiana
                riga_dict[intestazione] = str(valore)
            else:
                riga_dict[intestazione] = str(valore)
        righe.append(riga_dict)

    return intestazioni, righe


def _leggi_file(percorso: str) -> Tuple[List[str], List[Dict[str, str]]]:
    """
    Dispatcha la lettura al parser corretto in base all'estensione del file.
    .xlsx e .xls → parser Excel; tutto il resto → parser CSV.
    """
    estensione = Path(percorso).suffix.lower()
    if estensione in (".xlsx", ".xls"):
        return _leggi_excel(percorso)
    return _leggi_csv(percorso)


def estrai_snapshot_date(nome_file: str) -> Optional[date]:
    """
    Estrae la snapshot_date dai primi 8 caratteri del nome file (basename).
    Regola: se i primi 8 caratteri sono esattamente 8 cifre che formano una data
    YYYYMMDD valida → restituisce quella data. Altrimenti → restituisce None.

    Esempi:
      "20260505_PlanningForecast-CLB1.csv" → date(2026, 5, 5)
      "20260505_CLB1.csv"                  → date(2026, 5, 5)
      "PlanningForecast-CLB1.csv"          → None  (non inizia con 8 cifre)
      "/uploads/20260601_DPH1.csv"         → date(2026, 6, 1)  (usa il basename)
    """
    base = Path(nome_file).name
    if len(base) >= 8 and base[:8].isdigit():
        try:
            return date(int(base[:4]), int(base[4:6]), int(base[6:8]))
        except ValueError:
            pass
    return None


def estrai_hotel_code_da_file(nome_file: str) -> Optional[str]:
    """
    Estrae il codice hotel dagli ultimi 4 caratteri del nome file (senza estensione).
    Regola: l'ultimo carattere del nome (senza ext) deve essere '1' o '2' (numero file);
    i caratteri alfabetici nelle 3 posizioni precedenti formano il codice hotel.

    Esempi:
      "20260505_PlanningForecast-CLB1.csv" → "CLB"
      "20260505_CLB1.csv"                  → "CLB"
      "20260505_qualsiasicosa_DPH2.xlsx"   → "DPH"
      "PlanningForecast-INT1.csv"          → "INT"
      "20260505_INT2.xlsx"                 → "INT"
      "random_file.csv"                    → None  (non termina con 1 o 2)
    """
    stem = Path(nome_file).stem  # nome senza estensione

    # L'ultimo carattere deve essere '1' o '2' (numero file nella coppia)
    if not stem or stem[-1] not in ("1", "2"):
        return None

    # Estrai le lettere dai 3 caratteri precedenti al numero finale
    candidate = stem[max(0, len(stem) - 4): -1]
    alpha = re.sub(r"[^A-Za-z]", "", candidate).upper()
    if 2 <= len(alpha) <= 5:
        return alpha

    return None


def _valida_colonne(intestazioni: List[str], percorso: str) -> None:
    """Verifica che le colonne obbligatorie siano presenti nel file."""
    obbligatorie = {"DATA", "CV", "CP", "PAX", "RICAVI TRAT", "EXTRA TRATT"}
    mancanti = obbligatorie - set(intestazioni)
    if mancanti:
        raise ValueError(
            f"File '{percorso}': colonne mancanti: {', '.join(sorted(mancanti))}"
        )


def _parse_righe(righe: List[Dict[str, str]]) -> Tuple[Dict[date, RigaHotel], int]:
    """
    Converte le righe CSV in dizionario indicizzato per data.
    Restituisce (dizionario_date, numero_righe_scartate_SDLY_LY_formato).
    """
    risultato: Dict[date, RigaHotel] = {}
    scartate = 0

    for riga in righe:
        data = _estrai_data(riga.get("DATA", ""))
        if data is None:
            scartate += 1
            continue

        if data in risultato:
            continue

        risultato[data] = RigaHotel(
            data=data,
            rooms_sold=int(_converti_numero(riga.get("CP", "0"))),
            rooms_available=int(_converti_numero(riga.get("CV", "0"))),
            pax=int(_converti_numero(riga.get("PAX", "0"))),
            ricavi_trat=_converti_numero(riga.get("RICAVI TRAT", "0")),
            extra_tratt=_converti_numero(riga.get("EXTRA TRATT", "0")),
        )

    return risultato, scartate


class ParserCSV:
    """
    Parser per la coppia di file CSV di un singolo hotel.

    Attributi post-parsing:
      righe_scartate        — righe SDLY/LY/formato non valido
      righe_fuori_stagione  — date valide ma fuori dal periodo di apertura
      warnings              — messaggi descrittivi per righe fuori stagione
    """

    def __init__(self, hotel_code: str):
        self.hotel_code = hotel_code.upper()
        self.righe_scartate = 0
        self.righe_fuori_stagione = 0
        self.warnings: List[str] = []

    def parse_coppia(
        self,
        path_file1: str,
        path_file2: str,
        open_date: Optional[date] = None,
        close_date: Optional[date] = None,
    ) -> List[RigaRevenue]:
        """
        Elabora la coppia di file CSV e restituisce i dati revenue finali.

        Parametri opzionali stagionali:
          open_date  — primo giorno di apertura: date precedenti vengono scartate con warning
          close_date — ultimo giorno di apertura: date successive vengono scartate con warning
        """
        self.righe_fuori_stagione = 0
        self.warnings = []

        intestazioni1, righe_raw1 = _leggi_file(path_file1)
        intestazioni2, righe_raw2 = _leggi_file(path_file2)

        _valida_colonne(intestazioni1, path_file1)
        _valida_colonne(intestazioni2, path_file2)

        dati_a, scartate_a = _parse_righe(righe_raw1)
        dati_b, scartate_b = _parse_righe(righe_raw2)

        self.righe_scartate = max(scartate_a, scartate_b)

        # Auto-detect: il file con ricavi_trat totali maggiori è quello con ristorante (file1).
        # Se i file sono caricati in ordine inverso, li scambiamo automaticamente.
        somma_a = sum(r.ricavi_trat for r in dati_a.values())
        somma_b = sum(r.ricavi_trat for r in dati_b.values())
        if somma_b > somma_a:
            dati_a, dati_b = dati_b, dati_a

        dati1, dati2 = dati_a, dati_b

        risultati: List[RigaRevenue] = []
        for data in sorted(dati2.keys()):

            # --- Filtro stagionale ---
            if open_date is not None and data < open_date:
                self.warnings.append(
                    f"{self.hotel_code} {data.strftime('%d/%m/%Y')}: "
                    f"data precedente all'apertura stagionale ({open_date.strftime('%d/%m/%Y')})"
                )
                self.righe_fuori_stagione += 1
                continue

            if close_date is not None and data > close_date:
                self.warnings.append(
                    f"{self.hotel_code} {data.strftime('%d/%m/%Y')}: "
                    f"data successiva alla chiusura stagionale ({close_date.strftime('%d/%m/%Y')})"
                )
                self.righe_fuori_stagione += 1
                continue

            riga2 = dati2[data]
            riga1 = dati1.get(data)

            revenue_rooms = riga2.ricavi_trat
            extra_tratt = riga2.extra_tratt

            if riga1 is not None:
                diff = riga1.ricavi_trat - riga2.ricavi_trat
                revenue_fnb = max(0.0, diff)
                extra_tratt = riga1.extra_tratt
            else:
                revenue_fnb = 0.0

            revenue_total = revenue_rooms + revenue_fnb + extra_tratt

            risultati.append(
                RigaRevenue(
                    hotel_code=self.hotel_code,
                    data=data,
                    rooms_sold=riga2.rooms_sold,
                    rooms_available=riga2.rooms_available,
                    pax=riga2.pax,
                    revenue_rooms=round(revenue_rooms, 4),
                    revenue_fnb=round(revenue_fnb, 4),
                    revenue_extra=round(extra_tratt, 4),
                    revenue_total=round(revenue_total, 4),
                )
            )

        return risultati

    def parse_file_singolo(self, percorso: str) -> Dict[date, RigaHotel]:
        """Legge un singolo file (CSV o Excel) e restituisce il dizionario grezzo per data. Utile per debug."""
        intestazioni, righe_raw = _leggi_file(percorso)
        _valida_colonne(intestazioni, percorso)
        dati, self.righe_scartate = _parse_righe(righe_raw)
        return dati
