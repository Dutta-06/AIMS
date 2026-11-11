"""The Alembic migrations must build the same schema the models describe."""

import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core.config import Settings, get_settings
from app.db.base import Base

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def migrated_url(tmp_path, monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'm.db'}"
    url = Settings(secret_key="x", app_password="x", database_url=url).database_url
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    engine = create_engine(url)
    with engine.begin() as conn:  # start from nothing, including the alembic bookkeeping table
        Base.metadata.drop_all(conn)
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    yield url
    with engine.begin() as conn:
        Base.metadata.drop_all(conn)
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    engine.dispose()
    get_settings.cache_clear()


def cfg() -> Config:
    c = Config(str(BACKEND / "alembic.ini"))
    c.set_main_option("script_location", str(BACKEND / "migrations"))
    return c


def test_upgrade_creates_every_table_and_matches_models(migrated_url):
    command.upgrade(cfg(), "head")
    tables = set(inspect(create_engine(migrated_url)).get_table_names())
    assert set(Base.metadata.tables) <= tables
    command.check(cfg())  # raises if the models and migrations have drifted apart


def test_downgrade_to_base_removes_everything(migrated_url):
    command.upgrade(cfg(), "head")
    command.downgrade(cfg(), "base")
    tables = set(inspect(create_engine(migrated_url)).get_table_names())
    assert not (set(Base.metadata.tables) & tables)


def test_upgrading_a_database_that_already_has_data(migrated_url):
    """The reply-tracking migration must keep existing rows and default reply_unread to false."""
    command.upgrade(cfg(), "b3451241eebb")  # schema as it was before reply tracking
    engine = create_engine(migrated_url)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO companies (id, name, created_at) VALUES (1, 'Acme', '2026-01-01')")
        )
        conn.execute(
            text(
                "INSERT INTO deals (id, company_id, stage, created_at) "
                "VALUES (1, 1, 'prospect', '2026-01-01')"
            )
        )
    command.upgrade(cfg(), "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT reply_unread FROM deals WHERE id = 1")).scalar() in (
            False,
            0,
        )
