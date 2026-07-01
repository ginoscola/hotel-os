"""Router FastAPI — area admin: statistiche, gestione utenti e cancellazione dati di test."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import hash_password, richiedi_admin
from app.database import get_db
from pydantic import BaseModel
from app.models.revenue import DailyRevenue, ImportSession, Module, ModulePermission, User, UserModulePermission
from app.schemas.auth import UserCreate, UserRead, UserUpdate, ResetPasswordRequest

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(richiedi_admin)])


@router.get("/test-stats")
def statistiche_test(db: Session = Depends(get_db)):
    """Restituisce il numero di righe di test presenti nelle tabelle."""
    n_revenue = db.query(DailyRevenue).filter(DailyRevenue.is_test == True).count()
    n_imports = db.query(ImportSession).filter(ImportSession.is_test == True).count()
    return {
        "righe_revenue": n_revenue,
        "sessioni_import": n_imports,
        "totale": n_revenue + n_imports,
    }


@router.delete("/test-data")
def cancella_dati_test(db: Session = Depends(get_db)):
    """Elimina tutte le righe contrassegnate come test da daily_revenue e imports."""
    n_revenue = db.query(DailyRevenue).filter(DailyRevenue.is_test == True).delete()
    n_imports = db.query(ImportSession).filter(ImportSession.is_test == True).delete()
    db.commit()
    return {
        "righe_revenue_cancellate": n_revenue,
        "sessioni_import_cancellate": n_imports,
        "messaggio": f"Cancellati {n_revenue} dati revenue e {n_imports} sessioni di import di test",
    }


@router.get("/utenti", response_model=list[UserRead])
def lista_utenti(db: Session = Depends(get_db)):
    """Restituisce la lista utenti senza password hash."""
    return db.query(User).all()


@router.post("/utenti", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def crea_utente(dati: UserCreate, db: Session = Depends(get_db)):
    """Crea un nuovo utente admin o viewer."""
    if db.query(User).filter(User.username == dati.username).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username già in uso")
    if dati.email and db.query(User).filter(User.email == dati.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email già in uso")

    utente = User(
        username=dati.username,
        email=dati.email,
        password_hash=hash_password(dati.password),
        ruolo=dati.ruolo,
        attivo=True,
    )
    db.add(utente)
    db.commit()
    db.refresh(utente)
    return utente


@router.put("/utenti/{user_id}", response_model=UserRead)
def aggiorna_utente(user_id: int, dati: UserUpdate, db: Session = Depends(get_db)):
    """Modifica username, email, ruolo o stato attivo di un utente."""
    utente = db.query(User).filter(User.id == user_id).first()
    if not utente:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    if dati.attivo is False and utente.ruolo == 'admin':
        amministratori_attivi = db.query(User).filter(User.ruolo == 'admin', User.attivo == True, User.id != user_id).count()
        if amministratori_attivi == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Non è possibile disattivare l'ultimo amministratore attivo",
            )

    if dati.username is not None and dati.username != utente.username:
        if db.query(User).filter(User.username == dati.username, User.id != user_id).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username già in uso")
        utente.username = dati.username

    if dati.email is not None:
        email_val = dati.email if dati.email != '' else None
        if email_val and email_val != utente.email:
            if db.query(User).filter(User.email == email_val, User.id != user_id).first():
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email già in uso")
        utente.email = email_val

    if dati.ruolo is not None:
        utente.ruolo = dati.ruolo
    if dati.attivo is not None:
        utente.attivo = dati.attivo

    db.commit()
    db.refresh(utente)
    return utente


@router.delete("/utenti/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def elimina_utente(user_id: int, db: Session = Depends(get_db)):
    """Elimina definitivamente un utente. Blocco se è l'unico admin attivo."""
    utente = db.query(User).filter(User.id == user_id).first()
    if not utente:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    if utente.ruolo == 'admin' and utente.attivo:
        altri_admin = db.query(User).filter(User.ruolo == 'admin', User.attivo == True, User.id != user_id).count()
        if altri_admin == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Non è possibile eliminare l'unico amministratore attivo",
            )

    db.delete(utente)
    db.commit()


@router.post("/utenti/{user_id}/reset-password")
def reset_password(user_id: int, dati: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reimposta la password di un utente."""
    utente = db.query(User).filter(User.id == user_id).first()
    if not utente:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    utente.password_hash = hash_password(dati.password)
    db.commit()
    return {"messaggio": "Password aggiornata con successo"}


# ---------------------------------------------------------------------------
# Permessi modulo per-utente
# ---------------------------------------------------------------------------

class PermessoUtenteItem(BaseModel):
    module_code: str
    puo_vedere: bool


@router.get("/utenti/{user_id}/permessi")
def get_permessi_utente(user_id: int, db: Session = Depends(get_db)):
    """Stato effettivo dei permessi modulo per un utente (override + fallback ruolo)."""
    utente = db.query(User).filter(User.id == user_id).first()
    if not utente:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    moduli = db.query(Module).filter(Module.attivo == True).order_by(Module.ordine).all()
    overrides = {
        o.module_code: o
        for o in db.query(UserModulePermission).filter(UserModulePermission.user_id == user_id).all()
    }
    result = []
    for m in moduli:
        perm_ruolo = db.query(ModulePermission).filter(
            ModulePermission.module_code == m.code,
            ModulePermission.ruolo == utente.ruolo,
        ).first()
        default_vedere = perm_ruolo.puo_vedere if perm_ruolo else False
        if m.code in overrides:
            puo_vedere = overrides[m.code].puo_vedere
            ha_override = puo_vedere != default_vedere
        else:
            puo_vedere = default_vedere
            ha_override = False
        result.append({
            "module_code": m.code,
            "module_name": m.name,
            "module_icon": m.icon,
            "puo_vedere": puo_vedere,
            "default_vedere": default_vedere,
            "ha_override": ha_override,
        })
    return result


@router.put("/utenti/{user_id}/permessi")
def set_permessi_utente(user_id: int, permessi: list[PermessoUtenteItem], db: Session = Depends(get_db)):
    """Salva override permessi modulo per-utente. Rimuove l'override se coincide con il default di ruolo."""
    utente = db.query(User).filter(User.id == user_id).first()
    if not utente:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    for p in permessi:
        perm_ruolo = db.query(ModulePermission).filter(
            ModulePermission.module_code == p.module_code,
            ModulePermission.ruolo == utente.ruolo,
        ).first()
        default_vedere = perm_ruolo.puo_vedere if perm_ruolo else False

        override = db.query(UserModulePermission).filter(
            UserModulePermission.user_id == user_id,
            UserModulePermission.module_code == p.module_code,
        ).first()

        if p.puo_vedere == default_vedere:
            # Uguale al default di ruolo — rimuove l'override se esiste
            if override:
                db.delete(override)
        else:
            if override:
                override.puo_vedere = p.puo_vedere
            else:
                db.add(UserModulePermission(user_id=user_id, module_code=p.module_code, puo_vedere=p.puo_vedere))

    db.commit()
    return {"ok": True}
