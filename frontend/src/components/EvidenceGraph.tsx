import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { BookOpen, Bot, CircleCheck, ClipboardList, ExternalLink, FlaskConical, Lightbulb, Sparkles, X, type LucideIcon } from 'lucide-react'
import { api } from '../api'
import type { CaseRecord, SourceCitation } from '../types'
import type { RunState } from '../useRun'

type Kind = 'hyp' | 'ev' | 'src' | 'heldout' | 'finding' | 'agent'
interface GNode extends SimulationNodeDatum {
  id: string; kind: Kind; label: string; deg: number; born: number
  refId?: string   // agent id (agents, findings) or source / case entry id
  cited?: boolean  // literature: quoted by at least one grounded finding
}
interface GLink extends SimulationLinkDatum<GNode> { id: string; kind: 'supports' | 'contradicts' | 'cites' | 'found' | 'about' | 'tree' }

const KIND_LABEL: Record<Kind, string> = {
  hyp: 'Hypothesis', ev: 'Grounded finding', src: 'Literature', heldout: 'Test result', finding: 'Case record', agent: 'Agent',
}
const KIND_ICON: Record<Kind, LucideIcon> = {
  hyp: Lightbulb, ev: Sparkles, src: BookOpen, heldout: FlaskConical, finding: ClipboardList, agent: Bot,
}
const COLOR: Record<Kind, string> = {
  hyp: '251,113,133', ev: '110,231,249', src: '96,165,250', heldout: '74,222,155', finding: '165,166,251', agent: '140,152,178',
}
const FINDING_ID = /^(mf|tl|lab|img|np|ka)_\d+$|^(family_history|social_history|prior_workup_and_opinions|chief_complaint|history_of_present_illness|medications|neurological_exam)/

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
function sameHypothesis(a: string, b: string) {
  const ta = tokens(a), tb = tokens(b)
  if (!ta.size || !tb.size) return false
  let n = 0
  ta.forEach(w => { if (tb.has(w)) n++ })
  return n / Math.min(ta.size, tb.size) >= 0.5
}
function hypothesisList(state: RunState) {
  const hyps: string[] = []
  for (const h of [...(state.report?.differential.map(d => d.hypothesis) ?? []), ...state.hypotheses]) {
    if (!hyps.some(x => sameHypothesis(x, h))) hyps.push(h)
  }
  return hyps
}

/**
 * The evidence layer (default): hypotheses, grounded findings and what each finding cites
 * (case record entries, quoted literature, released test results). Every link is backed by a
 * quote checked in code or a case finding id. `withRetrieval` adds the agents and every paper
 * they retrieved, cited or not, to show the breadth of the search: provenance, not evidence.
 */
