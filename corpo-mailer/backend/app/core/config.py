from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    project_name: str = "CorpoMailer"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./corpo_mailer.db"
    cors_origins: list[str] = ["http://localhost:3000"]

    # One shared password for the whole team (there are no individual accounts). When set, every
    # API request except signing in needs a token from POST /auth/login. Leave empty only while
    # the backend is reachable from your own computer alone.
    app_password: str = ""
    session_hours: int = 12
    # Signs session tokens. If empty, a random one is made at startup, so restarting the backend
    # signs everyone out. Changing app_password also signs everyone out.
    session_secret: str = ""

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = ""

    # Reply tracking over IMAP. Credentials default to the SMTP ones (same Gmail app password).
    # "Connect Gmail" (OAuth). Create the client in Google Cloud once (docs/GMAIL_SETUP.md). When a
    # Gmail account is connected, it is used instead of the app password above.
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/gmail/callback"

    imap_host: str = "imap.gmail.com"
    imap_port: int = 993
    imap_user: str = ""
    imap_password: str = ""
    imap_folder: str = "INBOX"
    imap_poll_seconds: int = 300  # 0 turns background polling off (manual sync still works)
    imap_lookback_days: int = 14  # how far back to look on the first run

    @property
    def imap_login(self) -> tuple[str, str]:
        return (self.imap_user or self.smtp_user, self.imap_password or self.smtp_password)

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def imap_configured(self) -> bool:
        user, password = self.imap_login
        return bool(user and password)

    @field_validator("database_url")
    @classmethod
    def _use_psycopg3(cls, url: str) -> str:
        """Accept the plain postgres:// and postgresql:// URLs that hosted providers hand out."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url

    # LLM drafting via OpenRouter (OpenAI-compatible). Models are tried in order; free models
    # are rate limited and change often, so keep this list in .env.
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_models: list[str] = [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "google/gemma-4-26b-a4b-it:free",
        "google/gemma-4-31b-it:free",
    ]
    llm_timeout_seconds: float = 60

    # Web search (Brave Search API, free tier). Optional: without a key, discovery from search is
    # simply unavailable. Only the query you type is sent to the search service.
    search_api_key: str = ""
    search_base_url: str = "https://api.search.brave.com/res/v1/web/search"
    search_timeout_seconds: float = 15

    # What the AI is allowed to say about the event. It is told to use nothing beyond this.
    event_name: str = "brAInwave 3"
    event_pitch: str = (
        "brAInwave 3 is a hackathon hosted at Delhi Technological University (DTU). "
        "We are looking for corporate sponsors."
    )
    sender_signature: str = ""

    # A contacted lead with no reply for this many days counts as needing a follow-up.
    stale_after_days: int = 7
    # A verified prospect must be re-checked after this long before it can be accepted.
    prospect_recheck_days: int = 30


@lru_cache
def get_settings() -> Settings:
    return Settings()
