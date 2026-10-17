import { useMemo } from 'react'
import { BookOpen, Bot, FlaskConical, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react'
import type { RunEvent } from '../types'
import type { RunState } from '../useRun'

const POINTS = 48

/** Cumulative count of matching events across the run's timeline, sampled at POINTS steps. */
function series(events: RunEvent[], match: (e: RunEvent) => boolean): number[] {
  if (!events.length) return Array(POINTS).fill(0)
  const t0 = events[0].ts, span = Math.max(1e-6, events[events.length - 1].ts - t0)
  const out = Array(POINTS).fill(0)
  for (const e of events) if (match(e)) out[Math.min(POINTS - 1, Math.floor(((e.ts - t0) / span) * POINTS))]++
  for (let i = 1; i < POINTS; i++) out[i] += out[i - 1]
  return out
}

function Spark({ data, tone }: { data: number[]; tone: string }) {
  const max = Math.max(1, ...data)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - (v / max) * 24}`).join(' ')
  return (
    <svg className={`kpi-spark ${tone}`} viewBox="0 0 100 30" preserveAspectRatio="none">
      <polyline points={`0,30 ${pts} 100,30`} className="area" />
      <polyline points={pts} className="line" />
    </svg>
  )
}

type Kpi = { key: string; icon: LucideIcon; label: string; tag: string; value: string; sub: string; tone: string; data: number[] }

/** The run at a glance: one card per mechanism the judges should see working. */
export function KpiStrip({ state }: { state: RunState }) {
  const kpis: Kpi[] = useMemo(() => {
    const ev = state.events
    const nodes = Object.values(state.nodes)
    const grounded = state.evidence.filter(e => e.grounded).length
    const discarded = state.evidence.length - grounded
    const accepted = nodes.filter(n => n.verification === 'accepted').length
    const revise = nodes.filter(n => n.verification === 'revise' || n.verification === 'insufficient').length
    const results = new Set(ev.filter(e => e.type === 'heldout.released').map(e => e.data.gap_id)).size
    return [
      { key: 'agents', icon: Bot, label: 'Agents', tag: 'Recursion', tone: 'cyan',
        value: String(nodes.length), sub: `max depth ${nodes.reduce((m, n) => Math.max(m, n.depth), 0)}`,
        data: series(ev, e => e.type === 'node.created') },
      { key: 'evidence', icon: Sparkles, label: 'Findings', tag: 'Grounding', tone: 'violet',
        value: String(grounded), sub: `${discarded} discarded`,
        data: series(ev, e => e.type === 'evidence.added' && e.data.evidence?.grounded) },
      { key: 'sources', icon: BookOpen, label: 'Literature', tag: 'Europe PMC', tone: 'blue',
        value: String(Object.keys(state.sources).filter(s => !s.startsWith('HELDOUT:')).length), sub: 'papers retrieved',
        data: series(ev, e => e.type === 'search.performed') },
      { key: 'results', icon: FlaskConical, label: 'Test results', tag: 'Held out', tone: 'green',
        value: String(results), sub: 'on request',
        data: series(ev, e => e.type === 'heldout.released') },
      { key: 'verifier', icon: ShieldCheck, label: 'Verifier', tag: 'Checks', tone: 'rose',
        value: `${accepted}/${accepted + revise}`, sub: `${revise} sent back`,
        data: series(ev, e => e.type === 'verification') },
    ]
  }, [state.events, state.nodes, state.evidence, state.sources])

  return (
    <div className="kpi-strip">
      {kpis.map(k => (
        <div key={k.key} className={`kpi ${k.tone}`}>
          <div className="kpi-top" title={k.tag}>
            <span className="kpi-label">{k.label}</span>
          </div>
          <div className="kpi-mid">
            <span className="kpi-icon"><k.icon size={18} strokeWidth={1.8} /></span>
            <div>
              <div className="kpi-value">{k.value}</div>
              <div className="kpi-sub">{k.sub}</div>
            </div>
          </div>
          <Spark data={k.data} tone={k.tone} />
        </div>
      ))}
    </div>
  )
}
