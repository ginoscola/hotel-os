"""Parser per StatisticheProduzione.xlsx (export analitico riga-per-riga di Welcome PMS).

Registro gestionale (un record per ogni singolo addebito), distinto dal registro fiscale
di Corrispettivi (listaConti.xlsx) — nessun controllo incrociato tra i due.

Le colonne reali del file Welcome sono diverse da quelle "leggibili" che si potrebbero
immaginare — mapping verificato contro un export reale (giugno 2026):
  Data → data_riferimento (formato 'YYYY/MM/DD')
  Reparto → descrizione (Hotel/Ristorante/Parcheggio/Bar/Spiaggia)
  VoceAddebito → sotto_descrizione
  Articolo → dettaglio_originale (Quota Alloggio, Quota Colazione, Riassetto, Parcheggio Area Hotel, ecc.)
  Risorsa → camera (presente su ogni riga, incluse quelle Bar/Ristorante/Parcheggio/Spiaggia:
            l'addebito è sempre legato alla camera dell'ospite che l'ha generato)
  UbicazioneRisorsa → nome struttura (fallback se la camera non è risolvibile)
  Totale → prezzo_lordo (= Imponibile + Iva)
  Commissione → usata per calcolare prezzo_netto = Totale - Commissione
  CodiceAliquotaIva → aliquota_pct
  ParametroMercato → segmento (⚠️ NON ParametroSegmento, nonostante il nome)
  ParametroSegmento → tipo_ospite (⚠️ scambio confermato contro dati reali)
  Cliente → ospite

Include anche gli alias "leggibili" ipotizzati inizialmente come fallback, in caso
Welcome cambi in futuro i nomi colonna dell'export.

Categorizzazione (Articolo -> categoria) NON hardcoded: letta da `prod_dettaglio_categoria`
(tabella gestita da admin), non da un dizionario Python fisso — vedi `_carica_mapping_dettagli()`.
"""

from datetime import date, datetime
from typing import Any, Optional

import openpyxl
from sqlalchemy.orm import Session

from app.models.produzione import ProdCategoria, ProdDettaglioCategoria
from app.utils.struttura_resolver import carica_mappa_rooms, struttura_da_camera

# ── Mapping colonne (case/spazi-insensitive) ────────────────────────────────

ALIAS_COLONNE: dict[str, list[str]] = {
    'oid':                  ['Oid', 'OID'],
    'data':                 ['Data', 'DATA', 'Data Riferimento'],
    'reparto':              ['Reparto', 'Descrizione', 'DESC'],
    'voce_addebito':        ['VoceAddebito', 'Sotto Descrizione', 'SottoDescrizione'],
    'articolo':             ['Articolo', 'Dettaglio', 'DETTAGLIO'],
    'camera':                ['Risorsa', 'Camere', 'Camera', 'CAMERA'],
    'struttura_nome':        ['UbicazioneRisorsa', 'Struttura', 'STRUTTURA'],
    'tipo_camera':           ['TipoCamera'],
    'totale':                ['Totale', 'Prezzo Lordo', 'Lordo', 'PREZZO LORDO', 'Importo'],
    'commissione':           ['Commissione'],
    'imponibile':            ['Imponibile', 'IMPONIBILE'],
    'iva':                   ['Iva', 'IVA'],
    'aliquota':              ['CodiceAliquotaIva', '% IVA', 'Aliquota', 'ALIQUOTA'],
    'quantita':              ['Quantita', 'Quantità'],
    'trattamento':           ['Trattamento', 'TRATTAMENTO'],
    'canale':                ['ParametroCanaleVendita', 'Canale', 'CANALE'],
    'segmento':              ['ParametroMercato', 'Segmento', 'SEGMENTO'],
    'tipo_ospite':           ['ParametroSegmento', 'Tipo Ospite', 'TipoOspite'],
    'ospite':                ['Cliente', 'Ospite', 'OSPITE'],
    'arrivo':                ['Arrivo', 'Data Arrivo'],
    'partenza':              ['Partenza', 'Data Partenza'],
    'codice_prenotazione':   ['CodicePrenotazione', 'Codice Prenotazione', 'Cod. Prenotazione'],
}

CATEGORIA_DEFAULT = 'altro'


def _carica_mapping_dettagli(db: Session) -> dict[str, tuple[int, bool]]:
    """Articolo normalizzato (case/trim-insensitive) -> (categoria_id, categoria_da_prezzo),
    da prod_dettaglio_categoria.

    NON hardcoded: l'admin gestisce questa tabella dalla UI (aggiungere/rimuovere/rimappare
    qualunque voce, es. i due tipi di parcheggio, senza toccare il parser).
    """
    righe = db.query(ProdDettaglioCategoria).all()
    return {r.dettaglio_originale.strip().lower(): (r.categoria_id, r.categoria_da_prezzo) for r in righe}


