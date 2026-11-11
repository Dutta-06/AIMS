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
