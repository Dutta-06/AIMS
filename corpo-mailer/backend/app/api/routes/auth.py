from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core import auth
from app.core.config import get_settings

router = APIRouter()


class LoginIn(BaseModel):
    password: str = Field(max_length=200)


@router.get("/status")
def status(request: Request):
    """Does the team need to sign in, and is this browser already signed in?"""
    settings = get_settings()
    required = bool(settings.app_password)
    return {
        "required": required,
        "authenticated": (not required) or auth.token_valid(settings, auth.bearer(request)),
    }


@router.post("/login")
def login(body: LoginIn):
    settings = get_settings()
    if not settings.app_password:
        raise HTTPException(409, "No password is set on this backend")
    wait = auth.limiter.wait()
    if wait:
        raise HTTPException(
            429,
            f"Too many wrong passwords. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )
    if not auth.password_matches(settings, body.password):
        auth.limiter.failed()
        raise HTTPException(401, "That password isn't right")
    auth.limiter.succeeded()
    token, expires = auth.make_token(settings)
    return {"token": token, "expires_at": expires}
