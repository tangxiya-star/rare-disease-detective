"""Evidence grounding, checked in code rather than by a model (PRD §7):
a quoted passage must appear verbatim in the cited source text, and every cited case
finding id must exist in case.json. A finding must have at least one of the two.
"""

import re
from dataclasses import dataclass


def _norm(text: str) -> str:
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class GroundingResult:
    grounded: bool
    note: str


def check_finding(finding: dict, source_texts: dict[str, str], case_finding_ids: set[str],
                  min_quote_chars: int = 20) -> GroundingResult:
    quote = _norm(finding.get("quote") or "")
    source_id = (finding.get("source_id") or "").strip()
    ids = [i for i in finding.get("finding_ids") or [] if i]

    bad_ids = [i for i in ids if i not in case_finding_ids]
    if bad_ids:
        return GroundingResult(False, f"Case finding ids not in record: {', '.join(bad_ids)}")

    if quote:
        if len(quote) < min_quote_chars:
            return GroundingResult(False, "Quote too short to verify")
        if source_id not in source_texts:
            return GroundingResult(False, f"Unknown source_id {source_id!r}")
        if quote not in _norm(source_texts[source_id]):
            return GroundingResult(False, f"Quote not found verbatim in {source_id}")
        return GroundingResult(True, f"Quote verified in {source_id}" + (f"; cites {', '.join(ids)}" if ids else ""))

    if ids:
        return GroundingResult(True, f"Cites case findings {', '.join(ids)}")
    return GroundingResult(False, "No quote and no case finding ids")