TOLLERANZA_TARIFFA = 0.02  # arrotondamenti su importi con centesimi (es. IVA già applicata)


def _categoria_da_prezzo(prezzo_lordo: float, categorie_by_id: dict, fallback_id: Optional[int]) -> Optional[int]:
    """Sceglie la categoria attiva la cui tariffa_riferimento divide esattamente prezzo_lordo
    (es. 91€ = 7 notti × 13€/notte -> Parcheggio Esterno). Tariffe più alte prima, per evitare
    che una tariffa piccola "combaci per caso" con un multiplo di una tariffa più specifica.
    Nessuna tariffa combacia -> fallback_id (la categoria del mapping stesso)."""
    if prezzo_lordo <= 0:
        return fallback_id
    candidate = sorted(
        (c for c in categorie_by_id.values() if c.attivo and c.tariffa_riferimento),
        key=lambda c: -float(c.tariffa_riferimento),
    )
    for cat in candidate:
        tariffa = float(cat.tariffa_riferimento)
        multiplo = round(prezzo_lordo / tariffa)
        if multiplo > 0 and abs(multiplo * tariffa - prezzo_lordo) <= TOLLERANZA_TARIFFA:
            return cat.id
    return fallback_id


def _normalizza_header(h: Any) -> str:
    return str(h or '').strip().lower()


def _trova_colonne(header_row: list) -> dict[str, int]:
    header_norm = {_normalizza_header(h): i for i, h in enumerate(header_row)}
    colonne: dict[str, int] = {}
    for campo, alias in ALIAS_COLONNE.items():
        for nome in alias:
            idx = header_norm.get(_normalizza_header(nome))
            if idx is not None:
                colonne[campo] = idx
                break
    return colonne


def _v(row: tuple, colonne: dict[str, int], campo: str) -> Any:
    idx = colonne.get(campo)
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def _num(v: Any) -> float:
    if v is None or v == '':
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace('%', '')
    if not s:
        return 0.0
    # Formato italiano: punto migliaia, virgola decimale
    s = s.replace('.', '').replace(',', '.') if ',' in s else s
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_data(v: Any) -> Optional[date]:
    if v is None or v == '':
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    for fmt in ('%Y/%m/%d', '%d/%m/%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _categoria_id_da_articolo(
    articolo: Optional[str], prezzo_lordo: float,
    mapping: dict[str, tuple[int, bool]], categorie_by_id: dict,
) -> Optional[int]:
    """Cerca l'Articolo nel mapping (match esatto case-insensitive). Se la voce è marcata
    'categoria_da_prezzo', la categoria è scelta in base al prezzo (vedi _categoria_da_prezzo),
    non dal testo. Nessun match, o categoria disattivata dall'admin, → fallback su 'altro'."""
    a = (articolo or '').strip().lower()
    voce = mapping.get(a)
    if voce is not None:
        cat_id, da_prezzo = voce
        if da_prezzo:
            cat_id = _categoria_da_prezzo(prezzo_lordo, categorie_by_id, fallback_id=cat_id)
        if cat_id is not None and categorie_by_id.get(cat_id) and categorie_by_id[cat_id].attivo:
            return cat_id
    fallback = next((c for c in categorie_by_id.values() if c.code == CATEGORIA_DEFAULT), None)
    return fallback.id if fallback else None


