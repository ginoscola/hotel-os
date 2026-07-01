"""
Test del modulo Spese Dipendenti.

Verifica:
- Parser estrae correttamente 8 dipendenti dal PDF
- Codici fiscali estratti correttamente
- Totali costo aziendale corretti per ogni dipendente
- Import crea employees nuovi per CF non esistenti
- Import duplicato stesso mese/anno → errore
- Assegnazione centro di costo default (COMUNE come fallback)
- Override manuale centro di costo
- Report mensile restituisce totali corretti
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.payroll_parser import parse_pdf
from app.services.payroll_import_service import importa_payroll
from app.database import SessionLocal
from app.models.revenue import (
    Employee, CostCenter, EmployeeCCDefault, EmployeeCostCenterMonthly, EmployeeMonthly,
    PayrollImport, PayrollEntry,
)

PDF_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "uploads",
                        "202604_costi  aziendali .pdf")

# CF attesi nel PDF (in ordine di pagina)
CF_ATTESI = [
    "BLDNNA05E47H294N",
    "DLLGCM92R16C357T",
    "GVNLCA04C49G479U",
    "CREVNC96B55C357U",
    "DRGLGU62M04B860A",
    "SNCMNL98P12H294L",
    "PLZLCA99T68G479J",
    "DGNMDO77D27Z343D",
]

# Costo aziendale atteso per ogni dipendente (tot_costo_az dal PDF)
COSTI_AZ_ATTESI = {
    "BLDNNA05E47H294N": 108.06,
    "DLLGCM92R16C357T": 334.51,
    "GVNLCA04C49G479U": 118.46,
    "CREVNC96B55C357U": 334.72,
    "DRGLGU62M04B860A": 113.71,
    "SNCMNL98P12H294L": 3164.02,
    "PLZLCA99T68G479J": 3129.85,
    "DGNMDO77D27Z343D": 84.38,
}


@pytest.fixture
def dati_pdf():
    """Risultato del parser sul PDF reale."""
    if not os.path.exists(PDF_PATH):
        pytest.skip(f"PDF di test non trovato: {PDF_PATH}")
    return parse_pdf(PDF_PATH)


# ---------------------------------------------------------------------------
# Test parser
# ---------------------------------------------------------------------------

def test_parser_numero_dipendenti(dati_pdf):
    """Il parser deve estrarre esattamente 8 dipendenti."""
    assert len(dati_pdf["dipendenti"]) == 8


def test_parser_nessuna_pagina_fallita(dati_pdf):
    """Nessuna pagina deve fallire il parsing."""
    assert dati_pdf["pagine_non_parsate"] == []


def test_parser_mese_anno(dati_pdf):
    """Mese e anno devono essere aprile 2026."""
    assert dati_pdf["mese"] == 4
    assert dati_pdf["anno"] == 2026


def test_parser_societa(dati_pdf):
    """La ragione sociale deve essere KM DI MARE SRL."""
    assert "KM DI MARE" in dati_pdf["societa"]


def test_parser_codici_fiscali(dati_pdf):
    """I codici fiscali estratti devono corrispondere agli attesi."""
    cf_estratti = [d["codice_fiscale"] for d in dati_pdf["dipendenti"]]
    for cf in CF_ATTESI:
        assert cf in cf_estratti, f"CF {cf} non trovato"


def test_parser_costi_aziendali(dati_pdf):
    """I totali costo aziendale per dipendente devono corrispondere al PDF."""
    for d in dati_pdf["dipendenti"]:
        cf = d["codice_fiscale"]
        if cf in COSTI_AZ_ATTESI:
            estratto = d["voci"]["tot_costo_az"]
            atteso = COSTI_AZ_ATTESI[cf]
            assert abs(estratto - atteso) < 0.01, \
                f"CF {cf}: costo az atteso {atteso}, estratto {estratto}"


def test_parser_tutte_le_voci_presenti(dati_pdf):
    """Ogni dipendente deve avere tutte e 13 le voci di costo."""
    from app.services.payroll_parser import VOCI_ORDINE
    for d in dati_pdf["dipendenti"]:
        for code in VOCI_ORDINE:
            assert code in d["voci"], \
                f"Voce '{code}' mancante per {d['codice_fiscale']}"


# ---------------------------------------------------------------------------
# Test import service
# ---------------------------------------------------------------------------

def _pulisci_db(db):
    """Elimina dati di test in ordine sicuro rispettando i FK."""
    # 1. Trova gli ID dei dipendenti di test
    emp_ids = [
        r.id for r in db.query(Employee.id).filter(
            Employee.codice_fiscale.in_(CF_ATTESI)
        ).all()
    ]

    # 2. Trova solo gli import di TEST KM DI MARE aprile 2026
    import_ids = [
        r.id for r in db.query(PayrollImport.id).filter(
            PayrollImport.anno == 2026,
            PayrollImport.mese == 4,
            PayrollImport.societa.like("KM DI MARE%"),
            PayrollImport.is_test == True,  # noqa: E712
        ).all()
    ]

    if import_ids:
        db.query(EmployeeCostCenterMonthly).filter(
            EmployeeCostCenterMonthly.import_id.in_(import_ids)
        ).delete(synchronize_session=False)
        # CASCADE elimina payroll_entries e employee_monthly via import_id
        db.query(PayrollImport).filter(
            PayrollImport.id.in_(import_ids)
        ).delete(synchronize_session=False)

    if emp_ids:
        # Rimuove qualsiasi dato residuo che referenzia questi dipendenti
        db.query(PayrollEntry).filter(
            PayrollEntry.employee_id.in_(emp_ids)
        ).delete(synchronize_session=False)
        db.query(EmployeeMonthly).filter(
            EmployeeMonthly.employee_id.in_(emp_ids)
        ).delete(synchronize_session=False)
        db.query(EmployeeCostCenterMonthly).filter(
            EmployeeCostCenterMonthly.employee_id.in_(emp_ids)
        ).delete(synchronize_session=False)
        db.query(EmployeeCCDefault).filter(
            EmployeeCCDefault.employee_id.in_(emp_ids)
        ).delete(synchronize_session=False)
        db.query(Employee).filter(
            Employee.id.in_(emp_ids)
        ).delete(synchronize_session=False)

    db.commit()


@pytest.fixture
def db_pulito():
    """Sessione DB con cleanup pre e post test."""
    db = SessionLocal()
    _pulisci_db(db)  # pulizia preventiva per dati di test precedenti
    try:
        yield db
    finally:
        _pulisci_db(db)
        db.close()


def test_import_crea_dipendenti_nuovi(dati_pdf, db_pulito):
    """L'import deve creare employees per tutti i CF non presenti."""
    db = db_pulito
    report = importa_payroll(db, dati_pdf, "test_aprile_2026.pdf", user_id=None, is_test=True)
    assert len(report["nuovi_dipendenti"]) == 8
    # Verifica che siano stati inseriti nel DB
    for cf in CF_ATTESI:
        emp = db.query(Employee).filter(Employee.codice_fiscale == cf).first()
        assert emp is not None, f"Employee con CF {cf} non creato"


