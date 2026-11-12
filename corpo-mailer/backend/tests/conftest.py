import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.providers.imap import Fetched, MailboxError, get_mailbox
from app.providers.llm import LLM, LLMError, get_llm
from app.providers.mail import MailError, get_mailer
from app.providers.search import SearchError, SearchHit, get_search
from app.providers.web import Page, get_fetcher


@pytest.fixture(autouse=True)
def _hermetic_settings(monkeypatch):
    """Never read a developer's real .env while testing."""
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class FakeMailer:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.fail = False

    def send(self, *, to, subject, body):
        if self.fail:
            raise MailError("smtp down")
        self.sent.append({"to": to, "subject": subject, "body": body})
        return f"<fake-{len(self.sent)}@test>"


class FakeLLM(LLM):
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.reply = '{"subject": "Partner with brAInwave 3", "body": "Hi Raj, ..."}'
        self.fail = False

    def complete(self, *, system, user):
        self.calls.append({"system": system, "user": user})
        if self.fail:
            raise LLMError("all models failed")
        return self.reply


class FakeFetcher:
    """A pretend web. `pages` maps a URL to a Page, or to a FetchError to raise; unknown URLs
    answer 404. `calls` records every URL asked for."""

    def __init__(self) -> None:
        self.pages: dict = {}
        self.calls: list[str] = []

    def fetch(self, url):
        self.calls.append(url)
        hit = self.pages.get(url)
        if isinstance(hit, Exception):
            raise hit
        if hit is None:
            return Page(url=url, final_url=url, status=404, text="Not found")
        return hit


def page(url, text="", *, title="", status=200, final_url=None, links=(), emails=(), modified=None):
    return Page(
        url=url,
        final_url=final_url or url,
        status=status,
        title=title,
        text=text,
        links=list(links),
        emails=list(emails),
        last_modified=modified,
    )


class FakeSearch:
    """A pretend search engine: put hits in `hits`, or set `error` to make it fail."""

    def __init__(self) -> None:
        self.hits: list[SearchHit] = []
        self.error: str | None = None
        self.queries: list[str] = []

    def search(self, query, count=10):
        self.queries.append(query)
        if self.error:
            raise SearchError(self.error)
        return self.hits


class FakeMailbox:
    """Stands in for IMAP. Put messages in `inbox`; `fetch` hands back those past the cursor."""

    def __init__(self) -> None:
        self.inbox: list = []
        self.uidvalidity = 1
        self.fail: str | None = None
        self.calls: list[dict] = []

    def fetch(self, *, uidvalidity, last_uid, lookback_days):
        self.calls.append({"uidvalidity": uidvalidity, "last_uid": last_uid})
        if self.fail:
            raise MailboxError(self.fail)
        base = last_uid if uidvalidity == self.uidvalidity else 0
        return Fetched(self.uidvalidity, [m for m in self.inbox if m.uid > base])


@pytest.fixture
def mailer():
    return FakeMailer()


@pytest.fixture
def search():
    return FakeSearch()


@pytest.fixture
def fetcher():
    return FakeFetcher()


@pytest.fixture
def llm():
    return FakeLLM()


@pytest.fixture
def mailbox():
    return FakeMailbox()


@pytest.fixture
def imap_settings():
    return Settings(smtp_user="us@gmail.com", smtp_password="app-pw")


@pytest.fixture
def db_session():
    """In-memory SQLite by default; set TEST_DATABASE_URL to run the suite on Postgres.

    The target database is wiped before and after each test, so point it at a throwaway one.
    """
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        engine = create_engine(Settings(database_url=url).database_url)
        Base.metadata.drop_all(engine)
    else:
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    Base.metadata.create_all(engine)
    with sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    if url:
        session.close()
        Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def client(db_session, mailer, llm, mailbox, fetcher, search, imap_settings):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_mailer] = lambda: mailer
    app.dependency_overrides[get_llm] = lambda: llm
    app.dependency_overrides[get_mailbox] = lambda: mailbox
    app.dependency_overrides[get_fetcher] = lambda: fetcher
    app.dependency_overrides[get_search] = lambda: search
    app.dependency_overrides[get_settings] = lambda: imap_settings
    with TestClient(app) as c:
        c.headers["X-Corpo-Mailer"] = "1"  # what the real frontend sends on every request
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def lead(client):
    """A company with one reachable contact (name and email)."""
    company = client.post("/api/v1/companies", json={"name": "Acme"}).json()
    contact = client.post(
        "/api/v1/contacts",
        json={
            "company_id": company["id"],
            "name": "Raj Mehta",
            "email": "raj@acme.com",
            "role": "DevRel",
        },
    ).json()
    return {"company": company, "contact": contact}


@pytest.fixture
def draft(client, lead):
    r = client.post(
        "/api/v1/drafts",
        json={
            "contact_id": lead["contact"]["id"],
            "subject": "Sponsor brAInwave 3",
            "body": "Hello Raj",
        },
    )
    assert r.status_code == 201
    return r.json()
