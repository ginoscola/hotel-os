"""Router modulo Analisi Ricavi — trattamenti e reparti mensili.

Endpoint:
  POST   /analisi-ricavi/import                → upload 2 CSV (auto-detect) per hotel/mese
  GET    /analisi-ricavi/import/storico        → lista sessioni import
  DELETE /analisi-ricavi/import/{id}           → elimina import e dati collegati

  GET    /analisi-ricavi/trattamenti           → ?hotel_code=&anno=&mese=
  PUT    /analisi-ricavi/trattamenti/{id}      → modifica manuale valore
  GET    /analisi-ricavi/reparti               → ?hotel_code=&anno=&mese=
  PUT    /analisi-ricavi/reparti/{id}          → modifica manuale valore
  GET    /analisi-ricavi/gruppo                → ?anno=&mese= (tutti gli hotel aggregati)
  GET    /analisi-ricavi/export                → ?hotel_code=&anno=&mese=&mese_fine=&vista_dettaglio=
                                                   export Excel della vista corrente (hotel o GRUPPO)

  GET    /analisi-ricavi/classificazione       → lista mapping codici
  POST   /analisi-ricavi/classificazione       → aggiunge nuovo codice
  PUT    /analisi-ricavi/classificazione/{codice} → aggiorna nome/categoria/escludi
"""

from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import richiedi_admin, richiedi_utente_attivo
from app.models.analisi_ricavi import (
    AnalisiRicaviImport,
    AnalisiRicaviReparto,
    AnalisiRicaviTrattamento,
    TrattamentoClassificazione,
)
from app.models.revenue import Hotel
from app.services.analisi_ricavi_parser import auto_rileva_coppia

router = APIRouter(prefix="/analisi-ricavi", tags=["analisi-ricavi"])

MESI_IT = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
           'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hotel_by_code(db: Session, hotel_code: str) -> Hotel:
    h = db.query(Hotel).filter(Hotel.code == hotel_code.upper()).first()
    if not h:
        raise HTTPException(404, f"Hotel '{hotel_code}' non trovato")
    return h


def _fmt_import(imp: AnalisiRicaviImport, hotel_code: str) -> dict:
    return {
        'id': imp.id,
        'hotel_code': hotel_code,
        'anno': imp.anno,
        'mese': imp.mese,
        'mese_nome': MESI_IT[imp.mese],
        'granularita': imp.granularita,
        'filename_trattamenti': imp.filename_trattamenti,
        'filename_reparti': imp.filename_reparti,
        'n_trattamenti': imp.n_trattamenti,
        'n_reparti': imp.n_reparti,
        'is_test': imp.is_test,
        'created_at': imp.created_at.isoformat() if imp.created_at else None,
    }


def _applica_ridistribuzione(trattamenti: list, classificazioni: dict) -> list:
    """Ridistribuisce proporzionalmente i trattamenti marcati come 'escludi'.

    Algoritmo:
    1. Somma i valori degli esclusi
    2. Calcola il totale dei non-esclusi
    3. Aggiunge a ogni non-escluso: valore += esclusi_totale * (valore / totale_non_esclusi)
    """
    escludi_codici = {c for c, cl in classificazioni.items() if cl.get('escludi')}
    esclusi = [t for t in trattamenti if t['codice'] in escludi_codici]
    non_esclusi = [t for t in trattamenti if t['codice'] not in escludi_codici]

    if not esclusi or not non_esclusi:
        return non_esclusi

    tot_esclusi = sum(t['valore'] for t in esclusi)
    tot_non_esclusi = sum(t['valore'] for t in non_esclusi)

    if tot_non_esclusi == 0:
        return non_esclusi

    result = []
    for t in non_esclusi:
        quota = tot_esclusi * (t['valore'] / tot_non_esclusi)
        result.append({**t, 'valore': round(t['valore'] + quota, 2),
                       'valore_redistribuito': round(quota, 2)})
    return result


def _arricchisci_trattamenti(rows: list, classificazioni: dict, totale: float) -> list:
    """Aggiunge nome_display, categoria, pct sul totale. Applica ridistribuzione Non Def."""
    result = []
    for r in rows:
        cl = classificazioni.get(r.codice, {})
        result.append({
            'id': r.id,
            'codice': r.codice,
            'nome_display': cl.get('nome_display') or r.codice,
            'categoria': cl.get('categoria'),
            'escludi': cl.get('escludi', False),
            'colore': cl.get('colore'),  # None = usa palette default frontend
            'valore': float(r.valore),
            'valore_redistribuito': 0.0,
            'pct': round(float(r.valore) / totale * 100, 2) if totale > 0 else 0,
            'modificato_manualmente': r.modificato_manualmente,
            'valore_originale': float(r.valore_originale) if r.valore_originale else None,
        })
    return _applica_ridistribuzione(result, classificazioni)


