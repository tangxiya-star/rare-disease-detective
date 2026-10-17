import { useEffect, useMemo, useRef } from 'react'
import type { AgentNode } from '../types'
import type { NodeActivity } from '../useRun'

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', running: 'Thinking', researching: 'Searching', waiting_children: 'Delegated',
  verifying: 'Verifying', retrying: 'Retrying', done: 'Done', unresolved: 'Unresolved', failed: 'Failed',
}
const ACTIVE = new Set(['queued', 'running', 'researching', 'verifying', 'retrying'])

type Row = { id: string; guides: boolean[]; last: boolean }

/** Depth-first rows with tree-drawing guides: guides[k] = ancestor at depth k+1 has later siblings. */
function rows(nodes: Record<string, AgentNode>, order: string[]): Row[] {
  const children: Record<string, string[]> = {}
  let root: string | null = null
  for (const id of order) {
    const p = nodes[id].parent_id
    if (p) (children[p] ??= []).push(id)
    else root = id
  }
  const out: Row[] = []
  const walk = (id: string, guides: boolean[], last: boolean) => {
    out.push({ id, guides, last })
    const cs = children[id] ?? []
    cs.forEach((c, i) => walk(c, nodes[id].parent_id ? [...guides, !last] : [], i === cs.length - 1))
  }
  if (root) walk(root, [], true)
  return out
}

/** Colour state: running wins, then the verifier's verdict, then terminal status. */
function tone(n: AgentNode) {
  if (ACTIVE.has(n.status)) return n.status === 'retrying' ? 'warn' : 'run'
  if (n.status === 'failed' || n.verification === 'insufficient') return 'bad'
  if (n.verification === 'accepted') return 'ok'
  if (n.verification === 'revise') return 'warn'
  if (n.status === 'unresolved') return 'open'
  return 'idle'
}

export function AgentTree({ nodes, order, activity, selected, onSelect }: {
  nodes: Record<string, AgentNode>; order: string[]; activity: Record<string, NodeActivity>
  selected: string | null; onSelect: (id: string | null) => void
}) {
  const list = useMemo(() => rows(nodes, order), [nodes, order])
  const newest = useRef<HTMLLIElement | null>(null)
  const last = order[order.length - 1]
  // Follow new agents only while they are working, so a finished run opens at the lead.
  const following = !!last && ACTIVE.has(nodes[last].status)
  useEffect(() => { if (following) newest.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [last, following])

  if (!order.length) {
    return <div className="tree-empty">Start an investigation. The lead agent decides at runtime whether to delegate;
      every node here is created by a model decision, validated in Python.</div>
  }
  const counts = { run: 0, ok: 0, warn: 0, bad: 0, open: 0, idle: 0 }
  for (const id of order) counts[tone(nodes[id])]++
  return (
    <div className="tree-wrap">
      <div className="tree-stats">
        <span className="t-run"><i />{counts.run} active</span>
        <span className="t-ok"><i />{counts.ok} accepted</span>
        <span className="t-warn"><i />{counts.warn} revise</span>
        <span className="t-open"><i />{counts.open + counts.bad} unresolved</span>
      </div>
      <ul className="tree">
        {list.map(({ id, guides, last: isLast }) => {
          const n = nodes[id]
          const a = activity[id]
          const t = tone(n)
          const model = n.model.includes('Super') ? 'Super' : n.model.includes('Nano') ? 'Nano' : n.model.split('/').pop()
          const searches = a?.searches.length ?? 0
          const results = a?.investigations.filter(i => i.status === 'released').length ?? 0
          return (
            <li key={id} ref={id === last ? newest : undefined}
              className={`tree-row t-${t} ${n.role} ${id === selected ? 'selected' : ''}`}
              onClick={() => onSelect(id === selected ? null : id)}>
              {guides.map((g, k) => <span key={k} className={`g ${g ? 'line' : ''}`} />)}
              {n.parent_id && <span className={`g elbow ${isLast ? 'last' : ''}`} />}
              <span className="dot" />
              <div className="tree-body">
                <div className="tree-head">
                  <b>{n.role === 'lead' ? 'Lead' : `D${n.depth}`}</b>
                  <span className="model">{model}</span>
                  <span className="status">{STATUS_LABEL[n.status] ?? n.status}</span>
                  <span className="spacer" />
                  {searches > 0 && <span className="meta" title="Literature searches">⌕ {searches}</span>}
                  {results > 0 && <span className="meta res" title="Held-out results obtained">◆ {results}</span>}
                  {n.retry_count > 0 && <span className="badge-sm warn" title="Recovered from checkpoint">↻{n.retry_count}</span>}
                  {n.verification !== 'pending' && <span className={`badge-sm v-${n.verification}`} title={`Verifier: ${n.verification}`}>
                    {n.verification === 'accepted' ? '✓' : n.verification === 'revise' ? '!' : '×'}</span>}
                </div>
                <div className="tree-obj" title={n.objective}>{n.objective}</div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
