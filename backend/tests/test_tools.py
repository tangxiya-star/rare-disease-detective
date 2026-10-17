"""Evaluation tooling: challenge-set code checks and the blind three-arm pack (mock backend)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import run_challenge  # noqa: E402
import run_eval  # noqa: E402


def test_challenge_code_checks_catch_exactly_the_code_level_fakes():
    items = json.loads(run_challenge.CHALLENGE.read_text())["items"]
    for item in items:
        failed = run_challenge.code_checks(item, run_challenge.bundle_for(item["case"]))
        code_rules = [r for r in item["expected_failed_rules"] if r.startswith("C")]
        assert failed == sorted(code_rules), (item["id"], failed)


async def test_eval_run_writes_blind_pack_without_arm_leaks(tmp_path, monkeypatch):
    monkeypatch.setenv("MOCK_DELAY", "0")
    monkeypatch.setenv("SEARCH_BACKEND", "fixture")
    monkeypatch.setenv("LLM_BACKEND", "mock")
    args = type("A", (), {"mode": "scored", "slots": "10", "arms": "b0,b1,full", "out": str(tmp_path), "seed": 1})
    await run_eval.cmd_run(args)
    key = json.loads((tmp_path / "key.json").read_text())
    assert sorted(key.values()) == ["b0", "b1", "full"]
    for label in key:
        blind = json.loads((tmp_path / "blind" / f"{label}.json").read_text())
        text = json.dumps(blind)
        assert "dropped_invalid_ids" not in text and "b0" not in text and "b1" not in text
    assert (tmp_path / "blind" / "grading_sheet.csv").read_text().count("case_10_") == 3
