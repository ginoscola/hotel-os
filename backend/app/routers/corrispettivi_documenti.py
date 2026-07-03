"""Sotto-router Corrispettivi — CRUD documenti (scontrini/fatture) e manuali (MMS/BON).

Endpoint (montati sotto /corrispettivi dall'aggregatore corrispettivi.py):
  GET    /documenti             → lista unificata con filtri e paginazione
  GET    /scontrini             → alias documenti tipo=scontrino
  GET    /fatture                → alias documenti tipo=fattura
  PUT    /documenti/{id}        → correzione manuale unificata
  PUT    /scontrini/{id}        → alias → PUT /documenti/{id}
  PUT    /fatture/{id}          → alias → PUT /documenti/{id}

  POST   /manuali               → inserimento MMS/BON
  PUT    /manuali/{id}          → modifica MMS/BON
  GET    /manuali               → lista con filtri
"""
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import richiedi_admin, richiedi_utente_attivo
from app.models.corrispettivi import CorrispettiviDocumento, CorrispettiviManuale
from app.services.corrispettivi_excel_parser import _determina_categoria
from app.routers.corrispettivi_shared import NOME_STRUTTURA, STRUTTURE_MANUALI, _to_float, _d

router = APIRouter()


def _disaggrega_imponibile(d: CorrispettiviDocumento) -> dict:
    """Calcola imponibile e IVA disaggregati per arrangiamenti e tassa soggiorno.

    Restituisce chiavi aggiuntive da includere in _fmt_documento.
    Significativo solo per categoria='arrangiamenti'; per le altre categorie
    i campi sono None per evitare confusione.
    """
    if d.categoria != 'arrangiamenti':
        return {
            'imponibile_arr': None, 'iva_arr': None,
            'imponibile_ts': None,  'iva_ts': None,
        }

    totale = _to_float(d.totale_lordo)
    ts_raw = None if d.tassa_soggiorno is None else _to_float(d.tassa_soggiorno)
    sum_iva = _to_float(d.iva)

    if ts_raw is not None:
        # Formato esteso: valore esatto
        lordo_ts  = round(ts_raw, 2)
        lordo_arr = round(max(0.0, totale - lordo_ts), 2)
    elif sum_iva > 0:
        # Formato base: inferenza da IVA (imp_arr = iva*10, lordo_arr = iva*11)
        lordo_arr = round(sum_iva * 11, 2)
        lordo_ts  = round(max(0.0, totale - lordo_arr), 2)
    else:
        # Nessuna tassa soggiorno rilevabile
        lordo_arr = totale
        lordo_ts  = 0.0

    imp_arr = round(lordo_arr / 1.10, 2) if lordo_arr else 0.0
    iva_arr  = round(lordo_arr - imp_arr, 2)
    imp_ts   = round(lordo_ts, 2)   # aliquota 0% → imponibile = lordo
    iva_ts   = 0.0

    return {
        'imponibile_arr': imp_arr,
        'iva_arr':        iva_arr,
        'imponibile_ts':  imp_ts,
        'iva_ts':         iva_ts,
    }


def _fmt_documento(d: CorrispettiviDocumento) -> dict:
    return {
        'id': d.id,
        'import_id': d.import_id,
        'tipo': d.tipo,
        'data_documento': d.data_documento.isoformat() if d.data_documento else None,
        'numero': d.numero,
        'suffisso': d.suffisso,
        'struttura_code': d.struttura_code,
        'struttura_nome': NOME_STRUTTURA.get(d.struttura_code, d.struttura_code),
        'intestazione': d.intestazione,
        'camera': d.camera,
        'totale_lordo': _to_float(d.totale_lordo),
        'incassato': _to_float(d.incassato),
        'deposito': _to_float(d.deposito),
        'sospeso': _to_float(d.sospeso),
        'abbuono': _to_float(d.abbuono),
        'imponibile': _to_float(d.imponibile),
        'iva': _to_float(d.iva),
        'aliquota_pct': _to_float(d.aliquota_pct),
        'tassa_soggiorno': None if d.tassa_soggiorno is None else _to_float(d.tassa_soggiorno),
        'categoria': d.categoria,
        'codice_prenotazione': d.codice_prenotazione,
        'tipo_pagamento': d.tipo_pagamento,
        'categoria_pagamento': d.categoria_pagamento,
        **_disaggrega_imponibile(d),
        'conto_anticipato': d.conto_anticipato,
        'acconto': d.acconto,
        'annullato': d.annullato,
        'ospiti': d.ospiti,
        'note': d.note,
        'motivo_esclusione': d.motivo_esclusione,
        'modificato_manualmente': d.modificato_manualmente,
        'modifica_note': d.modifica_note,
        'is_test': d.is_test,
        # Campi formato esteso Welcome PMS
        'sigla': d.sigla,
        'numero_scontrino': d.numero_scontrino,
        'arrivo': d.arrivo.isoformat() if d.arrivo else None,
        'partenza': d.partenza.isoformat() if d.partenza else None,
        'ubicazione_istat': d.ubicazione_istat,
        'voucher': d.voucher,
        'nome_file_pms': d.nome_file_pms,
        'stato_fe': d.stato_fe,
        'modalita': d.modalita,
        'importo_bollo': None if d.importo_bollo is None else _to_float(d.importo_bollo),
        'tipo_documento_fe': d.tipo_documento_fe,
        'numero_documento_fe': d.numero_documento_fe,
        'nazione': d.nazione,
        'ora_stampa': d.ora_stampa,
        'contabilizzato_mexal': d.contabilizzato_mexal,
        'causale_cancellazione': d.causale_cancellazione,
        'maschera_conto': d.maschera_conto,
        'data_creazione_doc': d.data_creazione_doc.isoformat() if d.data_creazione_doc else None,
        'utente_creazione': d.utente_creazione,
    }


