import { useState } from 'react'
import { describe } from '../beats'
import type { RunState } from '../useRun'
import { EvidenceItem } from './Inspector'

const QUIET = new Set(['node.status'])

// Fixed text, never model-written: the disclaimer must not go missing or be reworded.
export const FIXED_DISCLAIMER = 'Human-in-the-loop research prototype. Considerations for physician review; not a diagnosis, not advice to patients. The treating clinician decides every next step.'

function Report({ state }: { state: RunState }) {
  const r = state.report
  if (!r) return <p className="muted pad">The report appears when the lead has verified or explicitly left open every branch.</p>
  const evIndex = Object.fromEntries(state.evidence.map(e => [e.id, e]))
  const cite = (ids: string[]) => ids.map(id => (
    <span key={id} className={evIndex[id] ? 'src' : 'fid'} title={evIndex[id]?.claim}>{id}</span>))
  return (
    <div className="report pad">
      <p className="disclaimer">{FIXED_DISCLAIMER}</p>
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
      {!!r.dropped_already_resulted?.length && <p className="fineprint">Removed by code, result already obtained: {r.dropped_already_resulted.join('; ')}</p>}
      <h4>Unresolved questions</h4>
      <ul>{r.unresolved_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
    </div>
  )
}

export function BottomTabs({ state, onSelect }: { state: RunState; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<'events' | 'evidence' | 'report'>('events')
  const [open, setOpen] = useState(false)
  const pick = (x: typeof tab) => { if (x === tab && open) setOpen(false); else { setTab(x); setOpen(true) } }
  const [showDiscarded, setShowDiscarded] = useState(false)
  const events = state.events.filter(e => !QUIET.has(e.type))
  const evidence = state.evidence.filter(e => showDiscarded || e.grounded)
  return (
    <div className={`tabs ${open ? '' : 'collapsed'}`}>
      <div className="tab-bar">
        <button className={open && tab === 'events' ? 'on' : ''} onClick={() => pick('events')}>Agent events <span className="count">{events.length}</span></button>
        <button className={open && tab === 'evidence' ? 'on' : ''} onClick={() => pick('evidence')}>Evidence <span className="count">{state.evidence.filter(e => e.grounded).length}</span></button>
        <button className={open && tab === 'report' ? 'on' : ''} onClick={() => pick('report')}>Clinical report {state.report && <span className="dot" />}</button>
        {!open && events.length > 0 && (
          <div className="ticker"><span className="ev-type">{events[events.length - 1].type}</span>{describe(events[events.length - 1])}</div>
        )}
        <button className="tab-toggle" onClick={() => setOpen(o => !o)}>{open ? '▾ collapse' : '▴ expand'}</button>
        {open && tab === 'evidence' && (
          <label className="tab-opt"><input type="checkbox" checked={showDiscarded} onChange={e => setShowDiscarded(e.target.checked)} /> show discarded</label>
        )}
      </div>
      {open && <div className="tab-body">
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
      </div>}
    </div>
  )
}
