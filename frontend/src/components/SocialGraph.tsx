import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d'
import { forceCollide, forceX, forceY } from 'd3-force-3d'
import { BackButton } from './BackButton'
import { NodeDrawer } from './NodeDrawer'
import { Tooltip } from './Tooltip'
import { ForceGraphData, GraphData, GraphEdge, GraphEvent, GraphNode, PersonNode } from '../types/graph'
import { VISUAL_CONFIG, edgeRgba, getCommunityColor } from '../lib/config'
import { avatarCache, drawCircularAvatar, drawPlaceholder } from '../lib/avatarCache'

type LayoutMode = 'clusters' | 'onion' | 'timeline' | 'free'

interface SocialGraphProps {
  data: GraphData
  onBack: () => void
}

const DAY_MS = 24 * 60 * 60 * 1000

const EVENT_WEIGHT: Record<string, number> = {
  mentioned: 1.0,
  replied_to: 1.3,
  quoted: 1.1,
  followed: 2.0,
  liked: 0.7,
  retweeted: 0.9,
  posted: 0.2
}

function isPerson(n: GraphNode | null | undefined): n is PersonNode {
  return !!n && n.type === 'person'
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function hash01(input: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0) % 1000000) / 1000000
}

function edgeKey(source: string, target: string, type: string): string {
  return `${source}→${target}:${type}`
}

function datasetKey(data: GraphData, minMs: number, maxMs: number): string {
  const mc = data.main_character || 'main'
  const n = data.meta?.total_nodes ?? data.nodes.length
  const e = data.meta?.total_edges ?? data.edges.length
  return `${mc}|${n}|${e}|${minMs}|${maxMs}`
}

