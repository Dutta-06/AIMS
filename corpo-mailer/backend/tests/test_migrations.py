"""The Alembic migrations must build the same schema the models describe."""

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core.config import Settings, get_settings
from app.db.base import Base

BACKEND = Path(__file__).resolve().parents[1]


def _wipe(engine):
    """Remove every table, including ones only an older schema had (like `deals`)."""
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
        else:
            Base.metadata.drop_all(conn)
            conn.execute(text("DROP TABLE IF EXISTS alembic_version"))


@pytest.fixture
def migrated_url(tmp_path, monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'm.db'}"
    url = Settings(database_url=url).database_url
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    engine = create_engine(url)
    _wipe(engine)  # start from nothing
    yield url
    _wipe(engine)
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


PRE_TRACKER = "9a883795116c"  # the schema before contacts became the tracked rows


def _seed_old_schema(engine):
    """A realistic pre-tracker database: deals carried status, owner and notes."""
    t0 = datetime(2026, 1, 1, tzinfo=UTC)
    rows = [
        ("companies", {"id": 1, "name": "Acme", "created_at": t0}),
        ("companies", {"id": 2, "name": "NoContacts Ltd", "created_at": t0}),
        ("companies", {"id": 3, "name": "Gone Quiet", "created_at": t0}),
        (
            "contacts",
            {
                "id": 1,
                "company_id": 1,
                "name": "Raj",
                "email": "raj@acme.com",
                "do_not_contact": False,
                "created_at": t0,
            },
        ),
        (
            "contacts",
            {
                "id": 2,
                "company_id": 1,
                "name": "Sam",
                "email": "sam@acme.com",
                "do_not_contact": True,
                "created_at": t0,
            },
        ),
        (
            "contacts",
            {
                "id": 3,
                "company_id": 3,
                "name": "Quinn",
                "email": "q@quiet.com",
                "do_not_contact": False,
                "created_at": t0,
            },
        ),
        (
            "deals",
            {
                "id": 1,
                "company_id": 1,
                "stage": "in_discussion",
                "owner": "Asha",
                "notes": "important",
                "reply_unread": True,
                "target_amount": 500000,
                "created_at": t0,
                "next_followup_at": t0,
                "last_contacted_at": t0,
            },
        ),
        (
            "deals",
            {
                "id": 2,
                "company_id": 2,
                "stage": "prospect",
                "owner": "Ritwik",
                "notes": None,
                "reply_unread": False,
                "created_at": t0,
            },
        ),
        (
            "deals",
            {
                "id": 3,
                "company_id": 3,
                "stage": "no_response",
                "owner": None,
                "notes": None,
                "reply_unread": False,
                "created_at": t0,
            },
        ),
        (
            "drafts",
            {
                "id": 1,
                "deal_id": 1,
                "contact_id": 1,
                "subject": "Hi",
                "body": "b",
                "status": "sent",
                "generated_by_ai": True,
                "approved_by": "Asha",
                "created_at": t0,
            },
        ),
        (
            "interactions",
            {
                "id": 1,
                "deal_id": 1,
                "contact_id": 1,
                "type": "email_sent",
                "source": "manual",
                "message_id": "<m1@x>",
                "draft_id": 1,
                "approved_by": "Asha",
                "occurred_at": t0,
            },
        ),
        (
            "interactions",
            {
                "id": 2,
                "deal_id": 1,
                "contact_id": 2,
                "type": "email_reply",
                "source": "auto",
                "subject": "Re: Hi",
                "content": "yes",
                "occurred_at": t0,
            },
        ),
        (
            "interactions",
            {
                "id": 3,
                "deal_id": 1,
                "contact_id": None,
                "type": "note",
                "source": "manual",
                "content": "no contact given",
                "occurred_at": t0,
            },
        ),
        (
            "interactions",
            {
                "id": 4,
                "deal_id": 2,
                "contact_id": None,
                "type": "note",
                "source": "manual",
                "content": "on a deal with no contacts",
                "occurred_at": t0,
            },
        ),
    ]
    with engine.begin() as conn:
        for table, values in rows:
            cols = ", ".join(values)
            marks = ", ".join(f":{k}" for k in values)
            conn.execute(text(f"INSERT INTO {table} ({cols}) VALUES ({marks})"), values)


