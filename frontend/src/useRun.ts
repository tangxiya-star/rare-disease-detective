import { useEffect, useReducer, useRef } from 'react'
import { api } from './api'
import type { AgentNode, Evidence, Report, RunEvent, SourceRef } from './types'

export interface NodeActivity {
  decisions: { action: string; requested: number; rationale: string; trigger?: string; about?: string }[]
  searches: { query: string; ok: boolean; attempts: any[]; results: SourceRef[] }[]
  investigations: { request: string; status: string; result?: string; gap_id?: string; reason?: string }[]
  verification?: { verdict: string; feedback: string; rejected: string[] }
  retries: { attempt: number; checkpoint: string; reason: string }[]
  recovered: string[]
  rejectedSpawns: { objective: string; reason: string }[]
}

export interface RunState {
  runId: string | null
  status: 'idle' | 'running' | 'completed' | 'failed'
  llmBackend: string | null
  nodes: Record<string, AgentNode>
  order: string[]
  activity: Record<string, NodeActivity>
  evidence: Evidence[]
  sources: Record<string, SourceRef & { held_out?: boolean; text?: string }>
  report: Report | null
  releasedMedia: { gap_id: string; investigation: string }[]
  events: RunEvent[]
  lastSeq: number
}

const empty: RunState = {
  runId: null, status: 'idle', llmBackend: null, nodes: {}, order: [], activity: {}, evidence: [],
  sources: {}, report: null, releasedMedia: [], events: [], lastSeq: 0,
}

const blankActivity = (): NodeActivity => ({
  decisions: [], searches: [], investigations: [], retries: [], recovered: [], rejectedSpawns: [],
})

type Action = { type: 'reset'; runId: string | null } | { type: 'event'; event: RunEvent }

function act(s: RunState, id: string, f: (a: NodeActivity) => NodeActivity): Record<string, NodeActivity> {
  return { ...s.activity, [id]: f(s.activity[id] ?? blankActivity()) }
}

function reduce(s: RunState, a: Action): RunState {
  if (a.type === 'reset') return { ...empty, runId: a.runId, status: a.runId ? 'running' : 'idle' }
  const e = a.event
  if (e.seq <= s.lastSeq) return s
  const d = e.data
  const next: RunState = { ...s, lastSeq: e.seq, events: [...s.events, e] }
  switch (e.type) {
    case 'run.started':
      return { ...next, status: 'running', llmBackend: d.llm_backend }
    case 'run.finished':
      return { ...next, status: d.status }
    case 'node.created':
      return { ...next, nodes: { ...s.nodes, [d.node.id]: d.node }, order: [...s.order, d.node.id] }
    case 'node.status': {
      const n = s.nodes[d.node_id]
      if (!n) return next
      return { ...next, nodes: { ...s.nodes, [n.id]: { ...n, status: d.status, checkpoint: d.checkpoint, verification: d.verification } } }
    }
    case 'node.decision':
      return { ...next, activity: act(s, d.node_id, x => ({ ...x, decisions: [...x.decisions, {
        action: d.action, requested: d.requested_children, rationale: d.rationale, trigger: d.trigger, about: d.about }] })) }
    case 'spawn.rejected':
      return { ...next, activity: act(s, d.node_id, x => ({ ...x, rejectedSpawns: [...x.rejectedSpawns, { objective: d.objective, reason: d.reason }] })) }
    case 'search.performed':
    case 'search.failed': {
      const results: SourceRef[] = d.results ?? []
      const sources = { ...s.sources }
      for (const r of results) sources[r.source_id] = r
      return { ...next, sources, activity: act(s, d.node_id, x => ({ ...x, searches: [...x.searches, {
        query: d.query_used ?? d.query, ok: e.type === 'search.performed', attempts: d.attempts, results }] })) }
    }
    case 'heldout.released': {
      const sources = { ...s.sources, [d.source_id]: { source_id: d.source_id, title: d.investigation, url: '', held_out: true, text: d.result } }
      const releasedMedia = d.media && !s.releasedMedia.some(m => m.gap_id === d.gap_id)
        ? [...s.releasedMedia, { gap_id: d.gap_id, investigation: d.investigation }] : s.releasedMedia
      return { ...next, sources, releasedMedia, activity: act(s, d.node_id, x => ({ ...x, investigations: [...x.investigations, {
        request: d.request, status: 'released', result: d.result, gap_id: d.gap_id }] })) }
    }
    case 'heldout.unavailable':
      return { ...next, activity: act(s, d.node_id, x => ({ ...x, investigations: [...x.investigations, {
        request: d.request, status: d.status, reason: d.reason }] })) }
    case 'evidence.added':
      return { ...next, evidence: [...s.evidence, d.evidence] }
    case 'verification':
      return { ...next, activity: act(s, d.node_id, x => ({ ...x, verification: {
        verdict: d.verdict, feedback: d.feedback, rejected: d.rejected_evidence_ids ?? [] } })) }
    case 'node.retry':
      return { ...next, activity: act(s, d.node_id, x => ({ ...x, retries: [...x.retries, { attempt: d.attempt, checkpoint: d.checkpoint, reason: d.reason }] })) }
    case 'node.recovered':
      return { ...next, activity: act(s, d.node_id, x => ({ ...x, recovered: [...x.recovered, d.from_checkpoint] })) }
    case 'report.ready':
      return { ...next, report: d.report }
    default:
      return next
  }
}

/** Subscribes to a run's event stream; replays from the start and reconnects from the last seq. */
export function useRun(runId: string | null): RunState {
  const [state, dispatch] = useReducer(reduce, empty)
  const lastSeq = useRef(0)
  lastSeq.current = state.lastSeq

  useEffect(() => {
    dispatch({ type: 'reset', runId })
    lastSeq.current = 0
    if (!runId) return
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      ws = new WebSocket(api.eventsUrl(runId, lastSeq.current))
      ws.onmessage = m => dispatch({ type: 'event', event: JSON.parse(m.data) })
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 1000) }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); ws?.close() }
  }, [runId])

  return state
}
