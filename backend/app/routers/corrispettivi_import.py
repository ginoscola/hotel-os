"""Sotto-router Corrispettivi — import file Excel (listaConti.xlsx da Welcome PMS).

Endpoint (montati sotto /corrispettivi dall'aggregatore corrispettivi.py):
  POST   /import                → upload file Excel (on_conflict: salta|aggiorna)
  GET    /import/storico        → storico sessioni import
  DELETE /import/{id}           → elimina import e documenti collegati
"""
import os
import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import richiedi_admin, richiedi_utente_attivo
from app.models.corrispettivi import CorrispettiviDocumento, CorrispettiviImport
from app.services.corrispettivi_excel_parser import parse_excel
from app.routers.corrispettivi_shared import _d

router = APIRouter()


def _fmt_import(imp: CorrispettiviImport) -> dict:
    return {
        'id': imp.id,
        'nome_file': imp.nome_file,
        'data_da': imp.data_da.isoformat() if imp.data_da else None,
        'data_a': imp.data_a.isoformat() if imp.data_a else None,
        'tipo_import': imp.tipo_import,
        'strutture_presenti': imp.strutture_presenti or [],
        'n_scontrini': imp.n_scontrini,
        'n_fatture': imp.n_fatture,
        'n_esclusi': imp.n_esclusi,
        'is_test': imp.is_test,
        'created_at': imp.created_at.isoformat() if imp.created_at else None,
    }


