"""Runtime-driven recursive investigation.

Models decide whether to spawn, what to investigate, and how many children to request.
Python validates each request (validator.py), runs the work, grounds evidence in code
(grounding.py), checkpoints after every completed stage, and streams events.

Recovery: a node re-entered after a crash skips stages whose checkpoint it already
reached, using results saved in its `artifact`; finished sibling nodes are never rerun.
"""

import asyncio
import uuid
from dataclasses import dataclass, field

from .cases import CaseBundle, HeldOutReleaser, load_case
from .config import Settings
from .db import DB
from .events import EventBus
from .grounding import check_finding
from .llm import LLMClient
from .search import Searcher
from .validator import MAX_CHILDREN_PER_DECISION, check_spawn

CHECKPOINTS = {
    "lead": ["created", "analyzed", "children_spawned", "children_done", "reported"],
    "investigator": ["created", "planned", "research_done", "analyzed", "children_spawned", "children_done",
                     "finished"],
}
MAX_ATTEMPTS = 3
VERDICTS = {"ACCEPT": "accepted", "REVISE": "revise", "INSUFFICIENT": "insufficient"}


class InjectedCrash(RuntimeError):
    pass


@dataclass
class RunContext:
    run_id: str
    bundle: CaseBundle
    releaser: HeldOutReleaser
    searcher: Searcher
    sem: asyncio.Semaphore
    title_blocks: list[str] = field(default_factory=list)
    crash_target: str | None = None  # node id, or "next" for the next node to reach a checkpoint
    task: asyncio.Task | None = None


def public_node(n: dict) -> dict:
    return {k: n[k] for k in ("id", "run_id", "parent_id", "depth", "role", "model", "objective", "justification",
                              "status", "checkpoint", "verification", "retry_count")}


