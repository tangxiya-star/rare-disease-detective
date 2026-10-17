import { useEffect, useRef, useState } from 'react'
import { PIVOTS, type Beat } from './beats'
import type { RunEvent } from './types'

/** How long a pivot stays on stage before the next one may replace it. */
export const HOLD_MS = 4200

/**
 * Live camera: shows pivots one at a time for at least HOLD_MS, otherwise follows the newest beat.
 * If pivots pile up (a burst, or opening a finished run), it jumps to the newest beat instead of lagging.
 */
export function useDirector(list: Beat[], runId: string | null, enabled: boolean): Beat | null {
  const [idx, setIdx] = useState(-1)
  const shownAt = useRef(0)
  const [tick, setTick] = useState(0)

  useEffect(() => { setIdx(-1); shownAt.current = 0 }, [runId])

  useEffect(() => {
    if (!enabled || !list.length) return
    const cur = idx >= 0 && idx < list.length ? list[idx] : null
    const elapsed = performance.now() - shownAt.current
    if (cur && PIVOTS.has(cur.kind) && elapsed < HOLD_MS) {
      const t = setTimeout(() => setTick(x => x + 1), HOLD_MS - elapsed + 20)
      return () => clearTimeout(t)
    }
    const pending: number[] = []
    for (let i = Math.max(0, idx + 1); i < list.length; i++) if (PIVOTS.has(list[i].kind)) pending.push(i)
    const next = pending.length > 3 || !pending.length ? list.length - 1 : pending[0]
    if (next !== idx) { setIdx(next); shownAt.current = performance.now() }
  }, [list, idx, tick, enabled])

  return enabled && idx >= 0 ? list[Math.min(idx, list.length - 1)] ?? null : null
}

/**
 * Replay cursor over the event log. `cursor === null` means live.
 * Playback keeps the real rhythm of the run (gaps compressed to at most a second) and pauses on pivots.
 */
export function usePlayback(events: RunEvent[], list: Beat[], runId: string | null) {
  const [cursor, setCursor] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  useEffect(() => { setCursor(null); setPlaying(false) }, [runId])

  useEffect(() => {
    if (!playing || cursor === null) return
    const i = events.findIndex(e => e.seq > cursor)
    if (i < 0) { setPlaying(false); setCursor(null); return }
    const cur = events[i - 1]
    const pivot = list.some(b => b.seq === cursor && PIVOTS.has(b.kind))
    const gap = cur ? (events[i].ts - cur.ts) * 1000 : 0
    const delay = pivot ? HOLD_MS / speed : Math.min(1000, Math.max(25, gap)) / speed
    const t = setTimeout(() => setCursor(events[i].seq), delay)
    return () => clearTimeout(t)
  }, [playing, cursor, events, list, speed])

  const play = () => {
    if (cursor === null) setCursor(events[0]?.seq ?? 0)
    setPlaying(true)
  }
  const scrub = (seq: number | null) => { setPlaying(false); setCursor(seq) }
  return { cursor, playing, speed, setSpeed, play, pause: () => setPlaying(false), scrub }
}