def _fmt_manuale(m: CorrispettiviManuale) -> dict:
    lordo = _to_float(m.arrangiamenti_lordo)
    imponibile = round(lordo / 1.10, 2)
    iva = round(lordo - imponibile, 2)
    return {
        'id': m.id,
        'data_giorno': m.data_giorno.isoformat() if m.data_giorno else None,
        'struttura_code': m.struttura_code,
        'struttura_nome': NOME_STRUTTURA.get(m.struttura_code, m.struttura_code),
        'arrangiamenti_lordo': lordo,
        'arrangiamenti_imponibile': imponibile,
        'arrangiamenti_iva': iva,
        'note': m.note,
        'is_test': m.is_test,
        'updated_at': m.updated_at.isoformat() if m.updated_at else None,
    }


def _lista_documenti(
    tipo: Optional[str],
    data_da: Optional[date],
    data_a: Optional[date],
    struttura_code: Optional[str],
    categoria: Optional[str],
    annullato: Optional[bool],
    is_test: bool,
    page: int,
    per_page: int,
    db: Session,
    numero: Optional[str] = None,
    camera: Optional[str] = None,
):
    q = db.query(CorrispettiviDocumento).filter(CorrispettiviDocumento.is_test == is_test)
    if tipo:
        q = q.filter(CorrispettiviDocumento.tipo == tipo)
    if data_da:
        q = q.filter(CorrispettiviDocumento.data_documento >= data_da)
    if data_a:
        q = q.filter(CorrispettiviDocumento.data_documento <= data_a)
    if struttura_code:
        q = q.filter(CorrispettiviDocumento.struttura_code == struttura_code.upper())
    if categoria:
        q = q.filter(CorrispettiviDocumento.categoria == categoria)
    if annullato is not None:
        q = q.filter(CorrispettiviDocumento.annullato == annullato)
    if numero:
        q = q.filter(CorrispettiviDocumento.numero.ilike(f'%{numero}%'))
    if camera:
        q = q.filter(CorrispettiviDocumento.camera.ilike(f'%{camera}%'))

    totale = q.count()
    totale_importo = float(
        q.with_entities(func.coalesce(func.sum(CorrispettiviDocumento.totale_lordo), 0)).scalar() or 0
    )
    docs = (
        q.order_by(CorrispettiviDocumento.data_documento.desc(),
                   CorrispettiviDocumento.numero.desc())
        .offset((page - 1) * per_page).limit(per_page).all()
    )
    return {'totale': totale, 'totale_importo': round(totale_importo, 2),
            'page': page, 'per_page': per_page,
            'documenti': [_fmt_documento(d) for d in docs]}


