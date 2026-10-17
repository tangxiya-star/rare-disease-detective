import type { RunEvent } from './types'

export function describe(e: RunEvent): string {
  const d = e.data
  switch (e.type) {
    case 'run.started': return `Run started on ${d.case_id} (${d.llm_backend})`
    case 'node.status': return `${d.node_id} resumed from checkpoint ${d.checkpoint}`
    case 'node.created': return `${d.node.id} created at depth ${d.node.depth}: ${d.node.objective}`
    case 'node.decision': return `${d.node_id} decided ${d.action}${d.requested_children ? ` (${d.requested_children} children)` : ''}${d.trigger ? ' after verifier feedback' : ''}`
    case 'spawn.rejected': return `${d.node_id} spawn blocked: ${d.reason}`
    case 'search.performed': return `${d.node_id} searched “${d.query_used}”: ${d.results.length} results`
    case 'search.failed': return `${d.node_id} search unresolved: “${d.query}”`
    case 'heldout.released': return `${d.node_id} obtained ${d.investigation}`
    case 'heldout.unavailable': return `${d.node_id} requested “${d.request}”: ${d.status.replace('_', ' ')}`
    case 'evidence.added': return `${d.evidence.node_id} ${d.evidence.grounded ? 'recorded' : 'discarded'} finding: ${d.evidence.claim}`
    case 'verification': return `Verifier ${d.verdict} on ${d.node_id}${d.feedback ? `: ${d.feedback}` : ''}`
    case 'node.retry': return `${d.node_id} failed at ${d.checkpoint}, retrying: ${d.reason}`
    case 'node.recovered': return `${d.node_id} restored from checkpoint ${d.from_checkpoint}`
    case 'failure.injected': return `Failure injected: ${d.kind}${d.node_id ? ` on ${d.node_id}` : ''}`
    case 'report.ready': return 'Clinician-review report ready'
    case 'run.finished': return `Run ${d.status} with ${d.nodes} nodes`
    default: return e.type
  }
}

/**
 * A beat is a moment the stage can cut to. Pivots are the moments where the system
 * changes its mind or protects itself: the verifier pushes back, code discards a claim,
 * a spawn is blocked, an agent crashes and resumes, a requested result comes back.
 */
export type BeatKind =
  | 'case' | 'first-read' | 'investigate'
  | 'verdict' | 'accepted' | 'replan' | 'blocked' | 'discarded' | 'recovery' | 'withheld' | 'result'
  | 'reveal' | 'report'

export interface Beat { seq: number; ts: number; kind: BeatKind; nodeId?: string; event: RunEvent }

export const PIVOTS = new Set<BeatKind>(['verdict', 'replan', 'blocked', 'discarded', 'recovery', 'withheld', 'result', 'reveal', 'report', 'first-read'])

export const ACTS = [
  { n: 1, title: 'Case record', kinds: ['case', 'first-read'] },
  { n: 2, title: 'Investigation', kinds: ['investigate'] },
  { n: 3, title: 'Verify & recover', kinds: ['verdict', 'accepted', 'replan', 'blocked', 'discarded', 'recovery', 'withheld', 'result'] },
  { n: 4, title: 'Reveal', kinds: ['reveal'] },
  { n: 5, title: 'Report', kinds: ['report'] },
] as const

export const actOf = (k: BeatKind) => ACTS.find(a => (a.kinds as readonly string[]).includes(k))!.n

function beatOf(e: RunEvent, leadId: string | null): BeatKind | null {
  const d = e.data
  switch (e.type) {
    case 'run.started': return 'case'
    case 'node.decision':
      if (d.trigger === 'verifier') return 'replan'
      return d.node_id === leadId && d.action === 'spawn' ? 'first-read' : 'investigate'
    case 'node.created': case 'search.performed': case 'search.failed': return 'investigate'
    case 'evidence.added': return d.evidence.grounded ? 'investigate' : 'discarded'
    case 'verification': return d.verdict === 'accepted' ? 'accepted' : 'verdict'
    case 'spawn.rejected': return 'blocked'
    case 'failure.injected': case 'node.retry': case 'node.recovered': return 'recovery'
    case 'heldout.released': return d.media ? 'reveal' : 'result'
    case 'heldout.unavailable': return 'withheld'
    case 'report.ready': return 'report'
    default: return null
  }
}

/** One beat per meaningful event; repeats of the same pivot on the same node collapse into the first. */
export function beats(events: RunEvent[]): Beat[] {
  const out: Beat[] = []
  let leadId: string | null = null
  let firstRead = false
  let halted = false
  for (const e of events) {
    if (e.type === 'node.created' && !e.data.node.parent_id) leadId = e.data.node.id
    let kind = beatOf(e, leadId)
    // A run that stopped (run.finished: failed) and later moves again was resumed from SQLite.
    if (e.type === 'run.finished' && e.data.status === 'failed') { halted = true; kind = 'recovery' }
    else if (halted && e.type === 'node.status') { halted = false; kind = 'recovery' }
    if (!kind) continue
    if (kind === 'first-read') { if (firstRead) kind = 'investigate'; firstRead = true }
    const nodeId: string | undefined = e.data.node_id ?? e.data.node?.id ?? e.data.evidence?.node_id ?? undefined
    const prev = out[out.length - 1]
    const runLevel = e.type === 'run.finished' || e.type === 'node.status'
    if (prev && PIVOTS.has(kind) && prev.kind === kind && prev.nodeId === nodeId && !runLevel && prev.event.type !== 'run.finished') continue
    // a retry and its recovery are one moment; keep the later event so the card shows the outcome
    if (prev && kind === 'recovery' && prev.kind === 'recovery' && prev.event.type === 'failure.injected') {
      out[out.length - 1] = { ...prev, nodeId: nodeId ?? prev.nodeId, event: prev.event.type === 'failure.injected' ? e : prev.event }
      continue
    }
    out.push({ seq: e.seq, ts: e.ts, kind, nodeId, event: e })
  }
  return out
}
