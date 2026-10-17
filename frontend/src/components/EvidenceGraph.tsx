import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import type { RunState } from '../useRun'

type Kind = 'hyp' | 'ev' | 'src' | 'heldout' | 'finding' | 'agent'
interface GNode extends SimulationNodeDatum { id: string; kind: Kind; label: string; detail?: string; weight: number; refId?: string }
interface GLink extends SimulationLinkDatum<GNode> { id: string; kind: 'supports' | 'contradicts' | 'cites' | 'found' | 'about' }

const RADIUS: Record<Kind, number> = { hyp: 16, ev: 5, src: 7, heldout: 9, finding: 7, agent: 6 }
const KIND_LABEL: Record<Kind, string> = {
  hyp: 'Hypothesis', ev: 'Finding', src: 'Literature', heldout: 'Investigation result', finding: 'Case record', agent: 'Agent',
}
const FINDING_ID = /^(mf|tl|lab|img|np)_\d+$/

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
function sameHypothesis(a: string, b: string) {
  const ta = tokens(a), tb = tokens(b)
  if (!ta.size || !tb.size) return false
  let n = 0
  ta.forEach(w => { if (tb.has(w)) n++ })
  return n / Math.min(ta.size, tb.size) >= 0.5
}

/** Hypotheses, grounded findings, their sources, cited case findings and the agents that found them. */
function buildGraph(state: RunState) {
  const nodes = new Map<string, GNode>()
  const links = new Map<string, GLink>()
  const add = (n: GNode) => { const cur = nodes.get(n.id); if (cur) cur.weight += n.weight; else nodes.set(n.id, n) }
  const link = (s: string, t: string, kind: GLink['kind']) => {
    if (nodes.has(s) && nodes.has(t) && s !== t) links.set(`${s}>${t}`, { id: `${s}>${t}`, source: s, target: t, kind })
  }

  const hyps: string[] = []
  for (const h of [...(state.report?.differential.map(d => d.hypothesis) ?? []), ...state.hypotheses]) {
    if (!hyps.some(x => sameHypothesis(x, h))) hyps.push(h)
  }
  const hypId = (h: string) => `hyp:${hyps.findIndex(x => sameHypothesis(x, h))}`
  hyps.forEach((h, i) => add({ id: `hyp:${i}`, kind: 'hyp', label: h, weight: 1 }))

  for (const e of state.evidence) {
    if (!e.grounded) continue
    add({ id: e.id, kind: 'ev', label: e.claim, detail: e.quote ?? undefined, weight: 1, refId: e.node_id })
    const agent = state.nodes[e.node_id]
    if (agent) {
      add({ id: `agent:${agent.id}`, kind: 'agent', label: agent.objective, weight: 0, refId: agent.id })
      link(`agent:${agent.id}`, e.id, 'found')
    }
    const sid = e.source_id
    if (sid && FINDING_ID.test(sid)) {
      add({ id: `f:${sid}`, kind: 'finding', label: sid, weight: 1 }); link(e.id, `f:${sid}`, 'cites')
    } else if (sid) {
      const s = state.sources[sid]
      add({ id: `s:${sid}`, kind: sid.startsWith('HELDOUT:') ? 'heldout' : 'src', label: s?.title || sid, detail: sid, weight: 1 })
      link(e.id, `s:${sid}`, 'cites')
    }
    for (const f of e.finding_ids) { add({ id: `f:${f}`, kind: 'finding', label: f, weight: 1 }); link(e.id, `f:${f}`, 'cites') }
    if (e.hypothesis && hyps.some(h => sameHypothesis(h, e.hypothesis!))) {
      link(hypId(e.hypothesis), e.id, e.stance === 'contradicts' ? 'contradicts' : e.stance === 'supports' ? 'supports' : 'about')
    }
  }
  for (const d of state.report?.differential ?? []) {
    const h = hypId(d.hypothesis)
    const target = (id: string) => (FINDING_ID.test(id) ? `f:${id}` : id)
    d.supporting_evidence_ids.forEach(id => link(h, target(id), 'supports'))
    d.contradicting_evidence_ids.forEach(id => link(h, target(id), 'contradicts'))
  }
  return { nodes: [...nodes.values()], links: [...links.values()] }
}