@router.get("/documenti")
def lista_documenti(
    tipo: Optional[str] = Query(None, description="'scontrino'|'fattura'|'escluso'|None=tutti"),
    data_da: Optional[date] = Query(None),
    data_a: Optional[date] = Query(None),
    struttura_code: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    annullato: Optional[bool] = Query(None),
    numero: Optional[str] = Query(None),
    camera: Optional[str] = Query(None),
    is_test: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    return _lista_documenti(tipo, data_da, data_a, struttura_code, categoria,
                             annullato, is_test, page, per_page, db, numero, camera)


@router.get("/scontrini")
def lista_scontrini(
    data_da: Optional[date] = Query(None),
    data_a: Optional[date] = Query(None),
    struttura_code: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    annullato: Optional[bool] = Query(None),
    numero: Optional[str] = Query(None),
    camera: Optional[str] = Query(None),
    is_test: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    return _lista_documenti('scontrino', data_da, data_a, struttura_code, categoria,
                             annullato, is_test, page, per_page, db, numero, camera)


@router.get("/fatture")
def lista_fatture(
    data_da: Optional[date] = Query(None),
    data_a: Optional[date] = Query(None),
    struttura_code: Optional[str] = Query(None),
    categoria: Optional[str] = Query(None),
    annullato: Optional[bool] = Query(None),
    numero: Optional[str] = Query(None),
    camera: Optional[str] = Query(None),
    is_test: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    return _lista_documenti('fattura', data_da, data_a, struttura_code, categoria,
                             annullato, is_test, page, per_page, db, numero, camera)


def _modifica_documento(doc_id: int, body: dict, db: Session, utente) -> dict:
    doc = db.query(CorrispettiviDocumento).filter(CorrispettiviDocumento.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")

    # Salva valori originali al primo edit manuale
    if not doc.modificato_manualmente:
        doc.totale_lordo_originale = doc.totale_lordo
        doc.imponibile_originale = doc.imponibile
        doc.iva_originale = doc.iva
        doc.categoria_originale = doc.categoria

    campi_modificabili = {
        'totale_lordo', 'incassato', 'deposito', 'sospeso', 'abbuono',
        'imponibile', 'iva', 'categoria', 'annullato', 'note', 'ospiti', 'modifica_note',
        'tipo_pagamento', 'categoria_pagamento',
    }
    for campo, valore in body.items():
        if campo in campi_modificabili:
            setattr(doc, campo, valore)

    # Ricalcola aliquota e categoria se imponibile/iva modificati
    if 'imponibile' in body or 'iva' in body:
        imponibile = float(doc.imponibile or 0)
        iva = float(doc.iva or 0)
        if imponibile:
            doc.aliquota_pct = round(iva / imponibile * 100, 2)
        if 'categoria' not in body:
            doc.categoria = _determina_categoria(float(doc.aliquota_pct), imponibile)

    doc.modificato_manualmente = True
    doc.modificato_da = utente.id
    doc.modificato_at = datetime.utcnow()

    db.commit()
    return _fmt_documento(doc)


@router.put("/documenti/{doc_id}")
def modifica_documento(
    doc_id: int,
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Correzione manuale unificata. Salva i valori originali al primo edit."""
    return _modifica_documento(doc_id, body, db, utente)


@router.put("/scontrini/{doc_id}")
def modifica_scontrino(
    doc_id: int,
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    return _modifica_documento(doc_id, body, db, utente)


@router.put("/fatture/{doc_id}")
def modifica_fattura(
    doc_id: int,
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    return _modifica_documento(doc_id, body, db, utente)


@router.post("/manuali")
def crea_manuale(
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """
    Inserisce o aggiorna un corrispettivo manuale per MMS o BON.
    Body: {data_giorno, struttura_code, arrangiamenti_lordo, note?, is_test?}
    """
    struttura = str(body.get('struttura_code', '')).upper()
    if struttura not in STRUTTURE_MANUALI:
        raise HTTPException(status_code=400,
                             detail=f"struttura_code deve essere uno di: {STRUTTURE_MANUALI}")

    data_g_raw = body.get('data_giorno')
    if not data_g_raw:
        raise HTTPException(status_code=400, detail="data_giorno obbligatorio")
    try:
        data_g = date.fromisoformat(str(data_g_raw))
    except ValueError:
        raise HTTPException(status_code=400, detail="data_giorno non valida (formato YYYY-MM-DD)")

    lordo = float(body.get('arrangiamenti_lordo', 0))
    is_test = bool(body.get('is_test', False))

    esistente = db.query(CorrispettiviManuale).filter(
        CorrispettiviManuale.data_giorno == data_g,
        CorrispettiviManuale.struttura_code == struttura,
    ).first()

    if esistente:
        esistente.arrangiamenti_lordo = _d(lordo)
        esistente.note = body.get('note', esistente.note)
        esistente.updated_by = utente.id
        m = esistente
    else:
        m = CorrispettiviManuale(
            data_giorno=data_g,
            struttura_code=struttura,
            arrangiamenti_lordo=_d(lordo),
            note=body.get('note'),
            is_test=is_test,
            created_by=utente.id,
            updated_by=utente.id,
        )
        db.add(m)

    db.commit()
    return _fmt_manuale(m)


@router.put("/manuali/{manuale_id}")
def modifica_manuale(
    manuale_id: int,
    body: dict,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    m = db.query(CorrispettiviManuale).filter(CorrispettiviManuale.id == manuale_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Record non trovato")

    if 'arrangiamenti_lordo' in body:
        m.arrangiamenti_lordo = _d(body['arrangiamenti_lordo'])
    if 'note' in body:
        m.note = body['note']
    m.updated_by = utente.id

    db.commit()
    return _fmt_manuale(m)


@router.get("/manuali")
def lista_manuali(
    data_da: Optional[date] = Query(None),
    data_a: Optional[date] = Query(None),
    struttura_code: Optional[str] = Query(None),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    q = db.query(CorrispettiviManuale).filter(CorrispettiviManuale.is_test == is_test)
    if data_da:
        q = q.filter(CorrispettiviManuale.data_giorno >= data_da)
    if data_a:
        q = q.filter(CorrispettiviManuale.data_giorno <= data_a)
    if struttura_code:
        q = q.filter(CorrispettiviManuale.struttura_code == struttura_code.upper())
    manuali = q.order_by(CorrispettiviManuale.data_giorno.desc()).all()
    return [_fmt_manuale(m) for m in manuali]
