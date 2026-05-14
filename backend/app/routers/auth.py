from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Form, Request, status
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth import crea_token_accesso, verify_password, richiedi_utente_attivo
from app.database import get_db
from app.models.revenue import User
from app.schemas.auth import TokenResponse, UserRead

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/15minutes")
def login(request: Request, username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user or not user.attivo or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenziali errate",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user.last_login = datetime.utcnow()
    db.commit()
    access_token = crea_token_accesso(user.username, user.ruolo)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user.username,
        "ruolo": user.ruolo,
    }


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(richiedi_utente_attivo)):
    return user


@router.post("/logout")
def logout():
    return {"message": "Logout effettuato. Elimina il token lato client."}
