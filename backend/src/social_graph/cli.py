"""CLI for Social Graph data collection."""
import asyncio
import argparse
import sys
import json

from .database import init_db, SessionLocal
from .collector import Collector
from .models import Run, Snapshot, Interval, Account
from .post_attribution import build_post_attributions
from .mock_posts import seed_mock_post_attributions


def cmd_init(args):
    """Initialize the database."""
    print("Initializing database...")
    init_db()
    print("Database initialized successfully")


async def cmd_collect_async(args):
    """Run data collection."""
    init_db()
    db = SessionLocal()
    
    try:
        async with Collector(db) as collector:
            print(f"Starting collection run...")
            if args.username:
                print(f"  Target user: @{args.username}")
            elif args.user_id:
                print(f"  Target user ID: {args.user_id}")
            else:
                print(f"  Target: authenticated user")
            
            result = await collector.run_collection(
                user_id=args.user_id,
                username=args.username,
                max_pages=args.max_pages
            )
            
            print(f"\nCollection completed!")
            print(f"  Run ID: {result['run_id']}")
            print(f"  User ID: {result['user_id']}")
            print(f"  Followers: {result['followers_count']}")
            print(f"  Following: {result['following_count']}")
            
            if result['follower_interval']:
                fi = result['follower_interval']
                print(f"\n  Follower changes:")
                print(f"    New: +{fi['new']}")
                print(f"    Lost: -{fi['lost']}")
            else:
                print(f"\n  First snapshot - no interval computed")
            
            if result['following_interval']:
                fi = result['following_interval']
                print(f"\n  Following changes:")
                print(f"    New: +{fi['new']}")
                print(f"    Lost: -{fi['lost']}")
            
            return result
            
    except Exception as e:
        print(f"\nCollection failed: {e}")
        raise
    finally:
        db.close()


def cmd_collect(args):
    """Run data collection (sync wrapper)."""
    return asyncio.run(cmd_collect_async(args))


def cmd_stats(args):
    """Show database statistics."""
    init_db()
    db = SessionLocal()
    
    try:
        total_runs = db.query(Run).count()
        completed_runs = db.query(Run).filter(Run.status == "completed").count()
        total_accounts = db.query(Account).count()
        total_snapshots = db.query(Snapshot).count()
        total_intervals = db.query(Interval).count()
        
        print("Social Graph Statistics")
        print("=" * 40)
        print(f"Runs: {total_runs} ({completed_runs} completed)")
        print(f"Accounts: {total_accounts}")
        print(f"Snapshots: {total_snapshots}")
        print(f"Intervals: {total_intervals}")
        
        latest_snapshot = db.query(Snapshot).order_by(
            Snapshot.captured_at.desc()
        ).first()
        
        if latest_snapshot:
            print(f"\nLatest snapshot:")
            print(f"  ID: {latest_snapshot.snapshot_id}")
            print(f"  Type: {latest_snapshot.kind}")
            print(f"  Count: {latest_snapshot.account_count}")
            print(f"  Time: {latest_snapshot.captured_at}")
    finally:
        db.close()


def cmd_runs(args):
    """List collection runs."""
    init_db()
    db = SessionLocal()
    
    try:
        runs = db.query(Run).order_by(Run.started_at.desc()).limit(args.limit).all()
        
        if not runs:
            print("No runs found")
            return
        
        print(f"Recent runs (limit {args.limit}):")
        print("-" * 70)
        for run in runs:
            duration = ""
            if run.finished_at:
                delta = run.finished_at - run.started_at
                duration = f" ({delta.total_seconds():.1f}s)"
            
            print(f"  #{run.run_id}: {run.status}{duration}")
            print(f"    Started: {run.started_at}")
            if run.notes:
                print(f"    Notes: {run.notes}")
            print()
    finally:
        db.close()


