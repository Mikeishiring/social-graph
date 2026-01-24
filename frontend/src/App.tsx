import { useState, useEffect, Suspense, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Camera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import GraphViewer from './components/GraphViewer';
import NodeTooltip from './components/NodeTooltip';
import StatsPanel from './components/StatsPanel';
import TimelineSlider from './components/TimelineSlider';
import PostPanel from './components/PostPanel';
import GraphLegend from './components/GraphLegend';
import CameraFocus from './components/CameraFocus';
import { fetchFrame, fetchFrames, fetchGraphData, fetchPosts, fetchStats } from './api';
import type { GraphData, GraphNode, ApiStats, FrameSummary, PostMarker, GraphEdge } from './types';

export default function App() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState(30);
  const [useDemoData, setUseDemoData] = useState(false);
  const [frames, setFrames] = useState<FrameSummary[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [posts, setPosts] = useState<PostMarker[]>([]);
  const [selectedPost, setSelectedPost] = useState<PostMarker | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [edgeFilters, setEdgeFilters] = useState<Record<GraphEdge['type'], boolean>>({
    direct_interaction: true,
    co_engagement: true,
    ego_follow: true,
  });
  const [activeCommunities, setActiveCommunities] = useState<Set<number>>(new Set());
  const [communityFilterTouched, setCommunityFilterTouched] = useState(false);
  const [focusMode, setFocusMode] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const sceneRef = useRef<Scene | null>(null);

  const highlightedNodeIds = useMemo(() => {
    if (!selectedPost) return new Set<string>();
    return new Set(selectedPost.attributed_follower_ids);
  }, [selectedPost]);

  const allCommunities = useMemo(() => {
    if (!graphData) return [];
    return Array.from(new Set(graphData.nodes.map((node) => node.community))).sort((a, b) => a - b);
  }, [graphData]);

  const filteredGraphData = useMemo(() => {
    if (!graphData) return null;
    const active = activeCommunities.size > 0 ? activeCommunities : new Set(allCommunities);
    const nodes = graphData.nodes.filter((node) => active.has(node.community));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = graphData.edges.filter((edge) => {
      if (!edgeFilters[edge.type]) return false;
      return nodeIds.has(edge.source) && nodeIds.has(edge.target);
    });
    const communities = Array.from(new Set(nodes.map((node) => node.community)));

    return {
      ...graphData,
      nodes,
      edges,
      communities,
      stats: {
        ...graphData.stats,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        communityCount: communities.length,
      },
    };
  }, [activeCommunities, allCommunities, edgeFilters, graphData]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const source = filteredGraphData ?? graphData;
    if (!source) return [];

    return source.nodes
      .map((node) => {
        const handle = node.handle?.toLowerCase() ?? '';
        const name = node.name?.toLowerCase() ?? '';
        const id = node.id.toLowerCase();
        let score = 0;

        if (handle.startsWith(query)) score += 3;
        else if (handle.includes(query)) score += 2;
        if (name.startsWith(query)) score += 2;
        else if (name.includes(query)) score += 1;
        if (id.startsWith(query)) score += 1;
        else if (id.includes(query)) score += 0.5;

        return score > 0 ? { node, score } : null;
      })
      .filter((entry): entry is { node: GraphNode; score: number } => Boolean(entry))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.node.importance - a.node.importance;
      })
      .slice(0, 6)
      .map((entry) => entry.node);
  }, [filteredGraphData, graphData, searchQuery]);

  const clusterFocusTarget = useMemo(() => {
    if (!graphData || !selectedPost || !focusMode) return null;
    const nodes = graphData.nodes.filter((node) => highlightedNodeIds.has(node.id));
    if (nodes.length === 0) return null;
    const sum = nodes.reduce(
      (acc, node) => {
        acc[0] += node.x;
        acc[1] += node.y;
        acc[2] += node.z;
        return acc;
      },
      [0, 0, 0]
    );
    return [
      sum[0] / nodes.length,
      sum[1] / nodes.length,
      sum[2] / nodes.length,
    ] as [number, number, number];
  }, [focusMode, graphData, highlightedNodeIds, selectedPost]);

  const focusTarget = useMemo(() => {
    if (selectedNode) {
      return [selectedNode.x, selectedNode.y, selectedNode.z] as [number, number, number];
    }
    return clusterFocusTarget;
  }, [clusterFocusTarget, selectedNode]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setIsPlaying(false);
      setSelectedNode(null);
      setHoveredNode(null);
      setSelectedPost(null);

      const [framesData, statsData, postsData] = await Promise.all([
        fetchFrames(timeframe, 200),
        fetchStats(),
        fetchPosts(timeframe, 200),
      ]);

      setStats(statsData);

      let resolvedFrames: FrameSummary[] = [];
      let resolvedGraphData: GraphData | null = null;

      if (framesData.length > 0) {
        const sortedFrames = [...framesData].sort(
          (a, b) => a.interval_id - b.interval_id
        );
        resolvedFrames = sortedFrames;
        const latestIndex = sortedFrames.length - 1;
        setCurrentFrameIndex(latestIndex);

        const frameData = await fetchFrame(
          sortedFrames[latestIndex].interval_id,
          timeframe
        );

        if (frameData) {
          resolvedGraphData = frameData;
        }
      } else {
        const data = await fetchGraphData(timeframe);
        if (data && data.nodes.length > 0) {
          resolvedGraphData = data;
        }
      }

      setFrames(resolvedFrames);
      setGraphData(resolvedGraphData);
      setUseDemoData(!resolvedGraphData);
      setPosts(postsData);
      setLoading(false);
    }

    loadData();
  }, [timeframe]);

  useEffect(() => {
    if (!graphData) return;
    setActiveCommunities((prev) => {
      const next = communityFilterTouched
        ? new Set(prev)
        : new Set(allCommunities);

      if (communityFilterTouched) {
        Array.from(next).forEach((id) => {
          if (!allCommunities.includes(id)) {
            next.delete(id);
          }
        });
        if (next.size === 0) {
          allCommunities.forEach((id) => next.add(id));
        }
      }

      if (next.size === prev.size && Array.from(next).every((id) => prev.has(id))) {
        return prev;
      }

      return next;
    });
  }, [allCommunities, communityFilterTouched, graphData]);

  useEffect(() => {
    if (!searchQuery) return;
    setSearchActiveIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    async function loadFrame() {
      if (frames.length === 0) return;
      const frame = frames[currentFrameIndex];
      if (!frame) return;

      const frameData = await fetchFrame(frame.interval_id, timeframe);
      if (frameData) {
        setGraphData(frameData);
        setUseDemoData(false);
        setSelectedNode(null);
        setHoveredNode(null);
      }
    }

    loadFrame();
  }, [frames, currentFrameIndex, timeframe]);

  useEffect(() => {
    const frame = frames[currentFrameIndex];
    if (!frame || !selectedPost) return;
    if (frame.interval_id !== selectedPost.interval_id) {
      setSelectedPost(null);
    }
  }, [currentFrameIndex, frames, selectedPost]);

  useEffect(() => {
    if (!isPlaying || frames.length < 2) return;

    const baseIntervalMs = 2000;
    const intervalMs = baseIntervalMs / playbackSpeed;
    const timer = window.setInterval(() => {
      setCurrentFrameIndex((prev) => {
        if (prev >= frames.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, frames.length, playbackSpeed]);

  const handlePointerMove = (e: React.PointerEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleTogglePlay = () => {
    if (frames.length === 0) return;
    setIsPlaying((prev) => {
      const next = !prev;
      if (next && currentFrameIndex >= frames.length - 1) {
        setCurrentFrameIndex(0);
      }
      return next;
    });
  };

  const handlePostSelect = (post: PostMarker) => {
    setSelectedNode(null);
    setSelectedPost(post);
    setIsPlaying(false);
    const targetIndex = frames.findIndex((frame) => frame.interval_id === post.interval_id);
    if (targetIndex >= 0) {
      setCurrentFrameIndex(targetIndex);
    }
  };

  const handleSelectNode = (node: GraphNode) => {
    setSelectedPost(null);
    setSelectedNode(node);
    setCommunityFilterTouched(true);
    setActiveCommunities((prev) => {
      if (prev.has(node.community)) return prev;
      const next = new Set(prev);
      next.add(node.community);
      return next;
    });
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setSearchQuery('');
      return;
    }
    if (!searchResults.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSearchActiveIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSearchActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = searchResults[searchActiveIndex] ?? searchResults[0];
      if (target) {
        handleSelectNode(target);
        setSearchQuery('');
      }
    }
  };

  const handleExport = () => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!renderer || !camera || !scene) return;

    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `social-graph-${timestamp}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full h-full relative" onPointerMove={handlePointerMove}>
      {/* 3D Canvas - Light background */}
      <Canvas
        camera={{ position: [0, 0, 100], fov: 60 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        dpr={[1, 1.5]}
        style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}
        onCreated={({ gl, camera, scene }) => {
          rendererRef.current = gl;
          cameraRef.current = camera;
          sceneRef.current = scene;
        }}
      >
        <Suspense fallback={null}>
          {/* Soft ambient lighting for light theme */}
          <ambientLight intensity={0.9} />
          <directionalLight position={[10, 10, 5]} intensity={0.4} />

          {/* Graph visualization */}
          {graphData && (
            <GraphViewer
              data={filteredGraphData ?? graphData}
              onNodeHover={setHoveredNode}
              onNodeClick={(node) => {
                if (node) {
                  handleSelectNode(node);
                }
              }}
              selectedNode={selectedNode}
              highlightedNodeIds={highlightedNodeIds}
              focusMode={focusMode}
            />
          )}

          <CameraFocus target={focusTarget} controlsRef={controlsRef} />

          {/* Orbit controls with slow auto-rotation */}
          <OrbitControls
            ref={controlsRef}
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={20}
            maxDistance={300}
            dampingFactor={0.05}
            rotateSpeed={0.5}
            autoRotate={!selectedNode && !selectedPost && !isPlaying}
            autoRotateSpeed={0.3}
          />
        </Suspense>
      </Canvas>

      {/* UI Overlay */}
      <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none">
        <div className="absolute top-3 left-3 right-3 sm:top-4 sm:left-4 sm:right-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pointer-events-none z-30">
          {/* Header */}
          <div className="pointer-events-auto enter-rise enter-stagger-1">
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-800">Social Graph</h1>
            <p className="text-sm text-slate-500">
              {useDemoData ? 'No Data - Run Collection' : 'Network Atlas'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {selectedPost && (
                <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] ${
                  focusMode ? 'chip-active' : 'chip'
                }`}>
                  Focus {focusMode ? 'On' : 'Off'}
                </div>
              )}
            </div>
            <div className="mt-3 max-w-sm">
              <div className="rounded-xl p-2 panel-surface">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Find</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Search handle or name"
                    className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-[10px] uppercase tracking-[0.2em] text-slate-300 hover:text-slate-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {searchQuery && (
                  <div className="mt-2 max-h-40 overflow-auto">
                    {searchResults.length === 0 ? (
                      <p className="text-[11px] text-slate-400 px-2 py-1">No matches in view</p>
                    ) : (
                      searchResults.map((node, index) => {
                        const isActive = index === searchActiveIndex;
                        return (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => {
                              handleSelectNode(node);
                              setSearchQuery('');
                            }}
                            className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition ${
                              isActive ? 'bg-blue-50 text-slate-800' : 'text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm text-slate-700">
                                  @{node.handle || node.id.slice(0, 8)}
                                </p>
                                {node.name && (
                                  <p className="text-[11px] text-slate-400">{node.name}</p>
                                )}
                              </div>
                              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-300">
                                C{node.community}
                              </span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Timeframe selector */}
          <div className="pointer-events-auto enter-rise enter-stagger-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLegendOpen((prev) => !prev)}
              className="sm:hidden px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-[0.2em] chip"
            >
              {legendOpen ? 'Hide' : 'Legend'}
            </button>
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                onClick={() => setTimeframe(days)}
                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all border ${
                  timeframe === days
                    ? 'bg-blue-500 border-blue-400 text-white shadow-md'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {days}d
              </button>
            ))}
            <button
              type="button"
              onClick={handleExport}
              className="px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all border bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Export PNG
            </button>
          </div>
        </div>

        {/* Stats panel */}
        <div className={legendOpen ? 'hidden sm:block' : ''}>
          <StatsPanel
            graphData={filteredGraphData ?? graphData}
            apiStats={stats}
            loading={loading}
          />
        </div>

        {/* Timeline controls */}
        <TimelineSlider
          frames={frames}
          posts={posts}
          selectedPostId={selectedPost?.id ?? null}
          currentIndex={currentFrameIndex}
          isPlaying={isPlaying}
          speed={playbackSpeed}
          onIndexChange={(index) => {
            setIsPlaying(false);
            setCurrentFrameIndex(index);
          }}
          onPostSelect={handlePostSelect}
          onTogglePlay={handleTogglePlay}
          onSpeedChange={setPlaybackSpeed}
        />

        {/* Loading indicator */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-600">Loading graph...</p>
            </div>
          </div>
        )}

        {/* Tooltip */}
        {hoveredNode && (
          <NodeTooltip node={hoveredNode} position={mousePos} />
        )}

        {/* Selected node panel */}
        {selectedNode && !selectedPost && (
          <div className="absolute bottom-24 sm:bottom-4 right-4 left-4 sm:left-auto sm:w-80 w-[calc(100vw-2rem)] rounded-xl p-4 pointer-events-auto panel-surface shadow-lg enter-rise z-20">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  @{selectedNode.handle || selectedNode.id}
                </h3>
                <p className="text-sm text-slate-500">{selectedNode.name}</p>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                x
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-slate-400">Followers</p>
                <p className="text-slate-700 font-medium">
                  {selectedNode.followers.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Community</p>
                <p className="text-slate-700 font-medium">#{selectedNode.community}</p>
              </div>
              <div>
                <p className="text-slate-400">Importance</p>
                <p className="text-slate-700 font-medium">
                  {(selectedNode.importance * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-slate-400">Status</p>
                <p className={`font-medium ${selectedNode.isNew ? 'text-emerald-600' : 'text-slate-600'}`}>
                  {selectedNode.isNew ? 'New' : 'Existing'}
                </p>
              </div>
            </div>
          </div>
        )}

        {selectedPost && (
          <PostPanel
            post={selectedPost}
            onClose={() => setSelectedPost(null)}
          />
        )}

        <GraphLegend
          graphData={graphData}
          edgeFilters={edgeFilters}
          activeCommunities={activeCommunities}
          focusMode={focusMode}
          hasSelectedPost={Boolean(selectedPost)}
          isOpen={legendOpen}
          onClose={() => setLegendOpen(false)}
          onToggleEdge={(edgeType) => {
            setEdgeFilters((prev) => ({ ...prev, [edgeType]: !prev[edgeType] }));
          }}
          onToggleCommunity={(communityId) => {
            setCommunityFilterTouched(true);
            setActiveCommunities((prev) => {
              const next = new Set(prev);
              if (next.has(communityId)) {
                if (next.size === 1) {
                  return next;
                }
                next.delete(communityId);
                return next;
              }
              next.add(communityId);
              return next;
            });
          }}
          onSelectAllCommunities={() => {
            setCommunityFilterTouched(true);
            setActiveCommunities(new Set(allCommunities));
          }}
          onToggleFocusMode={() => setFocusMode((prev) => !prev)}
        />
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 text-xs text-slate-400 pointer-events-none enter-fade hidden sm:block">
        <p>Drag to rotate, scroll to zoom, click node or post marker to inspect</p>
      </div>
    </div>
  );
}
