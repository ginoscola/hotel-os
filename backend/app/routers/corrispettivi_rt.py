"""Sotto-router Corrispettivi — Controllo RT (chiusure registratore telematico).

Endpoint (montati sotto /corrispettivi dall'aggregatore corrispettivi.py):
  POST   /rt-chiusure                    → upsert chiusura RT giornaliera (admin)
  POST   /rt-chiusure/import-xml         → import CORRISP.xml caricato dall'utente (admin)
  POST   /rt-chiusure/import-da-stampante → legge CORRISP.xml dalla stampante (admin)
  GET    /rt-chiusure                    → lista mese con delta vs PMS
  DELETE /rt-chiusure/{id}               → elimina chiusura RT (admin)
"""
import re
import socket
import time
from datetime import date
from decimal import Decimal
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.corrispettivi import RtChiusura
from app.models.revenue import Hotel, RtPrinter
from app.services.corrisp_xml_parser import parse_corrisp_xml
from app.routers.corrispettivi_shared import STRUTTURE_HOTEL

router = APIRouter()

# RT1 = DPH + CLB (un'unica cassa fiscale), RT2 = INT
RT_STRUTTURE: dict = {
    'RT1': ['DPH', 'CLB'],
    'RT2': ['INT'],
}

# Tariffa tassa di soggiorno per persona/notte: l'importo Natura N1 (esente_n1) di un
# giorno deve essere un multiplo esatto di questa cifra, essendo tariffa × persone-notte.
# Se non lo è, quasi certamente c'è un errore di conteggio da correggere.
# RT1 è la cassa condivisa da Du Parc (2,50€) e Club Hotel (2,00€): qualunque combinazione
# di persone-notte tra i due hotel dà un totale valido, quindi il multiplo verificabile è
# solo il MCD tra le due tariffe (0,50€), non 2,50€ da sola (avrebbe dato falsi allarmi:
# es. 70,50€ = 1 persona-notte Du Parc + 34 persone-notte Club, combinazione legittima).
TARIFFA_TS_PER_PERSONA: dict = {
    'RT1': Decimal('0.50'),
    'RT2': Decimal('2.00'),
}


def _n1_non_quadra(esente_n1: Optional[Decimal], rt_code: str) -> bool:
    """True se esente_n1 non è multiplo esatto della tariffa TS per persona del RT."""
    if esente_n1 is None:
        return False
    tariffa = TARIFFA_TS_PER_PERSONA.get(rt_code)
    if not tariffa:
        return False
    return (Decimal(esente_n1) * 100) % (tariffa * 100) != 0


def _get_raw_http(ip: str, path: str, timeout: float = 8.0, port: int = 80, tentativi: int = 3) -> Tuple[int, bytes]:
    """
    GET grezzo via socket verso il file server della stampante RT (porta 80).

    Il file server della stampante (cartella /www/dati-rt/) invia un header
    'Transfer-Encoding: chunked' duplicato e comunque non rispettato (il corpo
    è in realtà semplice, non chunked): è una violazione RFC 7230 §3.3.3 che
    client HTTP conformi — httpx/h11 e i browser via fetch() — rifiutano per
    prevenire attacchi di request/response smuggling. Bypassiamo il problema
    leggendo i byte grezzi e ignorando del tutto l'intestazione Transfer-Encoding.

    Il web server integrato nella stampante è hardware molto limitato e a volte
    non risponde in tempo (es. occupato in una stampa): ritenta su errori di
    rete transitori invece di fallire al primo colpo.
    """
    grezzo = None
    for tentativo in range(tentativi):
        try:
            with socket.create_connection((ip, port), timeout=timeout) as sock:
                sock.sendall(f"GET {path} HTTP/1.1\r\nHost: {ip}\r\nConnection: close\r\n\r\n".encode('ascii'))
                sock.settimeout(timeout)
                pezzi = []
                while True:
                    try:
                        pezzo = sock.recv(65536)
                    except socket.timeout:
                        break
                    if not pezzo:
                        break
                    pezzi.append(pezzo)
            grezzo = b''.join(pezzi)
            if not grezzo:
                raise OSError("Risposta vuota dalla stampante")
            break
        except OSError:
            if tentativo < tentativi - 1:
                time.sleep(1.0)
                continue
            raise

    if b'\r\n\r\n' not in grezzo:
        raise OSError("Risposta HTTP incompleta o vuota dalla stampante")
    intestazioni, corpo = grezzo.split(b'\r\n\r\n', 1)
    prima_riga = intestazioni.split(b'\r\n', 1)[0]
    try:
        status_code = int(prima_riga.split(b' ')[1])
    except (IndexError, ValueError):
        status_code = 0
    return status_code, corpo


