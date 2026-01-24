import type { GraphData, ApiStats } from '../types';

interface StatsPanelProps {
  graphData: GraphData | null;
  apiStats: ApiStats | null;
  loading: boolean;
}

export default function StatsPanel({ graphData, apiStats, loading }: StatsPanelProps) {
  if (loading) {
    return (
      <div className="absolute top-[7.75rem] left-3 sm:left-4 sm:top-auto sm:bottom-4 rounded-xl p-4 pointer-events-auto panel-surface enter-rise enter-stagger-2 w-[calc(100vw-1.5rem)] sm:w-auto z-20">
        <div className="flex items-center gap-2 text-slate-500">
          <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
          Loading stats...
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-[7.75rem] left-3 sm:left-4 sm:top-auto sm:bottom-4 rounded-xl p-4 pointer-events-auto panel-surface min-w-[220px] enter-rise enter-stagger-2 w-[calc(100vw-1.5rem)] sm:w-auto z-20">
      <h3 className="panel-title mb-3">
        Graph Statistics
      </h3>

      {graphData && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-400 text-xs">Nodes</p>
            <p className="text-slate-800 font-mono text-lg">
              {graphData.stats.nodeCount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-slate-400 text-xs">Edges</p>
            <p className="text-slate-800 font-mono text-lg">
              {graphData.stats.edgeCount.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-slate-400 text-xs">Communities</p>
            <p className="text-slate-800 font-mono text-lg">
              {graphData.stats.communityCount}
            </p>
          </div>
          <div>
            <p className="text-slate-400 text-xs">New Followers</p>
            <p className="text-emerald-600 font-mono text-lg">
              +{graphData.stats.newFollowers || 0}
            </p>
          </div>
        </div>
      )}

      {apiStats && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <h4 className="panel-title mb-2">
            Database
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-slate-400">Total Accounts</p>
              <p className="text-slate-700 font-mono">
                {apiStats.total_accounts.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Intervals</p>
              <p className="text-slate-700 font-mono">
                {apiStats.total_intervals}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Collection Runs</p>
              <p className="text-slate-700 font-mono">
                {apiStats.completed_runs}/{apiStats.total_runs}
              </p>
            </div>
            {apiStats.latest_snapshot && (
              <div>
                <p className="text-slate-400">Latest Snapshot</p>
                <p className="text-slate-700 font-mono">
                  {new Date(apiStats.latest_snapshot.captured_at).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {!graphData && !apiStats && (
        <p className="text-slate-400 text-sm">No data available</p>
      )}
    </div>
  );
}
