from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.core.security import create_access_token, verify_password
from app.schemas.api import LoginIn, TokenOut

router = APIRouter()


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, settings: Settings = Depends(get_settings)):
    if not verify_password(body.password, settings):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong password")
    return TokenOut(access_token=create_access_token(body.name.strip(), settings))
