"""Router FastAPI — gestione moduli applicativi e permessi per ruolo."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import richiedi_admin, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import Module, ModulePermission

router = APIRouter(prefix="/modules", tags=["modules"])


# ---------------------------------------------------------------------------
# Schemi Pydantic
# ---------------------------------------------------------------------------

class PermessoSchema(BaseModel):
    ruolo: str
    puo_vedere: bool
    puo_modificare: bool
    puo_importare: bool


class ModuleSchema(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    route: Optional[str] = None
    ordine: int
    attivo: bool
    colore: Optional[str] = None
    # permessi dell'utente corrente (presenti solo in GET /modules/)
    puo_vedere: Optional[bool] = None
    puo_modificare: Optional[bool] = None
    puo_importare: Optional[bool] = None


class ModuleDettaglio(ModuleSchema):
    """Dettaglio modulo con tutti i permessi per ruolo (solo admin)."""
    permessi: List[PermessoSchema] = []


class ModuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    route: Optional[str] = None
    ordine: Optional[int] = None
    attivo: Optional[bool] = None
    colore: Optional[str] = None


class PermessoUpdate(BaseModel):
    puo_vedere: bool
    puo_modificare: bool
    puo_importare: bool


class OrdineUpdate(BaseModel):
    """Lista di code in ordine desiderato."""
    ordine: List[str]


# ---------------------------------------------------------------------------
# Endpoint pubblici (utente loggato)
# ---------------------------------------------------------------------------

@router.get("/", response_model=List[ModuleSchema], dependencies=[Depends(richiedi_utente_attivo)])
def lista_moduli(utente=Depends(richiedi_utente_attivo), db: Session = Depends(get_db)):
    """
    Restituisce i moduli attivi con i permessi dell'utente corrente.
    I moduli disattivati non compaiono nella lista.
    """
    moduli = db.query(Module).filter(Module.attivo == True).order_by(Module.ordine).all()
    result = []
    for m in moduli:
        perm = db.query(ModulePermission).filter(
            ModulePermission.module_code == m.code,
            ModulePermission.ruolo == utente.ruolo,
        ).first()
        result.append(ModuleSchema(
            code=m.code,
            name=m.name,
            description=m.description,
            icon=m.icon,
            route=m.route,
            ordine=m.ordine,
            attivo=m.attivo,
            colore=m.colore,
            puo_vedere=perm.puo_vedere if perm else False,
            puo_modificare=perm.puo_modificare if perm else False,
            puo_importare=perm.puo_importare if perm else False,
        ))
    return result


@router.get("/{code}", response_model=ModuleDettaglio, dependencies=[Depends(richiedi_utente_attivo)])
def dettaglio_modulo(code: str, db: Session = Depends(get_db)):
    """Dettaglio di un singolo modulo con tutti i permessi per ruolo."""
    m = db.query(Module).filter(Module.code == code).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"Modulo '{code}' non trovato")
    return ModuleDettaglio(
        code=m.code,
        name=m.name,
        description=m.description,
        icon=m.icon,
        route=m.route,
        ordine=m.ordine,
        attivo=m.attivo,
        colore=m.colore,
        permessi=[
            PermessoSchema(
                ruolo=p.ruolo,
                puo_vedere=p.puo_vedere,
                puo_modificare=p.puo_modificare,
                puo_importare=p.puo_importare,
            )
            for p in m.permissions
        ],
    )


# ---------------------------------------------------------------------------
# Endpoint admin
# ---------------------------------------------------------------------------

@router.put("/admin/{code}", response_model=ModuleSchema, dependencies=[Depends(richiedi_admin)])
def aggiorna_modulo(code: str, body: ModuleUpdate, db: Session = Depends(get_db)):
    """Modifica nome, icona, route, ordine, stato attivo o colore di un modulo."""
    m = db.query(Module).filter(Module.code == code).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"Modulo '{code}' non trovato")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(m, field, val)
    db.commit()
    db.refresh(m)
    return ModuleSchema(
        code=m.code, name=m.name, description=m.description,
        icon=m.icon, route=m.route, ordine=m.ordine,
        attivo=m.attivo, colore=m.colore,
    )


@router.put("/admin/ordine", dependencies=[Depends(richiedi_admin)])
def aggiorna_ordine(body: OrdineUpdate, db: Session = Depends(get_db)):
    """Aggiorna l'ordine di tutti i moduli. Route statica prima di /admin/{code} per evitare conflitti."""
    for idx, code in enumerate(body.ordine):
        m = db.query(Module).filter(Module.code == code).first()
        if m:
            m.ordine = idx + 1
    db.commit()
    return {"ok": True}


@router.put("/admin/{code}/permissions/{ruolo}", dependencies=[Depends(richiedi_admin)])
def aggiorna_permessi(code: str, ruolo: str, body: PermessoUpdate, db: Session = Depends(get_db)):
    """Aggiorna i permessi di un ruolo su un modulo specifico."""
    m = db.query(Module).filter(Module.code == code).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"Modulo '{code}' non trovato")
    perm = db.query(ModulePermission).filter(
        ModulePermission.module_code == code,
        ModulePermission.ruolo == ruolo,
    ).first()
    if not perm:
        perm = ModulePermission(module_code=code, ruolo=ruolo)
        db.add(perm)
    perm.puo_vedere = body.puo_vedere
    perm.puo_modificare = body.puo_modificare
    perm.puo_importare = body.puo_importare
    db.commit()
    return {"ok": True, "module_code": code, "ruolo": ruolo}
