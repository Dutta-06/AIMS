import smtplib
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
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


class MailError(Exception):
    pass


class Mailer(Protocol):
    def send(self, *, to: str, subject: str, body: str) -> str:
        """Send one email and return its Message-ID (kept for reply matching)."""
        ...


class SMTPMailer:
    """Sends through Gmail's SMTP server as the connected Gmail account (OAuth)."""

    def __init__(self, settings: Settings, account: OAuthAccount | None = None) -> None:
        self.s = settings
        self.account = account

    def send(self, *, to: str, subject: str, body: str) -> str:
        if self.account is None:
            raise MailError("Gmail isn't connected. Connect it in Settings.")
        msg = EmailMessage()
        msg["From"] = formataddr((self.s.smtp_from_name, self.account.email))
        msg["To"] = to
        msg["Subject"] = subject
        msg["Message-ID"] = message_id = make_msgid()
        msg.set_content(body)
        try:
            token = (
                self.account.access_token()
            )  # before connecting, so a dead sign-in opens nothing
            with smtplib.SMTP(self.s.smtp_host, self.s.smtp_port, timeout=30) as smtp:
                smtp.starttls()
                smtp.ehlo()
                smtp.auth(
                    "XOAUTH2",
                    xoauth2_authobject(self.account.email, token),
                    initial_response_ok=True,
                )
                smtp.send_message(msg)
        except OAuthError as exc:
            raise MailError(str(exc)) from exc
        except smtplib.SMTPAuthenticationError as exc:
            raise MailError("Gmail refused the login. Reconnect Gmail in Settings.") from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise MailError(str(exc)) from exc
        return message_id


def get_mailer(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    oauth: GoogleOAuth = Depends(get_oauth),
) -> Mailer:
    return SMTPMailer(settings, gmail.active_account(db, settings, oauth))
