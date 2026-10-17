import { useState } from 'react'
import type { RunEvent } from '../types'
import type { RunState } from '../useRun'
import { EvidenceItem } from './Inspector'

function describe(e: RunEvent): string {
  const d = e.data
  switch (e.type) {
    case 'run.started': return `Run started on ${d.case_id} (${d.llm_backend})`
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

const QUIET = new Set(['node.status'])

function Report({ state }: { state: RunState }) {
  const r = state.report
  if (!r) return <p className="muted pad">The report appears when the lead has verified or explicitly left open every branch.</p>
  const evIndex = Object.fromEntries(state.evidence.map(e => [e.id, e]))
  const cite = (ids: string[]) => ids.map(id => (
    <span key={id} className={evIndex[id] ? 'src' : 'fid'} title={evIndex[id]?.claim}>{id}</span>))
  return (
    <div className="report pad">
      <p className="disclaimer">{r.disclaimer}</p>
      <p>{r.summary}</p>
      <h4>Differential for clinician review</h4>
      <ol className="differential">
        {r.differential.map(d => (
          <li key={d.rank}>
            <div><b>{d.hypothesis}</b> <span className={`pill conf-${d.confidence}`}>{d.confidence}</span></div>
            {!!d.supporting_evidence_ids.length && <div className="cites">Supporting: {cite(d.supporting_evidence_ids)}</div>}
            {!!d.contradicting_evidence_ids.length && <div className="cites">Against: {cite(d.contradicting_evidence_ids)}</div>}
          </li>
        ))}
      </ol>
      <h4>Can't-miss causes</h4>
      <table className="cantmiss"><tbody>
        {r.cant_miss.map(c => (
          <tr key={c.condition}><td><b>{c.condition}</b></td><td><span className={`pill cm-${c.status}`}>{c.status}</span></td><td>{c.basis}</td></tr>
        ))}
      </tbody></table>
      <h4>Potentially discriminating investigations</h4>
      <ul>{r.suggested_investigations.map((s, i) => <li key={i}><b>{s.investigation}</b> <span className="muted">{s.rationale}</span></li>)}</ul>
      <h4>Unresolved questions</h4>
      <ul>{r.unresolved_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
    </div>
  )
}

export function BottomTabs({ state, onSelect }: { state: RunState; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<'events' | 'evidence' | 'report'>('events')
  const [showDiscarded, setShowDiscarded] = useState(false)
  const events = state.events.filter(e => !QUIET.has(e.type))
  const evidence = state.evidence.filter(e => showDiscarded || e.grounded)
  return (
    <div className="tabs">
      <div className="tab-bar">
        <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>Agent events <span className="count">{events.length}</span></button>
        <button className={tab === 'evidence' ? 'on' : ''} onClick={() => setTab('evidence')}>Evidence <span className="count">{state.evidence.filter(e => e.grounded).length}</span></button>
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>Clinical report {state.report && <span className="dot" />}</button>
        {tab === 'evidence' && (
          <label className="tab-opt"><input type="checkbox" checked={showDiscarded} onChange={e => setShowDiscarded(e.target.checked)} /> show discarded</label>
        )}
      </div>
      <div className="tab-body">
        {tab === 'events' && (
          <ol className="event-log">
            {[...events].reverse().map(e => (
              <li key={e.seq} className={`ev-${e.type.replace('.', '-')}`}
                onClick={() => { const id = e.data.node_id ?? e.data.node?.id ?? e.data.evidence?.node_id; if (id) onSelect(id) }}>
                <span className="mono muted">{String(e.seq).padStart(3, '0')}</span>
                <span className="ev-type">{e.type}</span>
                <span>{describe(e)}</span>
              </li>
            ))}
          </ol>
        )}
        {tab === 'evidence' && (
          <ul className="evidence-list pad">{evidence.map(e => <EvidenceItem key={e.id} ev={e} state={state} />)}</ul>
        )}
        {tab === 'report' && <Report state={state} />}
      </div>
    </div>
  )
}
