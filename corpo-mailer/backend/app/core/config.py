from functools import lru_cache

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

    # A deal with no contact for this many days counts as needing a follow-up.
    stale_after_days: int = 7


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
