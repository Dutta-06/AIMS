import smtplib
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Protocol

from app.core.config import Settings, get_settings


class MailError(Exception):
    pass


class Mailer(Protocol):
    def send(self, *, to: str, subject: str, body: str) -> str:
        """Send one email and return its Message-ID (kept for reply matching)."""
        ...


class SMTPMailer:
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def send(self, *, to: str, subject: str, body: str) -> str:
        if not (self.s.smtp_user and self.s.smtp_password):
            raise MailError("SMTP credentials are not configured")
        msg = EmailMessage()
        msg["From"] = formataddr((self.s.smtp_from_name, self.s.smtp_user))
        msg["To"] = to
        msg["Subject"] = subject
        msg["Message-ID"] = message_id = make_msgid()
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.s.smtp_host, self.s.smtp_port, timeout=30) as smtp:
                smtp.starttls()
                smtp.login(self.s.smtp_user, self.s.smtp_password)
                smtp.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            raise MailError(str(exc)) from exc
        return message_id


def get_mailer() -> Mailer:
    return SMTPMailer(get_settings())
