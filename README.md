# Social Graph - Temporal Twitter Network Atlas

A 3D interactive visualization of your Twitter network growth over time. Watch your followers appear, form communities, and see how your network evolves.

![Social Graph Visualization](docs/screenshot.png)

## Features

- **3D Network Graph**: Interactive WebGL visualization with orbit controls
- **Timeline Playback**: Scrub through your network's growth history
- **Community Detection**: Automatic clustering of related accounts
- **Profile Pictures**: Full avatar support for all followers
- **Cumulative Growth**: Watch new followers connect to existing network

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- TwitterAPI.io API key (get one at https://twitterapi.io/)

### One-Command Setup

```bash
# Clone and setup
git clone https://github.com/yourusername/social-graph.git
cd social-graph
python setup.py YOUR_API_KEY
```

Or setup manually:

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
pip install -e src
cp .env.example .env      # Edit and add your API key

# Frontend
cd ../frontend
npm install
```

### Start the App

**Windows:**
```bash
start.bat
```

**Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

**Manual:**
```bash
# Terminal 1 - Backend
cd backend
source venv/bin/activate
uvicorn social_graph.api:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Open http://localhost:5173 to see the visualization.

## Collect Your Network Data

```bash
# Collect followers/following for a Twitter account
curl -X POST "http://localhost:8000/collect?username=YOUR_HANDLE"

# Fetch profile pictures for all accounts
curl -X POST "http://localhost:8000/accounts/refresh?batch_size=100"

# Build visualization frames
curl -X POST "http://localhost:8000/frames/build"
```

Run collection periodically to track network growth over time.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/collect` | POST | Collect followers/following data |
| `/accounts/refresh` | POST | Fetch profile pictures |
| `/accounts/stats` | GET | Data completeness stats |
| `/frames/build` | POST | Build visualization frame |
| `/frames/{id}` | GET | Get specific frame |
| `/graph` | GET | Current graph for visualization |
| `/timeline/frames` | GET | All frames for timeline |
| `/stats` | GET | Database statistics |

## Configuration

Edit `backend/.env`:

```bash
# TwitterAPI.io API key (required)
SOCIAL_GRAPH_TWITTER_BEARER_TOKEN=your_api_key_here

# Database (SQLite default, can use PostgreSQL)
SOCIAL_GRAPH_DATABASE_URL=sqlite:///./social_graph.db

# Collection limits
SOCIAL_GRAPH_MAX_TOP_POSTS_PER_RUN=20
SOCIAL_GRAPH_MAX_ENGAGERS_PER_POST=500
```

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
                              │
                        ┌─────▼─────┐
                        │ Twitter   │
                        │ API.io    │
                        └───────────┘
```

## Tech Stack

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, SQLite
- **Frontend**: React 18, TypeScript, Three.js, React Three Fiber
- **Visualization**: Force-directed 3D layout, WebGL rendering

## How It Works

1. **Data Collection**: Fetches your followers/following from Twitter API
2. **Snapshot Diffing**: Compares snapshots to find new/lost followers
3. **Edge Building**: Connects new followers to existing network based on similarity
4. **Community Detection**: Groups related accounts using label propagation
5. **Layout Computation**: Force-directed positioning with stability
6. **Frame Storage**: Saves precomputed frames for fast playback

## Development

```bash
# Run tests
cd backend
pytest

# Type checking
cd frontend
npm run lint

# Build for production
cd frontend
npm run build
```

## License

MIT
