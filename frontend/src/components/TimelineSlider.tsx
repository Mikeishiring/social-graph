import type { FrameSummary } from '../types';

interface TimelineSliderProps {
  frames: FrameSummary[];
  currentIndex: number;
  isPlaying: boolean;
  speed: number;
  onIndexChange: (index: number) => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
}

const SPEED_OPTIONS = [1, 2, 4];

function formatTimestamp(timestamp: string | undefined) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export default function TimelineSlider({
  frames,
  currentIndex,
  isPlaying,
  speed,
  onIndexChange,
  onTogglePlay,
  onSpeedChange,
}: TimelineSliderProps) {
  const hasFrames = frames.length > 0;
  const currentFrame = hasFrames ? frames[currentIndex] : null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[640px] max-w-[90vw] pointer-events-auto">
      <div className="bg-black/70 backdrop-blur-sm border border-white/10 rounded-xl p-4">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onTogglePlay}
              disabled={!hasFrames}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                hasFrames
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                  : 'bg-white/10 text-white/40 cursor-not-allowed'
              }`}
              aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <div>
              <p className="text-xs text-white/50 uppercase tracking-wide">Interval</p>
              <p className="text-sm text-white">
                {hasFrames ? `${currentIndex + 1} / ${frames.length}` : 'No frames'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/50 uppercase tracking-wide">Captured</p>
            <p className="text-sm text-white">
              {formatTimestamp(currentFrame?.created_at)}
            </p>
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(frames.length - 1, 0)}
          value={hasFrames ? currentIndex : 0}
          onChange={(event) => onIndexChange(Number(event.target.value))}
          disabled={!hasFrames}
          className="w-full accent-indigo-500"
        />

        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-white/50">
            Interval ID: {currentFrame?.interval_id ?? '—'}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">Speed</span>
            {SPEED_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => onSpeedChange(option)}
                disabled={!hasFrames}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  !hasFrames
                    ? 'bg-white/5 text-white/30 cursor-not-allowed'
                    : speed === option
                      ? 'bg-white/90 text-black'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {option}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
