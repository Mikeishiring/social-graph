import { useEffect, useMemo, useState, useCallback } from 'react';
import type { FrameSummary, PostMarker } from '../types';

interface TimelineSliderProps {
  frames: FrameSummary[];
  posts: PostMarker[];
  selectedPostId: string | null;
  currentIndex: number;
  isPlaying: boolean;
  speed: number;
  onIndexChange: (index: number) => void;
  onPostSelect: (post: PostMarker) => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4];

function formatTimestamp(timestamp: string | undefined) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatShortDate(timestamp: string | undefined) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function TimelineSlider({
  frames,
  posts,
  selectedPostId,
  currentIndex,
  isPlaying,
  speed,
  onIndexChange,
  onPostSelect,
  onTogglePlay,
  onSpeedChange,
}: TimelineSliderProps) {
  const hasFrames = frames.length > 0;
  const hasPosts = posts.length > 0;
  const currentFrame = hasFrames ? frames[currentIndex] : null;
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const [activePostIndex, setActivePostIndex] = useState(0);

  const frameIndexByInterval = useMemo(() => {
    const map = new Map<number, number>();
    frames.forEach((frame, index) => {
      map.set(frame.interval_id, index);
    });
    return map;
  }, [frames]);

  const markerPoints = useMemo(() => {
    if (!hasPosts || frames.length === 0) return [];
    const grouped = new Map<number, PostMarker[]>();
    posts.forEach((post) => {
      const frameIndex = frameIndexByInterval.get(post.interval_id) ?? 0;
      const bucket = grouped.get(frameIndex) ?? [];
      bucket.push(post);
      grouped.set(frameIndex, bucket);
    });

    const points: Array<{ posts: PostMarker[]; percent: number; primary: PostMarker; groupKey: string }> = [];

    grouped.forEach((groupPosts, frameIndex) => {
      const percent = frames.length > 1
        ? (frameIndex / (frames.length - 1)) * 100
        : 0;
      const sorted = [...groupPosts].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      const primary = sorted[sorted.length - 1];
      points.push({ posts: sorted, percent, primary, groupKey: String(frameIndex) });
    });

    return points;
  }, [frames.length, frameIndexByInterval, hasPosts, posts]);

  const postsByGroupKey = useMemo(() => {
    const map = new Map<string, PostMarker[]>();
    markerPoints.forEach((point) => {
      map.set(point.groupKey, point.posts);
    });
    return map;
  }, [markerPoints]);

  const openPosts = openGroupKey ? (postsByGroupKey.get(openGroupKey) ?? []) : [];

  // Step forward/backward functions
  const stepForward = useCallback(() => {
    if (!hasFrames) return;
    onIndexChange(Math.min(currentIndex + 1, frames.length - 1));
  }, [currentIndex, frames.length, hasFrames, onIndexChange]);

  const stepBackward = useCallback(() => {
    if (!hasFrames) return;
    onIndexChange(Math.max(currentIndex - 1, 0));
  }, [currentIndex, hasFrames, onIndexChange]);

  const jumpToStart = useCallback(() => {
    if (!hasFrames) return;
    onIndexChange(0);
  }, [hasFrames, onIndexChange]);

  const jumpToEnd = useCallback(() => {
    if (!hasFrames) return;
    onIndexChange(frames.length - 1);
  }, [frames.length, hasFrames, onIndexChange]);

  // Keyboard shortcuts for timeline control
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === ' ' && !openGroupKey) {
        event.preventDefault();
        onTogglePlay();
        return;
      }
      if (event.key === 'ArrowRight' && !openGroupKey) {
        event.preventDefault();
        stepForward();
        return;
      }
      if (event.key === 'ArrowLeft' && !openGroupKey) {
        event.preventDefault();
        stepBackward();
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        jumpToStart();
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        jumpToEnd();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jumpToEnd, jumpToStart, onTogglePlay, openGroupKey, stepBackward, stepForward]);

  useEffect(() => {
    if (!openGroupKey) return;
    setActivePostIndex(0);
  }, [openGroupKey]);

  useEffect(() => {
    if (!openGroupKey || openPosts.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenGroupKey(null);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActivePostIndex((prev) => (prev + 1) % openPosts.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActivePostIndex((prev) => (prev - 1 + openPosts.length) % openPosts.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const selected = openPosts[activePostIndex];
        if (selected) {
          onPostSelect(selected);
          setOpenGroupKey(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePostIndex, onPostSelect, openGroupKey, openPosts]);

  const densityBars = useMemo(() => {
    if (frames.length === 0) return [];
    const counts = Array(frames.length).fill(0);
    posts.forEach((post) => {
      const frameIndex = frameIndexByInterval.get(post.interval_id) ?? 0;
      if (counts[frameIndex] !== undefined) {
        counts[frameIndex] += 1;
      }
    });
    const maxCount = Math.max(...counts, 1);
    return counts.map((count) => ({
      count,
      intensity: count / maxCount,
    }));
  }, [frames.length, frameIndexByInterval, posts]);

  const growthBars = useMemo(() => {
    if (frames.length === 0) return [];
    const newCounts = frames.map((frame) => frame.new_followers_count ?? 0);
    const lostCounts = frames.map((frame) => frame.lost_followers_count ?? 0);
    const maxNew = Math.max(...newCounts, 1);
    const maxLost = Math.max(...lostCounts, 1);
    return frames.map((frame, index) => ({
      index,
      newCount: newCounts[index] ?? 0,
      lostCount: lostCounts[index] ?? 0,
      newIntensity: (newCounts[index] ?? 0) / maxNew,
      lostIntensity: (lostCounts[index] ?? 0) / maxLost,
    }));
  }, [frames]);

  // Node/edge count for current frame
  const nodeCount = currentFrame?.node_count ?? 0;
  const edgeCount = currentFrame?.edge_count ?? 0;
  const newFollowers = currentFrame?.new_followers_count ?? 0;
  const lostFollowers = currentFrame?.lost_followers_count ?? 0;

  useEffect(() => {
    if (!openGroupKey) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        setOpenGroupKey(null);
        return;
      }

      const group = target.closest('[data-post-group-key]');
      if (!group || group.getAttribute('data-post-group-key') !== openGroupKey) {
        setOpenGroupKey(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openGroupKey]);

  // Progress percentage
  const progressPercent = hasFrames ? Math.round((currentIndex / Math.max(frames.length - 1, 1)) * 100) : 0;

  return (
    <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 w-[calc(100vw-2rem)] sm:w-[720px] max-w-[95vw] pointer-events-auto enter-rise enter-stagger-3 z-10">
      <div className="rounded-xl p-4 panel-surface">
        {/* Header with stats */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <p className="panel-title">Timeline</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                {nodeCount} nodes
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                {edgeCount} edges
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 font-mono">
                +{newFollowers}
              </span>
              <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-600 font-mono">
                -{lostFollowers}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">{progressPercent}%</span>
            <span className="text-[11px] text-slate-400">
              {hasFrames ? `${currentIndex + 1}/${frames.length}` : '--'}
            </span>
          </div>
        </div>

        {/* Main controls row */}
        <div className="flex items-center gap-3 mb-3">
          {/* Jump to start */}
          <button
            onClick={jumpToStart}
            disabled={!hasFrames || currentIndex === 0}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all text-sm ${
              hasFrames && currentIndex > 0
                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                : 'bg-slate-50 text-slate-300 cursor-not-allowed'
            }`}
            title="Jump to start (Home)"
          >
            ⏮
          </button>

          {/* Step backward */}
          <button
            onClick={stepBackward}
            disabled={!hasFrames || currentIndex === 0}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all text-sm ${
              hasFrames && currentIndex > 0
                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                : 'bg-slate-50 text-slate-300 cursor-not-allowed'
            }`}
            title="Step backward (←)"
          >
            ◀
          </button>

          {/* Play/Pause */}
          <button
            onClick={onTogglePlay}
            disabled={!hasFrames}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              hasFrames
                ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-md'
                : 'bg-slate-100 text-slate-300 cursor-not-allowed'
            }`}
            aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>

          {/* Step forward */}
          <button
            onClick={stepForward}
            disabled={!hasFrames || currentIndex === frames.length - 1}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all text-sm ${
              hasFrames && currentIndex < frames.length - 1
                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                : 'bg-slate-50 text-slate-300 cursor-not-allowed'
            }`}
            title="Step forward (→)"
          >
            ▶
          </button>

          {/* Jump to end */}
          <button
            onClick={jumpToEnd}
            disabled={!hasFrames || currentIndex === frames.length - 1}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all text-sm ${
              hasFrames && currentIndex < frames.length - 1
                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                : 'bg-slate-50 text-slate-300 cursor-not-allowed'
            }`}
            title="Jump to end (End)"
          >
            ⏭
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Speed controls */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-1">Speed</span>
            {SPEED_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => onSpeedChange(option)}
                disabled={!hasFrames}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                  !hasFrames
                    ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
                    : speed === option
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {option === 0.5 ? '½' : option}x
              </button>
            ))}
          </div>
        </div>

        {/* Timeline scrubber */}
        <div className="relative mt-2">
          {/* Growth spikes */}
          {growthBars.length > 0 && (
            <div className="absolute inset-x-0 -top-9 h-4 flex items-end gap-[1px] pointer-events-none px-1">
              {growthBars.map((bar) => {
                const newHeight = Math.max(2, Math.round(10 * bar.newIntensity));
                const lostHeight = Math.max(1, Math.round(8 * bar.lostIntensity));
                const isCurrent = bar.index === currentIndex;
                return (
                  <div key={bar.index} className="flex-1 flex flex-col items-center justify-end gap-[1px]">
                    <span
                      className={`w-full rounded-t-sm transition-all ${
                        isCurrent ? 'bg-emerald-500' : 'bg-emerald-300'
                      }`}
                      style={{ height: `${newHeight}px`, opacity: isCurrent ? 1 : 0.6 }}
                    />
                    {bar.lostCount > 0 && (
                      <span
                        className={`w-full rounded-t-sm transition-all ${
                          isCurrent ? 'bg-rose-500' : 'bg-rose-300'
                        }`}
                        style={{ height: `${lostHeight}px`, opacity: isCurrent ? 0.9 : 0.5 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Density bars */}
          {densityBars.length > 0 && (
            <div className="absolute inset-x-0 -top-5 h-5 flex items-end gap-[1px] pointer-events-none px-1">
              {densityBars.map((bar, index) => {
                const height = Math.max(2, Math.round(16 * bar.intensity));
                const opacity = 0.25 + bar.intensity * 0.6;
                const isCurrentFrame = index === currentIndex;
                return (
                  <span
                    key={index}
                    className={`flex-1 rounded-t-sm transition-all ${
                      isCurrentFrame
                        ? 'bg-blue-500'
                        : 'bg-gradient-to-t from-blue-400 to-blue-200'
                    }`}
                    style={{
                      height: `${height}px`,
                      opacity: isCurrentFrame ? 1 : opacity,
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Custom slider track */}
          <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
            {/* Progress fill */}
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-100"
              style={{ width: `${progressPercent}%` }}
            />

            {/* Clickable track */}
            <input
              type="range"
              min={0}
              max={Math.max(frames.length - 1, 0)}
              value={hasFrames ? currentIndex : 0}
              onChange={(event) => onIndexChange(Number(event.target.value))}
              disabled={!hasFrames}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />

            {/* Thumb indicator */}
            {hasFrames && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-blue-500 rounded-full shadow-md pointer-events-none transition-all duration-100"
                style={{ left: `calc(${progressPercent}% - 8px)` }}
              />
            )}
          </div>

          {/* Post markers */}
          {markerPoints.length > 0 && (
            <div className="absolute inset-x-0 top-0 h-3 pointer-events-none">
              {markerPoints.map(({ posts: groupedPosts, percent, primary, groupKey }) => {
                const isSelected = selectedPostId
                  ? groupedPosts.some((post) => post.id === selectedPostId)
                  : false;
                const count = groupedPosts.length;
                const isOpen = openGroupKey === groupKey;
                const title = count > 1
                  ? `(${count} posts)\n${groupedPosts
                      .slice(0, 3)
                      .map((post) => `- ${post.text}`)
                      .join('\n')}${count > 3 ? '\n...' : ''}`
                  : groupedPosts[0]?.text ?? 'Post';

                return (
                  <div
                    key={primary.id}
                    className="absolute pointer-events-auto"
                    style={{
                      left: `${percent}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                    }}
                    data-post-group-key={groupKey}
                  >
                    <button
                      type="button"
                      className={`rounded-full border-2 border-white shadow-md pointer-events-auto transition-all relative ${
                        count > 1 ? 'w-4 h-4' : 'w-3 h-3'
                      } ${isSelected ? 'bg-blue-500 ring-2 ring-blue-200' : 'bg-amber-400 hover:bg-amber-500'}`}
                      onClick={() => {
                        if (count <= 1) {
                          onPostSelect(primary);
                          setOpenGroupKey(null);
                          return;
                        }
                        setOpenGroupKey((prev) => (prev === groupKey ? null : groupKey));
                      }}
                      title={title}
                      aria-label="View post attribution"
                    >
                      {count > 1 && (
                        <span className="absolute -top-2.5 -right-2.5 min-w-[1.2rem] h-[1.2rem] rounded-full bg-slate-700 text-[9px] font-bold text-white flex items-center justify-center">
                          {count}
                        </span>
                      )}
                    </button>
                    {isOpen && count > 1 && (
                      <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-72 panel-surface rounded-lg p-2 text-xs shadow-xl z-50">
                        <p className="panel-title mb-2">Posts at this frame</p>
                        <div className="space-y-1 max-h-48 overflow-auto">
                          {groupedPosts.map((post, index) => (
                            <button
                              key={post.id}
                              type="button"
                              className={`w-full text-left rounded-md px-2 py-1.5 transition ${
                                index === activePostIndex
                                  ? 'bg-blue-50 text-slate-800'
                                  : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                              }`}
                              onClick={() => {
                                onPostSelect(post);
                                setOpenGroupKey(null);
                              }}
                              title={post.text}
                            >
                              <span className="block truncate text-sm">{post.text}</span>
                              <span className="mt-1 flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                                <span>💬 {post.metrics.replies}</span>
                                <span>🔁 {post.metrics.reposts}</span>
                                <span>❤️ {post.metrics.likes}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom row - date range and post count */}
        <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>{formatShortDate(frames[0]?.created_at)}</span>
            <span className="text-slate-300">→</span>
            <span>{formatShortDate(frames[frames.length - 1]?.created_at)}</span>
          </div>
          <div className="flex items-center gap-4">
            {hasPosts && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                {posts.length} posts
              </span>
            )}
            <span className="text-slate-300">
              {formatTimestamp(currentFrame?.created_at)}
            </span>
          </div>
        </div>

        {/* Keyboard hints */}
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-slate-300">
          <span>Space: Play/Pause</span>
          <span>←→: Step</span>
          <span>Home/End: Jump</span>
        </div>
      </div>
    </div>
  );
}
