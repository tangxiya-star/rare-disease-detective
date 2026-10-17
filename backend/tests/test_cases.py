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


def test_narrative_and_exam_facts_are_citable():
    """Facts that only live in narrative sections or exam fields must be groundable."""
    from app.grounding import check_finding
    b = load_case("08", "scored")
    ids, src = b.finding_ids(), b.case_sources()
    assert {"hpi", "fh", "meds", "ex_power", "ex_other"} <= ids
    give_way = {"quote": "Collapsing 'give-way' weakness of right grip", "source_id": "ex_power", "finding_ids": ["ex_power"]}
    assert check_finding(give_way, src, ids).grounded
    no_fh = {"quote": "", "source_id": "", "finding_ids": ["fh"]}
    assert check_finding(no_fh, load_case("01", "demo").case_sources(), load_case("01", "demo").finding_ids()).grounded
