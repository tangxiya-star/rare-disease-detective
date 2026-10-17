import { Fragment } from 'react'
import { Activity, ClipboardList, Clock, FileText, FlaskConical, Hand, Microscope, Pill, Stethoscope, UserRound, type LucideIcon } from 'lucide-react'
import { api } from '../api'
import type { CaseView } from '../types'
import { MotionViewer } from './MotionViewer'

function Section({ title, icon: Icon, children, open = false }: {
  title: string; icon: LucideIcon; children: React.ReactNode; open?: boolean
}) {
  return (
    <details className="panel-section" open={open}>
      <summary><h3><span className="sec-icon"><Icon size={13} strokeWidth={2} /></span>{title}</h3></summary>
      {children}
    </details>
  )
}

export function PatientPanel({ view, highlighted, released, runId, showMotion = true }: {
  view: CaseView | null; highlighted: Set<string>; released: { gap_id: string; investigation: string }[]; runId: string | null
  showMotion?: boolean
}) {
  if (!view) return <div className="panel-body muted">Loading case…</div>
  const c = view.case
  const d = c.demographics
  const hl = (id: string) => (highlighted.has(id) ? 'cited' : '')
  return (
    <div className="panel-body">
      <div className="patient-head">
        <span className="patient-avatar"><UserRound size={22} strokeWidth={1.6} /></span>
        <div className="patient-id mono">{c.case_id}</div>
        <div className="patient-title">{c.title}</div>
        <div className="patient-demo">{d.age}{d.sex?.[0]?.toUpperCase()} · {d.handedness}-handed · {d.occupation}</div>
      </div>

      {showMotion && view.has_video && <MotionViewer view={view} highlighted={highlighted} />}

      {runId && released.map(m => (
        <section key={m.gap_id} className="panel-section reveal">
          <h3><span className="sec-icon"><FlaskConical size={13} strokeWidth={2} /></span>Released result · {m.investigation}</h3>
          <video className="video" src={`${api.mediaUrl(runId, m.gap_id)}#t=0.1`} preload="metadata" controls muted playsInline />
          <p className="fineprint">Released to the investigation on request ({m.gap_id}).</p>
        </section>
      ))}

      {!!c.motion_analysis?.length && (
        <Section title="Hand-tracking measurements · sent to agents" icon={Activity} open>
          <ul className="entries">
            {c.motion_analysis.map(e => (
              <li key={e.id} className={hl(e.id)}><span className="fid">{e.id}</span><b>{e.measure}</b> {e.result}</li>
            ))}
          </ul>
          <p className="fineprint">The models are text-only. These numbers, computed from the MediaPipe landmarks
            above, are how the video reaches them; agents cite them by id.</p>
        </Section>
      )}
      <Section title="Movement findings" icon={Hand} open>
        <ul className="entries">
          {c.movement_findings.map(f => (
            <li key={f.id} className={hl(f.id)}><span className="fid">{f.id}</span>{f.observation}</li>
          ))}
        </ul>
      </Section>
      <Section title="History" icon={FileText} open>
        <p className="lede">{c.chief_complaint}</p>
        <p>{c.history_of_present_illness}</p>
      </Section>
      <Section title="Timeline" icon={Clock}>
        <ul className="entries">
          {c.symptom_timeline.map(e => (
            <li key={e.id} className={hl(e.id)}><span className="fid">{e.id}</span><b>{e.when}</b> {e.event}</li>
          ))}
        </ul>
      </Section>
      <Section title="Neurological exam" icon={Stethoscope}>
        <dl className="kv">
          {Object.entries(c.neurological_exam).map(([k, v]) => (
            <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></Fragment>))}
        </dl>
      </Section>
      <Section title="Labs, imaging, neurophysiology" icon={Microscope}>
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
      <Section title="Medications, family, social" icon={Pill}>
        <p><b>Current:</b> {c.medications.current.join(', ') || 'none'}</p>
        <ul className="entries">
          {c.medications.prior_trials.map((m, i) => <li key={i}><b>{m.drug}</b> {m.dose} · {m.duration} · {m.response}</li>)}
        </ul>
        <p><b>Family:</b> {c.family_history}</p>
        <p><b>Social:</b> {c.social_history}</p>
      </Section>
      <Section title="Prior opinions" icon={ClipboardList}>
        <p>{c.prior_workup_and_opinions}</p>
      </Section>
    </div>
  )
}
