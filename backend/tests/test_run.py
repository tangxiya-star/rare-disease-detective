"""End-to-end runs of the real orchestrator against the scripted model and offline search."""

import dataclasses

import pytest

from app.config import load_settings
from app.db import DB
from app.events import EventBus
from app.mock_llm import MockClient
from app.orchestrator import Orchestrator


@pytest.fixture
def orch(tmp_path, monkeypatch):
    monkeypatch.setenv("MOCK_DELAY", "0")
    s = dataclasses.replace(load_settings(), llm_backend="mock", search_backend="fixture",
                            db_path=tmp_path / "t.sqlite3")
    db = DB(s.db_path)
    return Orchestrator(s, db, EventBus(db), MockClient())


def types(orch, run_id):
    return [e["type"] for e in orch.db.events_since(run_id)]


async def test_full_run_recurses_verifies_replans_and_reports(orch):
    run_id = await orch.start_run("01", "demo")
    await orch.wait(run_id)
    run = orch.db.get_run(run_id)
    nodes = orch.db.get_nodes(run_id)
    ev = types(orch, run_id)

    assert run["status"] == "completed"
    assert run["report"]["disclaimer"]
    assert max(n["depth"] for n in nodes) == 3, "architecture must allow genuine depth-3 recursion"
    assert len(nodes) <= 24
    assert "verification" in ev and "report.ready" in ev and ev[-1] == "run.finished"
    # verifier REVISE led to a new runtime decision and a new child
    assert any(e["type"] == "node.decision" and e["data"].get("trigger") == "verifier"
               for e in orch.db.events_since(run_id))
    assert any(n["artifact"].get("replan_root") for n in nodes)
    # held-out evidence was released only on request
    released = [e for e in orch.db.events_since(run_id) if e["type"] == "heldout.released"]
    assert released and all(e["data"]["request"] for e in released)
    # every evidence row was grounding-checked in code
    assert all(isinstance(r["grounded"], bool) for r in orch.db.get_evidence(run_id))


async def test_agent_crash_resumes_from_checkpoint_without_rerunning_siblings(orch):
    run_id = await orch.start_run("01", "demo")
    orch.inject(run_id, "agent_crash", "node_01")
    await orch.wait(run_id)
    events = orch.db.events_since(run_id)
    retry = [e for e in events if e["type"] == "node.retry" and e["data"]["node_id"] == "node_01"]
    recovered = [e for e in events if e["type"] == "node.recovered" and e["data"]["node_id"] == "node_01"]
    assert retry and recovered
    assert recovered[0]["data"]["from_checkpoint"] != "created"
    sibling = orch.db.get_node("node_02")
    assert sibling["attempts"] == 1, "finished sibling must not be rerun"
    assert orch.db.get_run(run_id)["status"] == "completed"


async def test_search_failure_reformulates_and_continues(orch):
    run_id = await orch.start_run("04", "scored")
    orch.inject(run_id, "search_failure")
    await orch.wait(run_id)
    performed = [e for e in orch.db.events_since(run_id) if e["type"] == "search.performed"]
    assert any(not a["ok"] for e in performed for a in e["data"]["attempts"])
    assert orch.db.get_run(run_id)["status"] == "completed"


async def test_resume_after_restart_skips_finished_work(orch):
    run_id = await orch.start_run("02", "scored")
    await orch.wait(run_id)
    before = {n["id"]: n["attempts"] for n in orch.db.get_nodes(run_id)}
    await orch.resume_run(run_id)
    await orch.wait(run_id)
    after = {n["id"]: n["attempts"] for n in orch.db.get_nodes(run_id)}
    assert before == after