class Orchestrator:
    def __init__(self, settings: Settings, db: DB, bus: EventBus, llm: LLMClient):
        self.s = settings
        self.db = db
        self.bus = bus
        self.llm = llm
        self.runs: dict[str, RunContext] = {}

    # --- public API ---------------------------------------------------------

    async def start_run(self, slot: str, mode: str) -> str:
        bundle = load_case(slot, mode)
        run_id = f"run_{uuid.uuid4().hex[:10]}"
        self.db.create_run(run_id, slot, mode, self.llm.name)
        ctx = self._context(run_id, bundle)
        self.bus.emit(run_id, "run.started", {"run_id": run_id, "slot": slot, "mode": mode,
                                              "case_id": bundle.case_id, "llm_backend": self.llm.name})
        lead = self._new_node(ctx, None, "lead", f"Investigate {bundle.case_id}: {bundle.case['title']}", None)
        ctx.task = asyncio.create_task(self._drive(ctx, lead["id"]))
        return run_id

    async def resume_run(self, run_id: str) -> None:
        """Continue a run from SQLite state (e.g. after a process restart)."""
        run = self.db.get_run(run_id)
        if run is None:
            raise KeyError(run_id)
        nodes = self.db.get_nodes(run_id)
        lead = next(n for n in nodes if n["role"] == "lead")
        ctx = self._context(run_id, load_case(run["slot"], run["mode"]))
        self.db.update_run(run_id, status="running")
        ctx.task = asyncio.create_task(self._drive(ctx, lead["id"]))

    def inject(self, run_id: str, kind: str, node_id: str | None = None) -> None:
        ctx = self.runs[run_id]
        if kind == "agent_crash":
            ctx.crash_target = node_id or "next"
        elif kind == "search_failure":
            ctx.searcher.forced_failures += 2
        else:
            raise ValueError(kind)
        self.bus.emit(run_id, "failure.injected", {"kind": kind, "node_id": node_id})

    async def wait(self, run_id: str) -> None:
        task = self.runs[run_id].task
        if task:
            await task

    # --- plumbing -----------------------------------------------------------

    def _context(self, run_id: str, bundle: CaseBundle) -> RunContext:
        ctx = RunContext(run_id=run_id, bundle=bundle, releaser=HeldOutReleaser(bundle),
                         searcher=Searcher(self.s.search_backend),
                         sem=asyncio.Semaphore(self.s.max_concurrent_inference),
                         title_blocks=["Guitarist's cramp as the initial manifestation"]
                         if bundle.retrieval_blocklist else [])
        self.runs[run_id] = ctx
        return ctx

    async def _drive(self, ctx: RunContext, lead_id: str) -> None:
        await self._run_node(ctx, lead_id)
        lead = self.db.get_node(lead_id)
        status = "completed" if lead["status"] == "done" else "failed"
        self.db.update_run(ctx.run_id, status=status)
        self.bus.emit(ctx.run_id, "run.finished", {"status": status,
                                                   "nodes": len(self.db.get_nodes(ctx.run_id))})

    def _new_node(self, ctx: RunContext, parent: dict | None, role: str, objective: str,
                  justification: str | None, artifact: dict | None = None) -> dict:
        n = len(self.db.get_nodes(ctx.run_id))
        node = {
            "id": f"node_{n:02d}", "run_id": ctx.run_id, "parent_id": parent["id"] if parent else None,
            "depth": parent["depth"] + 1 if parent else 0, "role": role,
            "model": self.s.lead_model if role == "lead" else self.s.child_model,
            "objective": objective, "justification": justification, "status": "queued",
            "checkpoint": "created", "verification": "pending", "retry_count": 0, "artifact": artifact or {},
        }
        self.db.insert_node(node)
        self.bus.emit(ctx.run_id, "node.created", {"node": public_node(node)})
        return node

    def _set(self, ctx: RunContext, node: dict, **fields) -> None:
        self.db.update_node(node["id"], **fields)
        node.update(fields)
        if "status" in fields or "checkpoint" in fields or "verification" in fields:
            self.bus.emit(ctx.run_id, "node.status", {"node_id": node["id"], "status": node["status"],
                                                      "checkpoint": node["checkpoint"],
                                                      "verification": node["verification"]})

    def _reached(self, node: dict, checkpoint: str) -> bool:
        order = CHECKPOINTS[node["role"]]
        return order.index(node["checkpoint"]) >= order.index(checkpoint)

    def _save(self, ctx: RunContext, node: dict, checkpoint: str) -> None:
        self._set(ctx, node, artifact=node["artifact"], checkpoint=checkpoint)
        if ctx.crash_target in ("next", node["id"]) and checkpoint not in ("created", "reported", "finished"):
            ctx.crash_target = None
            raise InjectedCrash(f"Injected crash after checkpoint {checkpoint}")

    async def _ask(self, ctx: RunContext, role: str, model: str, payload: dict) -> dict:
        async with ctx.sem:
            return await self.llm.complete_json(role, model, payload)

    def _remaining(self, ctx: RunContext) -> int:
        return self.s.max_nodes_per_run - len(self.db.get_nodes(ctx.run_id))

    # --- node execution with retry ------------------------------------------

    async def _run_node(self, ctx: RunContext, node_id: str) -> None:
        for attempt in range(MAX_ATTEMPTS):
            node = self.db.get_node(node_id)
            if node["status"] in ("done", "unresolved", "failed"):
                return
            try:
                if attempt > 0:
                    self.bus.emit(ctx.run_id, "node.recovered", {"node_id": node_id,
                                                                 "from_checkpoint": node["checkpoint"]})
                self._set(ctx, node, status="running", attempts=node["attempts"] + 1)
                if node["role"] == "lead":
                    await self._lead(ctx, node)
                else:
                    await self._investigator(ctx, node)
                return
            except Exception as e:  # noqa: BLE001 - any stage failure is retried from its checkpoint
                node = self.db.get_node(node_id)
                self._set(ctx, node, retry_count=node["retry_count"] + 1, status="retrying")
                self.bus.emit(ctx.run_id, "node.retry", {"node_id": node_id, "attempt": attempt + 1,
                                                         "checkpoint": node["checkpoint"],
                                                         "reason": f"{type(e).__name__}: {e}"[:300]})
        self._set(ctx, self.db.get_node(node_id), status="failed")

    # --- lead ---------------------------------------------------------------

    async def _lead(self, ctx: RunContext, node: dict) -> None:
        a = node["artifact"]
        case = ctx.bundle.agent_view()
        if not self._reached(node, "analyzed"):
            plan = await self._ask(ctx, "lead_plan", node["model"], {
                "case": case,
                "limits": {"max_children": MAX_CHILDREN_PER_DECISION, "remaining_nodes": self._remaining(ctx)}})
            a["plan"] = plan
            self.bus.emit(ctx.run_id, "node.decision", {
                "node_id": node["id"], "action": plan.get("decision", "finish"),
                "requested_children": len(plan.get("children") or []), "rationale": plan.get("summary", ""),
                "hypotheses": [h.get("name") for h in plan.get("hypotheses", [])]})
            self._save(ctx, node, "analyzed")
        if not self._reached(node, "children_spawned"):
            plan = a["plan"]
            reqs = (plan.get("children") or []) if plan.get("decision") == "spawn" else []
            a["child_ids"] = self._spawn(ctx, node, reqs)
            self._save(ctx, node, "children_spawned")
        if not self._reached(node, "children_done"):
            self._set(ctx, node, status="waiting_children")
            await self._run_children(ctx, node["id"])
            node = self.db.get_node(node["id"])
            a = node["artifact"]
            self._set(ctx, node, status="running")
            self._save(ctx, node, "children_done")

        branches = []
        for cid in a.get("child_ids", []):
            c = self.db.get_node(cid)
            branches.append({
                "objective": c["objective"], "verification": c["verification"],
                "conclusion": c["artifact"].get("analysis", {}).get("conclusion", ""),
                "findings": [{"evidence_id": f["evidence_id"], "claim": f["claim"], "stance": f.get("stance"),
                              "hypothesis": f.get("hypothesis")}
                             for f in c["artifact"].get("findings", []) if f["grounded"]]})
        report = await self._ask(ctx, "lead_report", node["model"], {"case": case, "plan": a["plan"],
                                                                     "branches": branches})
        self.db.update_run(ctx.run_id, report=report)
        self.bus.emit(ctx.run_id, "report.ready", {"report": report})
        self._set(ctx, node, status="done", checkpoint="reported", artifact=a)

    # --- investigator -------------------------------------------------------

    async def _investigator(self, ctx: RunContext, node: dict) -> None:
        a = node["artifact"]
        case = ctx.bundle.agent_view()
        parent = self.db.get_node(node["parent_id"])

        if not self._reached(node, "planned"):
            a["plan"] = await self._ask(ctx, "investigator_plan", node["model"], {
                "case": case, "objective": node["objective"], "depth": node["depth"],
                "parent_objective": parent["objective"]})
            self._save(ctx, node, "planned")

        if not self._reached(node, "research_done"):
            self._set(ctx, node, status="researching")
            a["sources"], a["investigation_results"] = [], []
            for q in (a["plan"].get("search_queries") or [])[:3]:
                out = await ctx.searcher.search(q, ctx.bundle.retrieval_blocklist, ctx.title_blocks)
                if out.resolved:
                    for p in out.passages:
                        src = {"id": p.source_id, "title": p.title, "url": p.url, "text": p.text, "meta": p.meta}
                        self.db.upsert_source(ctx.run_id, src)
                        a["sources"].append(src)
                    self.bus.emit(ctx.run_id, "search.performed", {
                        "node_id": node["id"], "query": q, "query_used": out.query_used, "attempts": out.attempts,
                        "results": [{"source_id": p.source_id, "title": p.title, "url": p.url}
                                    for p in out.passages]})
                else:
                    self.bus.emit(ctx.run_id, "search.failed", {"node_id": node["id"], "query": q,
                                                                "attempts": out.attempts, "status": "unresolved"})
            for r in (a["plan"].get("investigation_requests") or [])[:3]:
                rel = ctx.releaser.request(r, node["depth"])
                sid = f"HELDOUT:{rel.gap_id}" if rel.status == "released" else None
                if sid:
                    src = {"id": sid, "title": rel.investigation, "url": "", "text": rel.result,
                           "meta": {"held_out": True, "media": rel.media}}
                    self.db.upsert_source(ctx.run_id, src)
                    a["sources"].append(src)
                    self.bus.emit(ctx.run_id, "heldout.released", {
                        "node_id": node["id"], "request": r, "gap_id": rel.gap_id, "source_id": sid,
                        "investigation": rel.investigation, "result": rel.result, "media": rel.media})
                else:
                    self.bus.emit(ctx.run_id, "heldout.unavailable", {
                        "node_id": node["id"], "request": r, "status": rel.status, "reason": rel.reason})
                a["investigation_results"].append({"request": r, "status": rel.status, "source_id": sid,
                                                   "result": rel.result})
            self._save(ctx, node, "research_done")

        can_spawn = node["depth"] < self.s.max_depth and self._remaining(ctx) > 0
        if not self._reached(node, "analyzed"):
            self._set(ctx, node, status="running")
            analysis = await self._ask(ctx, "investigator_analyze", node["model"], {
                "case": case, "objective": node["objective"], "depth": node["depth"],
                "search_results": [{"source_id": s["id"], "title": s["title"], "text": s["text"]}
                                   for s in a["sources"] if not s["meta"].get("held_out")],
                "investigation_results": a["investigation_results"],
                "can_spawn": can_spawn, "remaining_nodes": self._remaining(ctx)})
            texts = {s["id"]: s["text"] for s in a["sources"]}
            ids = ctx.bundle.finding_ids()
            a["findings"] = []
            for f in analysis.get("findings") or []:
                g = check_finding(f, texts, ids)
                ev = {"id": f"ev_{uuid.uuid4().hex[:8]}", "run_id": ctx.run_id, "node_id": node["id"],
                      "kind": "heldout" if str(f.get("source_id", "")).startswith("HELDOUT:") else
                      ("literature" if f.get("quote") else "case"),
                      "claim": f.get("claim", ""), "quote": f.get("quote"), "source_id": f.get("source_id"),
                      "finding_ids": f.get("finding_ids") or [], "stance": f.get("stance"),
                      "hypothesis": f.get("hypothesis"), "grounded": g.grounded, "grounding_note": g.note}
                self.db.insert_evidence(ev)
                self.bus.emit(ctx.run_id, "evidence.added", {"evidence": ev})
                a["findings"].append({**f, "evidence_id": ev["id"], "grounded": g.grounded, "note": g.note})
            a["analysis"] = {k: analysis.get(k) for k in ("conclusion", "decision", "children")}
            self.bus.emit(ctx.run_id, "node.decision", {
                "node_id": node["id"], "action": analysis.get("decision", "finish") if can_spawn else "finish",
                "requested_children": len(analysis.get("children") or []),
                "rationale": analysis.get("conclusion", "")})
            self._save(ctx, node, "analyzed")

        if not self._reached(node, "children_spawned"):
            an = a["analysis"]
            reqs = (an.get("children") or []) if (an.get("decision") == "spawn" and can_spawn) else []
            a["child_ids"] = self._spawn(ctx, node, reqs)
            self._save(ctx, node, "children_spawned")

        if not self._reached(node, "children_done"):
            if a.get("child_ids"):
                self._set(ctx, node, status="waiting_children")
                await self._run_children(ctx, node["id"])
                node = self.db.get_node(node["id"])
                a = node["artifact"]
            self._save(ctx, node, "children_done")

        self._set(ctx, node, status="done", checkpoint="finished", artifact=a)

    # --- spawning, branches, verification, replanning -----------------------

    def _spawn(self, ctx: RunContext, parent: dict, requests: list[dict], extra: dict | None = None) -> list[str]:
        ids = []
        for req in requests[:MAX_CHILDREN_PER_DECISION]:
            nodes = self.db.get_nodes(ctx.run_id)
            check = check_spawn(objective=req.get("objective", ""), justification=req.get("justification", ""),
                                parent_depth=parent["depth"], max_depth=self.s.max_depth,
                                nodes_in_run=len(nodes), max_nodes=self.s.max_nodes_per_run,
                                existing_objectives=[n["objective"] for n in nodes])
            if not check.ok:
                self.bus.emit(ctx.run_id, "spawn.rejected", {"node_id": parent["id"],
                                                             "objective": req.get("objective", ""),
                                                             "reason": check.reason})
                continue
            child = self._new_node(ctx, parent, "investigator", req["objective"].strip(),
                                   req.get("justification", "").strip(), artifact=dict(extra or {}))
            ids.append(child["id"])
        return ids

    async def _run_children(self, ctx: RunContext, parent_id: str) -> None:
        parent = self.db.get_node(parent_id)
        await asyncio.gather(*[self._run_branch(ctx, parent_id, cid)
                               for cid in parent["artifact"].get("child_ids", [])])

    async def _run_branch(self, ctx: RunContext, parent_id: str, child_id: str) -> None:
        await self._run_node(ctx, child_id)
        child = self.db.get_node(child_id)
        if child["status"] == "failed":
            return
        if child["verification"] == "pending":
            await self._verify(ctx, child)
            child = self.db.get_node(child_id)
        if child["verification"] == "accepted":
            return

        parent = self.db.get_node(parent_id)
        root = child["artifact"].get("replan_root", child_id)
        replans = parent["artifact"].setdefault("replans", {})
        if replans.get(root, 0) >= self.s.max_replans_per_branch:
            if child["status"] != "unresolved":
                self._set(ctx, child, status="unresolved")
            return
        replans[root] = replans.get(root, 0) + 1
        self._set(ctx, parent, artifact=parent["artifact"])

        can_spawn = parent["depth"] < self.s.max_depth and self._remaining(ctx) > 0
        decision = await self._ask(ctx, "replan", parent["model"], {
            "case": ctx.bundle.agent_view(), "your_objective": parent["objective"],
            "child_objective": child["objective"], "verdict": child["verification"].upper(),
            "feedback": child["artifact"].get("verifier", {}).get("feedback", ""), "can_spawn": can_spawn})
        action = decision.get("decision", "unresolved")
        self.bus.emit(ctx.run_id, "node.decision", {"node_id": parent_id, "action": action,
                                                    "trigger": "verifier", "about": child_id,
                                                    "rationale": decision.get("reason", ""),
                                                    "requested_children": len(decision.get("children") or [])})
        self._set(ctx, child, status="unresolved")
        if action == "spawn" and can_spawn:
            parent = self.db.get_node(parent_id)
            new_ids = self._spawn(ctx, parent, (decision.get("children") or [])[:1], extra={"replan_root": root})
            parent = self.db.get_node(parent_id)
            parent["artifact"].setdefault("child_ids", []).extend(new_ids)
            self._set(ctx, parent, artifact=parent["artifact"])
            for nid in new_ids:
                await self._run_branch(ctx, parent_id, nid)

    async def _verify(self, ctx: RunContext, child: dict) -> None:
        a = child["artifact"]
        grounded = [f for f in a.get("findings", []) if f["grounded"]]
        cited = {f.get("source_id") for f in grounded}
        sources = [{"source_id": s["id"], "text": s["text"]} for s in a.get("sources", []) if s["id"] in cited]
        child_conclusions = []
        for cid in a.get("child_ids", []):
            c = self.db.get_node(cid)
            child_conclusions.append(f"[{c['verification']}] {c['artifact'].get('analysis', {}).get('conclusion', '')}")
        self._set(ctx, child, status="verifying")
        v = await self._ask(ctx, "verifier", self.s.lead_model, {
            "case": ctx.bundle.agent_view(), "objective": child["objective"],
            "findings": [{k: f.get(k) for k in ("claim", "quote", "source_id", "finding_ids", "stance", "hypothesis")}
                         for f in grounded],
            "conclusion": a.get("analysis", {}).get("conclusion", ""), "sources": sources,
            "child_conclusions": child_conclusions})
        verdict = VERDICTS.get(str(v.get("verdict", "")).upper(), "insufficient")
        a["verifier"] = v
        self._set(ctx, child, artifact=a, verification=verdict, status="done")
        self.bus.emit(ctx.run_id, "verification", {
            "node_id": child["id"], "verdict": verdict, "feedback": v.get("feedback", ""),
            "rejected_evidence_ids": [grounded[i]["evidence_id"] for i in v.get("rejected_findings") or []
                                      if isinstance(i, int) and 0 <= i < len(grounded)]})
