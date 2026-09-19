"""Parser dell'export Welcome "PrenotazioniWeb" (prenotazioni cancellate).

Formato CSV separato da virgola, con prima riga "sep=," (artefatto di Excel) da scartare.
Le date sono ISO 8601 (`2026-08-31T17:18:07`, talvolta con secondi frazionari), gli importi
usano il punto come separatore decimale (a differenza dei fogli Google del modulo Revenue,
che usano la virgola) — nessuna conversione di formato numero necessaria.

Due colonne opzionali, non presenti nell'export standard ma leggibili se l'utente le aggiunge
a mano al CSV prima di caricarlo, con lo stesso nome usato a schermo in Welcome (non nel
pulsante Esporta, che le omette): "Codice Prenotazione" (es. 6097) e "Data cancellazione"
(formato `YYYY-MM-DD` o `DD/MM/YYYY`).
"""

from datetime import date, datetime
from typing import Dict, List

COLONNE_OBBLIGATORIE = {
    "portaleXAlbergo.nome", "dataPren", "arrivo", "partenza", "importo",
}


def _decodifica(raw: bytes) -> str:
    """Prova UTF-8 con BOM, poi UTF-8 puro, poi latin-1 (Windows-1252)."""
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def _hotel_da_portale(nome_portale: str) -> str:
    p = (nome_portale or "").upper()
    if "DU PARC" in p or "DUPARC" in p:
        return "DPH"
    if "CLUB" in p:
        return "CLB"
    if "INTERNATIONAL" in p:
        return "INT"
    return "?"


def _canale_da_portale(nome_portale: str) -> str:
    if " - " in (nome_portale or ""):
        return nome_portale.split(" - ", 1)[1].strip()
    return (nome_portale or "").strip()


def _parse_data(v: str) -> date:
    v = (v or "").strip()
    # Tronca eventuali secondi frazionari (es. "2026-01-17T18:34:56.36")
    v = v.split(".")[0] if "T" in v and "." in v else v
    return datetime.fromisoformat(v).date()


def _num(v: str) -> float:
    v = (v or "").strip()
    return float(v) if v else 0.0


def _parse_data_manuale(v: str):
    """Data inserita a mano nella colonna opzionale `data_cancellazione` — accetta sia
    ISO (2026-09-05) sia formato italiano (05/09/2026), per non vincolare a un formato
    scomodo da digitare in Excel. None se assente o non riconosciuta."""
    v = (v or "").strip()
    if not v:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


def parse_csv(raw: bytes, mese_atteso: int, anno_atteso: int, data_rilevata) -> dict:
    """Analizza il CSV e ritorna dict con `righe`, contatori, `warning`.

    Solleva ValueError solo per errori strutturali (file vuoto, colonne mancanti).
    Righe con `dataPren` fuori dal mese/anno dichiarati vengono incluse comunque
    (Welcome a volte include qualche giorno a cavallo) ma contate a parte, come
    warning — stesso principio del filtro "fuori stagione" del parser Revenue.
    """
    import csv
    import io

    testo = _decodifica(raw)
    righe_testo = testo.splitlines()
    # Scarta l'eventuale riga "sep=," che Excel antepone al CSV
    if righe_testo and righe_testo[0].strip().lower().startswith("sep="):
        righe_testo = righe_testo[1:]
    if not righe_testo:
        raise ValueError("File vuoto")

    reader = csv.DictReader(io.StringIO("\n".join(righe_testo)))
    intestazioni = set(reader.fieldnames or [])
    mancanti = COLONNE_OBBLIGATORIE - intestazioni
    if mancanti:
        raise ValueError(f"Colonne obbligatorie mancanti nel file: {', '.join(sorted(mancanti))}")

    righe: List[Dict] = []
    n_totali = 0
    n_fuori_mese = 0
    warning: List[str] = []

    for riga in reader:
        n_totali += 1
        portale = (riga.get("portaleXAlbergo.nome") or "").strip()
        if not portale:
            continue
        try:
            data_pren = _parse_data(riga.get("dataPren", ""))
            arrivo = _parse_data(riga.get("arrivo", ""))
            partenza = _parse_data(riga.get("partenza", ""))
        except ValueError:
            warning.append(f"Riga {n_totali}: data non valida, scartata")
            continue

        if data_pren.month != mese_atteso or data_pren.year != anno_atteso:
            n_fuori_mese += 1

        righe.append(dict(
            hotel_code=_hotel_da_portale(portale),
            canale=_canale_da_portale(portale) or "altro",
            canale_vendita=(riga.get("parametroCanaleVendita.descrizione") or "").strip(),
            codice_ota=(riga.get("codiceOTA") or "").strip(),
            # Colonne opzionali, non nell'export Welcome originale — compilate solo se l'utente
            # le ha aggiunte a mano al CSV, con gli stessi nomi usati a schermo in Welcome
            # (vedi _parse_data_manuale per i formati data accettati).
            numero_prenotazione=(riga.get("Codice Prenotazione") or "").strip() or None,
            data_cancellazione=_parse_data_manuale(riga.get("Data cancellazione", "")),
            data_rilevata=data_rilevata,
            data_prenotazione=data_pren,
            arrivo=arrivo,
            partenza=partenza,
            notti=int(riga.get("notti") or 0),
            pax=int(riga.get("pax") or 0),
            cliente=(riga.get("cliente.ragioneSociale") or "").strip(),
            email=(riga.get("cliente.email") or "").strip() or None,
            tipo_camera=(riga.get("tipoCamera.nome") or "").strip(),
            trattamento=(riga.get("trattamento.nome") or "").strip() or None,
            mercato=(riga.get("parametroMercato.descrizione") or "").strip() or None,
            importo=_num(riga.get("importo", "")),
        ))

    if not righe:
        raise ValueError("Nessuna riga valida trovata nel file")

    if n_fuori_mese:
        warning.append(
            f"{n_fuori_mese} righe hanno data di prenotazione fuori dal mese/anno dichiarati "
            f"({mese_atteso:02d}/{anno_atteso}) — incluse comunque, verificare il filtro usato in Welcome"
        )

    return {
        "righe": righe,
        "n_righe_totali": n_totali,
        "n_righe_valide": len(righe),
        "n_righe_fuori_mese": n_fuori_mese,
        "warning": warning,
    }
