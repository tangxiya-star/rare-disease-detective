import { useEffect, useMemo, useRef, useState } from 'react'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import type { RunState } from '../useRun'

type Kind = 'hyp' | 'concept' | 'ev' | 'src' | 'heldout' | 'finding' | 'agent'
interface GNode extends SimulationNodeDatum { id: string; kind: Kind; label: string; detail?: string; deg: number; refId?: string; born: number }
interface GLink extends SimulationLinkDatum<GNode> { id: string; kind: 'supports' | 'contradicts' | 'cites' | 'found' | 'about' | 'tree' | 'concept' }

const KIND_LABEL: Record<Kind, string> = {
  hyp: 'Hypothesis', concept: 'Clinical concept', ev: 'Grounded finding', src: 'Literature', heldout: 'Investigation result',
  finding: 'Case record', agent: 'Agent',
}
const COLOR: Record<Kind, string> = {
  hyp: '255,190,90', concept: '180,245,255', ev: '79,209,224', src: '120,190,215', heldout: '90,230,160', finding: '190,160,255', agent: '150,165,185',
}
const FINDING_ID = /^(mf|tl|lab|img|np)_\d+$|^(family_history|social_history|prior_workup_and_opinions|chief_complaint|history_of_present_illness|medications|neurological_exam)/