def _fmt_rt(r: RtChiusura) -> dict:
    return {
        'id': r.id,
        'data_chiusura': r.data_chiusura.isoformat(),
        'rt_code': r.rt_code,
        'totale_giorno': float(r.totale_giorno),
        'totale_10': float(r.totale_10) if r.totale_10 is not None else None,
        'totale_22': float(r.totale_22) if r.totale_22 is not None else None,
        'totale_ts': float(r.totale_ts) if r.totale_ts is not None else None,
        'totale_penali': float(r.totale_penali) if r.totale_penali is not None else None,
        'progressivo': r.progressivo,
        'imponibile_10': float(r.imponibile_10) if r.imponibile_10 is not None else None,
        'imposta_10': float(r.imposta_10) if r.imposta_10 is not None else None,
        'imponibile_22': float(r.imponibile_22) if r.imponibile_22 is not None else None,
        'imposta_22': float(r.imposta_22) if r.imposta_22 is not None else None,
        'esente_n1': float(r.esente_n1) if r.esente_n1 is not None else None,
        'tassa_soggiorno_nrs': float(r.tassa_soggiorno_nrs) if r.tassa_soggiorno_nrs is not None else None,
        'num_documenti': r.num_documenti,
        'pagato_contanti': float(r.pagato_contanti) if r.pagato_contanti is not None else None,
        'pagato_elettronico': float(r.pagato_elettronico) if r.pagato_elettronico is not None else None,
        'modificato_manualmente': r.modificato_manualmente,
        'note': r.note,
        'created_at': r.created_at.isoformat() if r.created_at else None,
    }


