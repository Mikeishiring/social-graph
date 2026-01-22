import { useState, useEffect, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import GraphViewer from './components/GraphViewer';
import NodeTooltip from './components/NodeTooltip';
import StatsPanel from './components/StatsPanel';
import TimelineSlider from './components/TimelineSlider';
import { fetchFrame, fetchFrames, fetchGraphData, fetchStats } from './api';
import type { GraphData, GraphNode, ApiStats, FrameSummary } from './types';

// Generate demo data when no backend available
function generateDemoData(): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphData['edges'] = [];
  const numNodes = 50;
  const numCommunities = 5;

  // Generate nodes in communities
  for (let i = 0; i < numNodes; i++) {
    const community = i % numCommunities;
    const angle = (community / numCommunities) * Math.PI * 2;
    const radius = 30 + Math.random() * 20;
    const spread = 15;

    nodes.push({
      id: `user_${i}`,
      handle: `user${i}`,
      name: `User ${i}`,
      avatar: null,
      followers: Math.floor(Math.random() * 10000),
      importance: Math.random(),
      community,
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * spread,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * spread,
      z: (Math.random() - 0.5) * 20,
      isNew: Math.random() < 0.1,
    });
  }

  // Generate edges within and between communities
  for (let i = 0; i < numNodes; i++) {
    // Intra-community edges (stronger)
    for (let j = i + 1; j < numNodes; j++) {
      if (nodes[i].community === nodes[j].community && Math.random() < 0.3) {
        edges.push({
          source: nodes[i].id,
          target: nodes[j].id,
          type: 'direct_interaction',
          weight: 0.5 + Math.random() * 0.5,
        });
      }
    }
    // Inter-community edges (weaker)
    for (let j = i + 1; j < numNodes; j++) {
      if (nodes[i].community !== nodes[j].community && Math.random() < 0.05) {
        edges.push({
          source: nodes[i].id,
          target: nodes[j].id,
          type: 'co_engagement',
          weight: 0.1 + Math.random() * 0.3,
        });
      }
    }
  }

  return {
    interval_id: 1,
    timeframe_days: 30,
    timestamp: new Date().toISOString(),
    nodes,
    edges,
    communities: Array.from({ length: numCommunities }, (_, i) => i),
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      communityCount: numCommunities,
      newFollowers: nodes.filter(n => n.isNew).length,
    },
  };
}

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

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setIsPlaying(false);
      setSelectedNode(null);
      setHoveredNode(null);
      
      const [framesData, statsData] = await Promise.all([
        fetchFrames(timeframe, 200),
        fetchStats(),
      ]);

      setStats(statsData);

      if (framesData.length > 0) {
        const sortedFrames = [...framesData].sort(
          (a, b) => a.interval_id - b.interval_id
        );
        setFrames(sortedFrames);
        const latestIndex = sortedFrames.length - 1;
        setCurrentFrameIndex(latestIndex);

        const frameData = await fetchFrame(
          sortedFrames[latestIndex].interval_id,
          timeframe
        );

        if (frameData) {
          setGraphData(frameData);
          setUseDemoData(false);
        } else {
          setGraphData(generateDemoData());
          setUseDemoData(true);
        }
      } else {
        setFrames([]);
        const data = await fetchGraphData(timeframe);
        if (data && data.nodes.length > 0) {
          setGraphData(data);
          setUseDemoData(false);
        } else {
          setGraphData(generateDemoData());
          setUseDemoData(true);
        }
      }

      setLoading(false);
    }

    loadData();
  }, [timeframe]);

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

  return (
    <div className="w-full h-full relative" onPointerMove={handlePointerMove}>
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 0, 100], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'linear-gradient(180deg, #0a0a1a 0%, #0a0a0f 100%)' }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1} />
          
          {/* Star field background */}
          <Stars radius={300} depth={60} count={2000} factor={4} saturation={0} fade />
          
          {/* Graph visualization */}
          {graphData && (
            <GraphViewer
              data={graphData}
              onNodeHover={setHoveredNode}
              onNodeClick={setSelectedNode}
              selectedNode={selectedNode}
            />
          )}
          
          {/* Orbit controls */}
          <OrbitControls
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={20}
            maxDistance={300}
            dampingFactor={0.05}
            rotateSpeed={0.5}
          />
        </Suspense>
      </Canvas>

      {/* UI Overlay */}
      <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none">
        {/* Header */}
        <div className="absolute top-4 left-4 pointer-events-auto">
          <h1 className="text-2xl font-bold text-white/90">Social Graph</h1>
          <p className="text-sm text-white/60">
            {useDemoData ? 'Demo Mode' : 'Network Atlas'}
          </p>
        </div>

        {/* Timeframe selector */}
        <div className="absolute top-4 right-4 flex gap-2 pointer-events-auto">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => setTimeframe(days)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                timeframe === days
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              {days}d
            </button>
          ))}
        </div>

        {/* Stats panel */}
        <StatsPanel
          graphData={graphData}
          apiStats={stats}
          loading={loading}
        />

        {/* Timeline controls */}
        <TimelineSlider
          frames={frames}
          currentIndex={currentFrameIndex}
          isPlaying={isPlaying}
          speed={playbackSpeed}
          onIndexChange={(index) => {
            setIsPlaying(false);
            setCurrentFrameIndex(index);
          }}
          onTogglePlay={handleTogglePlay}
          onSpeedChange={setPlaybackSpeed}
        />

        {/* Loading indicator */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-white/70">Loading graph...</p>
            </div>
          </div>
        )}

        {/* Tooltip */}
        {hoveredNode && (
          <NodeTooltip node={hoveredNode} position={mousePos} />
        )}

        {/* Selected node panel */}
        {selectedNode && (
          <div className="absolute bottom-4 right-4 w-80 bg-black/80 backdrop-blur-sm rounded-xl p-4 pointer-events-auto border border-white/10">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  @{selectedNode.handle || selectedNode.id}
                </h3>
                <p className="text-sm text-white/60">{selectedNode.name}</p>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-white/50 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-white/50">Followers</p>
                <p className="text-white font-medium">
                  {selectedNode.followers.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-white/50">Community</p>
                <p className="text-white font-medium">#{selectedNode.community}</p>
              </div>
              <div>
                <p className="text-white/50">Importance</p>
                <p className="text-white font-medium">
                  {(selectedNode.importance * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-white/50">Status</p>
                <p className={`font-medium ${selectedNode.isNew ? 'text-green-400' : 'text-white'}`}>
                  {selectedNode.isNew ? '✨ New' : 'Existing'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 text-xs text-white/40 pointer-events-none">
        <p>Drag to rotate • Scroll to zoom • Click node to inspect</p>
      </div>
    </div>
  );
}
