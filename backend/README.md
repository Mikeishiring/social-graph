# Social Graph Backend

Temporal Twitter Network Atlas - Data Collection Backend

## Setup

```bash
# Create virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Unix

# Install dependencies
pip install -e .
```

## Configuration

Twitter bearer token is loaded from `~/.clawdbot/secrets/twitter.json`:

```json
{
  "bearer_token": "YOUR_BEARER_TOKEN"
}
```

Or set environment variable: `SOCIAL_GRAPH_TWITTER_BEARER_TOKEN`

## CLI Usage

```bash
# Initialize database
python -m social_graph init

# Run collection
python -m social_graph collect
python -m social_graph collect --username mikeclawdbot
python -m social_graph collect --max-pages 2  # Limit for testing

# View statistics
python -m social_graph stats

# List runs
python -m social_graph runs

# List intervals
python -m social_graph intervals
```

## API Server

```bash
python run.py
# Or: uvicorn social_graph.api:app --reload
```

API Endpoints:
- `GET /` - Health check
- `POST /collect` - Run collection
- `GET /runs` - List runs
- `GET /runs/{id}` - Get run details
- `GET /snapshots` - List snapshots
- `GET /intervals` - List intervals
- `GET /intervals/{id}/events` - Get interval events
- `GET /accounts` - List accounts
- `GET /stats` - Get statistics

## Schema

### Raw Layer (append-only)
- `raw_fetches` - Raw API responses

### Normalized Layer
- `runs` - Collection run metadata
- `accounts` - Twitter accounts
- `posts` - Tweets
- `snapshots` - Point-in-time follower/following lists
- `snapshot_followers` - Follower membership
- `snapshot_following` - Following membership
- `follow_events` - Follow/unfollow events from diffs
- `interaction_events` - Replies, mentions, quotes
- `post_engagers` - Who engaged with posts

### Derived Layer (recomputable)
- `intervals` - Time periods between snapshots
- `edges` - Graph edges
- `communities` - Community detection results
- `positions` - Node positions for layout
- `frames` - Pre-computed visualization frames