function buildGraph(state: RunState, born: Map<string, number>, withRetrieval: boolean) {
  const nodes = new Map<string, GNode>()
  const links = new Map<string, GLink>()
  const now = performance.now()
  const add = (n: Omit<GNode, 'deg' | 'born'>) => {
    if (!nodes.has(n.id)) {
      if (!born.has(n.id)) born.set(n.id, now)
      nodes.set(n.id, { ...n, deg: 0, born: born.get(n.id)! })
    } else if (n.cited) nodes.get(n.id)!.cited = true
  }
  const link = (s: string, t: string, kind: GLink['kind']) => {
    if (!nodes.has(s) || !nodes.has(t) || s === t) return
    const id = `${s}>${t}`
    if (!links.has(id)) { links.set(id, { id, source: s, target: t, kind }); nodes.get(s)!.deg++; nodes.get(t)!.deg++ }
  }

  const hyps = hypothesisList(state)
  const hypId = (h: string) => `h:${hyps.findIndex(x => sameHypothesis(x, h))}`
  hyps.forEach((h, i) => add({ id: `h:${i}`, kind: 'hyp', label: h }))

  if (withRetrieval) {
    for (const id of state.order) {
      add({ id: `a:${id}`, kind: 'agent', label: id, refId: id })
      const p = state.nodes[id].parent_id
      if (p) link(`a:${p}`, `a:${id}`, 'tree')
      for (const s of state.activity[id]?.searches ?? []) {
        for (const r of s.results) {
          add({ id: `s:${r.source_id}`, kind: 'src', label: r.title || r.source_id, refId: r.source_id })
          link(`a:${id}`, `s:${r.source_id}`, 'found')
        }
      }
    }
  }
  for (const e of state.evidence) {
    if (!e.grounded) continue
    add({ id: e.id, kind: 'ev', label: e.claim, refId: e.node_id })
    if (withRetrieval) link(`a:${e.node_id}`, e.id, 'found')
    const sid = e.source_id
    if (sid && FINDING_ID.test(sid)) { add({ id: `f:${sid}`, kind: 'finding', label: sid, refId: sid }); link(e.id, `f:${sid}`, 'cites') }
    else if (sid) {
      const s = state.sources[sid]
      add({ id: `s:${sid}`, kind: sid.startsWith('HELDOUT:') ? 'heldout' : 'src', label: s?.title || sid, refId: sid, cited: true })
      link(e.id, `s:${sid}`, 'cites')
    }
    for (const f of e.finding_ids) { add({ id: `f:${f}`, kind: 'finding', label: f, refId: f }); link(e.id, `f:${f}`, 'cites') }
    if (e.hypothesis && hyps.some(h => sameHypothesis(h, e.hypothesis!))) {
      link(hypId(e.hypothesis), e.id, e.stance === 'contradicts' ? 'contradicts' : e.stance === 'supports' ? 'supports' : 'about')
    }
  }
  for (const d of state.report?.differential ?? []) {
    const h = hypId(d.hypothesis)
    const target = (id: string) => {
      if (FINDING_ID.test(id)) { add({ id: `f:${id}`, kind: 'finding', label: id, refId: id }); return `f:${id}` }
      if (id.startsWith('HELDOUT:')) {
        add({ id: `s:${id}`, kind: 'heldout', label: state.sources[id]?.title || id, refId: id, cited: true }); return `s:${id}`
      }
      return id
    }
    d.supporting_evidence_ids.forEach(id => link(h, target(id), 'supports'))
    d.contradicting_evidence_ids.forEach(id => link(h, target(id), 'contradicts'))
  }
  return { nodes: [...nodes.values()], links: [...links.values()] }
}

const radius = (n: GNode) =>
  n.kind === 'hyp' ? 8 + Math.min(10, Math.sqrt(n.deg) * 1.6)
    : n.kind === 'heldout' ? 5.5 : n.kind === 'finding' ? 3.6 : n.kind === 'agent' ? 3 : n.kind === 'ev' ? 3
    : n.cited ? 3.6 : 1.8

/** Graph id of an agent node, for `spotlight`. Agents are drawn only with retrieval on; otherwise
 * the spotlight falls on the findings that agent recorded. */
export const agentKey = (nodeId: string) => `a:${nodeId}`
/** Graph id of a held-out result or retrieved source, for `spotlight`. */
export const sourceKey = (sourceId: string) => `s:${sourceId}`

/** Width of the node card, which the camera keeps clear. */
const CARD_W = 340

const endId = (end: GLink['source']) => String(typeof end === 'object' ? (end as GNode).id : end)

