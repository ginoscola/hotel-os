"""Logica di business per importare i dati estratti dal parser PDF nel database."""

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.revenue import (
    Employee,
    PayrollImport, PayrollCostType, PayrollEntry, EmployeeMonthly,
)
from app.services.cost_center_service import copia_default_a_mensile


def _upsert_dipendente(db: Session, dati: dict[str, Any]) -> tuple[Employee, bool]:
    """Cerca o crea un dipendente per codice fiscale.

    Returns:
        (employee, creato) — creato=True se è un nuovo record.
    """
    cf = dati["codice_fiscale"]
    emp = db.query(Employee).filter(Employee.codice_fiscale == cf).first()
    if emp:
        # Aggiorna qualifica/mansione/livello se cambiate
        emp.qualifica = dati.get("qualifica") or emp.qualifica
        emp.mansione = dati.get("mansione") or emp.mansione
        emp.livello = dati.get("livello") or emp.livello
        if dati.get("indirizzo"):
            emp.indirizzo = dati["indirizzo"]
        return emp, False

    emp = Employee(
        codice_fiscale=cf,
        cognome=dati["cognome"],
        nome=dati["nome"],
        indirizzo=dati.get("indirizzo"),
        qualifica=dati.get("qualifica"),
        mansione=dati.get("mansione"),
        livello=dati.get("livello"),
        attivo=True,
    )
    db.add(emp)
    db.flush()  # ottieni l'id senza committare
    return emp, True



