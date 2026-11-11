from enum import StrEnum


class DealStage(StrEnum):
    PROSPECT = "prospect"
    CONTACTED = "contacted"
    REPLIED = "replied"
    IN_DISCUSSION = "in_discussion"
    PROPOSAL_SENT = "proposal_sent"
    COMMITTED = "committed"
    PAID = "paid"
    DECLINED = "declined"
    NO_RESPONSE = "no_response"


# Stages where outreach is finished, so the deal never shows up as needing follow-up.
CLOSED_STAGES = frozenset({DealStage.PAID, DealStage.DECLINED, DealStage.NO_RESPONSE})


class InteractionType(StrEnum):
    EMAIL_SENT = "email_sent"
    EMAIL_REPLY = "email_reply"
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
