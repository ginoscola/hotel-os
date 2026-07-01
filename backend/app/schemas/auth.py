from datetime import datetime
from pydantic import BaseModel, EmailStr, Field
from typing import Optional


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    username: str
    ruolo: str


class UserRead(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    ruolo: str
    attivo: bool
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None

    model_config = {
        'from_attributes': True,
    }


class UserCreate(BaseModel):
    username: str = Field(..., max_length=50)
    email: Optional[EmailStr] = None
    password: str = Field(..., min_length=6)
    ruolo: str = Field(..., pattern='^(admin|viewer)$')


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, max_length=50)
    email: Optional[EmailStr] = None
    ruolo: Optional[str] = Field(None, pattern='^(admin|viewer)$')
    attivo: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    password: str = Field(..., min_length=6)
