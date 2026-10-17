"""Unattended three-arm evaluation (PRD §7): B0 plain call, B1 plain call + clinical rules, Full system.

    cd backend
    uv run --python 3.11 python tools/run_eval.py run --slots 01,08,09,10
    uv run --python 3.11 python tools/run_eval.py summarise eval/<run_dir>

`run` writes one JSON per (case, arm), then a blind grading pack:
  blind/case_<slot>_<letter>.json   outputs with the arm label removed, letters shuffled per case
  blind/grading_sheet.csv           one row per output, scored against the reference by the grader
  key.json                          letter -> arm (keep closed until grading is finished)
`summarise` joins the completed sheet with key.json and prints counts per arm.

Uses the same backend as the app: Nemotron on Crusoe when CRUSOE_API_KEY is set, else the mock
model (outputs tagged [mock], never clinical results). Scored runs should start after `refs-frozen`.
"""

import argparse
import asyncio
import csv
import dataclasses
import json
import random
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cases import list_cases, load_case  # noqa: E402
from app.config import REPO_ROOT, load_settings  # noqa: E402
from app.db import DB  # noqa: E402
from app.events import EventBus  # noqa: E402
from app.llm import ModelOutputError, make_llm, parse_json_object  # noqa: E402
from app.orchestrator import Orchestrator  # noqa: E402
from app.prompts import JSON_ONLY, SAFETY  # noqa: E402

ARMS = ("b0", "b1", "full")
BLIND_FIELDS = ("summary", "differential", "cant_miss", "unresolved_questions", "suggested_investigations", "error")

BASELINE_PROMPT = f"""You are reviewing a rare neurological movement-disorder case for a physician.
{SAFETY}

Payload: {{"case": <case record>}}

You have no tools: no literature search and no new investigation results. Work only from the record.
Write a clinician-review brief.

Output:
{{"summary": str,
  "differential": [{{"rank": int, "hypothesis": str, "confidence": "low"|"moderate"|"high",
                     "supporting_evidence_ids": [str], "contradicting_evidence_ids": [str]}}],
  "cant_miss": [{{"condition": str, "status": "addressed"|"excluded"|"open", "basis": str}}],
  "unresolved_questions": [str],
  "suggested_investigations": [{{"investigation": str, "rationale": str}}],
  "disclaimer": "Hypotheses for physician review; not a diagnosis."}}
Evidence ids are the case's finding ids (mf_*, tl_*, lab_*, img_*, np_*, ka_*) or section keys
(e.g. family_history, neurological_exam.reflexes). Give at most 5 differential entries.
{JSON_ONLY}"""


def baseline_prompt(arm: str) -> str:
    if arm == "b0":
        return BASELINE_PROMPT
    rules = (REPO_ROOT / "docs" / "clinical" / "reasoning_rules.md").read_text()
    return BASELINE_PROMPT + f"\n\n# Clinical rules (clinical lead)\n\n{rules}"


async def run_baseline(settings, arm: str, case: dict) -> dict:
    if settings.llm_backend != "crusoe":
        return {"summary": "[mock] Baseline output; not clinical output.", "differential": [],
                "cant_miss": [], "unresolved_questions": [], "suggested_investigations": [],
                "disclaimer": "Hypotheses for physician review; not a diagnosis."}
    from openai import AsyncOpenAI

    client = AsyncOpenAI(base_url=settings.crusoe_base_url, api_key=settings.crusoe_api_key)
    messages = [{"role": "system", "content": baseline_prompt(arm)},
                {"role": "user", "content": json.dumps({"case": case}, ensure_ascii=False)}]
    last = ""
    for _ in range(2):  # same re-ask policy as the app's client
        resp = await client.chat.completions.create(model=settings.lead_model, messages=messages,
                                                    temperature=0.2, max_tokens=8192)
        last = resp.choices[0].message.content or ""
        try:
            obj = parse_json_object(last)
            if {"differential", "cant_miss"} <= set(obj):
                return obj
        except ModelOutputError:
            pass
        messages += [{"role": "assistant", "content": last},
                     {"role": "user", "content": "Return only the complete JSON object with every required key."}]
    return {"error": "invalid model output", "raw": last[:2000]}


async def run_full(settings, slot: str, mode: str, db_path: Path) -> tuple[dict, dict]:
    s = dataclasses.replace(settings, db_path=db_path)
    db = DB(s.db_path)
    orch = Orchestrator(s, db, EventBus(db), make_llm(s))
    run_id = await orch.start_run(slot, mode)
    await orch.wait(run_id)
    run = db.get_run(run_id)
    nodes = db.get_nodes(run_id)
    meta = {"run_id": run_id, "status": run["status"], "nodes": len(nodes),
            "max_depth": max((n["depth"] for n in nodes), default=0)}
    return run["report"] or {"error": f"run {run['status']}"}, meta