export function EvidenceGraph({ state, onSelectAgent }: { state: RunState; onSelectAgent: (id: string) => void }) {
  const graph = useMemo(() => buildGraph(state), [state.evidence, state.report, state.hypotheses, state.sources, state.nodes])
  const wrap = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const [, setTick] = useState(0)
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [manual, setManual] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Simulation: keep earlier positions so the graph grows instead of reshuffling.
  useEffect(() => {
    const { w, h } = size
    for (const n of graph.nodes) {
      const p = positions.current.get(n.id)
      if (p) { n.x = p.x; n.y = p.y } else { n.x = w / 2 + (Math.random() - 0.5) * 80; n.y = h / 2 + (Math.random() - 0.5) * 80 }
    }
    const sim = forceSimulation<GNode>(graph.nodes)
      .force('link', forceLink<GNode, GLink>(graph.links).id(d => d.id)
        .distance(l => (l.kind === 'found' ? 26 : l.kind === 'cites' ? 40 : 70)).strength(0.7))
      .force('charge', forceManyBody<GNode>().strength(d => (d.kind === 'hyp' ? -420 : -60)))
      .force('collide', forceCollide<GNode>(d => RADIUS[d.kind] + 3))
      .force('center', forceCenter(w / 2, h / 2))
      .force('x', forceX(w / 2).strength(0.03)).force('y', forceY(h / 2).strength(0.05))
      .alpha(positions.current.size ? 0.5 : 1)
    let raf = 0
    sim.on('tick', () => {
      for (const n of graph.nodes) positions.current.set(n.id, { x: n.x!, y: n.y! })
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setTick(t => t + 1))
    })
    return () => { sim.stop(); cancelAnimationFrame(raf) }
  }, [graph, size])

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of graph.links) {
      const s = typeof l.source === 'object' ? (l.source as GNode).id : String(l.source)
      const t = typeof l.target === 'object' ? (l.target as GNode).id : String(l.target)
      if (!m.has(s)) m.set(s, new Set()); if (!m.has(t)) m.set(t, new Set())
      m.get(s)!.add(t); m.get(t)!.add(s)
    }
    return m
  }, [graph])

  // Auto-fit the whole graph until the user pans or zooms.
  let transform = `translate(${view.x + size.w / 2 * (1 - view.k)},${view.y + size.h / 2 * (1 - view.k)}) scale(${view.k})`
  if (!manual && positions.current.size) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const n of graph.nodes) {
      const p = positions.current.get(n.id)
      if (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
    }
    const pad = 60
    const k = Math.min(1.6, (size.w - pad) / Math.max(1, x1 - x0), (size.h - pad - 30) / Math.max(1, y1 - y0))
    transform = `translate(${size.w / 2 - k * (x0 + x1) / 2},${(size.h - 30) / 2 - k * (y0 + y1) / 2}) scale(${k})`
  }
  const active = hover ?? focus
  const lit = active ? new Set([active, ...(neighbors.get(active) ?? [])]) : null
  const focused = graph.nodes.find(n => n.id === (focus ?? hover))


  const id = (x: unknown) => (typeof x === 'object' ? (x as GNode).id : String(x))
  return (
    <div className="graph-wrap" ref={wrap}
      onWheel={e => { setManual(true); const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); setView(v => ({ ...v, k })) }}
      onDoubleClick={() => { setManual(false); setView({ x: 0, y: 0, k: 1 }) }}
      onMouseDown={e => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } }}
      onMouseMove={e => { if (drag.current) setManual(true); if (drag.current) setView(v => ({ ...v, x: drag.current!.vx + e.clientX - drag.current!.x, y: drag.current!.vy + e.clientY - drag.current!.y })) }}
      onMouseUp={() => { drag.current = null }} onMouseLeave={() => { drag.current = null }}>
      {!graph.nodes.length && <div className="canvas-empty">The evidence graph fills in as agents record grounded findings: hypotheses,
        the findings that support or contradict them, their literature and investigation sources, and the case record they cite.</div>}
      <svg width={size.w} height={size.h}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g transform={transform}>
          {graph.links.map(l => {
            const s = positions.current.get(id(l.source)), t = positions.current.get(id(l.target))
            if (!s || !t) return null
            const on = !lit || (lit.has(id(l.source)) && lit.has(id(l.target)))
            return <line key={l.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y} className={`g-link k-${l.kind} ${on ? '' : 'dim'}`} />
          })}
          {graph.nodes.map(n => {
            const p = positions.current.get(n.id)
            if (!p) return null
            const r = RADIUS[n.kind] + (n.kind === 'hyp' ? Math.min(10, n.weight) : 0)
            const on = !lit || lit.has(n.id)
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`} className={`g-node k-${n.kind} ${on ? '' : 'dim'} ${focus === n.id ? 'focus' : ''}`}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => { setFocus(f => (f === n.id ? null : n.id)); if (n.refId) onSelectAgent(n.refId) }}>
                <circle r={r} filter={n.kind === 'hyp' || n.kind === 'heldout' ? 'url(#glow)' : undefined} />
                {(n.kind === 'hyp' || (lit && lit.has(n.id) && n.kind !== 'ev')) && (
                  <text y={n.kind === 'hyp' ? r + 14 : r + 11}>{n.label.length > 42 ? `${n.label.slice(0, 40)}…` : n.label}</text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="graph-legend">
        {(['hyp', 'ev', 'src', 'heldout', 'finding', 'agent'] as Kind[]).map(k => (
          <span key={k}><i className={`k-${k}`} />{KIND_LABEL[k]}</span>
        ))}
        <span><b className="k-supports" />supports</span><span><b className="k-contradicts" />contradicts</span>
      </div>
      {focused && (
        <div className="graph-card">
          <div className="graph-card-kind">{KIND_LABEL[focused.kind]}</div>
          <div className="graph-card-label">{focused.label}</div>
          {focused.detail && <div className="graph-card-detail">{focused.detail}</div>}
          <div className="muted">{neighbors.get(focused.id)?.size ?? 0} connections</div>
        </div>
      )}
    </div>
  )
}
