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
    SnapshotFollower, SnapshotFollowing, Interval, FollowEvent,
    InteractionEvent, PostEngager
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
        """Insert or update account from Twitter user data with all available fields."""
        account_id = str(user_data.get("id"))

        account = self.db.query(Account).filter(
            Account.account_id == account_id
        ).first()

        public_metrics = user_data.get("public_metrics", {})
        created_at = None
        if user_data.get("created_at"):
            try:
                # Handle various date formats from the API
                date_str = user_data["created_at"]
                if "+" in date_str or date_str.endswith("Z"):
                    created_at = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                else:
                    # Format like "Thu Dec 13 08:41:26 +0000 2007"
                    from datetime import timezone
                    created_at = datetime.strptime(date_str, "%a %b %d %H:%M:%S %z %Y")
            except Exception:
                pass

        if account:
            # Update existing with all fields
            account.handle = user_data.get("username")
            account.name = user_data.get("name")
            account.avatar_url = user_data.get("profile_image_url")
            account.cover_url = user_data.get("cover_image_url")
            account.bio = user_data.get("description")
            account.location = user_data.get("location")
            account.followers_count = public_metrics.get("followers_count")
            account.following_count = public_metrics.get("following_count")
            account.tweet_count = public_metrics.get("tweet_count")
            account.media_count = public_metrics.get("media_count")
            account.favourites_count = public_metrics.get("favourites_count")
            account.is_automated = user_data.get("is_automated")
            account.possibly_sensitive = user_data.get("possibly_sensitive")
            account.can_dm = user_data.get("can_dm")
            account.last_seen_at = utc_now()
            if created_at:
                account.created_at = created_at
        else:
            # Create new with all fields
            account = Account(
                account_id=account_id,
                handle=user_data.get("username"),
                name=user_data.get("name"),
                avatar_url=user_data.get("profile_image_url"),
                cover_url=user_data.get("cover_image_url"),
                bio=user_data.get("description"),
                location=user_data.get("location"),
                followers_count=public_metrics.get("followers_count"),
                following_count=public_metrics.get("following_count"),
                tweet_count=public_metrics.get("tweet_count"),
                media_count=public_metrics.get("media_count"),
                favourites_count=public_metrics.get("favourites_count"),
                is_automated=user_data.get("is_automated"),
                possibly_sensitive=user_data.get("possibly_sensitive"),
                can_dm=user_data.get("can_dm"),
                created_at=created_at
            )
            self.db.add(account)

        return account

    def _parse_datetime(self, date_str: Optional[str]) -> Optional[datetime]:
        if not date_str:
            return None
        try:
            if "+" in date_str or date_str.endswith("Z"):
                return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            return datetime.strptime(date_str, "%a %b %d %H:%M:%S %z %Y")
        except Exception:
            return None

    def _epoch_seconds(self, dt: Optional[datetime]) -> Optional[int]:
        if not dt:
            return None
        return int(dt.timestamp())

    def _upsert_post(self, tweet: dict, author_id: str) -> Optional[Post]:
        post_id = tweet.get("id")
        if not post_id:
            return None

        created_at = self._parse_datetime(tweet.get("created_at"))
        metrics = tweet.get("public_metrics") or {}
        metrics_json = json.dumps(metrics)

        post = self.db.query(Post).filter(Post.post_id == post_id).first()
        if post:
            post.author_id = author_id
            if created_at:
                post.created_at = created_at
            post.text = tweet.get("text", "") or ""
            post.metrics_json = metrics_json
            post.conversation_id = tweet.get("conversation_id")
            post.in_reply_to_id = tweet.get("in_reply_to_id")
            post.last_seen_at = utc_now()
        else:
            if not created_at:
                created_at = utc_now()
            post = Post(
                post_id=post_id,
                author_id=author_id,
                created_at=created_at,
                text=tweet.get("text", "") or "",
                metrics_json=metrics_json,
                conversation_id=tweet.get("conversation_id"),
                in_reply_to_id=tweet.get("in_reply_to_id"),
                last_seen_at=utc_now()
            )
            self.db.add(post)
        return post

    def _load_existing_interaction_keys(self, interval_id: int) -> set[tuple]:
        rows = self.db.query(InteractionEvent).filter(
            InteractionEvent.interval_id == interval_id
        ).all()
        return {(r.src_id, r.dst_id, r.interaction_type, r.post_id) for r in rows}

    def _load_existing_engager_keys(self, interval_id: int) -> set[tuple]:
        rows = self.db.query(PostEngager).filter(
            PostEngager.interval_id == interval_id
        ).all()
        return {(r.post_id, r.account_id, r.engager_type) for r in rows}

    def _record_interaction(
        self,
        interval_id: int,
        src_id: str,
        dst_id: str,
        interaction_type: str,
        created_at: datetime,
        post_id: Optional[str],
        raw_ref_id: Optional[int],
        existing: set[tuple]
    ) -> None:
        key = (src_id, dst_id, interaction_type, post_id)
        if key in existing:
            return
        existing.add(key)
        self.db.add(InteractionEvent(
            interval_id=interval_id,
            created_at=created_at,
            src_id=src_id,
            dst_id=dst_id,
            interaction_type=interaction_type,
            post_id=post_id,
            raw_ref_id=raw_ref_id
        ))

    def _record_engager(
        self,
        interval_id: int,
        post_id: str,
        account_id: str,
        engager_type: str,
        existing: set[tuple]
    ) -> None:
        key = (post_id, account_id, engager_type)
        if key in existing:
            return
        existing.add(key)
        self.db.add(PostEngager(
            interval_id=interval_id,
            post_id=post_id,
            account_id=account_id,
            engager_type=engager_type
        ))

    async def collect_posts_and_engagement(
        self,
        user_id: str,
        username: Optional[str],
        interval: Optional[Interval]
    ) -> None:
        if not interval:
            logger.info("No interval available; skipping engagement collection")
            return

        interval_id = interval.interval_id
        since_time = self._epoch_seconds(interval.start_at)
        until_time = self._epoch_seconds(interval.end_at)

        existing_interactions = self._load_existing_interaction_keys(interval_id)
        existing_engagers = self._load_existing_engager_keys(interval_id)

        # Collect recent tweets for the ego user
        collected_posts: list[Post] = []
        post_limit = settings.max_top_posts_per_run

        async for tweets, cursor_in, cursor_out, truncated in self.twitter.paginate_user_last_tweets(
            user_id=user_id,
            username=username,
            include_replies=False
        ):
            raw = self._store_raw_fetch(
                endpoint="twitter/user/last_tweets",
                params={"userName": username, "userId": user_id, "cursor": cursor_in},
                cursor_in=cursor_in,
                cursor_out=cursor_out,
                truncated=bool(truncated),
                payload={"tweets": tweets}
            )
            self.db.flush()
            raw_id = raw.id

            for tweet in tweets:
                post = self._upsert_post(tweet, user_id)
                if post:
                    collected_posts.append(post)
                if len(collected_posts) >= post_limit:
                    break

            self.db.commit()

            if len(collected_posts) >= post_limit:
                break

        # Collect engagement for top posts
        engager_limit = settings.max_engagers_per_post

        for post in collected_posts:
            # Replies
            reply_count = 0
            async for replies, cursor_in, cursor_out, truncated in self.twitter.paginate_tweet_replies(
                tweet_id=post.post_id,
                since_time=since_time,
                until_time=until_time
            ):
                raw = self._store_raw_fetch(
                    endpoint="twitter/tweet/replies",
                    params={"tweetId": post.post_id, "cursor": cursor_in, "sinceTime": since_time, "untilTime": until_time},
                    cursor_in=cursor_in,
                    cursor_out=cursor_out,
                    truncated=bool(truncated),
                    payload={"replies": replies}
                )
                self.db.flush()
                raw_id = raw.id

                for reply in replies:
                    author = reply.get("author")
                    if not author or not author.get("id"):
                        continue
                    author_account = self._upsert_account(author)
                    created_at = self._parse_datetime(reply.get("created_at")) or utc_now()
                    self._record_interaction(
                        interval_id=interval_id,
                        src_id=author_account.account_id,
                        dst_id=user_id,
                        interaction_type="reply",
                        created_at=created_at,
                        post_id=post.post_id,
                        raw_ref_id=raw_id,
                        existing=existing_interactions
                    )
                    self._record_engager(
                        interval_id=interval_id,
                        post_id=post.post_id,
                        account_id=author_account.account_id,
                        engager_type="reply",
                        existing=existing_engagers
                    )
                    reply_count += 1
                    if reply_count >= engager_limit:
                        break

                self.db.commit()
                if reply_count >= engager_limit:
                    break

            # Quotes
            quote_count = 0
            async for quotes, cursor_in, cursor_out, truncated in self.twitter.paginate_tweet_quotes(
                tweet_id=post.post_id,
                since_time=since_time,
                until_time=until_time,
                include_replies=True
            ):
                raw = self._store_raw_fetch(
                    endpoint="twitter/tweet/quotes",
                    params={"tweetId": post.post_id, "cursor": cursor_in, "sinceTime": since_time, "untilTime": until_time},
                    cursor_in=cursor_in,
                    cursor_out=cursor_out,
                    truncated=bool(truncated),
                    payload={"tweets": quotes}
                )
                self.db.flush()
                raw_id = raw.id

                for quote in quotes:
                    author = quote.get("author")
                    if not author or not author.get("id"):
                        continue
                    author_account = self._upsert_account(author)
                    created_at = self._parse_datetime(quote.get("created_at")) or utc_now()
                    self._record_interaction(
                        interval_id=interval_id,
                        src_id=author_account.account_id,
                        dst_id=user_id,
                        interaction_type="quote",
                        created_at=created_at,
                        post_id=post.post_id,
                        raw_ref_id=raw_id,
                        existing=existing_interactions
                    )
                    self._record_engager(
                        interval_id=interval_id,
                        post_id=post.post_id,
                        account_id=author_account.account_id,
                        engager_type="quote",
                        existing=existing_engagers
                    )
                    quote_count += 1
                    if quote_count >= engager_limit:
                        break

                self.db.commit()
                if quote_count >= engager_limit:
                    break

            # Retweeters
            retweet_count = 0
            async for users, cursor_in, cursor_out, truncated in self.twitter.paginate_tweet_retweeters(
                tweet_id=post.post_id
            ):
                raw = self._store_raw_fetch(
                    endpoint="twitter/tweet/retweeters",
                    params={"tweetId": post.post_id, "cursor": cursor_in},
                    cursor_in=cursor_in,
                    cursor_out=cursor_out,
                    truncated=bool(truncated),
                    payload={"users": users}
                )
                self.db.flush()
                raw_id = raw.id

                for user in users:
                    if not user.get("id"):
                        continue
                    account = self._upsert_account(user)
                    created_at = interval.end_at or utc_now()
                    self._record_interaction(
                        interval_id=interval_id,
                        src_id=account.account_id,
                        dst_id=user_id,
                        interaction_type="retweet",
                        created_at=created_at,
                        post_id=post.post_id,
                        raw_ref_id=raw_id,
                        existing=existing_interactions
                    )
                    self._record_engager(
                        interval_id=interval_id,
                        post_id=post.post_id,
                        account_id=account.account_id,
                        engager_type="retweet",
                        existing=existing_engagers
                    )
                    retweet_count += 1
                    if retweet_count >= engager_limit:
                        break

                self.db.commit()
                if retweet_count >= engager_limit:
                    break

            # Likers (X API v2)
            if self.twitter.has_x_api():
                like_count = 0
                async for users, cursor_in, cursor_out, truncated in self.twitter.paginate_tweet_liking_users(
                    tweet_id=post.post_id
                ):
                    raw = self._store_raw_fetch(
                        endpoint="x/tweets/liking_users",
                        params={"tweetId": post.post_id, "cursor": cursor_in},
                        cursor_in=cursor_in,
                        cursor_out=cursor_out,
                        truncated=bool(truncated),
                        payload={"users": users}
                    )
                    self.db.flush()
                    raw_id = raw.id

                    for user in users:
                        if not user.get("id"):
                            continue
                        account = self._upsert_account(user)
                        created_at = interval.end_at or utc_now()
                        self._record_interaction(
                            interval_id=interval_id,
                            src_id=account.account_id,
                            dst_id=user_id,
                            interaction_type="like",
                            created_at=created_at,
                            post_id=post.post_id,
                            raw_ref_id=raw_id,
                            existing=existing_interactions
                        )
                        self._record_engager(
                            interval_id=interval_id,
                            post_id=post.post_id,
                            account_id=account.account_id,
                            engager_type="like",
                            existing=existing_engagers
                        )
                        like_count += 1
                        if like_count >= engager_limit:
                            break

                    self.db.commit()
                    if like_count >= engager_limit:
                        break

        # Mentions
        if username:
            mention_count = 0
            async for mentions, cursor_in, cursor_out, truncated in self.twitter.paginate_user_mentions(
                username=username,
                since_time=since_time,
                until_time=until_time
            ):
                raw = self._store_raw_fetch(
                    endpoint="twitter/user/mentions",
                    params={"userName": username, "cursor": cursor_in, "sinceTime": since_time, "untilTime": until_time},
                    cursor_in=cursor_in,
                    cursor_out=cursor_out,
                    truncated=bool(truncated),
                    payload={"tweets": mentions}
                )
                self.db.flush()
                raw_id = raw.id

                for mention in mentions:
                    author = mention.get("author")
                    if not author or not author.get("id"):
                        continue
                    author_account = self._upsert_account(author)
                    created_at = self._parse_datetime(mention.get("created_at")) or utc_now()
                    self._record_interaction(
                        interval_id=interval_id,
                        src_id=author_account.account_id,
                        dst_id=user_id,
                        interaction_type="mention",
                        created_at=created_at,
                        post_id=mention.get("id"),
                        raw_ref_id=raw_id,
                        existing=existing_interactions
                    )
                    mention_count += 1
                    if mention_count >= settings.max_engagers_per_post:
                        break

                self.db.commit()
                if mention_count >= settings.max_engagers_per_post:
                    break
    
    @api_retry
    async def collect_followers(self, user_id: str, max_pages: int = None, username: str = None) -> Snapshot:
        """Collect all followers and create snapshot with position tracking.

        Position 0 = newest follower (API returns newest-first).
        This enables accurate post attribution by correlating follow time with post time.
        """
        snapshot = Snapshot(
            run_id=self.run.run_id,
            kind="followers",
            account_count=0
        )
        self.db.add(snapshot)
        self.db.commit()
        self.db.refresh(snapshot)

        all_account_ids = []
        global_position = 0  # Track position across all pages

        async for users, cursor_in, cursor_out, truncated in self.twitter.paginate_followers(
            user_id, max_pages=max_pages, username=username
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

            # Upsert accounts and create snapshot membership with position
            for user_data in users:
                account = self._upsert_account(user_data)
                all_account_ids.append(account.account_id)

                follower_entry = SnapshotFollower(
                    snapshot_id=snapshot.snapshot_id,
                    account_id=account.account_id,
                    follow_position=global_position  # 0 = newest, higher = older
                )
                self.db.add(follower_entry)
                global_position += 1

        snapshot.account_count = len(all_account_ids)
        self.db.commit()

        return snapshot
    
    @api_retry
    async def collect_following(self, user_id: str, max_pages: int = None, username: str = None) -> Snapshot:
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
            user_id, max_pages=max_pages, username=username
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

            # Collect new snapshots (pass username for twitterapi.io)
            followers_snapshot = await self.collect_followers(user_id, max_pages, username=username)
            following_snapshot = await self.collect_following(user_id, max_pages, username=username)
            
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

            # Collect posts + engagement events for attribution (best effort)
            interaction_interval = follower_interval or following_interval
            try:
                await self.collect_posts_and_engagement(
                    user_id=user_id,
                    username=username,
                    interval=interaction_interval
                )
            except Exception as e:
                logger.warning(f"Engagement collection failed: {e}")

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

    async def collect_network_connections(
        self,
        account_ids: list[str],
        max_per_account: int = 100,
        progress_callback=None
    ) -> dict:
        """
        Collect following lists for multiple accounts to build network topology.

        This creates edges between accounts in your network, enabling path finding
        like: You → Person A → Person B → Person C

        Args:
            account_ids: List of account IDs to collect following for
            max_per_account: Max following to collect per account (API limit aware)
            progress_callback: Optional callback(current, total, account_handle)
        """
        from .models import NetworkConnection, Account

        total = len(account_ids)
        collected = 0
        connections_added = 0
        errors = []

        for i, account_id in enumerate(account_ids):
            try:
                # Get account info for username
                account = self.db.query(Account).filter(
                    Account.account_id == account_id
                ).first()

                if not account or not account.handle:
                    continue

                if progress_callback:
                    progress_callback(i + 1, total, account.handle)

                # Collect who this account follows
                following_ids = []
                page_count = 0
                max_pages = max(1, max_per_account // 100)  # ~100 per page

                async for users, cursor_in, cursor_out, truncated in self.twitter.paginate_following(
                    account.handle,
                    max_results=100
                ):
                    for user in users:
                        following_ids.append(user.get("id"))
                        # Also upsert the account
                        self._upsert_account(user)

                    page_count += 1
                    if page_count >= max_pages:
                        break
                    if not cursor_out:
                        break

                # Store connections
                for following_id in following_ids:
                    # Check if connection already exists
                    existing = self.db.query(NetworkConnection).filter(
                        NetworkConnection.follower_id == account_id,
                        NetworkConnection.following_id == following_id
                    ).first()

                    if not existing:
                        conn = NetworkConnection(
                            follower_id=account_id,
                            following_id=following_id
                        )
                        self.db.add(conn)
                        connections_added += 1

                self.db.commit()
                collected += 1

            except Exception as e:
                errors.append({"account_id": account_id, "error": str(e)})
                logger.error(f"Failed to collect following for {account_id}: {e}")
                continue

        return {
            "accounts_processed": collected,
            "connections_added": connections_added,
            "errors": errors
        }
