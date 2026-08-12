"""Parser PDF per cedolini paghe aziendali.

Struttura attesa per pagina (un dipendente per pagina):
  riga 1  : P.IVA azienda
  riga 2  : ragione sociale
  riga 3  : indirizzo azienda (riga 1)
  riga 4  : CAP/città azienda
  riga 5  : mese e anno  (es. "APRILE 2026")
  riga 6  : codice interno dipendente
  riga 7  : cognome nome codice_fiscale
  riga 8+ : indirizzo dipendente (0+ righe, opzionale — assente sul PDF per alcuni
            tirocinanti/stagisti; posizione successiva localizzata dinamicamente
            cercando la riga sommario, non per indice fisso)
  riga    : qualifica
  riga    : mansione + livello (ultimo token = livello)
  riga    : retribuzione_netta  costo_aziendale  (es. "97,00 108,06")
  riga    : incidenza% (opzionale)
  righe successive : 13 valori numerici in ordine fisso:
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
    """Converte stringa italiana (es. '2.030,00' o '396,53-' per un negativo) in float.

    Il gestionale paghe stampa i negativi (es. IRPEF a credito) con il segno meno in coda
    invece che davanti: '396,53-', non '-396,53'.
    """
    s = s.strip().replace(".", "").replace(",", ".")
    negativo = s.endswith("-")
    if negativo:
        s = s[:-1]
    valore = float(s)
    return -valore if negativo else valore


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

    # riga 8+: indirizzo dipendente (0+ righe — assente sul PDF per alcuni tirocinanti/stagisti),
    # poi qualifica, poi mansione+livello, poi riga sommario (2 numeri). Posizione variabile:
    # localizzata cercando la prima riga con due numeri decimali separati da spazio dopo la riga
    # cognome/CF, invece di assumere indici fissi (altrimenti l'assenza dell'indirizzo scala tutte
    # le righe successive di una posizione e "ruba" uno dei 13 valori finali).
    pattern_sommario = re.compile(r'^[\d.]+,\d{2}\s+[\d.]+,\d{2}$')
    idx_sommario = None
    for idx in range(7, len(righe)):
        if pattern_sommario.match(righe[idx].strip()):
            idx_sommario = idx
            break
    if idx_sommario is None or idx_sommario < 9:
        raise ValueError(f"Pagina {numero_pagina}: riga sommario retribuzione non trovata")

    # riga 8 (variabile): indirizzo dipendente (può essere vuoto)
    risultato["indirizzo"] = " ".join(r.strip() for r in righe[7:idx_sommario - 2]).title()

    # qualifica (riga prima di mansione)
    risultato["qualifica"] = righe[idx_sommario - 2].strip().title()

    # mansione + livello (ultimo token = livello)
    tokens_mansione = righe[idx_sommario - 1].strip().split()
    if tokens_mansione:
        risultato["livello"] = tokens_mansione[-1]
        risultato["mansione"] = " ".join(tokens_mansione[:-1]).title() if len(tokens_mansione) > 1 else ""
    else:
        risultato["livello"] = ""
        risultato["mansione"] = ""

    # riga sommario: ret_netta e costo_aziendale
    numeri_sommario = righe[idx_sommario].strip().split()
    try:
        risultato["ret_netta_sommario"] = _parse_numero(numeri_sommario[0])
        risultato["costo_az_sommario"] = _parse_numero(numeri_sommario[1])
    except ValueError:
        risultato["ret_netta_sommario"] = None
        risultato["costo_az_sommario"] = None

    # riga successiva: incidenza percentuale (es. "111,40%"), se presente
    idx_dopo_sommario = idx_sommario + 1
    if idx_dopo_sommario < len(righe) and "%" in righe[idx_dopo_sommario]:
        incidenza_str = righe[idx_dopo_sommario].strip().rstrip("%")
        try:
            risultato["incidenza_percentuale"] = _parse_numero(incidenza_str)
        except ValueError:
            risultato["incidenza_percentuale"] = None
        idx_voci_start = idx_dopo_sommario + 1
    else:
        risultato["incidenza_percentuale"] = None
        idx_voci_start = idx_dopo_sommario

    # righe successive: 13 voci numeriche in ordine fisso
    valori_numerici = []
    for riga in righe[idx_voci_start:]:
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
