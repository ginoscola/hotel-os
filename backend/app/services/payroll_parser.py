"""Parser PDF per cedolini paghe aziendali.

Struttura attesa per pagina (un dipendente per pagina):
  riga 1  : P.IVA azienda
  riga 2  : ragione sociale
  riga 3  : indirizzo azienda (riga 1)
  riga 4  : CAP/città azienda
  riga 5  : mese e anno  (es. "APRILE 2026")
  riga 6  : codice interno dipendente
  riga 7  : cognome nome codice_fiscale
  riga 8  : indirizzo dipendente
  riga 9  : qualifica
  riga 10 : mansione + livello (ultimo token = livello)
  riga 11 : retribuzione_netta  costo_aziendale  (es. "97,00 108,06")
  riga 12 : incidenza%
  righe 13-25 : 13 valori numerici in ordine fisso:
      [dipendente]  ret_netta, contr_prev_dip, contr_san_dip,
                    irpef, altre_trattenute, anticipi_inps, tot_lordo
      [azienda]     contr_prev_az, contr_san_az, inail,
                    altri_enti, tfr, tot_costo_az
"""

import re
import pdfplumber
from typing import Any

# Ordine fisso delle voci nel PDF — corrisponde ai code di payroll_cost_types
VOCI_ORDINE = [
    "ret_netta",
    "contr_prev_dip",
    "contr_san_dip",
    "irpef",
    "altre_trattenute",
    "anticipi_inps",
    "tot_lordo",
    "contr_prev_az",
    "contr_san_az",
    "inail",
    "altri_enti",
    "tfr",
    "tot_costo_az",
]

MESI_IT = {
    "GENNAIO": 1, "FEBBRAIO": 2, "MARZO": 3,
    "APRILE": 4, "MAGGIO": 5, "GIUGNO": 6,
    "LUGLIO": 7, "AGOSTO": 8, "SETTEMBRE": 9,
    "OTTOBRE": 10, "NOVEMBRE": 11, "DICEMBRE": 12,
}


def _parse_numero(s: str) -> float:
    """Converte stringa italiana (es. '2.030,00') in float."""
    s = s.strip().replace(".", "").replace(",", ".")
    return float(s)