def importa_payroll(
    db: Session,
    dati_pdf: dict[str, Any],
    nome_file: str,
    user_id: int | None = None,
    is_test: bool = False,
) -> dict[str, Any]:
    """Importa i dati del PDF nel database.

    Args:
        db: sessione SQLAlchemy
        dati_pdf: output di payroll_parser.parse_pdf()
        nome_file: nome originale del file PDF
        user_id: id utente che ha fatto l'upload (può essere None)

    Returns:
        Report con n_dipendenti, totali, lista dipendenti nuovi, lista warning.

    Raises:
        ValueError: se esiste già un import per lo stesso mese/anno/società.
    """
    mese = dati_pdf["mese"]
    anno = dati_pdf["anno"]
    societa = dati_pdf["societa"]

    # Verifica duplicato
    esistente = (
        db.query(PayrollImport)
        .filter(
            PayrollImport.mese == mese,
            PayrollImport.anno == anno,
            PayrollImport.societa == societa,
        )
        .first()
    )
    if esistente:
        raise ValueError(
            f"Import già presente per {societa} — mese {mese}/{anno} "
            f"(id={esistente.id}). Eliminare prima l'import esistente."
        )

    # Carica tutti i tipi di costo dal DB (cache locale)
    cost_types = {ct.code: ct for ct in db.query(PayrollCostType).all()}

    # Data di riferimento per centri di costo: primo giorno del mese
    data_rif = date(anno, mese, 1)

    dipendenti_dati = dati_pdf["dipendenti"]
    nuovi_dipendenti = []
    warnings = []
    totale_netto = Decimal("0")
    totale_lordo = Decimal("0")
    totale_costo_az = Decimal("0")

    # Accumulo in-memory per gestire buste paga doppie dello stesso dipendente.
    # Le insert effettive avvengono dopo il loop per evitare problemi di batching SQLAlchemy.
    # monthly_acc: employee_id → {netto, lordo, costo_az, cc_primario_id}
    monthly_acc: dict[int, dict] = {}
    # entries_acc: (employee_id, cost_type_id) → importo accumulato
    entries_acc: dict[tuple[int, int], Decimal] = {}

    # Crea il record import
    payroll_import = PayrollImport(
        nome_file=nome_file,
        mese=mese,
        anno=anno,
        societa=societa,
        n_dipendenti=len(dipendenti_dati),
        stato="importato",
        is_test=is_test,
        imported_by=user_id,
    )
    db.add(payroll_import)
    db.flush()  # ottieni payroll_import.id

    for dati in dipendenti_dati:
        emp, creato = _upsert_dipendente(db, dati)
        if creato:
            nuovi_dipendenti.append(f"{emp.cognome} {emp.nome} ({emp.codice_fiscale})")

        voci = dati.get("voci", {})
        netto = Decimal(str(voci.get("ret_netta", 0)))
        lordo = Decimal(str(voci.get("tot_lordo", 0)))
        costo_az = Decimal(str(voci.get("tot_costo_az", 0)))
        totale_netto += netto
        totale_lordo += lordo
        totale_costo_az += costo_az

        if emp.id in monthly_acc:
            # Seconda (o ulteriore) busta paga dello stesso dipendente: somma i valori
            warnings.append(
                f"{emp.cognome} {emp.nome}: seconda busta paga nel PDF, valori sommati"
            )
            monthly_acc[emp.id]["netto"] += netto
            monthly_acc[emp.id]["lordo"] += lordo
            monthly_acc[emp.id]["costo_az"] += costo_az
        else:
            # Prima busta paga: copia assegnazioni CC e inizializza accumulatore
            cc_records, usa_fallback = copia_default_a_mensile(
                db, emp.id, payroll_import.id, data_rif
            )
            if usa_fallback:
                warnings.append(
                    f"{emp.cognome} {emp.nome}: nessun centro di costo assegnato, "
                    f"impostato KMDIMARE automaticamente"
                )
            monthly_acc[emp.id] = {
                "netto": netto,
                "lordo": lordo,
                "costo_az": costo_az,
                "cc_primario_id": cc_records[0].cost_center_id if cc_records else None,
            }

        # Accumula le singole voci (somma automaticamente i duplicati)
        for code, importo in voci.items():
            ct = cost_types.get(code)
            if ct is None:
                if emp.id not in {eid for (eid, _) in entries_acc}:
                    # Avvisa solo una volta per dipendente
                    warnings.append(
                        f"{emp.cognome} {emp.nome}: voce sconosciuta '{code}', ignorata"
                    )
                continue
            key = (emp.id, ct.id)
            entries_acc[key] = entries_acc.get(key, Decimal("0")) + Decimal(str(importo))

    # ── Insert batch EmployeeMonthly ─────────────────────────────────────────
    for employee_id, acc in monthly_acc.items():
        n = acc["netto"]
        c = acc["costo_az"]
        db.add(EmployeeMonthly(
            import_id=payroll_import.id,
            employee_id=employee_id,
            cost_center_id=acc["cc_primario_id"],
            percentuale_cc=Decimal("100.00"),
            retribuzione_netta=n,
            totale_lordo=acc["lordo"],
            costo_aziendale=c,
            incidenza_percentuale=((c - n) / n * 100 if n else None),
            override_manuale=False,
        ))

    # ── Insert batch PayrollEntry ────────────────────────────────────────────
    for (employee_id, cost_type_id), importo in entries_acc.items():
        db.add(PayrollEntry(
            import_id=payroll_import.id,
            employee_id=employee_id,
            cost_type_id=cost_type_id,
            importo=importo,
        ))

    # Aggiorna totali sull'import
    payroll_import.totale_netto = totale_netto
    payroll_import.totale_lordo = totale_lordo
    payroll_import.totale_costo_aziendale = totale_costo_az

    db.commit()

    return {
        "import_id": payroll_import.id,
        "mese": mese,
        "anno": anno,
        "societa": societa,
        "n_dipendenti": len(dipendenti_dati),
        "totale_netto": float(totale_netto),
        "totale_lordo": float(totale_lordo),
        "totale_costo_aziendale": float(totale_costo_az),
        "nuovi_dipendenti": nuovi_dipendenti,
        "pagine_non_parsate": dati_pdf.get("pagine_non_parsate", []),
        "warnings": warnings,
    }