export function EvidenceGraph({ state, onSelectAgent, spotlight, rejected, padRight = 0, runId = null, caseRecord }: {
  state: RunState; onSelectAgent: (id: string) => void
  /** Graph ids to light up and frame (with their neighbours) while nothing is hovered or clicked. */
  spotlight?: string[]
  /** Evidence ids the verifier rejected: drawn with a red ring. */
  rejected?: Set<string>
  /** Pixels on the right covered by an overlay; the camera frames the remaining area. */
  padRight?: number
  /** For citation lookups in the node card. */
  runId?: string | null
  /** Case record, to show the text of cited case entries in the node card. */
  caseRecord?: CaseRecord
}) {
  const born = useRef(new Map<string, number>())
  const [withRetrieval, setWithRetrieval] = useState(false)
  const graph = useMemo(() => buildGraph(state, born.current, withRetrieval),
    [state.evidence, state.report, state.hypotheses, state.sources, state.order, state.activity, withRetrieval]) // eslint-disable-line react-hooks/exhaustive-deps
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const view = useRef({ x: 0, y: 0, k: 1, manual: false })
  const [focus, setFocus] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)
  const nodesRef = useRef<GNode[]>([])
  const linksRef = useRef<GLink[]>([])
  const activeRef = useRef<string | null>(null)
  activeRef.current = hover ?? focus
  const focusRef = useRef<string | null>(null)
  focusRef.current = focus
  const spotRef = useRef<string[]>([])
  spotRef.current = spotlight ?? []
  const rejectedRef = useRef<Set<string>>(new Set())
  rejectedRef.current = rejected ?? new Set()
  const padRef = useRef(0)
  padRef.current = padRight

  useEffect(() => { setFocus(null) }, [runId])

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of graph.links) {
      const s = endId(l.source), t = endId(l.target)
      if (!m.has(s)) m.set(s, new Set()); if (!m.has(t)) m.set(t, new Set())
      m.get(s)!.add(t); m.get(t)!.add(s)
    }
    return m
  }, [graph])
  const neighborsRef = useRef(neighbors)
  neighborsRef.current = neighbors
  const kindOf = useMemo(() => new Map(graph.nodes.map(n => [n.id, n.kind])), [graph])
  const kindRef = useRef(kindOf)
  kindRef.current = kindOf
  const byAgent = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const n of graph.nodes) if (n.kind === 'ev' && n.refId) m.set(`a:${n.refId}`, [...(m.get(`a:${n.refId}`) ?? []), n.id])
    return m
  }, [graph])
  const byAgentRef = useRef(byAgent)
  byAgentRef.current = byAgent

  // Physics: keep earlier positions so the network grows instead of reshuffling.
  useEffect(() => {
    for (const n of graph.nodes) {
      const p = positions.current.get(n.id)
      if (p) { n.x = p.x; n.y = p.y } else {
        const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 60
        n.x = Math.cos(a) * r; n.y = Math.sin(a) * r
      }
    }
    nodesRef.current = graph.nodes
    linksRef.current = graph.links
    const sim = forceSimulation<GNode>(graph.nodes)
      .force('link', forceLink<GNode, GLink>(graph.links).id(d => d.id)
        .distance(l => (l.kind === 'tree' ? 34 : l.kind === 'found' ? 26 : l.kind === 'cites' ? 24 : 80))
        .strength(l => (l.kind === 'found' ? 0.3 : 0.7)))
      .force('charge', forceManyBody<GNode>().strength(d => (d.kind === 'hyp' ? -900 : d.kind === 'heldout' ? -90 : -30)).distanceMax(420))
      .force('collide', forceCollide<GNode>(d => radius(d) + 2))
      .force('x', forceX(0).strength(0.04)).force('y', forceY(0).strength(0.04))
      .alpha(positions.current.size ? 0.6 : 1).alphaDecay(0.02)
    sim.on('tick', () => { for (const n of graph.nodes) positions.current.set(n.id, { x: n.x!, y: n.y! }) })
    return () => { sim.stop() }
  }, [graph])

  // Render loop: transparent canvas with additive glow, so the card behind shows through.
  useEffect(() => {
    let raf = 0
    /** What lights up around a node: its neighbours; for a hypothesis, the chain on to the sources. */
    const around = (id: string) => {
      const nb = neighborsRef.current, kind = kindRef.current
      const out = new Set([id, ...(nb.get(id) ?? [])])
      if (kind.get(id) === 'hyp') {
        for (const n of [...out]) if (kind.get(n) !== 'hyp') nb.get(n)?.forEach(m => { if (kind.get(m) !== 'hyp') out.add(m) })
      }
      return out
    }
    const draw = () => {
      const c = canvas.current, el = wrap.current
      if (c && el) {
        const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = `${w}px`; c.style.height = `${h}px`
        }
        const g = c.getContext('2d')!
        const nodes = nodesRef.current, links = linksRef.current
        const active = activeRef.current
        const spot = active ? [] : spotRef.current.flatMap(id => (kindRef.current.has(id) ? [id] : byAgentRef.current.get(id) ?? []))
        const lit = active ? around(active)
          : spot.length ? new Set(spot.flatMap(id => [...around(id)])) : null
        // a clicked node frames its chain beside the card, like a stage spotlight
        const carded = !!focusRef.current && focusRef.current === active
        const push = spot.length > 0 || carded
        if (!view.current.manual && nodes.length) {
          // frame the spotlight (camera pushes in), otherwise the whole network
          const framed = push && lit ? nodes.filter(n => lit.has(n.id)) : nodes
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
          for (const n of framed) { if (n.x == null) continue; x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y!); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y!) }
          const pad = push ? 60 : 0
          x0 -= pad; x1 += pad; y0 -= pad; y1 += pad
          // leave room for labels left and right, and for the legend at the bottom
          // never let an overlay squeeze the framed area below 520px (narrow projectors)
          // (the card is narrower than a stage overlay, so it may leave the graph less room)
          const cover = Math.max(padRef.current, carded ? CARD_W + 24 : 0)
          const fw = w - Math.min(cover, Math.max(0, w - (carded ? CARD_W : 520)))
          const k = Math.min(push ? 3 : 2.2, (fw - 220) / Math.max(1, x1 - x0), (h - 130) / Math.max(1, y1 - y0))
          const v = view.current
          const ease = push ? 0.05 : 0.08
          v.k += (k - v.k) * ease
          v.x += (fw / 2 - v.k * (x0 + x1) / 2 - v.x) * ease
          v.y += ((h - 50) / 2 - v.k * (y0 + y1) / 2 - v.y) * ease
        }
        const { x: tx, y: ty, k } = view.current
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.clearRect(0, 0, w, h)
        const now = performance.now()
        const spotSet = new Set(spot)
        const rej = rejectedRef.current

        g.save()
        g.translate(tx, ty)
        g.scale(k, k)
        g.globalCompositeOperation = 'lighter'
        for (const l of links) {
          const s = l.source as GNode, t = l.target as GNode
          if (s.x == null || t.x == null) continue
          const on = !lit || (lit.has(s.id) && lit.has(t.id))
          const strong = l.kind === 'supports' || l.kind === 'contradicts'
          const base = l.kind === 'supports' ? '74,222,155' : l.kind === 'contradicts' ? '251,113,133' : l.kind === 'tree' ? '140,152,178' : '110,231,249'
          const a = on ? (strong ? 0.8 : l.kind === 'found' || l.kind === 'tree' ? 0.18 : lit ? 0.65 : 0.3) : 0.03
          g.strokeStyle = `rgba(${base},${a})`
          g.lineWidth = (strong ? 1.4 : 0.7) / Math.sqrt(k)
          if (l.kind === 'contradicts') g.setLineDash([4 / k, 3 / k])
          g.beginPath(); g.moveTo(s.x, s.y!); g.lineTo(t.x, t.y!); g.stroke()
          g.setLineDash([])
        }
        for (const n of nodes) {
          if (n.x == null) continue
          const on = !lit || lit.has(n.id)
          const r = radius(n)
          const age = Math.min(1, (now - n.born) / 900)
          const col = COLOR[n.kind]
          const alpha = (on ? 1 : 0.12) * (n.kind === 'src' && !n.cited ? 0.45 : 1)
          if (n.kind === 'hyp' || n.kind === 'heldout' || age < 1) {
            const glow = r * (n.kind === 'hyp' ? 4.5 : 3) * (age < 1 ? 1.6 - 0.6 * age : 1)
            const grad = g.createRadialGradient(n.x, n.y!, 0, n.x, n.y!, glow)
            grad.addColorStop(0, `rgba(${col},${0.42 * alpha})`); grad.addColorStop(1, `rgba(${col},0)`)
            g.fillStyle = grad
            g.beginPath(); g.arc(n.x, n.y!, glow, 0, Math.PI * 2); g.fill()
          }
          g.fillStyle = `rgba(${col},${0.95 * alpha})`
          g.beginPath(); g.arc(n.x, n.y!, r * (0.4 + 0.6 * age), 0, Math.PI * 2); g.fill()
          if (n.kind === 'hyp') {
            g.fillStyle = `rgba(255,255,255,${0.9 * alpha})`
            g.beginPath(); g.arc(n.x, n.y!, r * 0.35, 0, Math.PI * 2); g.fill()
          }
          if (rej.has(n.id)) {
            g.strokeStyle = `rgba(251,113,133,${0.95 * alpha})`; g.lineWidth = 1.2 / Math.sqrt(k)
            g.beginPath(); g.arc(n.x, n.y!, r + 3.5, 0, Math.PI * 2); g.stroke()
          }
          if (spotSet.has(n.id) || n.id === focusRef.current) {
            // sonar ring on the node the stage (or the user) is pointing at
            const p = (now % 1600) / 1600
            g.strokeStyle = `rgba(${col},${0.8 * (1 - p)})`; g.lineWidth = 1.4 / Math.sqrt(k)
            g.beginPath(); g.arc(n.x, n.y!, r + 3 + p * 22, 0, Math.PI * 2); g.stroke()
          }
        }
        g.globalCompositeOperation = 'source-over'
        g.textAlign = 'center'
        for (const n of nodes) {
          if (n.x == null) continue
          const on = !lit || lit.has(n.id)
          // names stay on for hypotheses and test results; everything else only when lit
          const always = n.kind === 'hyp' || n.kind === 'heldout'
          if (!always && !(lit && on)) continue
          const size = (n.kind === 'hyp' ? 12 : n.kind === 'heldout' ? 9 : 7) / Math.max(0.6, Math.min(k, 1.6))
          const text = n.label.length > 42 ? `${n.label.slice(0, 40)}…` : n.label
          g.font = `${always ? 600 : 400} ${size}px Inter, sans-serif`
          g.fillStyle = n.kind === 'hyp' ? `rgba(255,190,200,${on ? 1 : 0.18})`
            : n.kind === 'heldout' ? `rgba(170,245,205,${on ? 0.95 : 0.15})` : `rgba(200,225,245,${on ? 0.9 : 0.06})`
          g.fillText(text, n.x, n.y! - radius(n) - 4)
        }
        g.restore()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const hit = (cx: number, cy: number) => {
    const { x, y, k } = view.current
    const gx = (cx - x) / k, gy = (cy - y) / k
    let best: GNode | null = null, bd = Infinity
    for (const n of nodesRef.current) {
      if (n.x == null) continue
      const d = Math.hypot(n.x - gx, n.y! - gy)
      if (d < Math.max(radius(n) + 4 / k, 6 / k) && d < bd) { best = n; bd = d }
    }
    return best
  }
  const local = (e: React.MouseEvent) => { const r = wrap.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const }
  // The card follows a click; hover only lights the neighbourhood on the canvas.
  const focused = graph.nodes.find(n => n.id === focus)
  const counts = graph.nodes.reduce<Record<string, number>>((m, n) => ({ ...m, [n.kind]: (m[n.kind] ?? 0) + 1 }), {})

  return (
    <div className="graph-wrap" ref={wrap}
      onWheel={e => {
        const [cx, cy] = local(e)
        const v = view.current, k2 = Math.min(6, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.12 : 0.89)))
        v.x = cx - ((cx - v.x) * k2) / v.k; v.y = cy - ((cy - v.y) * k2) / v.k; v.k = k2; v.manual = true
      }}
      onDoubleClick={() => { view.current.manual = false }}
      onMouseDown={e => { drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false } }}
      onMouseMove={e => {
        if (drag.current) {
          const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y
          if (Math.abs(dx) + Math.abs(dy) > 3) { drag.current.moved = true; view.current.manual = true }
          view.current.x = drag.current.vx + dx; view.current.y = drag.current.vy + dy
        } else { const [cx, cy] = local(e); setHover(hit(cx, cy)?.id ?? null) }
      }}
      onMouseUp={e => {
        if (drag.current && !drag.current.moved) {
          const [cx, cy] = local(e); const n = hit(cx, cy)
          setFocus(f => (n && f !== n.id ? n.id : null))
          if ((n?.kind === 'agent' || n?.kind === 'ev') && n.refId) onSelectAgent(n.refId)
        }
        drag.current = null
      }}
      onMouseLeave={() => { drag.current = null; setHover(null) }}>
      <canvas ref={canvas} />
      {!graph.nodes.length && <div className="canvas-empty">The evidence graph fills in as agents record grounded findings:
        each hypothesis links to the findings for and against it, and each finding to the quote it rests on.</div>}
      <div className="graph-stats">
        <span><b>{counts.hyp ?? 0}</b> hypotheses</span><span><b>{counts.ev ?? 0}</b> findings</span>
        <span><b>{counts.heldout ?? 0}</b> test results</span>
        <span><b>{graph.nodes.filter(n => n.kind === 'src' && n.cited).length}</b> papers cited</span>
        {withRetrieval && <span><b>{counts.src ?? 0}</b> retrieved</span>}
      </div>
      <div className="graph-layer seg" onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}>
        <button className={withRetrieval ? '' : 'on'} onClick={() => setWithRetrieval(false)}
          title="Only links backed by a verbatim quote checked in code, or a case finding id">Evidence</button>
        <button className={withRetrieval ? 'on' : ''} onClick={() => setWithRetrieval(true)}
          title="Also the agents and every paper they retrieved, cited or not (provenance, not evidence)">+ Agents &amp; retrieval</button>
      </div>
      <div className="graph-legend">
        {(['hyp', 'ev', 'finding', 'src', 'heldout', ...(withRetrieval ? ['agent'] : [])] as Kind[]).map(k => (
          <span key={k}><i style={{ background: `rgb(${COLOR[k]})`, boxShadow: `0 0 6px rgb(${COLOR[k]})` }} />{KIND_LABEL[k]}</span>
        ))}
        <span><b className="k-supports" />supports</span><span><b className="k-contradicts" />contradicts</span>
        {!focused && <span className="legend-hint">Click a hypothesis to trace its evidence</span>}
      </div>
      {focused && (
        <NodeCard node={focused} state={state} runId={runId} caseRecord={caseRecord} neighbors={neighbors.get(focused.id)}
          kindOf={kindOf} onClose={() => setFocus(null)} onJump={id => setFocus(id)} />
      )}
    </div>
  )
}

