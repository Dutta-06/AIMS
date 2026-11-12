"""Read incoming mail over IMAP. Read-only: messages are never marked read, moved or deleted."""

import imaplib
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email import message_from_bytes, policy
from email.message import EmailMessage
from email.utils import parseaddr, parsedate_to_datetime
from typing import Protocol

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.providers.google import (
    GoogleOAuth,
    OAuthAccount,
    OAuthError,
    get_oauth,
    xoauth2_authobject,
)
from app.services import gmail

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_MSGID = re.compile(r"<[^<>\s]+>")
_MAX_FETCH_BYTES = 300_000  # headers + the start of the body is plenty; skip huge attachments
_MAX_BODY_CHARS = 4000


class MailboxError(Exception):
    pass


@dataclass
class IncomingMessage:
    uid: int
    message_id: str
    from_email: str
    subject: str
    body: str  # plain text with the quoted earlier thread removed
    sent_at: datetime
    in_reply_to: list[str] = field(default_factory=list)  # In-Reply-To + References
    is_auto_reply: bool = False
    is_bounce: bool = False
    raw_text: str = ""  # kept for bounce parsing only


@dataclass
class Fetched:
    uidvalidity: int | None
    messages: list[IncomingMessage]


class MailboxReader(Protocol):
    def fetch(self, *, uidvalidity: int | None, last_uid: int, lookback_days: int) -> Fetched:
        """New messages since `last_uid`; if `uidvalidity` changed or is unknown, the last
        `lookback_days` instead (callers de-duplicate by Message-ID)."""
        ...


# ---------------------------------------------------------------- parsing (pure, unit-tested)

_QUOTE_MARKERS = (
    re.compile(r"^On .{5,200}wrote:\s*$", re.I),
    re.compile(r"^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}", re.I),
    re.compile(r"^From:\s.+", re.I),  # Outlook-style quoted header block
    re.compile(r"^_{5,}\s*$"),
)


def strip_quoted(text: str) -> str:
    """Keep what the person wrote; drop the quoted thread below it."""
    kept: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.lstrip().startswith(">"):
            continue  # inline quoting
        if any(m.match(line.strip()) for m in _QUOTE_MARKERS):
            break  # "On <date>, X wrote:" starts the quoted original; nothing new follows
        kept.append(line)
    return "\n".join(kept).strip()[:_MAX_BODY_CHARS]


