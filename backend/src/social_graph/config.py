"""Configuration management."""
import os
import json
from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings."""

    # Database
    database_url: str = Field(
        default="sqlite:///./social_graph.db",
        description="SQLAlchemy database URL"
    )

    # Twitter API
    twitter_bearer_token: str = Field(
        default="",
        description="TwitterAPI.io API Key"
    )

    # Collector settings
    max_top_posts_per_run: int = Field(default=20)
    max_engagers_per_post: int = Field(default=500)
    co_engagement_window_hours: int = Field(default=72)
    attribution_lookback_days: int = Field(default=7)

    # Config versioning
    config_version: str = Field(default="1.0.0")

    class Config:
        env_prefix = "SOCIAL_GRAPH_"
        env_file = ".env"


def get_settings() -> Settings:
    """Get settings - environment variables take priority."""
    # Check environment variable first (set by batch file or .env)
    env_token = os.environ.get("SOCIAL_GRAPH_TWITTER_BEARER_TOKEN", "")

    if env_token:
        return Settings(twitter_bearer_token=env_token)

    # Fallback to secrets file
    secrets_path = Path.home() / ".clawdbot" / "secrets" / "twitter.json"
    if secrets_path.exists():
        with open(secrets_path) as f:
            data = json.load(f)
            token = data.get("bearer_token", "")
            if token:
                return Settings(twitter_bearer_token=token)

    return Settings()


settings = get_settings()
