import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { Annotation, CaseView } from '../types'

type Pt = [number, number]
interface Hand { label: string; score: number; points: Pt[] }
interface Landmarks { meta: { fps: number; width: number; height: number; model: string; note: string }; frames: { t: number; hands: Hand[] }[] }

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
]
const TIPS = [4, 8, 12, 16, 20]

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`

/** The hand doing the task: the higher one in frame (the other holds the bottle). */
const taskHand = (hands: Hand[]) =>
  [...hands].sort((a, b) => a.points.reduce((s, p) => s + p[1], 0) - b.points.reduce((s, p) => s + p[1], 0))[0]

/** Descriptive kinematics from 2-D landmarks, normalized by palm length (wrist to middle MCP). */
function kinematics(lm: Landmarks) {
  const ar = lm.meta.height / lm.meta.width
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * ar)
  return lm.frames.map(f => {
    const h = taskHand(f.hands)
    if (!h) return { t: f.t, ext: NaN, spread: NaN }
    const p = h.points
    const palm = d(p[0], p[9]) || 1
    const ext = ([[8, 5], [12, 9], [16, 13], [20, 17]] as const).reduce((s, [tip, mcp]) => s + d(p[tip], p[mcp]), 0) / 4 / palm
    return { t: f.t, ext, spread: d(p[8], p[20]) / palm }
  })
}

function smooth(xs: number[], k = 2) {
  return xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - k), i + k + 1).filter(v => !Number.isNaN(v))
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : NaN
  })
}

function KinematicChart({ series, anns, t, dur, highlighted, onSeek }: {
  series: { t: number; ext: number; spread: number }[]; anns: Annotation[]; t: number; dur: number
  highlighted: Set<string>; onSeek: (t: number) => void
}) {
  const W = 1000, H = 120, PAD = 6
  const ext = smooth(series.map(s => s.ext)), spread = smooth(series.map(s => s.spread))
  const max = Math.max(2, ...ext.filter(v => !Number.isNaN(v)), ...spread.filter(v => !Number.isNaN(v)))
  const x = (tt: number) => (tt / dur) * W
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2)
  const path = (vs: number[]) => vs.map((v, i) => (Number.isNaN(v) ? '' : `${i && !Number.isNaN(vs[i - 1]) ? 'L' : 'M'}${x(series[i].t).toFixed(1)},${y(v).toFixed(1)}`)).join('')
  const area = `${path(ext)}L${x(series[series.length - 1].t)},${H}L0,${H}Z`
  return (
    <div className="kin">
      <div className="kin-head">
        <span><i className="sw ext" />Finger extension index</span>
        <span><i className="sw spread" />Finger spread</span>
        <span className="muted">MediaPipe · 2-D, palm-normalized · descriptive only</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="kin-svg"
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * dur) }}>
        <defs>
          <linearGradient id="extfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#f5a43b" stopOpacity="0.35" /><stop offset="1" stopColor="#f5a43b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {anns.map((a, i) => (
          <rect key={i} x={x(a.t_start)} y={0} width={Math.max(2, x(a.t_end) - x(a.t_start))} height={H}
            className={`kin-band ${t >= a.t_start && t <= a.t_end ? 'on' : ''} ${highlighted.has(a.finding_id) ? 'cited' : ''}`} />
        ))}
        <path d={area} fill="url(#extfill)" />
        <path d={path(spread)} className="kin-line spread" />
        <path d={path(ext)} className="kin-line ext" />
        <line x1={x(t)} x2={x(t)} y1={0} y2={H} className="kin-head-line" />
      </svg>
    </div>
  )
}

export function MotionViewer({ view, highlighted }: { view: CaseView; highlighted: Set<string> }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [lm, setLm] = useState<Landmarks | null>(null)
  const [t, setT] = useState(0)
  const tRef = useRef(0)
  const [dur, setDur] = useState(0)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [showIds, setShowIds] = useState(true)
  const anns: Annotation[] = (view.annotations?.annotations ?? []).filter(a => a.t_start != null)
  const active = anns.filter(a => t >= a.t_start && t <= a.t_end)
  const series = useMemo(() => (lm ? kinematics(lm) : []), [lm])

  useEffect(() => {
    setLm(null)
    if (view.has_landmarks) fetch(`/api/cases/${view.slot}/landmarks?mode=${view.mode}`).then(r => r.json()).then(setLm).catch(() => {})
  }, [view.slot, view.mode, view.has_landmarks])

  // Draw loop: skeleton for the frame under the playhead.
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const v = video.current, c = canvas.current
      if (v && c) {
        const w = v.clientWidth, h = v.clientHeight, dpr = window.devicePixelRatio || 1
        if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr }
        const g = c.getContext('2d')!
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.clearRect(0, 0, w, h)
        if (Math.abs(v.currentTime - tRef.current) > 0.03) { tRef.current = v.currentTime; setT(v.currentTime) }
        if (lm && showSkeleton) {
          const f = lm.frames[Math.min(lm.frames.length - 1, Math.round(v.currentTime * lm.meta.fps))]
          const main = f ? taskHand(f.hands) : undefined
          const k = series[Math.min(series.length - 1, Math.round(v.currentTime * lm.meta.fps))]
          const high = k && k.ext > 1.3
          for (const hand of f?.hands ?? []) {
            const isMain = hand === main
            const P = hand.points.map(([px, py]) => [px * w, py * h] as Pt)
            g.lineWidth = isMain ? 2.2 : 1.2
            g.strokeStyle = isMain ? 'rgba(245,164,59,0.95)' : 'rgba(79,209,224,0.55)'
            g.shadowColor = isMain ? 'rgba(245,164,59,0.9)' : 'transparent'
            g.shadowBlur = isMain ? 10 : 0
            g.beginPath()
            for (const [a, b] of BONES) { g.moveTo(P[a][0], P[a][1]); g.lineTo(P[b][0], P[b][1]) }
            g.stroke()
            P.forEach(([px, py], i) => {
              const tip = TIPS.includes(i)
              g.beginPath()
              g.arc(px, py, isMain ? (tip ? 4.2 : 3) : 2, 0, Math.PI * 2)
              g.fillStyle = isMain ? (tip && high ? '#ff6b6b' : '#ffd08a') : 'rgba(79,209,224,0.8)'
              g.fill()
              if (isMain && showIds) {
                g.shadowBlur = 0
                g.font = '600 10px Inter, sans-serif'
                g.fillStyle = 'rgba(255,230,190,0.95)'
                g.fillText(String(i), px + 5, py - 5)
                g.shadowBlur = 10
              }
            })
            if (isMain && high) {
              for (const i of TIPS) { g.beginPath(); g.arc(P[i][0], P[i][1], 9, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,107,107,0.8)'; g.lineWidth = 1.5; g.stroke() }
            }
          }
          g.shadowBlur = 0
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [lm, showSkeleton, showIds, series])

  const seek = (s: number) => { if (video.current) { video.current.currentTime = s; video.current.play() } }
  const k = series[Math.min(series.length - 1, Math.round(t * (lm?.meta.fps ?? 30)))]

  return (
    <section className="motion">
      <div className="video-stage">
        <video ref={video} className="video" src={`${api.videoUrl(view.slot, view.mode)}#t=0.1`} preload="auto"
          controls muted playsInline loop onLoadedMetadata={e => setDur(e.currentTarget.duration)} />
        <canvas ref={canvas} className="landmarks" />
        {lm && (
          <div className="hud">
            <div className="hud-row"><b>MediaPipe Hands</b><span>21 landmarks · {lm.meta.fps.toFixed(0)} fps</span></div>
            {k && <div className="hud-row"><span>extension</span><b className={k.ext > 1.3 ? 'hot' : ''}>{k.ext.toFixed(2)}</b>
              <span>spread</span><b>{k.spread.toFixed(2)}</b></div>}
          </div>
        )}
      </div>
      <div className={`ann-now ${active[0] ? 'on' : ''}`}>
        {active[0] ? <><span className="fid">{active[0].finding_id}</span>{active[0].label}</> : <span className="muted">No annotated event at this moment</span>}
      </div>
      {lm && dur > 0 && <KinematicChart series={series} anns={anns} t={t} dur={dur} highlighted={highlighted} onSeek={seek} />}
      <div className="motion-controls">
        <label><input type="checkbox" checked={showSkeleton} onChange={e => setShowSkeleton(e.target.checked)} /> Hand landmarks</label>
        <label><input type="checkbox" checked={showIds} onChange={e => setShowIds(e.target.checked)} /> Point ids</label>
        <span className="muted">Motion coordinates only; interpretation comes from the physician-reviewed annotations.</span>
      </div>
      <ul className="ann-list">
        {anns.map((a, i) => (
          <li key={i} className={active.includes(a) ? 'on' : ''} onClick={() => seek(a.t_start)}>
            <span className="mono">{fmt(a.t_start)}</span>
            <span>{a.label}</span>
            <span className={`fid ${highlighted.has(a.finding_id) ? 'cited' : ''}`}>{a.finding_id}</span>
          </li>
        ))}
      </ul>
      <p className="fineprint">{view.annotations?.video?.license}</p>
    </section>
  )
}