def _text_body(msg: EmailMessage) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    try:
        text = part.get_content()
    except (LookupError, UnicodeDecodeError):
        return ""
    if part.get_content_type() == "text/html":
        text = re.sub(r"<(style|script).*?</\1>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<br\s*/?>|</p>|</div>", "\n", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
    return text


def _is_bounce(msg: EmailMessage, from_email: str, subject: str) -> bool:
    local = from_email.split("@")[0].lower()
    if local in {"mailer-daemon", "postmaster"}:
        return True
    if msg.get_content_type() == "multipart/report":
        return "delivery-status" in (msg.get_param("report-type") or "")
    return bool(
        re.match(r"(undeliver|delivery status notification|mail delivery failed)", subject, re.I)
    )


def _is_auto_reply(msg: EmailMessage, subject: str) -> bool:
    if (msg.get("Auto-Submitted") or "no").strip().lower() != "no":
        return True
    if (msg.get("Precedence") or "").strip().lower() in {"auto_reply", "bulk", "junk"}:
        return True
    if msg.get("X-Autoreply") or msg.get("X-Autorespond"):
        return True
    return bool(re.match(r"(automatic reply|auto[- ]?reply|out of office)", subject, re.I))


def parse_message(uid: int, raw: bytes, uidvalidity: int | None = None) -> IncomingMessage:
    msg = message_from_bytes(raw, policy=policy.default)
    assert isinstance(msg, EmailMessage)
    from_email = parseaddr(str(msg.get("From", "")))[1].lower()
    subject = " ".join(str(msg.get("Subject", "")).split())
    try:
        sent_at = parsedate_to_datetime(str(msg["Date"]))
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        sent_at = datetime.now(UTC)
    refs = _MSGID.findall(str(msg.get("In-Reply-To", ""))) + _MSGID.findall(
        str(msg.get("References", ""))
    )
    ids = _MSGID.findall(str(msg.get("Message-ID", "")))
    bounce = _is_bounce(msg, from_email, subject)
    return IncomingMessage(
        uid=uid,
        message_id=ids[0] if ids else f"<imap-{uidvalidity or 0}-{uid}@no-message-id>",
        from_email=from_email,
        subject=subject,
        body=strip_quoted(_text_body(msg)),
        sent_at=sent_at.astimezone(UTC),
        in_reply_to=refs,
        is_auto_reply=_is_auto_reply(msg, subject),
        is_bounce=bounce,
        raw_text=raw.decode("utf-8", "replace") if bounce else "",
    )


# ---------------------------------------------------------------- the network part


class IMAPMailboxReader:
    """Reads the inbox over IMAP as the connected Gmail account (OAuth)."""

    def __init__(self, settings: Settings, account: OAuthAccount | None = None) -> None:
        self.s = settings
        self.account = account

    def fetch(self, *, uidvalidity: int | None, last_uid: int, lookback_days: int) -> Fetched:
        if self.account is None:
            raise MailboxError("Gmail isn't connected. Connect it in Settings.")
        try:
            token = self.account.access_token()
        except OAuthError as exc:
            raise MailboxError(str(exc)) from exc
        user = self.account.email
        try:
            conn = imaplib.IMAP4_SSL(self.s.imap_host, self.s.imap_port, timeout=30)
        except OSError as exc:
            raise MailboxError(f"Can't reach {self.s.imap_host}: {exc}") from exc
        try:
            auth = xoauth2_authobject(user, token)
            conn.authenticate("XOAUTH2", lambda challenge: auth(challenge).encode())
            typ, _ = conn.select(f'"{self.s.imap_folder}"', readonly=True)
            if typ != "OK":
                raise MailboxError(f"Can't open folder {self.s.imap_folder!r}")
            validity = self._uidvalidity(conn)
            if validity == uidvalidity and last_uid > 0:
                criteria = f"UID {last_uid + 1}:*"
            else:
                since = datetime.now(UTC) - timedelta(days=lookback_days)
                criteria = f"SINCE {since.day:02d}-{_MONTHS[since.month - 1]}-{since.year}"
                last_uid = 0
            typ, data = conn.uid("SEARCH", None, criteria)
            if typ != "OK":
                raise MailboxError("IMAP search failed")
            # "UID n:*" always returns the newest message even when it is older than n.
            uids = [int(u) for u in (data[0] or b"").split() if int(u) > last_uid]
            messages = [m for u in uids if (m := self._fetch_one(conn, u, validity))]
            return Fetched(validity, messages)
        except imaplib.IMAP4.error as exc:
            raise MailboxError(f"IMAP error: {exc}") from exc
        finally:
            try:
                conn.logout()
            except (imaplib.IMAP4.error, OSError):
                pass

    @staticmethod
    def _uidvalidity(conn: imaplib.IMAP4_SSL) -> int | None:
        _, data = conn.response("UIDVALIDITY")
        try:
            return int(data[0])
        except (TypeError, ValueError, IndexError):
            return None

    @staticmethod
    def _fetch_one(
        conn: imaplib.IMAP4_SSL, uid: int, validity: int | None
    ) -> IncomingMessage | None:
        typ, data = conn.uid("FETCH", str(uid), f"(BODY.PEEK[]<0.{_MAX_FETCH_BYTES}>)")
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            return None
        return parse_message(uid, data[0][1], validity)


def build_mailbox(db: Session, settings: Settings, oauth: GoogleOAuth) -> MailboxReader:
    return IMAPMailboxReader(settings, gmail.active_account(db, settings, oauth))


def get_mailbox(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    oauth: GoogleOAuth = Depends(get_oauth),
) -> MailboxReader:
    return build_mailbox(db, settings, oauth)
