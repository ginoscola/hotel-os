"""Router FastAPI per il modulo Spese Dipendenti."""

import os
import tempfile
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import (
    CostCenter, Employee, EmployeeCCDefault, EmployeeCostCenterMonthly,
    EmployeeMonthly, PayrollCostType, PayrollEntry, PayrollImport,
)
from app.services.cc_default_service import (
    get_default_attuale,
    get_default_effettivo,
    get_storico_default,
    salva_default,
    valida_percentuali,
    valida_no_duplicati,
)
from app.services.cost_center_service import (
    aggiorna_assegnazioni_mensili,
    albero_centri,
    assegnazioni_mensili,
    copia_default_a_mensile,
)
from app.services.payroll_import_service import importa_payroll
from app.services.payroll_parser import parse_pdf

router = APIRouter(tags=["dipendenti"])


# ---------------------------------------------------------------------------
# Schemi Pydantic
# ---------------------------------------------------------------------------

class CostCenterOut(BaseModel):
    id: int
    code: str
    name: str
    tipo: str
    attivo: bool
    ordine: int

    class Config:
        from_attributes = True


class RepartoOut(BaseModel):
    id: int
    code: str
    name: str
    tipo: str
    attivo: bool
    ordine: int
    parent_id: Optional[int]


class CategoriaOut(BaseModel):
    id: int
    code: str
    name: str
    tipo: str
    attivo: bool
    ordine: int
    parent_id: Optional[int]
    reparti: list[RepartoOut]


class StrutturaCCOut(BaseModel):
    id: int
    code: str
    name: str
    tipo: str
    attivo: bool
    ordine: int
    hotel_id: Optional[int]
    categorie: list[CategoriaOut]


class CCDefaultOut(BaseModel):
    id: int
    cost_center_id: int
    cost_center_code: str
    cost_center_name: str
    cost_center_tipo: str
    parent_id: Optional[int]
    parent_code: Optional[str] = None
    struttura_code: Optional[str] = None
    struttura_name: Optional[str] = None
    percentuale: float
    anno_inizio: int
    mese_inizio: int
    anno_fine: Optional[int]
    mese_fine: Optional[int]


class AssegnazioneMensileOut(BaseModel):
    id: int
    cost_center_id: int
    cost_center_code: str
    cost_center_name: str
    cost_center_tipo: str
    parent_id: Optional[int]
    parent_code: Optional[str] = None
    struttura_code: Optional[str] = None
    struttura_name: Optional[str] = None
    percentuale: float
    override_manuale: bool


class AssegnazioneCCInput(BaseModel):
    cost_center_id: int
    percentuale: float
    note: Optional[str] = None


class SalvaDefaultInput(BaseModel):
    assegnazioni: list[AssegnazioneCCInput]
    anno_inizio: int
    mese_inizio: int


class AssegnazioniMensiliInput(BaseModel):
    import_id: int
    assegnazioni: list[AssegnazioneCCInput]


class EmployeeOut(BaseModel):
    id: int
    codice_fiscale: str
    cognome: str
    nome: str
    qualifica: Optional[str]
    mansione: Optional[str]
    livello: Optional[str]
    email: Optional[str] = None
    cellulare: Optional[str] = None
    attivo: bool
    centro_di_costo: Optional[str] = None
    centro_di_costo_id: Optional[int] = None
    centri_di_costo: list[CCDefaultOut] = []

    class Config:
        from_attributes = True


class EmployeeContactInput(BaseModel):
    email: Optional[str] = None
    cellulare: Optional[str] = None


class VoceCostoOut(BaseModel):
    code: str
    name: str
    categoria: str
    importo: float


class CCAssegnazioneOut(BaseModel):
    cost_center_id: int
    cost_center_code: str
    cost_center_name: str
    cost_center_tipo: str
    parent_id: Optional[int]
    parent_code: Optional[str] = None
    struttura_code: Optional[str] = None
    struttura_name: Optional[str] = None
    percentuale: float
    override_manuale: bool


class DipendenteMensileOut(BaseModel):
    employee_id: int
    cognome: str
    nome: str
    codice_fiscale: str
    qualifica: Optional[str]
    mansione: Optional[str]
    livello: Optional[str]
    centro_di_costo: Optional[str]
    centro_di_costo_id: Optional[int]
    centri_di_costo: list[CCAssegnazioneOut] = []
    override_manuale: bool
    retribuzione_netta: Optional[float]
    totale_lordo: Optional[float]
    costo_aziendale: Optional[float]
    incidenza_percentuale: Optional[float]
    voci: list[VoceCostoOut] = []


class TotaleStruttura(BaseModel):
    struttura_code: str
    struttura_name: str
    costo_aziendale: float
    n_dipendenti: int


class ReportMensileOut(BaseModel):
    mese: int
    anno: int
    societa: Optional[str]
    n_dipendenti: int
    totale_netto: float
    totale_lordo: float
    totale_costo_aziendale: float
    dipendenti: list[DipendenteMensileOut]
    totali_per_cc: dict[str, float]
    totali_per_struttura: list[TotaleStruttura] = []


class CostCenterInput(BaseModel):
    cost_center_id: int


class CostCenterCreate(BaseModel):
    code: str
    name: str
    tipo: str = "struttura"
    ordine: int = 0
    parent_id: Optional[int] = None


class CostCenterUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    attivo: Optional[bool] = None
    ordine: Optional[int] = None


class ImportStorico(BaseModel):
    id: int
    nome_file: str
    mese: int
    anno: int
    societa: Optional[str]
    n_dipendenti: Optional[int]
    totale_netto: Optional[float]
    totale_lordo: Optional[float]
    totale_costo_aziendale: Optional[float]
    stato: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Centri di costo — struttura gerarchica
# ---------------------------------------------------------------------------

