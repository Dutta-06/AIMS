import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth as auth_routes
from app.api.routes import crm, dashboard, discovery, drafts, gmail, imports, replies
from app.core.auth import AuthGate
from app.core.config import get_settings
from app.core.guard import RequestGuard
from app.services.poller import poll_forever


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    task = None
    # Gmail can be connected after startup, so start whenever there is a way to connect it; each
    # round checks that something is connected before touching the mailbox.
    if settings.imap_poll_seconds > 0 and (settings.imap_configured or settings.google_configured):
        task = asyncio.create_task(poll_forever(settings))
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.project_name, lifespan=lifespan)
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
