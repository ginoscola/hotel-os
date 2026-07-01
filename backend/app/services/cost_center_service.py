"""Logica di business per la gestione dei centri di costo e delle assegnazioni."""

from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.revenue import (
    CostCenter,
    EmployeeCostCenterMonthly,
)
from app.services.cc_default_service import get_default_effettivo

# Tolleranza per arrotondamenti nella somma percentuali
TOLLERANZA_PERC = Decimal("0.02")


def valida_percentuali(assegnazioni: list[dict]) -> bool:
    """Verifica che la somma delle percentuali sia esattamente 100 (±0.02 per arrotondamenti)."""
    if not assegnazioni:
        return False
    totale = sum(Decimal(str(a["percentuale"])) for a in assegnazioni)
    return abs(totale - Decimal("100")) <= TOLLERANZA_PERC


def assegnazioni_mensili(db: Session, employee_id: int, import_id: int) -> list[dict[str, Any]]:
    """Restituisce le assegnazioni CC per un mese specifico (da employee_cost_center_monthly)."""
    righe = (
        db.query(EmployeeCostCenterMonthly)
        .filter(
            EmployeeCostCenterMonthly.employee_id == employee_id,
            EmployeeCostCenterMonthly.import_id == import_id,
        )
        .all()
    )
    return [_format_assegnazione_mensile(r) for r in righe]


def aggiorna_assegnazioni_mensili(
    db: Session,
    employee_id: int,
    import_id: int,
    nuove_assegnazioni: list[dict],
) -> list[dict[str, Any]]:
    """Salva le assegnazioni CC mensili (override manuale).

    Raises:
        ValueError: se la somma percentuali != 100.
    """
    if not valida_percentuali(nuove_assegnazioni):
        totale = sum(Decimal(str(a["percentuale"])) for a in nuove_assegnazioni)
        raise ValueError(
            f"La somma delle percentuali deve essere 100 (attuale: {totale})"
        )

    cc_ids = [a["cost_center_id"] for a in nuove_assegnazioni]
    if len(cc_ids) != len(set(cc_ids)):
        raise ValueError("Lo stesso centro di costo è selezionato più volte")

    # Cancella assegnazioni esistenti per questo mese
    db.query(EmployeeCostCenterMonthly).filter(
        EmployeeCostCenterMonthly.employee_id == employee_id,
        EmployeeCostCenterMonthly.import_id == import_id,
    ).delete(synchronize_session=False)

    nuove = []
    for a in nuove_assegnazioni:
        r = EmployeeCostCenterMonthly(
            employee_id=employee_id,
            import_id=import_id,
            cost_center_id=a["cost_center_id"],
            percentuale=Decimal(str(a["percentuale"])),
            override_manuale=True,
            note=a.get("note"),
        )
        db.add(r)
        nuove.append(r)

    db.flush()
    return [_format_assegnazione_mensile(r) for r in nuove]


def copia_default_a_mensile(
    db: Session,
    employee_id: int,
    import_id: int,
    data_riferimento,
) -> tuple[list[EmployeeCostCenterMonthly], bool]:
    """Copia i default CC validi per il mese in employee_cost_center_monthly.

    Returns:
        (lista_record_creati, ha_usato_fallback)
        ha_usato_fallback=True se non c'era un default e si è usato KMDIMARE.
    """
    mese = data_riferimento.month
    anno = data_riferimento.year
    default = get_default_effettivo(db, employee_id, mese, anno)

    fallback = False
    if not default:
        cc_fallback = db.query(CostCenter).filter(CostCenter.code == "KMDIMARE").first()
        if cc_fallback:
            default = [{"cost_center_id": cc_fallback.id, "percentuale": 100.0}]
        fallback = True

    # Idempotenza: se i record esistono già (es. dipendente duplicato nel PDF) li restituisce
    esistenti = (
        db.query(EmployeeCostCenterMonthly)
        .filter(
            EmployeeCostCenterMonthly.employee_id == employee_id,
            EmployeeCostCenterMonthly.import_id == import_id,
        )
        .all()
    )
    if esistenti:
        return esistenti, False

    records = []
    for d in default:
        r = EmployeeCostCenterMonthly(
            employee_id=employee_id,
            import_id=import_id,
            cost_center_id=d["cost_center_id"],
            percentuale=Decimal(str(d["percentuale"])),
            override_manuale=False,
        )
        db.add(r)
        records.append(r)

    db.flush()
    return records, fallback


def albero_centri(db: Session) -> list[dict[str, Any]]:
    """Restituisce la struttura gerarchica a 3 livelli: struttura→categoria→reparti."""
    tutti = (
        db.query(CostCenter)
        .order_by(CostCenter.ordine)
        .all()
    )
    by_parent: dict[int | None, list[CostCenter]] = {}
    for cc in tutti:
        by_parent.setdefault(cc.parent_id, []).append(cc)

    risultato = []
    for s in by_parent.get(None, []):
        if s.tipo != "struttura":
            continue
        categorie = []
        for cat in by_parent.get(s.id, []):
            if cat.tipo != "categoria":
                continue
            reparti = [
                {"id": r.id, "code": r.code, "name": r.name,
                 "tipo": r.tipo, "attivo": r.attivo, "ordine": r.ordine,
                 "parent_id": r.parent_id}
                for r in by_parent.get(cat.id, [])
                if r.tipo == "reparto"
            ]
            categorie.append({
                "id": cat.id, "code": cat.code, "name": cat.name,
                "tipo": cat.tipo, "attivo": cat.attivo, "ordine": cat.ordine,
                "parent_id": cat.parent_id,
                "reparti": reparti,
            })
        risultato.append({
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "tipo": s.tipo,
            "attivo": s.attivo,
            "ordine": s.ordine,
            "hotel_id": s.hotel_id,
            "categorie": categorie,
        })
    return risultato


# ---------------------------------------------------------------------------
# Helper interni
# ---------------------------------------------------------------------------

def _format_assegnazione_mensile(r: EmployeeCostCenterMonthly) -> dict[str, Any]:
    cc = r.cost_center
    return {
        "id": r.id,
        "cost_center_id": r.cost_center_id,
        "cost_center_code": cc.code,
        "cost_center_name": cc.name,
        "cost_center_tipo": cc.tipo,
        "parent_id": cc.parent_id,
        "percentuale": float(r.percentuale),
        "override_manuale": r.override_manuale,
    }