// Clinical concepts that become hubs when findings or sources mention them.
const CONCEPTS: [string, RegExp][] = [
  ['levodopa', /levodopa|l-dopa|dopa trial/i], ['GCH1', /gch1|gtp cyclohydrolase/i], ['DAT-SPECT', /\bdat\b|spect|ioflupane|transporter/i],
  ['CSF pterins', /csf|pterin|neopterin|biopterin|\bhva\b|homovanillic/i], ['Wilson disease', /wilson|atp7b/i],
  ['ceruloplasmin', /ceruloplasmin/i], ['copper', /copper/i], ['Kayser-Fleischer', /kayser|slit/i],
  ['dopa-responsive dystonia', /dopa-responsive|\bdrd\b|segawa/i], ['task-specific dystonia', /task-specific|musician|guitarist|writer'?s cramp|focal dystonia/i],
  ['diurnal variation', /diurnal|evening|sleep benefit/i], ['sensory trick', /sensory trick|geste/i], ['genetic testing', /genetic|sequencing|exome|variant|mutation|panel/i],
  ['TOR1A / THAP1', /tor1a|dyt1|thap1|dyt6/i], ['Parkinson disease', /parkinson|prkn|pink1/i], ['functional disorder', /functional|psychogenic/i],
  ['MRI', /\bmri\b|imaging/i], ['anticholinergic', /trihexyphenidyl|anticholinergic|clonazepam/i], ['botulinum toxin', /botulinum|bont/i],
  ['family history', /family|segregation|penetrance|relative/i], ['adult onset', /adult[- ]onset|age 27|young adult/i],
]

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
function sameHypothesis(a: string, b: string) {
  const ta = tokens(a), tb = tokens(b)
  if (!ta.size || !tb.size) return false
  let n = 0
  ta.forEach(w => { if (tb.has(w)) n++ })
  return n / Math.min(ta.size, tb.size) >= 0.5
}

/**
 * Agents, every retrieved source, grounded findings, case findings, hypotheses and clinical-concept hubs.
 * `groundedOnly` drops the keyword-association layer (concept hubs, retrieved-but-uncited sources),
 * leaving only links backed by a code-checked quote or a case finding id.
 */
function buildGraph(state: RunState, born: Map<string, number>, groundedOnly: boolean) {
  const nodes = new Map<string, GNode>()
  const links = new Map<string, GLink>()
  const now = performance.now()
  const add = (n: Omit<GNode, 'deg' | 'born'>) => {
    if (!nodes.has(n.id)) {
      if (!born.has(n.id)) born.set(n.id, now)
      nodes.set(n.id, { ...n, deg: 0, born: born.get(n.id)! })
    }
  }
  const link = (s: string, t: string, kind: GLink['kind']) => {
    if (!nodes.has(s) || !nodes.has(t) || s === t) return
    const id = `${s}>${t}`
    if (!links.has(id)) { links.set(id, { id, source: s, target: t, kind }); nodes.get(s)!.deg++; nodes.get(t)!.deg++ }
  }
  const concepts = (text: string, from: string) => {
    if (groundedOnly) return
    for (const [name, re] of CONCEPTS) if (re.test(text)) { add({ id: `c:${name}`, kind: 'concept', label: name }); link(from, `c:${name}`, 'concept') }
  }

  for (const id of state.order) {
    const n = state.nodes[id]
    add({ id: `a:${id}`, kind: 'agent', label: `${id} · ${n.objective}`, refId: id })
    if (n.parent_id) link(`a:${n.parent_id}`, `a:${id}`, 'tree')
  }
  const hyps: string[] = []
  for (const h of [...(state.report?.differential.map(d => d.hypothesis) ?? []), ...state.hypotheses]) {
    if (!hyps.some(x => sameHypothesis(x, h))) hyps.push(h)
  }
  const hypId = (h: string) => `h:${hyps.findIndex(x => sameHypothesis(x, h))}`
  hyps.forEach((h, i) => { add({ id: `h:${i}`, kind: 'hyp', label: h }); concepts(h, `h:${i}`) })
  for (const id of groundedOnly ? [] : state.order) {
    for (const s of state.activity[id]?.searches ?? []) {
      for (const r of s.results) {
        add({ id: `s:${r.source_id}`, kind: 'src', label: r.title || r.source_id, detail: r.source_id })
        link(`a:${id}`, `s:${r.source_id}`, 'found')
        concepts(r.title ?? '', `s:${r.source_id}`)
      }
    }
  }
  for (const e of state.evidence) {
    if (!e.grounded) continue
    add({ id: e.id, kind: 'ev', label: e.claim, detail: e.quote ?? undefined, refId: e.node_id })
    link(`a:${e.node_id}`, e.id, 'found')
    const sid = e.source_id
    if (sid && FINDING_ID.test(sid)) { add({ id: `f:${sid}`, kind: 'finding', label: sid }); link(e.id, `f:${sid}`, 'cites') }
    else if (sid) {
      const s = state.sources[sid]
      add({ id: `s:${sid}`, kind: sid.startsWith('HELDOUT:') ? 'heldout' : 'src', label: s?.title || sid, detail: s?.text ?? sid })
      link(e.id, `s:${sid}`, 'cites')
    }
    for (const f of e.finding_ids) { add({ id: `f:${f}`, kind: 'finding', label: f }); link(e.id, `f:${f}`, 'cites') }
    concepts(`${e.claim} ${e.quote ?? ''}`, e.id)
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

const radius = (n: GNode) =>
  n.kind === 'hyp' ? 7 + Math.min(10, Math.sqrt(n.deg) * 1.6)
    : n.kind === 'concept' ? 3 + Math.min(9, Math.sqrt(n.deg) * 1.3)
    : n.kind === 'agent' ? 2.6 : n.kind === 'heldout' ? 3.4 : n.kind === 'ev' ? 1.9 : 1.7

/** Graph id of an agent node, for `spotlight`. */
export const agentKey = (nodeId: string) => `a:${nodeId}`
/** Graph id of a held-out result or retrieved source, for `spotlight`. */
export const sourceKey = (sourceId: string) => `s:${sourceId}`

export function EvidenceGraph({ state, onSelectAgent, spotlight, rejected, padRight = 0 }: {
  state: RunState; onSelectAgent: (id: string) => void
  /** Graph ids to light up and frame (with their neighbours) while nothing is hovered or clicked. */
  spotlight?: string[]
  /** Evidence ids the verifier rejected: drawn with a red ring. */
  rejected?: Set<string>
  /** Pixels on the right covered by an overlay; the camera frames the remaining area. */
  padRight?: number
}) {
  const born = useRef(new Map<string, number>())
  const [groundedOnly, setGroundedOnly] = useState(false)
  const graph = useMemo(() => buildGraph(state, born.current, groundedOnly),
    [state.evidence, state.report, state.hypotheses, state.sources, state.order, state.activity, groundedOnly]) // eslint-disable-line react-hooks/exhaustive-deps
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
  const spotRef = useRef<string[]>([])
  spotRef.current = spotlight ?? []
  const rejectedRef = useRef<Set<string>>(new Set())
  rejectedRef.current = rejected ?? new Set()
  const padRef = useRef(0)
  padRef.current = padRight

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of graph.links) {
      const s = String(typeof l.source === 'object' ? (l.source as GNode).id : l.source)
      const t = String(typeof l.target === 'object' ? (l.target as GNode).id : l.target)
      if (!m.has(s)) m.set(s, new Set()); if (!m.has(t)) m.set(t, new Set())
      m.get(s)!.add(t); m.get(t)!.add(s)
    }
    return m
  }, [graph])
  const neighborsRef = useRef(neighbors)
  neighborsRef.current = neighbors

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
        .distance(l => (l.kind === 'tree' ? 34 : l.kind === 'found' ? 22 : l.kind === 'concept' ? 46 : 30))
        .strength(l => (l.kind === 'concept' ? 0.25 : 0.7)))
      .force('charge', forceManyBody<GNode>().strength(d => (d.kind === 'hyp' ? -260 : d.kind === 'concept' ? -120 : -18)).distanceMax(420))
      .force('collide', forceCollide<GNode>(d => radius(d) + 1.5))
      .force('x', forceX(0).strength(0.035)).force('y', forceY(0).strength(0.035))
      .alpha(positions.current.size ? 0.6 : 1).alphaDecay(0.02)
    sim.on('tick', () => { for (const n of graph.nodes) positions.current.set(n.id, { x: n.x!, y: n.y! }) })
    return () => { sim.stop() }
  }, [graph])

  // Render loop: canvas with additive glow.
  useEffect(() => {
    let raf = 0
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
        const spot = active ? [] : spotRef.current.filter(id => neighborsRef.current.has(id) || nodes.some(n => n.id === id))
        const lit = active ? new Set([active, ...(neighborsRef.current.get(active) ?? [])])
          : spot.length ? new Set(spot.flatMap(id => [id, ...(neighborsRef.current.get(id) ?? [])])) : null
        if (!view.current.manual && nodes.length) {
          // frame the spotlight (camera pushes in), otherwise the whole network
          const framed = spot.length && lit ? nodes.filter(n => lit.has(n.id)) : nodes
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
          for (const n of framed) { if (n.x == null) continue; x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y!); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y!) }
          const pad = spot.length ? 60 : 0
          x0 -= pad; x1 += pad; y0 -= pad; y1 += pad
          // leave room for labels left and right, and for the legend at the bottom
          // never let an overlay squeeze the framed area below 520px (narrow projectors)
          const fw = w - Math.min(padRef.current, Math.max(0, w - 520))
          const k = Math.min(spot.length ? 3 : 2.2, (fw - 220) / Math.max(1, x1 - x0), (h - 130) / Math.max(1, y1 - y0))
          const v = view.current
          const ease = spot.length ? 0.05 : 0.08
          v.k += (k - v.k) * ease
          v.x += (fw / 2 - v.k * (x0 + x1) / 2 - v.x) * ease
          v.y += ((h - 50) / 2 - v.k * (y0 + y1) / 2 - v.y) * ease
        }
        const { x: tx, y: ty, k } = view.current
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.fillStyle = '#030507'
        g.fillRect(0, 0, w, h)
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
          const base = l.kind === 'supports' ? '80,230,150' : l.kind === 'contradicts' ? '255,110,110' : l.kind === 'tree' ? '255,190,90' : '79,209,224'
          const a = on ? (strong ? 0.75 : l.kind === 'tree' ? 0.35 : lit ? 0.6 : 0.16) : 0.025
          g.strokeStyle = `rgba(${base},${a})`
          g.lineWidth = (strong ? 1.3 : 0.55) / Math.sqrt(k)
          g.beginPath(); g.moveTo(s.x, s.y!); g.lineTo(t.x, t.y!); g.stroke()
        }
        for (const n of nodes) {
          if (n.x == null) continue
          const on = !lit || lit.has(n.id)
          const r = radius(n)
          const age = Math.min(1, (now - n.born) / 900)
          const col = COLOR[n.kind]
          const alpha = on ? 1 : 0.12
          if (n.kind === 'hyp' || n.kind === 'concept' || n.kind === 'heldout' || age < 1) {
            const glow = r * (n.kind === 'hyp' ? 5 : 3.2) * (age < 1 ? 1.6 - 0.6 * age : 1)
            const grad = g.createRadialGradient(n.x, n.y!, 0, n.x, n.y!, glow)
            grad.addColorStop(0, `rgba(${col},${0.45 * alpha})`); grad.addColorStop(1, `rgba(${col},0)`)
            g.fillStyle = grad
            g.beginPath(); g.arc(n.x, n.y!, glow, 0, Math.PI * 2); g.fill()
          }
          g.fillStyle = `rgba(${col},${0.95 * alpha})`
          g.beginPath(); g.arc(n.x, n.y!, r * (0.4 + 0.6 * age), 0, Math.PI * 2); g.fill()
          if (n.kind === 'hyp' || n.kind === 'concept') {
            g.fillStyle = `rgba(255,255,255,${0.9 * alpha})`
            g.beginPath(); g.arc(n.x, n.y!, r * 0.35, 0, Math.PI * 2); g.fill()
          }
          if (rej.has(n.id)) {
            g.strokeStyle = `rgba(255,110,110,${0.95 * alpha})`; g.lineWidth = 1.2 / Math.sqrt(k)
            g.beginPath(); g.arc(n.x, n.y!, r + 3.5, 0, Math.PI * 2); g.stroke()
          }
          if (spotSet.has(n.id)) {
            // sonar ring on the node the stage is talking about
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
          const hub = n.kind === 'hyp' || n.kind === 'concept'
          if (!hub && k < 0.5 && !(lit && on)) continue
          const size = (hub ? (n.kind === 'hyp' ? 12 : 9.5) : 6.5) / Math.max(0.6, Math.min(k, 1.6))
          const text = n.kind === 'agent' ? n.label.split(' · ')[0] : n.label.length > 38 ? `${n.label.slice(0, 36)}…` : n.label
          g.font = `${hub ? 600 : 400} ${size}px Inter, sans-serif`
          g.fillStyle = n.kind === 'hyp' ? `rgba(255,200,120,${on ? 1 : 0.15})`
            : hub ? `rgba(200,250,255,${on ? 0.92 : 0.12})` : `rgba(160,205,220,${on ? (lit ? 0.85 : 0.38) : 0.06})`
          g.fillText(text, n.x, n.y! - radius(n) - 3)
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
  const focused = graph.nodes.find(n => n.id === (hover ?? focus))
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
          if (n?.refId) onSelectAgent(n.refId)
        }
        drag.current = null
      }}
      onMouseLeave={() => { drag.current = null; setHover(null) }}>
      <canvas ref={canvas} />
      {!graph.nodes.length && <div className="canvas-empty">The evidence graph fills in as agents search, retrieve and record grounded
        findings: hypotheses and clinical concepts become hubs; literature, results and case findings connect to them.</div>}
      <div className="graph-stats">
        <span><b>{graph.nodes.length}</b> nodes</span><span><b>{graph.links.length}</b> links</span>
        <span><b>{counts.src ?? 0}</b> sources</span>{!groundedOnly && <span><b>{counts.concept ?? 0}</b> concepts</span>}
      </div>
      <div className="graph-layer seg" onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}>
        <button className={groundedOnly ? '' : 'on'} onClick={() => setGroundedOnly(false)}
          title="Everything retrieved, plus keyword-matched clinical concept hubs">All associations</button>
        <button className={groundedOnly ? 'on' : ''} onClick={() => setGroundedOnly(true)}
          title="Only links backed by a verbatim quote or a case finding id">Grounded only</button>
      </div>
      <div className="graph-legend">
        {(['hyp', 'concept', 'ev', 'src', 'heldout', 'finding', 'agent'] as Kind[]).map(k => (
          <span key={k}><i style={{ background: `rgb(${COLOR[k]})`, boxShadow: `0 0 6px rgb(${COLOR[k]})` }} />{KIND_LABEL[k]}</span>
        ))}
        <span><b className="k-supports" />supports</span><span><b className="k-contradicts" />contradicts</span>
      </div>
      {focused && (
        <div className="graph-card">
          <div className="graph-card-kind">{KIND_LABEL[focused.kind]} · {neighbors.get(focused.id)?.size ?? 0} connections</div>
          <div className="graph-card-label">{focused.label}</div>
          {focused.detail && <div className="graph-card-detail">{focused.detail.length > 280 ? `${focused.detail.slice(0, 278)}…` : focused.detail}</div>}
        </div>
      )}
    </div>
  )
}