def test_upgrade_keeps_existing_data_and_folds_deal_state_into_contacts(migrated_url):
    command.upgrade(cfg(), PRE_TRACKER)
    engine = create_engine(migrated_url)
    _seed_old_schema(engine)
    command.upgrade(cfg(), "head")

    with engine.connect() as conn:
        c = {r.id: r for r in conn.execute(text("SELECT * FROM contacts ORDER BY id"))}
        assert "deals" not in inspect(engine).get_table_names()
        # Raj and Sam share Acme's in-discussion deal: both are now "responded", owned by Asha
        assert (c[1].status, c[1].owner, c[1].remarks) == ("responded", "Asha", "important")
        assert c[2].status == "responded" and c[2].do_not_contact in (True, 1)
        assert (
            json.loads(c[1].channels) == ["email"]
            if isinstance(c[1].channels, str)
            else c[1].channels == ["email"]
        )
        # the unread flag goes to whoever actually replied, not to everyone at the company
        assert (bool(c[2].reply_unread), bool(c[1].reply_unread)) == (True, False)
        assert c[3].status == "no_response"
        # a deal on a company with no contacts keeps its owner on a placeholder contact
        placeholder = next(r for r in c.values() if r.company_id == 2)
        assert (placeholder.name, placeholder.status, placeholder.owner) == (
            "General contact",
            "not_contacted",
            "Ritwik",
        )

        inter = {r.id: r for r in conn.execute(text("SELECT * FROM interactions ORDER BY id"))}
        assert len(inter) == 4 and all(r.contact_id for r in inter.values())
        assert (
            inter[3].contact_id == 1
        )  # a note with no contact attaches to the company's first contact
        assert inter[4].contact_id == placeholder.id
        assert (inter[1].channel, inter[2].channel, inter[3].channel) == ("email", "email", None)
        assert (inter[1].message_id, inter[1].draft_id) == ("<m1@x>", 1)
        assert conn.execute(text("SELECT contact_id, status FROM drafts WHERE id = 1")).one() == (
            1,
            "sent",
        )


def test_new_rows_get_fresh_ids_after_the_data_move(migrated_url):
    """On Postgres the sequences must be moved past the copied ids, or the next insert collides."""
    command.upgrade(cfg(), PRE_TRACKER)
    engine = create_engine(migrated_url)
    _seed_old_schema(engine)
    command.upgrade(cfg(), "head")
    now = datetime(2026, 2, 1, tzinfo=UTC)
    with engine.begin() as conn:
        for table, extra in [
            (
                "contacts",
                {
                    "company_id": 1,
                    "name": "New",
                    "status": "not_contacted",
                    "channels": "[]",
                    "created_at": now,
                    "updated_at": now,
                },
            ),
            (
                "drafts",
                {
                    "contact_id": 1,
                    "subject": "s",
                    "body": "b",
                    "status": "draft",
                    "generated_by_ai": False,
                    "created_at": now,
                },
            ),
            (
                "interactions",
                {"contact_id": 1, "type": "note", "source": "manual", "occurred_at": now},
            ),
        ]:
            cols = ", ".join(extra)
            marks = ", ".join(f":{k}" for k in extra)
            conn.execute(text(f"INSERT INTO {table} ({cols}) VALUES ({marks})"), extra)
        assert conn.execute(text("SELECT MAX(id) FROM contacts")).scalar() > 4


def test_upgrading_an_empty_database_works_and_matches_the_models(migrated_url):
    command.upgrade(cfg(), PRE_TRACKER)
    command.upgrade(cfg(), "head")
    command.check(cfg())


def test_downgrade_one_step_restores_the_old_tables(migrated_url):
    command.upgrade(cfg(), "head")
    command.downgrade(cfg(), PRE_TRACKER)
    tables = set(inspect(create_engine(migrated_url)).get_table_names())
    assert {"deals", "contacts", "drafts", "interactions"} <= tables
