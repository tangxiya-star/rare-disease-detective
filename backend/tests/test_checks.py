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


def test_grounding_accepts_case_quotes_and_ignores_style():
    texts = {"mf_01": "Opening a screw-cap bottle provokes dystonic posturing"}
    assert check_finding({"quote": "opening a screw‑cap bottle provokes", "source_id": "mf_01"}, texts, {"mf_01"}).grounded
    assert check_finding({"quote": "", "finding_ids": ["mf_01", "case_01"]}, texts, {"mf_01"}).grounded


def test_grounding_accepts_labelled_case_fields_but_not_misquotes():
    texts = {"lab_02": "Serum ceruloplasmin 18 mg/dL 20–40 Referral letter states 'Wilson excluded'",
             "PMID:1": "Serum ceruloplasmin 18 mg/dL in this cohort"}
    ids = {"lab_02"}
    ok = lambda q, s="lab_02": check_finding({"quote": q, "source_id": s}, texts, ids).grounded
    assert ok("Serum ceruloplasmin, result: 18 mg/dL, reference_range: 20–40, note: 'Wilson excluded'")
    assert ok("Serum ceruloplasmin 18 mg/dL ... 'Wilson excluded'")
    assert not ok("Serum ceruloplasmin, note: 'Wilson disease excluded'")   # words added
    assert not ok("result: 18 mg/dL, normal")
    assert not ok("Serum ceruloplasmin, result: 18 mg/dL", "PMID:1")       # literature stays strictly verbatim


def test_clinical_rules_loaded_when_present(tmp_path, monkeypatch):
    from app import prompts
    monkeypatch.setattr(prompts, "REPO_ROOT", tmp_path)
    assert prompts.get_prompt("verifier") == prompts.PROMPTS["verifier"]
    (tmp_path / "docs" / "clinical").mkdir(parents=True)
    (tmp_path / "docs" / "clinical" / "verifier_checklist.md").write_text("R3 rule")
    assert "R3 rule" in prompts.get_prompt("verifier")
    assert "R3 rule" not in prompts.get_prompt("lead_plan")


def test_parse_json_prefers_outer_object_and_repairs_trailing_commas():
    from app.llm import parse_json_object
    txt = '<think>x</think>{"hypotheses": [{"name": "a", "ids": ["mf_01",],},], "decision": "spawn",}'
    obj = parse_json_object(txt)
    assert obj["decision"] == "spawn" and obj["hypotheses"][0]["name"] == "a"


def test_europe_pmc_citation_fields():
    from app.search import _citation
    item = {"pubYear": "2022", "authorString": "Holla VV, Pal PK.", "pageInfo": "156-161",
            "journalInfo": {"volume": "15", "issue": "2", "journal": {"isoabbreviation": "J Mov Disord"}}}
    c = _citation(item, "35287262", "PMC9171311", "10.14802/jmd.21146")
    assert c["journal"] == "J Mov Disord" and c["authors"].startswith("Holla") and c["pages"] == "156-161"
    assert c["volume"] == "15" and c["pmid"] == "35287262"


def test_source_ids_repeated_in_finding_ids_do_not_fail_grounding():
    from app.grounding import check_finding
    src = {"HELDOUT:gap_01": "Marked improvement of the dystonia on the following day, sustained."}
    f = {"quote": "Marked improvement of the dystonia on the following day", "source_id": "HELDOUT:gap_01",
         "finding_ids": ["HELDOUT:gap_01", "mf_01", "PMID:123"]}
    assert check_finding(f, src, {"mf_01"}).grounded
    # the quote is still what grounds it: a source id alone, with no quote, is not enough
    assert not check_finding({"quote": "", "source_id": "", "finding_ids": ["HELDOUT:gap_01"]}, src, {"mf_01"}).grounded
    # an invented case id still fails
    assert not check_finding({**f, "finding_ids": ["mf_99"]}, src, {"mf_01"}).grounded
