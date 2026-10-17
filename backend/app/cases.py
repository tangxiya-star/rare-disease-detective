"""Case loader and held-out evidence release.

The held-out rule lives here. Agents receive `agent_view()` only: the parsed case.json,
never the reference file, folder names, or media paths. Held-out results are released
one at a time by `HeldOutReleaser.request()`, when an agent asks for the matching
investigation and the reference's release rule allows it.
"""

import json
import re
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Literal

from .config import REPO_ROOT
from .kinematics import analyse as analyse_motion

Mode = Literal["scored", "demo"]
MANIFEST = REPO_ROOT / "cases" / "manifest.json"


_CASE_SECTIONS = ("chief_complaint", "history_of_present_illness", "family_history", "social_history",
                  "prior_workup_and_opinions", "medications", "neurological_exam")


@dataclass
class CaseBundle:
    slot: str
    mode: Mode
    raw_case: dict
    reference: dict
    annotations: dict | None = None
    video: Path | None = None
    landmarks: Path | None = None
    held_out_media: list[Path] = field(default_factory=list)
    retrieval_blocklist: list[str] = field(default_factory=list)

    @property
    def case_id(self) -> str:
        return self.case["case_id"]

    @cached_property
    def motion_analysis(self) -> list[dict]:
        """Kinematic measurements from the case video's hand landmarks (ka_* entries), if any."""
        if not self.landmarks or not self.landmarks.exists():
            return []
        return analyse_motion(json.loads(self.landmarks.read_text()))

    @property
    def case(self) -> dict:
        """case.json plus motion_analysis, so the measurements are citable like any finding."""
        return {**self.raw_case, "motion_analysis": self.motion_analysis} if self.motion_analysis else self.raw_case

    def agent_view(self) -> dict:
        """The only case content any model may see. Provenance is dropped: it is curation
        metadata, and for adapted cases it can hint at the source."""
        view = json.loads(json.dumps(self.case))
        view.pop("provenance", None)
        return view

    def case_sources(self) -> dict[str, str]:
        """Case record entries (by finding id) and narrative sections (by key) as quotable sources."""
        out = {k: str(self.case[k]) for k in _CASE_SECTIONS if self.case.get(k)}
        for k, v in (self.case.get("neurological_exam") or {}).items():
            out[f"neurological_exam.{k}"] = str(v)
        for key in ("movement_findings", "symptom_timeline", "labs", "imaging", "neurophysiology", "motion_analysis"):
            for entry in self.case.get(key, []):
                if "id" in entry:
                    out[entry["id"]] = " ".join(str(v) for k, v in entry.items() if k != "id")
        return out

    def finding_ids(self) -> set[str]:
        """Every id a claim may cite: entry ids (mf_, tl_, lab_, img_, np_, ka_) and case section keys."""
        ids = set(self.case_sources())
        for key in ("movement_findings", "symptom_timeline", "labs", "imaging", "neurophysiology", "motion_analysis"):
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
        raw_case=_load_json(e["case"]),
        reference=_load_json(e["reference"]),
        annotations=_load_json(e["annotations"]) if e.get("annotations") else None,
        video=REPO_ROOT / e["video"] if e.get("video") else None,
        landmarks=REPO_ROOT / e["landmarks"] if e.get("landmarks") else None,
        held_out_media=[REPO_ROOT / p for p in e.get("held_out_media", [])],
        retrieval_blocklist=e.get("retrieval_blocklist", []),
    )


# --- held-out release -------------------------------------------------------

# Words that mean the same investigation. Each group collapses to its first term.
_SYNONYMS = [
    ["levodopa", "dopa", "ldopa", "carbidopa", "sinemet"],
    ["dat", "datscan", "spect", "ioflupane", "cit", "transporter"],
    ["genetic", "gene", "genes", "genetics", "panel", "sequencing", "exome", "genome", "variant", "mutation"],
    ["csf", "lumbar", "puncture", "cerebrospinal", "pterins", "neopterin", "biopterin", "hva"],
    ["slit", "lamp", "kayser", "fleischer"],
    ["copper", "urine", "urinary"],
    ["emg", "electromyography", "myokymic", "myokymia"],
    ["eeg", "electroencephalogram"],
    ["acetazolamide", "diamox"],
    ["carbamazepine", "tegretol"],
    ["ketogenic", "keto"],
    ["video", "home", "recording"],
    ["family", "relatives", "mother", "father", "aunt", "segregation"],
    ["evening", "diurnal", "morning", "repeat", "waking", "fluctuation"],
    ["follow", "followup", "spread"],
    ["accelerometry", "entrainment", "tapping"],
    ["records", "clarification", "referrer", "addendum", "radiology"],
]
_CANON = {w: g[0] for g in _SYNONYMS for w in g}
_CORE = {g[0] for g in _SYNONYMS}  # one canonical term per investigation type
_STOP = {"the", "a", "an", "of", "and", "or", "to", "for", "with", "in", "on", "test", "testing",
         "trial", "exam", "examination", "study", "check", "assess", "order", "request", "please",
         "result", "results", "if", "only", "x", "mg", "patient", "perform", "obtain",
         "has", "have", "been", "ever", "done", "any", "other", "detailed", "clinical"}


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Zβ0-9]+", text.lower().replace("\u2011", "-"))
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
        """Word overlap, boosted when request and result share an investigation type
        (levodopa, DAT, genetics, CSF, slit lamp, ...), so long free-text requests still match."""
        req = _tokens(request)
        best, best_score = -1, 0.0
        for i, key in enumerate(self._keys):
            if not req or not key:
                continue
            shared = req & key
            score = len(shared) / min(len(req), len(key))
            if shared & _CORE:
                score = max(score, 0.5 + score / 10)
            if score > best_score:
                best, best_score = i, score
        return best, best_score

    def match(self, text: str) -> str | None:
        """gap_id of the held-out investigation this text names, if any (ignores release rules)."""
        i, score = self._best(text)
        return self.items[i]["gap_id"] if i >= 0 and score >= self.min_score else None

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
