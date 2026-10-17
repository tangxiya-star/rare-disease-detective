import { useEffect, useMemo } from 'react'
import {
  Background, BaseEdge, Controls, Handle, Position, ReactFlow, getStraightPath, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentNode } from '../types'
import type { NodeActivity } from '../useRun'

const W = 176
const RING = 150
const ORB = { lead: 104, investigator: 74 }

/** Radial tree: the lead at the centre, each depth on a ring, angular span proportional to leaf count. */
function layout(nodes: Record<string, AgentNode>, order: string[]) {
  const children: Record<string, string[]> = {}
  let root: string | null = null
  for (const id of order) {
    const p = nodes[id].parent_id
    if (p) (children[p] ??= []).push(id)
    else root = id
  }
  const pos: Record<string, { x: number; y: number }> = {}
  if (!root) return pos
  const leaves = (id: string): number => (children[id]?.length ? children[id].reduce((s, c) => s + leaves(c), 0) : 1)
  const total = leaves(root)
  const ringGap = Math.max(RING, (total * W * 0.5) / (2 * Math.PI * 3))
  const place = (id: string, a0: number, a1: number) => {
    const depth = nodes[id].depth
    const a = (a0 + a1) / 2
    const r = depth * ringGap
    pos[id] = { x: r * Math.cos(a) - W / 2, y: r * Math.sin(a) - ORB[nodes[id].role] / 2 }
    let start = a0
    for (const c of children[id] ?? []) {
      const span = ((a1 - a0) * leaves(c)) / leaves(id)
      place(c, start, start + span)
      start += span
    }
  }
  place(root, -Math.PI / 2, (3 * Math.PI) / 2)
  return pos
}

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', running: 'Thinking', researching: 'Searching', waiting_children: 'Delegated',
  verifying: 'Verifying', retrying: 'Retrying', done: 'Done', unresolved: 'Unresolved', failed: 'Failed',
}
const ACTIVE = new Set(['queued', 'running', 'researching', 'verifying', 'retrying'])

type Data = { node: AgentNode; activity?: NodeActivity; selected: boolean }

function AgentOrb({ data }: NodeProps<Node<Data>>) {
  const { node, activity, selected } = data
  const size = ORB[node.role]
  const model = node.model.includes('Super') ? 'Super' : node.model.includes('Nano') ? 'Nano' : node.model.split('/').pop()
  const verdict = node.verification !== 'pending' ? node.verification : null
  const searches = activity?.searches.length ?? 0
  const results = activity?.investigations.filter(i => i.status === 'released').length ?? 0
  const cls = ['orb-node', node.role, `s-${node.status}`, verdict ? `v-${verdict}` : '', selected ? 'selected' : '',
    ACTIVE.has(node.status) ? 'active' : ''].join(' ')
  return (
    <div className={cls} style={{ width: W }}>
      <div className="orb-wrap" style={{ width: size, height: size }}>
        <Handle type="target" position={Position.Top} />
        <div className="orb-halo" />
        <div className="orb">
          <div className="orb-role">{node.role === 'lead' ? 'Lead' : `D${node.depth}`}</div>
          <div className="orb-model">{model}</div>
          <div className="orb-status">{STATUS_LABEL[node.status] ?? node.status}</div>
        </div>
        {node.retry_count > 0 && <div className="orb-badge retry" title="Recovered from checkpoint">↻{node.retry_count}</div>}
        {verdict && <div className={`orb-badge verdict ${verdict}`} title={`Verifier: ${verdict}`}>
          {verdict === 'accepted' ? '✓' : verdict === 'revise' ? '!' : '×'}</div>}
        <Handle type="source" position={Position.Bottom} />
      </div>
      <div className="orb-label" title={node.objective}>{node.objective}</div>
      {(searches > 0 || results > 0) && (
        <div className="orb-meta">
          {searches > 0 && <span>⌕ {searches}</span>}
          {results > 0 && <span className="res">◆ {results} result{results > 1 ? 's' : ''}</span>}
        </div>
      )}
    </div>
  )
}

type EdgeData = { state: 'active' | 'accepted' | 'revise' | 'unresolved' | 'idle' }

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<EdgeData>>) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const state = data?.state ?? 'idle'
  return (
    <>
      <BaseEdge id={id} path={path} className={`flow-edge e-${state}`} />
      {state === 'active' && [0, 0.6, 1.2].map(d => (
        <circle key={d} r={3} className="flow-particle">
          <animateMotion dur="1.8s" begin={`${d}s`} repeatCount="indefinite" path={path} />
        </circle>
      ))}
    </>
  )
}

const nodeTypes = { agent: AgentOrb }
const edgeTypes = { flow: FlowEdge }

/** Re-fit the view whenever the model adds nodes. */
function AutoFit({ count }: { count: number }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.12, maxZoom: 1.1, duration: 500 }), 60)
    return () => clearTimeout(t)
  }, [count, fitView])
  return null
}

export function AgentCanvas({ nodes, order, activity, selected, onSelect }: {
  nodes: Record<string, AgentNode>; order: string[]; activity: Record<string, NodeActivity>
  selected: string | null; onSelect: (id: string | null) => void
}) {
  const { rfNodes, rfEdges } = useMemo(() => {
    const pos = layout(nodes, order)
    const rfNodes: Node<Data>[] = order.map(id => ({
      id, type: 'agent', position: pos[id] ?? { x: 0, y: 0 }, draggable: false,
      data: { node: nodes[id], activity: activity[id], selected: id === selected },
    }))
    const rfEdges: Edge<EdgeData>[] = order.filter(id => nodes[id].parent_id).map(id => {
      const n = nodes[id]
      const state: EdgeData['state'] = ACTIVE.has(n.status) ? 'active'
        : n.status === 'unresolved' || n.status === 'failed' ? 'unresolved'
        : n.verification === 'accepted' ? 'accepted' : n.verification === 'revise' ? 'revise' : 'idle'
      return { id: `${n.parent_id}-${id}`, source: n.parent_id!, target: id, type: 'flow', data: { state } }
    })
    return { rfNodes, rfEdges }
  }, [nodes, order, activity, selected])

  if (!order.length) {
    return <div className="canvas-empty">Start an investigation. The lead agent decides at runtime whether to delegate;
      every node here is created by a model decision, validated in Python.</div>
  }
  return (
    <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }} minZoom={0.15} nodesConnectable={false}
      onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={() => onSelect(null)}
      proOptions={{ hideAttribution: true }} colorMode="dark">
      <Background gap={28} size={1} />
      <Controls showInteractive={false} />
      <AutoFit count={order.length} />
    </ReactFlow>
  )
}
