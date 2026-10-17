import { useEffect, useMemo } from 'react'
import { Background, Controls, Handle, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AgentNode } from '../types'
import type { NodeActivity } from '../useRun'

const W = 250
const H = 112
const GAP_X = 28
const GAP_Y = 72

/** Tidy top-down layout: each subtree gets width proportional to its leaf count. */
function layout(nodes: Record<string, AgentNode>, order: string[]) {
  const children: Record<string, string[]> = {}
  let root: string | null = null
  for (const id of order) {
    const p = nodes[id].parent_id
    if (p) (children[p] ??= []).push(id)
    else root = id
  }
  const pos: Record<string, { x: number; y: number }> = {}
  const leaves = (id: string): number => (children[id]?.length ? children[id].reduce((s, c) => s + leaves(c), 0) : 1)
  const place = (id: string, left: number) => {
    const span = leaves(id) * (W + GAP_X)
    pos[id] = { x: left + span / 2 - W / 2, y: nodes[id].depth * (H + GAP_Y) }
    let x = left
    for (const c of children[id] ?? []) { place(c, x); x += leaves(c) * (W + GAP_X) }
  }
  if (root) place(root, 0)
  return pos
}

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', running: 'Working', researching: 'Researching', waiting_children: 'Waiting on children',
  verifying: 'Verifying', retrying: 'Retrying', done: 'Done', unresolved: 'Unresolved', failed: 'Failed',
}

type Data = { node: AgentNode; activity?: NodeActivity; selected: boolean }

function AgentCard({ data }: NodeProps<Node<Data>>) {
  const { node, activity, selected } = data
  const model = node.model.includes('Super') ? 'Super' : node.model.includes('Nano') ? 'Nano' : node.model.split('/').pop()
  const verdict = node.verification !== 'pending' ? node.verification : null
  const recovering = activity?.recovered.length
  return (
    <div className={`agent-card s-${node.status} ${verdict ? `v-${verdict}` : ''} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="agent-card-top">
        <span className="agent-role">{node.role === 'lead' ? 'Lead' : `Depth ${node.depth}`}</span>
        <span className="agent-model">{model}</span>
        <span className="agent-id">{node.id}</span>
      </div>
      <div className="agent-objective">{node.objective}</div>
      <div className="agent-card-bottom">
        <span className="agent-status"><i />{STATUS_LABEL[node.status] ?? node.status}</span>
        {node.retry_count > 0 && <span className="pill warn">↻ {node.retry_count}{recovering ? ' · restored' : ''}</span>}
        {verdict && <span className={`pill verdict-${verdict}`}>{verdict === 'accepted' ? '✓ accepted' : verdict}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { agent: AgentCard }

/** Re-fit the view whenever the model adds nodes. */
function AutoFit({ count }: { count: number }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, maxZoom: 1, duration: 400 }), 50)
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
    const rfEdges: Edge[] = order.filter(id => nodes[id].parent_id).map(id => {
      const n = nodes[id]
      const active = ['running', 'researching', 'verifying', 'retrying', 'queued'].includes(n.status)
      return { id: `${n.parent_id}-${id}`, source: n.parent_id!, target: id, animated: active,
               className: n.status === 'unresolved' ? 'edge-unresolved' : '' }
    })
    return { rfNodes, rfEdges }
  }, [nodes, order, activity, selected])

  if (!order.length) {
    return <div className="canvas-empty">Start an investigation. The lead agent decides at runtime whether to delegate,
      and every node below is created by a model decision.</div>
  }
  return (
    <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.2} nodesConnectable={false} onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={() => onSelect(null)}
      proOptions={{ hideAttribution: true }}>
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <AutoFit count={order.length} />
    </ReactFlow>
  )
}
