"""The rules for how outreach moves a contact's status and channels. Everything that records
contact (the API, the send gate, the reply tracker) goes through here so they agree."""

from datetime import datetime

from app.db.base import utcnow
from app.models import Contact
from app.models.enums import Channel, ContactStatus


def add_channel(contact: Contact, channel: Channel) -> None:
    if channel.value not in contact.channels:
        contact.channels = [
            *contact.channels,
            channel.value,
        ]  # reassign: JSON isn't mutation-tracked


def normalise(contact: Contact) -> None:
    """Channels only mean something once someone has been contacted."""
    if contact.status == ContactStatus.NOT_CONTACTED:
        contact.channels = []


def record_outreach(contact: Contact, channel: Channel, when: datetime | None = None) -> None:
    """We reached out. Never moves a lead backwards (a responded contact stays responded)."""
    when = when or utcnow()
    if contact.status == ContactStatus.NOT_CONTACTED:
        contact.status = ContactStatus.CONTACTED
    add_channel(contact, channel)
    if contact.last_contacted_at is None or when > contact.last_contacted_at:
        contact.last_contacted_at = when


def record_reply(contact: Contact, channel: Channel, when: datetime | None = None) -> None:
    """A person told us they replied: they're responded, and the reply is no longer 'unread'."""
    when = when or utcnow()
    contact.status = ContactStatus.RESPONDED
    contact.reply_unread = False
    add_channel(contact, channel)
    if contact.last_contacted_at is None or when > contact.last_contacted_at:
        contact.last_contacted_at = when
