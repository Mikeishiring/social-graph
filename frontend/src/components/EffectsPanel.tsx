import { useState } from 'react';

interface EffectsPanelProps {
  orbitMode: boolean;
  trailsEnabled: boolean;
  heartbeatEnabled: boolean;
  personalityEnabled: boolean;
  onToggleOrbit: () => void;
  onToggleTrails: () => void;
  onToggleHeartbeat: () => void;
  onTogglePersonality: () => void;
}

interface EffectToggle {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  color: string;
}

/**
 * Panel for toggling visual effects on/off.
 * Collapsible UI in the bottom-left corner.
 */
export default function EffectsPanel({
  orbitMode,
  trailsEnabled,
  heartbeatEnabled,
  personalityEnabled,
  onToggleOrbit,
  onToggleTrails,
  onToggleHeartbeat,
  onTogglePersonality,
}: EffectsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  const effects: EffectToggle[] = [
    {
      id: 'orbit',
      label: 'Orbit Mode',
      description: 'Cinematic camera rotation',
      enabled: orbitMode,
      onToggle: onToggleOrbit,
      color: 'purple',
    },
    {
      id: 'trails',
      label: 'Constellation Trails',
      description: 'Sparkles during drag',
      enabled: trailsEnabled,
      onToggle: onToggleTrails,
      color: 'blue',
    },
    {
      id: 'heartbeat',
      label: 'Heartbeat Pulse',
      description: 'Ego node rhythm',
      enabled: heartbeatEnabled,
      onToggle: onToggleHeartbeat,
      color: 'red',
    },
    {
      id: 'personality',
      label: 'Node Personality',
      description: 'Gentle bob and sway',
      enabled: personalityEnabled,
      onToggle: onTogglePersonality,
      color: 'emerald',
    },
  ];

  const activeCount = effects.filter(e => e.enabled).length;

  return (
    <div className="absolute bottom-28 sm:bottom-24 left-3 sm:left-4 pointer-events-auto z-20">
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border shadow-sm ${
          isOpen
            ? 'bg-slate-800 border-slate-700 text-white'
            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
        title="Toggle effects panel"
      >
        <span className="text-sm">✨</span>
        <span>Effects</span>
        {!isOpen && activeCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 text-[10px] font-bold">
            {activeCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 left-0 w-64 rounded-xl panel-surface shadow-lg overflow-hidden enter-rise">
          <div className="p-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Visual Effects</h3>
              <span className="text-[10px] text-slate-400">
                {activeCount}/{effects.length} active
              </span>
            </div>
          </div>

          <div className="p-2 space-y-1">
            {effects.map(effect => (
              <button
                key={effect.id}
                onClick={effect.onToggle}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left ${
                  effect.enabled
                    ? 'bg-slate-100'
                    : 'hover:bg-slate-50'
                }`}
              >
                {/* Toggle indicator */}
                <div
                  className={`w-8 h-5 rounded-full relative transition-colors ${
                    effect.enabled ? `bg-${effect.color}-500` : 'bg-slate-200'
                  }`}
                  style={{
                    backgroundColor: effect.enabled
                      ? effect.color === 'purple' ? '#a855f7'
                        : effect.color === 'blue' ? '#3b82f6'
                        : effect.color === 'red' ? '#ef4444'
                        : '#10b981'
                      : '#e2e8f0'
                  }}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                      effect.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </div>

                {/* Label and description */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${
                    effect.enabled ? 'text-slate-800' : 'text-slate-500'
                  }`}>
                    {effect.label}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {effect.description}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Performance note */}
          <div className="px-3 py-2 bg-slate-50 border-t border-slate-100">
            <p className="text-[10px] text-slate-400">
              Disable effects for better performance on large graphs
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
