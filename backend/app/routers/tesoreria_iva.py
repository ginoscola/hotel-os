"""Tesoreria — IVA mese per mese stimata da vendite (Corrispettivi) e acquisti (fatture SDI) (Fase 5, blocco C).

Calcoli in `services/tesoreria_iva.py`. Qui la lettura dei dati:
- vendite: `report_fatturati()` di Corrispettivi IVA inclusa meno IVA esclusa (IVA per categoria: 10%, shop 22%,
  penali e tassa di soggiorno 0%), compresi gli incassi manuali di Mare Mosso e Buona Onda;
- acquisti: `tesoreria_fatture` (imposta per mese di ricezione);
- mesi in stagione: `hotel_seasons` (un mese in stagione senza incassi = Corrispettivi non ancora importati).

`iva_mesi_conclusi(db, anni, oggi)` alimenta il calendario fiscale: per i mesi conclusi con dati completi la stima dai
dati sostituisce l'"ultimo versato" (scelta dell'utente 05/11/2026). `GET /tesoreria/iva?anno=` per la tabella di
controllo, con il confronto con il versato.
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import HotelSeason
from app.models.tesoreria import TesoreriaFattura, TesoreriaImpegno
from app.routers.corrispettivi_report import report_fatturati
from app.routers.tesoreria_shared import euro, puo_vedere
from app.services.tesoreria_iva import (
    acquisti_completi, credito_fine_anno, fine_mese, iva_acquisti_per_mese, liquidazioni, vendite_complete,
)

router = APIRouter()
ZERO = Decimal("0.00")


def vendite_iva_per_mese(db: Session, anno: int) -> tuple:
    """({(anno, mese): IVA sulle vendite}, {(anno, mese): incassi IVA inclusa}) dai Corrispettivi."""
    lordo = report_fatturati(anno=anno, lordo=True, is_test=False, db=db, _=None)
    netto = report_fatturati(anno=anno, lordo=False, is_test=False, db=db, _=None)
    iva, incassi = {}, {}
    for ml, mn in zip(lordo["mesi"], netto["mesi"]):
        tot_l = sum(Decimal(str(v["totale"])) for v in ml["per_struttura"].values())
        tot_n = sum(Decimal(str(v["totale"])) for v in mn["per_struttura"].values())
        iva[(anno, ml["mese"])] = tot_l - tot_n
        incassi[(anno, ml["mese"])] = tot_l
    return iva, incassi


def _mesi_in_stagione(db: Session, anno: int) -> set:
    mesi = set()
    for inizio, fine in db.query(HotelSeason.open_date, HotelSeason.close_date).filter(HotelSeason.season_year == anno):
        if inizio and fine:
            mesi.update(m for m in range(inizio.month, fine.month + 1))
    return mesi


def acquisti_per_mese(db: Session) -> tuple:
    """({(anno, mese): IVA sugli acquisti}, giorno dell'ultima fattura ricevuta)."""
    righe = [(t, imp, (r.date() if r else d)) for t, imp, r, d in db.query(
        TesoreriaFattura.tipo_documento, TesoreriaFattura.imposta, TesoreriaFattura.data_ricezione,
        TesoreriaFattura.data_documento)]
    ultima = db.query(func.max(TesoreriaFattura.data_ricezione)).scalar()
    return iva_acquisti_per_mese(righe), (ultima.date() if ultima else None)


def calcola_anno(db: Session, anno: int, oggi: date, acquisti: Optional[tuple] = None) -> list:
    acq, ultima = acquisti or acquisti_per_mese(db)
    vendite, incassi = vendite_iva_per_mese(db, anno)
    stagione = _mesi_in_stagione(db, anno)
    # senza stagioni in Admin non si sa quali mesi dovrebbero avere incassi: nessun mese completo (es. il 2025)
    completi = set() if not stagione else {(anno, m) for m in range(1, 13)
                if acquisti_completi(anno, m, ultima, oggi)
                and vendite_complete(anno, m, incassi.get((anno, m), ZERO), m in stagione, oggi)}
    return liquidazioni(anno, vendite, acq, completi)


def iva_mesi_conclusi(db: Session, anni, oggi: date) -> dict:
    """{(anno, mese): MeseIva} dei mesi conclusi con dati completi e catena del credito nota. Vuoto se non ci sono
    fatture SDI importate (resta il metodo dell'ultimo versato)."""
    acquisti = acquisti_per_mese(db)
    if acquisti[1] is None:
        return {}
    out = {}
    for anno in anni:
        for r in calcola_anno(db, anno, oggi, acquisti):
            if r.versamento is not None:
                out[(anno, r.mese)] = r
    return out


@router.get("/iva")
def iva_mensile(anno: int = Query(..., ge=2020, le=2035), db: Session = Depends(get_db), _=Depends(puo_vedere)):
    from app.routers.tesoreria_impegni import leggi_parametri
    oggi = date.today()
    acquisti = acquisti_per_mese(db)
    righe = calcola_anno(db, anno, oggi, acquisti)
    versato_agosto = leggi_parametri(db)["iva_agosto"].get(str(anno))
    impegni = {i.codice: i for i in db.query(TesoreriaImpegno).filter(TesoreriaImpegno.codice.like(f"iva:{anno}-%"))}
    out = []
    for r in righe:
        imp = impegni.get(f"iva:{anno}-{r.mese:02d}")
        versato = None
        if r.mese == 8 and versato_agosto is not None:
            versato = Decimal(str(versato_agosto))
        elif imp is not None and (imp.stato == "pagato" or imp.importo_confermato is not None):
            versato = imp.importo_confermato if imp.importo_confermato is not None else imp.importo_stimato
        out.append({
            "mese": r.mese, "completo": r.completo, "vendite": euro(r.vendite), "acquisti": euro(r.acquisti),
            "credito_precedente": euro(r.credito_precedente), "saldo": euro(r.saldo), "versamento": euro(r.versamento),
            "credito_dopo": euro(r.credito_dopo), "scadenza": r.scadenza.isoformat(), "versato": euro(versato),
            "scarto": euro(r.versamento - versato) if r.versamento is not None and versato is not None else None,
        })
    return {
        "anno": anno, "ultima_fattura": acquisti[1].isoformat() if acquisti[1] else None,
        "mesi": out, "credito_fine_anno": euro(credito_fine_anno(righe)),
        "totale_vendite": euro(sum((r.vendite or ZERO for r in righe), ZERO)),
        "totale_acquisti": euro(sum((r.acquisti or ZERO for r in righe), ZERO)),
    }
