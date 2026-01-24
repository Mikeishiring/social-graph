# AGENTS.md - Temporal Twitter Network Atlas

## One-Sentence Spec
A single-page, 3D explorable map of my Twitter network growth that replays via a timeline slider (based on snapshot intervals), overlays posts as growth catalysts, and stores raw + normalized + derived data so everything can be recomputed, joined, and extended later.

## Project Owner
- **Lead:** @ Mike
- **Agent Support:** @ Ralph (coding), @ Veronica (data insights)

## Tech Stack
- **Backend:** Python 3.11+ (FastAPI/Flask, SQLAlchemy, SQLite)
- **Frontend:** React 18+ (TypeScript, Three.js/React Three Fiber, Tailwind)
- **3D:** Three.js with force-directed graph layout

---

## Success Definition ✅

V1 is "done" when:
1. I can scrub time and the graph feels stable (no teleporting) while visibly growing/shifting
2. Clicking a post explains: "this interval's new followers + the cluster linked to it" with a confidence label
3. Collector runs on schedule and produces a valid frame even if some endpoints fail (graceful degradation)
4. All frames are reproducible from stored data (raw+normalized) using a versioned config

---

## Non-Goals 🚫

- No multi-platform ingestion (Twitter only)
- No full topic modeling/embeddings in UI
- No crawling second-hop follower graphs at scale
- No "recommendations/alerts" system
- No export pipeline (video/GIF/PNG batch) in V1

---

## Core Truth Model ⏳

### Time is Snapshot Intervals, Not Days
- A "new follower" exists only in the interval (snapshot_k → snapshot_{k+1})
- If sync cadence changes (daily → hourly), the model improves automatically

### Two-Layer Truth
1. **Growth truth:** follower/following snapshots + diffs
2. **Shape truth:** interaction + co-engagement edges (bounded and explainable)

---

## Graph Semantics 🧩

### Nodes
- A node = a Twitter account
- **Size:** interaction_with_me_score in selected timeframe window
- **Avatar/label:** top K by importance within visible window
- **Follower count:** tooltip + optional secondary "ring"

### Edges (exactly 3 types in V1)

| Edge Type | Created By | Weight |
|-----------|------------|--------|
| **Direct interaction** (A → B) | reply / mention / quote involving me | count × type_weight × recency_decay |
| **Co-engagement** (i — j) | i and j both engage with same post of mine within window | shared_engagements × weight × decay |
| **Ego follow** (me ↔️ follower) | From snapshots; for inspection/attribution, not layout | — |

---

## Default Parameters 🔧

### Time & Decay
| Parameter | Default | Notes |
|-----------|---------|-------|
| UI timeframe window | 30d | toggle: 7/30/90/All |
| Co-engagement window | 72h | captures "post-driven clustering" |
| Recency decay half-life | 14d | edges fade smoothly |
| Attribution lookback | 7d | post influence window |

### Edge Weights
| Event Type | Weight |
|------------|--------|
| reply | 4 |
| quote | 3 |
| mention | 2 |
| repost/retweet | 1 (off by default) |

### Performance Bounds
| Parameter | Default | Why |
|-----------|---------|-----|
| Max nodes rendered | 2,000 | current scale + headroom |
| Max edges rendered | 12,000 | keeps FPS stable |
| Max labeled nodes | 80 | avoids clutter |
| Max top posts per run | 20 | rate-limit safe |
| Max engagers per post | 500 | bounds graph explosion |

---

## Attribution Model 🧾

### Confidence Labels
- **High:** F directly engaged with P (reply/quote/mention/repost)
- **Medium:** P shows engagement spike + F appears in same/next interval
- **Low:** P exists in window but only weak correlation

### UI Explanation Copy
When a post is selected, show:
- "Attributed followers: N (High/Med/Low breakdown)"
- "Evidence: engaged with post / time-window correlation / shared co-engagement cluster"
- "This is interval-based attribution; exact follow moment unknown between snapshots."

---

## Data Collection Contract 🧱

### Collector Run Contract (minimum viable output)
A run is successful if it produces:
- A new snapshot (followers + following OR at least followers)
- My posts since last run (or "none")
- A derived interval diff
- A graph frame for the newest interval

