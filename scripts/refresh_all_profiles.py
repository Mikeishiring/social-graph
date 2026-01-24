#!/usr/bin/env python3
"""
Refresh all account profiles to fetch avatars and latest data.
Run this after initial data collection.
"""

import asyncio
import sys
import time
from pathlib import Path

# Add backend src to path
backend_path = Path(__file__).parent.parent / "backend" / "src"
sys.path.insert(0, str(backend_path))


async def refresh_all():
    from social_graph.database import get_db
    from social_graph.models import Account
    from social_graph.twitter_client import TwitterClient
    from datetime import datetime, timezone

    db = next(get_db())

    # Count accounts needing refresh
    total = db.query(Account).count()
    missing = db.query(Account).filter(Account.avatar_url == None).count()

    print(f"Total accounts: {total}")
    print(f"Missing avatars: {missing}")

    if missing == 0:
        print("All accounts already have avatars!")
        return

    print(f"\nRefreshing {missing} accounts...")
    print("-" * 50)

    refreshed = 0
    errors = 0
    start_time = time.time()

    async with TwitterClient() as client:
        # Get accounts without avatars
        accounts = db.query(Account).filter(
            Account.avatar_url == None,
            Account.handle != None
        ).all()

        for i, account in enumerate(accounts, 1):
            try:
                user_data = await client.get_user_by_username(account.handle)

                if user_data and user_data.get("id"):
                    account.avatar_url = user_data.get("profile_image_url")
                    account.bio = user_data.get("description")
                    account.name = user_data.get("name")

                    public_metrics = user_data.get("public_metrics", {})
                    account.followers_count = public_metrics.get("followers_count", account.followers_count)
                    account.following_count = public_metrics.get("following_count", account.following_count)

                    account.last_seen_at = datetime.now(timezone.utc)
                    refreshed += 1

                    # Commit every 50 accounts
                    if refreshed % 50 == 0:
                        db.commit()

            except Exception as e:
                errors += 1
                if "429" in str(e):
                    print(f"\nRate limited at account {i}. Waiting 60 seconds...")
                    await asyncio.sleep(60)

            # Progress update every 100 accounts
            if i % 100 == 0:
                elapsed = time.time() - start_time
                rate = refreshed / elapsed if elapsed > 0 else 0
                eta = (missing - refreshed) / rate if rate > 0 else 0
                print(f"Progress: {i}/{missing} ({refreshed} refreshed, {errors} errors, ETA: {eta:.0f}s)")

    db.commit()

    elapsed = time.time() - start_time
    print(f"\nCompleted in {elapsed:.1f} seconds")
    print(f"Refreshed: {refreshed}")
    print(f"Errors: {errors}")


if __name__ == "__main__":
    asyncio.run(refresh_all())
