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
    X_BASE_URL = "https://api.twitter.com/2"

    def __init__(self, api_key: str = None):
        self.api_key = api_key or settings.twitter_bearer_token
        self.client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={"x-api-key": self.api_key},
            timeout=60.0
        )
        self.x_bearer_token = settings.x_bearer_token or ""
        self.x_client = None
        if self.x_bearer_token:
            self.x_client = httpx.AsyncClient(
                base_url=self.X_BASE_URL,
                headers={"Authorization": f"Bearer {self.x_bearer_token}"},
                timeout=60.0
            )

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
        if self.x_client:
            await self.x_client.aclose()

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

    async def _x_request(
        self,
        method: str,
        endpoint: str,
        params: dict = None
    ) -> dict:
        """Make X API request, return response data."""
        if not self.x_client:
            raise TwitterAPIError(401, "X API bearer token not configured")

        response = await self.x_client.request(method, endpoint, params=params)

        if response.status_code == 429:
            raise TwitterAPIError(429, "X API rate limited", response.json())

        if response.status_code != 200:
            try:
                error_data = response.json()
            except Exception:
                error_data = {"error": response.text}
            raise TwitterAPIError(response.status_code, str(error_data), error_data)

        return response.json()

    def has_x_api(self) -> bool:
        return self.x_client is not None

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

    def _normalize_tweet(self, tweet: dict) -> dict:
        """Normalize tweet payload into a consistent format."""
        author = tweet.get("author") or {}
        normalized_author = self._normalize_user(author) if author else None
        return {
            "id": tweet.get("id"),
            "text": tweet.get("text"),
            "created_at": tweet.get("createdAt"),
            "public_metrics": {
                "like_count": tweet.get("likeCount", 0),
                "retweet_count": tweet.get("retweetCount", 0),
                "reply_count": tweet.get("replyCount", 0),
                "quote_count": tweet.get("quoteCount", 0),
            },
            "conversation_id": tweet.get("conversationId"),
            "in_reply_to_id": tweet.get("inReplyToId"),
            "author": normalized_author,
            "raw": tweet,
        }

    def _normalize_x_user(self, user: dict) -> dict:
        """Normalize X API v2 user format to standard format."""
        return {
            "id": user.get("id"),
            "username": user.get("username"),
            "name": user.get("name"),
            "profile_image_url": user.get("profile_image_url"),
            "description": user.get("description", ""),
            "location": user.get("location"),
            "public_metrics": user.get("public_metrics", {}),
            "created_at": user.get("created_at"),
        }

    async def get_user_tweets(
        self,
        user_id: str,
        since_id: str = None,
        max_results: int = 100,
        username: str = None
    ) -> list[dict]:
        """Get recent tweets from user (single page)."""
        params: dict[str, Any] = {}
        if username:
            params["userName"] = username
        if user_id:
            params["userId"] = user_id

        data = await self._request("GET", "/twitter/user/last_tweets", params)
        tweets = data.get("tweets", [])
        return [self._normalize_tweet(t) for t in tweets]

    async def paginate_user_last_tweets(
        self,
        user_id: str = None,
        username: str = None,
        include_replies: bool = False,
        max_pages: int = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """
        Paginate through a user's latest tweets.
        Yields: (tweets, cursor_in, cursor_out, truncated)
        """
        cursor = ""
        page_count = 0

        while True:
            params: dict[str, Any] = {}
            if username:
                params["userName"] = username
            if user_id:
                params["userId"] = user_id
            if include_replies:
                params["includeReplies"] = "true"
            if cursor:
                params["cursor"] = cursor

            cursor_in = cursor
            data = await self._request("GET", "/twitter/user/last_tweets", params)
            raw_tweets = data.get("tweets", [])
            tweets = [self._normalize_tweet(t) for t in raw_tweets]

            cursor_out = data.get("next_cursor") or ""

            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out

            yield (tweets, cursor_in, cursor_out, truncated)

            if not cursor_out or (max_pages and page_count >= max_pages) or len(tweets) == 0:
                break

            cursor = cursor_out

    async def paginate_tweet_replies(
        self,
        tweet_id: str,
        since_time: int = None,
        until_time: int = None,
        max_pages: int = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """Paginate replies for a tweet."""
        cursor = ""
        page_count = 0

        while True:
            params: dict[str, Any] = {
                "tweetId": tweet_id,
            }
            if since_time:
                params["sinceTime"] = since_time
            if until_time:
                params["untilTime"] = until_time
            if cursor:
                params["cursor"] = cursor

            cursor_in = cursor
            data = await self._request("GET", "/twitter/tweet/replies", params)
            raw_tweets = data.get("replies", []) or data.get("tweets", [])
            tweets = [self._normalize_tweet(t) for t in raw_tweets]
            cursor_out = data.get("next_cursor") or ""

            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out

            yield (tweets, cursor_in, cursor_out, truncated)

            if not cursor_out or (max_pages and page_count >= max_pages) or len(tweets) == 0:
                break

            cursor = cursor_out

    async def paginate_tweet_quotes(
        self,
        tweet_id: str,
        since_time: int = None,
        until_time: int = None,
        include_replies: bool = True,
        max_pages: int = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """Paginate quote tweets for a tweet."""
        cursor = ""
        page_count = 0

        while True:
            params: dict[str, Any] = {
                "tweetId": tweet_id,
                "includeReplies": "true" if include_replies else "false",
            }
            if since_time:
                params["sinceTime"] = since_time
            if until_time:
                params["untilTime"] = until_time
            if cursor:
                params["cursor"] = cursor

            cursor_in = cursor
            data = await self._request("GET", "/twitter/tweet/quotes", params)
            raw_tweets = data.get("tweets", [])
            tweets = [self._normalize_tweet(t) for t in raw_tweets]
            cursor_out = data.get("next_cursor") or ""

            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out

            yield (tweets, cursor_in, cursor_out, truncated)

            if not cursor_out or (max_pages and page_count >= max_pages) or len(tweets) == 0:
                break

            cursor = cursor_out

    async def paginate_tweet_retweeters(
        self,
        tweet_id: str,
        max_pages: int = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """Paginate retweeters for a tweet."""
        cursor = ""
        page_count = 0

        while True:
            params: dict[str, Any] = {
                "tweetId": tweet_id,
            }
            if cursor:
                params["cursor"] = cursor

            cursor_in = cursor
            data = await self._request("GET", "/twitter/tweet/retweeters", params)
            raw_users = data.get("users", [])
            users = [self._normalize_user(u) for u in raw_users]
            cursor_out = data.get("next_cursor") or ""

            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out

            yield (users, cursor_in, cursor_out, truncated)

            if not cursor_out or (max_pages and page_count >= max_pages) or len(users) == 0:
                break

            cursor = cursor_out

    async def paginate_user_mentions(
        self,
        username: str,
        since_time: int = None,
        until_time: int = None,
        max_pages: int = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """Paginate tweets mentioning a user."""
        cursor = ""
        page_count = 0

        while True:
            params: dict[str, Any] = {
                "userName": username,
            }
            if since_time:
                params["sinceTime"] = since_time
            if until_time:
                params["untilTime"] = until_time
            if cursor:
                params["cursor"] = cursor

            cursor_in = cursor
            data = await self._request("GET", "/twitter/user/mentions", params)
            raw_tweets = data.get("tweets", [])
            tweets = [self._normalize_tweet(t) for t in raw_tweets]
            cursor_out = data.get("next_cursor") or ""

            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out

            yield (tweets, cursor_in, cursor_out, truncated)

            if not cursor_out or (max_pages and page_count >= max_pages) or len(tweets) == 0:
                break

            cursor = cursor_out

    async def paginate_tweet_liking_users(
        self,
        tweet_id: str,
        max_pages: int = None,
        max_results: int = 100
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """Paginate users who liked a tweet (X API v2)."""
        if not self.x_client:
            return

        cursor = ""
        page_count = 0
        user_fields = "id,name,username,profile_image_url,public_metrics,created_at,description,location"

        while True:
            params: dict[str, Any] = {
                "max_results": min(max_results, 100),
                "user.fields": user_fields,
            }
            if cursor:
                params["pagination_token"] = cursor

            cursor_in = cursor
            data = await self._x_request("GET", f"/tweets/{tweet_id}/liking_users", params)
            raw_users = data.get("data", []) or []
            users = [self._normalize_x_user(u) for u in raw_users]
            meta = data.get("meta") or {}
            cursor_out = meta.get("next_token") or ""

            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out

            yield (users, cursor_in, cursor_out, truncated)

            if not cursor_out or (max_pages and page_count >= max_pages) or len(users) == 0:
                break

            cursor = cursor_out

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
