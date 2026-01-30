import { useMemo } from 'react';
import type { PostMarker } from '../types';

interface PostScoreboardProps {
  posts: PostMarker[];
  selectedPostId: string | null;
  onSelectPost: (post: PostMarker) => void;
}

function formatDate(timestamp: string | undefined) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PostScoreboard({
  posts,
  selectedPostId,
  onSelectPost,
}: PostScoreboardProps) {
  const topPosts = useMemo(() => {
    if (!posts.length) return [];
    return [...posts]
      .sort((a, b) => {
        const totalA = a.attribution.high + a.attribution.medium + a.attribution.low;
        const totalB = b.attribution.high + b.attribution.medium + b.attribution.low;
        return totalB - totalA;
      })
      .slice(0, 5);
  }, [posts]);

  return (
    <div className="absolute top-[7.75rem] right-3 sm:right-4 sm:top-[19rem] w-[calc(100vw-1.5rem)] sm:w-64 rounded-xl p-3 pointer-events-auto panel-surface enter-rise enter-stagger-3 z-20">
      <div className="flex items-center justify-between">
        <p className="panel-title">Top Growth Posts</p>
        <span className="text-[10px] text-slate-400">{topPosts.length} shown</span>
      </div>
      {topPosts.length === 0 ? (
        <p className="text-xs text-slate-400 mt-3">No post attribution data yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {topPosts.map((post, index) => {
            const total = post.attribution.high + post.attribution.medium + post.attribution.low;
            const isSelected = selectedPostId === post.id;
            return (
              <button
                key={post.id}
                type="button"
                onClick={() => onSelectPost(post)}
                className={`w-full text-left rounded-lg px-2.5 py-2 transition border ${
                  isSelected
                    ? 'bg-blue-50 border-blue-200 text-slate-800'
                    : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                    #{index + 1}
                  </span>
                  <span className="text-[10px] text-slate-400">{formatDate(post.created_at)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700 truncate">{post.text}</p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span className="text-emerald-600">+{total} followers</span>
                  <span>
                    Replies {post.metrics.replies} · Reposts {post.metrics.reposts} · Likes {post.metrics.likes}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
