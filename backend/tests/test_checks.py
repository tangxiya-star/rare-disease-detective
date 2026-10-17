from app.grounding import check_finding
from app.search import Passage, _blocked
from app.validator import check_spawn

BASE = dict(parent_depth=0, max_depth=3, nodes_in_run=1, max_nodes=24, existing_objectives=[])


def test_spawn_ok():
    assert check_spawn(objective="Assess levodopa response literature in adult-onset limb dystonia",
                       justification="Leading hypothesis untested", **BASE).ok


def test_spawn_depth_budget_scope_duplicate():
    obj = "Assess levodopa response literature in adult-onset limb dystonia"
    assert not check_spawn(objective=obj, justification="needed here", **{**BASE, "parent_depth": 3}).ok
    assert not check_spawn(objective=obj, justification="needed here", **{**BASE, "nodes_in_run": 24}).ok
    assert not check_spawn(objective="Prescribe levodopa 100 mg three times daily now",
                           justification="needed here", **BASE).ok
    assert not check_spawn(objective=obj, justification="needed here",
                           **{**BASE, "existing_objectives": [obj + " please"]}).ok
    assert not check_spawn(objective=obj, justification="", **BASE).ok


def test_grounding_verbatim_quote_and_ids():
    texts = {"PMID:1": "Adult-onset GCH1 cases often lack diurnal fluctuation and progress slowly."}
    ids = {"mf_01", "lab_02"}
    ok = check_finding({"quote": "often lack diurnal fluctuation", "source_id": "PMID:1"}, texts, ids)
    assert ok.grounded
    assert not check_finding({"quote": "always lack diurnal fluctuation", "source_id": "PMID:1"}, texts, ids).grounded
    assert not check_finding({"quote": "often lack diurnal fluctuation", "source_id": "PMID:9"}, texts, ids).grounded
    assert check_finding({"quote": "", "finding_ids": ["mf_01"]}, texts, ids).grounded
    assert not check_finding({"quote": "", "finding_ids": ["mf_99"]}, texts, ids).grounded
    assert not check_finding({"claim": "unsupported"}, texts, ids).grounded


def test_blocklist_by_doi_and_title():
    p = Passage("PMID:34413919", "Case Report: Guitarist's cramp as the initial manifestation of DRD", "x",
                meta={"doi": "10.12688/f1000research.51433.1", "pmcid": "PMC8356262"})
    assert _blocked(p, ["10.12688/f1000research.51433.1"], [])
    assert _blocked(p, ["PMC8356262"], [])
    assert _blocked(p, [], ["Guitarist's cramp as the initial manifestation"])
    assert not _blocked(Passage("PMID:2", "Other", "x", meta={"doi": "10.1/abc"}), ["10.12688/x"], [])
