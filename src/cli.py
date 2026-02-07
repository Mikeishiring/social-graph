#!/usr/bin/env python3
"""Social Graph CLI

Usage:
  python -m src.cli init
  python -m src.cli fetch --days 30
  python -m src.cli build
  python -m src.cli export --format json

Notes:
- `fetch` writes a visualization-ready JSON (events, nodes, aggregated edges, communities, optional avatars).
- Frontend expects: frontend/public/data/social-graph.json
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

import click
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"
FRONTEND_DATA_PATH = PROJECT_ROOT / "frontend" / "public" / "data" / "social-graph.json"
FRONTEND_AVATAR_DIR = PROJECT_ROOT / "frontend" / "public" / "avatars"


def _load_seen_event_ids(events_ids_path: Path, events_jsonl_path: Path) -> set[str]:
    """Best-effort dedupe store for event ids.

    Uses a plain text file with one id per line.
    """

    seen: set[str] = set()

    if events_ids_path.exists():
        for line in events_ids_path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s:
                seen.add(s)
        return seen

    # Bootstrap from existing JSONL if present.
    if events_jsonl_path.exists():
        for line in events_jsonl_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            evt_id = obj.get("id")
            if evt_id:
                seen.add(str(evt_id))

    if seen:
        events_ids_path.parent.mkdir(parents=True, exist_ok=True)
        events_ids_path.write_text("\n".join(sorted(seen)) + "\n", encoding="utf-8")

    return seen


def _load_events_jsonl(path: Path) -> list[dict]:
    events: list[dict] = []
    if not path.exists():
        return events
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if not s:
            continue
        try:
            obj = json.loads(s)
        except Exception:
            continue
        if isinstance(obj, dict) and obj.get("ts") and obj.get("source") and obj.get("target") and obj.get("type"):
            events.append(obj)
    return events


@click.group()
def cli() -> None:
    """Social Graph CLI - Twitter network visualizer"""

    load_dotenv(PROJECT_ROOT / ".env")
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)


@cli.command()
def init() -> None:
    """Initialize project structure"""

    click.echo("Initializing Social Graph project...")
    click.echo(f"  Data dir:   {DATA_DIR}")
    click.echo(f"  Output dir: {OUTPUT_DIR}")
    click.echo(f"  Frontend:   {FRONTEND_DATA_PATH}")
    click.echo("")
    click.echo("Next steps:")
    click.echo("  1. Copy .env.example to .env")
    click.echo("  2. Add your TWITTER_BEARER_TOKEN")
    click.echo("  3. Run: python -m src.cli fetch --days 30")


@cli.command()
@click.option("--days", default=7, show_default=True, help="Number of days to fetch")
@click.option("--include-tweets", is_flag=True, default=False, help="Include tweet nodes")
@click.option("--no-avatars", is_flag=True, default=False, help="Skip downloading avatar images")
@click.option(
    "--append-events/--no-append-events",
    default=True,
    show_default=True,
    help="Append fetched events to data/events.jsonl (deduped)"
)
@click.option(
    "--write-frontend/--no-write-frontend",
    default=True,
    show_default=True,
    help="Write frontend/public/data/social-graph.json"
)
def fetch(
    days: int,
    include_tweets: bool,
    no_avatars: bool,
    append_events: bool,
    write_frontend: bool
) -> None:
    """Fetch recent tweets/mentions from Twitter API and build a viz-ready graph."""

    bearer_token = os.getenv("TWITTER_BEARER_TOKEN")
    if not bearer_token:
        click.echo("Error: TWITTER_BEARER_TOKEN not set in .env")
        click.echo("Run: cp .env.example .env && edit .env")
        return

    run_id = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")

    click.echo(f"Fetching last {days} days of Twitter data...")

    try:
        from .api.twitter import fetch_recent_data, prepare_for_visualization

        raw = fetch_recent_data(since_days=days)
        graph = prepare_for_visualization(
            raw,
            include_tweets=include_tweets,
            download_images=not no_avatars,
            output_dir=str(FRONTEND_AVATAR_DIR)
        )

        # Save raw data
        raw_path = DATA_DIR / f"twitter-raw-{datetime.now().strftime('%Y-%m-%d')}.json"
        raw_path.write_text(json.dumps(raw, indent=2), encoding="utf-8")
        click.echo(f"  Raw data: {raw_path}")

        # Save graph
        graph_path = DATA_DIR / f"graph-{datetime.now().strftime('%Y-%m-%d')}.json"
        graph_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")
        click.echo(f"  Graph: {graph_path}")

        # Append events (deduped)
        if append_events:
            events_path = DATA_DIR / "events.jsonl"
            ids_path = DATA_DIR / "events_ids.txt"
            seen = _load_seen_event_ids(ids_path, events_path)

            appended = 0
            new_ids: list[str] = []

            with open(events_path, "a", encoding="utf-8") as f:
                for evt in graph.get("events", []) or []:
                    evt_id = evt.get("id")
                    if not evt_id:
                        continue
                    evt_id = str(evt_id)
                    if evt_id in seen:
                        continue
                    seen.add(evt_id)

                    line = {"run_id": run_id, **evt}
                    f.write(json.dumps(line, ensure_ascii=False) + "\n")
                    appended += 1
                    new_ids.append(evt_id)

            if new_ids:
                with open(ids_path, "a", encoding="utf-8") as f:
                    for i in new_ids:
                        f.write(i + "\n")

            click.echo(f"  Events: {events_path} (+{appended} new)")

        if write_frontend:
            out_graph = graph

            # If we're maintaining a local event store, always rebuild the frontend JSON
            # from the full history so day-1 growth doesn't get overwritten by a "recent only" fetch.
            if append_events:
                events_path = DATA_DIR / "events.jsonl"
                all_events = _load_events_jsonl(events_path)
                if all_events:
                    from .api.twitter import prepare_graph_from_event_stream

                    out_graph = prepare_graph_from_event_stream(
                        raw,
                        all_events,
                        download_images=not no_avatars,
                        output_dir=str(FRONTEND_AVATAR_DIR),
                    )

            FRONTEND_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
            FRONTEND_DATA_PATH.write_text(json.dumps(out_graph, indent=2), encoding="utf-8")
            click.echo(f"  Frontend: {FRONTEND_DATA_PATH}")

        click.echo("")
        click.echo(f"Nodes: {len(graph.get('nodes', []))}")
        click.echo(f"Edges: {len(graph.get('edges', []))}")
        click.echo(f"Events: {len(graph.get('events', []))}")
        click.echo(f"Communities: {graph.get('meta', {}).get('communities', '?')}")

    except Exception as e:
        click.echo(f"Error: {e}")
        click.echo("Make sure your Twitter bearer token is valid")


@cli.command("import-archive")
@click.option(
    "--path",
    "archive_path",
    required=True,
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
    help="Path to an extracted X/Twitter archive folder (the one that contains a data/ directory).",
)
@click.option("--me", "me_username", default=None, help="Override archive username if it can't be detected.")
@click.option(
    "--append-events/--no-append-events",
    default=True,
    show_default=True,
    help="Append imported events to data/events.jsonl (deduped)",
)
@click.option(
    "--write-frontend/--no-write-frontend",
    default=True,
    show_default=True,
    help="Rebuild frontend/public/data/social-graph.json from the full local events store",
)
def import_archive(archive_path: Path, me_username: str | None, append_events: bool, write_frontend: bool) -> None:
    """Import an X/Twitter archive for full-history growth playback.

    This extracts outbound events from your archive. Coverage depends on the export version,
    but includes tweet interactions (replies/mentions/quotes) and may include likes/follows
    when present in your archive format.
    """

    from .importers.x_archive import extract_events_from_archive, find_archive_username
    from .api.twitter import prepare_graph_from_events

    detected = find_archive_username(archive_path)
    username = (me_username or detected or "").strip().lstrip("@")
    if not username:
        click.echo("Error: could not detect username from archive. Provide --me YOUR_USERNAME.")
        return

    click.echo(f"Importing archive from: {archive_path}")
    click.echo(f"  Username: @{username}")

    imported = extract_events_from_archive(archive_path, username=username)
    click.echo(f"  Extracted events: {len(imported)}")

    if append_events:
        events_path = DATA_DIR / "events.jsonl"
        ids_path = DATA_DIR / "events_ids.txt"
        seen = _load_seen_event_ids(ids_path, events_path)

        appended = 0
        new_ids: list[str] = []
        run_id = datetime.now().strftime("archive-%Y-%m-%dT%H-%M-%S")

        with open(events_path, "a", encoding="utf-8") as f:
            for evt in imported:
                evt_id = evt.get("id")
                if not evt_id:
                    continue
                evt_id = str(evt_id)
                if evt_id in seen:
                    continue
                seen.add(evt_id)

                line = {"run_id": run_id, **evt}
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
                appended += 1
                new_ids.append(evt_id)

        if new_ids:
            with open(ids_path, "a", encoding="utf-8") as f:
                for i in new_ids:
                    f.write(i + "\n")

        click.echo(f"  Events: {events_path} (+{appended} new)")

    if write_frontend:
        events_path = DATA_DIR / "events.jsonl"
        all_events = _load_events_jsonl(events_path)
        if not all_events:
            click.echo(f"Error: no events found at {events_path}")
            return

        graph = prepare_graph_from_events(all_events, username=username, download_images=False, output_dir=str(FRONTEND_AVATAR_DIR))

        FRONTEND_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        FRONTEND_DATA_PATH.write_text(json.dumps(graph, indent=2), encoding="utf-8")
        click.echo(f"  Frontend: {FRONTEND_DATA_PATH}")
        click.echo("")
        click.echo(f"Nodes: {len(graph.get('nodes', []))}")
        click.echo(f"Edges: {len(graph.get('edges', []))}")
        click.echo(f"Events: {len(graph.get('events', []))}")
        click.echo(f"Communities: {graph.get('meta', {}).get('communities', '?')}")


@cli.command()
def build() -> None:
    """Build graph from collected data (currently stats-only)."""

    click.echo("Building graph from data...")

    graph_files = sorted(DATA_DIR.glob("graph-*.json"), reverse=True)
    if not graph_files:
        click.echo("No graph files found. Run: python -m src.cli fetch")
        return

    latest = graph_files[0]
    click.echo(f"Using: {latest}")

    graph = json.loads(latest.read_text(encoding="utf-8"))

    nodes_by_type: dict[str, int] = {}
    for node in graph.get("nodes", []):
        t = node.get("type", "unknown")
        nodes_by_type[t] = nodes_by_type.get(t, 0) + 1

    click.echo("")
    click.echo("Graph Stats:")
    for t, count in nodes_by_type.items():
        click.echo(f"  {t}: {count}")

    click.echo(f"  Total edges: {len(graph.get('edges', []))}")
    click.echo(f"  Total events: {len(graph.get('events', []))}")


@cli.command()
@click.option("--format", default="json", show_default=True, type=click.Choice(["json", "csv"]))
def export(format: str) -> None:
    """Export the latest built graph."""

    click.echo(f"Exporting graph as {format}...")

    graph_files = sorted(DATA_DIR.glob("graph-*.json"), reverse=True)
    if not graph_files:
        click.echo("No graph files found. Run: python -m src.cli fetch")
        return

    graph = json.loads(graph_files[0].read_text(encoding="utf-8"))

    if format == "json":
        out_path = OUTPUT_DIR / "social-graph.json"
        out_path.write_text(json.dumps(graph, indent=2), encoding="utf-8")
        click.echo(f"Saved: {out_path}")
        return

    # CSV (nodes)
    out_path = OUTPUT_DIR / "social-graph-nodes.csv"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("id,type,content,timestamp\n")
        for node in graph.get("nodes", []):
            content = str(node.get("content", "")).replace("\n", " ").replace(",", ";")
            f.write(f"{node.get('id','')},{node.get('type','')},{content},{node.get('timestamp','')}\n")

    click.echo(f"Saved: {out_path}")


if __name__ == "__main__":
    cli()
