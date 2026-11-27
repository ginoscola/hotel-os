import hashlib
import os
import secrets
from datetime import date, datetime, timedelta, timezone

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
import jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.revenue import ApiKey, User

load_dotenv()

CHIAVI_DI_ESEMPIO = {
    'chiave_segreta_da_cambiare',
    'CAMBIA_QUESTA_CHIAVE_CON_UNA_STRINGA_CASUALE_LUNGA',
}
LUNGHEZZA_MINIMA_CHIAVE = 32


def leggi_secret_key(valore: str | None) -> str:
    """Chiave di firma dei token: senza una chiave vera il backend non deve partire.

    Prima c'era un valore di ripiego fisso: se .env non veniva letto, i token
    erano firmati con una chiave pubblica (presente nel repository) e chiunque
    poteva costruirsene uno valido.
    """
    if not valore or valore in CHIAVI_DI_ESEMPIO or len(valore) < LUNGHEZZA_MINIMA_CHIAVE:
        raise RuntimeError(
            'SECRET_KEY mancante, di esempio o più corta di '
            f'{LUNGHEZZA_MINIMA_CHIAVE} caratteri: impostarla in backend/.env '
            "(es. python3 -c \"import secrets; print(secrets.token_hex(32))\")"
        )
    return valore


SECRET_KEY = leggi_secret_key(os.getenv('SECRET_KEY'))
ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_HOURS = 8

pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
security = HTTPBearer(auto_error=False)
intestazione_chiave_api = APIKeyHeader(name='X-API-Key', auto_error=False)

PREFISSO_CHIAVE = 'hos_'
METODI_SOLA_LETTURA = {'GET', 'HEAD', 'OPTIONS'}
AGGIORNA_ULTIMO_USO_OGNI = timedelta(minutes=5)   # evita una scrittura sul DB a ogni chiamata


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def crea_token_accesso(username: str, ruolo: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
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
    except jwt.PyJWTError:   # firma errata, token scaduto o malformato (PyJWT dal 08/11/2026, prima python-jose)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Token non valido o scaduto',
            headers={'WWW-Authenticate': 'Bearer'},
        )


def genera_chiave_api() -> tuple[str, str, str]:
    """Nuova chiave API: (chiave in chiaro, prefisso visibile, hash da salvare)."""
    chiave = PREFISSO_CHIAVE + secrets.token_urlsafe(32)
    return chiave, chiave[:12], hash_chiave_api(chiave)


def hash_chiave_api(chiave: str) -> str:
    # SHA-256 basta: la chiave è casuale a 256 bit, non una password scelta da una persona
    return hashlib.sha256(chiave.encode()).hexdigest()


def _utente_da_chiave_api(request: Request, chiave: str, db: Session) -> User:
    """Utente collegato a una chiave API valida. Le chiavi sono in sola lettura: 403 su ogni scrittura."""
    record = db.query(ApiKey).filter(ApiKey.hash_chiave == hash_chiave_api(chiave)).first()
    oggi = date.today()
    if (record is None or not record.attiva or (record.scade_il and record.scade_il < oggi)
            or record.user is None or not record.user.attivo):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Chiave API non valida, revocata o scaduta')
    if request.method not in METODI_SOLA_LETTURA:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Le chiavi API sono in sola lettura')
    adesso = datetime.now(timezone.utc)
    if record.ultimo_uso is None or adesso - record.ultimo_uso > AGGIORNA_ULTIMO_USO_OGNI:
        record.ultimo_uso = adesso
        db.commit()
    request.state.via_chiave_api = True
    return record.user


def _leggi_utente_da_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    chiave_api: str | None = Depends(intestazione_chiave_api),
    db: Session = Depends(get_db),
) -> User:
    """Utente della richiesta: da chiave API (header X-API-Key, agenti AI) o da token JWT (login)."""
    if chiave_api:
        return _utente_da_chiave_api(request, chiave_api, db)
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Autenticazione richiesta',
            headers={'WWW-Authenticate': 'Bearer'},
        )
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


def richiedi_admin(request: Request, user: User = Depends(_leggi_utente_da_token)) -> User:
    # una chiave API non dà mai accesso agli endpoint admin, qualunque sia il ruolo dell'utente
    if user.ruolo != 'admin' or getattr(request.state, 'via_chiave_api', False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Accesso riservato agli amministratori',
        )
    return user
