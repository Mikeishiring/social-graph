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
      <div className="bg-gray-900/95 backdrop-blur-sm rounded-lg shadow-xl border border-white/10 p-3 min-w-[200px]">
        <div className="flex items-center gap-3 mb-2">
          {node.avatar ? (
            <img
              src={node.avatar}
              alt={node.handle || 'User'}
              className="w-10 h-10 rounded-full"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
              {(node.handle || node.id)[0].toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-semibold text-white">
              @{node.handle || node.id.slice(0, 12)}
            </p>
            {node.name && (
              <p className="text-sm text-white/60">{node.name}</p>
            )}
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-white/50">Followers</p>
            <p className="text-white font-medium">
              {node.followers.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-white/50">Community</p>
            <p className="text-white font-medium">#{node.community}</p>
          </div>
          <div>
            <p className="text-white/50">Importance</p>
            <p className="text-white font-medium">
              {(node.importance * 100).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-white/50">Status</p>
            <p className={`font-medium ${node.isNew ? 'text-green-400' : 'text-white/70'}`}>
              {node.isNew ? '✨ New' : 'Member'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
