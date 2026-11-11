from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    url = get_settings().database_url
    if url.startswith("sqlite"):
        kwargs: dict = {"connect_args": {"check_same_thread": False}}
    else:
        kwargs = {
            "pool_pre_ping": True,  # recycle connections the server dropped while idle
            "pool_size": 5,
            "max_overflow": 5,
            # Supabase's pooler (pgbouncer, transaction mode) can't use server-side prepared
            # statements; turning them off is harmless on a direct connection.
            "connect_args": {"prepare_threshold": None},
        }
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _enable_fks(conn, _):
            conn.execute("PRAGMA foreign_keys=ON")

    return engine


def get_db() -> Iterator[Session]:
    with sessionmaker(get_engine(), expire_on_commit=False)() as session:
        yield session
