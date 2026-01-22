"""Configuration management."""
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
        description="Twitter API v2 Bearer Token"
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


def load_twitter_token() -> str:
    """Load Twitter bearer token from secrets file."""
    secrets_path = Path.home() / ".clawdbot" / "secrets" / "twitter.json"
    if secrets_path.exists():
        with open(secrets_path) as f:
            data = json.load(f)
            return data.get("bearer_token", "")
    return ""


def get_settings() -> Settings:
    """Get settings with Twitter token loaded."""
    token = load_twitter_token()
    return Settings(twitter_bearer_token=token)


settings = get_settings()
