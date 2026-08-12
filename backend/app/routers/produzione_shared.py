"""Costanti e helper condivisi tra i sotto-router di Statistiche Produzione."""

from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.models.produzione import ProdCategoria, ProdRiga
from app.routers.corrispettivi_shared import STRUTTURE_HOTEL  # riuso, non ridefinire

__all__ = ['STRUTTURE_HOTEL', 'query_report']


def query_report(
    db: Session,
    data_da: date,
    data_a: date,
    struttura_code: Optional[str] = None,
    categoria_code: Optional[str] = None,
    canale: Optional[str] = None,
    trattamento: Optional[str] = None,
    is_test: bool = False,
):
    """Righe di prod_righe filtrate come la view v_prod_report (is_riassetto=false,
    categoria.includi_report=true) + filtri opzionali.

    ⚠️ Deve restare sincronizzata con la definizione SQL di v_prod_report
    (migrazione prod001_2026): qui in forma ORM per poter comporre i filtri
    dinamici richiesti dagli endpoint di report.
    """
    q = (
        db.query(ProdRiga)
        .join(ProdCategoria, ProdRiga.categoria_id == ProdCategoria.id)
        .filter(
            ProdRiga.is_riassetto.is_(False),
            ProdCategoria.includi_report.is_(True),
            ProdRiga.data_riferimento >= data_da,
            ProdRiga.data_riferimento <= data_a,
            ProdRiga.is_test.is_(is_test),
        )
    )
    if struttura_code:
        q = q.filter(ProdRiga.struttura_code == struttura_code)
    if categoria_code:
        q = q.filter(ProdCategoria.code == categoria_code)
    if canale:
        q = q.filter(ProdRiga.canale == canale)
    if trattamento:
        q = q.filter(ProdRiga.trattamento == trattamento)
    return q


def aggrega(righe: list[ProdRiga]) -> dict:
    """Somma un gruppo di righe in {lordo, imponibile, iva, n_righe}.

    Il backend restituisce SEMPRE lordo + imponibile + iva già calcolati (mai
    lordo - iva): il toggle IVA inclusa/esclusa è applicato client-side
    scegliendo quale campo mostrare (stesso pattern di Corrispettivi), qui
    reso più preciso perché l'imponibile è la somma esatta per riga e non
    un'approssimazione via aliquota unica di categoria.
    """
    lordo = sum(float(r.prezzo_lordo) for r in righe)
    imponibile = sum(float(r.imponibile) for r in righe)
    iva = sum(float(r.iva) for r in righe)
    return {
        'lordo': round(lordo, 2),
        'imponibile': round(imponibile, 2),
        'iva': round(iva, 2),
        'n_righe': len(righe),
    }
