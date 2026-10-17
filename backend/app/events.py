"""Event stream. Every event is committed to SQLite first, then fanned out to live listeners,
so a client that reconnects can replay from its last `seq` and miss nothing.

Event types and payloads are documented in docs/EVENTS.md. Keep the two in sync.
"""

import asyncio
from collections import defaultdict

from .db import DB

EVENT_TYPES = {
    "run.started", "run.finished",
    "node.created", "node.status", "node.decision", "node.retry", "node.recovered",
    "spawn.rejected",
    "search.performed", "search.failed",
    "heldout.released", "heldout.unavailable",
    "evidence.added",
    "verification",
    "failure.injected",
    "report.check",
    "report.ready",
}


class EventBus:
    def __init__(self, db: DB):
        self.db = db
        self._listeners: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def emit(self, run_id: str, type_: str, data: dict) -> dict:
        assert type_ in EVENT_TYPES, type_
        event = self.db.append_event(run_id, type_, data)
        for q in list(self._listeners[run_id]):
            q.put_nowait(event)
        return event

    def subscribe(self, run_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._listeners[run_id].add(q)
        return q

    def unsubscribe(self, run_id: str, q: asyncio.Queue) -> None:
        self._listeners[run_id].discard(q)
