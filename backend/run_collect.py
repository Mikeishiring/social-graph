# -*- coding: utf-8 -*-
import asyncio
import sys
import os
import traceback

os.environ['SOCIAL_GRAPH_TWITTER_BEARER_TOKEN'] = 'new1_c2e35f5e8a13439f828b407fd9765184'
sys.path.insert(0, 'src')

# Clean up stale runs first
import sqlite3
conn = sqlite3.connect('social_graph.db')
cursor = conn.cursor()
cursor.execute("UPDATE runs SET status = 'failed', finished_at = datetime('now') WHERE status = 'running'")
cursor.execute("DELETE FROM snapshots WHERE account_count = 0")
conn.commit()
conn.close()
print('Cleaned up stale data', flush=True)

from social_graph.twitter_client import TwitterClient
from social_graph.database import get_db
from social_graph.models import Run, Snapshot, SnapshotFollower, Account

async def run_collection():
    try:
        print('Creating DB session...', flush=True)
        db = next(get_db())

        print('Creating Twitter client...', flush=True)
        client = TwitterClient()

        # Create run
        from datetime import datetime, timezone
        run = Run(
            started_at=datetime.now(timezone.utc),
            status="running",
            config_version="1.0.0",
            config_json="{}"
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        print(f'Run {run.run_id} created', flush=True)

        # Get user info
        print('Getting user info...', flush=True)
        user_data = await client.get_user_by_username('mikeishiring')
        user_id = user_data["id"]
        print(f'User ID: {user_id}', flush=True)

        # Create snapshot
        snapshot = Snapshot(run_id=run.run_id, kind="followers", account_count=0)
        db.add(snapshot)
        db.commit()
        db.refresh(snapshot)
        print(f'Snapshot {snapshot.snapshot_id} created', flush=True)

        # Paginate followers
        print('Starting pagination...', flush=True)
        total = 0
        page = 0
        async for users, cursor_in, cursor_out, truncated in client.paginate_followers(
            user_id, username='mikeishiring'
        ):
            page += 1
            print(f'Page {page}: {len(users)} users', flush=True)

            for user in users:
                # Upsert account
                account_id = str(user.get("id"))
                account = db.query(Account).filter(Account.account_id == account_id).first()
                if not account:
                    account = Account(
                        account_id=account_id,
                        handle=user.get("username"),
                        name=user.get("name"),
                        location=user.get("location"),
                        is_automated=user.get("is_automated"),
                        can_dm=user.get("can_dm")
                    )
                    db.add(account)

                # Add to snapshot
                follower = SnapshotFollower(
                    snapshot_id=snapshot.snapshot_id,
                    account_id=account_id,
                    follow_position=total
                )
                db.add(follower)
                total += 1

            db.commit()
            print(f'  Committed {total} followers so far', flush=True)

        # Update snapshot count
        snapshot.account_count = total
        run.status = "completed"
        run.finished_at = datetime.now(timezone.utc)
        db.commit()

        await client.close()
        print(f'Done! Collected {total} followers', flush=True)

    except Exception as e:
        print(f'ERROR: {type(e).__name__}: {e}', flush=True)
        traceback.print_exc()
        raise

if __name__ == '__main__':
    asyncio.run(run_collection())