# ── Import ────────────────────────────────────────────────────────────────────

@router.post("/import")
async def importa_csv(
    hotel_code: str = Form(...),
    anno: int = Form(...),
    mese: int = Form(..., ge=1, le=12),
    is_test: bool = Form(False),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Importa la coppia di file CSV (trattamenti + reparti) per un hotel/mese.

    Auto-rileva quale file è quale dal contenuto. Blocca se esistono già dati
    per questo hotel/mese — usare ?forza=true per sovrascrivere.
    """
    if len(files) < 1 or len(files) > 2:
        raise HTTPException(400, "Caricare 1 o 2 file CSV (trattamenti e/o reparti)")

    hotel = _hotel_by_code(db, hotel_code)

    # Leggi i file in memoria
    file_data = []
    for f in files:
        raw = await f.read()
        file_data.append((f.filename or '', raw))

    # Auto-rileva la coppia
    try:
        res_tratt, res_rep = auto_rileva_coppia(file_data)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not res_tratt and not res_rep:
        raise HTTPException(400, "Nessun file valido rilevato")

    # Controlla se esistono già dati per questo hotel/mese
    esistente = db.query(AnalisiRicaviImport).filter(
        AnalisiRicaviImport.hotel_id == hotel.id,
        AnalisiRicaviImport.anno == anno,
        AnalisiRicaviImport.mese == mese,
        AnalisiRicaviImport.granularita == 'mensile',
    ).first()

    if esistente:
        raise HTTPException(409, {
            'messaggio': f"Esistono già dati per {hotel_code} {MESI_IT[mese]} {anno}.",
            'import_id': esistente.id,
            'n_trattamenti': esistente.n_trattamenti,
            'n_reparti': esistente.n_reparti,
            'created_at': esistente.created_at.isoformat() if esistente.created_at else None,
            'richiede_conferma': True,
        })

    return _salva_import(db, hotel, anno, mese, res_tratt, res_rep, is_test, utente.id)


@router.post("/import/sovrascrivi")
async def importa_csv_sovrascrivi(
    hotel_code: str = Form(...),
    anno: int = Form(...),
    mese: int = Form(..., ge=1, le=12),
    is_test: bool = Form(False),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Sovrascrive un import esistente dopo conferma utente."""
    if len(files) < 1 or len(files) > 2:
        raise HTTPException(400, "Caricare 1 o 2 file CSV")

    hotel = _hotel_by_code(db, hotel_code)
    file_data = [(f.filename or '', await f.read()) for f in files]

    try:
        res_tratt, res_rep = auto_rileva_coppia(file_data)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Elimina import esistente (cascade elimina trattamenti e reparti)
    db.query(AnalisiRicaviImport).filter(
        AnalisiRicaviImport.hotel_id == hotel.id,
        AnalisiRicaviImport.anno == anno,
        AnalisiRicaviImport.mese == mese,
        AnalisiRicaviImport.granularita == 'mensile',
    ).delete()
    db.commit()

    return _salva_import(db, hotel, anno, mese, res_tratt, res_rep, is_test, utente.id)


def _salva_import(db, hotel, anno, mese, res_tratt, res_rep, is_test, user_id):
    """Salva l'import e le righe nel DB. Auto-aggiunge nuovi codici alla classificazione."""
    imp = AnalisiRicaviImport(
        hotel_id=hotel.id,
        anno=anno,
        mese=mese,
        granularita='mensile',
        filename_trattamenti=res_tratt.tipo == 'trattamenti' and res_tratt and
                             _nome_file(res_tratt) or None,
        filename_reparti=res_rep and _nome_file(res_rep) or None,
        n_trattamenti=res_tratt.n_righe if res_tratt else 0,
        n_reparti=res_rep.n_righe if res_rep else 0,
        is_test=is_test,
        created_by=user_id,
    )
    db.add(imp)
    db.flush()  # ottieni imp.id

    # Salva trattamenti e auto-aggiunge nuovi codici alla classificazione
    if res_tratt:
        codici_esistenti = {c.codice for c in db.query(TrattamentoClassificazione).all()}
        for riga in res_tratt.trattamenti:
            if riga.codice not in codici_esistenti:
                # Nuovo codice: aggiunto con categoria NULL (da classificare in admin)
                db.add(TrattamentoClassificazione(
                    codice=riga.codice,
                    nome_display=riga.codice,
                    categoria=None,
                    escludi=False,
                    ordine=50,
                ))
                codici_esistenti.add(riga.codice)
            db.add(AnalisiRicaviTrattamento(
                import_id=imp.id,
                hotel_id=hotel.id,
                anno=anno,
                mese=mese,
                codice=riga.codice,
                valore=riga.valore,
            ))

    # Salva reparti
    if res_rep:
        for riga in res_rep.reparti:
            db.add(AnalisiRicaviReparto(
                import_id=imp.id,
                hotel_id=hotel.id,
                anno=anno,
                mese=mese,
                reparto=riga.reparto,
                valore=riga.valore,
            ))

    db.commit()
    db.refresh(imp)

    warnings = []
    if res_tratt:
        warnings += res_tratt.warnings
    if res_rep:
        warnings += res_rep.warnings

    return {
        'id': imp.id,
        'hotel_code': hotel.code,
        'anno': anno,
        'mese': mese,
        'mese_nome': MESI_IT[mese],
        'n_trattamenti': imp.n_trattamenti,
        'n_reparti': imp.n_reparti,
        'totale_trattamenti': float(res_tratt.totale) if res_tratt else None,
        'totale_reparti': float(res_rep.totale) if res_rep else None,
        'warnings': warnings,
    }


def _nome_file(r) -> str:
    return ''  # il filename è già nel res ma non lo salviamo


@router.get("/import/storico")
def storico_import(
    hotel_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _u=Depends(richiedi_utente_attivo),
):
    q = db.query(AnalisiRicaviImport, Hotel.code).join(
        Hotel, Hotel.id == AnalisiRicaviImport.hotel_id
    ).order_by(AnalisiRicaviImport.anno.desc(), AnalisiRicaviImport.mese.desc())
    if hotel_code:
        q = q.filter(Hotel.code == hotel_code.upper())
    return [_fmt_import(imp, code) for imp, code in q.all()]


@router.delete("/import/{import_id}")
def elimina_import(
    import_id: int,
    conferma: bool = Query(False),
    db: Session = Depends(get_db),
    _u=Depends(richiedi_admin),
):
    if not conferma:
        raise HTTPException(400, "Aggiungere ?conferma=true per eliminare")
    imp = db.query(AnalisiRicaviImport).filter(AnalisiRicaviImport.id == import_id).first()
    if not imp:
        raise HTTPException(404, "Import non trovato")
    db.delete(imp)
    db.commit()
    return {'ok': True, 'id': import_id}


# ── Trattamenti ───────────────────────────────────────────────────────────────

@router.get("/trattamenti")
def get_trattamenti(
    hotel_code: str = Query(...),
    anno: int = Query(...),
    mese: int = Query(..., ge=1, le=12),
    mese_fine: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    _u=Depends(richiedi_utente_attivo),
):
    hotel = _hotel_by_code(db, hotel_code)
    mese_fine = mese_fine or mese

    # Aggrega per codice su tutti i mesi del range (stesso anno)
    rows_raw = db.query(
        AnalisiRicaviTrattamento.codice,
        func.sum(AnalisiRicaviTrattamento.valore).label('valore'),
        func.bool_or(AnalisiRicaviTrattamento.modificato_manualmente).label('modificato_manualmente'),
    ).filter(
        AnalisiRicaviTrattamento.hotel_id == hotel.id,
        AnalisiRicaviTrattamento.anno == anno,
        AnalisiRicaviTrattamento.mese >= mese,
        AnalisiRicaviTrattamento.mese <= mese_fine,
    ).group_by(AnalisiRicaviTrattamento.codice).all()

    # Crea oggetti compatibili con _arricchisci_trattamenti
    class _R:
        def __init__(self, codice, valore, modificato_manualmente):
            self.id = None
            self.codice = codice
            self.valore = valore
            self.modificato_manualmente = modificato_manualmente
            self.valore_originale = None

    rows = [_R(r.codice, r.valore, r.modificato_manualmente) for r in rows_raw]

    classificazioni = {c.codice: {
        'nome_display': c.nome_display,
        'categoria': c.categoria,
        'escludi': c.escludi,
        'ordine': c.ordine,
        'colore': c.colore,
    } for c in db.query(TrattamentoClassificazione).all()}

    totale_lordo = sum(float(r.valore) for r in rows)
    trattamenti = _arricchisci_trattamenti(rows, classificazioni, totale_lordo)

    totale_finale = sum(t['valore'] for t in trattamenti)
    for t in trattamenti:
        t['pct'] = round(t['valore'] / totale_finale * 100, 2) if totale_finale > 0 else 0

    label = MESI_IT[mese] if mese == mese_fine else f"{MESI_IT[mese]}–{MESI_IT[mese_fine]}"
    return {
        'hotel_code': hotel_code.upper(),
        'anno': anno,
        'mese': mese,
        'mese_fine': mese_fine,
        'mese_nome': label,
        'trattamenti': sorted(trattamenti, key=lambda x: classificazioni.get(
            x['codice'], {}).get('ordine', 50)),
        'totale': round(totale_finale, 2),
        'n_non_classificati': sum(1 for t in trattamenti if not t['categoria']),
    }


@router.put("/trattamenti/{riga_id}")
def modifica_trattamento(
    riga_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _u=Depends(richiedi_admin),
):
    r = db.query(AnalisiRicaviTrattamento).filter(
        AnalisiRicaviTrattamento.id == riga_id).first()
    if not r:
        raise HTTPException(404, "Riga non trovata")
    if 'valore' in body:
        if not r.modificato_manualmente:
            r.valore_originale = r.valore
            r.modificato_manualmente = True
        r.valore = Decimal(str(body['valore']))
    db.commit()
    return {'ok': True, 'id': riga_id, 'valore': float(r.valore),
            'modificato_manualmente': r.modificato_manualmente}


# ── Reparti ───────────────────────────────────────────────────────────────────

@router.get("/reparti")
def get_reparti(
    hotel_code: str = Query(...),
    anno: int = Query(...),
    mese: int = Query(..., ge=1, le=12),
    mese_fine: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    _u=Depends(richiedi_utente_attivo),
):
    hotel = _hotel_by_code(db, hotel_code)
    mese_fine = mese_fine or mese

    rows = db.query(
        AnalisiRicaviReparto.reparto,
        func.sum(AnalisiRicaviReparto.valore).label('valore'),
        func.bool_or(AnalisiRicaviReparto.modificato_manualmente).label('modificato_manualmente'),
    ).filter(
        AnalisiRicaviReparto.hotel_id == hotel.id,
        AnalisiRicaviReparto.anno == anno,
        AnalisiRicaviReparto.mese >= mese,
        AnalisiRicaviReparto.mese <= mese_fine,
    ).group_by(AnalisiRicaviReparto.reparto).order_by(
        func.sum(AnalisiRicaviReparto.valore).desc()
    ).all()

    totale = sum(float(r.valore) for r in rows)

    # Confronto con Revenue module (solo singolo mese, non range)
    revenue_camere_fnb = _revenue_da_daily(db, hotel.id, anno, mese) if mese == mese_fine else None

    reparti = []
    for r in rows:
        v = float(r.valore)
        reparti.append({
            'reparto': r.reparto,
            'valore': v,
            'pct': round(v / totale * 100, 2) if totale > 0 else 0,
            'modificato_manualmente': r.modificato_manualmente,
        })

    label = MESI_IT[mese] if mese == mese_fine else f"{MESI_IT[mese]}–{MESI_IT[mese_fine]}"
    return {
        'hotel_code': hotel_code.upper(),
        'anno': anno,
        'mese': mese,
        'mese_fine': mese_fine,
        'mese_nome': label,
        'reparti': reparti,
        'totale': round(totale, 2),
        'revenue_module': revenue_camere_fnb,
    }


def _revenue_da_daily(db: Session, hotel_id: int, anno: int, mese: int) -> Optional[dict]:
    """Legge revenue_rooms + revenue_fnb da daily_revenue per il mese/anno.
    Usa la snapshot più recente per ogni data (evita duplicati forecast).
    """
    try:
        result = db.execute(text("""
            WITH latest AS (
                SELECT data, MAX(snapshot_date) AS snap
                FROM daily_revenue
                WHERE hotel_id = :hid
                  AND EXTRACT(YEAR FROM data) = :anno
                  AND EXTRACT(MONTH FROM data) = :mese
                GROUP BY data
            )
            SELECT
                SUM(dr.revenue_rooms)  AS rooms,
                SUM(dr.revenue_fnb)    AS fnb,
                SUM(dr.revenue_extra)  AS extra,
                SUM(dr.revenue_total)  AS totale
            FROM daily_revenue dr
            JOIN latest ON dr.data = latest.data AND dr.snapshot_date = latest.snap
            WHERE dr.hotel_id = :hid
        """), {'hid': hotel_id, 'anno': anno, 'mese': mese}).fetchone()

        if result and result.totale:
            return {
                'revenue_rooms': float(result.rooms or 0),
                'revenue_fnb': float(result.fnb or 0),
                'revenue_extra': float(result.extra or 0),
                'revenue_totale': float(result.totale or 0),
            }
    except Exception:
        pass
    return None


@router.put("/reparti/{riga_id}")
def modifica_reparto(
    riga_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _u=Depends(richiedi_admin),
):
    r = db.query(AnalisiRicaviReparto).filter(
        AnalisiRicaviReparto.id == riga_id).first()
    if not r:
        raise HTTPException(404, "Riga non trovata")
    if 'valore' in body:
        if not r.modificato_manualmente:
            r.valore_originale = r.valore
            r.modificato_manualmente = True
        r.valore = Decimal(str(body['valore']))
    db.commit()
    return {'ok': True, 'id': riga_id, 'valore': float(r.valore),
            'modificato_manualmente': r.modificato_manualmente}


# ── Vista gruppo ──────────────────────────────────────────────────────────────

@router.get("/gruppo")
def get_gruppo(
    anno: int = Query(...),
    mese: int = Query(..., ge=1, le=12),
    mese_fine: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    _u=Depends(richiedi_utente_attivo),
):
    """Aggrega trattamenti e reparti di tutti gli hotel per il mese (o range di mesi)."""
    mese_fine = mese_fine or mese
    classificazioni = {c.codice: {
        'nome_display': c.nome_display,
        'categoria': c.categoria,
        'escludi': c.escludi,
        'ordine': c.ordine,
        'colore': c.colore,
    } for c in db.query(TrattamentoClassificazione).all()}

    # Trattamenti: raggruppa per codice + hotel su tutti i mesi del range
    tratt_rows = db.query(
        AnalisiRicaviTrattamento.codice,
        func.sum(AnalisiRicaviTrattamento.valore).label('valore'),
        Hotel.code.label('hotel_code'),
    ).join(Hotel, Hotel.id == AnalisiRicaviTrattamento.hotel_id).filter(
        AnalisiRicaviTrattamento.anno == anno,
        AnalisiRicaviTrattamento.mese >= mese,
        AnalisiRicaviTrattamento.mese <= mese_fine,
    ).group_by(AnalisiRicaviTrattamento.codice, Hotel.code).all()

    by_codice: dict = {}
    hotel_codes_tratt = set()
    for row in tratt_rows:
        hotel_codes_tratt.add(row.hotel_code)
        entry = by_codice.setdefault(row.codice, {'codice': row.codice, 'valore': 0.0,
                                                    'per_hotel': {}})
        entry['valore'] += float(row.valore)
        entry['per_hotel'][row.hotel_code] = float(row.valore)

    totale_tratt = sum(e['valore'] for e in by_codice.values())
    trattamenti = _arricchisci_trattamenti(
        [type('R', (), {'id': None, 'codice': v['codice'], 'valore': Decimal(str(v['valore'])),
                        'modificato_manualmente': False, 'valore_originale': None})()
         for v in by_codice.values()],
        classificazioni, totale_tratt
    )
    totale_finale = sum(t['valore'] for t in trattamenti)
    for t in trattamenti:
        t['pct'] = round(t['valore'] / totale_finale * 100, 2) if totale_finale > 0 else 0
        t['per_hotel'] = by_codice.get(t['codice'], {}).get('per_hotel', {})

    # Reparti: raggruppa per nome reparto su tutti gli hotel e mesi
    rep_rows = db.query(
        AnalisiRicaviReparto.reparto,
        func.sum(AnalisiRicaviReparto.valore).label('valore'),
        Hotel.code.label('hotel_code'),
    ).join(Hotel, Hotel.id == AnalisiRicaviReparto.hotel_id).filter(
        AnalisiRicaviReparto.anno == anno,
        AnalisiRicaviReparto.mese >= mese,
        AnalisiRicaviReparto.mese <= mese_fine,
    ).group_by(AnalisiRicaviReparto.reparto, Hotel.code).all()

    by_reparto: dict = {}
    hotel_codes_rep = set()
    for row in rep_rows:
        hotel_codes_rep.add(row.hotel_code)
        entry = by_reparto.setdefault(row.reparto, {'reparto': row.reparto, 'valore': 0.0,
                                                      'per_hotel': {}})
        entry['valore'] += float(row.valore)
        entry['per_hotel'][row.hotel_code] = float(row.valore)

    totale_rep = sum(e['valore'] for e in by_reparto.values())
    reparti = sorted(by_reparto.values(), key=lambda x: x['valore'], reverse=True)
    for r in reparti:
        r['pct'] = round(r['valore'] / totale_rep * 100, 2) if totale_rep > 0 else 0

    label = MESI_IT[mese] if mese == mese_fine else f"{MESI_IT[mese]}–{MESI_IT[mese_fine]}"
    return {
        'anno': anno,
        'mese': mese,
        'mese_fine': mese_fine,
        'mese_nome': label,
        'hotel_codes': sorted(hotel_codes_tratt | hotel_codes_rep),
        'trattamenti': sorted(trattamenti, key=lambda x: classificazioni.get(
            x['codice'], {}).get('ordine', 50)),
        'reparti': reparti,
        'totale_trattamenti': round(totale_finale, 2),
        'totale_reparti': round(totale_rep, 2),
    }


def _aggrega_per_categoria(trattamenti: list, hotels: Optional[List[str]] = None) -> list:
    """Vista 'macrocategorie': aggrega i trattamenti per categoria sommando valore (e per_hotel
    se presente in vista gruppo), ricalcolando pct sul nuovo totale — stessa logica di
    TabAnalisiRicavi.jsx (bycat) quando il toggle 'Dettaglio' è spento, replicata qui per l'export."""
    bycat: dict = {}
    for t in trattamenti:
        k = t.get('categoria') or 'Non classificato'
        entry = bycat.setdefault(k, {'categoria': k, 'valore': 0.0, 'per_hotel': {}})
        entry['valore'] += t['valore']
        if hotels:
            for h in hotels:
                entry['per_hotel'][h] = entry['per_hotel'].get(h, 0.0) + (t.get('per_hotel', {}).get(h) or 0.0)
    tot = sum(e['valore'] for e in bycat.values())
    righe = list(bycat.values())
    for r in righe:
        r['pct'] = round(r['valore'] / tot * 100, 2) if tot > 0 else 0
    righe.sort(key=lambda r: -r['valore'])
    return righe


@router.get("/export")
def export_analisi_ricavi(
    hotel_code: str = Query(..., description="Codice hotel, oppure 'GRUPPO'"),
    anno: int = Query(...),
    mese: int = Query(..., ge=1, le=12),
    mese_fine: Optional[int] = Query(None, ge=1, le=12),
    vista_dettaglio: bool = Query(True),
    db: Session = Depends(get_db),
    _u=Depends(richiedi_utente_attivo),
):
    """Esporta in Excel esattamente la vista corrente di TabAnalisiRicavi.jsx: singolo hotel
    (2 fogli, Trattamenti + Reparti) o Gruppo (2 fogli con una colonna per hotel). Rispetta il
    toggle Dettaglio/Macrocategorie (solo sui Trattamenti: i Reparti non hanno questo toggle
    a schermo, sempre dettaglio). Riusa get_trattamenti()/get_reparti()/get_gruppo() invece di
    riaggregare da capo.

    Non esporta la colonna 'Δ Revenue' dei Trattamenti: a schermo è solo un placeholder ('—',
    mai calcolato), non c'è nulla di reale da esportare lì. Il confronto Reparti vs Revenue
    module invece è reale (revenue_module) ed è incluso quando disponibile (solo mese singolo,
    non range — stessa condizione di get_reparti())."""
    import io
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    hotel_code = hotel_code.upper()
    mese_fine_eff = mese_fine or mese

    HDR_FILL = PatternFill('solid', fgColor='1E293B')
    HDR_FONT = Font(bold=True, color='FFFFFF', size=9)
    TOT_FILL = PatternFill('solid', fgColor='1E293B')
    TOT_FONT = Font(bold=True, color='FFFFFF', size=9)
    ALT_FILL = PatternFill('solid', fgColor='F8FAFC')
    TITOLO_FILL = PatternFill('solid', fgColor='0F172A')
    TITOLO_FONT = Font(bold=True, color='FFFFFF', size=11)
    NUM_FMT = '#,##0.00 "€"'
    PCT_FMT = '0.0"%"'

    label_periodo = MESI_IT[mese] if mese == mese_fine_eff else f"{MESI_IT[mese]}–{MESI_IT[mese_fine_eff]} {anno}"
    label_vista = 'Dettaglio' if vista_dettaglio else 'Macrocategorie'
    # I valori del file Passbi (Dashboard Analisi Ricavi) sono sempre IVA inclusa: nessun toggle
    # a schermo (a differenza di Corrispettivi/Produzione), dicitura fissa non uno stato dinamico.
    label_iva = 'IVA inclusa'

    wb = Workbook()
    wb.remove(wb.active)

    def _titolo(ws, testo, n_col):
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n_col)
        c = ws.cell(row=1, column=1, value=testo)
        c.font = TITOLO_FONT
        c.fill = TITOLO_FILL
        c.alignment = Alignment(horizontal='center')

    def _hdr(ws, row, cols):
        for i, val in enumerate(cols, 1):
            c = ws.cell(row=row, column=i, value=val)
            c.font = HDR_FONT
            c.fill = HDR_FILL
            c.alignment = Alignment(horizontal='center')

    def _riga(ws, row, vals, alt=False, pct_cols=()):
        for i, val in enumerate(vals, 1):
            c = ws.cell(row=row, column=i, value=val)
            if alt:
                c.fill = ALT_FILL
            if isinstance(val, (int, float)):
                c.number_format = PCT_FMT if i in pct_cols else NUM_FMT
                c.alignment = Alignment(horizontal='right')

    def _riga_tot(ws, row, vals, pct_cols=()):
        for i, val in enumerate(vals, 1):
            c = ws.cell(row=row, column=i, value=val)
            c.font = TOT_FONT
            c.fill = TOT_FILL
            if isinstance(val, (int, float)):
                c.number_format = PCT_FMT if i in pct_cols else NUM_FMT
                c.alignment = Alignment(horizontal='right')

    def _autowidth(ws):
        for col in ws.columns:
            max_len = max((len(str(cell.value or '')) for cell in col), default=8)
            ws.column_dimensions[get_column_letter(col[0].column)].width = min(max_len + 2, 30)

    if hotel_code == 'GRUPPO':
        dati = get_gruppo(anno=anno, mese=mese, mese_fine=mese_fine, db=db, _u=None)
        hotels = dati['hotel_codes']

        # ── Foglio Trattamenti — Gruppo ───────────────────────────────────────
        ws1 = wb.create_sheet('Trattamenti Gruppo')
        n_col = (2 if vista_dettaglio else 1) + len(hotels) + 2
        _titolo(ws1, f"Analisi Ricavi — Trattamenti Gruppo — {label_periodo} — Vista: {label_vista} — {label_iva}", n_col)
        if vista_dettaglio:
            _hdr(ws1, 2, ['Codice', 'Categoria'] + hotels + ['Totale', '%'])
            righe = dati['trattamenti']
            get_label = lambda t: [t['codice'], t.get('categoria') or '—']
        else:
            _hdr(ws1, 2, ['Categoria'] + hotels + ['Totale', '%'])
            righe = _aggrega_per_categoria(dati['trattamenti'], hotels)
            get_label = lambda t: [t['categoria']]
        pct_col = n_col
        for i, t in enumerate(righe):
            vals = get_label(t) + [t.get('per_hotel', {}).get(h) or 0.0 for h in hotels] + [t['valore'], t['pct']]
            _riga(ws1, i + 3, vals, alt=i % 2 == 1, pct_cols=(pct_col,))
        tot_vals = (['TOTALE', ''] if vista_dettaglio else ['TOTALE']) + \
                   [round(sum(t.get('per_hotel', {}).get(h) or 0.0 for t in righe), 2) for h in hotels] + \
                   [dati['totale_trattamenti'], 100.0]
        _riga_tot(ws1, len(righe) + 3, tot_vals, pct_cols=(pct_col,))
        _autowidth(ws1)

        # ── Foglio Reparti — Gruppo (sempre dettaglio, nessun toggle a schermo) ──
        ws2 = wb.create_sheet('Reparti Gruppo')
        n_col2 = 1 + len(hotels) + 2
        _titolo(ws2, f"Analisi Ricavi — Reparti Gruppo — {label_periodo} — {label_iva}", n_col2)
        _hdr(ws2, 2, ['Reparto'] + hotels + ['Totale', '%'])
        for i, r in enumerate(dati['reparti']):
            vals = [r['reparto']] + [r.get('per_hotel', {}).get(h) or 0.0 for h in hotels] + [r['valore'], r['pct']]
            _riga(ws2, i + 3, vals, alt=i % 2 == 1, pct_cols=(n_col2,))
        tot_vals2 = ['TOTALE'] + [round(sum(r.get('per_hotel', {}).get(h) or 0.0 for r in dati['reparti']), 2) for h in hotels] + \
                    [dati['totale_reparti'], 100.0]
        _riga_tot(ws2, len(dati['reparti']) + 3, tot_vals2, pct_cols=(n_col2,))
        _autowidth(ws2)

        filename = f"analisi_ricavi_gruppo_{anno}_{mese:02d}.xlsx"
    else:
        dati_t = get_trattamenti(hotel_code=hotel_code, anno=anno, mese=mese, mese_fine=mese_fine, db=db, _u=None)
        dati_r = get_reparti(hotel_code=hotel_code, anno=anno, mese=mese, mese_fine=mese_fine, db=db, _u=None)

        # ── Foglio Trattamenti ────────────────────────────────────────────────
        ws1 = wb.create_sheet('Trattamenti')
        if vista_dettaglio:
            n_col = 4
            _titolo(ws1, f"Analisi Ricavi — Trattamenti {hotel_code} — {label_periodo} — Vista: {label_vista} — {label_iva}", n_col)
            _hdr(ws1, 2, ['Codice', 'Nome', 'Valore', '%'])
            righe = dati_t['trattamenti']
            for i, t in enumerate(righe):
                _riga(ws1, i + 3, [t['codice'], t['nome_display'], t['valore'], t['pct']], alt=i % 2 == 1, pct_cols=(4,))
            _riga_tot(ws1, len(righe) + 3, ['TOTALE', '', dati_t['totale'], 100.0], pct_cols=(4,))
        else:
            n_col = 3
            _titolo(ws1, f"Analisi Ricavi — Trattamenti {hotel_code} — {label_periodo} — Vista: {label_vista} — {label_iva}", n_col)
            _hdr(ws1, 2, ['Categoria', 'Valore', '%'])
            righe = _aggrega_per_categoria(dati_t['trattamenti'])
            for i, t in enumerate(righe):
                _riga(ws1, i + 3, [t['categoria'], t['valore'], t['pct']], alt=i % 2 == 1, pct_cols=(3,))
            _riga_tot(ws1, len(righe) + 3, ['TOTALE', dati_t['totale'], 100.0], pct_cols=(3,))
        _autowidth(ws1)

        # ── Foglio Reparti (sempre dettaglio) ─────────────────────────────────
        ws2 = wb.create_sheet('Reparti')
        rev = dati_r.get('revenue_module')
        _titolo(ws2, f"Analisi Ricavi — Reparti {hotel_code} — {label_periodo} — {label_iva}", 3)
        _hdr(ws2, 2, ['Reparto', 'Valore', '%'])
        for i, r in enumerate(dati_r['reparti']):
            _riga(ws2, i + 3, [r['reparto'], r['valore'], r['pct']], alt=i % 2 == 1, pct_cols=(3,))
        row_tot = len(dati_r['reparti']) + 3
        _riga_tot(ws2, row_tot, ['TOTALE', dati_r['totale'], 100.0], pct_cols=(3,))
        if rev:
            ws2.cell(row=row_tot + 2, column=1, value='Confronto Revenue module').font = Font(bold=True)
            for j, (label, val) in enumerate([
                ('Ricavi Camere', rev['revenue_rooms']), ('Ricavi F&B', rev['revenue_fnb']),
                ('Extra', rev['revenue_extra']), ('Totale Revenue', rev['revenue_totale']),
                ('Δ (Analisi Ricavi − Revenue)', round(dati_r['totale'] - rev['revenue_totale'], 2)),
            ]):
                r = row_tot + 3 + j
                ws2.cell(row=r, column=1, value=label)
                c = ws2.cell(row=r, column=2, value=val)
                c.number_format = NUM_FMT
                c.alignment = Alignment(horizontal='right')
        _autowidth(ws2)

        filename = f"analisi_ricavi_{hotel_code}_{anno}_{mese:02d}.xlsx"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


