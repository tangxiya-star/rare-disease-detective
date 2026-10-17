import json

import pytest

from app.cases import HeldOutReleaser, list_cases, load_case

REFERENCE_ONLY_KEYS = {"reference_diagnosis", "acceptable_top5", "competing_hypotheses", "held_out_evidence",
                       "red_flags_for_wrong_reasoning", "cant_miss", "key_evidence_gaps"}


@pytest.mark.parametrize("mode", ["scored", "demo"])
def test_agent_view_never_contains_reference_or_paths(mode):
    for entry in list_cases(mode):
        b = load_case(entry["slot"], mode)
        view = b.agent_view()
        text = json.dumps(view)
        assert not REFERENCE_ONLY_KEYS & set(view)
        assert "cases/" not in text and "reference" not in text.lower().replace("reference_range", "")
        assert b.reference["reference_diagnosis"]["name"] not in text


def test_scored_set_is_ten_synthetic_cases():
    scored = list_cases("scored")
    assert [c["slot"] for c in scored] == [f"{i:02d}" for i in range(1, 11)]
    for c in scored:
        assert load_case(c["slot"], "scored").case["provenance"]["type"] == "synthetic"


def test_demo_hero_is_not_scored_and_has_blocklist():
    b = load_case("01", "demo")
    assert b.reference["scored"] is False
    assert "10.12688/f1000research.51433.1" in b.retrieval_blocklist


def test_release_on_request_matches_free_text():
    r = HeldOutReleaser(load_case("01", "demo"))
    rel = r.request("Supervised levodopa trial", depth=1)
    assert rel.status == "released" and rel.gap_id == "gap_01"
    assert r.request("DaT-SPECT imaging", depth=1).gap_id == "gap_02"
    assert r.request("CSF neurotransmitter metabolites", depth=1).gap_id == "gap_03"


def test_release_unknown_investigation_not_available():
    r = HeldOutReleaser(load_case("01", "demo"))
    assert r.request("skin biopsy for alpha-synuclein", depth=1).status == "not_available"


def test_release_after_depth_2_rule():
    r = HeldOutReleaser(load_case("01", "scored"))  # synthetic hero: CSF is after_depth_2
    assert r.request("CSF neurotransmitter metabolites and pterins", depth=1).status == "withheld"
    assert r.request("CSF neurotransmitter metabolites and pterins", depth=2).status == "released"


@pytest.mark.parametrize("request_text,gap", [
    ("supervised levodopa trial with gradual dose escalation and clinical rating for 4-6 weeks", "gap_01"),
    ("GCH1 gene sequencing including deletion/duplication analysis", "gap_04"),
    ("Slit‑lamp examination for Kayser-Fleischer rings", "gap_06"),
])
def test_release_matches_long_free_text_requests(request_text, gap):
    rel = HeldOutReleaser(load_case("01", "demo")).request(request_text, depth=1)
    assert rel.status == "released" and rel.gap_id == gap


def test_case_sections_are_citable():
    b = load_case("01", "demo")
    assert {"family_history", "prior_workup_and_opinions", "neurological_exam.reflexes"} <= b.finding_ids()


def test_release_hyphenated_terms():
    r = HeldOutReleaser(load_case("01", "demo"))
    assert r.request("L-dopa challenge", depth=1).gap_id == "gap_01"
    assert r.request("123I-FP-CIT SPECT", depth=1).gap_id == "gap_02"


def test_demo_hero_motion_analysis_is_citable():
    from app.grounding import check_finding
    b = load_case("01", "demo")
    ka = b.agent_view()["motion_analysis"]
    assert [e["id"] for e in ka] == ["ka_01", "ka_02", "ka_03", "ka_04", "ka_05"]
    assert ka == load_case("01", "demo").agent_view()["motion_analysis"]  # deterministic
    assert {"ka_02", "ka_03"} <= b.finding_ids()
    quote = ka[2]["result"].split(":")[0]
    assert check_finding({"quote": quote, "source_id": "ka_03"}, b.case_sources(), b.finding_ids()).grounded
    assert "case_01_guitarist" not in json.dumps(ka) and "levodopa" not in json.dumps(ka).lower()


def test_scored_cases_have_no_motion_analysis():
    for c in list_cases("scored"):
        assert "motion_analysis" not in load_case(c["slot"], "scored").agent_view()
