import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { AgentTree } from './components/AgentTree'
import { BottomTabs } from './components/BottomTabs'
import { EvidenceGraph } from './components/EvidenceGraph'
import { Inspector } from './components/Inspector'
import { PatientPanel } from './components/PatientPanel'
import type { CaseView, Health, Mode } from './types'
import { useRun } from './useRun'

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
  const state = useRun(runId)

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
  const crash = () => runId && api.inject(runId, 'agent_crash', selected && state.nodes[selected]?.role !== 'lead' ? selected : undefined)
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

  const backend = state.llmBackend ?? health?.llm_backend
  const running = state.status === 'running'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Rare Disease Detective</div>
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
        <div className={`run-status st-${state.status}`}><i />{STATUS_TEXT[state.status]}</div>
        {backend === 'mock' && <span className="badge mock" title="Scripted answers; not clinical output">MOCK MODEL</span>}
        {backend === 'crusoe' && <span className="badge live" title={`${health?.lead_model} / ${health?.child_model}`}>Nemotron · Crusoe</span>}
        <div className="spacer" />
        {running && (
          <div className="inject">
            <button onClick={crash} title="Crash the selected investigator (or the next one) after its next checkpoint">Inject agent crash</button>
            <button onClick={searchFail} title="Fail the next two search attempts">Inject search failure</button>
          </div>
        )}
        <button className="primary" onClick={start} disabled={running || !view}>
          {running ? 'Investigating…' : state.status === 'idle' ? 'Start investigation' : 'Run again'}
        </button>
      </header>
      {error && <div className="error-bar" onClick={() => setError(null)}>{error}</div>}

      <main className="workspace">
        <aside className="panel left">
          <div className="panel-title"><span className="mod-dot amber" />Motion viewer <span className="muted">· MediaPipe hand landmarks</span></div>
          <PatientPanel view={view} highlighted={highlighted} released={state.releasedMedia} runId={runId} />
        </aside>
        <section className="panel center">
          <div className="panel-title"><span className="mod-dot teal" />Clinical evidence graph
            <span className="muted"> · {state.evidence.filter(e => e.grounded).length} grounded findings</span></div>
          <div className="graph-pane">
            <EvidenceGraph state={state} onSelectAgent={setSelected} />
          </div>
          <BottomTabs state={state} onSelect={setSelected} />
        </section>
        <aside className="panel right">
          <div className="panel-title"><span className="mod-dot cyan" />Agent orchestration
            <span className="muted"> · {state.order.length} nodes · each created by a model decision at runtime</span></div>
          <div className="tree-pane">
            <AgentTree nodes={state.nodes} order={state.order} activity={state.activity} selected={selected} onSelect={setSelected} />
          </div>
          <div className="panel-title sub">Evidence inspector</div>
          <div className="inspector-pane">
            <Inspector state={state} selected={selected} />
          </div>
        </aside>
      </main>
    </div>
  )
}
