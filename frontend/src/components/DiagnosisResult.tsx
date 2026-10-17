import { CircleAlert, CircleCheck, CircleDashed, FlaskConical, Microscope, ShieldAlert } from 'lucide-react'
import type { RunState } from '../useRun'

const LEVEL: Record<string, number> = { high: 3, moderate: 2, low: 1 }

/** The run's answer: the ranked differential for clinician review, with what each rank rests on. */
export function DiagnosisResult({ state }: { state: RunState }) {
  const r = state.report
  if (!r) {
    return (
      <section className="panel-section dx">
        <div className="dx-head"><b>Working hypotheses</b><span className="dx-pending">report pending</span></div>
        {state.hypotheses.length
          ? <ol className="dx-working">{state.hypotheses.map(h => <li key={h}>{h}</li>)}</ol>
          : <p className="muted">{state.runId ? 'The lead has not proposed hypotheses yet.' : 'Start or replay a run.'}</p>}
      </section>
    )
  }
  const title = (id: string) => state.sources[id]?.title ?? id
  return (
    <section className="panel-section dx">
      <ol className="dx-list">
        {r.differential.map(d => {
          const results = d.supporting_evidence_ids.filter(id => id.startsWith('HELDOUT:'))
          return (
            <li key={d.rank} className={`dx-item c-${d.confidence} ${d.rank === 1 ? 'top' : ''}`}>
              <span className="dx-rank">{d.rank}</span>
              <div className="dx-body">
                <div className="dx-name">{d.hypothesis}</div>
                <div className="dx-meta">
                  <span className="dx-bar">{[1, 2, 3].map(i => <i key={i} className={i <= (LEVEL[d.confidence] ?? 0) ? 'on' : ''} />)}</span>
                  <span className="dx-conf">{d.confidence}</span>
                  <span className="dx-count sup">{d.supporting_evidence_ids.length} for</span>
                  {d.contradicting_evidence_ids.length > 0 && <span className="dx-count con">{d.contradicting_evidence_ids.length} against</span>}
                </div>
                {results.length > 0 && <div className="dx-results">{results.map(id => (
                  <span key={id} className="dx-result" title={state.sources[id]?.text}><FlaskConical size={11} />{title(id)}</span>))}</div>}
              </div>
            </li>
          )
        })}
      </ol>
      {r.cant_miss.length > 0 && <>
        <div className="dx-sub"><ShieldAlert size={12} />Can't-miss conditions</div>
        <ul className="dx-cant">{r.cant_miss.map(c => (
          <li key={c.condition} className={`cm-${c.status}`} title={c.basis}>
            {c.status === 'excluded' ? <CircleCheck size={13} /> : c.status === 'addressed' ? <CircleAlert size={13} /> : <CircleDashed size={13} />}
            <b>{c.condition}</b><span>{c.status}</span>
          </li>))}</ul>
      </>}
      {r.suggested_investigations.length > 0 && <>
        <div className="dx-sub"><Microscope size={12} />Suggested next</div>
        <ul className="dx-next">{r.suggested_investigations.map(s => <li key={s.investigation} title={s.rationale}>{s.investigation}</li>)}</ul>
      </>}
      <p className="fineprint">{r.disclaimer}</p>
    </section>
  )
}
