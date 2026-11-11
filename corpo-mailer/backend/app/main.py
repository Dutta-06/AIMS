import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import crm, dashboard, drafts, imports, replies
from app.core.config import get_settings
from app.core.guard import RequestGuard
from app.services.poller import poll_forever


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    task = None
    if settings.imap_configured and settings.imap_poll_seconds > 0:
        task = asyncio.create_task(poll_forever(settings))
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.project_name, lifespan=lifespan)
    # Added first = inner. CORS is added last so it is outermost and answers preflights itself.
    app.add_middleware(RequestGuard, allowed_origins=settings.cors_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    p = settings.api_prefix
    app.include_router(crm.router, prefix=p, tags=["crm"])
    app.include_router(imports.router, prefix=p, tags=["import/export"])
    app.include_router(drafts.router, prefix=f"{p}/drafts", tags=["drafts"])
    app.include_router(replies.router, prefix=f"{p}/replies", tags=["replies"])
    app.include_router(dashboard.router, prefix=f"{p}/dashboard", tags=["dashboard"])

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
