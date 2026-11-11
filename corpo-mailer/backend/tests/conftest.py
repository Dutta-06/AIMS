import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-long-enough-for-hs256")
os.environ.setdefault("APP_PASSWORD", "hunter2")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.providers.mail import MailError, get_mailer  # noqa: E402


class FakeMailer:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.fail = False

    def send(self, *, to, subject, body):
        if self.fail:
            raise MailError("smtp down")
        self.sent.append({"to": to, "subject": subject, "body": body})
        return f"<fake-{len(self.sent)}@test>"


@pytest.fixture
def mailer():
    return FakeMailer()


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with sessionmaker(engine, expire_on_commit=False)() as session:
        yield session


@pytest.fixture
def client(db_session, mailer):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_mailer] = lambda: mailer
    with TestClient(app) as c:
        token = c.post("/api/v1/auth/login", json={"password": "hunter2", "name": "Asha"}).json()
        c.headers["Authorization"] = f"Bearer {token['access_token']}"
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def deal_setup(client):
    """A company with one contact and one deal."""
    company = client.post("/api/v1/companies", json={"name": "Acme"}).json()
    contact = client.post(
        "/api/v1/contacts",
        json={"company_id": company["id"], "name": "Raj", "email": "raj@acme.com"},
    ).json()
    deal = client.post("/api/v1/deals", json={"company_id": company["id"]}).json()
    return {"company": company, "contact": contact, "deal": deal}


@pytest.fixture
def draft(client, deal_setup):
    r = client.post(
        "/api/v1/drafts",
        json={
            "deal_id": deal_setup["deal"]["id"],
            "contact_id": deal_setup["contact"]["id"],
            "subject": "Sponsor brAInwave 3",
            "body": "Hello Raj",
        },
    )
    assert r.status_code == 201
    return r.json()