# ── Classificazione trattamenti (Admin) ───────────────────────────────────────

@router.get("/classificazione")
def get_classificazione(
    db: Session = Depends(get_db),
    _u=Depends(richiedi_utente_attivo),
):
    rows = db.query(TrattamentoClassificazione).order_by(
        TrattamentoClassificazione.ordine,
        TrattamentoClassificazione.codice,
    ).all()
    return [{'codice': r.codice, 'nome_display': r.nome_display,
              'categoria': r.categoria, 'escludi': r.escludi, 'ordine': r.ordine,
              'colore': r.colore}
            for r in rows]


def _fmt_classif(r):
    return {'codice': r.codice, 'nome_display': r.nome_display,
            'categoria': r.categoria, 'escludi': r.escludi, 'ordine': r.ordine,
            'colore': r.colore}


@router.post("/classificazione")
def aggiungi_classificazione(
    body: dict,
    db: Session = Depends(get_db),
    _u=Depends(richiedi_admin),
):
    codice = (body.get('codice') or '').strip()
    if not codice:
        raise HTTPException(400, "codice obbligatorio")
    esistente = db.query(TrattamentoClassificazione).filter(
        TrattamentoClassificazione.codice == codice).first()
    if esistente:
        raise HTTPException(409, f"Codice '{codice}' già presente")
    r = TrattamentoClassificazione(
        codice=codice,
        nome_display=body.get('nome_display') or codice,
        categoria=body.get('categoria') or None,
        escludi=bool(body.get('escludi', False)),
        ordine=int(body.get('ordine', 50)),
        colore=body.get('colore') or None,
    )
    db.add(r)
    db.commit()
    return _fmt_classif(r)


@router.put("/classificazione/{codice}")
def aggiorna_classificazione(
    codice: str,
    body: dict,
    db: Session = Depends(get_db),
    _u=Depends(richiedi_admin),
):
    r = db.query(TrattamentoClassificazione).filter(
        TrattamentoClassificazione.codice == codice).first()
    if not r:
        raise HTTPException(404, f"Codice '{codice}' non trovato")
    if 'nome_display' in body:
        r.nome_display = body['nome_display']
    if 'categoria' in body:
        r.categoria = body['categoria'] or None
    if 'escludi' in body:
        r.escludi = bool(body['escludi'])
    if 'ordine' in body:
        r.ordine = int(body['ordine'])
    if 'colore' in body:
        val = (body['colore'] or '').strip()
        r.colore = val if val else None
    db.commit()
    return _fmt_classif(r)
