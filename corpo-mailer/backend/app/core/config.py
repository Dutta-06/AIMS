from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    project_name: str = "CorpoMailer"
    api_prefix: str = "/api/v1"
    secret_key: str
    app_password: str
    database_url: str = "sqlite:///./corpo_mailer.db"
    access_token_minutes: int = 60 * 12
    cors_origins: list[str] = ["http://localhost:3000"]

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = ""

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

    # What the AI is allowed to say about the event. It is told to use nothing beyond this.
    event_name: str = "brAInwave 3"
    event_pitch: str = (
        "brAInwave 3 is a hackathon hosted at Delhi Technological University (DTU). "
        "We are looking for corporate sponsors."
    )
    sender_signature: str = ""

    # A deal with no contact for this many days counts as needing a follow-up.
    stale_after_days: int = 7


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
