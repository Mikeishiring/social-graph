"""TwitterAPI.io client for data collection."""
import hashlib
import json
from datetime import datetime
from typing import Optional, AsyncGenerator, Any
import httpx

from .config import settings


class TwitterAPIError(Exception):
    """Twitter API error."""
    def __init__(self, status_code: int, message: str, response: dict = None):
        self.status_code = status_code
        self.message = message
        self.response = response or {}
        super().__init__(f"Twitter API {status_code}: {message}")


class TwitterClient:
    """TwitterAPI.io client with pagination support."""

    BASE_URL = "https://api.twitterapi.io"

    def __init__(self, api_key: str = None):
        self.api_key = api_key or settings.twitter_bearer_token
        self.client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={"x-api-key": self.api_key},
            timeout=60.0
        )

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    def _params_hash(self, params: dict) -> str:
        """Generate hash of request parameters."""
        sorted_params = json.dumps(params, sort_keys=True)
        return hashlib.sha256(sorted_params.encode()).hexdigest()[:16]

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: dict = None
    ) -> dict:
        """Make API request, return response data."""
        response = await self.client.request(method, endpoint, params=params)

        if response.status_code == 429:
            raise TwitterAPIError(429, "Rate limited", response.json())

        if response.status_code != 200:
            try:
                error_data = response.json()
            except:
                error_data = {"error": response.text}
            raise TwitterAPIError(response.status_code, str(error_data), error_data)

        return response.json()

    async def get_user_by_username(self, username: str) -> dict:
        """Get user by username."""
        data = await self._request("GET", "/twitter/user/info", params={"userName": username})
        user_data = data.get("data", {})
        # Normalize to standard format
        return {
            "id": user_data.get("id"),
            "username": user_data.get("userName"),
            "name": user_data.get("name"),
            "profile_image_url": user_data.get("profilePicture"),
            "description": user_data.get("description", ""),
            "public_metrics": {
                "followers_count": user_data.get("followers", 0),
                "following_count": user_data.get("following", 0),
            },
            "created_at": user_data.get("createdAt"),
        }

    async def paginate_followers(
        self,
        user_id: str,
        max_results: int = 200,
        max_pages: int = None,
        username: str = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """
        Paginate through followers.
        Yields: (users, cursor_in, cursor_out, truncated)
        """
        cursor = None
        page_count = 0

        while True:
            params = {
                "userName": username,
                "pageSize": min(max_results, 200)
            }
            if cursor:
                params["cursor"] = cursor

            cursor_in = cursor
            data = await self._request("GET", "/twitter/user/followers", params)

            # Normalize user data from twitterapi.io format
            raw_users = data.get("followers", [])
            users = [self._normalize_user(u) for u in raw_users]

            cursor_out = data.get("next_cursor")

            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out is not None

            yield (users, cursor_in, cursor_out, truncated)

            # Stop if: no more cursor, hit max pages, or empty page (all data retrieved)
            if not cursor_out or (max_pages and page_count >= max_pages) or len(users) == 0:
                break

            cursor = cursor_out

    async def paginate_following(
        self,
        user_id: str,
        max_results: int = 200,
        max_pages: int = None,
        username: str = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """
        Paginate through following.
        Yields: (users, cursor_in, cursor_out, truncated)
        """
        cursor = None
        page_count = 0

        while True:
            params = {
                "userName": username,
                "pageSize": min(max_results, 200)
            }
            if cursor:
                params["cursor"] = cursor

            cursor_in = cursor
            data = await self._request("GET", "/twitter/user/followings", params)

            # Normalize user data from twitterapi.io format
            raw_users = data.get("followings", [])
            users = [self._normalize_user(u) for u in raw_users]

            cursor_out = data.get("next_cursor")

            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out is not None

            yield (users, cursor_in, cursor_out, truncated)

            # Stop if: no more cursor, hit max pages, or empty page (all data retrieved)
            if not cursor_out or (max_pages and page_count >= max_pages) or len(users) == 0:
                break

            cursor = cursor_out

    def _normalize_user(self, user: dict) -> dict:
        """Normalize twitterapi.io user format to standard format with all available fields."""
        return {
            "id": user.get("id"),
            "username": user.get("userName"),
            "name": user.get("name"),
            "profile_image_url": user.get("profilePicture"),
            "cover_image_url": user.get("coverPicture"),
            "description": user.get("description", ""),
            "location": user.get("location"),
            "public_metrics": {
                "followers_count": user.get("followers", 0),
                "following_count": user.get("following", 0),
                "tweet_count": user.get("statusesCount", 0),
                "media_count": user.get("mediaCount", 0),
                "favourites_count": user.get("favouritesCount", 0),
            },
            "created_at": user.get("createdAt"),
            "is_automated": user.get("isAutomated", False),
            "possibly_sensitive": user.get("possiblySensitive", False),
            "can_dm": user.get("canDm"),
        }

    async def get_user_tweets(
        self,
        user_id: str,
        since_id: str = None,
        max_results: int = 100,
        username: str = None
    ) -> list[dict]:
        """Get recent tweets from user."""
        params = {
            "userName": username,
            "pageSize": min(max_results, 100)
        }

        data = await self._request("GET", "/twitter/user/tweets", params)
        tweets = data.get("tweets", [])

        # Normalize tweets
        return [
            {
                "id": t.get("id"),
                "text": t.get("text"),
                "created_at": t.get("createdAt"),
                "public_metrics": {
                    "like_count": t.get("likeCount", 0),
                    "retweet_count": t.get("retweetCount", 0),
                    "reply_count": t.get("replyCount", 0),
                },
            }
            for t in tweets
        ]

    async def get_mentions(
        self,
        user_id: str,
        since_id: str = None,
        max_results: int = 100,
        username: str = None
    ) -> dict:
        """Get tweets mentioning the user."""
        params = {
            "userName": username,
            "pageSize": min(max_results, 100)
        }

        data = await self._request("GET", "/twitter/user/mentions", params)
        return data

    async def get_users_bulk(self, usernames: list[str]) -> list[dict]:
        """
        Get user info for multiple usernames.
        Returns list of normalized user data.
        """
        results = []
        for username in usernames:
            try:
                user = await self.get_user_by_username(username)
                if user and user.get("id"):
                    results.append(user)
            except TwitterAPIError as e:
                # Skip users that fail (suspended, not found, etc.)
                if e.status_code not in (404, 403):
                    raise
        return results