// --- node card: what this is, and where it comes from -------------------------

function useCitations(runId: string | null, reportReady: boolean) {
  const [sources, setSources] = useState<Record<string, SourceCitation>>({})
  const [credit, setCredit] = useState<string | null>(null)
  useEffect(() => {
    setSources({})
    if (runId) api.runSources(runId).then(setSources).catch(() => {})
  }, [runId])
  // The adapted case's citation names the diagnosis: only after the report, on the played-back clock.
  useEffect(() => {
    setCredit(null)
    if (runId && reportReady) api.credits(runId).then(c => setCredit(c.source_citation)).catch(() => {})
  }, [runId, reportReady])
  return { sources, credit }
}

function citationLine(c: SourceCitation) {
  const m = c.meta
  const names = m.authors?.replace(/\.$/, '').split(', ') ?? []
  const authors = names.length > 3 ? `${names.slice(0, 3).join(', ')}, et al.` : names.length ? `${names.join(', ')}.` : null
  const where = [m.journal, m.year].filter(Boolean).join(' ')
  const vol = m.volume ? `;${m.volume}${m.issue ? `(${m.issue})` : ''}${m.pages ? `:${m.pages}` : ''}` : ''
  return [authors, where ? `${where}${vol}.` : null].filter(Boolean).join(' ')
}

