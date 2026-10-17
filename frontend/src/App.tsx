import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Bug, FileSearch, Stethoscope, LayoutGrid, MonitorPlay, Network, Play, RotateCcw, ScanSearch, SearchX, Workflow } from 'lucide-react'
import { api } from './api'
import { beats as toBeats } from './beats'
import { AgentTree } from './components/AgentTree'
import { BottomTabs } from './components/BottomTabs'
import { EvidenceGraph } from './components/EvidenceGraph'
import { Inspector } from './components/Inspector'
import { PatientPanel } from './components/PatientPanel'
import { Stage } from './components/Stage'
import { Timeline } from './components/Timeline'
import type { CaseView, Health, Mode, Recording } from './types'
import { stateAt, useRun } from './useRun'
import { useDirector, usePlayback } from './useStage'

type Layout = 'workbench' | 'stage'

const STATUS_TEXT = { idle: 'Ready', running: 'Investigating', completed: 'Report ready', failed: 'Failed' }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [mode, setMode] = useState<Mode>((new URLSearchParams(location.search).get('mode') as Mode) || 'demo')
  const [cases, setCases] = useState<{ slot: string; case_id: string; title: string }[]>([])
  const [slot, setSlot] = useState(new URLSearchParams(location.search).get('slot') || '01')
  const [view, setView] = useState<CaseView | null>(null)
  const params = new URLSearchParams(location.search)
  const [runId, setRunIdState] = useState<string | null>(params.get('run'))
  const setRunId = (id: string | null) => {
    setRunIdState(id)
    const u = new URL(location.href)
    if (id) u.searchParams.set('run', id); else u.searchParams.delete('run')
    history.replaceState(null, '', u)
  }
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [layout, setLayoutState] = useState<Layout>(params.get('view') === 'stage' ? 'stage' : 'workbench')
  const setLayout = (l: Layout) => {
    setLayoutState(l)
    const u = new URL(location.href)
    if (l === 'stage') u.searchParams.set('view', 'stage'); else u.searchParams.delete('view')
    history.replaceState(null, '', u)
  }
  const [pinned, setPinned] = useState<number | null>(null)
  const [recordings, setRecordings] = useState<Recording[]>([])
  const rewind = useRef(false)
  const live = useRun(runId)
  const beats = useMemo(() => toBeats(live.events), [live.events])
  const pb = usePlayback(live.events, beats, runId)
  // Scrubbing or replaying shows the state as it was at the cursor; otherwise the live state.
  const state = useMemo(() => (pb.cursor === null ? live : stateAt(live, pb.cursor)), [live, pb.cursor])
  const directed = useDirector(beats, runId, pb.cursor === null)
  const beat = pb.cursor === null ? directed : [...beats].reverse().find(b => b.seq <= pb.cursor!) ?? null

  useEffect(() => { setPinned(null) }, [runId])
  useEffect(() => { api.recordings().then(setRecordings).catch(() => setRecordings([])) }, [])
  // A recording opens at its first event, ready to replay, instead of on the final report.
  useEffect(() => {
    if (rewind.current && live.events.length) { rewind.current = false; pb.scrub(live.events[0].seq) }
  }, [live.events.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const recording = recordings.find(r => r.run_id === runId)
  const openRecording = (id: string) => {
    const r = recordings.find(x => x.run_id === id)
    if (!r) return
    setError(null); setSelected(null); setMode(r.mode); setSlot(r.slot); setRunId(r.run_id)
    rewind.current = true
  }
  useEffect(() => {
    if (layout !== 'stage') return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === ' ') { e.preventDefault(); if (pb.playing) pb.pause(); else pb.play() }
      else if (/^[1-5]$/.test(e.key)) setPinned(Number(e.key))
      else if (e.key === '0' || e.key === 'a') setPinned(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, pb])

  useEffect(() => { api.health().then(setHealth).catch(e => setError(`Backend not reachable: ${e.message}`)) }, [])
  useEffect(() => {
    api.cases(mode).then(cs => { setCases(cs); if (!cs.some(c => c.slot === slot)) setSlot(cs[0]?.slot ?? '01') })
      .catch(e => setError(e.message))
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setView(null); api.case(slot, mode).then(setView).catch(e => setError(e.message)) }, [slot, mode])

  const start = async () => {
    setError(null); setSelected(null)
    try { setRunId((await api.startRun(slot, mode)).run_id) } catch (e: any) { setError(e.message) }
  }
  const crash = () => runId && api.inject(runId, 'agent_crash', selected && live.nodes[selected]?.role !== 'lead' ? selected : undefined)
  const searchFail = () => runId && api.inject(runId, 'search_failure')

  // Case findings cited by the selected node's evidence light up in the patient panel and video track.
  const highlighted = useMemo(() => {
    const ids = new Set<string>()
    for (const e of state.evidence) {
      if (e.node_id !== selected || !e.grounded) continue
      e.finding_ids.forEach(i => ids.add(i))
      if (e.source_id && /^(mf|tl|lab|img|np)_\d+$/.test(e.source_id)) ids.add(e.source_id)
    }
    return ids
  }, [state.evidence, selected])

  const backend = live.llmBackend ?? health?.llm_backend
  const running = live.status === 'running'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><ScanSearch size={17} strokeWidth={2.2} /></span>Rare Disease Detective</div>
        <span className="badge hitl" title="Agents investigate and verify; the clinician decides">Human-in-the-loop · for physician review</span>
        <div className="case-picker">
          <div className="seg">
            {(['demo', 'scored'] as Mode[]).map(m => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setRunId(null) }} disabled={running}>{m}</button>
            ))}
          </div>
          <select value={slot} onChange={e => { setSlot(e.target.value); setRunId(null) }} disabled={running}>
            {cases.map(c => <option key={c.slot} value={c.slot}>Case {c.slot} · {c.case_id}</option>)}
          </select>
        </div>
        <div className={`run-status st-${live.status}`}><i />{STATUS_TEXT[live.status]}</div>
        <div className="seg">
          {(['workbench', 'stage'] as Layout[]).map(l => (
            <button key={l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)}
              title={l === 'stage' ? 'One main stage that cuts to each pivot; for projecting (keys: space, 1–5, 0)' : 'All panels at once'}>
              {l === 'stage' ? <MonitorPlay size={13} /> : <LayoutGrid size={13} />}{l}</button>
          ))}
        </div>
        {recordings.length > 0 && (
          <select className="rec-picker" value={recording?.run_id ?? ''} onChange={e => openRecording(e.target.value)} disabled={running}
            title="Replay a recorded real run from its own event log">
            <option value="" disabled>Recorded runs…</option>
            {recordings.map(r => (
              <option key={r.run_id} value={r.run_id}>{r.label} · {r.duration_s < 90 ? `${Math.round(r.duration_s)} s` : `${Math.round(r.duration_s / 60)} min`} · {r.llm_backend}</option>
            ))}
          </select>
        )}
        {recording && <span className="badge replay" title={`Recorded ${new Date(recording.recorded_at * 1000).toLocaleString()}; replayed from its event log`}>RECORDED RUN</span>}
        {backend === 'mock' && <span className="badge mock" title="Scripted answers; not clinical output">MOCK MODEL</span>}
        {backend === 'crusoe' && <span className="badge live" title={`${health?.lead_model} / ${health?.child_model}`}>Nemotron · Crusoe</span>}
        <div className="spacer" />
        {running && (
          <div className="inject">
            <button onClick={crash} title="Crash the selected investigator (or the next one) after its next checkpoint"><Bug size={13} />Inject agent crash</button>
            <button onClick={searchFail} title="Fail the next two search attempts"><SearchX size={13} />Inject search failure</button>
          </div>
        )}
        {recording ? (
          // A recording replays; it never starts a new (possibly mock) run by accident.
          <button className="primary" onClick={() => { pb.scrub(live.events[0]?.seq ?? 0); pb.play() }} disabled={!live.events.length}>
            <RotateCcw size={14} />Replay from start
          </button>
        ) : (
          <button className={`primary ${backend === 'mock' ? 'is-mock' : ''}`} onClick={start} disabled={running || !view}
            title={backend === 'mock' ? 'The backend runs the scripted mock model: not clinical output' : undefined}>
            <Play size={14} />
            {running ? 'Investigating…' : backend === 'mock' ? 'Run (mock model)' : live.status === 'idle' ? 'Start investigation' : 'Run again'}
          </button>
        )}
      </header>
      {error && <div className="error-bar" onClick={() => setError(null)}>{error}</div>}
      {runId && (
        <Timeline events={live.events} beats={beats} cursor={pb.cursor} playing={pb.playing} speed={pb.speed} live={running}
          onScrub={pb.scrub} onPlay={pb.play} onPause={pb.pause} onSpeed={pb.setSpeed} />
      )}

      {layout === 'stage' ? (
        <Stage state={state} view={view} slot={slot} mode={mode} beat={beat} pinned={pinned} setPinned={setPinned}
          selected={selected} onSelect={setSelected} highlighted={highlighted} />
      ) : (
      <main className="workspace">
        <aside className="panel left">
          <div className="panel-title"><span className="title-icon rose"><Activity size={15} /></span>Patient &amp; motion
            <span className="title-chip">MediaPipe</span></div>
          <PatientPanel view={view} highlighted={highlighted} released={state.releasedMedia} runId={runId} />
        </aside>
        <section className="panel center">
          <div className="panel-title"><span className="title-icon"><Network size={15} /></span>Clinical evidence graph
            <span className="title-chip">{state.evidence.filter(e => e.grounded).length} grounded findings</span></div>
          <div className="graph-pane">
            <EvidenceGraph state={state} onSelectAgent={setSelected} runId={runId} caseRecord={view?.case} />
          </div>
          <BottomTabs state={state} onSelect={setSelected} />
        </section>
        <aside className="panel right">
          <div className="panel-title" title="Each agent was created by a model decision at runtime"><span className="title-icon violet"><Workflow size={15} /></span>Agent orchestration
            <span className="title-chip">{state.order.length} agents</span></div>
          <div className="tree-pane">
            <AgentTree nodes={state.nodes} order={state.order} activity={state.activity} selected={selected} onSelect={setSelected} />
          </div>
          <div className="panel-title sub">
            {selected ? <><span className="title-icon green"><FileSearch size={15} /></span>Agent inspector
              <button className="title-chip as-btn" onClick={() => setSelected(null)}>Back to result</button></>
              : <><span className="title-icon rose"><Stethoscope size={15} /></span>Most likely diagnoses
              <span className="title-chip">{state.report ? 'for clinician review' : 'in progress'}</span></>}
          </div>
          <div className="inspector-pane">
            <Inspector state={state} selected={selected} />
          </div>
        </aside>
      </main>
      )}
    </div>
  )
}