def test_import_totale_costo_aziendale(dati_pdf, db_pulito):
    """Il totale costo aziendale deve corrispondere alla somma dei valori attesi."""
    db = db_pulito
    report = importa_payroll(db, dati_pdf, "test_aprile_2026.pdf", user_id=None, is_test=True)
    totale_atteso = sum(COSTI_AZ_ATTESI.values())
    assert abs(report["totale_costo_aziendale"] - totale_atteso) < 0.10


def test_import_duplicato_errore(dati_pdf, db_pulito):
    """Un secondo import per lo stesso mese/anno/società deve sollevare ValueError."""
    db = db_pulito
    importa_payroll(db, dati_pdf, "test_aprile_2026.pdf", user_id=None, is_test=True)
    with pytest.raises(ValueError, match="già presente"):
        importa_payroll(db, dati_pdf, "test_aprile_2026_dup.pdf", user_id=None, is_test=True)


def test_import_assegna_kmdimare_senza_cc(dati_pdf, db_pulito):
    """Dipendenti senza CC default devono ricevere KMDIMARE come fallback con warning."""
    db = db_pulito
    report = importa_payroll(db, dati_pdf, "test_aprile_2026.pdf", user_id=None, is_test=True)
    # Tutti i dipendenti nuovi non hanno CC → tutti warning
    assert len(report["warnings"]) > 0
    # Le assegnazioni mensili devono puntare a KMDIMARE
    cc_kmdimare = db.query(CostCenter).filter(CostCenter.code == "KMDIMARE").first()
    assert cc_kmdimare is not None, "CC KMDIMARE non trovato — migrazioni non applicate?"
    imp = db.query(PayrollImport).filter(PayrollImport.mese == 4, PayrollImport.anno == 2026).first()
    # Verifica tramite employee_cost_center_monthly
    mensili = db.query(EmployeeCostCenterMonthly).filter(
        EmployeeCostCenterMonthly.import_id == imp.id
    ).all()
    assert len(mensili) > 0
    for ma in mensili:
        assert ma.cost_center_id == cc_kmdimare.id


def test_override_manuale_cc(dati_pdf, db_pulito):
    """L'override manuale del centro di costo deve impostare override_manuale=True."""
    db = db_pulito
    importa_payroll(db, dati_pdf, "test_aprile_2026.pdf", user_id=None, is_test=True)

    imp = db.query(PayrollImport).filter(PayrollImport.mese == 4, PayrollImport.anno == 2026).first()
    monthly = db.query(EmployeeMonthly).filter(EmployeeMonthly.import_id == imp.id).first()

    # Trova un CC diverso da COMUNE
    cc_clb = db.query(CostCenter).filter(CostCenter.code == "CLB").first()
    assert cc_clb is not None

    # Esegui override
    monthly.cost_center_id = cc_clb.id
    monthly.override_manuale = True
    db.commit()

    db.refresh(monthly)
    assert monthly.cost_center_id == cc_clb.id
    assert monthly.override_manuale is True


def test_report_mensile_totali(dati_pdf, db_pulito):
    """Il report mensile deve restituire i totali corretti."""
    db = db_pulito
    report_import = importa_payroll(db, dati_pdf, "test_aprile_2026.pdf", user_id=None, is_test=True)

    # Simula la query del report
    imp = db.query(PayrollImport).filter(PayrollImport.mese == 4, PayrollImport.anno == 2026).first()
    assert imp is not None
    assert imp.n_dipendenti == 8
    assert abs(float(imp.totale_costo_aziendale) - sum(COSTI_AZ_ATTESI.values())) < 0.10
    assert float(imp.totale_netto) > 0
    assert float(imp.totale_lordo) > 0

    # Verifica che le entries siano state create (13 voci × 8 dipendenti = 104)
    entries = db.query(PayrollEntry).filter(PayrollEntry.import_id == imp.id).count()
    assert entries == 104
