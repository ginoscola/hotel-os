"""Servizio per la gestione dei default CC dei dipendenti.

Logica principale:
- get_default_effettivo(employee_id, mese, anno) → split CC valido per quel mese
- salva_default(employee_id, assegnazioni, anno_inizio, mese_inizio) → chiude i vecchi,
  inserisce i nuovi
- get_storico_default(employee_id) → tutte le versioni storiche
"""

from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.revenue import CostCenter, EmployeeCCDefault

TOLLERANZA_PERC = Decimal("0.02")


# ---------------------------------------------------------------------------
# Validazione
# ---------------------------------------------------------------------------

def valida_percentuali(assegnazioni: list[dict]) -> bool:
    """Verifica che la somma sia 100 (±0.02 per arrotondamenti)."""
    if not assegnazioni:
        return False
    totale = sum(Decimal(str(a["percentuale"])) for a in assegnazioni)
    return abs(totale - Decimal("100")) <= TOLLERANZA_PERC


def valida_no_duplicati(assegnazioni: list[dict]) -> bool:
    """Verifica che nessun cost_center_id sia ripetuto."""
    ids = [a["cost_center_id"] for a in assegnazioni]
    return len(ids) == len(set(ids))


# ---------------------------------------------------------------------------
# Lettura
# ---------------------------------------------------------------------------

def get_default_effettivo(
    db: Session,
    employee_id: int,
    mese: int,
    anno: int,
) -> list[dict[str, Any]]:
    """Restituisce lo split CC default valido per (mese, anno).

    Trova i record con decorrenza <= (anno, mese) e non ancora chiusi
    (anno_fine/mese_fine IS NULL oppure >= (anno, mese)).
    """
    righe = (
        db.query(EmployeeCCDefault)
        .filter(EmployeeCCDefault.employee_id == employee_id)
        .filter(
            # Decorrenza iniziale <= (anno, mese)
            (EmployeeCCDefault.anno_inizio < anno) |
            (
                (EmployeeCCDefault.anno_inizio == anno) &
                (EmployeeCCDefault.mese_inizio <= mese)
            )
        )
        .filter(
            # Non ancora chiuso: fine IS NULL oppure fine >= (anno, mese)
            (EmployeeCCDefault.anno_fine == None) |  # noqa: E711
            (EmployeeCCDefault.anno_fine > anno) |
            (
                (EmployeeCCDefault.anno_fine == anno) &
                (EmployeeCCDefault.mese_fine >= mese)
            )
        )
        .all()
    )
    return [_format_default(r) for r in righe]


def get_storico_default(
    db: Session,
    employee_id: int,
) -> list[dict[str, Any]]:
    """Lista storica di tutti i default CC del dipendente, più recente prima."""
    righe = (
        db.query(EmployeeCCDefault)
        .filter(EmployeeCCDefault.employee_id == employee_id)
        .order_by(
            EmployeeCCDefault.anno_inizio.desc(),
            EmployeeCCDefault.mese_inizio.desc(),
        )
        .all()
    )
    return [_format_default(r) for r in righe]


def get_default_attuale(
    db: Session,
    employee_id: int,
) -> list[dict[str, Any]]:
    """Restituisce i default attivi (anno_fine IS NULL)."""
    righe = (
        db.query(EmployeeCCDefault)
        .filter(
            EmployeeCCDefault.employee_id == employee_id,
            EmployeeCCDefault.anno_fine == None,  # noqa: E711
        )
        .order_by(EmployeeCCDefault.anno_inizio, EmployeeCCDefault.mese_inizio)
        .all()
    )
    return [_format_default(r) for r in righe]


# ---------------------------------------------------------------------------
# Scrittura
# ---------------------------------------------------------------------------

def salva_default(
    db: Session,
    employee_id: int,
    assegnazioni: list[dict],
    anno_inizio: int,
    mese_inizio: int,
) -> list[dict[str, Any]]:
    """Salva un nuovo default CC con decorrenza (anno_inizio, mese_inizio).

    Chiude i record aperti impostando anno_fine/mese_fine al mese precedente.

    Raises:
        ValueError: somma percentuali != 100, CC duplicato, decorrenza invalida.
    """
    if not valida_percentuali(assegnazioni):
        totale = sum(Decimal(str(a["percentuale"])) for a in assegnazioni)
        raise ValueError(f"La somma delle percentuali deve essere 100 (attuale: {totale})")

    if not valida_no_duplicati(assegnazioni):
        raise ValueError("Lo stesso centro di costo è selezionato più volte")

    if mese_inizio < 1 or mese_inizio > 12:
        raise ValueError("Mese di decorrenza non valido (1–12)")

    # Calcola mese_fine = mese precedente alla nuova decorrenza
    if mese_inizio == 1:
        anno_fine_prec = anno_inizio - 1
        mese_fine_prec = 12
    else:
        anno_fine_prec = anno_inizio
        mese_fine_prec = mese_inizio - 1

    # Chiude i record ancora aperti (anno_fine IS NULL)
    db.query(EmployeeCCDefault).filter(
        EmployeeCCDefault.employee_id == employee_id,
        EmployeeCCDefault.anno_fine == None,  # noqa: E711
    ).update(
        {"anno_fine": anno_fine_prec, "mese_fine": mese_fine_prec},
        synchronize_session=False,
    )

    # Elimina eventuali record con la stessa decorrenza: si verificherebbe un conflitto
    # UniqueConstraint se il nuovo salvataggio usa la stessa (anno_inizio, mese_inizio)
    # dell'assegnazione appena chiusa.
    db.query(EmployeeCCDefault).filter(
        EmployeeCCDefault.employee_id == employee_id,
        EmployeeCCDefault.anno_inizio == anno_inizio,
        EmployeeCCDefault.mese_inizio == mese_inizio,
    ).delete(synchronize_session=False)

    # Inserisce i nuovi record
    nuovi = []
    for a in assegnazioni:
        r = EmployeeCCDefault(
            employee_id=employee_id,
            cost_center_id=a["cost_center_id"],
            percentuale=Decimal(str(a["percentuale"])),
            anno_inizio=anno_inizio,
            mese_inizio=mese_inizio,
            note=a.get("note"),
        )
        db.add(r)
        nuovi.append(r)

    db.flush()
    return [_format_default(r) for r in nuovi]


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _format_default(r: EmployeeCCDefault) -> dict[str, Any]:
    cc = r.cost_center
    return {
        "id": r.id,
        "cost_center_id": r.cost_center_id,
        "cost_center_code": cc.code,
        "cost_center_name": cc.name,
        "cost_center_tipo": cc.tipo,
        "parent_id": cc.parent_id,
        "percentuale": float(r.percentuale),
        "anno_inizio": r.anno_inizio,
        "mese_inizio": r.mese_inizio,
        "anno_fine": r.anno_fine,
        "mese_fine": r.mese_fine,
    }
