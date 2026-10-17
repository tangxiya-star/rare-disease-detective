"""Verifier challenge set (cases/reference/verifier_challenge.json): 10 true and 10 false claims.

    cd backend
    uv run --python 3.11 python tools/run_challenge.py

Each claim goes through the same two layers as in a run:
  1. code checks (C1 verbatim quote, C2 case finding ids, C3 leading hypothesis lists contradicting
     findings, C4 retrieval blocklist); a failure is an INSUFFICIENT verdict without asking the model;
  2. the verifier role prompt (Nemotron Super), with the same payload shape the orchestrator sends.
Reports false claims caught, true claims accepted, and whether the expected rule id appears.
Without CRUSOE_API_KEY the mock verifier is used and the model-level numbers are meaningless.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cases import list_cases, load_case  # noqa: E402
from app.config import REPO_ROOT, load_settings  # noqa: E402
from app.grounding import check_finding  # noqa: E402
from app.llm import make_llm  # noqa: E402

CHALLENGE = REPO_ROOT / "cases" / "reference" / "verifier_challenge.json"


def bundle_for(case_id: str):
    """Challenge items cite the demo hero (case_01) and the scored cases by their agent case_id."""
    for mode in ("demo", "scored"):
        for c in list_cases(mode):
            b = load_case(c["slot"], mode)
            if b.case_id == case_id:
                return b
    raise KeyError(case_id)


def code_checks(item: dict, bundle) -> list[str]:
    failed = []
    ids = bundle.finding_ids()
    blocked = [d.lower() for d in bundle.retrieval_blocklist]
    sources = {p["source_id"]: p["retrieved_text"] for p in item["cited_passages"]}
    for p in item["cited_passages"]:
        if any(d in p["source_id"].lower() for d in blocked):
            failed.append("C4")
        elif not check_finding({"quote": p["quote"], "source_id": p["source_id"], "finding_ids": []}, sources, ids).grounded:
            failed.append("C1")
    bad = [i for i in item["cited_findings"] if i not in ids]
    if bad:
        failed.append("C2")
    if item.get("is_leading_hypothesis") and not item.get("contradicting_findings"):
        failed.append("C3")
    return sorted(set(failed))


async def model_verdict(llm, model: str, item: dict, bundle) -> dict:
    case_src = bundle.case_sources()
    finding = {"claim": item["claim"], "quote": item["cited_passages"][0]["quote"] if item["cited_passages"] else "",
               "source_id": item["cited_passages"][0]["source_id"] if item["cited_passages"] else "",
               "finding_ids": item["cited_findings"], "stance": "supports", "hypothesis": item["claim"]}
    sources = [{"source_id": p["source_id"], "text": p["retrieved_text"]} for p in item["cited_passages"]]
    sources += [{"source_id": i, "text": case_src[i]} for i in item["cited_findings"] if i in case_src]
    if item.get("is_leading_hypothesis"):
        finding["contradicting_finding_ids"] = item.get("contradicting_findings", [])
    return await llm.complete_json("verifier", model, {
        "case": bundle.agent_view(), "objective": item["claim"], "findings": [finding],
        "conclusion": item["claim"], "sources": sources, "child_conclusions": []})


async def main_async(args) -> None:
    settings = load_settings()
    llm = make_llm(settings)
    data = json.loads(CHALLENGE.read_text())
    if settings.llm_backend != "crusoe":
        print("WARNING: mock verifier. Code-level results are real; model-level results are not.\n")
    results = []
    for item in data["items"]:
        bundle = bundle_for(item["case"])
        failed = code_checks(item, bundle)
        if failed:
            verdict, feedback, layer = "INSUFFICIENT", f"code checks failed: {', '.join(failed)}", "code"
        else:
            v = await model_verdict(llm, settings.lead_model, item, bundle)
            verdict, feedback, layer = str(v.get("verdict", "")).upper(), v.get("feedback", ""), "model"
        expected = item["expected_verdict"]
        correct = (verdict == "ACCEPT") == (expected == "ACCEPT")
        rules = item["expected_failed_rules"]
        rule_hit = (not rules) or any(r in feedback or r in failed for r in rules)
        results.append({"id": item["id"], "truth": item["truth"], "layer": layer, "verdict": verdict,
                        "expected": expected, "correct": correct, "expected_rules": rules,
                        "rule_named": rule_hit, "feedback": feedback})
        print(f"{item['id']} {item['truth']:5} {layer:5} {verdict:12} expected {expected:12} "
              f"{'OK ' if correct else 'MISS'} rules {','.join(rules) or '-':8} {'named' if rule_hit else ''}")

    false_items = [r for r in results if r["truth"] == "false"]
    true_items = [r for r in results if r["truth"] == "true"]
    caught = sum(r["correct"] for r in false_items)
    accepted = sum(r["correct"] for r in true_items)
    by_code = sum(r["correct"] and r["layer"] == "code" for r in false_items)
    print(f"\nFalse claims caught: {caught} of {len(false_items)} ({by_code} by code checks, {caught - by_code} by the verifier model)")
    print(f"True claims accepted: {accepted} of {len(true_items)}")
    print(f"Expected rule id named: {sum(r['rule_named'] for r in false_items)} of {len(false_items)} false claims")
    out = Path(args.out or REPO_ROOT / "eval" / f"challenge-{settings.llm_backend}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"backend": settings.llm_backend, "model": settings.lead_model,
                               "false_caught": caught, "true_accepted": accepted, "items": results},
                              indent=2, ensure_ascii=False))
    print(f"Saved {out}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out")
    asyncio.run(main_async(p.parse_args()))


if __name__ == "__main__":
    main()
