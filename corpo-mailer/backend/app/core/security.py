import hmac
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)
_ALGORITHM = "HS256"


def verify_password(supplied: str, settings: Settings) -> bool:
    return hmac.compare_digest(supplied.encode(), settings.app_password.encode())


def create_access_token(operator: str, settings: Settings) -> str:
    expires = datetime.now(UTC) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": operator, "exp": expires}, settings.secret_key, _ALGORITHM)


def current_operator(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> str:
    """The name of the logged-in operator; recorded as the approver on drafts."""
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, settings.secret_key, [_ALGORITHM])
    except jwt.PyJWTError:
        raise unauthorized from None
    return str(payload["sub"])
