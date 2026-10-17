"""Python-side checks on model spawn requests: depth, budget, duplicates, scope.
The model decides what to investigate; this decides whether that request may run.
"""

import re
from dataclasses import dataclass

MAX_CHILDREN_PER_DECISION = 4

# Treatment or ordering language is out of scope for a child objective.
_OUT_OF_SCOPE = re.compile(
    r"\b(prescribe|start (the )?patient on|administer|initiate treatment|treat the patient|"
    r"order (an?|the) |schedule|book an appointment|contact the patient)\b", re.I)

_STOP = {"the", "a", "an", "of", "and", "or", "to", "for", "with", "in", "on", "is", "whether", "this",
         "that", "which", "patient", "case", "record", "evidence", "assess", "identify", "determine"}


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9\-]+", text.lower()) if w not in _STOP and len(w) > 2}


def similarity(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


@dataclass
class SpawnCheck:
    ok: bool
    reason: str = ""


def check_spawn(*, objective: str, justification: str, parent_depth: int, max_depth: int,
                nodes_in_run: int, max_nodes: int, existing_objectives: list[str],
                duplicate_threshold: float = 0.7) -> SpawnCheck:
    objective = (objective or "").strip()
    justification = (justification or "").strip()
    if parent_depth + 1 > max_depth:
        return SpawnCheck(False, f"Depth limit: child would be at depth {parent_depth + 1} > {max_depth}")
    if nodes_in_run >= max_nodes:
        return SpawnCheck(False, f"Node budget exhausted ({max_nodes})")
    if len(objective) < 15:
        return SpawnCheck(False, "Objective is not specific enough")
    if len(objective) > 400:
        return SpawnCheck(False, "Objective is too long; split it")
    if len(justification) < 10:
        return SpawnCheck(False, "Missing justification")
    if _OUT_OF_SCOPE.search(objective):
        return SpawnCheck(False, "Out of scope: treatment or ordering instruction")
    for existing in existing_objectives:
        s = similarity(objective, existing)
        if s >= duplicate_threshold:
            return SpawnCheck(False, f"Duplicate of an existing task (similarity {s:.2f}): {existing[:80]}")
    return SpawnCheck(True)
