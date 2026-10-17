import type { Evidence } from '../types'
import type { RunState } from '../useRun'
import { STATUS_LABEL } from './AgentTree'

function SourceLink({ id, state }: { id: string | null; state: RunState }) {
  if (!id) return null
  const s = state.sources[id]
  if (s?.url) return <a className="src" href={s.url} target="_blank" rel="noreferrer" title={s.title}>{id}</a>
  return <span className={`src ${s?.held_out ? 'heldout' : ''}`} title={s?.title}>{id}</span>
}

export function EvidenceItem({ ev, state, rejected }: { ev: Evidence; state: RunState; rejected?: boolean }) {
  return (
    <li className={`evidence ${ev.grounded ? '' : 'ungrounded'} ${rejected ? 'rejected' : ''}`}>
      <div className="ev-head">
        <span className={`pill stance-${ev.stance ?? 'neutral'}`}>{ev.stance ?? 'neutral'}</span>
        <span className={`pill ${ev.grounded ? 'ok' : 'bad'}`} title={ev.grounding_note ?? ''}>
          {ev.grounded ? 'grounded' : 'discarded'}
        </span>
        {rejected && <span className="pill bad">rejected by verifier</span>}
        <SourceLink id={ev.source_id} state={state} />
        {ev.finding_ids.map(f => <span key={f} className="fid">{f}</span>)}
      </div>
      <div className="ev-claim">{ev.claim}</div>
      {ev.quote && <blockquote>{ev.quote}</blockquote>}
      {!ev.grounded && <div className="fineprint">{ev.grounding_note}</div>}
    </li>
  )
}

export function Inspector({ state, selected }: { state: RunState; selected: string | null }) {
  const node = selected ? state.nodes[selected] : null
  if (!node) {
    const n = Object.values(state.nodes)
    const grounded = state.evidence.filter(e => e.grounded).length
    return (
      <div className="panel-body">
        <section className="panel-section">
          <h3>Run</h3>
          {state.runId ? (
            <dl className="kv">
              <dt>Nodes</dt><dd>{n.length} (max depth {Math.max(0, ...n.map(x => x.depth))})</dd>
              <dt>Accepted</dt><dd>{n.filter(x => x.verification === 'accepted').length}</dd>
              <dt>Revise / insufficient</dt><dd>{n.filter(x => ['revise', 'insufficient'].includes(x.verification)).length}</dd>
              <dt>Evidence</dt><dd>{grounded} grounded · {state.evidence.length - grounded} discarded</dd>
              <dt>Retries</dt><dd>{n.reduce((s, x) => s + x.retry_count, 0)}</dd>
            </dl>
          ) : <p className="muted">No run yet.</p>}
          <p className="muted">Select a node to inspect its decision, evidence and verification.</p>
        </section>
      </div>
    )
  }
  const a = state.activity[node.id]
  const ev = state.evidence.filter(e => e.node_id === node.id)
  const rejected = new Set(a?.verification?.rejected ?? [])
  const parent = node.parent_id ? state.nodes[node.parent_id] : null

  return (
    <div className="panel-body">
      <section className="panel-section">
        <div className="insp-meta">
          <span className="mono">{node.id}</span>
          <span>{node.role === 'lead' ? 'Lead' : `Investigator · depth ${node.depth}`}</span>
          <span className="mono">{node.model.split('/').pop()}</span>
        </div>
        <h2 className="insp-objective">{node.objective}</h2>
        {node.justification && <p className="muted">Why: {node.justification}</p>}
        {parent && <p className="fineprint">Spawned by {parent.id}</p>}
        <div className="insp-status">
          <span className={`pill s-${node.status}`}>{STATUS_LABEL[node.status]}</span>
          <span className="pill">checkpoint: {node.checkpoint}</span>
          {node.verification !== 'pending' && <span className={`pill verdict-${node.verification}`}>{node.verification}</span>}
        </div>
      </section>

      {a?.verification && (
        <section className={`panel-section verifier v-${a.verification.verdict}`}>
          <h3>Verifier decision</h3>
          <p><b>{a.verification.verdict.toUpperCase()}</b> {a.verification.feedback}</p>
        </section>
      )}

      {!!a?.decisions.length && (
        <section className="panel-section">
          <h3>Runtime decisions</h3>
          <ul className="entries">
            {a.decisions.map((d, i) => (
              <li key={i}>
                <b>{d.action}{d.requested ? ` · ${d.requested} requested` : ''}</b>
                {d.trigger === 'verifier' && <span className="pill warn">after verifier on {d.about}</span>} {d.rationale}
              </li>
            ))}
            {a.rejectedSpawns.map((r, i) => (
              <li key={`r${i}`} className="rejected"><b>Blocked by validator:</b> {r.reason}<div className="muted">{r.objective}</div></li>
            ))}
          </ul>
        </section>
      )}

      {!!a?.investigations.length && (
        <section className="panel-section">
          <h3>Investigations requested</h3>
          <ul className="entries">
            {a.investigations.map((x, i) => (
              <li key={i} className={x.status === 'released' ? 'released' : 'muted'}>
                <b>{x.request}</b> · {x.status === 'released' ? <span className="pill ok">released</span> : <span className="pill">{x.status.replace('_', ' ')}</span>}
                {x.result && <blockquote>{x.result}</blockquote>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!a?.searches.length && (
        <section className="panel-section">
          <h3>Literature searches</h3>
          <ul className="entries">
            {a.searches.map((s, i) => (
              <li key={i}>
                <span className="mono">“{s.query}”</span> {s.ok ? `${s.results.length} results` : <span className="pill bad">unresolved</span>}
                {s.attempts.some(x => !x.ok) && <span className="pill warn">{s.attempts.filter(x => !x.ok).length} failed attempt(s), recovered</span>}
                <ul className="sources">
                  {s.results.map(r => <li key={r.source_id}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> <span className="mono muted">{r.source_id}</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!ev.length && (
        <section className="panel-section">
          <h3>Findings</h3>
          <ul className="evidence-list">{ev.map(e => <EvidenceItem key={e.id} ev={e} state={state} rejected={rejected.has(e.id)} />)}</ul>
        </section>
      )}

      {!!(a?.retries.length || a?.recovered.length) && (
        <section className="panel-section">
          <h3>Recovery</h3>
          <ul className="entries">
            {a!.retries.map((r, i) => <li key={i}>↻ attempt {r.attempt} failed at <b>{r.checkpoint}</b>: <span className="muted">{r.reason}</span></li>)}
            {a!.recovered.map((c, i) => <li key={`c${i}`}>Restored from checkpoint <b>{c}</b>; finished stages not rerun.</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
