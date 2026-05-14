import os
from datetime import datetime, timedelta

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import User

load_dotenv()

SECRET_KEY = os.getenv('SECRET_KEY', 'chiave_segreta_da_cambiare')
ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_HOURS = 8

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
security = HTTPBearer()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def crea_token_accesso(username: str, ruolo: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode = {
        'sub': username,
        'role': ruolo,
        'exp': expire,
    }
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verifica_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get('sub')
        ruolo: str = payload.get('role')
        if username is None or ruolo is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail='Token non valido',
                headers={'WWW-Authenticate': 'Bearer'},
            )
        return {'username': username, 'role': ruolo}
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Token non valido o scaduto',
            headers={'WWW-Authenticate': 'Bearer'},
        )


def _leggi_utente_da_token(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> User:
    token = credentials.credentials
    payload = verifica_token(token)
    user = db.query(User).filter(User.username == payload['username']).first()
    if not user or not user.attivo:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Utente non attivo o non trovato',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    return user


def richiedi_utente_attivo(user: User = Depends(_leggi_utente_da_token)) -> User:
    return user


def richiedi_admin(user: User = Depends(_leggi_utente_da_token)) -> User:
    if user.ruolo != 'admin':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Accesso riservato agli amministratori',
        )
    return user
