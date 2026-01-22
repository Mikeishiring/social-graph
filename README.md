# Social Graph - Temporal Twitter Network Atlas

A 3D explorable map of your Twitter network growth with timeline playback.

## Quick Start

### Backend (Python)
```bash
cd backend
pip install -r requirements.txt
python -m social_graph init        # Initialize database
python -m social_graph collect     # Run data collection
uvicorn social_graph.api:app --reload --port 8000
```

### Frontend (React)
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 to see the graph visualization.

## Features

### M1: Frame Builder + 3D Viewer ✅
- **Edge Construction**: Direct interactions, co-engagement, ego follow edges
- **Recency Decay**: 14-day half-life exponential decay
- **Community Detection**: Label propagation algorithm
- **Layout Stability**: Force-directed with position persistence
- **3D Visualization**: Three.js/React Three Fiber
- **Interactive**: Hover tooltips, click-to-select, orbit controls

### M2: Timeline Replay ✅
- **Interval Scrubbing**: Slider-driven playback across stored frames
- **Playback Controls**: Play/pause with speed multipliers
- **Frame API**: Timeline binds to `/frames` and `/frames/{interval_id}`

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend       │
│   React/R3F     │ API │   FastAPI       │
│   :5173         │◀────│   :8000         │
└─────────────────┘     └─────────────────┘
                              │
                        ┌─────▼─────┐
                        │  SQLite   │
                        │  Database │
                        └───────────┘
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/graph` | GET | Graph data for visualization |
| `/frames` | GET | List available frames |
| `/frames/build` | POST | Build a new frame |
| `/stats` | GET | Database statistics |
| `/collect` | POST | Run data collection |

## Tech Stack
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, SQLite
- **Frontend**: React 18, TypeScript, Tailwind CSS, Three.js/R3F
- **Visualization**: Force-directed 3D graph layout

## Project Status

| Milestone | Status |
|-----------|--------|
| M0: Data spine | ✅ Complete |
| M1: Frame builder + 3D | ✅ Complete |
| M2: Timeline replay | ✅ Complete |
| M3: Post overlay | 🔲 Not Started |

**Overall Progress: 75%**