def parse_xlsx(percorso_file: str, db: Session) -> dict[str, Any]:
    """Legge StatisticheProduzione.xlsx e restituisce righe pronte per il salvataggio.

    Returns:
        {
          righe: [dict per ogni riga valida, pronto per ProdRiga(**riga)],
          strutture_trovate: set[str],
          data_da: date, data_a: date,
          n_righe_totali: int, n_valide: int, n_riassetto: int, n_escluse: int,
          warning: [str],
        }
    """
    wb = openpyxl.load_workbook(percorso_file, data_only=True)
    ws = wb.active

    righe_iter = ws.iter_rows(values_only=True)
    header_row = next(righe_iter, None)
    if header_row is None:
        raise ValueError("File vuoto o senza intestazione")

    colonne = _trova_colonne(list(header_row))
    obbligatorie = ['oid', 'data', 'articolo', 'camera', 'totale']
    mancanti = [c for c in obbligatorie if c not in colonne]
    if mancanti:
        raise ValueError(f"Colonne obbligatorie non trovate nel file: {mancanti}")

    # Cache precaricate una sola volta (non per-riga): categorie, mapping dettaglio->categoria
    # (non hardcoded) e rooms (evita il problema N+1 che causava timeout sugli import di un
    # mese intero — ~13.000 righe, ~13.000 query singole prima di questo fix).
    categorie_by_id = {c.id: c for c in db.query(ProdCategoria).all()}
    mapping_dettagli = _carica_mapping_dettagli(db)
    rooms_map = carica_mappa_rooms(db)

    righe_out: list[dict] = []
    strutture_trovate: set[str] = set()
    warning: list[str] = []
    n_totali = 0
    n_riassetto = 0
    n_escluse = 0

    for row in righe_iter:
        if row is None or all(x is None for x in row):
            continue
        n_totali += 1

        oid = _v(row, colonne, 'oid')
        try:
            oid = int(oid)
        except (TypeError, ValueError):
            n_escluse += 1
            warning.append(f"Riga senza Oid valido (riga {n_totali}): scartata, impossibile garantire l'anti-duplicati")
            continue

        data_rif = _parse_data(_v(row, colonne, 'data'))
        if data_rif is None:
            n_escluse += 1
            continue

        # camera/ospite/dettaglio_originale coalesce sempre a '' (mai None): fanno parte della
        # chiave anti-duplicati uq_prod_riga_antiduplicati, e in SQL NULL <> NULL — due righe
        # con lo stesso identico contenuto ma ospite/camera NULL (es. addebiti bar/spiaggia
        # senza nome cliente) non verrebbero mai riconosciute come duplicate, causando righe
        # doppie a ogni reimport (bug reale, riprodotto in campo: 38 righe duplicate su 487,
        # tutte con Cliente vuoto nel file sorgente). Stesso pattern già in uso in
        # corrispettivi_import.py (`d.camera or ''`, `d.codice_prenotazione or ''`).
        camera = _v(row, colonne, 'camera')
        camera = str(camera).strip() if camera is not None else ''
        struttura_nome = _v(row, colonne, 'struttura_nome')

        struttura_code = struttura_da_camera(camera, struttura_nome, rooms_map)
        if not struttura_code:
            n_escluse += 1
            warning.append(f"Riga con camera '{camera}' del {data_rif}: struttura non risolvibile, riga scartata")
            continue

        articolo = _v(row, colonne, 'articolo')
        articolo = str(articolo).strip() if articolo is not None else ''
        is_riassetto = articolo.lower() == 'riassetto'

        totale = _num(_v(row, colonne, 'totale'))
        commissione = _num(_v(row, colonne, 'commissione'))

        categoria_id = _categoria_id_da_articolo(articolo, totale, mapping_dettagli, categorie_by_id)
        categoria = categorie_by_id.get(categoria_id) if categoria_id else None

        strutture_trovate.add(struttura_code)

        righe_out.append({
            'oid_welcome':         oid,
            'data_riferimento':    data_rif,
            'data_arrivo':         _parse_data(_v(row, colonne, 'arrivo')),
            'data_partenza':       _parse_data(_v(row, colonne, 'partenza')),
            'struttura_code':      struttura_code,
            'camera':              camera,
            'tipo_camera':         _v(row, colonne, 'tipo_camera'),
            'categoria_id':        categoria.id if categoria else None,
            'descrizione':         _v(row, colonne, 'reparto'),
            'sotto_descrizione':   _v(row, colonne, 'voce_addebito'),
            'dettaglio_originale': articolo,
            'is_riassetto':        is_riassetto,
            'prezzo_lordo':        totale,
            'prezzo_netto':        totale - commissione,
            'imponibile':          _num(_v(row, colonne, 'imponibile')),
            'iva':                 _num(_v(row, colonne, 'iva')),
            'aliquota_pct':        _num(_v(row, colonne, 'aliquota')),
            'quantita':            int(_num(_v(row, colonne, 'quantita')) or 1),
            'codice_prenotazione': _v(row, colonne, 'codice_prenotazione'),
            'ospite':              _v(row, colonne, 'ospite') or '',
            'trattamento':         _v(row, colonne, 'trattamento'),
            'canale':              _v(row, colonne, 'canale'),
            'segmento':            _v(row, colonne, 'segmento'),
            'tipo_ospite':         _v(row, colonne, 'tipo_ospite'),
        })
        if is_riassetto:
            n_riassetto += 1

    if not righe_out:
        raise ValueError("Nessuna riga valida trovata nel file")

    date_riferimento = [r['data_riferimento'] for r in righe_out]

    return {
        'righe': righe_out,
        'strutture_trovate': strutture_trovate,
        'data_da': min(date_riferimento),
        'data_a': max(date_riferimento),
        'n_righe_totali': n_totali,
        'n_valide': len(righe_out),
        'n_riassetto': n_riassetto,
        'n_escluse': n_escluse,
        'warning': warning,
    }
