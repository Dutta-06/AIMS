import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, crm, dashboard, drafts, replies
from app.core.config import get_settings
from app.core.security import current_operator
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    p = settings.api_prefix
    protected = [Depends(current_operator)]
    app.include_router(auth.router, prefix=f"{p}/auth", tags=["auth"])
    app.include_router(crm.router, prefix=p, tags=["crm"], dependencies=protected)
    app.include_router(drafts.router, prefix=f"{p}/drafts", tags=["drafts"], dependencies=protected)
    app.include_router(
        replies.router, prefix=f"{p}/replies", tags=["replies"], dependencies=protected
    )
    app.include_router(
        dashboard.router, prefix=f"{p}/dashboard", tags=["dashboard"], dependencies=protected
    )

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
