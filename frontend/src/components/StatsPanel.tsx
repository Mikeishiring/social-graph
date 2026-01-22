import type { GraphData, ApiStats } from '../types';

interface StatsPanelProps {
  graphData: GraphData | null;
  apiStats: ApiStats | null;
  loading: boolean;
}

export default function StatsPanel({ graphData, apiStats, loading }: StatsPanelProps) {
  if (loading) {
    return (
      <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm rounded-xl p-4 pointer-events-auto border border-white/10">
        <div className="flex items-center gap-2 text-white/60">
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Loading stats...
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm rounded-xl p-4 pointer-events-auto border border-white/10 min-w-[220px]">
      <h3 className="text-sm font-semibold text-white/80 mb-3 uppercase tracking-wide">
        Graph Statistics
      </h3>
      
      {graphData && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-white/50 text-xs">Nodes</p>
            <p className="text-white font-mono text-lg">
              {graphData.stats.nodeCount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-white/50 text-xs">Edges</p>
            <p className="text-white font-mono text-lg">
              {graphData.stats.edgeCount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-white/50 text-xs">Communities</p>
            <p className="text-white font-mono text-lg">
              {graphData.stats.communityCount}
            </p>
          </div>
          <div>
            <p className="text-white/50 text-xs">New Followers</p>
            <p className="text-green-400 font-mono text-lg">
              +{graphData.stats.newFollowers || 0}
            </p>
          </div>
        </div>
      )}

      {apiStats && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <h4 className="text-xs font-semibold text-white/60 mb-2 uppercase tracking-wide">
            Database
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-white/50">Total Accounts</p>
              <p className="text-white font-mono">
                {apiStats.total_accounts.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-white/50">Intervals</p>
              <p className="text-white font-mono">
                {apiStats.total_intervals}
              </p>
            </div>
            <div>
              <p className="text-white/50">Collection Runs</p>
              <p className="text-white font-mono">
                {apiStats.completed_runs}/{apiStats.total_runs}
              </p>
            </div>
            {apiStats.latest_snapshot && (
              <div>
                <p className="text-white/50">Latest Snapshot</p>
                <p className="text-white font-mono">
                  {new Date(apiStats.latest_snapshot.captured_at).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {!graphData && !apiStats && (
        <p className="text-white/50 text-sm">No data available</p>
      )}
    </div>
  );
}
