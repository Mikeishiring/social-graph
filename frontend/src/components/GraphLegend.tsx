import type { GraphData, GraphEdge } from '../types';
import { ACTION_COLORS, COMMUNITY_COLORS, EDGE_TYPE_LABELS } from '../graphTheme';

type EdgeFilterState = Record<GraphEdge['type'], boolean>;

interface GraphLegendProps {
  graphData: GraphData | null;
  edgeFilters: EdgeFilterState;
  activeCommunities: Set<number>;
  focusMode: boolean;
  hasSelectedPost: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onToggleEdge: (edgeType: GraphEdge['type']) => void;
  onToggleCommunity: (communityId: number) => void;
  onSelectAllCommunities: () => void;
  onToggleFocusMode: () => void;
}

export default function GraphLegend({
  graphData,
  edgeFilters,
  activeCommunities,
  focusMode,
  hasSelectedPost,
  isOpen = false,
  onClose,
  onToggleEdge,
  onToggleCommunity,
  onSelectAllCommunities,
  onToggleFocusMode,
}: GraphLegendProps) {
  if (!graphData) return null;

  const communities = Array.from(
    new Set(graphData.nodes.map((node) => node.community))
  ).sort((a, b) => a - b);
  const actionItems = [
    { key: 'reply', label: 'Reply' },
    { key: 'mention', label: 'Mention' },
    { key: 'quote', label: 'Quote' },
    { key: 'retweet', label: 'Repost' },
    { key: 'like', label: 'Like' },
  ] as const;
  const hasActions = Boolean(graphData.actions && graphData.actions.length > 0);
  const hasInferredActions = Boolean(graphData.actions?.some((action) => action.inferred));
  const activeCount = activeCommunities.size;
  const totalCount = communities.length;
  const visibilityClass = isOpen ? 'block' : 'hidden sm:block';

  return (
    <div className={`absolute top-[7.75rem] right-3 sm:right-4 left-3 sm:left-auto w-[calc(100vw-1.5rem)] sm:w-64 rounded-xl p-3 pointer-events-auto panel-surface enter-rise enter-stagger-2 max-h-[60vh] overflow-auto z-30 ${visibilityClass}`}>
      <div className="flex items-center justify-between">
        <p className="panel-title">Legend</p>
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              className="text-[10px] uppercase tracking-[0.2em] text-slate-400 hover:text-slate-600 sm:hidden"
              onClick={onClose}
            >
              Close
            </button>
          )}
          <button
            type="button"
            className="text-[10px] uppercase tracking-[0.2em] text-slate-400 hover:text-slate-600"
            onClick={onSelectAllCommunities}
          >
            Reset
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Active communities {activeCount}/{totalCount}
      </p>

      <div className="mt-3">
        <p className="panel-title mb-2">Edges</p>
        <div className="space-y-2">
          {(Object.keys(edgeFilters) as GraphEdge['type'][]).map((edgeType) => (
            <button
              key={edgeType}
              type="button"
              className={`flex items-center gap-2 text-xs transition ${
                edgeFilters[edgeType] ? 'text-slate-700 hover:text-slate-900' : 'text-slate-300'
              }`}
              onClick={() => onToggleEdge(edgeType)}
            >
              <span
                className="w-2.5 h-2.5 rounded-full border border-slate-300"
                style={{
                  backgroundColor: edgeFilters[edgeType]
                    ? '#94a3b8'
                    : 'transparent',
                }}
              />
              <span className={edgeFilters[edgeType] ? '' : 'line-through opacity-60'}>
                {EDGE_TYPE_LABELS[edgeType] ?? edgeType}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="panel-title mb-2">Communities</p>
        <div className="flex flex-wrap gap-2">
          {communities.map((communityId) => {
            const color = COMMUNITY_COLORS[communityId % COMMUNITY_COLORS.length];
            const isActive = activeCommunities.has(communityId);
            return (
              <button
                key={communityId}
                type="button"
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] transition border ${
                  isActive
                    ? 'bg-slate-100 border-slate-300 text-slate-700'
                    : 'bg-white border-slate-200 text-slate-300 line-through'
                }`}
                onClick={() => onToggleCommunity(communityId)}
              >
                <span
                  className="w-2 h-2 rounded-full border border-slate-300"
                  style={{ backgroundColor: isActive ? color : 'transparent' }}
                />
                #{communityId}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <p className="panel-title mb-2">Action Pings</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {actionItems.map((item) => (
            <div key={item.key} className="flex items-center gap-2 text-slate-600">
              <span
                className="w-2.5 h-2.5 rounded-full border border-slate-300"
                style={{ backgroundColor: ACTION_COLORS[item.key] ?? ACTION_COLORS.default }}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          {hasActions
            ? (hasInferredActions
              ? 'Some pings are inferred when engagement data is missing.'
              : 'Pings reflect real engagement events.')
            : 'No action pings for this frame yet.'}
        </p>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-200">
        <button
          type="button"
          className={`w-full rounded-lg px-3 py-2 text-xs uppercase tracking-[0.2em] transition ${
            hasSelectedPost
              ? (focusMode ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
              : 'bg-slate-50 text-slate-300 cursor-not-allowed'
          }`}
          onClick={onToggleFocusMode}
          disabled={!hasSelectedPost}
        >
          Focus cluster {focusMode ? 'on' : 'off'}
        </button>
        <p className="text-[11px] text-slate-400 mt-2">
          Emphasizes attributed nodes when a post is selected.
        </p>
      </div>
    </div>
  );
}
