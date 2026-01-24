import type { GraphNode } from '../types';

interface NodeTooltipProps {
  node: GraphNode;
  position: { x: number; y: number };
}

export default function NodeTooltip({ node, position }: NodeTooltipProps) {
  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: position.x + 15,
        top: position.y + 15,
        transform: 'translate(0, -50%)',
      }}
    >
      <div className="tooltip-content p-3 min-w-[200px] enter-fade">
        <div className="flex items-center gap-3 mb-2">
          {node.avatar ? (
            <img
              src={node.avatar}
              alt={node.handle || 'User'}
              className="w-10 h-10 rounded-full border-2 border-white shadow-sm"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center text-white font-bold shadow-sm">
              {(node.handle || node.id)[0].toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-semibold text-slate-800">
              @{node.handle || node.id.slice(0, 12)}
            </p>
            {node.name && (
              <p className="text-sm text-slate-500">{node.name}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-slate-400">Followers</p>
            <p className="text-slate-700 font-medium">
              {node.followers.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-slate-400">Community</p>
            <p className="text-slate-700 font-medium">#{node.community}</p>
          </div>
          <div>
            <p className="text-slate-400">Importance</p>
            <p className="text-slate-700 font-medium">
              {(node.importance * 100).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-slate-400">Status</p>
            <p className={`font-medium ${node.isNew ? 'text-emerald-600' : 'text-slate-500'}`}>
              {node.isNew ? 'New' : 'Member'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