def _parse_pagina(righe: list[str], numero_pagina: int) -> dict[str, Any]:
    """Estrae i dati di un dipendente da una lista di righe testo."""
    if len(righe) < 12:
        raise ValueError(f"Pagina {numero_pagina}: troppo poche righe ({len(righe)})")

    risultato: dict[str, Any] = {"pagina": numero_pagina}

    # riga 1: P.IVA
    risultato["piva"] = righe[0].strip()

    # riga 2: ragione sociale
    risultato["societa"] = righe[1].strip()

    # righe 3-4: indirizzo azienda (ignoriamo, non ci serve)

    # riga 5: mese anno  (formato "MESE YYYY")
    mese_anno = righe[4].strip().split()
    if len(mese_anno) < 2:
        raise ValueError(f"Pagina {numero_pagina}: formato mese/anno non riconosciuto: '{righe[4]}'")
    nome_mese = mese_anno[0].upper()
    mese = MESI_IT.get(nome_mese)
    if mese is None:
        raise ValueError(f"Pagina {numero_pagina}: mese non riconosciuto: '{nome_mese}'")
    risultato["mese"] = mese
    risultato["anno"] = int(mese_anno[1])

    # riga 6: codice interno dipendente (ignorato ma conservato)
    risultato["codice_interno"] = righe[5].strip()

    # riga 7: cognome nome codice_fiscale (ultimo token = CF)
    tokens_dipendente = righe[6].strip().split()
    if len(tokens_dipendente) < 3:
        raise ValueError(f"Pagina {numero_pagina}: dati dipendente incompleti: '{righe[6]}'")
    codice_fiscale = tokens_dipendente[-1]
    # Verifica formato CF (16 caratteri alfanumerici) o PIVA-like
    if not re.match(r'^[A-Z0-9]{11,16}$', codice_fiscale, re.IGNORECASE):
        raise ValueError(f"Pagina {numero_pagina}: codice fiscale non valido: '{codice_fiscale}'")
    risultato["codice_fiscale"] = codice_fiscale.upper()
    # Cognome = primo token, Nome = token(s) intermedi
    risultato["cognome"] = tokens_dipendente[0].title()
    risultato["nome"] = " ".join(tokens_dipendente[1:-1]).title()

    # riga 8: indirizzo dipendente
    risultato["indirizzo"] = righe[7].strip().title()

    # riga 9: qualifica
    risultato["qualifica"] = righe[8].strip().title()

    # riga 10: mansione + livello (ultimo token = livello)
    tokens_mansione = righe[9].strip().split()
    if tokens_mansione:
        risultato["livello"] = tokens_mansione[-1]
        risultato["mansione"] = " ".join(tokens_mansione[:-1]).title() if len(tokens_mansione) > 1 else ""
    else:
        risultato["livello"] = ""
        risultato["mansione"] = ""

    # riga 11: ret_netta e costo_aziendale (sommario)
    numeri_sommario = righe[10].strip().split()
    if len(numeri_sommario) >= 2:
        try:
            risultato["ret_netta_sommario"] = _parse_numero(numeri_sommario[0])
            risultato["costo_az_sommario"] = _parse_numero(numeri_sommario[1])
        except ValueError:
            risultato["ret_netta_sommario"] = None
            risultato["costo_az_sommario"] = None
    else:
        risultato["ret_netta_sommario"] = None
        risultato["costo_az_sommario"] = None

    # riga 12: incidenza percentuale (es. "111,40%")
    incidenza_str = righe[11].strip().rstrip("%")
    try:
        risultato["incidenza_percentuale"] = _parse_numero(incidenza_str)
    except ValueError:
        risultato["incidenza_percentuale"] = None

    # righe 13+: 13 voci numeriche in ordine fisso
    valori_numerici = []
    for riga in righe[12:]:
        riga = riga.strip()
        if not riga:
            continue
        try:
            valori_numerici.append(_parse_numero(riga))
        except ValueError:
            # Salta righe non numeriche (note, spazi, ecc.)
            continue

    if len(valori_numerici) < len(VOCI_ORDINE):
        raise ValueError(
            f"Pagina {numero_pagina}: attese {len(VOCI_ORDINE)} voci numeriche, "
            f"trovate {len(valori_numerici)}"
        )

    voci: dict[str, float] = {}
    for i, code in enumerate(VOCI_ORDINE):
        voci[code] = valori_numerici[i]
    risultato["voci"] = voci

    return risultato


def parse_pdf(percorso_file: str) -> dict[str, Any]:
    """Legge il PDF e restituisce la lista di dipendenti estratti.

    Returns:
        {
            "dipendenti": [ { dati dipendente ... }, ... ],
            "pagine_non_parsate": [ { "pagina": N, "errore": "..." }, ... ],
            "mese": int,
            "anno": int,
            "societa": str,
            "piva": str,
        }
    """
    dipendenti = []
    pagine_non_parsate = []

    with pdfplumber.open(percorso_file) as pdf:
        for i, pagina in enumerate(pdf.pages):
            numero = i + 1
            testo = pagina.extract_text()
            if not testo:
                pagine_non_parsate.append({"pagina": numero, "errore": "Pagina vuota o non leggibile"})
                continue
            righe = [r for r in testo.split("\n") if r.strip()]
            try:
                dati = _parse_pagina(righe, numero)
                dipendenti.append(dati)
            except Exception as e:
                pagine_non_parsate.append({"pagina": numero, "errore": str(e)})

    if not dipendenti:
        raise ValueError("Nessun dipendente estratto dal PDF")

    # Metadati generali dal primo dipendente parsato con successo
    primo = dipendenti[0]
    return {
        "dipendenti": dipendenti,
        "pagine_non_parsate": pagine_non_parsate,
        "mese": primo["mese"],
        "anno": primo["anno"],
        "societa": primo["societa"],
        "piva": primo["piva"],
    }
