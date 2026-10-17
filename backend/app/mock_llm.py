"""Scripted stand-in for Nemotron, for development without an API key.

It answers each role in the same JSON shape the real models must produce, derived from the
payload it receives, so the real orchestrator (validation, spawning, search, grounding,
verification, checkpoints, events) is exercised end to end. The tree shape it produces is
NOT a design for the real system; with LLM_BACKEND=crusoe every decision comes from Nemotron.
"""

import asyncio
import os
import re


def _first_sentence(text: str) -> str:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    for p in parts:
        if len(p) > 40:
            return p
    return parts[0] if parts else text


def _case_text(case: dict) -> str:
    return " ".join(str(case.get(k, "")) for k in ("title", "chief_complaint", "history_of_present_illness")).lower()


_HYPOTHESIS_HINTS = [
    (("dystonia", "posturing", "cramp"), "Dopa-responsive dystonia"),
    (("dystonia", "cramp", "task"), "Idiopathic task-specific focal dystonia"),
    (("ataxia", "unsteadiness", "wobbly", "incoordination"), "Episodic ataxia"),
    (("twisting", "attacks", "starting to move"), "Paroxysmal kinesigenic dyskinesia"),
    (("tremor", "variab", "abrupt"), "Functional movement disorder"),
    (("parkinson", "slow", "stiff"), "Early-onset Parkinson disease"),
]


