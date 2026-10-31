"""Indice WAVE — storico del fatturato 2022–2025 e riferimento per periodo.

Endpoint (prefix /wave; lettura per ogni utente attivo, scrittura solo admin):
  GET    /wave/storico?struttura=                → righe dello storico
  POST   /wave/storico/import?conferma=false     (multipart `file`) → anteprima; conferma=true scrive.
                                                   Le righe corrette a mano non vengono mai toccate.
  POST   /wave/storico                           {struttura_code, anno, mese, netto, note?} → riga a mano
  PUT    /wave/storico/{id}                      {netto?, note?, ripristina?} → correzione a mano / ripristino
  DELETE /wave/storico/{id}?conferma=true
  GET    /wave/riferimento?anno=                 → riferimento di ogni struttura per l'anno (anni precedenti)
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.wave import WaveStorico
from app.services.wave import MESI_WAVE
from app.services.wave_dati import riferimento_anno
from app.services.wave_import import PRIMO_ANNO_HOTELOS, STRUTTURE, ErroreImportWave, parse_storico
from app.utils.locale_it import MESI_IT

router = APIRouter(prefix="/wave", tags=["wave"])


def _riga_json(r: WaveStorico) -> dict:
    return {
        'id': r.id, 'struttura_code': r.struttura_code, 'anno': r.anno, 'mese': r.mese,
        'netto': float(r.netto), 'lordo': None if r.lordo is None else float(r.lordo),
        'tassa_soggiorno': None if r.tassa_soggiorno is None else float(r.tassa_soggiorno),
        'metodo': r.metodo, 'fonte': r.fonte, 'note': r.note,
        'modificato_manualmente': r.modificato_manualmente,
        'netto_originale': None if r.netto_originale is None else float(r.netto_originale),
    }


def _nome(struttura: str, anno: int, mese: int) -> str:
    return f"{struttura} {MESI_IT[mese - 1]} {anno}"


@router.get("/storico")
def lista_storico(
    struttura: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    q = db.query(WaveStorico)
    if struttura:
        q = q.filter(WaveStorico.struttura_code == struttura)
    righe = q.all()
    ordine = {s: i for i, s in enumerate(STRUTTURE)}
    righe.sort(key=lambda r: (ordine.get(r.struttura_code, 99), r.anno, r.mese))
    return {'righe': [_riga_json(r) for r in righe]}


@router.post("/storico/import")
async def importa_storico(
    file: UploadFile = File(...),
    conferma: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(richiedi_admin),
):
    try:
        righe, avvisi = parse_storico(await file.read())
    except ErroreImportWave as e:
        raise HTTPException(400, str(e))

    esistenti = {(r.struttura_code, r.anno, r.mese): r for r in db.query(WaveStorico)}
    nuove, aggiornate, invariate, bloccate = [], [], 0, []
    for r in righe:
        chiave = (r.struttura_code, r.anno, r.mese)
        att = esistenti.get(chiave)
        if att is None:
            nuove.append(_nome(*chiave))
            if conferma:
                db.add(WaveStorico(**r.__dict__))
            continue
        if att.modificato_manualmente:
            if att.netto != r.netto:
                bloccate.append(f"{_nome(*chiave)}: corretto a mano ({float(att.netto):.2f} €), "
                                f"nel file {float(r.netto):.2f} € — non modificato")
            else:
                invariate += 1
            continue
        campi = r.__dict__
        if all(getattr(att, k) == v for k, v in campi.items()):
            invariate += 1
            continue
        if att.netto != r.netto:
            aggiornate.append(f"{_nome(*chiave)}: {float(att.netto):.2f} → {float(r.netto):.2f} €")
        else:
            aggiornate.append(f"{_nome(*chiave)}: aggiornati metodo/fonte/note")
        if conferma:
            for k, v in campi.items():
                setattr(att, k, v)
    if conferma:
        db.commit()
    return {
        'confermato': conferma, 'nome_file': file.filename, 'righe_lette': len(righe),
        'n_nuove': len(nuove), 'n_aggiornate': len(aggiornate), 'n_invariate': invariate,
        'n_bloccate': len(bloccate), 'nuove': nuove, 'aggiornate': aggiornate, 'bloccate': bloccate,
        'avvisi': avvisi,
    }


class RigaManualeInput(BaseModel):
    struttura_code: str
    anno: int
    mese: int
    netto: float
    note: Optional[str] = None


@router.post("/storico")
def crea_riga(body: RigaManualeInput, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    if body.struttura_code not in STRUTTURE:
        raise HTTPException(400, f"Struttura non valida: {body.struttura_code}")
    if body.anno >= PRIMO_ANNO_HOTELOS:
        raise HTTPException(400, f"Dal {PRIMO_ANNO_HOTELOS} i valori vengono dai Corrispettivi")
    if body.mese not in MESI_WAVE:
        raise HTTPException(400, "Solo i mesi da aprile a settembre")
    if db.query(WaveStorico).filter_by(struttura_code=body.struttura_code, anno=body.anno,
                                       mese=body.mese).first():
        raise HTTPException(409, f"{_nome(body.struttura_code, body.anno, body.mese)} esiste già: modificarla")
    r = WaveStorico(struttura_code=body.struttura_code, anno=body.anno, mese=body.mese,
                    netto=Decimal(str(body.netto)), note=body.note, metodo='Inserito a mano',
                    modificato_manualmente=True)
    db.add(r)
    db.commit()
    return _riga_json(r)


class ModificaInput(BaseModel):
    netto: Optional[float] = None
    note: Optional[str] = None
    ripristina: bool = False


@router.put("/storico/{id}")
def modifica_riga(id: int, body: ModificaInput, db: Session = Depends(get_db), _=Depends(richiedi_admin)):
    r = db.get(WaveStorico, id)
    if r is None:
        raise HTTPException(404, "Riga non trovata")
    if body.ripristina:
        if r.netto_originale is None:
            raise HTTPException(400, "Nessun valore del file da ripristinare")
        r.netto, r.netto_originale, r.modificato_manualmente = r.netto_originale, None, False
    elif body.netto is not None:
        nuovo = Decimal(str(body.netto))
        if nuovo != r.netto:
            if not r.modificato_manualmente:
                r.netto_originale = r.netto
            r.netto, r.modificato_manualmente = nuovo, True
    if body.note is not None:
        r.note = body.note or None
    db.commit()
    return _riga_json(r)


@router.delete("/storico/{id}")
def elimina_riga(id: int, conferma: bool = Query(False), db: Session = Depends(get_db),
                 _=Depends(richiedi_admin)):
    if not conferma:
        raise HTTPException(400, "Aggiungere ?conferma=true")
    r = db.get(WaveStorico, id)
    if r is None:
        raise HTTPException(404, "Riga non trovata")
    db.delete(r)
    db.commit()
    return {'eliminata': id}


@router.get("/riferimento")
def get_riferimento(
    anno: Optional[int] = Query(None, ge=2022, le=2100),
    db: Session = Depends(get_db),
    _=Depends(richiedi_utente_attivo),
):
    return riferimento_anno(db, anno or date.today().year)
