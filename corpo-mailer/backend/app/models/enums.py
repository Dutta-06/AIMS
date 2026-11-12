from enum import StrEnum


class ContactStatus(StrEnum):
    NOT_CONTACTED = "not_contacted"
    CONTACTED = "contacted"
    RESPONDED = "responded"
    NO_RESPONSE = "no_response"


class Channel(StrEnum):
    EMAIL = "email"
    LINKEDIN = "linkedin"
    DISCORD = "discord"
    PERSONAL = "personal"


class InteractionType(StrEnum):
    EMAIL_SENT = "email_sent"
    EMAIL_REPLY = "email_reply"
    OUTREACH = "outreach"  # we reached out on `channel` (LinkedIn, Discord, in person)
    REPLY = "reply"  # they answered on `channel`
    CALL = "call"
    MEETING = "meeting"
    NOTE = "note"


class InteractionSource(StrEnum):
    MANUAL = "manual"
    AUTO = "auto"  # e.g. detected by the reply tracker


class DraftStatus(StrEnum):
    DRAFT = "draft"
    APPROVED = "approved"
    SENDING = "sending"
    SENT = "sent"


class ProspectState(StrEnum):
    NEW = "new"  # waiting for a human to look
    ACCEPTED = "accepted"  # became a company and lead in the tracker
    REJECTED = "rejected"  # never suggest again
    SNOOZED = "snoozed"  # hidden until snoozed_until


class Verdict(StrEnum):
    UNVERIFIED = "unverified"  # suggested by the model, not yet checked against the live web
    VERIFIED = "verified"  # site is live, is this company, and shows an outreach signal
    NEEDS_CHECK = "needs_check"  # site is live and is this company, but a human must judge
    FAILED = "failed"  # couldn't confirm it exists (dead site, wrong company, blocked)