async def run_one(settings, slot: str, mode: str, arm: str, out: Path) -> dict:
    bundle = load_case(slot, mode)
    t0 = time.monotonic()
    meta = {}
    try:
        if arm == "full":
            report, meta = await run_full(settings, slot, mode, out / "full_runs.sqlite3")
        else:
            report = await run_baseline(settings, arm, bundle.agent_view())
    except Exception as e:  # record and continue: an unattended batch must not stop on one failure
        report = {"error": f"{type(e).__name__}: {e}"}
    rec = {"slot": slot, "mode": mode, "case_id": bundle.case_id, "arm": arm,
           "backend": settings.llm_backend, "model": settings.lead_model,
           "seconds": round(time.monotonic() - t0, 1), **meta, "report": report}
    (out / "raw" / f"case_{slot}_{arm}.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False))
    print(f"  case {slot} {arm:4} {rec['seconds']:6.1f}s {'ERROR ' + report['error'] if 'error' in report else 'ok'}")
    return rec


def reference_for(slot: str, mode: str) -> dict:
    return load_case(slot, mode).reference


def write_blind_pack(records: list[dict], out: Path, seed: int) -> None:
    rng = random.Random(seed)
    blind = out / "blind"
    blind.mkdir(exist_ok=True)
    key, rows = {}, []
    by_case: dict[str, list[dict]] = {}
    for r in records:
        by_case.setdefault(r["slot"], []).append(r)
    for slot, recs in sorted(by_case.items()):
        rng.shuffle(recs)
        ref = reference_for(slot, recs[0]["mode"])
        for letter, r in zip("ABCDEF", recs):
            label = f"case_{slot}_{letter}"
            key[label] = r["arm"]
            # Keep only the fields every arm produces, so the grader can't tell the arms apart by shape.
            report = {k: v for k, v in r["report"].items() if k in BLIND_FIELDS}
            (blind / f"{label}.json").write_text(json.dumps(
                {"case_id": r["case_id"], "output": label, "report": report}, indent=2, ensure_ascii=False))
            rows.append({
                "output": label, "case": slot,
                "reference_diagnosis": ref["reference_diagnosis"]["name"],
                "acceptable_top5": "; ".join(ref.get("acceptable_top5", [])),
                "cant_miss_conditions": "; ".join(c["condition"] for c in ref.get("cant_miss", [])),
                "reference_top1 (1/0)": "", "reference_top5 (1/0)": "",
                "cant_miss_addressed (n of N)": "", "next_test (0-2)": "",
                "anchoring_ok (1/0/na)": "", "unsafe_output (1/0)": "", "notes": ""})
    (out / "key.json").write_text(json.dumps(key, indent=2))
    with open(blind / "grading_sheet.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


async def cmd_run(args) -> None:
    settings = load_settings()
    slots = args.slots.split(",") if args.slots else [c["slot"] for c in list_cases(args.mode)]
    arms = args.arms.split(",")
    out = Path(args.out or REPO_ROOT / "eval" / f"{datetime.now():%Y%m%d-%H%M%S}-{settings.llm_backend}")
    (out / "raw").mkdir(parents=True, exist_ok=True)
    print(f"Backend: {settings.llm_backend}  mode: {args.mode}  slots: {','.join(slots)}  arms: {','.join(arms)}")
    if settings.llm_backend != "crusoe":
        print("WARNING: mock backend. Outputs are scripted and must not be graded as clinical results.")
    records = []
    for slot in slots:  # sequential cases keep Crusoe load predictable; arms of a case run together
        records += await asyncio.gather(*(run_one(settings, slot, args.mode, arm, out) for arm in arms))
    write_blind_pack(records, out, args.seed)
    print(f"\nDone. Grade {out / 'blind' / 'grading_sheet.csv'} without opening key.json, then:\n"
          f"  uv run --python 3.11 python tools/run_eval.py summarise {out}")


def _num(v: str) -> float | None:
    v = (v or "").strip().lower()
    if v in ("", "na"):
        return None
    if " of " in v:
        a, b = v.split(" of ")
        return float(a) / float(b) if float(b) else None
    return float(v)


def cmd_summarise(args) -> None:
    out = Path(args.dir)
    key = json.loads((out / "key.json").read_text())
    rows = list(csv.DictReader(open(out / "blind" / "grading_sheet.csv")))
    metrics = [c for c in rows[0] if "(" in c]
    table: dict[str, dict[str, list[float]]] = {}
    for r in rows:
        arm = key[r["output"]]
        for m in metrics:
            v = _num(r[m])
            if v is not None:
                table.setdefault(arm, {}).setdefault(m, []).append(v)
    print(f"{'metric':32}" + "".join(f"{a:>12}" for a in ARMS))
    for m in metrics:
        cells = []
        for a in ARMS:
            vals = table.get(a, {}).get(m, [])
            cells.append(f"{sum(vals):g} of {len(vals)}" if vals else "-")
        print(f"{m:32}" + "".join(f"{c:>12}" for c in cells))
    print("\nCounts, not percentages: ten cases is a feasibility check. cant_miss_addressed sums per-case fractions.")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--mode", default="scored", choices=["scored", "demo"])
    r.add_argument("--slots", help="comma-separated, e.g. 01,08,09,10 (default: all in the mode)")
    r.add_argument("--arms", default="b0,b1,full")
    r.add_argument("--out")
    r.add_argument("--seed", type=int, default=17)
    s = sub.add_parser("summarise")
    s.add_argument("dir")
    args = p.parse_args()
    if args.cmd == "run":
        asyncio.run(cmd_run(args))
    else:
        cmd_summarise(args)


if __name__ == "__main__":
    main()
