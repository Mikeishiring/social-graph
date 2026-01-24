import type { PostMarker } from '../types';

interface PostPanelProps {
  post: PostMarker;
  onClose: () => void;
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export default function PostPanel({ post, onClose }: PostPanelProps) {
  const totalAttributed = post.attribution.high + post.attribution.medium + post.attribution.low;

  return (
    <div className="absolute bottom-24 sm:bottom-4 right-4 left-4 sm:left-auto w-[calc(100vw-2rem)] sm:w-[360px] max-w-[90vw] rounded-xl p-4 pointer-events-auto panel-surface shadow-lg enter-rise z-20">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="panel-title">Post</p>
          <p className="text-sm text-slate-700">{formatTimestamp(post.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          {post.is_mock && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-amber-700">
              Mock
            </span>
          )}
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close post panel"
          >
            x
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-700 leading-relaxed">{post.text}</p>

      <div className="mt-3">
        <p className="panel-title">Metrics</p>
        <div className="grid grid-cols-2 gap-3 text-xs mt-2">
        <div>
          <p className="text-slate-400">Replies</p>
          <p className="text-slate-700 font-mono text-sm">{post.metrics.replies}</p>
        </div>
        <div>
          <p className="text-slate-400">Reposts</p>
          <p className="text-slate-700 font-mono text-sm">{post.metrics.reposts}</p>
        </div>
        <div>
          <p className="text-slate-400">Likes</p>
          <p className="text-slate-700 font-mono text-sm">{post.metrics.likes}</p>
        </div>
        <div>
          <p className="text-slate-400">Quotes</p>
          <p className="text-slate-700 font-mono text-sm">{post.metrics.quotes}</p>
        </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <p className="panel-title">Attribution</p>
          <p className="text-xs text-slate-500">Follower delta +{post.follower_delta}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs mt-2">
          <div>
            <p className="text-slate-400">High</p>
            <p className="text-emerald-600 font-mono text-sm">{post.attribution.high}</p>
          </div>
          <div>
            <p className="text-slate-400">Medium</p>
            <p className="text-amber-600 font-mono text-sm">{post.attribution.medium}</p>
          </div>
          <div>
            <p className="text-slate-400">Low</p>
            <p className="text-slate-600 font-mono text-sm">{post.attribution.low}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Attributed followers: {totalAttributed} across {post.community_ids.length} communities
        </p>
      </div>

      <div className="mt-3">
        <p className="panel-title">Evidence</p>
        <div className="mt-2 space-y-1 text-xs text-slate-600">
          {post.evidence.map((item) => (
            <p key={item}>- {item}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
