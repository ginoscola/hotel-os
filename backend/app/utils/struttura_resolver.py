"""Risoluzione struttura_code (DPH/CLB/INT) da un codice camera.

Stessa logica di prefisso già in uso (duplicata) in
`app/services/corrispettivi_excel_parser.py` (PREFISSO_A_STRUTTURA /
CAMERA_SPECIALE_A_STRUTTURA) — qui centralizzata e usata come fallback dopo
il lookup sulla tabella `rooms`, che è la fonte autoritativa (verificato:
tutte le camere di un export reale di Welcome esistono già in `rooms`).
"""

from typing import Optional

from sqlalchemy.orm import Session

from app.models.rooms import Room

PREFISSO_A_STRUTTURA: dict[str, str] = {
    'D': 'DPH',
    'C': 'CLB',
    'I': 'INT',
}

CAMERA_SPECIALE_A_STRUTTURA: dict[str, str] = {
    'AIRE': 'DPH',
    'AGUA': 'DPH',
    'TIERRA': 'DPH',
    'FUEGO': 'DPH',
}

NOME_STRUTTURA_A_CODICE: dict[str, str] = {
    'CLUB': 'CLB',
    'DU PARC': 'DPH',
    'DUPARC': 'DPH',
    'INTERNATIONAL': 'INT',
}


def carica_mappa_rooms(db: Session) -> dict[str, str]:
    """Precarica code -> struttura_code da `rooms` in un'unica query.

    Da chiamare UNA volta prima di un ciclo che risolve molte camere (es. il parser
    di un import con migliaia di righe) — interrogare `rooms` riga per riga è un
    problema N+1 reale: un import di un mese intero (~13.000 righe) faceva altrettante
    query singole solo per la risoluzione struttura, causando timeout lato frontend
    (30s) pur avendo un file di sole ~100 camere distinte.
    """
    return {code: struttura for code, struttura in db.query(Room.code, Room.struttura_code).all()}


def struttura_da_camera(
    camera: Optional[str],
    nome_struttura_file: Optional[str] = None,
    rooms_map: Optional[dict[str, str]] = None,
) -> Optional[str]:
    """Determina struttura_code da un codice camera.

    Ordine: 1) lookup autoritativo su `rooms_map` (precaricato con `carica_mappa_rooms()`,
    fonte autoritativa) 2) fallback prefisso/nome speciale 3) fallback sul nome struttura
    letto dal file stesso.
    """
    if camera:
        camera_norm = camera.strip().upper()

        if rooms_map and camera_norm in rooms_map:
            return rooms_map[camera_norm]

        for nome, struttura in CAMERA_SPECIALE_A_STRUTTURA.items():
            if camera_norm.startswith(nome):
                return struttura

        if camera_norm and camera_norm[0] in PREFISSO_A_STRUTTURA:
            return PREFISSO_A_STRUTTURA[camera_norm[0]]

    if nome_struttura_file:
        return NOME_STRUTTURA_A_CODICE.get(nome_struttura_file.strip().upper())

    return None