### Ingested Objects (V1)
**Required:**
- My profile metrics (counts)
- Followers list (IDs)
- Following list (IDs)
- My posts since last run

**Optional (degrades gracefully):**
- Mentions/replies/quotes involving me
- Engagers for top N posts

### Degradation Modes
- No mentions/interactions: graph uses co-engagement only + follower growth
- No engagers: graph uses direct interactions only + follower growth
- No interactions + no engagers: render growth-only mode

---

## Storage Model 🧬

### Raw (append-only)
```sql
raw_fetches(id, run_id, fetched_at, endpoint, params_hash, cursor_in, cursor_out, truncated, payload_json)
```

### Normalized (canonical IDs)
```sql
runs(run_id, started_at, finished_at, status, notes, config_version, config_json)
accounts(account_id, handle, name, avatar_url, followers_count, following_count, last_seen_at)
posts(post_id, author_id, created_at, text, metrics_json, last_seen_at)
snapshots(snapshot_id, run_id, captured_at, kind)
snapshot_followers(snapshot_id, account_id)
snapshot_following(snapshot_id, account_id)
follow_events(event_id, interval_id, account_id, kind[new|lost])
interaction_events(event_id, interval_id, created_at, src_id, dst_id, type, post_id?, raw_ref_id)
post_engagers(interval_id, post_id, account_id, engager_type)
```

### Derived (recomputable caches)
```sql
intervals(interval_id, snapshot_start_id, snapshot_end_id, start_at, end_at)
edges(interval_id, src_id, dst_id, type, weight, meta_json)
communities(interval_id, account_id, community_id, confidence)
positions(interval_id, account_id, x, y, z)
frames(interval_id, timeframe_window, frame_json, node_count, edge_count, build_meta_json)
```

---

## Graph Computation ⚙️

### Edge Building (per interval, per timeframe window)
1. Build candidate edges from interaction_events and post_engagers
2. Apply weights table and recency decay
3. Prune: keep top M edges per node + global edge cap

### Communities & Bridge Scores
- Community detection (Leiden/Louvain) on pruned graph
- Bridge score: betweenness approximation OR "cross-community edge ratio"

### Layout Stability (no teleporting)
- Persist positions per interval
- New nodes: seed near strongest neighbor OR post cluster centroid
- Run bounded relaxation: max N iterations or max T milliseconds
- Never full re-layout for timeline playback; only incremental updates

---

## UI/UX Spec 🎛✨

### Canvas
- Orbit controls, smooth damping
- Hover: tooltip (handle, community, relationship strength)
- Click: lock selection + highlight neighborhood

### Timeline Bar
- Slider over intervals (not days)
- Window selector: 7 / 30 / 90 / All
- Post markers (dots) aligned to interval(s)
- Play/pause; speed multiplier (2x/4x)

### Right Inspector Panel
- **Node mode:** relationship summary + top connections + community + bridge score
- **Post mode:** follower delta + attributed followers + evidence + highlighted cluster

### Performance / LOD Rules
- If > node cap: show top nodes by importance + sample remainder per community
- Hide labels unless zoom threshold met
- Fade edges below dynamic threshold; render heavy edges first
- Maintain target 45–60fps on typical laptop

---

## Milestones 🚀

| Milestone | Focus | Deliverables |
|-----------|-------|--------------|
| **M0** | Data spine + daily intervals | Collector + DB schema + follower diffs + runs table |
| **M1** | Frame builder + 3D viewer | Derived frames + stable rendering + inspector |
| **M2** | Timeline replay | Interval scrubbing + stable layout persistence |
| **M3** | Post overlay + attribution | Markers + click-to-explain + confidence |

---

## Acceptance Criteria ✅

1. Collector produces a new interval and frame on schedule for 14 consecutive runs
2. Timeline scrub from oldest→newest produces <10% node position discontinuities
3. Clicking a post always returns: follower delta + (High/Med/Low) attribution counts + evidence list
4. Rebuild from raw+normalized reproduces identical frame_json for same config_hash

---

## Risk Register 🧯

