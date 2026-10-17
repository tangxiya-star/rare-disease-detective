"""Case loader and held-out evidence release.

The held-out rule lives here. Agents receive `agent_view()` only: the parsed case.json,
never the reference file, folder names, or media paths. Held-out results are released
one at a time by `HeldOutReleaser.request()`, when an agent asks for the matching
investigation and the reference's release rule allows it.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from .config import REPO_ROOT

Mode = Literal["scored", "demo"]
MANIFEST = REPO_ROOT / "cases" / "manifest.json"


@dataclass
class CaseBundle:
    slot: str
    mode: Mode
    case: dict
    reference: dict
    annotations: dict | None = None
    video: Path | None = None
    held_out_media: list[Path] = field(default_factory=list)
    retrieval_blocklist: list[str] = field(default_factory=list)

    @property
    def case_id(self) -> str:
        return self.case["case_id"]

    def agent_view(self) -> dict:
        """The only case content any model may see. Provenance is dropped: it is curation
        metadata, and for adapted cases it can hint at the source."""
        view = json.loads(json.dumps(self.case))
        view.pop("provenance", None)
        return view

    def case_sources(self) -> dict[str, str]:
        """Case record entries as quotable sources, keyed by finding id."""
        out = {}
        for key in ("movement_findings", "symptom_timeline", "labs", "imaging", "neurophysiology"):
            for entry in self.case.get(key, []):
                if "id" in entry:
                    out[entry["id"]] = " ".join(str(v) for k, v in entry.items() if k != "id")
        return out

    def finding_ids(self) -> set[str]:
        """Every id a claim may cite: movement findings, timeline, labs, imaging, neurophysiology."""
        ids = set()
        for key in ("movement_findings", "symptom_timeline", "labs", "imaging", "neurophysiology"):
            for entry in self.case.get(key, []):
                if "id" in entry:
                    ids.add(entry["id"])
        return ids


def _load_json(rel: str) -> dict:
    return json.loads((REPO_ROOT / rel).read_text())


def list_cases(mode: Mode) -> list[dict]:
    manifest = json.loads(MANIFEST.read_text())
    out = []
    for entry in manifest[mode]:
        case = _load_json(entry["case"])
        out.append({"slot": entry["slot"], "case_id": case["case_id"], "title": case["title"]})
    return out


def load_case(slot: str, mode: Mode) -> CaseBundle:
    manifest = json.loads(MANIFEST.read_text())
    matches = [e for e in manifest[mode] if e["slot"] == slot]
    if not matches:
        raise KeyError(f"No {mode} case for slot {slot!r}")
    e = matches[0]
    return CaseBundle(
        slot=slot,
        mode=mode,
        case=_load_json(e["case"]),
        reference=_load_json(e["reference"]),
        annotations=_load_json(e["annotations"]) if e.get("annotations") else None,
        video=REPO_ROOT / e["video"] if e.get("video") else None,
        held_out_media=[REPO_ROOT / p for p in e.get("held_out_media", [])],
        retrieval_blocklist=e.get("retrieval_blocklist", []),
    )


# --- held-out release -------------------------------------------------------

# Words that mean the same investigation. Each group collapses to its first term.
_SYNONYMS = [
    ["levodopa", "l-dopa", "ldopa", "carbidopa", "sinemet", "dopaminergic trial"],
    ["dat", "datscan", "dat-spect", "ioflupane", "β-cit", "beta-cit", "dopamine transporter"],
    ["genetic", "gene", "genes", "genetics", "panel", "sequencing", "exome", "genome", "variant", "mutation"],
    ["csf", "lumbar", "puncture", "cerebrospinal", "pterins", "neopterin", "biopterin", "hva"],
    ["slit", "kayser", "fleischer", "slit-lamp"],
    ["copper", "urine", "urinary"],
    ["emg", "electromyography", "myokymic", "myokymia"],
    ["eeg", "electroencephalogram"],
    ["acetazolamide", "diamox"],
    ["carbamazepine", "tegretol"],
    ["ketogenic", "keto"],
    ["video", "home", "recording"],
    ["family", "relatives", "mother", "father", "aunt", "segregation"],
    ["evening", "diurnal", "morning", "repeat", "waking", "fluctuation"],
    ["follow-up", "followup", "spread", "follow"],
    ["accelerometry", "entrainment", "tapping"],
    ["records", "clarification", "referrer", "addendum", "radiology"],
]
_CANON = {w: g[0] for g in _SYNONYMS for w in g}
_STOP = {"the", "a", "an", "of", "and", "or", "to", "for", "with", "in", "on", "test", "testing",
         "trial", "exam", "examination", "study", "check", "assess", "order", "request", "please",
         "result", "results", "if", "only", "x", "mg", "patient", "perform", "obtain"}


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Zβ0-9\-]+", text.lower())
    return {_CANON.get(w, w) for w in words if w not in _STOP and len(w) > 1}


@dataclass
class Release:
    status: Literal["released", "withheld", "not_available"]
    request: str
    gap_id: str | None = None
    investigation: str | None = None
    result: str | None = None
    media: str | None = None
    reason: str | None = None


class HeldOutReleaser:
    """Matches an agent's free-text investigation request to one held-out result."""

    def __init__(self, bundle: CaseBundle, min_score: float = 0.34):
        self.items = bundle.reference.get("held_out_evidence", [])
        gaps = {g["id"]: g for g in bundle.reference.get("key_evidence_gaps", [])}
        self._keys = [
            _tokens(item["investigation"]) | _tokens(gaps.get(item["gap_id"], {}).get("question", ""))
            for item in self.items
        ]
        self.min_score = min_score
        self.released: dict[str, Release] = {}

    def _best(self, request: str) -> tuple[int, float]:
        req = _tokens(request)
        best, best_score = -1, 0.0
        for i, key in enumerate(self._keys):
            if not req or not key:
                continue
            score = len(req & key) / min(len(req), len(key))
            if score > best_score:
                best, best_score = i, score
        return best, best_score

    def request(self, request: str, depth: int) -> Release:
        i, score = self._best(request)
        if i < 0 or score < self.min_score:
            return Release("not_available", request, reason="No result for this investigation in the record.")
        item = self.items[i]
        rule = item.get("release_to_agent", "on_request")
        if rule == "never" or (rule == "after_depth_2" and depth < 2):
            return Release("withheld", request, gap_id=item["gap_id"], investigation=item["investigation"],
                           reason=f"Release rule '{rule}' not met at depth {depth}.")
        rel = Release("released", request, gap_id=item["gap_id"], investigation=item["investigation"],
                      result=item["result"], media=item.get("media"))
        self.released[f"{item['gap_id']}::{item['investigation']}"] = rel
        return rel
