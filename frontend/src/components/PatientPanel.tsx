import { Fragment, useRef, useState } from 'react'
import { api } from '../api'
import type { Annotation, CaseView } from '../types'

function fmt(t: number) {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`
}

function MotionViewer({ view, highlighted }: { view: CaseView; highlighted: Set<string> }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const anns: Annotation[] = (view.annotations?.annotations ?? []).filter(a => a.t_start != null)
  const active = anns.filter(a => t >= a.t_start && t <= a.t_end)
  const seek = (s: number) => { if (ref.current) { ref.current.currentTime = s; ref.current.play() } }

  return (
    <section className="panel-section">
      <h3>Movement video</h3>
      {view.has_video ? (
        <>
          <video ref={ref} className="video" src={`${api.videoUrl(view.slot, view.mode)}#t=0.1`} preload="metadata" controls muted playsInline
            onTimeUpdate={e => setT(e.currentTarget.currentTime)}
            onLoadedMetadata={e => setDur(e.currentTarget.duration)} />
          {dur > 0 && (
            <div className="ann-track" title="Physician-reviewed annotations">
              {anns.map((a, i) => (
                <button key={i} className={`ann-seg ${active.includes(a) ? 'on' : ''} ${highlighted.has(a.finding_id) ? 'cited' : ''}`}
                  style={{ left: `${(a.t_start / dur) * 100}%`, width: `${Math.max(1.5, ((a.t_end - a.t_start) / dur) * 100)}%` }}
                  onClick={() => seek(a.t_start)} title={`${fmt(a.t_start)}–${fmt(a.t_end)} ${a.label}`} />
              ))}
              <div className="ann-head" style={{ left: `${(t / dur) * 100}%` }} />
            </div>
          )}
          <ul className="ann-list">
            {anns.map((a, i) => (
              <li key={i} className={active.includes(a) ? 'on' : ''} onClick={() => seek(a.t_start)}>
                <span className="mono">{fmt(a.t_start)}</span>
                <span>{a.label}</span>
                <span className={`fid ${highlighted.has(a.finding_id) ? 'cited' : ''}`}>{a.finding_id}</span>
              </li>
            ))}
          </ul>
          <p className="fineprint">{view.annotations?.video?.license}</p>
        </>
      ) : (
        <p className="muted">No clinical video for this case.</p>
      )}
    </section>
  )
}

function Section({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="panel-section" open={open}>
      <summary><h3>{title}</h3></summary>
      {children}
    </details>
  )
}

export function PatientPanel({ view, highlighted, released, runId }: {
  view: CaseView | null; highlighted: Set<string>; released: { gap_id: string; investigation: string }[]; runId: string | null
}) {
  if (!view) return <div className="panel-body muted">Loading case…</div>
  const c = view.case
  const d = c.demographics
  const hl = (id: string) => (highlighted.has(id) ? 'cited' : '')
  return (
    <div className="panel-body">
      <div className="patient-head">
        <div className="patient-id mono">{c.case_id}</div>
        <div className="patient-title">{c.title}</div>
        <div className="patient-demo">{d.age}{d.sex?.[0]?.toUpperCase()} · {d.handedness}-handed · {d.occupation}</div>
      </div>

      {view.has_video && <MotionViewer view={view} highlighted={highlighted} />}

      {runId && released.map(m => (
        <section key={m.gap_id} className="panel-section reveal">
          <h3>Released result · {m.investigation}</h3>
          <video className="video" src={`${api.mediaUrl(runId, m.gap_id)}#t=0.1`} preload="metadata" controls muted playsInline />
          <p className="fineprint">Released to the investigation on request ({m.gap_id}).</p>
        </section>
      ))}

      <Section title="Movement findings" open>
        <ul className="entries">
          {c.movement_findings.map(f => (
            <li key={f.id} className={hl(f.id)}><span className="fid">{f.id}</span>{f.observation}</li>
          ))}
        </ul>
      </Section>
      <Section title="History" open>
        <p className="lede">{c.chief_complaint}</p>
        <p>{c.history_of_present_illness}</p>
      </Section>
      <Section title="Timeline">
        <ul className="entries">
          {c.symptom_timeline.map(e => (
            <li key={e.id} className={hl(e.id)}><span className="fid">{e.id}</span><b>{e.when}</b> {e.event}</li>
          ))}
        </ul>
      </Section>
      <Section title="Neurological exam">
        <dl className="kv">
          {Object.entries(c.neurological_exam).map(([k, v]) => (
            <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></Fragment>))}
        </dl>
      </Section>
      <Section title="Labs, imaging, neurophysiology">
        <ul className="entries">
          {[...c.labs, ...c.imaging, ...(c.neurophysiology ?? [])].map(e => (
            <li key={e.id} className={hl(e.id)}>
              <span className="fid">{e.id}</span>
              <b>{e.test ?? e.modality ?? e.study}</b> {e.result ?? e.report}
              {e.reference_range ? <span className="muted"> (ref {e.reference_range})</span> : null}
              {e.note ? <span className="muted"> · {e.note}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Medications, family, social">
        <p><b>Current:</b> {c.medications.current.join(', ') || 'none'}</p>
        <ul className="entries">
          {c.medications.prior_trials.map((m, i) => <li key={i}><b>{m.drug}</b> {m.dose} · {m.duration} · {m.response}</li>)}
        </ul>
        <p><b>Family:</b> {c.family_history}</p>
        <p><b>Social:</b> {c.social_history}</p>
      </Section>
      <Section title="Prior opinions">
        <p>{c.prior_workup_and_opinions}</p>
      </Section>
    </div>
  )
}