def cmd_intervals(args):
    """List computed intervals."""
    init_db()
    db = SessionLocal()
    
    try:
        intervals = db.query(Interval).order_by(
            Interval.end_at.desc()
        ).limit(args.limit).all()
        
        if not intervals:
            print("No intervals found")
            return
        
        print(f"Recent intervals (limit {args.limit}):")
        print("-" * 70)
        for interval in intervals:
            print(f"  #{interval.interval_id}")
            print(f"    Period: {interval.start_at} -> {interval.end_at}")
            print(f"    New followers: +{interval.new_followers_count}")
            print(f"    Lost followers: -{interval.lost_followers_count}")
            print()
    finally:
        db.close()


def cmd_posts(args):
    """Build or list post attributions."""
    init_db()
    db = SessionLocal()

    try:
        if args.seed_mock:
            results = seed_mock_post_attributions(
                db,
                timeframe_window=args.timeframe,
                limit=args.limit,
                rebuild=args.rebuild,
            )
        else:
            results = build_post_attributions(
                db,
                timeframe_window=args.timeframe,
                limit=args.limit,
                rebuild=args.rebuild,
            )

        if args.json:
            print(json.dumps(results, indent=2))
            return

        print("Post attributions")
        print("=" * 40)
        print(f"Timeframe: {args.timeframe}d")
        print(f"Limit: {args.limit}")
        print(f"Rebuild: {'yes' if args.rebuild else 'no'}")
        print(f"Seed mock: {'yes' if args.seed_mock else 'no'}")
        print("-" * 40)

        if not results:
            print("No attributions found")
            return

        for post in results:
            handle = post.get("id", "unknown")
            created_at = post.get("created_at", "unknown")
            attribution = post.get("attribution", {})
            total = attribution.get("high", 0) + attribution.get("medium", 0) + attribution.get("low", 0)
            text = (post.get("text") or "").replace("\n", " ").strip()
            if len(text) > 80:
                text = f"{text[:77]}..."
            print(f"- {handle} ({created_at})")
            print(f"  Followers attributed: {total} (H/M/L {attribution.get('high', 0)}/{attribution.get('medium', 0)}/{attribution.get('low', 0)})")
            if text:
                print(f"  {text}")
    finally:
        db.close()


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Social Graph - Temporal Twitter Network Atlas"
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # init
    init_parser = subparsers.add_parser("init", help="Initialize database")
    init_parser.set_defaults(func=cmd_init)
    
    # collect
    collect_parser = subparsers.add_parser("collect", help="Run data collection")
    collect_parser.add_argument("--username", "-u", help="Twitter username to collect")
    collect_parser.add_argument("--user-id", help="Twitter user ID to collect")
    collect_parser.add_argument("--max-pages", type=int, help="Max pagination pages")
    collect_parser.set_defaults(func=cmd_collect)
    
    # stats
    stats_parser = subparsers.add_parser("stats", help="Show statistics")
    stats_parser.set_defaults(func=cmd_stats)
    
    # runs
    runs_parser = subparsers.add_parser("runs", help="List collection runs")
    runs_parser.add_argument("--limit", type=int, default=10, help="Number of runs")
    runs_parser.set_defaults(func=cmd_runs)
    
    # intervals
    intervals_parser = subparsers.add_parser("intervals", help="List intervals")
    intervals_parser.add_argument("--limit", type=int, default=10, help="Number of intervals")
    intervals_parser.set_defaults(func=cmd_intervals)

    # posts
    posts_parser = subparsers.add_parser("posts", help="Build post attributions")
    posts_parser.add_argument("--timeframe", type=int, default=30, help="Timeframe window in days")
    posts_parser.add_argument("--limit", type=int, default=20, help="Number of posts to include")
    posts_parser.add_argument("--rebuild", action="store_true", help="Rebuild cached attributions")
    posts_parser.add_argument("--seed-mock", action="store_true", help="Seed mock posts into the cache")
    posts_parser.add_argument("--json", action="store_true", help="Output full attribution payloads")
    posts_parser.set_defaults(func=cmd_posts)
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return 1
    
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
