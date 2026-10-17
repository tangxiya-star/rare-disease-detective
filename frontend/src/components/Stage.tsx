import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { ACTS, actOf, describe, type Beat } from '../beats'
import type { CaseEntry, CaseView, Mode } from '../types'
import type { RunState } from '../useRun'
import { AgentTree } from './AgentTree'
import { EvidenceGraph, agentKey, sourceKey } from './EvidenceGraph'
import { MotionViewer } from './MotionViewer'

const FINDING_ID = /^(mf|tl|lab|img|np|ma)_\d+$/
const CHECKPOINTS = {
  lead: ['created', 'analyzed', 'children_spawned', 'children_done', 'reported'],
  investigator: ['created', 'planned', 'research_done', 'analyzed', 'children_spawned', 'children_done', 'finished'],
}
const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

type Shot = 'dossier' | 'graph' | 'reveal' | 'report'

function shotFor(beat: Beat | null, pinned: number | null): Shot {
  const act = pinned ?? (beat ? actOf(beat.kind) : 1)
  return act === 1 ? 'dossier' : act === 4 ? 'reveal' : act === 5 ? 'report' : 'graph'
}

/** How often each case finding id has been cited by grounded evidence so far. */
function citations(state: RunState) {
  const m = new Map<string, number>()
  const bump = (id: string) => m.set(id, (m.get(id) ?? 0) + 1)
  for (const e of state.evidence) {
    if (!e.grounded) continue
    e.finding_ids.forEach(bump)
    if (e.source_id && FINDING_ID.test(e.source_id)) bump(e.source_id)
  }
  return m
}

// ─── Act 1: the whole case record, as the agents receive it ────────────────────────────────

function Entry({ e, cited, children }: { e: CaseEntry; cited: Map<string, number>; children: React.ReactNode }) {
  const n = cited.get(e.id) ?? 0
  return (
    <li className={n ? 'cited' : ''}>
      <span className="fid">{e.id}</span>{children}
      {n > 0 && <span className="cite-n" title="Cited by grounded findings">cited ×{n}</span>}
    </li>
  )
}

