"""Literature search with a per-run blocklist and the PRD recovery ladder:
reformulate query -> retry -> alternative source -> unresolved.
"""

import hashlib
import re
from dataclasses import dataclass, field

import httpx

EUROPE_PMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


class SearchError(RuntimeError):
    pass


@dataclass
class Passage:
    source_id: str
    title: str
    text: str
    url: str = ""
    meta: dict = field(default_factory=dict)


@dataclass
class SearchOutcome:
    query_used: str
    attempts: list[dict]
    passages: list[Passage]
    resolved: bool


def _blocked(p: Passage, blocklist: list[str], title_blocks: list[str]) -> bool:
    ids = {str(v).lower() for v in p.meta.values() if v} | {p.source_id.lower()}
    for b in blocklist:
        b = b.lower()
        if any(b == i or b in i for i in ids):
            return True
    return any(t.lower() in p.title.lower() for t in title_blocks)


async def europe_pmc(query: str, limit: int = 5, timeout: float = 15.0) -> list[Passage]:
    params = {"query": f"({query}) AND HAS_ABSTRACT:y", "format": "json", "resultType": "core", "pageSize": limit}
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.get(EUROPE_PMC, params=params)
        r.raise_for_status()
        data = r.json()
    out = []
    for item in data.get("resultList", {}).get("result", []):
        abstract = re.sub(r"<[^>]+>", "", item.get("abstractText") or "").strip()
        if not abstract:
            continue
        pmid, pmcid, doi = item.get("pmid"), item.get("pmcid"), item.get("doi")
        sid = f"PMID:{pmid}" if pmid else (pmcid or f"DOI:{doi}")
        out.append(Passage(
            source_id=sid, title=item.get("title", ""), text=abstract,
            url=f"https://europepmc.org/article/MED/{pmid}" if pmid else (f"https://doi.org/{doi}" if doi else ""),
            meta={"pmid": pmid, "pmcid": pmcid, "doi": doi, "journal": item.get("journalTitle"),
                  "year": item.get("pubYear")},
        ))
    return out


async def fixture_search(query: str, limit: int = 2) -> list[Passage]:
    """Offline, deterministic passages for tests and demos without network."""
    h = hashlib.sha1(query.encode()).hexdigest()[:8]
    return [Passage(source_id=f"FIXTURE:{h}-{i}", title=f"Fixture passage {i} for '{query}'",
                    text=f"This fixture passage discusses {query} in detail for testing purposes. "
                         f"It is not real literature and must not appear in clinical output.",
                    meta={"fixture": True}) for i in range(limit)]


def reformulate(query: str) -> str:
    """Shorten to the most specific terms."""
    words = [w for w in re.findall(r"[A-Za-z0-9\-]+", query) if len(w) > 3]
    words = sorted(set(words), key=lambda w: (-len(w), words.index(w)))[:4]
    return " ".join(words) or query


class Searcher:
    def __init__(self, backend: str):
        self.backend = backend
        self.forced_failures = 0  # set by failure injection: next N attempts raise

    async def _call(self, source: str, query: str) -> list[Passage]:
        if self.forced_failures > 0:
            self.forced_failures -= 1
            raise SearchError("Injected search failure")
        if source == "fixture":
            return await fixture_search(query)
        if source == "europepmc":
            return await europe_pmc(query)
        raise SearchError(f"Search backend {source!r} not available")

    async def search(self, query: str, blocklist: list[str], title_blocks: list[str]) -> SearchOutcome:
        primary = self.backend
        alternative = "europepmc" if primary != "europepmc" and primary != "fixture" else None
        ladder = [(primary, query), (primary, reformulate(query)), (primary, reformulate(query))]
        if alternative:
            ladder.append((alternative, reformulate(query)))
        attempts = []
        for source, q in ladder:
            try:
                found = [p for p in await self._call(source, q) if not _blocked(p, blocklist, title_blocks)]
                attempts.append({"source": source, "query": q, "ok": True, "n": len(found)})
                if found:
                    return SearchOutcome(q, attempts, found, True)
            except (SearchError, httpx.HTTPError) as e:
                attempts.append({"source": source, "query": q, "ok": False, "error": str(e)[:200]})
        return SearchOutcome(query, attempts, [], False)
