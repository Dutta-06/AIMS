import asyncio
import logging
import os
from contextlib import asynccontextmanager

from dotenv import dotenv_values
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth as auth_routes
from app.api.routes import crm, dashboard, discovery, drafts, gmail, imports, replies
from app.core.auth import AuthGate
from app.core.config import Settings, get_settings
from app.core.guard import RequestGuard
from app.services.poller import poll_forever

LEGACY_SETTINGS = {
    "SMTP_USER": "Gmail is connected with Settings > Connect Gmail",
    "SMTP_PASSWORD": "Gmail is connected with Settings > Connect Gmail",
    "IMAP_USER": "Gmail is connected with Settings > Connect Gmail",
    "IMAP_PASSWORD": "Gmail is connected with Settings > Connect Gmail",
    "APP_PASSWORD": "people now sign in with Google; list who may in ALLOWED_EMAILS",
}


def warn_about_legacy_settings() -> list[str]:
    """Mail passwords and the team password are gone (Google sign-in replaced them). Say so if the
    old lines are still set (in the environment or in .env) rather than ignoring them silently."""
    values = dict(os.environ)
    env_file = Settings.model_config.get("env_file")
    if env_file:
        values.update({k.upper(): v for k, v in dotenv_values(env_file).items() if v})
    found = [k for k in LEGACY_SETTINGS if values.get(k)]
    for k in found:
        logging.getLogger("corpo").warning(
            "%s is set but no longer used: %s (see docs/GMAIL_SETUP.md). You can delete it.",
            k,
            LEGACY_SETTINGS[k],
        )
    return found


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    warn_about_legacy_settings()
    task = None
    # Gmail can be connected after startup, so start whenever there is a way to connect it; each
    # round checks that something is connected before touching the mailbox.
    if settings.imap_poll_seconds > 0 and settings.google_configured:
        task = asyncio.create_task(poll_forever(settings))
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    settings = get_settings()
    # With sign-in on, the backend may be reachable from the internet (e.g. a Codespace), so it
    # doesn't advertise its own API: no interactive docs or schema pages.
    docs = (
        {"docs_url": None, "redoc_url": None, "openapi_url": None} if settings.auth_required else {}
    )
    app = FastAPI(title=settings.project_name, lifespan=lifespan, **docs)
    # Added first = inner. CORS is added last so it is outermost and answers preflights itself.
    app.add_middleware(AuthGate)
    app.add_middleware(RequestGuard, allowed_origins=settings.cors_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # A public page (the GitHub Pages site) reaching a backend on your own computer needs the
        # browser's private-network check to pass. Only for origins on the allow-list above.
        allow_private_network=True,
        allow_methods=["*"],
        # Explicit rather than "*": browsers do not treat a literal * as covering Authorization.
        allow_headers=["Authorization", "Content-Type", "X-Corpo-Mailer"],
    )
    p = settings.api_prefix
    app.include_router(auth_routes.router, prefix=f"{p}/auth", tags=["auth"])
    app.include_router(gmail.router, prefix=f"{p}/gmail", tags=["gmail"])
    app.include_router(crm.router, prefix=p, tags=["crm"])
    app.include_router(imports.router, prefix=p, tags=["import/export"])
    app.include_router(drafts.router, prefix=f"{p}/drafts", tags=["drafts"])
    app.include_router(replies.router, prefix=f"{p}/replies", tags=["replies"])
    app.include_router(dashboard.router, prefix=f"{p}/dashboard", tags=["dashboard"])
    app.include_router(discovery.router, prefix=f"{p}/discovery", tags=["discovery"])

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