function Dossier({ view, state, highlighted }: { view: CaseView; state: RunState; highlighted: Set<string> }) {
  const c = view.case
  const d = c.demographics
  const cited = citations(state)
  const ids = [...c.symptom_timeline, ...c.movement_findings, ...c.labs, ...c.imaging, ...(c.neurophysiology ?? []), ...(c.motion_analysis ?? [])]
  const lead = state.order.map(id => state.nodes[id]).find(n => n.role === 'lead')
  const firstRead = lead ? state.activity[lead.id]?.decisions[0] : undefined
  const results = [...c.labs, ...c.imaging, ...(c.neurophysiology ?? [])]

  return (
    <div className="dossier">
      <div className="dossier-intake">
        <div><b>Case record sent to every agent</b> · {ids.length} citable findings by id, plus history, exam and medications.</div>
        <div className="muted">Never sent: the reference diagnosis. Held-out results are released only when an agent requests that investigation.</div>
      </div>
      <div className="dossier-grid">
        <div className="dossier-col motion-col">
          <div className="d-card patient">
            <div className="mono muted">{c.case_id}</div>
            <div className="d-title">{c.title}</div>
            <div className="d-demo">{d.age}{d.sex?.[0]?.toUpperCase()} · {d.handedness}-handed · {d.occupation}</div>
            <p className="d-lede">{c.chief_complaint}</p>
          </div>
          {view.has_video && <MotionViewer view={view} highlighted={highlighted} />}
        </div>
        <div className="dossier-col">
          <div className="d-card">
            <h4>History of present illness</h4>
            <p>{c.history_of_present_illness}</p>
          </div>
          <div className="d-card">
            <h4>Symptom timeline</h4>
            <ol className="d-timeline">
              {c.symptom_timeline.map(e => <Entry key={e.id} e={e} cited={cited}><b>{e.when}</b> {e.event}</Entry>)}
            </ol>
          </div>
          <div className="d-card">
            <h4>Movement findings</h4>
            <ul className="d-entries">{c.movement_findings.map(e => <Entry key={e.id} e={e} cited={cited}>{e.observation}</Entry>)}</ul>
          </div>
        </div>
        <div className="dossier-col">
          <div className="d-card">
            <h4>Neurological exam</h4>
            <dl className="kv">
              {Object.entries(c.neurological_exam).map(([k, v]) => <Fragment key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></Fragment>)}
            </dl>
          </div>
          <div className="d-card">
            <h4>Labs · imaging · neurophysiology</h4>
            <ul className="d-entries">
              {results.map(e => (
                <Entry key={e.id} e={e} cited={cited}>
                  <b>{e.test ?? e.modality ?? e.study}</b> {e.result ?? e.report}
                  {e.reference_range ? <span className="muted"> (ref {e.reference_range})</span> : null}
                </Entry>
              ))}
            </ul>
          </div>
          <div className="d-card">
            <h4>Medications</h4>
            <ul className="d-entries">
              {c.medications.prior_trials.map((m, i) => <li key={i}><b>{m.drug}</b> {m.dose} · {m.response}</li>)}
            </ul>
            <h4>Family · social · prior opinions</h4>
            <p>{c.family_history}</p>
            <p className="muted">{c.prior_workup_and_opinions}</p>
          </div>
          {!!c.motion_analysis?.length && (
            <div className="d-card">
              <h4>Hand-tracking measurements · sent as text</h4>
              <ul className="d-entries">{c.motion_analysis.map(e => <Entry key={e.id} e={e} cited={cited}><b>{e.measure}</b> {e.result}</Entry>)}</ul>
            </div>
          )}
        </div>
      </div>
      {lead && firstRead && (
        <div className="first-read" key={lead.id}>
          <div className="kicker">Lead · {lead.model.includes('Super') ? 'Nemotron Super' : lead.model.split('/').pop()} read the record</div>
          <div className="fr-hyps">{state.hypotheses.map(h => <span key={h} className="hyp-chip">{h}</span>)}</div>
          <p>{short(firstRead.rationale, 220)}</p>
          {firstRead.requested > 0 && <div className="fr-spawn">→ delegated to {firstRead.requested} investigators, each created by this decision</div>}
        </div>
      )}
    </div>
  )
}

// ─── Act 3: pivot cards over the graph ─────────────────────────────────────────────────────

/** Nodes the given node spawned after event `seq` (e.g. the replan after a verifier rejection). */
function spawnedAfter(state: RunState, parent: string, seq: number) {
  return state.events.filter(e => e.type === 'node.created' && e.seq > seq && e.data.node.parent_id === parent).map(e => e.data.node.id as string)
}

function CheckpointChain({ state, nodeId }: { state: RunState; nodeId: string }) {
  const n = state.nodes[nodeId]
  const a = state.activity[nodeId]
  if (!n) return null
  const chain = CHECKPOINTS[n.role]
  const failedAt = a?.retries[a.retries.length - 1]?.checkpoint
  const restored = a?.recovered[a.recovered.length - 1]
  const reached = chain.indexOf(n.checkpoint)
  return (
    <ol className="cp-chain">
      {chain.map((c, i) => (
        <li key={c} className={`${i <= reached ? 'done' : ''} ${c === failedAt ? 'crash' : ''} ${c === restored ? 'restore' : ''}`}>
          <i />{c.replace(/_/g, ' ')}
          {c === failedAt && <span className="cp-tag bad">crash after save</span>}
          {c === restored && <span className="cp-tag ok">resumed here</span>}
        </li>
      ))}
    </ol>
  )
}