class MockClient:
    name = "mock"

    def __init__(self):
        self.delay = float(os.environ.get("MOCK_DELAY", "0.4"))
        self._revised: set[str] = set()

    async def complete_json(self, role: str, model: str, payload: dict) -> dict:
        if self.delay:
            await asyncio.sleep(self.delay)
        return getattr(self, role)(payload)

    def lead_plan(self, p: dict) -> dict:
        text = _case_text(p["case"])
        hyps = [name for words, name in _HYPOTHESIS_HINTS if any(w in text for w in words)][:3]
        hyps = hyps or ["Idiopathic movement disorder"]
        mf = [f["id"] for f in p["case"].get("movement_findings", [])][:2]
        children = [
            {"objective": f"Assess whether the record and literature support {hyps[0]} in this patient, "
                          "and which investigation would discriminate it from the alternatives",
             "justification": f"{hyps[0]} is the leading hypothesis but has not been tested."},
            {"objective": "Identify treatable can't-miss causes (including Wilson disease) and whether the "
                          "record already addresses them",
             "justification": "Treatable mimics must be addressed before any conclusion."},
        ][: max(0, min(2, p["limits"]["max_children"]))]
        return {
            "summary": f"[mock] Working hypotheses: {', '.join(hyps)}.",
            "hypotheses": [{"name": h, "rationale": "[mock] keyword match on history",
                            "supporting_finding_ids": mf, "contradicting_finding_ids": []} for h in hyps],
            "uncertainties": ["[mock] response to dopaminergic treatment unknown"],
            "decision": "spawn" if children else "finish",
            "children": children,
        }

    def investigator_plan(self, p: dict) -> dict:
        obj = p["objective"].lower()
        requests = []
        if "dopa" in obj or "discriminat" in obj:
            requests.append("levodopa trial")
        if "wilson" in obj or "can't-miss" in obj:
            requests.append("slit lamp examination and 24-hour urine copper")
        if obj.startswith("genetic"):
            requests.append("genetic testing panel")
        if obj.startswith("biochemical"):
            requests.append("CSF neurotransmitter metabolites and pterins")
        words = [w for w in re.findall(r"[a-zA-Z\-]+", p["objective"]) if len(w) > 4][:6]
        return {"search_queries": [" ".join(words)], "investigation_requests": requests,
                "plan": "[mock] search, then request discriminating results"}

    def investigator_analyze(self, p: dict) -> dict:
        findings = []
        for r in p["search_results"][:2]:
            findings.append({"claim": f"[mock] Literature relevant to: {p['objective'][:60]}",
                             "quote": _first_sentence(r["text"]), "source_id": r["source_id"],
                             "finding_ids": [], "stance": "neutral", "hypothesis": ""})
        for r in p["investigation_results"]:
            if r["status"] == "released":
                findings.append({"claim": f"[mock] Result of {r['request']}", "quote": _first_sentence(r["result"]),
                                 "source_id": r["source_id"], "finding_ids": [], "stance": "supports",
                                 "hypothesis": ""})
        mf = [f["id"] for f in p["case"].get("movement_findings", [])][:1]
        if mf:
            findings.append({"claim": "[mock] Observed movement finding bears on the objective", "quote": "",
                             "source_id": "", "finding_ids": mf, "stance": "neutral", "hypothesis": ""})
        for ka in [e for e in p["case"].get("motion_analysis", []) if e["id"] in ("ka_02", "ka_03")][:1]:
            findings.append({"claim": f"[mock] Hand tracking: {ka['measure'].lower()}",
                             "quote": ka["result"].split(":")[0], "source_id": ka["id"],
                             "finding_ids": [ka["id"]], "stance": "neutral", "hypothesis": ""})
        deeper = {
            "Assess": "Genetic confirmation: which gene testing results would confirm or refute the leading "
                      "hypothesis, including deletion/duplication analysis",
            "Genetic confirmation": "Biochemical confirmation: expected CSF neurotransmitter metabolite and pterin "
                                    "profile if genetic testing is negative or uncertain",
        }
        nxt = next((v for k, v in deeper.items() if p["objective"].startswith(k)), None)
        children = [{"objective": nxt, "justification": "[mock] parent evidence points to a confirmable mechanism."}
                    ] if (nxt and p["can_spawn"] and p["depth"] < 3) else []
        return {"findings": findings, "conclusion": f"[mock] Partial answer to: {p['objective'][:80]}",
                "decision": "spawn" if children else "finish", "children": children}

    def verifier(self, p: dict) -> dict:
        if not p["findings"]:
            return {"verdict": "INSUFFICIENT", "rejected_findings": [], "feedback": "[mock] No grounded findings."}
        key = p["objective"]
        if key.startswith("Identify treatable") and key not in self._revised:
            self._revised.add(key)
            return {"verdict": "REVISE", "rejected_findings": [],
                    "feedback": "[mock] Normal ceruloplasmin alone does not exclude Wilson disease; "
                                "slit lamp and urine copper are needed."}
        return {"verdict": "ACCEPT", "rejected_findings": [], "feedback": "[mock] Supported."}

    def replan(self, p: dict) -> dict:
        if p["can_spawn"] and p["verdict"] == "REVISE":
            return {"decision": "spawn", "reason": "[mock] address verifier feedback",
                    "children": [{"objective": "Re-examine Wilson disease exclusion: which tests in the record "
                                               "or obtainable results confirm or exclude it",
                                  "justification": p["feedback"][:200]}]}
        return {"decision": "unresolved", "reason": "[mock] cannot address feedback", "children": []}

    def lead_report(self, p: dict) -> dict:
        hyps = [h["name"] for h in p["plan"].get("hypotheses", [])]
        ev = [f["evidence_id"] for b in p["branches"] for f in b["findings"]]
        return {
            "summary": "[mock] Report generated by the scripted model; not clinical output.",
            "differential": [{"rank": i + 1, "hypothesis": h, "confidence": "low",
                              "supporting_evidence_ids": ev[:2] if i == 0 else [],
                              "contradicting_evidence_ids": ev[2:3] if i == 0 and p.get("feedback") else []}
                             for i, h in enumerate(hyps[:5])],
            "cant_miss": [{"condition": "Wilson disease", "status": "open", "basis": "[mock]"},
                          {"condition": "Dopa-responsive dystonia", "status": "open", "basis": "[mock]"}],
            "unresolved_questions": [b["objective"] for b in p["branches"] if b["verification"] != "accepted"],
            "suggested_investigations": [{"investigation": "Supervised levodopa trial", "rationale": "[mock]"}],
            "disclaimer": "Hypotheses for physician review; not a diagnosis.",
        }
