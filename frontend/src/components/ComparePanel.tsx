import type { FrameSummary, GraphNode } from '../types';

interface CompareSummary {
  added: number;
  lost: number;
  net: number;
  topNew: GraphNode[];
}

interface ComparePanelProps {
  frames: FrameSummary[];
  compareAIndex: number;
  compareBIndex: number;
  summary: CompareSummary | null;
  onSelectA: (index: number) => void;
  onSelectB: (index: number) => void;
}

function formatFrameLabel(frame: FrameSummary | undefined) {
  if (!frame) return '--';
  const timestamp = frame.interval_end_at ?? frame.created_at;
  if (!timestamp) return `Interval ${frame.interval_id}`;
  const date = new Date(timestamp);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} • #${frame.interval_id}`;
}

export default function ComparePanel({
  frames,
  compareAIndex,
  compareBIndex,
  summary,
  onSelectA,
  onSelectB,
}: ComparePanelProps) {
  if (frames.length === 0) return null;

  return (
    <div className="absolute bottom-28 right-3 sm:right-4 w-[calc(100vw-1.5rem)] sm:w-80 rounded-xl p-3 pointer-events-auto panel-surface enter-rise z-20">
      <div className="flex items-center justify-between">
        <p className="panel-title">Before / After</p>
        <span className="text-[10px] text-slate-400">Compare intervals</span>
      </div>

      <div className="mt-3 space-y-2 text-xs text-slate-600">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Before</span>
          <select
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            value={compareAIndex}
            onChange={(event) => onSelectA(Number(event.target.value))}
          >
            {frames.map((frame, index) => (
              <option key={frame.id} value={index}>
                {formatFrameLabel(frame)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">After</span>
          <select
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            value={compareBIndex}
            onChange={(event) => onSelectB(Number(event.target.value))}
          >
            {frames.map((frame, index) => (
              <option key={frame.id} value={index}>
                {formatFrameLabel(frame)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {summary ? (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">New nodes</span>
            <span className="font-mono text-emerald-600">+{summary.added}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Lost nodes</span>
            <span className="font-mono text-rose-600">-{summary.lost}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Net change</span>
            <span className="font-mono text-slate-700">{summary.net >= 0 ? '+' : ''}{summary.net}</span>
          </div>
          {summary.topNew.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-1">Top new</p>
              <div className="space-y-1">
                {summary.topNew.slice(0, 4).map((node) => (
                  <div key={node.id} className="flex items-center justify-between">
                    <span className="truncate">@{node.handle || node.id.slice(0, 8)}</span>
                    <span className="text-[10px] text-slate-400">{node.followers.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">Select two intervals to compare.</p>
      )}
    </div>
  );
}
