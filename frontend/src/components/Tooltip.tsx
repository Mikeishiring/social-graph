import { PersonNode } from '../types/graph'
import { VISUAL_CONFIG } from '../lib/config'

interface TooltipProps {
  node: PersonNode | null
  position: { x: number; y: number }
  windowLabel?: string
  windowStat?: { score?: number; deltaScore?: number; inbound?: number; outbound?: number; count?: number } | null
}

function fmtNum(n: number | null | undefined): string {
  const v = Number(n || 0)
  if (!Number.isFinite(v)) return '0'
  if (v >= 1000) return v.toFixed(0)
  if (v >= 100) return v.toFixed(1)
  return v.toFixed(2)
}

export function Tooltip({ node, position, windowLabel, windowStat }: TooltipProps) {
  if (!node) return null

  const score = windowStat?.score
  const delta = windowStat?.deltaScore

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x + 15,
        top: position.y + 15,
        background: VISUAL_CONFIG.tooltipBackground,
        border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        pointerEvents: 'none',
        zIndex: 1000,
        maxWidth: '280px'
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: '14px',
          color: VISUAL_CONFIG.textPrimary,
          marginBottom: '4px'
        }}
      >
        {node.display_name}
      </div>

      <div
        style={{
          fontSize: '13px',
          color: VISUAL_CONFIG.textSecondary,
          marginBottom: '8px'
        }}
      >
        @{node.username}
      </div>

      <div
        style={{
          display: 'flex',
          gap: '16px',
          fontSize: '12px',
          color: VISUAL_CONFIG.textSecondary
        }}
      >
        <div>
          <span style={{ fontWeight: 500, color: VISUAL_CONFIG.textPrimary }}>
            {node.followers.toLocaleString()}
          </span>{' '}
          followers
        </div>
        <div>
          <span style={{ fontWeight: 500, color: VISUAL_CONFIG.textPrimary }}>
            {node.degree}
          </span>{' '}
          connections
        </div>
      </div>

      {windowLabel && windowStat ? (
        <div style={{ marginTop: 10, fontSize: 12, color: VISUAL_CONFIG.textSecondary, display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>{windowLabel}</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontWeight: 700, color: VISUAL_CONFIG.textPrimary }}>{fmtNum(score)}</span>{' '}
              score
              {typeof delta === 'number' && delta !== 0 ? (
                <span style={{ marginLeft: 6, color: delta > 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                  {delta > 0 ? '+' : ''}
                  {fmtNum(delta)}
                </span>
              ) : null}
            </div>
            {typeof windowStat.inbound === 'number' || typeof windowStat.outbound === 'number' ? (
              <div>
                <span style={{ fontWeight: 700, color: VISUAL_CONFIG.textPrimary }}>
                  {Number(windowStat.outbound || 0)}
                </span>{' '}
                out /{' '}
                <span style={{ fontWeight: 700, color: VISUAL_CONFIG.textPrimary }}>
                  {Number(windowStat.inbound || 0)}
                </span>{' '}
                in
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {node.is_main_character && (
        <div
          style={{
            marginTop: '8px',
            fontSize: '11px',
            color: '#6366f1',
            fontWeight: 500
          }}
        >
          You
        </div>
      )}
    </div>
  )
}
