import { useRef } from 'react'
import { PIVOTS, describe, type Beat } from '../beats'
import type { RunEvent } from '../types'

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Event-log scrubber: every pivot is a marker; dragging rebuilds the state as it was at that moment. */
export function Timeline({ events, beats, cursor, playing, speed, live, onScrub, onPlay, onPause, onSpeed }: {
  events: RunEvent[]; beats: Beat[]; cursor: number | null; playing: boolean; speed: number; live: boolean
  onScrub: (seq: number | null) => void; onPlay: () => void; onPause: () => void; onSpeed: (s: number) => void
}) {
  const bar = useRef<HTMLDivElement>(null)
  if (!events.length) return null
  const t0 = events[0].ts
  const t1 = Math.max(t0 + 1, events[events.length - 1].ts)
  const x = (ts: number) => `${((ts - t0) / (t1 - t0)) * 100}%`
  const at = cursor === null ? events[events.length - 1] : events.find(e => e.seq === cursor) ?? events[events.length - 1]

  const seek = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    const ts = t0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (t1 - t0)
    let seq = events[0].seq
    for (const e of events) { if (e.ts > ts) break; seq = e.seq }
    onScrub(seq)
  }
  const drag = (e: React.PointerEvent) => {
    seek(e.clientX)
    const move = (m: PointerEvent) => seek(m.clientX)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="timeline">
      <button className="tl-btn" onClick={() => onScrub(events[0].seq)} title="Back to the start">⏮</button>
      <button className="tl-btn" onClick={playing ? onPause : onPlay} title="Replay the run at its own rhythm (space)">{playing ? '❚❚' : '▶'}</button>
      <select className="tl-speed" value={speed} onChange={e => onSpeed(Number(e.target.value))}>
        {[0.5, 1, 2, 4].map(s => <option key={s} value={s}>{s}×</option>)}
      </select>
      <div className="tl-bar" ref={bar} onPointerDown={drag}>
        <div className="tl-fill" style={{ width: x(at.ts) }} />
        {beats.filter(b => PIVOTS.has(b.kind) || b.kind === 'accepted').map(b => (
          <i key={b.seq} className={`tl-mark k-${b.kind}`} style={{ left: x(b.ts) }} title={`${fmt(b.ts - t0)} · ${describe(b.event)}`} />
        ))}
        <div className="tl-head" style={{ left: x(at.ts) }} />
      </div>
      <span className="tl-time mono">{fmt(at.ts - t0)} / {fmt(t1 - t0)} · #{at.seq}</span>
      <button className={`tl-live ${cursor === null ? 'on' : ''}`} onClick={() => onScrub(null)}
        title={cursor === null ? 'Showing the latest state' : 'Jump back to the latest state'}>
        {live ? '● LIVE' : 'LATEST'}
      </button>
    </div>
  )
}
