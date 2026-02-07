# AGENTS.md - Social Graph

## What This Is
A personal X (Twitter) social-network visualizer.

Primary output is a "neural network" style graph centered on you, showing:
- Who you interact with (mentions, replies, quotes, follows, etc.)
- How the network clusters into communities
- How it grows over time (timeline + playback)

## Current Status (2026-02-07)
Working end-to-end:
- Python X/Twitter client: `src/api/twitter.py`
  - Fetches recent activity
  - Produces an `events` stream (chronological interactions)
  - Derives node stats and recency-weighted tie strength
  - Aggregates edges with counts + weights + timestamps
  - (Optional) downloads avatars for local rendering
- CLI wrapper: `src/cli.py`
  - Writes `frontend/public/data/social-graph.json`
  - Appends events to `data/events.jsonl` with simple dedupe (`data/events_ids.txt`)
- Frontend: `frontend/` (React + Vite + `react-force-graph-2d`)
  - Playback (time cursor)
  - Layout modes (clusters, timeline, free)
  - Noise controls (ego network default, min degree, cross-links toggle, inactive nodes toggle, dynamic interaction type toggles)
  - Insights (new ties, fastest-growing, strongest ties, inbound/outbound leaders) with time-window presets (7d/30d/90d/365d/all)
  - Stable mental map via cached layout positions (localStorage)
  - Node detail drawer with evidence and window breakdown (in/out + type mix)
- Mock data generator: `scripts/generate_mock_data.py`

## North Star (What “Perfect” Looks Like)
Something you can open for 30 seconds and immediately understand:
- "Who matters most" and "who is new" are obvious without hunting.
- Communities are distinct clusters, not a hairball.
- Timeline mode shows growth outward over time (newer first-seen farther out).
- Playback makes the graph feel alive: edges ping as interactions happen; nodes appear when first seen.
- You can click any person and see evidence (examples/links), plus inbound vs outbound summary.
- It stays readable at 1k-10k nodes: defaults are conservative; noise is opt-in.

## Data Contract (Frontend Input)
Frontend loads: `frontend/public/data/social-graph.json`

Required:
- `nodes`: person nodes (and optional tweet nodes)
- `edges`: aggregated edges (count + weight + first/last timestamps)
- `main_character`: node id of the center person
- `meta`: stats

Recommended:
- `events`: chronological interaction stream (powers playback + evidence)

Important node fields used by the UI:
- `type: "person"`
- `id: "twitter:username"`
- `username`, `display_name`
- `degree`
- `community_id`
- `first_seen` / `last_seen` (ISO timestamps)
- `inbound_count` / `outbound_count` / `interaction_count` (relative to main, when available)
- `inbound_strength` / `outbound_strength` / `strength` (recency-weighted)
- `local_avatar_path` OR `profile_image_url`

## How To Run
1. Frontend dev server:
   - `cd frontend`
   - `npm run dev`

2. Generate mock graph data:
   - `python scripts/generate_mock_data.py`

3. Fetch real data and write the frontend JSON:
   - copy `.env.example` -> `.env`
   - set `TWITTER_BEARER_TOKEN`
   - `python -m src.cli fetch --days 30`
   - if you imported an archive, `fetch` appends and rebuilds from the full local `data/events.jsonl` store (keeps history)

4. Import full history from an X/Twitter archive (recommended for real growth playback):
   - extract your archive zip somewhere
   - `python -m src.cli import-archive --path "C:\\path\\to\\archive" --me yourhandle`
   - current importer extracts tweet interactions (mentions/replies/quotes) plus best-effort likes/follows when present in the archive format
   - backend timestamp parsing supports both ISO (API) and archive `created_at` formats

## Repo Map
- `src/api/twitter.py`: fetch + event extraction + aggregation + tie strength + weighted + stable communities + (optional) avatars
- `src/cli.py`: CLI for fetching/exporting graph JSON + append-only events history with dedupe
- `scripts/generate_mock_data.py`: generates test graphs with events + aggregated edges
- `frontend/src/components/SocialGraph.tsx`: renderer + layout + playback + noise controls + insights
- `frontend/src/components/NodeDrawer.tsx`: node detail + evidence + window breakdown

## Immediate Objectives
1. Improve event quality and coverage:
   - Add likes/retweets (if feasible via API endpoints available to the token).
   - Increase event evidence density (include tweet text + URL whenever possible).

2. Make community detection feel correct:
   - Currently uses weighted Louvain + deterministic community ids; validate clustering vs intuition.
   - Consider "ego-network first": cluster only within main-character neighborhood by default.

3. Full-history growth:
   - Import X archive to backfill years of events (day-1 growth playback).

## Non-Goals (For Now)
- Multi-platform ingestion (LinkedIn, Telegram, etc.)
- Perfect identity resolution across platforms
