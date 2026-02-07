import { PersonNode, GraphEvent } from '../types/graph'
import { VISUAL_CONFIG, edgeRgba } from '../lib/config'

interface NodeDrawerProps {
  node: PersonNode
  mainId: string
  events: GraphEvent[]
  allEvents?: GraphEvent[]
  windowLabel?: string
  windowStat?: { score?: number; deltaScore?: number; inbound?: number; outbound?: number; count?: number } | null
  firstInteractionTs?: string | null
  onClose: () => void
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  })
}

function fmtNum(n: number | null | undefined): string {
  const v = Number(n || 0)
  if (!Number.isFinite(v)) return '0'
  if (v >= 1000) return v.toFixed(0)
  if (v >= 100) return v.toFixed(1)
  return v.toFixed(2)
}

export function NodeDrawer({ node, mainId, events, allEvents, windowLabel, windowStat, firstInteractionTs, onClose }: NodeDrawerProps) {
  const avatarUrl = node.local_avatar_path || node.profile_image_url

  function summarize(list: GraphEvent[]): { total: number; inbound: number; outbound: number; byType: Record<string, number> } {
    const out = { total: 0, inbound: 0, outbound: 0, byType: {} as Record<string, number> }
    for (const evt of list) {
      if (!evt) continue
      out.total += 1
      if (evt.source === mainId) out.outbound += 1
      else if (evt.target === mainId) out.inbound += 1
      const t = String(evt.type || 'unknown')
      out.byType[t] = (out.byType[t] || 0) + 1
    }
    return out
  }

  const windowSummary = summarize(events)
  const allSummary = allEvents && allEvents.length ? summarize(allEvents) : null
  const lastWindowTs = events.length ? events[0].ts : null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: '360px',
        zIndex: 250,
        background: 'rgba(255,255,255,0.96)',
        borderLeft: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
        boxShadow: '-12px 0 30px rgba(0, 0, 0, 0.08)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column'
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: '14px 14px 12px 14px',
          borderBottom: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 999,
            background: '#f3f4f6',
            border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
            overflow: 'hidden',
            flex: '0 0 auto'
          }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={node.username}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : null}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: VISUAL_CONFIG.textPrimary,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {node.display_name}
          </div>
          <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
            @{node.username}
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            borderRadius: 10,
            border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
            background: '#fff',
            cursor: 'pointer',
            padding: '8px 10px',
            fontSize: 12,
            color: VISUAL_CONFIG.textSecondary
          }}
        >
          Close
        </button>
      </div>

      <div style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div
            style={{
              border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
              borderRadius: 12,
              padding: 10,
              background: '#fff'
            }}
          >
            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>
              Followers
            </div>
            <div style={{ fontSize: 14, color: VISUAL_CONFIG.textPrimary, fontWeight: 700 }}>
              {Number(node.followers || 0).toLocaleString()}
            </div>
          </div>

          <div
            style={{
              border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
              borderRadius: 12,
              padding: 10,
              background: '#fff'
            }}
          >
            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>
              Connections
            </div>
            <div style={{ fontSize: 14, color: VISUAL_CONFIG.textPrimary, fontWeight: 700 }}>
              {Number(node.degree || 0).toLocaleString()}
            </div>
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
            borderRadius: 12,
            padding: 10,
            background: '#fff'
          }}
        >
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              First seen: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 600 }}>{fmtDate(node.first_seen)}</span>
            </div>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Last seen: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 600 }}>{fmtDate(node.last_seen)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Outbound: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 700 }}>{Number(node.outbound_count || 0)}</span>
            </div>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Inbound: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 700 }}>{Number(node.inbound_count || 0)}</span>
            </div>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Total: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 700 }}>{Number(node.interaction_count || 0)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Strength: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{fmtNum(node.strength)}</span>
            </div>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Out: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{fmtNum(node.outbound_strength)}</span>
            </div>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              In: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{fmtNum(node.inbound_strength)}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
            borderRadius: 12,
            padding: 10,
            background: '#fff'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: VISUAL_CONFIG.textPrimary }}>
              Evidence
            </div>
            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
              {windowLabel || 'Window'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Events: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{windowSummary.total}</span>
            </div>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Out: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{windowSummary.outbound}</span>
            </div>
            <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              In: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{windowSummary.inbound}</span>
            </div>
            {allSummary ? (
              <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
                All-time: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{allSummary.total}</span>
              </div>
            ) : null}
          </div>

          {windowStat ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
                Score:{' '}
                <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 900 }}>
                  {fmtNum(windowStat.score)}
                </span>
                {typeof windowStat.deltaScore === 'number' && windowStat.deltaScore !== 0 ? (
                  <span style={{ marginLeft: 8, color: windowStat.deltaScore > 0 ? '#16a34a' : '#dc2626', fontWeight: 900 }}>
                    {windowStat.deltaScore > 0 ? '+' : ''}
                    {fmtNum(windowStat.deltaScore)}
                  </span>
                ) : null}
              </div>
              {firstInteractionTs ? (
                <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
                  First: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 700 }}>{fmtDate(firstInteractionTs)}</span>
                </div>
              ) : null}
              {lastWindowTs ? (
                <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
                  Last: <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 700 }}>{fmtDate(lastWindowTs)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            {Object.entries(windowSummary.byType)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([t, c]) => (
                <div
                  key={t}
                  style={{
                    fontSize: 11,
                    color: VISUAL_CONFIG.textSecondary,
                    border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                    borderRadius: 999,
                    padding: '4px 8px',
                    background: '#fff',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center'
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: edgeRgba(t, 0.9), display: 'inline-block' }} />
                  <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{c}</span>
                  <span>{t}</span>
                </div>
              ))}
          </div>

          {allSummary ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>All-time mix</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {Object.entries(allSummary.byType)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([t, c]) => (
                    <div
                      key={`all:${t}`}
                      style={{
                        fontSize: 11,
                        color: VISUAL_CONFIG.textSecondary,
                        border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                        borderRadius: 999,
                        padding: '4px 8px',
                        background: '#fff',
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center'
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: edgeRgba(t, 0.9), display: 'inline-block' }} />
                      <span style={{ color: VISUAL_CONFIG.textPrimary, fontWeight: 800 }}>{c}</span>
                      <span>{t}</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 14px 14px 14px' }}>
        {events.length === 0 ? (
          <div
            style={{
              border: `1px dashed ${VISUAL_CONFIG.tooltipBorder}`,
              borderRadius: 12,
              padding: 12,
              color: VISUAL_CONFIG.textSecondary,
              fontSize: 12
            }}
          >
            No events available for this node.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {events.map((evt, idx) => {
              const outbound = evt.source === mainId
              const label = outbound ? 'You ->' : '<- You'
              const ts = fmtDate(evt.ts)
              const text = (evt.text || '').trim()

              return (
                <a
                  key={`${evt.id || ''}:${idx}`}
                  href={evt.url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'block',
                    textDecoration: 'none',
                    border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                    borderRadius: 12,
                    padding: 10,
                    background: '#fff'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: VISUAL_CONFIG.textPrimary }}>
                      {label} {evt.type}
                    </div>
                    <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>{ts}</div>
                  </div>

                  {text ? (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        color: VISUAL_CONFIG.textSecondary,
                        lineHeight: 1.35
                      }}
                    >
                      {text}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: edgeRgba(evt.type, 0.9)
                      }}
                    />
                    <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
                      {evt.url ? 'Open tweet' : 'No link'}
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
