"""Data collector - fetches Twitter data and stores snapshots."""
import json
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session
import tenacity

from .models import (
    Run, RawFetch, Account, Post, Snapshot, 
    SnapshotFollower, SnapshotFollowing, Interval, FollowEvent
)
from .twitter_client import TwitterClient, TwitterAPIError
from .config import settings


logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    """Return timezone-aware UTC now."""
    return datetime.now(timezone.utc)


class CollectorError(Exception):
    """Collector-specific error."""
    pass


class RetryableAPIError(Exception):
    """API error that should trigger retry (rate limits, transient failures)."""
    pass


def _log_retry(retry_state: tenacity.RetryCallState) -> None:
    """Log retry attempts for debugging."""
    logger.warning(
        f"Retry attempt {retry_state.attempt_number} after "
        f"{retry_state.outcome.exception() if retry_state.outcome else 'unknown error'}"
    )


# Retry decorator for API calls with exponential backoff
api_retry = tenacity.retry(
    stop=tenacity.stop_after_attempt(3),
    wait=tenacity.wait_exponential(multiplier=1, min=2, max=30),
    retry=tenacity.retry_if_exception_type((TwitterAPIError, RetryableAPIError)),
    before_sleep=_log_retry,
    reraise=True,
)


class Collector:
    """
    Data collector that:
    1. Fetches followers/following from Twitter API
    2. Stores raw responses
    3. Normalizes into accounts + snapshots
    4. Computes interval diffs
    """
    
    def __init__(self, db: Session, twitter_client: TwitterClient = None):
        self.db = db
        self.twitter = twitter_client
        self.run: Optional[Run] = None
    
    async def __aenter__(self):
        if not self.twitter:
            self.twitter = TwitterClient()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.twitter:
            await self.twitter.close()
    
    def _start_run(self) -> Run:
        """Create a new collection run."""
        config_snapshot = {
            "max_top_posts_per_run": settings.max_top_posts_per_run,
            "max_engagers_per_post": settings.max_engagers_per_post,
        }
        
        self.run = Run(
            started_at=utc_now(),
            status="running",
            config_version=settings.config_version,
            config_json=json.dumps(config_snapshot)
        )
        self.db.add(self.run)
        self.db.commit()
        self.db.refresh(self.run)
        return self.run
    
    def _finish_run(self, status: str = "completed", notes: str = None):
        """Finish the collection run."""
        if self.run:
            self.run.finished_at = utc_now()
            self.run.status = status
            self.run.notes = notes
            self.db.commit()
    
    def _store_raw_fetch(
        self,
        endpoint: str,
        params: dict,
        cursor_in: str,
        cursor_out: str,
        truncated: bool,
        payload: dict
    ) -> RawFetch:
        """Store raw API response."""
        params_hash = hashlib.sha256(
            json.dumps(params, sort_keys=True).encode()
        ).hexdigest()[:16]
        
        raw = RawFetch(
            run_id=self.run.run_id,
            endpoint=endpoint,
            params_hash=params_hash,
            cursor_in=cursor_in,
            cursor_out=cursor_out,
            truncated=truncated,
            payload_json=json.dumps(payload)
        )
        self.db.add(raw)
        return raw
    
    def _upsert_account(self, user_data: dict) -> Account:
        """Insert or update account from Twitter user data."""
        account_id = str(user_data.get("id"))
        
        account = self.db.query(Account).filter(
            Account.account_id == account_id
        ).first()
        
        public_metrics = user_data.get("public_metrics", {})
        created_at = None
        if user_data.get("created_at"):
            try:
                created_at = datetime.fromisoformat(
                    user_data["created_at"].replace("Z", "+00:00")
                )
            except:
                pass
        
        if account:
            # Update existing
            account.handle = user_data.get("username")
            account.name = user_data.get("name")
            account.avatar_url = user_data.get("profile_image_url")
            account.bio = user_data.get("description")
            account.followers_count = public_metrics.get("followers_count")
            account.following_count = public_metrics.get("following_count")
            account.tweet_count = public_metrics.get("tweet_count")
            account.last_seen_at = utc_now()
            if created_at:
                account.created_at = created_at
        else:
            # Create new
            account = Account(
                account_id=account_id,
                handle=user_data.get("username"),
                name=user_data.get("name"),
                avatar_url=user_data.get("profile_image_url"),
                bio=user_data.get("description"),
                followers_count=public_metrics.get("followers_count"),
                following_count=public_metrics.get("following_count"),
                tweet_count=public_metrics.get("tweet_count"),
                created_at=created_at
            )
            self.db.add(account)
        
        return account
    
    @api_retry
    async def collect_followers(self, user_id: str, max_pages: int = None) -> Snapshot:
        """Collect all followers and create snapshot."""
        snapshot = Snapshot(
            run_id=self.run.run_id,
            kind="followers",
            account_count=0
        )
        self.db.add(snapshot)
        self.db.commit()
        self.db.refresh(snapshot)
        
        all_account_ids = []
        
        async for users, cursor_in, cursor_out, truncated in self.twitter.paginate_followers(
            user_id, max_pages=max_pages
        ):
            # Store raw response
            self._store_raw_fetch(
                endpoint=f"users/{user_id}/followers",
                params={"max_results": 1000},
                cursor_in=cursor_in,
                cursor_out=cursor_out,
                truncated=truncated,
                payload={"data": users}
            )
            
            # Upsert accounts and create snapshot membership
            for user_data in users:
                account = self._upsert_account(user_data)
                all_account_ids.append(account.account_id)
                
                follower_entry = SnapshotFollower(
                    snapshot_id=snapshot.snapshot_id,
                    account_id=account.account_id
                )
                self.db.add(follower_entry)
        
        snapshot.account_count = len(all_account_ids)
        self.db.commit()
        
        return snapshot
    
    @api_retry
    async def collect_following(self, user_id: str, max_pages: int = None) -> Snapshot:
        """Collect all following and create snapshot."""
        snapshot = Snapshot(
            run_id=self.run.run_id,
            kind="following",
            account_count=0
        )
        self.db.add(snapshot)
        self.db.commit()
        self.db.refresh(snapshot)
        
        all_account_ids = []
        
        async for users, cursor_in, cursor_out, truncated in self.twitter.paginate_following(
            user_id, max_pages=max_pages
        ):
            # Store raw response
            self._store_raw_fetch(
                endpoint=f"users/{user_id}/following",
                params={"max_results": 1000},
                cursor_in=cursor_in,
                cursor_out=cursor_out,
                truncated=truncated,
                payload={"data": users}
            )
            
            # Upsert accounts and create snapshot membership
            for user_data in users:
                account = self._upsert_account(user_data)
                all_account_ids.append(account.account_id)
                
                following_entry = SnapshotFollowing(
                    snapshot_id=snapshot.snapshot_id,
                    account_id=account.account_id
                )
                self.db.add(following_entry)
        
        snapshot.account_count = len(all_account_ids)
        self.db.commit()
        
        return snapshot
    
    def compute_interval_diff(
        self,
        snapshot_start: Snapshot,
        snapshot_end: Snapshot
    ) -> Interval:
        """
        Compute diff between two snapshots of the same kind.
        Creates Interval and FollowEvents.
        """
        if snapshot_start.kind != snapshot_end.kind:
            raise CollectorError(
                f"Cannot diff snapshots of different kinds: "
                f"{snapshot_start.kind} vs {snapshot_end.kind}"
            )
        
        # Get account IDs from each snapshot
        if snapshot_start.kind == "followers":
            start_ids = {sf.account_id for sf in snapshot_start.followers}
            end_ids = {sf.account_id for sf in snapshot_end.followers}
        else:
            start_ids = {sf.account_id for sf in snapshot_start.following}
            end_ids = {sf.account_id for sf in snapshot_end.following}
        
        new_ids = end_ids - start_ids
        lost_ids = start_ids - end_ids
        
        # Create interval
        interval = Interval(
            snapshot_start_id=snapshot_start.snapshot_id,
            snapshot_end_id=snapshot_end.snapshot_id,
            start_at=snapshot_start.captured_at,
            end_at=snapshot_end.captured_at,
            new_followers_count=len(new_ids),
            lost_followers_count=len(lost_ids)
        )
        self.db.add(interval)
        self.db.commit()
        self.db.refresh(interval)
        
        # Create follow events
        for account_id in new_ids:
            event = FollowEvent(
                interval_id=interval.interval_id,
                account_id=account_id,
                kind="new"
            )
            self.db.add(event)
        
        for account_id in lost_ids:
            event = FollowEvent(
                interval_id=interval.interval_id,
                account_id=account_id,
                kind="lost"
            )
            self.db.add(event)
        
        self.db.commit()
        
        return interval
    
    def get_latest_snapshot(self, kind: str) -> Optional[Snapshot]:
        """Get the most recent snapshot of a given kind."""
        return self.db.query(Snapshot).filter(
            Snapshot.kind == kind
        ).order_by(Snapshot.captured_at.desc()).first()
    
    async def run_collection(
        self,
        user_id: str = None,
        username: str = None,
        max_pages: int = None
    ) -> dict:
        """
        Run a full collection cycle:
        1. Get user info
        2. Collect followers snapshot
        3. Collect following snapshot  
        4. Compute diffs if previous snapshots exist
        
        Returns summary dict.
        """
        self._start_run()
        
        try:
            # Get user ID if not provided
            if not user_id:
                if username:
                    user_data = await self.twitter.get_user_by_username(username)
                    user_id = user_data["id"]
                else:
                    user_data = await self.twitter.get_me()
                    user_id = user_data["id"]
                
                # Store the ego account
                self._upsert_account(user_data)
            
            # Get previous snapshots for diff
            prev_followers = self.get_latest_snapshot("followers")
            prev_following = self.get_latest_snapshot("following")
            
            # Collect new snapshots
            followers_snapshot = await self.collect_followers(user_id, max_pages)
            following_snapshot = await self.collect_following(user_id, max_pages)
            
            # Compute diffs
            follower_interval = None
            following_interval = None
            
            if prev_followers:
                follower_interval = self.compute_interval_diff(
                    prev_followers, followers_snapshot
                )
            
            if prev_following:
                following_interval = self.compute_interval_diff(
                    prev_following, following_snapshot
                )
            
            self._finish_run("completed")
            
            return {
                "run_id": self.run.run_id,
                "user_id": user_id,
                "followers_snapshot_id": followers_snapshot.snapshot_id,
                "followers_count": followers_snapshot.account_count,
                "following_snapshot_id": following_snapshot.snapshot_id,
                "following_count": following_snapshot.account_count,
                "follower_interval": {
                    "interval_id": follower_interval.interval_id,
                    "new": follower_interval.new_followers_count,
                    "lost": follower_interval.lost_followers_count
                } if follower_interval else None,
                "following_interval": {
                    "interval_id": following_interval.interval_id,
                    "new": following_interval.new_followers_count,
                    "lost": following_interval.lost_followers_count
                } if following_interval else None
            }
            
        except Exception as e:
            self._finish_run("failed", str(e))
            raise
