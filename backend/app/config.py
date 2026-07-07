from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    supabase_url: str
    # Only used when tokens are HS256 (older Supabase). RS256/ES256 uses JWKS + SUPABASE_URL.
    supabase_jwt_secret: str | None = None

    @field_validator("supabase_jwt_secret", mode="before")
    @classmethod
    def blank_jwt_secret_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v

    cors_origins: str = (
        "http://localhost:5173,http://localhost:5174,"
        "http://127.0.0.1:5173,http://127.0.0.1:5174"
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