@router.post("/import")
def importa_excel(
    file: UploadFile = File(...),
    is_test: bool = Query(False),
    on_conflict: str = Query('salta', description="'salta' (DO NOTHING) o 'aggiorna' (aggiorna se non modificato manualmente)"),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Carica un file Excel listaConti.xlsx e importa tutti i documenti."""
    if not file.filename.lower().endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Solo file Excel (.xlsx) accettati")
    if on_conflict not in ('salta', 'aggiorna'):
        raise HTTPException(status_code=400, detail="on_conflict deve essere 'salta' o 'aggiorna'")

    with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        risultato = parse_excel(tmp_path)
    except Exception as exc:
        os.unlink(tmp_path)
        raise HTTPException(status_code=500, detail=f"Errore parser: {exc}")
    else:
        os.unlink(tmp_path)

    if not risultato.scontrini and not risultato.fatture:
        raise HTTPException(
            status_code=422,
            detail="Nessun documento SC/SCA/F trovato nel file. "
                   "Verifica che sia un file listaConti.xlsx esportato da Welcome PMS.",
        )

    # Tutti i documenti da salvare (inclusi esclusi per audit)
    tutti = risultato.documenti

    # Pre-check: quali chiavi esistono già in DB?
    # camera + codice_prenotazione in chiave: Welcome PMS assegna numero=0 a tutte
    # le righe di storno/annullo non numerate di un giorno — senza questi due campi
    # più storni nello stesso giorno/struttura collidono sulla stessa chiave e solo
    # il primo verrebbe importato (bug reale: storno 27/06/2026 CLB perso).
    chiavi_tutti = [
        (d.struttura_code, d.data_documento, d.numero, d.suffisso, d.camera or '', d.codice_prenotazione or '')
        for d in tutti
    ]
    strutture_set = {d.struttura_code for d in tutti}
    date_set = {d.data_documento for d in tutti}

    if chiavi_tutti:
        esistenti_q = db.query(
            CorrispettiviDocumento.struttura_code,
            CorrispettiviDocumento.data_documento,
            CorrispettiviDocumento.numero,
            CorrispettiviDocumento.suffisso,
            CorrispettiviDocumento.camera,
            CorrispettiviDocumento.codice_prenotazione,
            CorrispettiviDocumento.modificato_manualmente,
        ).filter(
            CorrispettiviDocumento.struttura_code.in_(strutture_set),
            CorrispettiviDocumento.data_documento.in_(date_set),
        ).all()

        chiavi_esistenti: dict = {
            (r.struttura_code, r.data_documento, r.numero, r.suffisso, r.camera or '', r.codice_prenotazione or ''): r.modificato_manualmente
            for r in esistenti_q
        }
    else:
        chiavi_esistenti = {}

    nuovi = []
    aggiornabili = []
    protetti = []

    for d in tutti:
        chiave = (d.struttura_code, d.data_documento, d.numero, d.suffisso, d.camera or '', d.codice_prenotazione or '')
        if chiave not in chiavi_esistenti:
            nuovi.append(d)
        elif chiavi_esistenti[chiave]:   # modificato_manualmente=True
            protetti.append(d)
        else:
            aggiornabili.append(d)

    # Sessione import
    imp = CorrispettiviImport(
        nome_file=file.filename,
        data_da=risultato.data_da,
        data_a=risultato.data_a,
        tipo_import='excel',
        strutture_presenti=sorted(risultato.strutture_trovate),
        n_scontrini=len(risultato.scontrini),
        n_fatture=len(risultato.fatture),
        n_esclusi=len(risultato.esclusi),
        is_test=is_test,
        imported_by=utente.id,
    )
    db.add(imp)
    db.flush()   # ottiene imp.id

    def _campi_estesi(d) -> dict:
        """Campi formato esteso Welcome PMS (None se non disponibili)."""
        return dict(
            tassa_soggiorno=_d(d.tassa_soggiorno) if d.tassa_soggiorno is not None else None,
            sigla=d.sigla,
            numero_scontrino=d.numero_scontrino,
            arrivo=d.arrivo,
            partenza=d.partenza,
            ubicazione_istat=d.ubicazione_istat,
            voucher=d.voucher,
            nome_file_pms=d.nome_file_pms,
            stato_fe=d.stato_fe,
            modalita=d.modalita,
            importo_bollo=_d(d.importo_bollo) if d.importo_bollo is not None else None,
            tipo_documento_fe=d.tipo_documento_fe,
            numero_documento_fe=d.numero_documento_fe,
            nazione=d.nazione,
            ora_stampa=d.ora_stampa,
            contabilizzato_mexal=d.contabilizzato_mexal,
            causale_cancellazione=d.causale_cancellazione,
            maschera_conto=d.maschera_conto,
            data_creazione_doc=d.data_creazione_doc,
            utente_creazione=d.utente_creazione,
        )

    def _valori_doc(d, import_id: int) -> dict:
        return dict(
            import_id=import_id,
            data_documento=d.data_documento,
            numero=d.numero,
            suffisso=d.suffisso,
            tipo=d.tipo,
            struttura_code=d.struttura_code,
            intestazione=d.intestazione or '',
            camera=d.camera or '',
            totale_lordo=_d(d.totale_lordo),
            incassato=_d(d.incassato),
            deposito=_d(d.deposito),
            sospeso=_d(d.sospeso),
            abbuono=_d(d.abbuono),
            imponibile=_d(d.imponibile),
            iva=_d(d.iva),
            aliquota_pct=_d(d.aliquota_pct),
            categoria=d.categoria,
            codice_prenotazione=d.codice_prenotazione or '',
            tipo_pagamento=d.tipo_pagamento or '',
            conto_anticipato=d.conto_anticipato,
            acconto=d.acconto,
            annullato=d.annullato,
            ospiti=d.ospiti or '',
            note=d.note or '',
            motivo_esclusione=d.motivo_esclusione,
            modificato_manualmente=False,
            is_test=is_test,
            **_campi_estesi(d),
        )

    try:
        # Inserisce nuovi (DO NOTHING come safety net per race condition)
        for d in nuovi:
            v = _valori_doc(d, imp.id)
            stmt = pg_insert(CorrispettiviDocumento).values(**v)
            stmt = stmt.on_conflict_do_nothing(constraint='uq_documento')
            db.execute(stmt)

        # Se "aggiorna": aggiorna quelli esistenti non protetti (import_id rimane invariato — Option A)
        n_aggiornati = 0
        if on_conflict == 'aggiorna' and aggiornabili:
            for d in aggiornabili:
                db.execute(
                    update(CorrispettiviDocumento)
                    .where(
                        CorrispettiviDocumento.struttura_code == d.struttura_code,
                        CorrispettiviDocumento.data_documento == d.data_documento,
                        CorrispettiviDocumento.numero == d.numero,
                        CorrispettiviDocumento.suffisso == d.suffisso,
                        CorrispettiviDocumento.camera == (d.camera or ''),
                        CorrispettiviDocumento.codice_prenotazione == (d.codice_prenotazione or ''),
                        CorrispettiviDocumento.modificato_manualmente == False,
                    )
                    .values(
                        tipo=d.tipo,
                        intestazione=d.intestazione or '',
                        camera=d.camera or '',
                        totale_lordo=_d(d.totale_lordo),
                        incassato=_d(d.incassato),
                        deposito=_d(d.deposito),
                        sospeso=_d(d.sospeso),
                        abbuono=_d(d.abbuono),
                        imponibile=_d(d.imponibile),
                        iva=_d(d.iva),
                        aliquota_pct=_d(d.aliquota_pct),
                        categoria=d.categoria,
                        codice_prenotazione=d.codice_prenotazione or '',
                        tipo_pagamento=d.tipo_pagamento or '',
                        conto_anticipato=d.conto_anticipato,
                        acconto=d.acconto,
                        annullato=d.annullato,
                        ospiti=d.ospiti or '',
                        note=d.note or '',
                        motivo_esclusione=d.motivo_esclusione,
                        is_test=is_test,
                        # import_id NON aggiornato (Option A)
                        **_campi_estesi(d),
                    )
                )
            n_aggiornati = len(aggiornabili)

        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Errore DB: {exc}")

    return {
        'id': imp.id,
        'n_inseriti': len(nuovi),
        'n_aggiornati': n_aggiornati,
        'n_saltati': len(aggiornabili) if on_conflict == 'salta' else 0,
        'n_protetti': len(protetti),
        'n_scontrini': len(risultato.scontrini),
        'n_fatture': len(risultato.fatture),
        'n_esclusi': len(risultato.esclusi),
        'strutture': sorted(risultato.strutture_trovate),
        'periodo': {
            'da': risultato.data_da.isoformat() if risultato.data_da else None,
            'a': risultato.data_a.isoformat() if risultato.data_a else None,
        },
        'warnings': risultato.warnings,
        'non_salvabili': len(risultato.righe_non_salvabili),
    }


@router.get("/import/storico")
def storico_import(
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    imports = (
        db.query(CorrispettiviImport)
        .filter(CorrispettiviImport.is_test == is_test)
        .order_by(CorrispettiviImport.created_at.desc())
        .all()
    )
    return [_fmt_import(i) for i in imports]


@router.delete("/import/{import_id}")
def elimina_import(
    import_id: int,
    conferma: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_admin),
):
    """
    Elimina la sessione di import.
    Cancella i documenti collegati che non sono stati modificati manualmente.
    I documenti con modificato_manualmente=True vengono scollegati (import_id=NULL).
    """
    if not conferma:
        raise HTTPException(status_code=400,
                             detail="Aggiungere ?conferma=true per confermare l'eliminazione")

    imp = db.query(CorrispettiviImport).filter(CorrispettiviImport.id == import_id).first()
    if not imp:
        raise HTTPException(status_code=404, detail="Import non trovato")

    # Scollega i documenti modificati manualmente (audit trail da preservare)
    db.execute(
        update(CorrispettiviDocumento)
        .where(
            CorrispettiviDocumento.import_id == import_id,
            CorrispettiviDocumento.modificato_manualmente == True,
        )
        .values(import_id=None)
    )

    # Cancella i documenti non modificati manualmente
    db.query(CorrispettiviDocumento).filter(
        CorrispettiviDocumento.import_id == import_id,
        CorrispettiviDocumento.modificato_manualmente == False,
    ).delete(synchronize_session=False)

    db.delete(imp)
    db.commit()
    return {'eliminato': import_id}
