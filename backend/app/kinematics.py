"""Hand kinematics from MediaPipe landmarks, turned into case entries the agents can cite.

The models are text-only, so they never see the video. This module measures the tracked
hands (landmarks.json, extracted offline by tools/extract_landmarks.py) and writes the
numbers as `motion_analysis` entries (ids ka_*), which agent_view() adds to the case.
Entries are descriptive measurements, not interpretations; limits are stated in ka_05.

Deterministic: same landmarks in, same text out, so quotes stay verifiable.
"""

import math

FINGERS = [(5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20)]  # MCP, PIP, DIP, tip
TIPS = (8, 12, 16, 20)

EXTENDED = 0.95     # straightness index at or above: finger near-fully extended
FLEXED = 0.60       # at or below: finger flexed around an object
OPEN_ST = 0.97      # open-hand episode: fingers extended ...
OPEN_SP = 0.45      # ... and splayed (mean adjacent fingertip gap, in palm lengths)
MIN_EPISODE_S = 0.2
MERGE_GAP_S = 0.15
SMOOTH = 5          # frames, centred moving average


def _d(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _px(points, w, h):
    return [(x * w, y * h) for x, y in points]


def _straightness(p):
    """Mean over the four fingers of MCP-to-tip distance / summed segment lengths. 1.0 = straight."""
    return sum(_d(p[m], p[t]) / (_d(p[m], p[a]) + _d(p[a], p[b]) + _d(p[b], p[t]) or 1)
               for m, a, b, t in FINGERS) / 4


def _spread(p):
    """Mean gap between adjacent fingertips, in palm lengths (wrist to middle MCP)."""
    return sum(_d(p[i], p[j]) for i, j in zip(TIPS, TIPS[1:])) / 3 / (_d(p[0], p[9]) or 1)


def _posture_var(frames):
    """Frame-to-frame change of hand shape: landmarks relative to the wrist, scaled by the
    hand's bounding-box diagonal, mean displacement per frame. Global hand movement is removed."""
    def shape(p):
        xs, ys = [q[0] for q in p], [q[1] for q in p]
        s = math.hypot(max(xs) - min(xs), max(ys) - min(ys)) or 1
        return [((q[0] - p[0][0]) / s, (q[1] - p[0][1]) / s) for q in p]
    shapes = [shape(p) for p in frames]
    steps = [sum(_d(a, b) for a, b in zip(s0, s1)) / len(s0) for s0, s1 in zip(shapes, shapes[1:])]
    return sum(steps) / len(steps) if steps else 0.0


def _smooth(v):
    k = SMOOTH // 2
    return [sum(v[max(0, i - k):i + k + 1]) / len(v[max(0, i - k):i + k + 1]) for i in range(len(v))]


def _episodes(ts, flags):
    out, start = [], None
    for t, f in zip(ts, flags):
        if f and start is None:
            start = t
        elif not f and start is not None:
            out.append([start, t])
            start = None
    if start is not None:
        out.append([start, ts[-1]])
    merged = []
    for e in out:
        if merged and e[0] - merged[-1][1] < MERGE_GAP_S:
            merged[-1][1] = e[1]
        else:
            merged.append(e)
    return [e for e in merged if e[1] - e[0] >= MIN_EPISODE_S]


def _split(hands):
    """Task hand = the one higher in frame (on the cap); the other holds the bottle.
    MediaPipe's Left/Right labels assume a mirrored image, so they are not used."""
    by_y = sorted(hands, key=lambda h: sum(p[1] for p in h["points"]))
    return by_y[0], (by_y[1] if len(by_y) > 1 else None)


def analyse(landmarks: dict, task_side: str = "right") -> list[dict]:
    meta = landmarks["meta"]
    w, h = meta["width"], meta["height"]
    other_side = "left" if task_side == "right" else "right"
    frames = [f for f in landmarks["frames"] if f["hands"]]
    ts, task, hold = [], [], []
    for f in frames:
        a, b = _split(f["hands"])
        ts.append(f["t"])
        task.append(_px(a["points"], w, h))
        if b:
            hold.append(_px(b["points"], w, h))
    if not task:
        return []

    n, dur = len(landmarks["frames"]), landmarks["frames"][-1]["t"]
    st = _smooth([_straightness(p) for p in task])
    sp = _smooth([_spread(p) for p in task])
    ext = sum(s >= EXTENDED for s in st) / len(st)
    flex = sum(s <= FLEXED for s in st) / len(st)
    eps = _episodes(ts, [a >= OPEN_ST and b >= OPEN_SP for a, b in zip(st, sp)])
    ep_txt = ", ".join(f"{a:.1f}-{b:.1f} s" for a, b in eps) or "none"
    var_task = _posture_var(task)
    var_hold = _posture_var(hold) if len(hold) > 1 else None

    src = (f"MediaPipe Hands, 2D landmarks from the single-camera referral clip "
           f"({n} frames, {dur:.1f} s, {meta['fps']:.0f} fps); automated, not physician-reviewed")
    out = [
        {"id": "ka_01", "measure": "Tracking coverage",
         "result": f"Both hands tracked in {len(hold)} of {n} frames. The {task_side} hand works the cap; "
                   f"the {other_side} hand holds the bottle.",
         "method": src},
        {"id": "ka_02", "measure": f"{task_side.capitalize()}-hand finger posture during the task",
         "result": f"Fingers near-fully extended in {ext:.0%} of frames and flexed around the cap in "
                   f"{flex:.0%} of frames while the task was to grip and turn a screw cap.",
         "method": f"Finger straightness index (MCP-to-tip distance over summed segment lengths, mean of four "
                   f"fingers); extended >= {EXTENDED}, flexed <= {FLEXED}. {src}"},
        {"id": "ka_03", "measure": f"{task_side.capitalize()}-hand open-hand episodes",
         "result": f"{len(eps)} episodes of combined finger extension and splaying, lasting at least "
                   f"{MIN_EPISODE_S} s: {ep_txt}.",
         "method": f"Straightness >= {OPEN_ST} and mean adjacent fingertip gap >= {OPEN_SP} palm lengths, "
                   f"{SMOOTH}-frame smoothing. {src}"},
    ]
    if var_hold is not None:
        ratio = var_task / var_hold if var_hold else float("inf")
        out.append({"id": "ka_04", "measure": "Hand-shape variability, task hand vs holding hand",
                    "result": f"{task_side.capitalize()} hand {var_task:.3f}, {other_side} hand {var_hold:.3f} "
                              f"(ratio {ratio:.1f}). The {other_side} hand's posture is "
                              f"{'more stable' if ratio > 1 else 'not more stable'} than the {task_side} hand's.",
                    "method": f"Mean frame-to-frame change of wrist-relative landmark positions, scaled by hand "
                              f"size; global hand movement removed. {src}"})
    out.append({"id": "ka_05", "role": "limitation", "measure": "Limits of this analysis",
                "result": "Wrist extension cannot be measured: hand landmarks include no forearm point. "
                          "The clip shows a single task with no rest segment, so action and rest cannot be "
                          f"compared. Tremor frequency not estimated (2D, {meta['fps']:.0f} fps, {dur:.0f} s). "
                          "Joint angles are projections onto the camera plane.",
                "method": src})
    return out