@router.get("/cost-centers/albero", response_model=list[StrutturaCCOut])
def albero_cc(
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Struttura gerarchica completa: strutture con reparti annidati."""
    return albero_centri(db)


@router.get("/cost-centers/", response_model=list[CostCenterOut])
def lista_centri(
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Lista piatta centri di costo attivi ordinati."""
    return db.query(CostCenter).filter(CostCenter.attivo == True).order_by(CostCenter.ordine).all()  # noqa: E712


@router.post("/cost-centers/", response_model=CostCenterOut)
def crea_centro(
    dati: CostCenterCreate,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Crea un nuovo centro di costo."""
    esistente = db.query(CostCenter).filter(CostCenter.code == dati.code.upper()).first()
    if esistente:
        raise HTTPException(400, f"Centro di costo '{dati.code}' già esistente")
    cc = CostCenter(
        code=dati.code.upper(),
        name=dati.name,
        tipo=dati.tipo,
        ordine=dati.ordine,
        attivo=True,
        parent_id=dati.parent_id,
    )
    db.add(cc)
    db.commit()
    db.refresh(cc)
    return cc


@router.put("/cost-centers/{cc_id}", response_model=CostCenterOut)
def aggiorna_centro(
    cc_id: int,
    dati: CostCenterUpdate,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Aggiorna codice, nome, stato o ordine di un centro di costo."""
    cc = db.query(CostCenter).filter(CostCenter.id == cc_id).first()
    if not cc:
        raise HTTPException(404, "Centro di costo non trovato")
    if dati.code is not None:
        codice = dati.code.strip().upper()
        if not codice:
            raise HTTPException(400, "Il codice non può essere vuoto")
        esistente = db.query(CostCenter).filter(CostCenter.code == codice, CostCenter.id != cc_id).first()
        if esistente:
            raise HTTPException(409, f"Codice '{codice}' già utilizzato da un altro centro di costo")
        cc.code = codice
    if dati.name is not None:
        cc.name = dati.name
    if dati.attivo is not None:
        cc.attivo = dati.attivo
    if dati.ordine is not None:
        cc.ordine = dati.ordine
    db.commit()
    db.refresh(cc)
    return cc


# ---------------------------------------------------------------------------
# Import PDF
# ---------------------------------------------------------------------------

@router.post("/dipendenti/import")
async def importa_pdf(
    file: UploadFile = File(...),
    is_test: bool = Query(False),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Carica e importa un PDF con i costi del personale."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Il file deve essere un PDF")

    contenuto = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(contenuto)
        percorso_tmp = tmp.name

    try:
        dati_pdf = parse_pdf(percorso_tmp)
    except Exception as e:
        os.unlink(percorso_tmp)
        raise HTTPException(422, f"Errore parsing PDF: {str(e)}")
    finally:
        if os.path.exists(percorso_tmp):
            os.unlink(percorso_tmp)

    try:
        report = importa_payroll(db, dati_pdf, file.filename, user_id=utente.id, is_test=is_test)
    except ValueError as e:
        raise HTTPException(409, str(e))
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Errore importazione: {str(e)}")

    return report


# ---------------------------------------------------------------------------
# Admin — dati di test
# ---------------------------------------------------------------------------

@router.get("/dipendenti/admin/test-stats")
def test_stats(
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Conta gli import di test, i record collegati e i dipendenti che diventerebbero orfani."""
    n_import = db.query(PayrollImport).filter(PayrollImport.is_test == True).count()  # noqa: E712
    import_ids = [
        r.id for r in db.query(PayrollImport.id).filter(PayrollImport.is_test == True).all()  # noqa: E712
    ]
    n_entries = 0
    n_monthly = 0
    n_orfani = 0
    if import_ids:
        n_entries = db.query(PayrollEntry).filter(PayrollEntry.import_id.in_(import_ids)).count()
        n_monthly = db.query(EmployeeMonthly).filter(EmployeeMonthly.import_id.in_(import_ids)).count()
        # Dipendenti presenti solo in import di test (diventerebbero orfani se si eliminano)
        emp_in_test = {r.employee_id for r in db.query(EmployeeMonthly.employee_id)
                       .filter(EmployeeMonthly.import_id.in_(import_ids)).all()}
        emp_in_real = {r.employee_id for r in db.query(EmployeeMonthly.employee_id)
                       .filter(EmployeeMonthly.import_id.notin_(import_ids)).all()}
        n_orfani = len(emp_in_test - emp_in_real)
    return {
        "payroll_imports": n_import,
        "payroll_entries": n_entries,
        "employee_monthly": n_monthly,
        "dipendenti_orfani": n_orfani,
    }


def _elimina_dipendenti_orfani(db: Session, emp_ids: list[int]) -> int:
    """Elimina i dipendenti che non hanno più nessun employee_monthly collegato.

    Rimuove prima le assegnazioni CC (default e mensili) per rispettare i FK.
    Restituisce il numero di dipendenti eliminati.
    """
    if not emp_ids:
        return 0
    orfani = [
        eid for eid in emp_ids
        if db.query(EmployeeMonthly.id).filter(EmployeeMonthly.employee_id == eid).first() is None
    ]
    if not orfani:
        return 0
    db.query(EmployeeCostCenterMonthly).filter(
        EmployeeCostCenterMonthly.employee_id.in_(orfani)
    ).delete(synchronize_session=False)
    db.query(EmployeeCCDefault).filter(
        EmployeeCCDefault.employee_id.in_(orfani)
    ).delete(synchronize_session=False)
    return db.query(Employee).filter(Employee.id.in_(orfani)).delete(synchronize_session=False)


@router.delete("/dipendenti/admin/test-data")
def elimina_test_data(
    elimina_dipendenti: bool = Query(True, description="Se True, elimina anche i dipendenti rimasti senza altri dati"),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Cancella gli import di test e i dati collegati. Opzionalmente elimina i dipendenti orfani."""
    emp_ids = [r.employee_id for r in db.query(EmployeeMonthly.employee_id)
               .join(PayrollImport, EmployeeMonthly.import_id == PayrollImport.id)
               .filter(PayrollImport.is_test == True).all()]  # noqa: E712

    import_test = db.query(PayrollImport).filter(PayrollImport.is_test == True).all()  # noqa: E712
    n_import = len(import_test)
    for imp in import_test:
        db.delete(imp)
    db.flush()

    n_dipendenti = _elimina_dipendenti_orfani(db, emp_ids) if elimina_dipendenti else 0
    db.commit()
    return {
        "ok": True,
        "eliminati": n_import,
        "dipendenti_eliminati": n_dipendenti,
        "messaggio": f"Cancellati {n_import} import di test"
                     + (f" e {n_dipendenti} dipendenti orfani" if elimina_dipendenti else " (anagrafiche mantenute)"),
    }


# ---------------------------------------------------------------------------
# Anagrafica dipendenti
# ---------------------------------------------------------------------------

def _cc_attivo(db: Session, employee_id: int):
    """Restituisce il primo CC attivo corrente (anno_fine IS NULL) per il dipendente."""
    from datetime import date as dt
    oggi = dt.today()
    r = (
        db.query(EmployeeCCDefault)
        .filter(
            EmployeeCCDefault.employee_id == employee_id,
            EmployeeCCDefault.anno_fine == None,  # noqa: E711
        )
        .first()
    )
    if r and r.cost_center:
        return r.cost_center
    return None


@router.get("/dipendenti/", response_model=list[EmployeeOut])
def lista_dipendenti(
    anno: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Lista dipendenti attivi. Con ?anno=YYYY filtra solo chi ha import in quell'anno."""
    q = db.query(Employee).filter(Employee.attivo == True)  # noqa: E712
    if anno:
        emp_ids_anno = (
            db.query(EmployeeMonthly.employee_id)
            .join(PayrollImport, EmployeeMonthly.import_id == PayrollImport.id)
            .filter(PayrollImport.anno == anno)
            .distinct()
            .subquery()
        )
        q = q.filter(Employee.id.in_(emp_ids_anno))
    dipendenti = q.order_by(Employee.cognome).all()

    # Tutti i CC default attivi per tutti i dipendenti in un'unica query (evita N+1),
    # arricchiti una sola volta con struttura/parent invece che per dipendente.
    emp_ids = [emp.id for emp in dipendenti]
    righe_cc = (
        db.query(EmployeeCCDefault)
        .filter(EmployeeCCDefault.employee_id.in_(emp_ids), EmployeeCCDefault.anno_fine == None)  # noqa: E711
        .order_by(EmployeeCCDefault.anno_inizio, EmployeeCCDefault.mese_inizio)
        .all()
    ) if emp_ids else []
    cc_per_dipendente: dict[int, list[dict]] = {}
    for r in righe_cc:
        cc = r.cost_center
        cc_per_dipendente.setdefault(r.employee_id, []).append({
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
        })
    _arricchisci_parent_code([r for lista in cc_per_dipendente.values() for r in lista], db)

    risultato = []
    for emp in dipendenti:
        centri = cc_per_dipendente.get(emp.id, [])
        primo = centri[0] if centri else None
        risultato.append(EmployeeOut(
            id=emp.id,
            codice_fiscale=emp.codice_fiscale,
            cognome=emp.cognome,
            nome=emp.nome,
            qualifica=emp.qualifica,
            mansione=emp.mansione,
            livello=emp.livello,
            email=emp.email,
            cellulare=emp.cellulare,
            attivo=emp.attivo,
            centro_di_costo=primo["cost_center_name"] if primo else None,
            centro_di_costo_id=primo["cost_center_id"] if primo else None,
            centri_di_costo=centri,
        ))
    return risultato


@router.get("/dipendenti/{dipendente_id}/anno/{anno}")
def mesi_dipendente_anno(
    dipendente_id: int,
    anno: int,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Restituisce i 12 mesi dell'anno per un dipendente.

    Per ogni mese con import: include import_id e le assegnazioni CC.
    Mesi senza import: import_id=null, centri_di_costo=[].
    """
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")

    # Recupera tutti gli import dell'anno per questo dipendente
    righe = (
        db.query(EmployeeMonthly, PayrollImport)
        .join(PayrollImport, EmployeeMonthly.import_id == PayrollImport.id)
        .filter(
            EmployeeMonthly.employee_id == dipendente_id,
            PayrollImport.anno == anno,
        )
        .order_by(PayrollImport.mese)
        .all()
    )

    # Mappa mese → dati
    per_mese: dict[int, dict] = {}
    for em, imp in righe:
        cc_mensili = (
            db.query(EmployeeCostCenterMonthly)
            .filter(
                EmployeeCostCenterMonthly.employee_id == dipendente_id,
                EmployeeCostCenterMonthly.import_id == imp.id,
            )
            .all()
        )
        centri = []
        for cc in cc_mensili:
            c = cc.cost_center
            centri.append({
                "cost_center_id": cc.cost_center_id,
                "cost_center_code": c.code,
                "cost_center_name": c.name,
                "cost_center_tipo": c.tipo,
                "parent_id": c.parent_id,
                "percentuale": float(cc.percentuale),
                "override_manuale": cc.override_manuale,
            })
        per_mese[imp.mese] = {
            "mese": imp.mese,
            "anno": anno,
            "import_id": imp.id,
            "override_manuale": any(c["override_manuale"] for c in centri),
            "centri_di_costo": centri,
        }

    return [
        per_mese.get(m, {"mese": m, "anno": anno, "import_id": None,
                         "override_manuale": False, "centri_di_costo": []})
        for m in range(1, 13)
    ]


@router.get("/dipendenti/{dipendente_id}", response_model=EmployeeOut)
def dettaglio_dipendente(
    dipendente_id: int,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Dettaglio dipendente con centro di costo corrente."""
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")
    cc = _cc_attivo(db, emp.id)
    return EmployeeOut(
        id=emp.id,
        codice_fiscale=emp.codice_fiscale,
        cognome=emp.cognome,
        nome=emp.nome,
        qualifica=emp.qualifica,
        mansione=emp.mansione,
        livello=emp.livello,
        email=emp.email,
        cellulare=emp.cellulare,
        attivo=emp.attivo,
        centro_di_costo=cc.name if cc else None,
        centro_di_costo_id=cc.id if cc else None,
    )


@router.put("/dipendenti/{dipendente_id}/contatti")
def aggiorna_contatti(
    dipendente_id: int,
    dati: EmployeeContactInput,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Aggiorna email e cellulare di un dipendente."""
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")
    emp.email = dati.email
    emp.cellulare = dati.cellulare
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Centri di costo per dipendente — default e mensili
# ---------------------------------------------------------------------------

def _trova_struttura(cc: CostCenter, tutti_by_id: dict) -> Optional[CostCenter]:
    """Risale la gerarchia fino a trovare il nodo di tipo 'struttura'."""
    current = cc
    visited: set[int] = set()
    while current and current.id not in visited:
        if current.tipo == "struttura":
            return current
        visited.add(current.id)
        current = tutti_by_id.get(current.parent_id) if current.parent_id else None
    return None


def _arricchisci_parent_code(righe: list[dict], db: Session) -> list[dict]:
    """Aggiunge parent_code, struttura_code e struttura_name a ogni riga CC."""
    tutti_by_id = {cc.id: cc for cc in db.query(CostCenter).all()}
    for r in righe:
        parent = tutti_by_id.get(r["parent_id"]) if r.get("parent_id") else None
        r["parent_code"] = parent.code if parent else None
        cc_obj = tutti_by_id.get(r["cost_center_id"])
        if cc_obj:
            struttura = _trova_struttura(cc_obj, tutti_by_id)
            r["struttura_code"] = struttura.code if struttura else None
            r["struttura_name"] = struttura.name if struttura else None
        else:
            r["struttura_code"] = None
            r["struttura_name"] = None
    return righe


@router.get("/dipendenti/{dipendente_id}/centri-di-costo", response_model=list[CCDefaultOut])
def get_cc_default(
    dipendente_id: int,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Assegnazioni CC default attive (anno_fine IS NULL) del dipendente."""
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")
    return _arricchisci_parent_code(get_default_attuale(db, dipendente_id), db)


@router.put("/dipendenti/{dipendente_id}/centri-di-costo")
def put_cc_default(
    dipendente_id: int,
    body: SalvaDefaultInput,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Salva le assegnazioni CC default con decorrenza (anno_inizio, mese_inizio).

    Chiude i record aperti e crea i nuovi. La somma delle percentuali deve essere 100.
    """
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")

    nuove = [a.model_dump() for a in body.assegnazioni]
    try:
        result = salva_default(db, dipendente_id, nuove, body.anno_inizio, body.mese_inizio)
    except ValueError as e:
        raise HTTPException(400, str(e))

    db.commit()
    return {"ok": True, "assegnazioni": result}


@router.get("/dipendenti/{dipendente_id}/centri-di-costo/mensile", response_model=list[AssegnazioneMensileOut])
def get_cc_mensile(
    dipendente_id: int,
    import_id: int = Query(...),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Assegnazioni CC per un mese specifico (da employee_cost_center_monthly)."""
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")
    return _arricchisci_parent_code(assegnazioni_mensili(db, dipendente_id, import_id), db)


@router.put("/dipendenti/{dipendente_id}/centri-di-costo/mensile")
def put_cc_mensile(
    dipendente_id: int,
    body: AssegnazioniMensiliInput,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Override manuale delle assegnazioni CC per un mese specifico.

    Cancella le assegnazioni esistenti e crea le nuove.
    La somma delle percentuali deve essere 100.
    """
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")
    imp = db.query(PayrollImport).filter(PayrollImport.id == body.import_id).first()
    if not imp:
        raise HTTPException(404, "Import non trovato")

    nuove = [a.model_dump() for a in body.assegnazioni]
    try:
        result = aggiorna_assegnazioni_mensili(db, dipendente_id, body.import_id, nuove)
    except ValueError as e:
        raise HTTPException(400, str(e))

    db.commit()
    return {"ok": True, "assegnazioni": result}


# ---------------------------------------------------------------------------
# Ricalcola ripartizioni CC sui mesi già importati
# ---------------------------------------------------------------------------

def _ricalcola_cc_per_dipendente(db: Session, dipendente_id: int, anno: Optional[int] = None) -> int:
    """Ricalcola le ripartizioni CC su tutti i mesi importati di un dipendente.

    I mesi con override manuale (override_manuale=True) vengono saltati.
    Restituisce il numero di mesi ricalcolati.
    """
    q = (
        db.query(EmployeeMonthly, PayrollImport)
        .join(PayrollImport, EmployeeMonthly.import_id == PayrollImport.id)
        .filter(EmployeeMonthly.employee_id == dipendente_id)
    )
    if anno:
        q = q.filter(PayrollImport.anno == anno)

    righe = q.order_by(PayrollImport.anno, PayrollImport.mese).all()
    n = 0
    for _em, imp in righe:
        # Salta i mesi con override manuale — l'utente ha impostato una ripartizione personalizzata
        ha_override = db.query(EmployeeCostCenterMonthly).filter(
            EmployeeCostCenterMonthly.employee_id == dipendente_id,
            EmployeeCostCenterMonthly.import_id == imp.id,
            EmployeeCostCenterMonthly.override_manuale == True,
        ).first() is not None
        if ha_override:
            continue

        db.query(EmployeeCostCenterMonthly).filter(
            EmployeeCostCenterMonthly.employee_id == dipendente_id,
            EmployeeCostCenterMonthly.import_id == imp.id,
        ).delete(synchronize_session=False)
        copia_default_a_mensile(db, dipendente_id, imp.id, date(imp.anno, imp.mese, 1))
        n += 1
    return n


@router.post("/dipendenti/{dipendente_id}/ricalcola-cc")
def ricalcola_cc(
    dipendente_id: int,
    anno: Optional[int] = Query(None, description="Anno da ricalcolare; None = tutti gli anni"),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Ricalcola le ripartizioni CC di un dipendente su tutti i mesi importati."""
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")

    n = _ricalcola_cc_per_dipendente(db, dipendente_id, anno)
    db.commit()
    return {"ok": True, "mesi_ricalcolati": n, "messaggio": f"Ricalcolati {n} mesi"}


@router.post("/dipendenti/ricalcola-cc-anno")
def ricalcola_cc_anno(
    anno: int = Query(..., description="Anno da ricalcolare"),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Ricalcola le ripartizioni CC di tutti i dipendenti per l'anno indicato."""
    # Recupera tutti i dipendenti che hanno almeno un import in quell'anno
    emp_ids = [
        r.employee_id
        for r in db.query(EmployeeMonthly.employee_id)
        .join(PayrollImport, EmployeeMonthly.import_id == PayrollImport.id)
        .filter(PayrollImport.anno == anno)
        .distinct()
        .all()
    ]

    totale_mesi = 0
    for eid in emp_ids:
        totale_mesi += _ricalcola_cc_per_dipendente(db, eid, anno)

    db.commit()
    return {
        "ok": True,
        "dipendenti_ricalcolati": len(emp_ids),
        "mesi_ricalcolati": totale_mesi,
        "messaggio": f"Ricalcolati {totale_mesi} mesi su {len(emp_ids)} dipendenti",
    }


# ---------------------------------------------------------------------------
# Vecchio endpoint (100% su singolo CC) — mantenuto per compatibilità
# ---------------------------------------------------------------------------

@router.put("/dipendenti/{dipendente_id}/centro-di-costo")
def aggiorna_cc_default_singolo(
    dipendente_id: int,
    dati: CostCenterInput,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Imposta un singolo CC al 100% con decorrenza al mese corrente (compatibilità)."""
    emp = db.query(Employee).filter(Employee.id == dipendente_id).first()
    if not emp:
        raise HTTPException(404, "Dipendente non trovato")
    cc = db.query(CostCenter).filter(CostCenter.id == dati.cost_center_id).first()
    if not cc:
        raise HTTPException(404, "Centro di costo non trovato")

    oggi = date.today()
    nuova = [{"cost_center_id": dati.cost_center_id, "percentuale": 100.0}]
    try:
        salva_default(db, dipendente_id, nuova, oggi.year, oggi.month)
    except ValueError as e:
        raise HTTPException(400, str(e))

    db.commit()
    return {"ok": True, "centro_di_costo": cc.name}


# ---------------------------------------------------------------------------
# Report mensile
# ---------------------------------------------------------------------------

@router.get("/dipendenti/report/mensile", response_model=ReportMensileOut)
def report_mensile(
    mese: int = Query(..., ge=1, le=12),
    anno: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Report mensile con lista dipendenti, voci di costo, totali per CC e per struttura."""
    imp = (
        db.query(PayrollImport)
        .filter(PayrollImport.mese == mese, PayrollImport.anno == anno)
        .first()
    )
    if not imp:
        raise HTTPException(404, f"Nessun import trovato per {mese}/{anno}")

    monthly_records = (
        db.query(EmployeeMonthly)
        .filter(EmployeeMonthly.import_id == imp.id)
        .all()
    )

    # Carica voci per questo import
    entries = (
        db.query(PayrollEntry)
        .filter(PayrollEntry.import_id == imp.id)
        .all()
    )
    entries_per_emp: dict[int, list[PayrollEntry]] = {}
    for e in entries:
        entries_per_emp.setdefault(e.employee_id, []).append(e)

    # Carica assegnazioni CC mensili per questo import
    cc_mensili_raw = (
        db.query(EmployeeCostCenterMonthly)
        .filter(EmployeeCostCenterMonthly.import_id == imp.id)
        .all()
    )
    cc_per_emp: dict[int, list[EmployeeCostCenterMonthly]] = {}
    for r in cc_mensili_raw:
        cc_per_emp.setdefault(r.employee_id, []).append(r)

    # Cache tutti i CC per lookup gerarchico a 3 livelli
    tutti_cc_by_id: dict[int, CostCenter] = {
        cc.id: cc for cc in db.query(CostCenter).all()
    }

    dipendenti_out = []
    totali_per_cc: dict[str, float] = {}
    # struttura_code → {costo_az, n_dipendenti_set}
    totali_struttura: dict[str, dict] = {}

    for m in monthly_records:
        emp = m.employee
        cc_primario = m.cost_center
        cc_name = cc_primario.name if cc_primario else "Non assegnato"
        cc_id = cc_primario.id if cc_primario else None

        # Assegnazioni CC mensili (split)
        cc_assegnazioni = cc_per_emp.get(emp.id, [])
        centri_out = []
        for ca in cc_assegnazioni:
            cc_obj = ca.cost_center
            parent = tutti_cc_by_id.get(cc_obj.parent_id) if cc_obj.parent_id else None
            struttura = _trova_struttura(cc_obj, tutti_cc_by_id)
            centri_out.append(CCAssegnazioneOut(
                cost_center_id=ca.cost_center_id,
                cost_center_code=cc_obj.code,
                cost_center_name=cc_obj.name,
                cost_center_tipo=cc_obj.tipo,
                parent_id=cc_obj.parent_id,
                parent_code=parent.code if parent else None,
                struttura_code=struttura.code if struttura else None,
                struttura_name=struttura.name if struttura else None,
                percentuale=float(ca.percentuale),
                override_manuale=ca.override_manuale,
            ))

        voci_out = []
        for e in entries_per_emp.get(emp.id, []):
            ct = e.cost_type
            voci_out.append(VoceCostoOut(
                code=ct.code,
                name=ct.name,
                categoria=ct.categoria,
                importo=float(e.importo),
            ))
        voci_out.sort(key=lambda v: v.code)

        costo_az = float(m.costo_aziendale or 0)

        dipendenti_out.append(DipendenteMensileOut(
            employee_id=emp.id,
            cognome=emp.cognome,
            nome=emp.nome,
            codice_fiscale=emp.codice_fiscale,
            qualifica=emp.qualifica,
            mansione=emp.mansione,
            livello=emp.livello,
            centro_di_costo=cc_name,
            centro_di_costo_id=cc_id,
            centri_di_costo=centri_out,
            override_manuale=m.override_manuale,
            retribuzione_netta=float(m.retribuzione_netta) if m.retribuzione_netta is not None else None,
            totale_lordo=float(m.totale_lordo) if m.totale_lordo is not None else None,
            costo_aziendale=costo_az if m.costo_aziendale is not None else None,
            incidenza_percentuale=float(m.incidenza_percentuale) if m.incidenza_percentuale is not None else None,
            voci=voci_out,
        ))

        # Totali per CC (nome CC → costo_az) — distribuzione proporzionale
        if cc_assegnazioni:
            for ca in cc_assegnazioni:
                cc_obj = ca.cost_center
                quota = costo_az * float(ca.percentuale) / 100
                totali_per_cc[cc_obj.name] = totali_per_cc.get(cc_obj.name, 0.0) + quota

                struttura = _trova_struttura(cc_obj, tutti_cc_by_id)

                if struttura:
                    s_code = struttura.code
                    if s_code not in totali_struttura:
                        totali_struttura[s_code] = {
                            "struttura_code": s_code,
                            "struttura_name": struttura.name,
                            "costo_aziendale": 0.0,
                            "dipendenti_set": set(),
                        }
                    totali_struttura[s_code]["costo_aziendale"] += quota
                    totali_struttura[s_code]["dipendenti_set"].add(emp.id)
        else:
            # Nessuna assegnazione CC mensile: usa CC primario
            totali_per_cc[cc_name] = totali_per_cc.get(cc_name, 0.0) + costo_az

    dipendenti_out.sort(key=lambda d: d.cognome)

    totali_struttura_out = [
        TotaleStruttura(
            struttura_code=v["struttura_code"],
            struttura_name=v["struttura_name"],
            costo_aziendale=round(v["costo_aziendale"], 2),
            n_dipendenti=len(v["dipendenti_set"]),
        )
        for v in sorted(totali_struttura.values(), key=lambda x: x["struttura_code"])
    ]

    return ReportMensileOut(
        mese=mese,
        anno=anno,
        societa=imp.societa,
        n_dipendenti=imp.n_dipendenti or 0,
        totale_netto=float(imp.totale_netto or 0),
        totale_lordo=float(imp.totale_lordo or 0),
        totale_costo_aziendale=float(imp.totale_costo_aziendale or 0),
        dipendenti=dipendenti_out,
        totali_per_cc=totali_per_cc,
        totali_per_struttura=totali_struttura_out,
    )


@router.get("/dipendenti/report/annuale-riepilogo")
def report_annuale_riepilogo(
    anno: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Report annuale aggregato nello stesso formato del report mensile.

    Somma tutti i mesi dell'anno per ciascun dipendente.
    CC mostrato: quello dell'ultimo mese disponibile per il dipendente.
    Voci: sommate per codice su tutti i mesi.
    """
    imports = (
        db.query(PayrollImport)
        .filter(PayrollImport.anno == anno)
        .order_by(PayrollImport.mese)
        .all()
    )
    if not imports:
        raise HTTPException(404, f"Nessun import trovato per il {anno}")

    import_ids = [imp.id for imp in imports]
    # Mappa imp_id → mese per recuperare l'ultimo mese per ogni dipendente
    mese_by_imp = {imp.id: imp.mese for imp in imports}

    tutti_cc_by_id: dict[int, CostCenter] = {
        cc.id: cc for cc in db.query(CostCenter).all()
    }

    monthly_all = (
        db.query(EmployeeMonthly)
        .filter(EmployeeMonthly.import_id.in_(import_ids))
        .all()
    )
    entries_all = (
        db.query(PayrollEntry)
        .filter(PayrollEntry.import_id.in_(import_ids))
        .all()
    )
    cc_all = (
        db.query(EmployeeCostCenterMonthly)
        .filter(EmployeeCostCenterMonthly.import_id.in_(import_ids))
        .all()
    )

    # Accumulo per dipendente
    acc: dict[int, dict] = {}
    for m in monthly_all:
        eid = m.employee_id
        mese_corrente = mese_by_imp[m.import_id]
        if eid not in acc:
            acc[eid] = {
                "emp": m.employee,
                "netto": 0.0, "lordo": 0.0, "costo_az": 0.0,
                "override": False, "ultimo_mese": 0, "ultimo_imp_id": None,
            }
        a = acc[eid]
        a["netto"] += float(m.retribuzione_netta or 0)
        a["lordo"] += float(m.totale_lordo or 0)
        a["costo_az"] += float(m.costo_aziendale or 0)
        a["override"] = a["override"] or bool(m.override_manuale)
        if mese_corrente > a["ultimo_mese"]:
            a["ultimo_mese"] = mese_corrente
            a["ultimo_imp_id"] = m.import_id

    # Voci per dipendente: somma per code su tutti i mesi
    cost_types = {ct.id: ct for ct in db.query(PayrollCostType).all()}
    voci_acc: dict[int, dict[str, dict]] = {}
    for e in entries_all:
        ct = cost_types.get(e.cost_type_id)
        if not ct:
            continue
        voci_acc.setdefault(e.employee_id, {})
        if ct.code not in voci_acc[e.employee_id]:
            voci_acc[e.employee_id][ct.code] = {"code": ct.code, "name": ct.name, "categoria": ct.categoria, "importo": 0.0}
        voci_acc[e.employee_id][ct.code]["importo"] += float(e.importo)

    # CC per (employee_id, import_id)
    cc_per_key: dict[tuple, list] = {}
    for r in cc_all:
        cc_per_key.setdefault((r.employee_id, r.import_id), []).append(r)

    dipendenti_out = []
    totali_struttura: dict[str, dict] = {}

    for eid, a in acc.items():
        emp = a["emp"]
        # CC dall'ultimo mese disponibile
        cc_assegnazioni = cc_per_key.get((eid, a["ultimo_imp_id"]), [])
        centri_out = []
        for ca in cc_assegnazioni:
            cc_obj = ca.cost_center
            parent = tutti_cc_by_id.get(cc_obj.parent_id) if cc_obj.parent_id else None
            struttura = _trova_struttura(cc_obj, tutti_cc_by_id)
            centri_out.append(CCAssegnazioneOut(
                cost_center_id=ca.cost_center_id,
                cost_center_code=cc_obj.code,
                cost_center_name=cc_obj.name,
                cost_center_tipo=cc_obj.tipo,
                parent_id=cc_obj.parent_id,
                parent_code=parent.code if parent else None,
                struttura_code=struttura.code if struttura else None,
                struttura_name=struttura.name if struttura else None,
                percentuale=float(ca.percentuale),
                override_manuale=ca.override_manuale,
            ))

        voci_out = sorted(
            [VoceCostoOut(**v) for v in voci_acc.get(eid, {}).values()],
            key=lambda v: v.code,
        )

        netto = a["netto"]
        costo = a["costo_az"]
        dipendenti_out.append(DipendenteMensileOut(
            employee_id=emp.id,
            cognome=emp.cognome,
            nome=emp.nome,
            codice_fiscale=emp.codice_fiscale,
            qualifica=emp.qualifica,
            mansione=emp.mansione,
            livello=emp.livello,
            centro_di_costo=centri_out[0].cost_center_name if centri_out else "Non assegnato",
            centro_di_costo_id=centri_out[0].cost_center_id if centri_out else None,
            centri_di_costo=centri_out,
            override_manuale=a["override"],
            retribuzione_netta=round(netto, 2),
            totale_lordo=round(a["lordo"], 2),
            costo_aziendale=round(costo, 2),
            incidenza_percentuale=round((costo - netto) / netto * 100, 2) if netto else None,
            voci=voci_out,
        ))

        # Totali per struttura (somma proporzionale su tutti i mesi)
        for imp_id in import_ids:
            ccs = cc_per_key.get((eid, imp_id), [])
            m_list = [m for m in monthly_all if m.employee_id == eid and m.import_id == imp_id]
            if not m_list or not ccs:
                continue
            c_az = float(m_list[0].costo_aziendale or 0)
            for ca in ccs:
                cc_obj = ca.cost_center
                struttura = _trova_struttura(cc_obj, tutti_cc_by_id)
                if struttura:
                    quota = c_az * float(ca.percentuale) / 100
                    s = struttura.code
                    if s not in totali_struttura:
                        totali_struttura[s] = {"struttura_code": s, "struttura_name": struttura.name, "costo_aziendale": 0.0, "dipendenti_set": set()}
                    totali_struttura[s]["costo_aziendale"] += quota
                    totali_struttura[s]["dipendenti_set"].add(eid)

    dipendenti_out.sort(key=lambda d: d.cognome)
    totali_struttura_out = [
        TotaleStruttura(
            struttura_code=v["struttura_code"],
            struttura_name=v["struttura_name"],
            costo_aziendale=round(v["costo_aziendale"], 2),
            n_dipendenti=len(v["dipendenti_set"]),
        )
        for v in sorted(totali_struttura.values(), key=lambda x: x["struttura_code"])
    ]

    totali = sum(a["costo_az"] for a in acc.values())
    return ReportMensileOut(
        mese=0,
        anno=anno,
        societa=imports[0].societa,
        n_dipendenti=len(acc),
        totale_netto=round(sum(a["netto"] for a in acc.values()), 2),
        totale_lordo=round(sum(a["lordo"] for a in acc.values()), 2),
        totale_costo_aziendale=round(totali, 2),
        dipendenti=dipendenti_out,
        totali_per_cc={},
        totali_per_struttura=totali_struttura_out,
    )


@router.get("/dipendenti/report/annuale")
def report_annuale(
    anno: int = Query(..., ge=2020),
    mese_da: int = Query(1, ge=1, le=12),
    mese_a: int = Query(12, ge=1, le=12),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Report costi ripartiti per centro di costo, mese per mese.

    Con mese_da/mese_a è possibile filtrare un periodo specifico dell'anno.
    Default: tutto l'anno (mese_da=1, mese_a=12).
    """
    imports = (
        db.query(PayrollImport)
        .filter(
            PayrollImport.anno == anno,
            PayrollImport.mese >= mese_da,
            PayrollImport.mese <= mese_a,
        )
        .order_by(PayrollImport.mese)
        .all()
    )

    mesi_disponibili = [imp.mese for imp in imports]

    if not imports:
        return {
            "anno": anno,
            "mesi_disponibili": [],
            "centri": [],
            "totali_mese": {},
            "totale_anno": 0.0,
        }

    import_ids = [imp.id for imp in imports]
    import_by_id = {imp.id: imp for imp in imports}

    # Riepilogo mensile: (import_id, employee_id) → costo_aziendale
    monthly_records = (
        db.query(EmployeeMonthly)
        .filter(EmployeeMonthly.import_id.in_(import_ids))
        .all()
    )
    costo_by_key: dict[tuple, float] = {
        (m.import_id, m.employee_id): float(m.costo_aziendale or 0)
        for m in monthly_records
    }

    # Assegnazioni CC mensili — raggruppa per (employee_id, import_id)
    cc_records = (
        db.query(EmployeeCostCenterMonthly)
        .filter(EmployeeCostCenterMonthly.import_id.in_(import_ids))
        .all()
    )
    cc_per_emp: dict[tuple, list] = {}
    for rec in cc_records:
        cc_per_emp.setdefault((rec.employee_id, rec.import_id), []).append(rec)

    # Aggrega: cc_id → mese → {costo, dipendenti}
    # Priorità: 1) override manuale, 2) default CC valido per il mese, 3) fallback mensile
    costo_per_cc: dict[int, dict[int, float]] = {}
    dip_per_cc: dict[int, dict[int, set]] = {}

    for m_rec in monthly_records:
        emp_id = m_rec.employee_id
        imp_id = m_rec.import_id
        imp = import_by_id.get(imp_id)
        if imp is None:
            continue
        mese = imp.mese
        costo = costo_by_key.get((imp_id, emp_id), 0.0)
        if costo == 0.0:
            continue

        mensili = cc_per_emp.get((emp_id, imp_id), [])
        ha_override = any(r.override_manuale for r in mensili)

        if ha_override:
            assegnazioni = [(r.cost_center_id, float(r.percentuale)) for r in mensili if r.override_manuale]
        else:
            # 1) default valido per quel mese esatto (decorrenza ≤ mese import)
            defaults = get_default_effettivo(db, emp_id, mese, anno)
            if not defaults:
                # 2) default attivi (anno_fine IS NULL): gestisce il caso in cui l'utente
                #    ha assegnato il CC dopo l'import con decorrenza futura rispetto al mese
                defaults = get_default_attuale(db, emp_id)
            if defaults:
                assegnazioni = [(d["cost_center_id"], d["percentuale"]) for d in defaults]
            else:
                # 3) Ultimo fallback: KMDIMARE copiato all'import
                assegnazioni = [(r.cost_center_id, float(r.percentuale)) for r in mensili]

        for cc_id, perc in assegnazioni:
            quota = costo * perc / 100.0
            cc_mesi = costo_per_cc.setdefault(cc_id, {})
            cc_mesi[mese] = cc_mesi.get(mese, 0.0) + quota
            dip_per_cc.setdefault(cc_id, {}).setdefault(mese, set()).add(emp_id)

    # Carica CC coinvolti, ordinati per struttura (parent) poi reparto
    cc_ids = list(costo_per_cc.keys())
    centri_db = (
        db.query(CostCenter)
        .filter(CostCenter.id.in_(cc_ids))
        .order_by(CostCenter.tipo, CostCenter.ordine, CostCenter.code)
        .all()
    )

    # Pre-carica tutti i CC per risalire la gerarchia a 3 livelli (reparto→categoria→struttura)
    tutti_cc = {cc.id: cc for cc in db.query(CostCenter).all()}

    centri_out = []
    totali_mese: dict[int, float] = {}
    totale_anno = 0.0

    for cc in centri_db:
        mesi_cc = costo_per_cc.get(cc.id, {})
        totale_cc = sum(mesi_cc.values())
        totale_anno += totale_cc

        mesi_out = {}
        for m, costo in mesi_cc.items():
            mesi_out[str(m)] = {
                "costo": round(costo, 2),
                "n_dipendenti": len(dip_per_cc.get(cc.id, {}).get(m, set())),
            }
            totali_mese[m] = totali_mese.get(m, 0.0) + costo

        parent = tutti_cc.get(cc.parent_id) if cc.parent_id else None
        struttura = _trova_struttura(cc, tutti_cc)
        centri_out.append({
            "id": cc.id,
            "code": cc.code,
            "name": cc.name,
            "tipo": cc.tipo,
            "parent_id": cc.parent_id,
            "parent_code": parent.code if parent else None,
            "parent_name": parent.name if parent else None,
            "struttura_code": struttura.code if struttura else None,
            "struttura_name": struttura.name if struttura else None,
            "mesi": mesi_out,
            "totale": round(totale_cc, 2),
        })

    return {
        "anno": anno,
        "mesi_disponibili": mesi_disponibili,
        "centri": centri_out,
        "totali_mese": {str(k): round(v, 2) for k, v in totali_mese.items()},
        "totale_anno": round(totale_anno, 2),
    }


@router.get("/dipendenti/report/annuale/dettaglio-cc")
def dettaglio_cc_annuale(
    anno: int = Query(..., ge=2020),
    mese_da: int = Query(1, ge=1, le=12),
    mese_a: int = Query(12, ge=1, le=12),
    cc_code: str = Query(None, description="Codice esatto del CC (modalità singola barra)"),
    cc_name: str = Query(None, description="Nome reparto esatto (modalità somma per reparto)"),
    cat_name: str = Query(None, description="Nome categoria: cerca reparti il cui parent ha questo nome"),
    strutture: str = Query(None, description="Codici struttura separati da virgola (es. CLB,DPH)"),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_utente_attivo),
):
    """Restituisce i dipendenti che contribuiscono a un CC specifico nel periodo indicato.

    Usa la stessa logica di risoluzione CC di report_annuale (default effettivo,
    non i soli record mensili) per garantire coerenza con i totali del grafico.
    """
    imports = db.query(PayrollImport).filter(
        PayrollImport.anno == anno,
        PayrollImport.mese >= mese_da,
        PayrollImport.mese <= mese_a,
    ).all()
    if not imports:
        return []

    import_ids = [imp.id for imp in imports]
    import_by_id = {imp.id: imp for imp in imports}
    strutture_list = [s.strip() for s in strutture.split(",")] if strutture else None

    # Cache CC per id
    tutti_cc: dict[int, CostCenter] = {
        cc.id: cc for cc in db.query(CostCenter).all()
    }
    struttura_by_id: dict[int, CostCenter] = {
        cc.id: cc for cc in tutti_cc.values() if cc.tipo == "struttura"
    }

    # Strutture da includere nel filtro
    strutture_parent_ids: set[int] | None = None
    if strutture_list:
        strutture_parent_ids = {
            cc.id for cc in struttura_by_id.values() if cc.code in strutture_list
        }

    def cc_corrisponde(cc: CostCenter) -> bool:
        """Controlla se un CC corrisponde al filtro richiesto (supporta 3 livelli)."""
        if cc_code:
            return cc.code == cc_code
        if cc_name:
            # Cerca per nome esatto del reparto
            if cc.name != cc_name:
                return False
            if strutture_parent_ids is not None:
                struttura = _trova_struttura(cc, tutti_cc)
                return struttura is not None and struttura.id in strutture_parent_ids
            return True
        if cat_name:
            # Cerca reparti il cui parent categoria ha questo nome (vista macrocategorie)
            parent = tutti_cc.get(cc.parent_id) if cc.parent_id else None
            if parent is None or parent.name != cat_name:
                return False
            if strutture_parent_ids is not None:
                struttura = _trova_struttura(cc, tutti_cc)
                return struttura is not None and struttura.id in strutture_parent_ids
            return True
        return False

    # Costo aziendale e assegnazioni mensili
    monthly_records = (
        db.query(EmployeeMonthly)
        .filter(EmployeeMonthly.import_id.in_(import_ids))
        .all()
    )
    costo_by_key = {
        (m.import_id, m.employee_id): float(m.costo_aziendale or 0)
        for m in monthly_records
    }
    cc_per_emp: dict[tuple, list] = {}
    for rec in db.query(EmployeeCostCenterMonthly).filter(
        EmployeeCostCenterMonthly.import_id.in_(import_ids)
    ).all():
        cc_per_emp.setdefault((rec.employee_id, rec.import_id), []).append(rec)

    emp_acc: dict[int, float] = {}
    emp_strutture: dict[int, set] = {}

    for m_rec in monthly_records:
        emp_id = m_rec.employee_id
        imp_id = m_rec.import_id
        imp = import_by_id.get(imp_id)
        if imp is None:
            continue
        mese = imp.mese
        costo = costo_by_key.get((imp_id, emp_id), 0.0)
        if costo == 0.0:
            continue

        # Stessa logica di risoluzione CC usata in report_annuale
        mensili = cc_per_emp.get((emp_id, imp_id), [])
        ha_override = any(r.override_manuale for r in mensili)

        if ha_override:
            assegnazioni = [
                (r.cost_center_id, float(r.percentuale))
                for r in mensili if r.override_manuale
            ]
        else:
            defaults = get_default_effettivo(db, emp_id, mese, anno)
            if not defaults:
                defaults = get_default_attuale(db, emp_id)
            if defaults:
                assegnazioni = [(d["cost_center_id"], d["percentuale"]) for d in defaults]
            else:
                assegnazioni = [(r.cost_center_id, float(r.percentuale)) for r in mensili]

        for cc_id, perc in assegnazioni:
            cc = tutti_cc.get(cc_id)
            if cc is None or not cc_corrisponde(cc):
                continue
            quota = costo * perc / 100.0
            emp_acc[emp_id] = emp_acc.get(emp_id, 0.0) + quota
            if cc.parent_id:
                parent = struttura_by_id.get(cc.parent_id)
                if parent:
                    emp_strutture.setdefault(emp_id, set()).add(parent.code)

    if not emp_acc:
        return []

    employees = {
        e.id: e for e in db.query(Employee)
        .filter(Employee.id.in_(emp_acc.keys())).all()
    }

    return sorted(
        [
            {
                "employee_id": eid,
                "cognome": employees[eid].cognome,
                "nome": employees[eid].nome,
                "costo_anno": round(costo, 2),
                "strutture": sorted(emp_strutture.get(eid, set())),
            }
            for eid, costo in emp_acc.items()
            if eid in employees
        ],
        key=lambda x: -x["costo_anno"],
    )


@router.put("/dipendenti/monthly/{monthly_id}/centro-di-costo")
def override_cc_mensile(
    monthly_id: int,
    dati: CostCenterInput,
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Modifica manuale del CC primario per un mese specifico (legacy)."""
    m = db.query(EmployeeMonthly).filter(EmployeeMonthly.id == monthly_id).first()
    if not m:
        raise HTTPException(404, "Record mensile non trovato")
    cc = db.query(CostCenter).filter(CostCenter.id == dati.cost_center_id).first()
    if not cc:
        raise HTTPException(404, "Centro di costo non trovato")
    m.cost_center_id = dati.cost_center_id
    m.override_manuale = True
    db.commit()
    return {"ok": True, "centro_di_costo": cc.name}


# ---------------------------------------------------------------------------
# Storico import e cancellazione
# ---------------------------------------------------------------------------

@router.get("/dipendenti/import/storico", response_model=list[ImportStorico])
def storico_import(
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Lista di tutti gli import effettuati."""
    return (
        db.query(PayrollImport)
        .order_by(PayrollImport.anno.desc(), PayrollImport.mese.desc())
        .all()
    )


@router.delete("/dipendenti/import/{import_id}")
def elimina_import(
    import_id: int,
    conferma: bool = Query(False),
    db: Session = Depends(get_db),
    utente=Depends(richiedi_admin),
):
    """Cancella un import, tutti i dati collegati e i dipendenti rimasti orfani."""
    if not conferma:
        raise HTTPException(400, "Passare conferma=true per cancellare l'import")
    imp = db.query(PayrollImport).filter(PayrollImport.id == import_id).first()
    if not imp:
        raise HTTPException(404, "Import non trovato")
    mese, anno, societa = imp.mese, imp.anno, imp.societa

    # Dipendenti presenti in questo import
    emp_ids = [r.employee_id for r in
               db.query(EmployeeMonthly.employee_id)
               .filter(EmployeeMonthly.import_id == import_id).all()]

    db.delete(imp)
    db.flush()  # esegui CASCADE prima di controllare gli orfani

    # Elimina dipendenti che ora non hanno più nessun import collegato
    n_orfani = _elimina_dipendenti_orfani(db, emp_ids)
    db.commit()
    return {"ok": True, "eliminato": f"{societa} {mese}/{anno}", "dipendenti_eliminati": n_orfani}
