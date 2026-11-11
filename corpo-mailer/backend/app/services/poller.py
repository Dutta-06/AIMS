import asyncio
import logging

from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.db.session import get_engine
from app.providers.imap import get_mailbox
from app.services.replies import sync_replies

log = logging.getLogger("corpo.replies")


def _sync_once(settings: Settings) -> None:
    with sessionmaker(get_engine(), expire_on_commit=False)() as db:
        r = sync_replies(db, get_mailbox(), settings)
    if r.replies or r.bounces:
        log.info("reply sync: %s", r.as_dict())


async def poll_forever(settings: Settings) -> None:
    """Check for replies every `imap_poll_seconds`. One bad poll never stops the loop."""
    while True:
        try:
            await asyncio.to_thread(_sync_once, settings)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - network, auth and DB hiccups must not kill the poller
            log.exception("reply sync failed; will retry")
        await asyncio.sleep(settings.imap_poll_seconds)
