"""Parser PDF per il modulo Corrispettivi — Fase 1: SC e SCA.

Il PDF "Documenti Fiscali Emessi" dal PMS contiene una sezione
"Riepilogo Documenti Emessi" con tutte le ricevute fiscali emesse.
Estraiamo solo SC (scontrini) e SCA (scontrini di acconto).
Le caparre (CP) sono movimenti trasparenti e vengono ignorate.
Le fatture (F/FD) saranno aggiunte in Fase 2.

Struttura di ogni riga:
  dd/mm/yy TIPO NUM SUFF CAM INTESTAZIONE TOTALE€ INCASSATO€ SOSPESO€
  TIPO_PAG AMOUNT€ [/ TIPO_PAG2 AMOUNT2€] / IMP€ IVA€ TSOGG€ CHECKBOX

La struttura (DPH/CLB/INT) si ricava dalla prima lettera del campo SUFF:
  D-SC → DPH,  C-SC → CLB,  I-SC → INT
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import List, Optional, Tuple

import pdfplumber


# ── Costanti ─────────────────────────────────────────────────────────────────

TIPI_FASE_1 = {'SC', 'SCA'}

LETTERA_A_STRUTTURA = {'D': 'DPH', 'C': 'CLB', 'I': 'INT'}

# Nomi struttura leggibili
NOME_STRUTTURA = {'DPH': 'Hotel Du Parc', 'CLB': 'Club Hotel', 'INT': 'Hotel International'}

TIPI_PAG_NOTI = [
    'Carta Credito', 'Bonifico/Vaglia', 'XPAY-Nexi',
    'Bancomat', 'Contante', 'Satispay', 'Assegno', 'ANNULLATO',
]

# ── Pattern regex ─────────────────────────────────────────────────────────────

# Inizio riga documento — gestisce anche il caso senza spazio tra data e tipo:
# '22/05/26 SC 118 D-SC ...' oppure '22/05/26SCA 116 D-SC ...'
DOC_RE = re.compile(
    r'^(\d{2}/\d{2}/\d{2,4})\s*(SC|SCA|CP|F|FD|FNC|NOTA)\s+(\d+)\s+([A-Z]-[A-Z]+)\s*(.*)',
    re.IGNORECASE,
)

# Importo italiano: 1.234,56 € (con segno negativo opzionale)
IMPORTO_RE = re.compile(r'(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€')

# Tipo pagamento + importo (ordine importante: tipi più lunghi prima per evitare match parziali)
TIPI_PAG_RE = re.compile(
    r'(' + '|'.join(re.escape(t) for t in TIPI_PAG_NOTI) + r')'
    r'\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€',
    re.IGNORECASE,
)

# Footer di pagina — es. "23/05/2026 07:55:34 KM DI MARE GABICCE MARE Pagina 1"
FOOTER_RE = re.compile(r'^\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}')

# Titoli di sezioni che terminano la sezione documenti
FINE_SEZIONE_RE = re.compile(
    r'Riepilogo Sospesi|Riepilogo Caparre|Dettaglio di Cassa|'
    r'Riepilogo IVA|Riepilogo Progressivi|Uscite cassa',
    re.IGNORECASE,
)


# ── Strutture dati ────────────────────────────────────────────────────────────

@dataclass
class RigaDocumento:
    data: date
    tipo_doc: str          # SC o SCA
    numero: int
    struttura_code: str    # DPH, CLB, INT
    camera: str
    intestazione: str
    incassato: float
    tipo_pagamento: str
    annullato: bool = False


@dataclass
class RisultatoParsing:
    righe: List[RigaDocumento] = field(default_factory=list)
    n_sc: int = 0
    n_sca: int = 0
    data_da: Optional[date] = None
    data_a: Optional[date] = None
    societa: str = ''
    totale_incassato: float = 0.0
    warnings: List[str] = field(default_factory=list)


# ── Funzioni di utilità ───────────────────────────────────────────────────────

def _parse_importo(s: str) -> float:
    """Converte formato italiano '1.234,56' → 1234.56 (gestisce valori negativi)."""
    return float(s.replace('.', '').replace(',', '.'))


def _parse_data(s: str) -> date:
    """Converte dd/mm/yy o dd/mm/yyyy in date."""
    for fmt in ('%d/%m/%y', '%d/%m/%Y'):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Formato data non riconosciuto: {s!r}")


def _struttura_da_suff(suff: str) -> str:
    """'D-SC' → 'DPH',  'C-SC' → 'CLB',  'I-CP' → 'INT'."""
    lettera = suff[0].upper() if suff else ''
    return LETTERA_A_STRUTTURA.get(lettera, f'?{lettera}')


def _parse_pagamenti(dopo_sospeso: str) -> List[Tuple[str, float]]:
    """
    Estrae coppie (tipo_pagamento, importo) dal testo dopo il campo sospeso.
    Un pagamento doppio restituisce due tuple.
    """
    if 'ANNULLATO' in dopo_sospeso.upper():
        return [('ANNULLATO', 0.0)]

    pagamenti = [
        (m.group(1), _parse_importo(m.group(2)))
        for m in TIPI_PAG_RE.finditer(dopo_sospeso)
    ]
    return pagamenti if pagamenti else [('Sconosciuto', 0.0)]


def _parse_riga(
    data_str: str, tipo: str, numero_str: str, suff: str, resto: str
) -> List[RigaDocumento]:
    """
    Analizza i campi di una singola riga documento.
    Restituisce una lista (>1 elemento se pagamento doppio).
    """
    try:
        data_doc = _parse_data(data_str)
    except ValueError:
        return []

    numero = int(numero_str)
    struttura_code = _struttura_da_suff(suff)

    # I primi tre importi nel resto sono: totale, incassato, sospeso
    importi = list(IMPORTO_RE.finditer(resto))
    if len(importi) < 3:
        return []

    # Testo prima del primo importo = camera + intestazione
    cam_intesta = resto[:importi[0].start()].strip()
    tokens = cam_intesta.split(None, 1)
    camera = tokens[0] if tokens else ''
    intestazione = tokens[1].strip() if len(tokens) > 1 else ''

    # Il testo dopo il sospeso contiene tipo_pagamento e importi fiscali
    dopo_sospeso = resto[importi[2].end():].strip()

    if 'ANNULLATO' in dopo_sospeso.upper():
        return [RigaDocumento(
            data=data_doc, tipo_doc=tipo, numero=numero,
            struttura_code=struttura_code, camera=camera,
            intestazione=intestazione, incassato=0.0,
            tipo_pagamento='ANNULLATO', annullato=True,
        )]

    pagamenti = _parse_pagamenti(dopo_sospeso)
    return [
        RigaDocumento(
            data=data_doc, tipo_doc=tipo, numero=numero,
            struttura_code=struttura_code, camera=camera,
            intestazione=intestazione, incassato=importo_pag,
            tipo_pagamento=tipo_pag, annullato=False,
        )
        for tipo_pag, importo_pag in pagamenti
    ]


# ── Funzione principale ───────────────────────────────────────────────────────

def parse_pdf(file_path: str) -> RisultatoParsing:
    """
    Analizza il PDF "Documenti Fiscali Emessi" e restituisce
    tutti i documenti SC e SCA con i relativi incassi per tipo pagamento.
    """
    risultato = RisultatoParsing()
    testi_pagine = []

    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                testi_pagine.append(text)

    # Estrae il nome della società dal footer di pagina
    # Formato: "dd/mm/yyyy hh:mm:ss NOME SOCIETA Pagina N"
    for testo in testi_pagine:
        for line in testo.split('\n'):
            m = re.match(
                r'\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}\s+(.+?)\s+Pagina\s+\d+', line
            )
            if m:
                risultato.societa = m.group(1).strip()
                break
        if risultato.societa:
            break

    # Processa ogni pagina cercando la sezione "Riepilogo Documenti Emessi"
    in_sezione = False
    righe: List[RigaDocumento] = []

    for testo in testi_pagine:
        lines = testo.split('\n')
        i = 0
        while i < len(lines):
            line = lines[i].strip()

            # Salta righe vuote e footer
            if not line or FOOTER_RE.match(line) or line == 'gino.scola':
                i += 1
                continue

            # Inizio sezione documenti
            if 'Riepilogo Documenti Emessi' in line:
                in_sezione = True
                i += 1
                continue

            # Fine sezione documenti
            if in_sezione and FINE_SEZIONE_RE.search(line):
                in_sezione = False
                i += 1
                continue

            if not in_sezione:
                i += 1
                continue

            # Intestazione colonne — salta
            if line.startswith('Data ') and 'Intestazione' in line:
                i += 1
                continue

            # Riga "Tassa" dell'header — salta
            if line == 'Tassa':
                i += 1
                continue

            # Riga totali — salta
            if line.startswith('Totali:'):
                i += 1
                continue

            # Prova a fare match di una riga documento
            m = DOC_RE.match(line)
            if m:
                data_str, tipo, numero, suff, resto = m.groups()

                # Avanza oltre le eventuali righe di continuazione (indirizzo ospite)
                while (i + 1) < len(lines):
                    next_line = lines[i + 1].strip()
                    if (not next_line or DOC_RE.match(next_line)
                            or FINE_SEZIONE_RE.search(next_line)
                            or next_line.startswith('Totali:')
                            or FOOTER_RE.match(next_line)):
                        break
                    i += 1  # riga di continuazione consumata, non ci serve

                tipo_up = tipo.upper()
                if tipo_up in TIPI_FASE_1:
                    nuove = _parse_riga(data_str, tipo_up, numero, suff, resto)
                    for r in nuove:
                        righe.append(r)
                        if not r.annullato:
                            risultato.totale_incassato += r.incassato
                        else:
                            risultato.warnings.append(
                                f"Documento annullato ignorato: {tipo_up} {numero} "
                                f"del {data_str} ({_struttura_da_suff(suff)})"
                            )

            i += 1

    # Conta documenti unici (un split payment crea più righe per lo stesso numero)
    ids_sc: set = set()
    ids_sca: set = set()
    for r in righe:
        chiave = (r.data, r.struttura_code, r.numero)
        if r.tipo_doc == 'SC':
            ids_sc.add(chiave)
        else:
            ids_sca.add(chiave)

    risultato.righe = righe
    risultato.n_sc = len(ids_sc)
    risultato.n_sca = len(ids_sca)

    if righe:
        dates = [r.data for r in righe]
        risultato.data_da = min(dates)
        risultato.data_a = max(dates)

    return risultato
