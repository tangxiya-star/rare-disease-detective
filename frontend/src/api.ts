import type { CaseView, Health, Mode } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export const api = {
  health: () => fetch('/api/health').then(json<Health>),
  cases: (mode: Mode) => fetch(`/api/cases?mode=${mode}`).then(json<{ slot: string; case_id: string; title: string }[]>),
  case: (slot: string, mode: Mode) => fetch(`/api/cases/${slot}?mode=${mode}`).then(json<CaseView>),
  videoUrl: (slot: string, mode: Mode) => `/api/cases/${slot}/video?mode=${mode}`,
  mediaUrl: (runId: string, gapId: string) => `/api/runs/${runId}/media/${gapId}`,
  startRun: (slot: string, mode: Mode) =>
    fetch('/api/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot, mode }),
    }).then(json<{ run_id: string }>),
  inject: (runId: string, kind: 'agent_crash' | 'search_failure', nodeId?: string) =>
    fetch(`/api/runs/${runId}/inject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, node_id: nodeId ?? null }),
    }).then(json<{ ok: boolean }>),
  eventsUrl: (runId: string, after: number) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}/api/runs/${runId}/events?after=${after}`
  },
}
