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

const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
const FINGER_NAME = ['thumb', 'index', 'middle', 'ring', 'little']

export function MotionViewer({ view, highlighted }: { view: CaseView; highlighted: Set<string> }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [lm, setLm] = useState<Landmarks | null>(null)
  const [t, setT] = useState(0)
  const tRef = useRef(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tracked, setTracked] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [showIds, setShowIds] = useState(true)
  const [focusFinger, setFocusFinger] = useState<number | null>(null)
  const crop = useRef<{ x: number; y: number; s: number } | null>(null)
  const anns: Annotation[] = (view.annotations?.annotations ?? []).filter(a => a.t_start != null)
  const active = anns.filter(a => t >= a.t_start && t <= a.t_end)
  const series = useMemo(() => (lm ? kinematics(lm) : []), [lm])
  const opts = useRef({ tracked, showSkeleton, showIds })
  opts.current = { tracked, showSkeleton, showIds }

  useEffect(() => {
    setLm(null)
    if (view.has_landmarks) fetch(`/api/cases/${view.slot}/landmarks?mode=${view.mode}`).then(r => r.json()).then(setLm).catch(() => {})
  }, [view.slot, view.mode, view.has_landmarks])

  // Render loop: grayscale, hand-tracked crop of the video with the golden skeleton on top.
  useEffect(() => {
    let raf = 0
    let lastFinger: number | null = null
    const draw = () => {
      const v = video.current, c = canvas.current
      if (v && c && v.videoWidth) {
        const W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1
        if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr) }
        const g = c.getContext('2d')!
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        const vw = v.videoWidth, vh = v.videoHeight
        if (Math.abs(v.currentTime - tRef.current) > 0.03) { tRef.current = v.currentTime; setT(v.currentTime) }
        const fi = lm ? Math.min(lm.frames.length - 1, Math.round(v.currentTime * lm.meta.fps)) : -1
        const frame = lm && fi >= 0 ? lm.frames[fi] : undefined
        const main = frame ? taskHand(frame.hands) : undefined

        // crop window (video pixels), square, following the task hand
        let target = { x: vw / 2, y: vh / 2, s: Math.max(vw, vh) }
        if (opts.current.tracked && main) {
          const xs = main.points.map(p => p[0] * vw), ys = main.points.map(p => p[1] * vh)
          const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys)
          target = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 + bh * 0.25,
                     s: Math.min(Math.max(vw, vh), Math.max(vh * 0.55, Math.max(bw, bh) * 2.3)) }
        }
        const cr = crop.current ?? target
        cr.x += (target.x - cr.x) * 0.12; cr.y += (target.y - cr.y) * 0.12; cr.s += (target.s - cr.s) * 0.12
        crop.current = cr
        const sw = cr.s * (W / H) > vw ? vw : cr.s * (W / H), sh = sw * (H / W)
        const sx = Math.min(Math.max(0, cr.x - sw / 2), vw - sw), sy = Math.min(Math.max(0, cr.y - sh / 2), vh - sh)
        const P = (p: Pt): Pt => [((p[0] * vw - sx) / sw) * W, ((p[1] * vh - sy) / sh) * H]
        const scale = W / sw * (vw / 738)

        g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
        g.filter = 'saturate(0.45) brightness(0.82)'
        g.drawImage(v, sx, sy, sw, sh, 0, 0, W, H)
        g.filter = 'none'
        const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75)
        vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.45)')
        g.fillStyle = vig; g.fillRect(0, 0, W, H)

        if (frame && opts.current.showSkeleton) {
          // the finger moving fastest right now gets the focus treatment
          let focus: number | null = null
          if (main && fi > 3) {
            const prev = taskHand(lm!.frames[fi - 4].hands)
            if (prev) {
              const sp = FINGERS.map(f => Math.hypot(main.points[f[3]][0] - prev.points[f[3]][0], main.points[f[3]][1] - prev.points[f[3]][1]))
              const m = Math.max(...sp)
              if (m > 0.012) focus = sp.indexOf(m)
            }
          }
          if (focus !== lastFinger) { lastFinger = focus; setFocusFinger(focus) }
          for (const hand of frame.hands) {
            const isMain = hand === main
            const Q = hand.points.map(P)
            g.lineCap = 'round'
            g.lineWidth = isMain ? 1.6 * scale : 0.9 * scale
            g.strokeStyle = isMain ? 'rgba(240,244,248,0.85)' : 'rgba(240,244,248,0.3)'
            g.shadowBlur = 0
            g.beginPath()
            for (const [a, b] of BONES) { g.moveTo(Q[a][0], Q[a][1]); g.lineTo(Q[b][0], Q[b][1]) }
            g.stroke()
            if (isMain && focus !== null) {
              const f = FINGERS[focus]
              g.lineWidth = 3 * scale; g.strokeStyle = 'rgba(245,164,59,0.95)'
              g.beginPath(); g.moveTo(Q[f[0] === 1 ? 1 : f[0]][0], Q[f[0] === 1 ? 1 : f[0]][1])
              for (const i of f) g.lineTo(Q[i][0], Q[i][1])
              g.stroke()
              const j = Q[f[1]]
              g.lineWidth = 1.4; g.strokeStyle = 'rgba(245,164,59,0.9)'
              g.setLineDash([5, 5]); g.lineDashOffset = -performance.now() / 40
              g.beginPath(); g.arc(j[0], j[1], 26 * Math.max(0.8, scale), 0, Math.PI * 2); g.stroke()
              g.setLineDash([])
            }
            Q.forEach(([x, y], i) => {
              g.beginPath(); g.arc(x, y, (isMain ? (TIPS.includes(i) ? 3.4 : 2.8) : 1.8) * Math.max(0.8, scale), 0, Math.PI * 2)
              g.fillStyle = isMain ? '#ffffff' : 'rgba(255,255,255,0.4)'; g.fill()
              if (isMain) { g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.stroke() }
            })
            g.shadowBlur = 0
            if (isMain && opts.current.showIds) {
              g.font = `600 ${Math.round(10 * Math.max(0.85, Math.min(scale, 1.3)))}px Inter, sans-serif`
              g.fillStyle = 'rgba(255,255,255,0.85)'
              Q.forEach(([x, y], i) => g.fillText(String(i), x + 6, y - 5))
            }
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [lm])

  const seek = (s: number) => { const v = video.current; if (v) { v.currentTime = s; v.play() } }
  const toggle = () => { const v = video.current; if (v) { if (v.paused) v.play(); else v.pause() } }
  const k = series[Math.min(series.length - 1, Math.round(t * (lm?.meta.fps ?? 30)))]

  return (
    <section className="motion">
      <div className="video-stage" onClick={toggle}>
        <video ref={video} className="video-src" src={`${api.videoUrl(view.slot, view.mode)}#t=0.1`} preload="auto"
          muted playsInline loop crossOrigin="anonymous" onLoadedMetadata={e => setDur(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        <canvas ref={canvas} className="motion-canvas" />
        {lm && (
          <div className="hud">
            <div className="hud-row"><b>MediaPipe Hands</b><span>21 landmarks · {lm.meta.fps.toFixed(0)} fps{tracked ? ' · tracked zoom' : ''}</span></div>
            {k && <div className="hud-row"><span>extension</span><b className={k.ext > 1.3 ? 'hot' : ''}>{k.ext.toFixed(2)}</b>
              <span>spread</span><b>{k.spread.toFixed(2)}</b>
              {focusFinger !== null && <><span>moving</span><b>{FINGER_NAME[focusFinger]}</b></>}</div>}
          </div>
        )}
        {!playing && <div className="play-hint">▶</div>}
        <div className="stage-time mono">{fmt(t)} / {fmt(dur)}</div>
      </div>
      <div className={`ann-now ${active[0] ? 'on' : ''}`}>
        {active[0] ? <><span className="fid">{active[0].finding_id}</span>{active[0].label}</> : <span className="muted">No annotated event at this moment</span>}
      </div>
      {lm && dur > 0 && <KinematicChart series={series} anns={anns} t={t} dur={dur} highlighted={highlighted} onSeek={seek} />}
      <div className="motion-controls">
        <button className="ctl" onClick={toggle}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
        <label><input type="checkbox" checked={tracked} onChange={e => setTracked(e.target.checked)} /> Track hand</label>
        <label><input type="checkbox" checked={showSkeleton} onChange={e => setShowSkeleton(e.target.checked)} /> Landmarks</label>
        <label><input type="checkbox" checked={showIds} onChange={e => setShowIds(e.target.checked)} /> Joint ids</label>
        <span className="muted">MediaPipe extracts motion coordinates only; clinical interpretation comes from the physician-reviewed annotations.</span>
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
