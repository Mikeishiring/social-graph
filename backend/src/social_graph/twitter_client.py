"""Twitter API v2 client for data collection."""
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
    """Twitter API v2 client with pagination support."""
    
    BASE_URL = "https://api.twitter.com/2"
    
    USER_FIELDS = "id,name,username,profile_image_url,description,public_metrics,created_at"
    TWEET_FIELDS = "id,text,created_at,public_metrics,conversation_id,in_reply_to_user_id,referenced_tweets"
    
    def __init__(self, bearer_token: str = None):
        self.bearer_token = bearer_token or settings.twitter_bearer_token
        self.client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={"Authorization": f"Bearer {self.bearer_token}"},
            timeout=30.0
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
    ) -> tuple[dict, dict]:
        """Make API request, return (data, raw_response)."""
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
    
    async def get_me(self) -> dict:
        """Get authenticated user info."""
        params = {"user.fields": self.USER_FIELDS}
        data = await self._request("GET", "/users/me", params)
        return data.get("data", {})
    
    async def get_user_by_username(self, username: str) -> dict:
        """Get user by username."""
        params = {"user.fields": self.USER_FIELDS}
        data = await self._request("GET", f"/users/by/username/{username}", params)
        return data.get("data", {})
    
    async def paginate_followers(
        self,
        user_id: str,
        max_results: int = 1000,
        max_pages: int = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """
        Paginate through followers.
        Yields: (users, cursor_in, cursor_out, truncated)
        """
        params = {
            "user.fields": self.USER_FIELDS,
            "max_results": min(max_results, 1000)
        }
        
        cursor = None
        page_count = 0
        
        while True:
            if cursor:
                params["pagination_token"] = cursor
            
            cursor_in = cursor
            data = await self._request("GET", f"/users/{user_id}/followers", params)
            
            users = data.get("data", [])
            meta = data.get("meta", {})
            cursor_out = meta.get("next_token")
            
            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out is not None
            
            yield (users, cursor_in, cursor_out, truncated)
            
            if not cursor_out or (max_pages and page_count >= max_pages):
                break
            
            cursor = cursor_out
    
    async def paginate_following(
        self,
        user_id: str,
        max_results: int = 1000,
        max_pages: int = None
    ) -> AsyncGenerator[tuple[list[dict], str, str, bool], None]:
        """
        Paginate through following.
        Yields: (users, cursor_in, cursor_out, truncated)
        """
        params = {
            "user.fields": self.USER_FIELDS,
            "max_results": min(max_results, 1000)
        }
        
        cursor = None
        page_count = 0
        
        while True:
            if cursor:
                params["pagination_token"] = cursor
            
            cursor_in = cursor
            data = await self._request("GET", f"/users/{user_id}/following", params)
            
            users = data.get("data", [])
            meta = data.get("meta", {})
            cursor_out = meta.get("next_token")
            
            page_count += 1
            truncated = max_pages and page_count >= max_pages and cursor_out is not None
            
            yield (users, cursor_in, cursor_out, truncated)
            
            if not cursor_out or (max_pages and page_count >= max_pages):
                break
            
            cursor = cursor_out
    
    async def get_user_tweets(
        self,
        user_id: str,
        since_id: str = None,
        max_results: int = 100
    ) -> list[dict]:
        """Get recent tweets from user."""
        params = {
            "tweet.fields": self.TWEET_FIELDS,
            "max_results": min(max_results, 100),
            "exclude": "retweets"
        }
        if since_id:
            params["since_id"] = since_id
        
        data = await self._request("GET", f"/users/{user_id}/tweets", params)
        return data.get("data", [])
    
    async def get_mentions(
        self,
        user_id: str,
        since_id: str = None,
        max_results: int = 100
    ) -> list[dict]:
        """Get tweets mentioning the user."""
        params = {
            "tweet.fields": self.TWEET_FIELDS,
            "expansions": "author_id",
            "user.fields": self.USER_FIELDS,
            "max_results": min(max_results, 100)
        }
        if since_id:
            params["since_id"] = since_id
        
        data = await self._request("GET", f"/users/{user_id}/mentions", params)
        return data