function Citation({ c, id }: { c?: SourceCitation; id: string }) {
  if (!c) return <div className="nc-cite"><span className="mono">{id}</span></div>
  const m = c.meta
  const line = citationLine(c)
  return (
    <div className="nc-cite">
      <div className="nc-cite-title">{c.title}</div>
      {line && <div className="nc-cite-line">{line}</div>}
      <div className="nc-ids">
        {m.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${m.pmid}/`} target="_blank" rel="noreferrer">PMID {m.pmid}</a>}
        {m.pmcid && <a href={`https://europepmc.org/article/PMC/${m.pmcid}`} target="_blank" rel="noreferrer">{m.pmcid}</a>}
        {m.doi && <a href={`https://doi.org/${m.doi}`} target="_blank" rel="noreferrer">doi:{m.doi}</a>}
        {c.url && <a href={c.url} target="_blank" rel="noreferrer" title="Open in Europe PMC"><ExternalLink size={11} /></a>}
      </div>
    </div>
  )
}

function caseEntryText(rec: CaseRecord | undefined, id: string): string | null {
  if (!rec) return null
  for (const key of ['movement_findings', 'symptom_timeline', 'labs', 'imaging', 'neurophysiology', 'motion_analysis'] as const) {
    const e = (rec[key] as { id: string; [k: string]: unknown }[] | undefined)?.find(x => x.id === id)
    if (e) return Object.entries(e).filter(([k, v]) => !['id', 'reviewer', 'role', 'method'].includes(k) && v).map(([, v]) => String(v)).join(' · ')
  }
  const [section, field] = id.split('.')
  const v = (rec as unknown as Record<string, unknown>)[section]
  if (field && v && typeof v === 'object') return String((v as Record<string, unknown>)[field] ?? '')
  return typeof v === 'string' ? v : v ? JSON.stringify(v) : null
}

function CaseCredit({ credit }: { credit: string | null }) {
  return credit
    ? <div className="nc-credit">{credit.split(' License:')[0]}</div>
    : <div className="nc-credit muted">Case adapted from a published case report (CC BY 4.0). The full citation is shown after the
      report, because its title names the diagnosis.</div>
}

function NodeCard({ node, state, runId, caseRecord, neighbors, kindOf, onClose, onJump }: {
  node: GNode; state: RunState; runId: string | null; caseRecord?: CaseRecord; neighbors?: Set<string>
  kindOf: Map<string, Kind>; onClose: () => void; onJump: (id: string) => void
}) {
  const { sources, credit } = useCitations(runId, !!state.report)
  const Icon = KIND_ICON[node.kind]
  const ev = node.kind === 'ev' ? state.evidence.find(e => e.id === node.id) : undefined
  const agent = (node.kind === 'ev' || node.kind === 'agent') && node.refId ? state.nodes[node.refId] : undefined
  const hyps = hypothesisList(state)
  const linkedHyps = [...(neighbors ?? [])].filter(id => kindOf.get(id) === 'hyp')
  const released = node.kind === 'heldout'
    ? state.events.find(e => e.type === 'heldout.released' && e.data.source_id === node.refId) : undefined
  const diff = node.kind === 'hyp' ? state.report?.differential.find(d => sameHypothesis(d.hypothesis, node.label)) : undefined
  const evidenceOf = (ids: string[]) => ids.map(id => {
    const e = state.evidence.find(x => x.id === id)
    const gid = e ? e.id : id.startsWith('HELDOUT:') ? `s:${id}` : `f:${id}`
    return { id, gid, text: e?.claim ?? state.sources[id]?.title ?? caseEntryText(caseRecord, id) ?? id }
  })
  const EvList = ({ ids, tone, title }: { ids: string[]; tone: string; title: string }) => ids.length ? <>
    <div className={`nc-list-head ${tone}`}>{title} ({ids.length})</div>
    <ul className="nc-list">{evidenceOf(ids).map(x => (
      <li key={x.id} onClick={() => onJump(x.gid)}><span className="fid">{x.id.replace(/^ev_/, 'ev ')}</span>{x.text}</li>))}</ul>
  </> : null

  return (
    <div className="node-card" onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <div className="nc-head">
        <span className={`nc-icon k-${node.kind}`}><Icon size={15} /></span>
        <span className="nc-kind">{KIND_LABEL[node.kind]}</span>
        <button className="nc-close" onClick={onClose} title="Close"><X size={14} /></button>
      </div>

      {node.kind === 'ev' && ev && <>
        <div className="nc-title">{ev.claim}</div>
        {ev.quote && <blockquote className="nc-quote">“{ev.quote}”</blockquote>}
        <div className="nc-check"><CircleCheck size={13} />{ev.grounding_note ?? 'Grounded'} · checked in code</div>
        <div className="nc-row"><span>Source</span><div>
          {ev.source_id && FINDING_ID.test(ev.source_id) ? <>
            <span className="fid">{ev.source_id}</span> {caseEntryText(caseRecord, ev.source_id)}
            <CaseCredit credit={credit} />
          </> : ev.source_id?.startsWith('HELDOUT:') ? <>
            <b>{state.sources[ev.source_id]?.title}</b> <span className="muted">· test result released on request</span>
          </> : ev.source_id ? <Citation c={sources[ev.source_id]} id={ev.source_id} /> : <span className="muted">case record ids only</span>}
          {ev.finding_ids.filter(f => f !== ev.source_id).map(f => <span key={f} className="fid">{f}</span>)}
        </div></div>
        {ev.stance && ev.hypothesis && <div className="nc-row"><span>Stance</span>
          <div><b className={`stance ${ev.stance}`}>{ev.stance}</b> {ev.hypothesis}</div></div>}
        {agent && <div className="nc-row"><span>Found by</span><div>{agent.id} · {agent.role === 'lead' ? 'Lead' : `D${agent.depth}`} ·
          verifier <b className={`stance v-${agent.verification}`}>{agent.verification}</b></div></div>}
      </>}

      {node.kind === 'src' && <>
        <Citation c={sources[node.refId!]} id={node.refId!} />
        <div className="nc-row"><span>Use</span><div>{node.cited
          ? `Quoted by ${[...(neighbors ?? [])].filter(id => kindOf.get(id) === 'ev').length} grounded finding(s)`
          : 'Retrieved, not cited: no finding quotes it'}</div></div>
      </>}

      {node.kind === 'heldout' && <>
        <div className="nc-title">{node.label}</div>
        {state.sources[node.refId!]?.text && <blockquote className="nc-quote">{state.sources[node.refId!].text}</blockquote>}
        {released && <div className="nc-row"><span>Requested</span><div>by {released.data.node_id}: “{released.data.request}”</div></div>}
        <CaseCredit credit={credit} />
      </>}

      {node.kind === 'finding' && <>
        <div className="nc-title"><span className="fid">{node.refId}</span> case record entry</div>
        <blockquote className="nc-quote">{caseEntryText(caseRecord, node.refId!) ?? 'Entry of the case record.'}</blockquote>
        <CaseCredit credit={credit} />
      </>}

      {node.kind === 'agent' && agent && <>
        <div className="nc-title">{agent.objective}</div>
        <div className="nc-row"><span>Role</span><div>{agent.role === 'lead' ? 'Lead' : `Investigator, depth ${agent.depth}`} · {agent.model.split('/').pop()}</div></div>
      </>}

      {node.kind === 'hyp' && <>
        <div className="nc-title">{node.label}</div>
        {diff ? <div className="nc-row"><span>Report</span><div>rank {diff.rank} · confidence <b>{diff.confidence}</b></div></div>
          : <div className="nc-row"><span>Status</span><div className="muted">working hypothesis; not in the final differential</div></div>}
        {diff && <>
          <EvList ids={diff.supporting_evidence_ids} tone="supports" title="Supporting" />
          <EvList ids={diff.contradicting_evidence_ids} tone="contradicts" title="Against" />
        </>}
      </>}

      {node.kind !== 'hyp' && linkedHyps.length > 0 && <div className="nc-row"><span>Bears on</span>
        <div>{linkedHyps.map(h => <button key={h} className="nc-hyp" onClick={() => onJump(h)}>{hyps[Number(h.slice(2))] ?? h}</button>)}</div></div>}
    </div>
  )
}
