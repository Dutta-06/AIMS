"""Protection for an app with no login.

There is no password, so the safeguard is *where it runs* and *who can call it*:
  * the backend listens on localhost only (see main.py), and
  * every state-changing request must come from an allowed origin and carry the
    `X-Corpo-Mailer` header.

The header matters because a bare POST (such as /drafts/1/send) is a "simple request" that a
browser will send from ANY website you happen to visit, with no CORS preflight. Requiring a
custom header forces a preflight, which the CORS rules then refuse for foreign origins.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
HEADER = "x-corpo-mailer"


class RequestGuard(BaseHTTPMiddleware):
    def __init__(self, app, allowed_origins: list[str]):
        super().__init__(app)
        self.allowed = set(allowed_origins)

    async def dispatch(self, request, call_next):
        if request.method not in SAFE_METHODS:
            origin = request.headers.get("origin")
            if origin and origin not in self.allowed:
                return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
            if request.headers.get(HEADER) != "1":
                return JSONResponse({"detail": "Missing X-Corpo-Mailer header"}, status_code=403)
        return await call_next(request)