| Risk | Mitigation |
|------|------------|
| API limits / partial data | Bounded caps + truncation markers + degradation modes |
| Layout jitter | Persisted positions + bounded relaxation |
| Graph clutter | Strict node/edge caps + LOD rules |
| Attribution ambiguity | Interval-based attribution with confidence + evidence |
| Future changes | Raw payloads + config_hash + replayability |

---

## Progress

| Milestone | Status | % |
|-----------|--------|---|
| M0: Data spine | ✅ Complete | 100% |
| M1: Frame builder + 3D | ✅ Complete | 100% |
| M2: Timeline replay | ✅ Complete | 100% |
| M3: Post overlay | ✅ Mock Complete | 100% |

**Overall: 100% (mock data)**

### M0 Completed Items
- ✅ Python project structure (FastAPI + SQLAlchemy)
- ✅ Full SQLAlchemy models (raw_fetches, accounts, posts, snapshots, follow_events, etc.)
- ✅ Twitter API v2 client with pagination
- ✅ Collector with snapshot creation and interval diff computation
- ✅ FastAPI REST endpoints
- ✅ CLI for database init, collection, stats

### M1 Completed Items
- ✅ Frame builder with edge construction (direct interaction, co-engagement, ego follow)
- ✅ Weight application and recency decay (14-day half-life)
- ✅ Community detection (label propagation algorithm)
- ✅ 3D position calculation with layout stability (force-directed + seeding)
- ✅ Frame API endpoints (/graph, /frames, /frames/build)
- ✅ React 18 + TypeScript frontend with Vite
- ✅ Three.js/React Three Fiber 3D visualization
- ✅ Orbit controls with smooth damping
- ✅ Node rendering (spheres sized by importance, colored by community)
- ✅ Edge rendering (colored by type, weighted opacity)
- ✅ Hover tooltips with account details
- ✅ Click-to-select node inspection
- ✅ Connected node highlighting on selection
- ✅ Stats panel with graph and database statistics
- ✅ Demo mode fallback when no backend data available
- ✅ Timeframe selector (7/30/90 days)
- ✅ CORS support for frontend-backend communication

### M2 Completed Items
- ✅ Frame persistence for timeline scrubbing (Position + PositionHistory tables)
- ✅ Position persistence between intervals (seeded from previous positions)
- ✅ Timeline API endpoints (/timeline/frames, /timeline/interpolate)
- ✅ Smooth interpolation during playback (linear position interpolation)
- ✅ TimelineSlider component with play/pause, speed control
- ✅ Frontend frame fetching and switching

### M3 Completed Items (Mock)
- ✅ Post markers rendered on timeline slider
- ✅ Post inspector panel with attribution breakdown and evidence list
- ✅ Highlighted attributed follower clusters in graph
- ✅ Mock post generator aligned to interval playback

### Setup Required
```bash
# Backend (Python 3.11+)
cd backend
pip install -r requirements.txt
python -m social_graph init
python -m social_graph collect
uvicorn social_graph.api:app --reload

# Frontend (Node.js 18+)
cd frontend
npm install
npm run dev
```

---

## Agent Instructions
1. Follow milestone structure (M0 → M1 → M2 → M3)
2. Build collector first (truth first)
3. Ensure layout stability before adding features
4. Update progress % after significant changes
5. Store Twitter bearer token securely

---

---

## Code Review Notes (2026-01-22)

**See `REVIEW.md` for full findings.**

### Fixes Applied (2026-01-22)
- ✅ Fixed deprecated datetime.utcnow() → timezone-aware utc_now()
- ✅ Added retry logic to collector (tenacity with exponential backoff)
- ✅ Added comprehensive tests (collector, frame_builder, models)
- ✅ Completed M2 timeline replay features
- ✅ Added frame interpolation API for smooth scrubbing
- ✅ Added position history persistence for stable replay
- ✅ Added proper error handling in frame_builder

### Test Coverage
- models.py: ~90% (comprehensive)
- collector.py: ~75% (async tests with mocks)
- frame_builder.py: ~80% (edge cases covered)

Strengths: Excellent spec documentation, clean async architecture, good test foundation.

*Last updated: 2026-01-22*
