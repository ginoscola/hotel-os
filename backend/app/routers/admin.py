"""Router FastAPI — area admin: statistiche, gestione utenti e cancellazione dati di test."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import hash_password, richiedi_admin
from app.database import get_db
from app.models.revenue import DailyRevenue, ImportSession, User
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
    """Modifica ruolo o stato attivo di un utente."""
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

    if dati.ruolo is not None:
        utente.ruolo = dati.ruolo
    if dati.attivo is not None:
        utente.attivo = dati.attivo

    db.commit()
    db.refresh(utente)
    return utente


@router.post("/utenti/{user_id}/reset-password")
def reset_password(user_id: int, dati: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reimposta la password di un utente."""
    utente = db.query(User).filter(User.id == user_id).first()
    if not utente:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    utente.password_hash = hash_password(dati.password)
    db.commit()
    return {"messaggio": "Password aggiornata con successo"}