function PivotCard({ beat, state }: { beat: Beat; state: RunState }) {
  const d = beat.event.data
  const node = beat.nodeId ? state.nodes[beat.nodeId] : undefined
  const about = node && <div className="pv-about"><span className="mono">{node.id}</span> {short(node.objective, 110)}</div>
  // what a replan produced: new agents, and requests the validator refused
  const followUps = (parent: string, seq: number) => {
    const ids = spawnedAfter(state, parent, seq)
    const blocked = state.events.filter(e => e.type === 'spawn.rejected' && e.seq > seq && e.seq < seq + 12 && e.data.node_id === parent)
    return ids.length || blocked.length ? (
      <div className="pv-follow">
        {ids.map(id => <div key={id}>→ <span className="mono">{id}</span> {short(state.nodes[id]?.objective ?? '', 110)}</div>)}
        {blocked.map(e => <div key={e.seq} className="pv-blocked">✕ blocked by validator: {short(e.data.reason, 120)}</div>)}
      </div>
    ) : null
  }

  switch (beat.kind) {
    case 'verdict': {
      const evIndex = Object.fromEntries(state.evidence.map(e => [e.id, e]))
      const replan = state.events.find(e => e.type === 'node.decision' && e.data.trigger === 'verifier' && e.data.about === beat.nodeId && e.seq > beat.seq)
      return (
        <div className="pivot warn">
          <div className="kicker">Independent verifier · {d.verdict.toUpperCase()}</div>
          <h3>The verifier pushed back</h3>
          {about}
          <blockquote className="pv-quote">{d.feedback}</blockquote>
          {(d.rejected_evidence_ids as string[]).map(id => <div key={id} className="pv-struck">{evIndex[id]?.claim ?? id}</div>)}
          {replan ? <><div className="kicker sub">{replan.data.node_id} replanned</div>{followUps(replan.data.node_id, replan.seq)}</>
            : <div className="pv-wait">Waiting for the parent to replan…</div>}
        </div>
      )
    }
    case 'replan':
      return (
        <div className="pivot warn">
          <div className="kicker">Replanning · triggered by the verifier on {d.about}</div>
          <h3>{state.nodes[d.node_id]?.role === 'lead' ? 'The lead' : d.node_id} changed its plan</h3>
          <p>{short(d.rationale, 240)}</p>
          {followUps(d.node_id, beat.seq)}
        </div>
      )
    case 'accepted':
      return (
        <div className="pivot ok small">
          <div className="kicker">Independent verifier · ACCEPTED</div>
          {about}
        </div>
      )
    case 'blocked':
      return (
        <div className="pivot bad">
          <div className="kicker">Python validator · spawn rejected</div>
          <h3>A requested agent was not created</h3>
          <div className="pv-struck">{d.objective}</div>
          <p><b>Reason:</b> {d.reason}</p>
          <div className="fineprint">Enforced in code, not the prompt: depth, node budget, duplicate objectives, scope.</div>
        </div>
      )
    case 'discarded': {
      const ev = d.evidence
      return (
        <div className="pivot bad">
          <div className="kicker">Grounding check · claim discarded</div>
          <h3>Code threw out an unsupported finding</h3>
          {about}
          <div className="pv-struck">{ev.claim}</div>
          {ev.quote && <blockquote className="pv-quote">{short(ev.quote, 220)}</blockquote>}
          <p className="muted">{ev.grounding_note}</p>
        </div>
      )
    }
    case 'recovery': {
      if (beat.event.type === 'run.finished') {
        return (
          <div className="pivot bad">
            <div className="kicker">Run halted · retries exhausted</div>
            <h3>The run stopped, with every checkpoint saved</h3>
            <p className="muted">Each agent's progress is in SQLite, so the run can continue later without redoing finished work.</p>
          </div>
        )
      }
      if (beat.event.type === 'node.status') {
        return (
          <div className="pivot ok">
            <div className="kicker">Run resumed from SQLite</div>
            <h3>Picked up at “{d.checkpoint.replace(/_/g, ' ')}”</h3>
            {about}
            {beat.nodeId && <CheckpointChain state={state} nodeId={beat.nodeId} />}
            <div className="fineprint">Finished agents and their evidence were not rerun.</div>
          </div>
        )
      }
      if (beat.event.type === 'failure.injected') {
        return (
          <div className="pivot bad">
            <div className="kicker">Failure injection · {d.kind.replace('_', ' ')}</div>
            <h3>{d.kind === 'agent_crash' ? 'An agent will crash after its next checkpoint' : 'The next searches will fail'}</h3>
            <p className="muted">{d.node_id ? `Target: ${d.node_id}` : 'Target: the next agent to save a checkpoint'}</p>
          </div>
        )
      }
      const a = beat.nodeId ? state.activity[beat.nodeId] : undefined
      const restored = a?.recovered[a.recovered.length - 1]
      return (
        <div className={`pivot ${restored ? 'ok' : 'bad'}`}>
          <div className="kicker">Crash → checkpoint recovery</div>
          <h3>{restored ? `Resumed from “${restored.replace(/_/g, ' ')}”` : 'Agent failed, retrying'}</h3>
          {about}
          {a?.retries.length ? <p className="pv-reason">{short(a.retries[a.retries.length - 1].reason.replace(/ - \{.*$/, ''), 120)}
            {a.retries.length > 1 && <span className="muted"> · attempt {a.retries[a.retries.length - 1].attempt}</span>}</p> : null}
          {beat.nodeId && <CheckpointChain state={state} nodeId={beat.nodeId} />}
          <div className="fineprint">Stages before the checkpoint are not rerun; sibling agents keep going.</div>
        </div>
      )
    }
    case 'withheld':
      return (
        <div className="pivot">
          <div className="kicker">Investigation request · {d.status.replace('_', ' ')}</div>
          <h3>“{d.request}”</h3>
          {about}
          <p className="muted">{d.reason}</p>
        </div>
      )
    case 'result':
      return (
        <div className="pivot ok">
          <div className="kicker">Requested result released · {d.gap_id}</div>
          <h3>{d.investigation}</h3>
          <div className="pv-about"><span className="mono">{d.node_id}</span> asked for “{d.request}”</div>
          <blockquote className="pv-quote ok">{short(d.result, 300)}</blockquote>
        </div>
      )
    default:
      return null
  }
}

// ─── Act 4: before / after ─────────────────────────────────────────────────────────────────

function Reveal({ state, slot, mode }: { state: RunState; slot: string; mode: Mode }) {
  const m = state.releasedMedia[state.releasedMedia.length - 1]
  const before = useRef<HTMLVideoElement>(null)
  const after = useRef<HTMLVideoElement>(null)
  const [slow, setSlow] = useState(false)
  const ev = m ? state.events.find(e => e.type === 'heldout.released' && e.data.gap_id === m.gap_id) : undefined
  useEffect(() => { for (const v of [before.current, after.current]) if (v) v.playbackRate = slow ? 0.5 : 1 }, [slow, m])
  if (!m || !state.runId || !ev) {
    return <div className="stage-empty">No result video has been released yet. The record releases it only when an agent requests the matching investigation.</div>
  }
  const restart = () => { for (const v of [before.current, after.current]) if (v) { v.currentTime = 0; v.play() } }
  return (
    <div className="reveal-shot">
      <div className="reveal-head">
        <div className="kicker">Requested by {ev.data.node_id} · “{ev.data.request}” · released from the record</div>
        <h2>{ev.data.investigation}</h2>
      </div>
      <div className="reveal-pair">
        <figure>
          <video ref={before} src={`${api.videoUrl(slot, mode)}#t=0.1`} autoPlay muted loop playsInline />
          <figcaption><b>Before</b> · case record video, sent to agents as measurements</figcaption>
        </figure>
        <figure className="after">
          <video ref={after} src={`${api.mediaUrl(state.runId, m.gap_id)}#t=0.1`} autoPlay muted loop playsInline />
          <figcaption><b>After</b> · held out until requested</figcaption>
        </figure>
      </div>
      <div className="reveal-controls">
        <button className="ctl" onClick={restart}>↺ Restart both</button>
        <button className={`ctl ${slow ? 'on' : ''}`} onClick={() => setSlow(s => !s)}>0.5× slow motion</button>
        <span className="muted">{short(ev.data.result, 200)}</span>
      </div>
      <p className="fineprint">Historical result from the published case, replayed. The agents never saw it until one of them asked for this investigation.</p>
    </div>
  )
}

// ─── Act 5: report and what the run did to get there ───────────────────────────────────────

function ReportShot({ state }: { state: RunState }) {
  const r = state.report
  if (!r) return <div className="stage-empty">The report appears once every branch is verified or explicitly left open.</div>
  const nodes = Object.values(state.nodes)
  const acts = Object.values(state.activity)
  const grounded = state.evidence.filter(e => e.grounded).length
  const stats: [string, string | number][] = [
    ['agents', `${nodes.length} · depth ${Math.max(0, ...nodes.map(n => n.depth))}`],
    ['verifier accepted', nodes.filter(n => n.verification === 'accepted').length],
    ['sent back', acts.filter(a => a.verification && a.verification.verdict !== 'accepted').length],
    ['replans', acts.reduce((s, a) => s + a.decisions.filter(d => d.trigger === 'verifier').length, 0)],
    ['crash recoveries', acts.reduce((s, a) => s + a.recovered.length, 0)],
    ['spawns blocked', acts.reduce((s, a) => s + a.rejectedSpawns.length, 0)],
    ['grounded findings', grounded],
    ['discarded by code', state.evidence.length - grounded],
    ['results released', acts.reduce((s, a) => s + a.investigations.filter(i => i.status === 'released').length, 0)],
    ['invalid ids dropped', r.dropped_invalid_ids?.length ?? 0],
  ]
  return (
    <div className="report-shot">
      <div className="rs-main">
        <p className="disclaimer">{r.disclaimer}</p>
        <h2>Differential for clinician review</h2>
        <ol className="rs-diff">
          {r.differential.map(d => (
            <li key={d.rank}>
              <span className="rs-rank">{d.rank}</span>
              <div>
                <div className="rs-hyp">{d.hypothesis} <span className={`pill conf-${d.confidence}`}>{d.confidence}</span></div>
                <div className="muted">{d.supporting_evidence_ids.length} supporting · {d.contradicting_evidence_ids.length} against</div>
              </div>
            </li>
          ))}
        </ol>
        <h4>Can't-miss causes</h4>
        <table className="cantmiss"><tbody>
          {r.cant_miss.map(c => <tr key={c.condition}><td><b>{c.condition}</b></td><td><span className={`pill cm-${c.status}`}>{c.status}</span></td><td>{c.basis}</td></tr>)}
        </tbody></table>
        {!!r.unresolved_questions.length && <><h4>Still open</h4><ul>{r.unresolved_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
      </div>
      <aside className="rs-stats">
        <div className="kicker">How the run got here</div>
        <dl>{stats.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      </aside>
    </div>
  )
}

// ─── Stage ─────────────────────────────────────────────────────────────────────────────────

export function Stage({ state, view, slot, mode, beat, pinned, setPinned, selected, onSelect, highlighted }: {
  state: RunState; view: CaseView | null; slot: string; mode: Mode
  beat: Beat | null; pinned: number | null; setPinned: (n: number | null) => void
  selected: string | null; onSelect: (id: string | null) => void; highlighted: Set<string>
}) {
  const shot = shotFor(beat, pinned)
  const act = pinned ?? (beat ? actOf(beat.kind) : 1)
  // with act 3 pinned, show the most recent pivot from that act
  const pivot = useMemo(() => {
    if (shot !== 'graph') return null
    if (pinned === 3) {
      for (let i = state.events.length - 1; i >= 0; i--) {
        const e = state.events[i]
        if (['verification', 'spawn.rejected', 'node.recovered', 'node.retry', 'heldout.unavailable'].includes(e.type)
          || (e.type === 'node.decision' && e.data.trigger === 'verifier')) {
          return { seq: e.seq, ts: e.ts, event: e, nodeId: e.data.node_id,
            kind: e.type === 'verification' ? (e.data.verdict === 'accepted' ? 'accepted' : 'verdict')
              : e.type === 'spawn.rejected' ? 'blocked' : e.type === 'heldout.unavailable' ? 'withheld'
              : e.type === 'node.decision' ? 'replan' : 'recovery' } as Beat
        }
      }
      return null
    }
    return beat && actOf(beat.kind) === 3 ? beat : null
  }, [shot, pinned, beat, state.events])

  const spotlight = useMemo(() => {
    const b = pivot ?? (shot === 'graph' && !pinned ? beat : null)
    if (!b) return undefined
    const ids: string[] = []
    if (b.nodeId) ids.push(agentKey(b.nodeId))
    if (b.kind === 'verdict') ids.push(...(b.event.data.rejected_evidence_ids ?? []))
    if (b.kind === 'result') ids.push(sourceKey(b.event.data.source_id))
    if (b.event.type === 'evidence.added' && b.event.data.evidence.grounded) ids.push(b.event.data.evidence.id)
    return ids
  }, [pivot, shot, pinned, beat])

  const rejected = useMemo(() => new Set(Object.values(state.activity).flatMap(a => a.verification?.rejected ?? [])), [state.activity])
  const focusNode = pivot?.nodeId ?? beat?.nodeId ?? null

  // The caption narrates what is on stage: the pinned act's content, else the director's beat.
  const shown = pinned === null ? beat : pinned === 3 ? pivot
    : pinned === 4 ? (() => {
      const e = [...state.events].reverse().find(x => x.type === 'heldout.released' && x.data.media)
      return e ? { seq: e.seq, ts: e.ts, kind: 'reveal', nodeId: e.data.node_id, event: e } as Beat : null
    })()
    : pinned === 5 ? (state.report ? beat : null) : null
  const lead = state.order.map(id => state.nodes[id]).find(n => n.role === 'lead')
  const caption = !state.runId || pinned === 1 || (!shown && pinned === null)
    ? (lead && state.hypotheses.length
      ? `Lead read the full record: ${state.hypotheses.length} working hypotheses, then delegated`
      : 'The lead agent receives the full case record: history, exam, labs, imaging, movement and measurements.')
    : !shown ? (pinned === 2 ? 'Every node is a source, finding or hypothesis an agent produced; links are citations.' : '—')
    : shown.kind === 'first-read' ? `Lead read the record: ${state.hypotheses.length} working hypotheses, ${shown.event.data.requested_children} investigators delegated`
    : shown.kind === 'report' || pinned === 5 ? 'Clinician-review report: every claim links back to a grounded finding'
    : describe(shown.event)

  return (
    <div className="stage">
      <nav className="stage-acts">
        {ACTS.map(a => (
          <button key={a.n} className={`${a.n === act ? 'on' : ''} ${a.n < act ? 'past' : ''}`}
            onClick={() => setPinned(pinned === a.n ? null : a.n)}>
            <span className="act-n">{a.n}</span>{a.title}
          </button>
        ))}
        <button className={`act-auto ${pinned === null ? 'on' : ''}`} onClick={() => setPinned(null)}
          title="Follow the run: the stage cuts to each pivot as it happens">● Auto</button>
      </nav>
      <div className="stage-main">
        <div className="stage-shot" key={shot}>
          {shot === 'dossier' && (view ? <Dossier view={view} state={state} highlighted={highlighted} /> : <div className="stage-empty">Loading case…</div>)}
          {shot === 'graph' && (
            <div className="stage-graph">
              <EvidenceGraph state={state} onSelectAgent={onSelect} spotlight={spotlight} rejected={rejected}
                padRight={pivot && pivot.kind !== 'accepted' ? 470 : 0} />
              {pivot && <div className="pivot-slot" key={pivot.seq}><PivotCard beat={pivot} state={state} /></div>}
            </div>
          )}
          {shot === 'reveal' && <Reveal state={state} slot={slot} mode={mode} />}
          {shot === 'report' && <ReportShot state={state} />}
        </div>
        <aside className="stage-rail">
          <AgentTree nodes={state.nodes} order={state.order} activity={state.activity}
            selected={selected ?? focusNode} onSelect={onSelect} />
        </aside>
      </div>
      <div className={`stage-caption k-${shown?.kind ?? 'case'}`} key={`${pinned}-${shown?.seq ?? 0}`}>
        <span className="cap-act">{ACTS[act - 1].title}</span>
        <span className="cap-text">{caption}</span>
      </div>
    </div>
  )
}