export function SocialGraph({ data, onBack }: SocialGraphProps) {
  const fgRef = useRef<ForceGraphMethods>()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('clusters')
  const [showCrossLinks, setShowCrossLinks] = useState(false)
  const [egoMode, setEgoMode] = useState(true)
  const [egoDepth, setEgoDepth] = useState<1 | 2 | 3 | 4>(2)
  const [showInactiveNodes, setShowInactiveNodes] = useState(false)
  const [minDegree, setMinDegree] = useState(0)
  const [minTieStrength, setMinTieStrength] = useState(0)
  const [enabledTypes, setEnabledTypes] = useState<Record<string, boolean>>({})

  const [hoveredNode, setHoveredNode] = useState<PersonNode | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const [selectedNode, setSelectedNode] = useState<PersonNode | null>(null)
  const [search, setSearch] = useState('')

  // Playback
  const events: GraphEvent[] = useMemo(() => data.events || [], [data.events])
  const [playMs, setPlayMs] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speedDaysPerSec, setSpeedDaysPerSec] = useState(7)
  const [windowDays, setWindowDays] = useState<number>(30)

  const mainId = data.main_character

  useEffect(() => {
    if (layoutMode !== 'onion') return
    // Onion needs outward edges; make sure we actually include outward layers by default.
    setEgoMode(true)
    setEgoDepth((d) => (d < 3 ? 3 : d))
  }, [layoutMode])

  const nodesById = useMemo(() => {
    const m = new Map<string, GraphNode>()
    for (const n of data.nodes) m.set(n.id, n)
    return m
  }, [data.nodes])

  const timeBounds = useMemo(() => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY

    for (const evt of events) {
      const ms = parseIsoMs(evt.ts)
      if (ms == null) continue
      if (ms < min) min = ms
      if (ms > max) max = ms
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      for (const n of data.nodes) {
        if (!isPerson(n)) continue
        const a = parseIsoMs(n.first_seen)
        const b = parseIsoMs(n.last_seen)
        if (a != null) {
          if (a < min) min = a
          if (a > max) max = a
        }
        if (b != null) {
          if (b < min) min = b
          if (b > max) max = b
        }
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const now = Date.now()
      return { min: now - 86400000, max: now }
    }

    // Avoid zero-width domains (slider breaks).
    if (min === max) max = min + 1
    return { min, max }
  }, [data.nodes, events])

  const layoutCacheKey = useMemo(() => {
    return `sg:layout:${layoutMode}:${datasetKey(data, timeBounds.min, timeBounds.max)}`
  }, [data, layoutMode, timeBounds.max, timeBounds.min])

  const isTypeEnabled = (t: string) => enabledTypes[t] ?? true

  const availableTypes = useMemo(() => {
    const set = new Set<string>()
    for (const e of data.edges || []) set.add(String(e.type || 'unknown'))
    for (const evt of events || []) set.add(String(evt.type || 'unknown'))
    set.delete('')
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b))
  }, [data.edges, events])

  useEffect(() => {
    // Ensure we never silently drop types just because they're new.
    setEnabledTypes(prev => {
      const next: Record<string, boolean> = { ...prev }
      for (const t of availableTypes) {
        if (!(t in next)) next[t] = true
      }
      return next
    })
  }, [availableTypes])

  const toggleType = (t: string) => {
    setEnabledTypes(prev => ({ ...prev, [t]: !(prev[t] ?? true) }))
  }

  useEffect(() => {
    // Initialize playback cursor on first render of dataset.
    setPlayMs(timeBounds.max)
  }, [timeBounds.max])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // '/' focuses search (common UX pattern).
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = document.activeElement
        const isTyping =
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLElement && el.isContentEditable)
        if (!isTyping) {
          e.preventDefault()
          searchRef.current?.focus()
        }
      }

      // Escape closes selection/drawer.
      if (e.key === 'Escape') {
        setSelectedNode(null)
        setHoveredNode(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const maxFollowers = useMemo(() => {
    let m = 1
    for (const n of data.nodes) {
      if (!isPerson(n)) continue
      m = Math.max(m, Number(n.followers || 0))
    }
    return m
  }, [data.nodes])

  const maxStrength = useMemo(() => {
    let m = 1
    for (const n of data.nodes) {
      if (!isPerson(n)) continue
      const v = Number(n.strength ?? n.interaction_count ?? 0)
      m = Math.max(m, v)
    }
    return m
  }, [data.nodes])

  const timeWindow = useMemo(() => {
    const end = playMs ?? timeBounds.max
    if (!Number.isFinite(end)) return { start: timeBounds.min, end: timeBounds.max, label: 'All time', days: 0 }
    if (windowDays <= 0) return { start: timeBounds.min, end, label: 'All time', days: 0 }
    const start = Math.max(timeBounds.min, end - windowDays * DAY_MS)
    return { start, end, label: `Last ${windowDays}d`, days: windowDays }
  }, [playMs, timeBounds.max, timeBounds.min, windowDays])

  const firstInteractionByOther = useMemo(() => {
    const m = new Map<string, number>()
    for (const evt of events) {
      if (!evt || !evt.ts) continue
      const ms = parseIsoMs(evt.ts)
      if (ms == null) continue
      if (evt.source !== mainId && evt.target !== mainId) continue
      if (!isTypeEnabled(String(evt.type || 'unknown'))) continue
      const other = evt.source === mainId ? evt.target : evt.source
      if (!other || other === mainId) continue
      const prev = m.get(other)
      if (prev == null || ms < prev) m.set(other, ms)
    }
    return m
  }, [enabledTypes, events, mainId])

  const windowStats = useMemo(() => {
    const end = timeWindow.end
    const start = timeWindow.start
    const hasPrevWindow = (timeWindow.days || 0) > 0
    const prevStart = hasPrevWindow ? Math.max(timeBounds.min, start - (timeWindow.days || 0) * DAY_MS) : start
    const prevEnd = start

    type Stat = {
      other: string
      score: number
      count: number
      inbound: number
      outbound: number
      typeCounts: Record<string, number>
      recent: GraphEvent[]
    }

    const curr = new Map<string, Stat>()
    const prev = new Map<string, { score: number; count: number }>()

    const pushEvt = (st: Stat, evt: GraphEvent) => {
      st.recent.push(evt)
      if (st.recent.length > 20) st.recent = st.recent.slice(0, 20)
    }

    for (const evt of events) {
      const ms = parseIsoMs(evt.ts)
      if (ms == null) continue
      if (evt.source !== mainId && evt.target !== mainId) continue
      if (!isTypeEnabled(String(evt.type || 'unknown'))) continue

      const other = evt.source === mainId ? evt.target : evt.source
      if (!other || other === mainId) continue

      const w = EVENT_WEIGHT[String(evt.type || '')] ?? 1.0
      const isOutbound = evt.source === mainId

      if (ms >= start && ms <= end) {
        let st = curr.get(other)
        if (!st) {
          st = { other, score: 0, count: 0, inbound: 0, outbound: 0, typeCounts: {}, recent: [] }
          curr.set(other, st)
        }
        st.score += w
        st.count += 1
        st.typeCounts[String(evt.type || 'unknown')] = (st.typeCounts[String(evt.type || 'unknown')] || 0) + 1
        if (isOutbound) st.outbound += 1
        else st.inbound += 1
        pushEvt(st, evt)
      } else if (hasPrevWindow && ms >= prevStart && ms < prevEnd) {
        const p = prev.get(other) || { score: 0, count: 0 }
        p.score += w
        p.count += 1
        prev.set(other, p)
      }
    }

    const rows = Array.from(curr.values()).map(r => {
      const p = prev.get(r.other) || { score: 0, count: 0 }
      return {
        ...r,
        prevScore: p.score,
        prevCount: p.count,
        deltaScore: hasPrevWindow ? r.score - p.score : 0
      }
    })

    rows.sort((a, b) => b.score - a.score)

    const activeTies = rows.length
    const strongest = rows.slice(0, 50).filter(r => r.score >= minTieStrength).slice(0, 8)
    const fastestGrowing = hasPrevWindow
      ? rows
          .filter(r => r.score >= minTieStrength && r.deltaScore > 0)
          .sort((a, b) => b.deltaScore - a.deltaScore)
          .slice(0, 8)
      : []
    const mostInbound = rows.slice(0, 50).sort((a, b) => b.inbound - a.inbound).slice(0, 8)
    const mostOutbound = rows.slice(0, 50).sort((a, b) => b.outbound - a.outbound).slice(0, 8)

    const newTies = rows
      .filter(r => {
        const first = firstInteractionByOther.get(r.other)
        return first != null && first >= start && first <= end
      })
      .sort((a, b) => (firstInteractionByOther.get(b.other) || 0) - (firstInteractionByOther.get(a.other) || 0))
      .slice(0, 8)

    const totals = rows.reduce(
      (acc, r) => {
        acc.score += r.score
        acc.count += r.count
        acc.inbound += r.inbound
        acc.outbound += r.outbound
        return acc
      },
      { score: 0, count: 0, inbound: 0, outbound: 0 }
    )

    const rowsByOther = new Map<string, any>()
    for (const r of rows) rowsByOther.set(r.other, r)

    return { strongest, fastestGrowing, mostInbound, mostOutbound, newTies, totals, activeTies, byOther: curr, rowsByOther }
  }, [
    enabledTypes,
    events,
    firstInteractionByOther,
    mainId,
    minTieStrength,
    timeBounds.min,
    timeWindow.days,
    timeWindow.end,
    timeWindow.start
  ])

  const maxWindowTieScore = useMemo(() => {
    let m = 1
    for (const v of windowStats.byOther.values()) m = Math.max(m, Number(v.score || 0))
    return m
  }, [windowStats.byOther])

  const nodeRadius = useMemo(() => {
    return (n: GraphNode): number => {
      if (!isPerson(n)) return VISUAL_CONFIG.minNodeSize
      if (n.is_main_character) return VISUAL_CONFIG.mainCharacterSize / 2

      const followersW = clamp01(Number(n.followers || 0) / maxFollowers)
      const tie = windowDays > 0 ? Number(windowStats.byOther.get(n.id)?.score || 0) : Number(n.strength ?? n.interaction_count ?? 0)
      const denom = windowDays > 0 ? maxWindowTieScore : maxStrength
      const strengthW = clamp01(denom <= 0 ? 0 : tie / denom)
      const score = 0.62 * followersW + 0.38 * strengthW
      const r = VISUAL_CONFIG.minNodeSize + (VISUAL_CONFIG.maxNodeSize - VISUAL_CONFIG.minNodeSize) * score
      return Math.max(VISUAL_CONFIG.minNodeSize, Math.min(VISUAL_CONFIG.maxNodeSize, r))
    }
  }, [maxFollowers, maxStrength, maxWindowTieScore, windowDays, windowStats.byOther])

  const visible = useMemo(() => {
    const play = playMs

    const filteredNodes: GraphNode[] = []
    for (const n of data.nodes) {
      if (isPerson(n)) {
        if (n.id !== mainId && Number(n.degree || 0) < minDegree) continue
        if (play != null) {
          const first = parseIsoMs(n.first_seen)
          if (first != null && first > play) continue
        }
        if (windowDays > 0 && !showInactiveNodes && n.id !== mainId) {
          // In ego-depth > 1, allow "outward" nodes even if they aren't directly active with you.
          if (!(egoMode && egoDepth > 1) && !windowStats.byOther.has(n.id)) continue
        }
      }
      filteredNodes.push(n)
    }

    const filteredNodeSet = new Set(filteredNodes.map(n => n.id))
    const edges: GraphEdge[] = []
    for (const e of data.edges) {
      const src = typeof e.source === 'string' ? e.source : e.source.id
      const tgt = typeof e.target === 'string' ? e.target : e.target.id
      if (!filteredNodeSet.has(src) || !filteredNodeSet.has(tgt)) continue
      if (!isTypeEnabled(String(e.type || 'unknown'))) continue
      if (layoutMode !== 'onion') {
        if (!showCrossLinks && src !== mainId && tgt !== mainId) continue
      }
      if (minTieStrength > 0 && (src === mainId || tgt === mainId)) {
        const other = src === mainId ? tgt : src
        const st = windowStats.byOther.get(other)
        if (!st || st.score < minTieStrength) continue
      }

      if (play != null) {
        const first = parseIsoMs(e.first_ts) ?? parseIsoMs(e.timestamp) ?? parseIsoMs(e.last_ts)
        if (first != null && first > play) continue
      }

      edges.push({ ...e, source: src, target: tgt })
    }

    if (!egoMode) return { nodes: filteredNodes, edges }

    // Ego-mode: keep only nodes within N hops from main (depth 1 or 2).
    const adj = new Map<string, Set<string>>()
    for (const e of edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id
      const t = typeof e.target === 'string' ? e.target : e.target.id
      if (!adj.has(s)) adj.set(s, new Set())
      if (!adj.has(t)) adj.set(t, new Set())
      adj.get(s)!.add(t)
      adj.get(t)!.add(s)
    }

    const keep = new Set<string>([mainId])
    let frontier = new Set<string>([mainId])
    for (let i = 0; i < egoDepth; i++) {
      const next = new Set<string>()
      for (const id of frontier) {
        const ns = adj.get(id)
        if (!ns) continue
        for (const nb of ns) {
          if (keep.has(nb)) continue
          keep.add(nb)
          next.add(nb)
        }
      }
      frontier = next
      if (frontier.size === 0) break
    }

    const nodes = filteredNodes.filter(n => keep.has(n.id))
    const nodeSet = new Set(nodes.map(n => n.id))
    const egoEdges = edges.filter(e => {
      const s = typeof e.source === 'string' ? e.source : e.source.id
      const t = typeof e.target === 'string' ? e.target : e.target.id
      return nodeSet.has(s) && nodeSet.has(t)
    })

    return { nodes, edges: egoEdges }
  }, [data.edges, data.nodes, egoDepth, egoMode, enabledTypes, layoutMode, mainId, minDegree, minTieStrength, playMs, showCrossLinks, showInactiveNodes, windowDays, windowStats.byOther])

  const onionInfo = useMemo(() => {
    const dist = new Map<string, number>()
    const parent = new Map<string, string | null>()
    if (layoutMode !== 'onion') return { dist, parent }

    const adj = new Map<string, Set<string>>()
    for (const e of visible.edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id
      const t = typeof e.target === 'string' ? e.target : e.target.id
      if (!adj.has(s)) adj.set(s, new Set())
      if (!adj.has(t)) adj.set(t, new Set())
      adj.get(s)!.add(t)
      adj.get(t)!.add(s)
    }

    const q: string[] = []
    dist.set(mainId, 0)
    parent.set(mainId, null)
    q.push(mainId)

    while (q.length) {
      const cur = q.shift() as string
      const d = dist.get(cur) || 0
      const ns = adj.get(cur)
      if (!ns) continue
      for (const nb of ns) {
        if (dist.has(nb)) continue
        dist.set(nb, d + 1)
        parent.set(nb, cur)
        q.push(nb)
      }
    }

    return { dist, parent }
  }, [layoutMode, mainId, visible.edges])

  const onionEdges = useMemo(() => {
    if (layoutMode !== 'onion') return visible.edges
    const dist = onionInfo.dist
    const wantAll = showCrossLinks

    const out: GraphEdge[] = []
    const seen = new Set<string>()

    const add = (e: GraphEdge) => {
      const s = typeof e.source === 'string' ? e.source : e.source.id
      const t = typeof e.target === 'string' ? e.target : e.target.id
      const key = `${s}|${t}|${String(e.type || 'unknown')}`
      if (seen.has(key)) return
      seen.add(key)
      out.push(e)
    }

    if (wantAll) {
      for (const e of visible.edges) add(e)
      return out
    }

    for (const e of visible.edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id
      const t = typeof e.target === 'string' ? e.target : e.target.id
      const ds = dist.get(s)
      const dt = dist.get(t)
      if (ds == null || dt == null) continue
      if (Math.abs(ds - dt) !== 1) continue
      add(e)
    }

    // Ensure we always show an onion "spine" (BFS tree), even if no edge passed the filter.
    for (const n of visible.nodes) {
      if (n.id === mainId) continue
      const p = onionInfo.parent.get(n.id)
      if (!p) continue
      const ds = dist.get(n.id)
      const dp = dist.get(p)
      if (ds == null || dp == null || Math.abs(ds - dp) !== 1) continue
      add({ source: p, target: n.id, type: 'bridge' })
    }

    return out
  }, [layoutMode, mainId, onionInfo.dist, onionInfo.parent, showCrossLinks, visible.edges, visible.nodes])

  const graphData: ForceGraphData = useMemo(() => {
    // Clone nodes so we can safely assign cached positions without mutating the original dataset.
    const nodes = visible.nodes.map(n => ({ ...n }))
    const links = onionEdges.map(e => ({ ...e }))
    return { nodes, links }
  }, [onionEdges, visible.nodes])

  const maxPrimaryEdgeWeight = useMemo(() => {
    let m = 1
    for (const e of onionEdges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id
      const t = typeof e.target === 'string' ? e.target : e.target.id
      if (s !== mainId && t !== mainId) continue
      const v = Number(e.weight ?? e.count ?? 0)
      if (Number.isFinite(v)) m = Math.max(m, v)
    }
    return m
  }, [mainId, onionEdges])

  const curvatureByEdgeKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of onionEdges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id
      const t = typeof e.target === 'string' ? e.target : e.target.id
      const type = String(e.type || 'unknown')
      const k = edgeKey(s, t, type)
      const primary = s === mainId || t === mainId
      const base = primary ? 0.18 : 0.10
      const amp = primary ? 0.22 : 0.14
      const h = hash01(k)
      const sign = h < 0.5 ? -1 : 1
      const curv = sign * (base + amp * hash01(`${k}:c`))
      m.set(k, Math.max(-0.6, Math.min(0.6, curv)))
    }
    return m
  }, [mainId, onionEdges])

  const adjacency = useMemo(() => {
    const neighbors = new Map<string, Set<string>>()
    for (const e of onionEdges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id
      const t = typeof e.target === 'string' ? e.target : e.target.id
      if (!neighbors.has(s)) neighbors.set(s, new Set())
      if (!neighbors.has(t)) neighbors.set(t, new Set())
      neighbors.get(s)!.add(t)
      neighbors.get(t)!.add(s)
    }
    return neighbors
  }, [onionEdges])

  const topTies = useMemo(() => {
    const main = nodesById.get(mainId)
    const ids = adjacency.get(mainId)
    if (!main || !ids) return []
    const res: PersonNode[] = []
    for (const id of ids) {
      const n = nodesById.get(id)
      if (isPerson(n)) res.push(n)
    }
    res.sort((a, b) => {
      const as = Number(a.strength ?? a.interaction_count ?? 0)
      const bs = Number(b.strength ?? b.interaction_count ?? 0)
      if (bs !== as) return bs - as
      return Number(b.followers || 0) - Number(a.followers || 0)
    })
    return res.slice(0, 12)
  }, [adjacency, mainId, nodesById])

  const strongestTies = useMemo(() => {
    const rows: Array<{ node: PersonNode; score: number; count: number }> = []
    for (const r of windowStats.strongest) {
      const n = nodesById.get(r.other)
      if (!isPerson(n)) continue
      rows.push({ node: n, score: Number(r.score || 0), count: Number(r.count || 0) })
    }

    // Fallback when there are no events available (or filters remove them).
    if (!rows.length) {
      for (const n of topTies) {
        const score = Number(n.strength ?? n.interaction_count ?? 0)
        rows.push({ node: n, score, count: Number(n.interaction_count || 0) })
      }
    }

    return rows.slice(0, 12)
  }, [nodesById, topTies, windowStats.strongest])

  const maxWindowScore = useMemo(() => {
    let m = 1
    for (const r of strongestTies) m = Math.max(m, Number(r.score || 0))
    return m
  }, [strongestTies])

  const eventsByOtherId = useMemo(() => {
    const m = new Map<string, GraphEvent[]>()
    if (!events.length) return m

    for (const evt of events) {
      if (evt.source !== mainId && evt.target !== mainId) continue
      if (!isTypeEnabled(String(evt.type || 'unknown'))) continue
      const other = evt.source === mainId ? evt.target : evt.source
      if (!m.has(other)) m.set(other, [])
      m.get(other)!.push(evt)
    }

    for (const [k, list] of m.entries()) {
      list.sort((a, b) => (parseIsoMs(b.ts) || 0) - (parseIsoMs(a.ts) || 0))
      m.set(k, list)
    }
    return m
  }, [enabledTypes, events, mainId])

  const windowEventsByOtherId = useMemo(() => {
    const m = new Map<string, GraphEvent[]>()
    if (!events.length) return m
    for (const evt of events) {
      if (evt.source !== mainId && evt.target !== mainId) continue
      if (!isTypeEnabled(String(evt.type || 'unknown'))) continue
      const ms = parseIsoMs(evt.ts)
      if (ms == null) continue
      if (ms < timeWindow.start || ms > timeWindow.end) continue
      const other = evt.source === mainId ? evt.target : evt.source
      if (!m.has(other)) m.set(other, [])
      m.get(other)!.push(evt)
    }
    for (const [k, list] of m.entries()) {
      list.sort((a, b) => (parseIsoMs(b.ts) || 0) - (parseIsoMs(a.ts) || 0))
      m.set(k, list)
    }
    return m
  }, [enabledTypes, events, mainId, timeWindow.end, timeWindow.start])

  const recentEdgeKeys = useMemo(() => {
    const set = new Set<string>()
    const play = playMs
    if (!events.length || play == null) return set

    const windowStart = play - VISUAL_CONFIG.playbackRecentEdgeMs
    for (const evt of events) {
      const ms = parseIsoMs(evt.ts)
      if (ms == null) continue
      if (ms < windowStart || ms > play) continue
      if (!isTypeEnabled(String(evt.type || 'unknown'))) continue
      if (layoutMode !== 'onion') {
        if (!showCrossLinks && evt.source !== mainId && evt.target !== mainId) continue
      }
      set.add(edgeKey(evt.source, evt.target, evt.type))
    }
    return set
  }, [enabledTypes, events, layoutMode, mainId, playMs, showCrossLinks])

  useEffect(() => {
    // Preload avatars for smoother node rendering.
    avatarCache.preload(graphData.nodes).catch(() => undefined)
  }, [graphData.nodes])

  useEffect(() => {
    // Restore cached layout positions to stabilize the mental map across reloads.
    try {
      const raw = window.localStorage.getItem(layoutCacheKey)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, { x: number; y: number }>
      if (!obj || typeof obj !== 'object') return
      for (const n of graphData.nodes) {
        const p = obj[n.id]
        if (!p) continue
        ;(n as any).x = p.x
        ;(n as any).y = p.y
      }
    } catch {
      // ignore
    }
  }, [graphData.nodes, layoutCacheKey])

  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return

    // Make the main node stable (center anchor).
    const main = graphData.nodes.find(n => n.id === mainId)
    if (main && isPerson(main)) {
      main.fx = 0
      main.fy = 0
    }

    fg.d3Force(
      'collide',
      forceCollide((n: any) => {
        const gn = n as GraphNode
        return nodeRadius(gn) + VISUAL_CONFIG.collisionPadding
      })
    )

    // Link distance: short to main, longer for cross-links.
    const linkForce: any = fg.d3Force('link')
    if (linkForce && typeof linkForce.distance === 'function') {
      linkForce.distance((l: any) => {
        const s = typeof l.source === 'string' ? l.source : l.source.id
        const t = typeof l.target === 'string' ? l.target : l.target.id
        const isPrimary = s === mainId || t === mainId
        return isPrimary ? VISUAL_CONFIG.linkDistance : VISUAL_CONFIG.linkDistanceSecondary
      })
    }

    if (layoutMode === 'free') {
      fg.d3Force('x', null)
      fg.d3Force('y', null)
    } else if (layoutMode === 'clusters') {
      const communityIds = new Set<number>()
      const sizes = new Map<number, number>()
      for (const n of graphData.nodes) {
        if (isPerson(n) && !n.is_main_character) {
          const cid = n.community_id || 0
          communityIds.add(cid)
          sizes.set(cid, (sizes.get(cid) || 0) + 1)
        }
      }
      const list = Array.from(communityIds.values()).sort((a, b) => (sizes.get(b) || 0) - (sizes.get(a) || 0))
      const centers = new Map<number, { x: number; y: number }>()
      const base = Math.max(140, Math.min(260, VISUAL_CONFIG.clusterRingRadius))
      const golden = Math.PI * (3 - Math.sqrt(5))
      for (let i = 0; i < list.length; i++) {
        // Spiral placement feels more "neural" than a perfect ring.
        const r = base * Math.sqrt(i + 1)
        const a = (i + 1) * golden
        const jitter = (hash01(`comm:${list[i]}`) - 0.5) * base * 0.35
        centers.set(list[i], { x: Math.cos(a) * r + jitter, y: Math.sin(a) * r - jitter })
      }

      fg.d3Force(
        'x',
        forceX((n: any) => {
          const gn = n as GraphNode
          if (!isPerson(gn)) return 0
          if (gn.is_main_character) return 0
          const c = centers.get(gn.community_id || 0)
          return c ? c.x : 0
        }).strength(VISUAL_CONFIG.clusterStrength)
      )
      fg.d3Force(
        'y',
        forceY((n: any) => {
          const gn = n as GraphNode
          if (!isPerson(gn)) return 0
          if (gn.is_main_character) return 0
          const c = centers.get(gn.community_id || 0)
          return c ? c.y : 0
        }).strength(VISUAL_CONFIG.clusterStrength)
      )
    } else if (layoutMode === 'onion') {
      const dist = onionInfo.dist
      const parent = onionInfo.parent

      // Deterministic angles for the first ring, then "branch" from parent angles.
      const layer1: PersonNode[] = []
      for (const n of graphData.nodes) {
        if (!isPerson(n) || n.is_main_character) continue
        if ((dist.get(n.id) || 999) === 1) layer1.push(n)
      }

      // Group layer-1 by community so it still reads as clusters, but radially layered.
      const byComm = new Map<number, PersonNode[]>()
      for (const n of layer1) {
        const cid = n.community_id || 0
        if (!byComm.has(cid)) byComm.set(cid, [])
        byComm.get(cid)!.push(n)
      }

      const comms = Array.from(byComm.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .map(([cid]) => cid)

      const angleById = new Map<string, number>()
      angleById.set(mainId, 0)

      const total = layer1.length || 1
      let cursor = -Math.PI * 0.5
      for (const cid of comms) {
        const list = byComm.get(cid) || []
        list.sort((a, b) => a.id.localeCompare(b.id))
        const span = (list.length / total) * Math.PI * 2
        for (let i = 0; i < list.length; i++) {
          const base = cursor + ((i + 0.5) / Math.max(1, list.length)) * span
          const jitter = (hash01(`a:${list[i].id}`) - 0.5) * 0.28
          angleById.set(list[i].id, base + jitter)
        }
        cursor += span
      }

      // For deeper layers, anchor around parent.
      for (const n of graphData.nodes) {
        if (!isPerson(n) || n.is_main_character) continue
        const d = dist.get(n.id)
        if (d == null || d <= 1) continue
        const p = parent.get(n.id)
        const pa = p ? angleById.get(p) : undefined
        const spread = 0.70 / Math.max(1, d)
        const jitter = (hash01(`b:${n.id}`) - 0.5) * spread
        angleById.set(n.id, (pa ?? 0) + jitter)
      }

      const layerGap = 150
      const baseR = 120

      fg.d3Force(
        'x',
        forceX((n: any) => {
          const gn = n as GraphNode
          if (!isPerson(gn)) return 0
          if (gn.is_main_character) return 0
          const d = dist.get(gn.id) ?? 1
          const a = angleById.get(gn.id) ?? 0
          const jitter = (hash01(`r:${gn.id}`) - 0.5) * 22
          const r = baseR + d * layerGap + jitter
          return Math.cos(a) * r
        }).strength(0.18)
      )
      fg.d3Force(
        'y',
        forceY((n: any) => {
          const gn = n as GraphNode
          if (!isPerson(gn)) return 0
          if (gn.is_main_character) return 0
          const d = dist.get(gn.id) ?? 1
          const a = angleById.get(gn.id) ?? 0
          const jitter = (hash01(`r:${gn.id}`) - 0.5) * 22
          const r = baseR + d * layerGap + jitter
          return Math.sin(a) * r
        }).strength(0.18)
      )
    } else if (layoutMode === 'timeline') {
      const span = timeBounds.max - timeBounds.min
      const angleByCommunity = new Map<number, number>()
      const communityIds = new Set<number>()
      for (const n of graphData.nodes) {
        if (isPerson(n) && !n.is_main_character) communityIds.add(n.community_id || 0)
      }
      const list = Array.from(communityIds.values()).sort((a, b) => a - b)
      for (let i = 0; i < list.length; i++) {
        angleByCommunity.set(list[i], (i / Math.max(1, list.length)) * Math.PI * 2)
      }

      fg.d3Force(
        'x',
        forceX((n: any) => {
          const gn = n as GraphNode
          if (!isPerson(gn)) return 0
          if (gn.is_main_character) return 0
          const first = parseIsoMs(gn.first_seen) ?? timeBounds.min
          const t = clamp01((first - timeBounds.min) / span)
          const r = VISUAL_CONFIG.timelineMinRadius + t * (VISUAL_CONFIG.timelineMaxRadius - VISUAL_CONFIG.timelineMinRadius)
          const a = angleByCommunity.get(gn.community_id || 0) ?? 0
          return Math.cos(a) * r
        }).strength(VISUAL_CONFIG.timelineStrength)
      )
      fg.d3Force(
        'y',
        forceY((n: any) => {
          const gn = n as GraphNode
          if (!isPerson(gn)) return 0
          if (gn.is_main_character) return 0
          const first = parseIsoMs(gn.first_seen) ?? timeBounds.min
          const t = clamp01((first - timeBounds.min) / span)
          const r = VISUAL_CONFIG.timelineMinRadius + t * (VISUAL_CONFIG.timelineMaxRadius - VISUAL_CONFIG.timelineMinRadius)
          const a = angleByCommunity.get(gn.community_id || 0) ?? 0
          return Math.sin(a) * r
        }).strength(VISUAL_CONFIG.timelineStrength)
      )
    }

    fg.d3ReheatSimulation()
  }, [graphData.nodes, layoutMode, mainId, nodeRadius, showCrossLinks, timeBounds.max, timeBounds.min])

  const persistLayout = () => {
    try {
      const out: Record<string, { x: number; y: number }> = {}
      for (const n of graphData.nodes) {
        const x = Number((n as any).x)
        const y = Number((n as any).y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        out[n.id] = { x, y }
      }
      window.localStorage.setItem(layoutCacheKey, JSON.stringify(out))
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!isPlaying) return
    if (playMs == null) return

    const intervalMs = 50
    const step = (speedDaysPerSec * DAY_MS * intervalMs) / 1000

    const t = setInterval(() => {
      setPlayMs(prev => {
        if (prev == null) return timeBounds.max
        const next = prev + step
        if (next >= timeBounds.max) return timeBounds.max
        return next
      })
    }, intervalMs)

    return () => clearInterval(t)
  }, [isPlaying, playMs, speedDaysPerSec, timeBounds.max])

  useEffect(() => {
    if (playMs != null && playMs >= timeBounds.max) setIsPlaying(false)
  }, [playMs, timeBounds.max])

  const highlighted = useMemo(() => {
    const id = (hoveredNode || selectedNode)?.id || null
    if (!id) return { center: null as string | null, neighbors: new Set<string>() }
    return { center: id, neighbors: adjacency.get(id) || new Set<string>() }
  }, [adjacency, hoveredNode, selectedNode])

  const onSelectNode = (n: PersonNode) => {
    setSelectedNode(n)
    const fg = fgRef.current
    if (fg && typeof fg.centerAt === 'function') {
      const x = Number((n as any).x || 0)
      const y = Number((n as any).y || 0)
      fg.centerAt(x, y, VISUAL_CONFIG.zoomDuration)
      fg.zoom(1.6, VISUAL_CONFIG.zoomDuration)
    }
  }

  const onSearchGo = () => {
    const q = search.trim().toLowerCase()
    if (!q) return
    const candidate = visible.nodes.find(n => {
      if (!isPerson(n)) return false
      return n.username.toLowerCase() === q || n.display_name.toLowerCase().includes(q)
    })
    if (candidate && isPerson(candidate)) onSelectNode(candidate)
  }

  const drawNode = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as GraphNode
    const x = Number((n as any).x || 0)
    const y = Number((n as any).y || 0)
    const r = nodeRadius(n)

    if (isPerson(n)) {
      const img = avatarCache.get(n.id)
      const fill = getCommunityColor(n.community_id || 0)

      // Soft community tint behind the avatar (glow-like, doesn't cover the photo).
      ctx.beginPath()
      ctx.arc(x, y, r + 3, 0, Math.PI * 2)
      ctx.fillStyle = fill.replace('0.15', '0.10')
      ctx.fill()

      if (img) {
        drawCircularAvatar(ctx, img, x, y, r, VISUAL_CONFIG.nodeBorderColor, VISUAL_CONFIG.nodeBorderWidth)
      } else {
        drawPlaceholder(ctx, x, y, r, fill, VISUAL_CONFIG.nodeBorderColor, VISUAL_CONFIG.nodeBorderWidth)
      }

      // Main node halo.
      if (n.is_main_character) {
        ctx.beginPath()
        ctx.arc(x, y, r + 6, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)'
        ctx.lineWidth = 3
        ctx.stroke()
      }

      // Labels: show for selected/hovered, or if zoomed in.
      const shouldLabel = selectedNode?.id === n.id || hoveredNode?.id === n.id || globalScale > 2.2
      if (shouldLabel) {
        const fontSize = Math.max(10, Math.min(14, 12 / globalScale))
        ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = 'rgba(17, 24, 39, 0.85)'
        ctx.fillText(`@${n.username}`, x, y + r + 4)
      }

      // New-tie glow (first interaction within the analysis window).
      const firstInt = firstInteractionByOther.get(n.id)
      if (!n.is_main_character && firstInt != null && firstInt >= timeWindow.start && firstInt <= timeWindow.end) {
        ctx.beginPath()
        ctx.arc(x, y, r + 8, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.35)'
        ctx.lineWidth = 3
        ctx.stroke()
      }
    } else {
      // Tweet nodes (rare/optional datasets).
      drawPlaceholder(ctx, x, y, r, '#fafafa', VISUAL_CONFIG.nodeBorderColor, 1)
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: VISUAL_CONFIG.background,
        position: 'relative'
      }}
      onMouseMove={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
    >
      <BackButton onClick={onBack} />

      <div
        style={{
          position: 'fixed',
          top: 20,
          right: selectedNode ? 380 : 20,
          zIndex: 120,
          background: 'rgba(255,255,255,0.92)',
          border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
          borderRadius: 12,
          padding: 12,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
          backdropFilter: 'blur(10px)',
          width: 360,
          maxHeight: 'calc(100vh - 40px)',
          overflow: 'auto'
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: VISUAL_CONFIG.textPrimary }}>Social Graph</div>
          <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
            {data.meta.total_persons.toLocaleString()} people
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8 }}>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearchGo()
              }}
              placeholder="Search @user or name"
              aria-label="Search by username or name"
              style={{
                borderRadius: 10,
                border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                padding: '8px 10px',
                fontSize: 12,
                outline: 'none'
              }}
            />
            <button
              onClick={onSearchGo}
              aria-label="Go to searched node"
              style={{
                borderRadius: 10,
                border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                background: '#fff',
                cursor: 'pointer',
                padding: '8px 10px',
                fontSize: 12,
                color: VISUAL_CONFIG.textPrimary,
                fontWeight: 700
              }}
            >
              Go
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>Layout</div>
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value as LayoutMode)}
                aria-label="Layout mode"
                style={{
                  borderRadius: 10,
                  border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                  padding: '8px 10px',
                  fontSize: 12,
                  background: '#fff'
                }}
              >
                <option value="clusters">Neural</option>
                <option value="onion">Onion</option>
                <option value="timeline">Timeline</option>
                <option value="free">Free</option>
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>Min degree</div>
              <input
                type="number"
                value={minDegree}
                min={0}
                max={999}
                onChange={(e) => setMinDegree(Math.max(0, Number(e.target.value || 0)))}
                aria-label="Minimum degree filter"
                style={{
                  borderRadius: 10,
                  border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                  padding: '8px 10px',
                  fontSize: 12,
                  outline: 'none'
                }}
              />
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
            <input
              type="checkbox"
              checked={showCrossLinks}
              onChange={(e) => setShowCrossLinks(e.target.checked)}
            />
            Show cross-links (more noise)
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
            <input
              type="checkbox"
              checked={egoMode}
              onChange={(e) => setEgoMode(e.target.checked)}
            />
            Ego network (filter)
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>Ego depth</div>
            <select
              value={egoDepth}
              onChange={(e) => {
                const v = Number(e.target.value)
                const next = (v === 4 ? 4 : v === 3 ? 3 : v === 2 ? 2 : 1) as 1 | 2 | 3 | 4
                setEgoDepth(next)
              }}
              disabled={!egoMode}
              aria-label="Ego depth"
              style={{
                borderRadius: 10,
                border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                padding: '8px 10px',
                fontSize: 12,
                background: '#fff'
              }}
            >
              <option value={1}>1 hop</option>
              <option value={2}>2 hops</option>
              <option value={3}>3 hops</option>
              <option value={4}>4 hops</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
            <input
              type="checkbox"
              checked={showInactiveNodes}
              onChange={(e) => setShowInactiveNodes(e.target.checked)}
              disabled={windowDays <= 0}
            />
            Show inactive nodes (outside window)
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>Min tie strength (window score)</div>
            <input
              type="number"
              value={minTieStrength}
              min={0}
              step={0.5}
              onChange={(e) => setMinTieStrength(Math.max(0, Number(e.target.value || 0)))}
              aria-label="Minimum tie strength"
              style={{
                borderRadius: 10,
                border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                padding: '8px 10px',
                fontSize: 12,
                outline: 'none'
              }}
            />
          </label>

          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>Types</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    for (const k of availableTypes) next[k] = true
                    setEnabledTypes(next)
                  }}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                    background: '#fff',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontSize: 11,
                    color: VISUAL_CONFIG.textSecondary
                  }}
                >
                  All
                </button>
                <button
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    for (const k of availableTypes) next[k] = false
                    setEnabledTypes(next)
                  }}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                    background: '#fff',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontSize: 11,
                    color: VISUAL_CONFIG.textSecondary
                  }}
                >
                  None
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {availableTypes.map((t) => {
                const on = isTypeEnabled(t)
                return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                    background: on ? 'rgba(17, 24, 39, 0.04)' : '#fff',
                    cursor: 'pointer',
                    padding: '6px 9px',
                    fontSize: 11,
                    color: VISUAL_CONFIG.textPrimary,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontWeight: on ? 900 : 600
                  }}
                  aria-label={`Toggle ${t}`}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: edgeRgba(t, on ? 0.9 : 0.25), display: 'inline-block' }} />
                  {t}
                </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => fgRef.current?.zoomToFit?.(VISUAL_CONFIG.zoomDuration, 60)}
              style={{
                flex: 1,
                borderRadius: 10,
                border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                background: '#fff',
                cursor: 'pointer',
                padding: '8px 10px',
                fontSize: 12,
                color: VISUAL_CONFIG.textPrimary,
                fontWeight: 700
              }}
            >
              Zoom to fit
            </button>
            <button
              onClick={() => {
                setLayoutMode('clusters')
                setWindowDays(30)
                setShowCrossLinks(false)
                setEgoMode(true)
                setEgoDepth(2)
                setShowInactiveNodes(false)
                setMinDegree(0)
                setMinTieStrength(0)
                setEnabledTypes(prev => {
                  const next: Record<string, boolean> = { ...prev }
                  for (const t of availableTypes) next[t] = true
                  return next
                })
                fgRef.current?.zoomToFit?.(VISUAL_CONFIG.zoomDuration, 60)
              }}
              style={{
                borderRadius: 10,
                border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                background: '#fff',
                cursor: 'pointer',
                padding: '8px 10px',
                fontSize: 12,
                color: VISUAL_CONFIG.textSecondary
              }}
              aria-label="Reset view"
            >
              Reset
            </button>
            <button
              onClick={() => {
                setSelectedNode(null)
                setHoveredNode(null)
              }}
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
              Clear
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: `1px solid ${VISUAL_CONFIG.tooltipBorder}`, paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: VISUAL_CONFIG.textPrimary }}>Insights</div>
            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>{timeWindow.label}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            <div style={{ border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`, borderRadius: 12, padding: 10, background: '#fff' }}>
              <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>Events</div>
              <div style={{ fontSize: 14, color: VISUAL_CONFIG.textPrimary, fontWeight: 900 }}>
                {windowStats.totals.count.toLocaleString()}
              </div>
            </div>
            <div style={{ border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`, borderRadius: 12, padding: 10, background: '#fff' }}>
              <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>Active ties</div>
              <div style={{ fontSize: 14, color: VISUAL_CONFIG.textPrimary, fontWeight: 900 }}>
                {windowStats.activeTies.toLocaleString()}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {[7, 30, 90, 365, 0].map((d) => (
              <button
                key={String(d)}
                onClick={() => setWindowDays(d)}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                  background: d === windowDays ? 'rgba(99, 102, 241, 0.10)' : '#fff',
                  cursor: 'pointer',
                  padding: '7px 10px',
                  fontSize: 12,
                  color: VISUAL_CONFIG.textPrimary,
                  fontWeight: d === windowDays ? 900 : 700
                }}
              >
                {d === 0 ? 'All' : `${d}d`}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>New ties</div>
              {windowStats.newTies.length === 0 ? (
                <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>No new ties in window.</div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {windowStats.newTies.slice(0, 5).map((r) => {
                    const n = nodesById.get(r.other)
                    if (!isPerson(n)) return null
                    const first = firstInteractionByOther.get(r.other)
                    return (
                      <button
                        key={n.id}
                        onClick={() => onSelectNode(n)}
                        style={{
                          border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                          borderRadius: 12,
                          background: '#fff',
                          padding: 9,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: VISUAL_CONFIG.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              @{n.username}
                            </div>
                            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
                              First: {first ? new Date(first).toLocaleDateString() : 'Unknown'}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, fontWeight: 900 }}>
                            +{r.count}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>Fastest growing</div>
              {windowStats.fastestGrowing.length === 0 ? (
                <div style={{ fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>No growth detected (or no previous window).</div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {windowStats.fastestGrowing.slice(0, 5).map((r) => {
                    const n = nodesById.get(r.other)
                    if (!isPerson(n)) return null
                    return (
                      <button
                        key={n.id}
                        onClick={() => onSelectNode(n)}
                        style={{
                          border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                          borderRadius: 12,
                          background: '#fff',
                          padding: 9,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: VISUAL_CONFIG.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              @{n.username}
                            </div>
                            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
                              Score: {r.score.toFixed(1)}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 900 }}>
                            +{Number((r as any).deltaScore || 0).toFixed(1)}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>Most inbound</div>
                {windowStats.mostInbound.slice(0, 3).map((r) => {
                  const n = nodesById.get(r.other)
                  if (!isPerson(n)) return null
                  return (
                    <button
                      key={n.id}
                      onClick={() => onSelectNode(n)}
                      style={{
                        width: '100%',
                        border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                        borderRadius: 12,
                        background: '#fff',
                        padding: 9,
                        cursor: 'pointer',
                        textAlign: 'left',
                        marginBottom: 6
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: VISUAL_CONFIG.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          @{n.username}
                        </div>
                        <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, fontWeight: 900 }}>{r.inbound}</div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div>
                <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, marginBottom: 6 }}>Most outbound</div>
                {windowStats.mostOutbound.slice(0, 3).map((r) => {
                  const n = nodesById.get(r.other)
                  if (!isPerson(n)) return null
                  return (
                    <button
                      key={n.id}
                      onClick={() => onSelectNode(n)}
                      style={{
                        width: '100%',
                        border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                        borderRadius: 12,
                        background: '#fff',
                        padding: 9,
                        cursor: 'pointer',
                        textAlign: 'left',
                        marginBottom: 6
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: VISUAL_CONFIG.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          @{n.username}
                        </div>
                        <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, fontWeight: 900 }}>{r.outbound}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: `1px solid ${VISUAL_CONFIG.tooltipBorder}`, paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: VISUAL_CONFIG.textPrimary }}>Strongest ties</div>
            <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
              {timeWindow.label}
            </div>
          </div>

          {strongestTies.length === 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              No ties available (adjust filters or widen the window).
            </div>
          ) : (
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {strongestTies.map((row) => {
                const n = row.node
                const pct = clamp01(row.score / maxWindowScore)
                return (
                  <button
                    key={n.id}
                    onClick={() => onSelectNode(n)}
                    style={{
                      border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                      borderRadius: 12,
                      background: '#fff',
                      padding: 10,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            color: VISUAL_CONFIG.textPrimary,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {n.display_name}
                        </div>
                        <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>@{n.username}</div>
                      </div>
                      <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary, fontWeight: 800 }}>
                        {row.score.toFixed(1)}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        height: 6,
                        borderRadius: 999,
                        background: '#f3f4f6',
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.round(pct * 100)}%`,
                          background: getCommunityColor(n.community_id || 0)
                        }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: 'fixed',
          left: 20,
          bottom: 20,
          zIndex: 110,
          background: 'rgba(255,255,255,0.92)',
          border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
          borderRadius: 12,
          padding: 12,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
          backdropFilter: 'blur(10px)',
          width: 420
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: VISUAL_CONFIG.textPrimary }}>Playback</div>
          <div style={{ fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
            {playMs == null ? 'n/a' : new Date(playMs).toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <input
            type="range"
            min={timeBounds.min}
            max={timeBounds.max}
            step={3600000}
            value={playMs == null ? timeBounds.max : playMs}
            onChange={(e) => setPlayMs(Number(e.target.value))}
            style={{ width: '100%' }}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setIsPlaying(v => !v)}
              style={{
                borderRadius: 10,
                border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                background: '#fff',
                cursor: 'pointer',
                padding: '8px 10px',
                fontSize: 12,
                color: VISUAL_CONFIG.textPrimary,
                fontWeight: 800,
                width: 90
              }}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>

            <button
              onClick={() => {
                setIsPlaying(false)
                setPlayMs(timeBounds.min)
              }}
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
              Reset
            </button>

            <div style={{ flex: 1 }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: VISUAL_CONFIG.textSecondary }}>
              Speed
              <select
                value={speedDaysPerSec}
                onChange={(e) => setSpeedDaysPerSec(Number(e.target.value))}
                aria-label="Playback speed"
                style={{
                  borderRadius: 10,
                  border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
                  padding: '8px 10px',
                  fontSize: 12,
                  background: '#fff'
                }}
              >
                <option value={1}>1d/s</option>
                <option value={3}>3d/s</option>
                <option value={7}>7d/s</option>
                <option value={14}>14d/s</option>
                <option value={30}>30d/s</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {availableTypes
              .filter((t) => isTypeEnabled(t))
              .map((t) => (
                <div key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: edgeRgba(t, 0.9), display: 'inline-block' }} />
                  {t}
                </div>
              ))}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: VISUAL_CONFIG.textSecondary }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, border: '2px solid rgba(34, 197, 94, 0.55)', display: 'inline-block' }} />
              new tie
            </div>
          </div>
        </div>
      </div>

      <ForceGraph2D
        ref={fgRef as any}
        graphData={graphData as any}
        backgroundColor={VISUAL_CONFIG.background}
        warmupTicks={VISUAL_CONFIG.warmupTicks}
        cooldownTicks={VISUAL_CONFIG.cooldownTicks}
        onEngineStop={persistLayout as any}
        minZoom={VISUAL_CONFIG.minZoom}
        maxZoom={VISUAL_CONFIG.maxZoom}
        linkCurvature={(l: any) => {
          const e = l as GraphEdge
          const s = typeof e.source === 'string' ? e.source : e.source.id
          const t = typeof e.target === 'string' ? e.target : e.target.id
          return curvatureByEdgeKey.get(edgeKey(s, t, String(e.type || 'unknown'))) || 0
        }}
        linkWidth={(l: any) => {
          const e = l as GraphEdge
          const s = typeof e.source === 'string' ? e.source : e.source.id
          const t = typeof e.target === 'string' ? e.target : e.target.id
          const isPrimary = s === mainId || t === mainId
          const isHi = highlighted.center != null && (s === highlighted.center || t === highlighted.center)
          if (isHi) return VISUAL_CONFIG.linkWidthHighlight

          if (!isPrimary) return VISUAL_CONFIG.linkWidth * 0.75

          const other = s === mainId ? t : s
          const score =
            windowDays > 0
              ? Number((windowStats.rowsByOther.get(other) as any)?.score || 0)
              : Number(e.weight ?? e.count ?? 0)

          const denom = windowDays > 0 ? maxWindowTieScore : maxPrimaryEdgeWeight
          const norm = clamp01(denom <= 0 ? 0 : score / denom)
          return VISUAL_CONFIG.linkWidth * (0.7 + 2.1 * Math.sqrt(norm))
        }}
        linkColor={(l: any) => {
          const e = l as GraphEdge
          const s = typeof e.source === 'string' ? e.source : e.source.id
          const t = typeof e.target === 'string' ? e.target : e.target.id
          const isPrimary = s === mainId || t === mainId
          const isHi =
            highlighted.center != null &&
            (s === highlighted.center || t === highlighted.center || highlighted.neighbors.has(s) || highlighted.neighbors.has(t))

          const a = isHi
            ? VISUAL_CONFIG.linkOpacityHighlight
            : isPrimary
              ? VISUAL_CONFIG.linkOpacity
              : VISUAL_CONFIG.linkOpacitySecondary
          return edgeRgba(e.type || 'mentioned', a)
        }}
        linkDirectionalParticles={(l: any) => {
          const e = l as GraphEdge
          const s = typeof e.source === 'string' ? e.source : e.source.id
          const t = typeof e.target === 'string' ? e.target : e.target.id
          return recentEdgeKeys.has(edgeKey(s, t, e.type || 'mentioned')) ? 2 : 0
        }}
        linkDirectionalParticleWidth={1.6}
        linkDirectionalParticleSpeed={0.01}
        linkDirectionalParticleColor={(l: any) => {
          const e = l as GraphEdge
          return edgeRgba(e.type || 'mentioned', 0.9)
        }}
        nodeCanvasObject={drawNode as any}
        nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
          const n = node as GraphNode
          const x = Number((n as any).x || 0)
          const y = Number((n as any).y || 0)
          const r = nodeRadius(n) + 2
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.fill()
        }}
        onNodeHover={(node: any) => {
          if (!node) {
            setHoveredNode(null)
            return
          }
          if (isPerson(node as GraphNode)) setHoveredNode(node as PersonNode)
          else setHoveredNode(null)
        }}
        onNodeClick={(node: any) => {
          if (!node) return
          if (isPerson(node as GraphNode)) onSelectNode(node as PersonNode)
        }}
      />

      <Tooltip
        node={hoveredNode}
        position={tooltipPos}
        windowLabel={timeWindow.label}
        windowStat={hoveredNode ? (windowStats.rowsByOther.get(hoveredNode.id) as any) : null}
      />

      {selectedNode ? (
        <NodeDrawer
          node={selectedNode}
          mainId={mainId}
          windowLabel={timeWindow.label}
          windowStat={(windowStats.rowsByOther.get(selectedNode.id) as any) || null}
          firstInteractionTs={
            firstInteractionByOther.get(selectedNode.id)
              ? new Date(firstInteractionByOther.get(selectedNode.id) as number).toISOString()
              : null
          }
          events={(windowEventsByOtherId.get(selectedNode.id) || []).slice(0, 40)}
          allEvents={(eventsByOtherId.get(selectedNode.id) || []).slice(0, 200)}
          onClose={() => setSelectedNode(null)}
        />
      ) : null}
    </div>
  )
}