@router.post("/rt-chiusure")
def upsert_rt_chiusura(
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Inserisce o aggiorna la chiusura RT per una data. Upsert su (data_chiusura, rt_code)."""
    rt_code = body.get('rt_code')
    if rt_code not in RT_STRUTTURE:
        raise HTTPException(400, f"rt_code non valido: usa {list(RT_STRUTTURE.keys())}")
    try:
        data = date.fromisoformat(body['data_chiusura'])
    except (KeyError, ValueError):
        raise HTTPException(400, "data_chiusura non valida (formato YYYY-MM-DD)")
    if body.get('totale_giorno') is None:
        raise HTTPException(400, "totale_giorno obbligatorio")

    def _dec(v):
        return Decimal(str(v)) if v is not None else None

    esistente = db.query(RtChiusura).filter(
        RtChiusura.data_chiusura == data,
        RtChiusura.rt_code == rt_code,
    ).first()

    if esistente:
        esistente.totale_giorno = _dec(body['totale_giorno'])
        esistente.totale_10 = _dec(body.get('totale_10'))
        esistente.totale_22 = _dec(body.get('totale_22'))
        esistente.totale_ts = _dec(body.get('totale_ts'))
        esistente.totale_penali = _dec(body.get('totale_penali'))
        esistente.note = body.get('note')
        esistente.updated_by = utente.id
        esistente.modificato_manualmente = True
        db.commit()
        db.refresh(esistente)
        return _fmt_rt(esistente)

    nuovo = RtChiusura(
        data_chiusura=data,
        rt_code=rt_code,
        totale_giorno=_dec(body['totale_giorno']),
        totale_10=_dec(body.get('totale_10')),
        totale_22=_dec(body.get('totale_22')),
        totale_ts=_dec(body.get('totale_ts')),
        totale_penali=_dec(body.get('totale_penali')),
        note=body.get('note'),
        created_by=utente.id,
        modificato_manualmente=True,
    )
    db.add(nuovo)
    db.commit()
    db.refresh(nuovo)
    return _fmt_rt(nuovo)


def _upsert_rt_chiusura_da_xml(dati: dict, rt_code: str, on_conflict: str, db: Session, utente) -> dict:
    """Upsert condiviso tra import da file caricato e import diretto dalla stampante."""

    def _risposta(esito: str, warning: Optional[str] = None) -> dict:
        return {
            'esito': esito,
            'data_chiusura': dati['data_chiusura'].isoformat(),
            'rt_code': rt_code,
            'totale_giorno': float(dati['totale_giorno']),
            'progressivo': dati['progressivo'],
            'warning': warning,
        }

    esistente = db.query(RtChiusura).filter(
        RtChiusura.data_chiusura == dati['data_chiusura'],
        RtChiusura.rt_code == rt_code,
    ).first()

    if esistente:
        if on_conflict == 'salta':
            return _risposta('saltato', 'Riga già presente — saltata')
        if esistente.modificato_manualmente:
            return _risposta('saltato', 'Riga modificata manualmente — non sovrascritta')
        for campo, valore in dati.items():
            setattr(esistente, campo, valore)
        esistente.updated_by = utente.id
        db.commit()
        return _risposta('aggiornato')

    nuovo = RtChiusura(rt_code=rt_code, created_by=utente.id, modificato_manualmente=False, **dati)
    db.add(nuovo)
    db.commit()
    return _risposta('inserito')


@router.post("/rt-chiusure/import-xml")
def importa_rt_chiusura_xml(
    file: UploadFile = File(...),
    rt_code: str = Query(..., description="RT1 (DPH+CLB) o RT2 (INT)"),
    on_conflict: str = Query('salta', description="'salta' (non tocca righe già presenti) o 'aggiorna' (rispetta modificato_manualmente)"),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Importa un file CORRISP.xml caricato dall'utente e popola/aggiorna rt_chiusure."""
    if rt_code not in RT_STRUTTURE:
        raise HTTPException(400, f"rt_code non valido: usa {list(RT_STRUTTURE.keys())}")
    if on_conflict not in ('salta', 'aggiorna'):
        raise HTTPException(400, "on_conflict deve essere 'salta' o 'aggiorna'")
    if not file.filename.lower().endswith('.xml'):
        raise HTTPException(400, "Solo file .xml accettati")

    contenuto = file.file.read()
    try:
        dati = parse_corrisp_xml(contenuto)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Errore parsing CORRISP.xml: {exc}")

    return _upsert_rt_chiusura_da_xml(dati, rt_code, on_conflict, db, utente)


@router.post("/rt-chiusure/import-da-stampante")
def importa_rt_chiusura_da_stampante(
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """
    Legge il file CORRISP.xml direttamente dalla cartella della stampante, lato backend.

    Il file server della stampante (/www/dati-rt/) invia una risposta HTTP malformata
    (header Transfer-Encoding: chunked duplicato, corpo in realtà non chunked — violazione
    RFC 7230 §3.3.3): sia fetch() nel browser sia httpx/h11 in Python la rifiutano come
    possibile request/response smuggling. Per questo si usa _get_raw_http() (socket grezzo)
    invece di httpx, e la richiesta parte dal backend anziché dal browser.

    Body: { rt_code: "RT1"|"RT2", data: "YYYY-MM-DD", on_conflict: "salta"|"aggiorna" }
    """
    rt_code = body.get('rt_code')
    on_conflict = body.get('on_conflict', 'salta')
    if rt_code not in RT_STRUTTURE:
        raise HTTPException(400, f"rt_code non valido: usa {list(RT_STRUTTURE.keys())}")
    if on_conflict not in ('salta', 'aggiorna'):
        raise HTTPException(400, "on_conflict deve essere 'salta' o 'aggiorna'")
    try:
        data = date.fromisoformat(body.get('data', ''))
    except ValueError:
        raise HTTPException(400, "data non valida (formato YYYY-MM-DD)")

    printer = (
        db.query(RtPrinter)
        .join(Hotel, Hotel.rt_printer_id == RtPrinter.id)
        .filter(Hotel.code.in_(RT_STRUTTURE[rt_code]))
        .first()
    )
    if not printer:
        raise HTTPException(404, f"Nessuna stampante RT configurata per {rt_code} (Admin → Stampanti RT)")

    cartella = data.strftime('%Y%m%d')
    path_cartella = f"/www/dati-rt/{cartella}/"

    try:
        status_lista, corpo_lista = _get_raw_http(printer.ip, path_cartella)
    except OSError as exc:
        raise HTTPException(502, f"Stampante non raggiungibile ({printer.ip}): {exc}")
    if status_lista != 200:
        raise HTTPException(404, f"Cartella non trovata sulla stampante per il {data.strftime('%d/%m/%Y')}")

    nomi_trovati = re.findall(r'href="([^"]*CORRISP[^"]*\.xml)"', corpo_lista.decode('utf-8', errors='replace'), re.IGNORECASE)
    if not nomi_trovati:
        raise HTTPException(404, f"Nessun file CORRISP.xml trovato per il {data.strftime('%d/%m/%Y')}")
    nome_file = nomi_trovati[-1]

    try:
        status_file, corpo_file = _get_raw_http(printer.ip, path_cartella + nome_file)
    except OSError as exc:
        raise HTTPException(502, f"Stampante non raggiungibile ({printer.ip}): {exc}")
    if status_file != 200:
        raise HTTPException(502, f"Errore lettura file dalla stampante (HTTP {status_file})")

    try:
        dati = parse_corrisp_xml(corpo_file)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Errore parsing CORRISP.xml: {exc}")

    risultato = _upsert_rt_chiusura_da_xml(dati, rt_code, on_conflict, db, utente)
    risultato['nome_file'] = nome_file
    return risultato


@router.get("/rt-chiusure")
def lista_rt_chiusure(
    mese: int = Query(..., ge=1, le=12),
    anno: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    _utente=Depends(richiedi_utente_attivo),
):
    """Restituisce i giorni del mese con chiusure RT e il confronto vs scontrini PMS (lordi)."""
    from calendar import monthrange
    from datetime import date as date_t

    _, ultimo_giorno = monthrange(anno, mese)
    data_da = date_t(anno, mese, 1)
    data_a = date_t(anno, mese, ultimo_giorno)

    # Aggregazione scontrini PMS per data e struttura, breakdown per natura IVA.
    # Per la tassa soggiorno usiamo la COLONNA tassa_soggiorno (formato esteso) che
    # cattura sia la TS disaggregata dagli arrangiamenti sia i documenti standalone.
    # Fallback per formato base (colonna NULL): usa totale_lordo dei doc categoria='tassa_soggiorno'.
    # Per gli arrangiamenti, sottraiamo la parte TS già conteggiata nella colonna.
    rows_pms = db.execute(text("""
        SELECT
            data_documento,
            struttura_code,
            SUM(totale_lordo) FILTER (WHERE tipo = 'scontrino') AS totale,
            SUM(CASE
                WHEN tipo='scontrino' AND categoria='arrangiamenti' AND tassa_soggiorno IS NOT NULL
                    THEN totale_lordo - tassa_soggiorno
                WHEN tipo='scontrino' AND categoria='arrangiamenti'
                    THEN totale_lordo
                ELSE 0
            END) AS arr,
            SUM(totale_lordo) FILTER (WHERE tipo = 'scontrino' AND categoria = 'shop') AS shop,
            SUM(CASE
                WHEN tipo='scontrino' AND tassa_soggiorno IS NOT NULL
                    THEN tassa_soggiorno
                WHEN tipo='scontrino' AND categoria='tassa_soggiorno'
                    THEN totale_lordo
                ELSE 0
            END) AS ts,
            SUM(totale_lordo) FILTER (WHERE tipo = 'scontrino' AND categoria = 'penali') AS penali
        FROM corrispettivi_documenti
        WHERE data_documento BETWEEN :da AND :a
          AND struttura_code = ANY(:strutture)
        GROUP BY data_documento, struttura_code
    """), {'da': data_da, 'a': data_a, 'strutture': STRUTTURE_HOTEL}).fetchall()

    # Indice: data_iso → struttura_code → {totale, arr, shop, ts, penali}
    pms_idx: dict = {}
    for row in rows_pms:
        d = row.data_documento.isoformat()
        pms_idx.setdefault(d, {})[row.struttura_code] = {
            'totale': float(row.totale or 0),
            'arr':    float(row.arr or 0),
            'shop':   float(row.shop or 0),
            'ts':     float(row.ts or 0),
            'penali': float(row.penali or 0),
        }

    # Chiusure RT del mese
    rt_rows = db.query(RtChiusura).filter(
        RtChiusura.data_chiusura >= data_da,
        RtChiusura.data_chiusura <= data_a,
    ).all()

    rt_idx: dict = {}
    for r in rt_rows:
        rt_idx.setdefault(r.data_chiusura.isoformat(), {})[r.rt_code] = r

    def _pms_agg(data_iso: str, strutture: list) -> dict:
        totale = arr = shop = ts = penali = 0.0
        for s in strutture:
            v = pms_idx.get(data_iso, {}).get(s, {})
            totale += v.get('totale', 0.0)
            arr    += v.get('arr', 0.0)
            shop   += v.get('shop', 0.0)
            ts     += v.get('ts', 0.0)
            penali += v.get('penali', 0.0)
        return {'totale': totale, 'arr': arr, 'shop': shop, 'ts': ts, 'penali': penali}

    def _confronta(rt: Optional[RtChiusura], pms: dict, rt_code: str) -> dict:
        if rt is None:
            return {'rt': None, 'pms': pms, 'delta': None, 'breakdown': None}
        rt_tot = float(rt.totale_giorno)
        delta = round(rt_tot - pms['totale'], 2)
        # Breakdown analitico solo se tutti i 4 campi natura IVA sono compilati
        breakdown = None
        if all(v is not None for v in [rt.totale_10, rt.totale_22, rt.totale_ts, rt.totale_penali]):
            breakdown = {
                '10':     {'rt': float(rt.totale_10),     'pms': pms['arr'],    'delta': round(float(rt.totale_10)     - pms['arr'],    2)},
                '22':     {'rt': float(rt.totale_22),     'pms': pms['shop'],   'delta': round(float(rt.totale_22)     - pms['shop'],   2)},
                'ts':     {'rt': float(rt.totale_ts),     'pms': pms['ts'],     'delta': round(float(rt.totale_ts)     - pms['ts'],     2)},
                'penali': {'rt': float(rt.totale_penali), 'pms': pms['penali'], 'delta': round(float(rt.totale_penali) - pms['penali'], 2)},
            }
        return {
            'rt': {
                'id':            rt.id,
                'totale_giorno': rt_tot,
                'totale_10':     float(rt.totale_10)     if rt.totale_10     is not None else None,
                'totale_22':     float(rt.totale_22)     if rt.totale_22     is not None else None,
                'totale_ts':     float(rt.totale_ts)     if rt.totale_ts     is not None else None,
                'totale_penali': float(rt.totale_penali) if rt.totale_penali is not None else None,
                'esente_n1':     float(rt.esente_n1)     if rt.esente_n1     is not None else None,
                'n1_non_quadra': _n1_non_quadra(rt.esente_n1, rt_code),
                'imponibile_10': float(rt.imponibile_10) if rt.imponibile_10 is not None else None,
                'imposta_10':    float(rt.imposta_10)    if rt.imposta_10    is not None else None,
                'imponibile_22': float(rt.imponibile_22) if rt.imponibile_22 is not None else None,
                'imposta_22':    float(rt.imposta_22)    if rt.imposta_22    is not None else None,
                'note':          rt.note,
            },
            'pms': pms,
            'delta': delta,
            'breakdown': breakdown,
        }

    giorni = []
    for g in range(1, ultimo_giorno + 1):
        d = date_t(anno, mese, g)
        d_iso = d.isoformat()
        pms1 = _pms_agg(d_iso, RT_STRUTTURE['RT1'])
        pms2 = _pms_agg(d_iso, RT_STRUTTURE['RT2'])
        rt1 = rt_idx.get(d_iso, {}).get('RT1')
        rt2 = rt_idx.get(d_iso, {}).get('RT2')
        # Includi il giorno solo se c'è almeno un dato (PMS o RT)
        if pms1['totale'] == 0 and pms2['totale'] == 0 and not rt1 and not rt2:
            continue
        giorni.append({
            'data': d_iso,
            'rt1': _confronta(rt1, pms1, 'RT1'),
            'rt2': _confronta(rt2, pms2, 'RT2'),
        })

    n_differenze = sum(
        1 for g in giorni
        if (g['rt1']['delta'] is not None and abs(g['rt1']['delta']) > 0.01)
        or (g['rt2']['delta'] is not None and abs(g['rt2']['delta']) > 0.01)
    )

    return {'mese': mese, 'anno': anno, 'giorni': giorni, 'n_differenze': n_differenze}


@router.delete("/rt-chiusure/{chiusura_id}")
def elimina_rt_chiusura(
    chiusura_id: int,
    db: Session = Depends(get_db),
    _utente=Depends(richiedi_admin),
):
    """Elimina una chiusura RT."""
    rt = db.query(RtChiusura).filter(RtChiusura.id == chiusura_id).first()
    if not rt:
        raise HTTPException(404, "Chiusura RT non trovata")
    db.delete(rt)
    db.commit()
    return {'ok': True}
