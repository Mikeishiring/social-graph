"""FastAPI application for Social Graph."""
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import get_db, init_db
from .models import Run, Snapshot, Interval, Account, FollowEvent
from .collector import Collector
from .twitter_client import TwitterClient
from .frame_builder import FrameBuilder


app = FastAPI(
    title="Social Graph API",
    description="Temporal Twitter Network Atlas - Data Collection Backend",
    version="0.1.0"
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Startup
# =============================================================================

@app.on_event("startup")
async def startup():
    """Initialize database on startup."""
    init_db()


# =============================================================================
# Schemas
# =============================================================================

class CollectionRequest(BaseModel):
    """Request to start a collection run."""
    username: Optional[str] = None
    user_id: Optional[str] = None
    max_pages: Optional[int] = None


class CollectionResponse(BaseModel):
    """Response from collection run."""
    run_id: int
    user_id: str
    followers_count: int
    following_count: int
    follower_interval: Optional[dict] = None
    following_interval: Optional[dict] = None


class RunSummary(BaseModel):
    """Summary of a collection run."""
    run_id: int
    started_at: datetime
    finished_at: Optional[datetime]
    status: str
    notes: Optional[str]


class SnapshotSummary(BaseModel):
    """Summary of a snapshot."""
    snapshot_id: int
    run_id: int
    captured_at: datetime
    kind: str
    account_count: int


class IntervalSummary(BaseModel):
    """Summary of an interval."""
    interval_id: int
    start_at: datetime
    end_at: datetime
    new_followers_count: int
    lost_followers_count: int


# =============================================================================
# Endpoints
# =============================================================================

@app.get("/")
async def root():
    """Health check."""
    return {
        "service": "social-graph",
        "status": "healthy",
        "version": "0.1.0"
    }


@app.post("/collect", response_model=CollectionResponse)
async def run_collection(
    request: CollectionRequest,
    db: Session = Depends(get_db)
):
    """
    Run a data collection cycle.
    Collects followers, following, and computes diffs.
    """
    async with Collector(db) as collector:
        try:
            result = await collector.run_collection(
                user_id=request.user_id,
                username=request.username,
                max_pages=request.max_pages
            )
            return CollectionResponse(**result)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@app.get("/runs", response_model=list[RunSummary])
async def list_runs(
    limit: int = 10,
    db: Session = Depends(get_db)
):
    """List recent collection runs."""
    runs = db.query(Run).order_by(Run.started_at.desc()).limit(limit).all()
    return [
        RunSummary(
            run_id=r.run_id,
            started_at=r.started_at,
            finished_at=r.finished_at,
            status=r.status,
            notes=r.notes
        )
        for r in runs
    ]


@app.get("/runs/{run_id}", response_model=RunSummary)
async def get_run(run_id: int, db: Session = Depends(get_db)):
    """Get details of a specific run."""
    run = db.query(Run).filter(Run.run_id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunSummary(
        run_id=run.run_id,
        started_at=run.started_at,
        finished_at=run.finished_at,
        status=run.status,
        notes=run.notes
    )


@app.get("/snapshots", response_model=list[SnapshotSummary])
async def list_snapshots(
    kind: Optional[str] = None,
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """List snapshots, optionally filtered by kind."""
    query = db.query(Snapshot)
    if kind:
        query = query.filter(Snapshot.kind == kind)
    snapshots = query.order_by(Snapshot.captured_at.desc()).limit(limit).all()
    return [
        SnapshotSummary(
            snapshot_id=s.snapshot_id,
            run_id=s.run_id,
            captured_at=s.captured_at,
            kind=s.kind,
            account_count=s.account_count
        )
        for s in snapshots
    ]


@app.get("/intervals", response_model=list[IntervalSummary])
async def list_intervals(
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """List computed intervals."""
    intervals = db.query(Interval).order_by(Interval.end_at.desc()).limit(limit).all()
    return [
        IntervalSummary(
            interval_id=i.interval_id,
            start_at=i.start_at,
            end_at=i.end_at,
            new_followers_count=i.new_followers_count,
            lost_followers_count=i.lost_followers_count
        )
        for i in intervals
    ]


@app.get("/intervals/{interval_id}/events")
async def get_interval_events(
    interval_id: int,
    kind: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get follow events for an interval."""
    query = db.query(FollowEvent).filter(FollowEvent.interval_id == interval_id)
    if kind:
        query = query.filter(FollowEvent.kind == kind)
    
    events = query.all()
    
    # Get account details
    account_ids = [e.account_id for e in events]
    accounts = {
        a.account_id: a 
        for a in db.query(Account).filter(Account.account_id.in_(account_ids)).all()
    }
    
    return [
        {
            "event_id": e.event_id,
            "kind": e.kind,
            "account": {
                "account_id": e.account_id,
                "handle": accounts.get(e.account_id, Account()).handle,
                "name": accounts.get(e.account_id, Account()).name,
                "followers_count": accounts.get(e.account_id, Account()).followers_count
            }
        }
        for e in events
    ]


@app.get("/accounts")
async def list_accounts(
    limit: int = 50,
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List accounts, optionally searching by handle."""
    query = db.query(Account)
    if search:
        query = query.filter(Account.handle.ilike(f"%{search}%"))
    
    accounts = query.order_by(Account.followers_count.desc().nullsfirst()).limit(limit).all()
    
    return [
        {
            "account_id": a.account_id,
            "handle": a.handle,
            "name": a.name,
            "followers_count": a.followers_count,
            "following_count": a.following_count,
            "last_seen_at": a.last_seen_at
        }
        for a in accounts
    ]


@app.get("/stats")
async def get_stats(db: Session = Depends(get_db)):
    """Get overall statistics."""
    total_runs = db.query(Run).count()
    completed_runs = db.query(Run).filter(Run.status == "completed").count()
    total_accounts = db.query(Account).count()
    total_snapshots = db.query(Snapshot).count()
    total_intervals = db.query(Interval).count()
    
    latest_snapshot = db.query(Snapshot).order_by(Snapshot.captured_at.desc()).first()
    
    return {
        "total_runs": total_runs,
        "completed_runs": completed_runs,
        "total_accounts": total_accounts,
        "total_snapshots": total_snapshots,
        "total_intervals": total_intervals,
        "latest_snapshot": {
            "snapshot_id": latest_snapshot.snapshot_id,
            "captured_at": latest_snapshot.captured_at,
            "kind": latest_snapshot.kind,
            "account_count": latest_snapshot.account_count
        } if latest_snapshot else None
    }


# =============================================================================
# Frame Endpoints (M1)
# =============================================================================

@app.get("/frames")
async def list_frames(
    timeframe_window: int = 30,
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """List available frames."""
    from .models import Frame
    
    frames = db.query(Frame).filter(
        Frame.timeframe_window == timeframe_window
    ).order_by(Frame.created_at.desc()).limit(limit).all()
    
    return [
        {
            "id": f.id,
            "interval_id": f.interval_id,
            "timeframe_window": f.timeframe_window,
            "node_count": f.node_count,
            "edge_count": f.edge_count,
            "created_at": f.created_at.isoformat()
        }
        for f in frames
    ]


@app.get("/frames/latest")
async def get_latest_frame(
    timeframe_window: int = 30,
    db: Session = Depends(get_db)
):
    """Get the latest frame for visualization."""
    builder = FrameBuilder(db)
    frame_data = builder.get_frame(timeframe_window=timeframe_window)
    
    if not frame_data:
        raise HTTPException(status_code=404, detail="No frames available")
    
    return frame_data


@app.get("/frames/{interval_id}")
async def get_frame(
    interval_id: int,
    timeframe_window: int = 30,
    db: Session = Depends(get_db)
):
    """Get frame for a specific interval."""
    builder = FrameBuilder(db)
    frame_data = builder.get_frame(interval_id=interval_id, timeframe_window=timeframe_window)
    
    if not frame_data:
        raise HTTPException(status_code=404, detail="Frame not found")
    
    return frame_data


@app.post("/frames/build")
async def build_frame(
    interval_id: Optional[int] = None,
    timeframe_days: int = 30,
    ego_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Build a new frame for an interval."""
    # If no interval specified, use latest
    if not interval_id:
        interval = db.query(Interval).order_by(Interval.end_at.desc()).first()
        if not interval:
            raise HTTPException(status_code=404, detail="No intervals available")
        interval_id = interval.interval_id
    
    builder = FrameBuilder(db)
    frame = builder.build_and_save(interval_id, timeframe_days, ego_id)
    
    return {
        "frame_id": frame.id,
        "interval_id": frame.interval_id,
        "node_count": frame.node_count,
        "edge_count": frame.edge_count,
        "created_at": frame.created_at.isoformat()
    }


@app.get("/graph")
async def get_graph_data(
    timeframe_window: int = 30,
    db: Session = Depends(get_db)
):
    """
    Get graph data for 3D visualization.
    Returns nodes and edges in a format ready for Three.js/R3F.
    """
    builder = FrameBuilder(db)
    frame_data = builder.get_frame(timeframe_window=timeframe_window)
    
    if not frame_data:
        # Return empty graph if no data
        return {
            "nodes": [],
            "edges": [],
            "stats": {
                "nodeCount": 0,
                "edgeCount": 0,
                "communityCount": 0
            }
        }
    
    return frame_data


# =============================================================================
# M2 Timeline Endpoints - Frame Interpolation Support
# =============================================================================

@app.get("/timeline/frames")
async def get_timeline_frames(
    timeframe_window: int = 30,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    Get all frames for timeline scrubbing with position data.
    Returns frames sorted by interval time for smooth playback.
    """
    from .models import Frame
    
    frames = db.query(Frame).filter(
        Frame.timeframe_window == timeframe_window
    ).join(Interval).order_by(Interval.end_at.asc()).limit(limit).all()
    
    return [
        {
            "id": f.id,
            "interval_id": f.interval_id,
            "timeframe_window": f.timeframe_window,
            "node_count": f.node_count,
            "edge_count": f.edge_count,
            "created_at": f.created_at.isoformat(),
            "interval_end_at": f.interval.end_at.isoformat() if f.interval else None
        }
        for f in frames
    ]


@app.get("/timeline/interpolate")
async def interpolate_frame(
    from_interval_id: int,
    to_interval_id: int,
    progress: float = 0.5,
    timeframe_window: int = 30,
    db: Session = Depends(get_db)
):
    """
    Interpolate positions between two frames for smooth timeline playback.
    Progress: 0.0 = from_frame, 1.0 = to_frame.
    
    Returns interpolated node positions for smooth transitions.
    """
    from .models import Position
    import json
    
    # Clamp progress
    progress = max(0.0, min(1.0, progress))
    
    # Get frames
    builder = FrameBuilder(db)
    from_frame = builder.get_frame(interval_id=from_interval_id, timeframe_window=timeframe_window)
    to_frame = builder.get_frame(interval_id=to_interval_id, timeframe_window=timeframe_window)
    
    if not from_frame or not to_frame:
        raise HTTPException(status_code=404, detail="One or both frames not found")
    
    # Build node position maps
    from_positions = {n["id"]: (n["x"], n["y"], n["z"]) for n in from_frame["nodes"]}
    to_positions = {n["id"]: (n["x"], n["y"], n["z"]) for n in to_frame["nodes"]}
    
    # Interpolate positions
    interpolated_nodes = []
    all_node_ids = set(from_positions.keys()) | set(to_positions.keys())
    
    for node_id in all_node_ids:
        from_pos = from_positions.get(node_id)
        to_pos = to_positions.get(node_id)
        
        if from_pos and to_pos:
            # Interpolate existing node
            x = from_pos[0] + (to_pos[0] - from_pos[0]) * progress
            y = from_pos[1] + (to_pos[1] - from_pos[1]) * progress
            z = from_pos[2] + (to_pos[2] - from_pos[2]) * progress
        elif from_pos:
            # Node disappears - fade out
            x, y, z = from_pos
        elif to_pos:
            # New node - use target position
            x, y, z = to_pos
        else:
            continue
        
        # Find node data from either frame
        node_data = None
        for n in to_frame["nodes"]:
            if n["id"] == node_id:
                node_data = n
                break
        if not node_data:
            for n in from_frame["nodes"]:
                if n["id"] == node_id:
                    node_data = n
                    break
        
        if node_data:
            interpolated_nodes.append({
                **node_data,
                "x": round(x, 2),
                "y": round(y, 2),
                "z": round(z, 2),
                "isNew": node_id not in from_positions
            })
    
    # Use edges from appropriate frame based on progress
    edges = to_frame["edges"] if progress > 0.5 else from_frame["edges"]
    
    return {
        "interval_id": to_interval_id if progress > 0.5 else from_interval_id,
        "timeframe_days": timeframe_window,
        "progress": progress,
        "nodes": interpolated_nodes,
        "edges": edges,
        "communities": list(set(n.get("community", 0) for n in interpolated_nodes)),
        "stats": {
            "nodeCount": len(interpolated_nodes),
            "edgeCount": len(edges),
            "communityCount": len(set(n.get("community", 0) for n in interpolated_nodes)),
            "newFollowers": len([n for n in interpolated_nodes if n.get("isNew")])
        }
    }


@app.get("/positions/history")
async def get_position_history(
    account_id: str,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """
    Get position history for a specific account across intervals.
    Useful for analyzing node movement and stability.
    """
    from .models import PositionHistory
    
    history = db.query(PositionHistory).filter(
        PositionHistory.account_id == account_id
    ).order_by(PositionHistory.recorded_at.desc()).limit(limit).all()
    
    return [
        {
            "interval_id": h.interval_id,
            "x": h.x,
            "y": h.y,
            "z": h.z,
            "recorded_at": h.recorded_at.isoformat(),
            "source": h.source
        }
        for h in history
    ]
