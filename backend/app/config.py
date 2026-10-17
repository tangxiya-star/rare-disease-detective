"""Runtime settings, read once from the environment (and the repo-root .env)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name) or default)


@dataclass(frozen=True)
class Settings:
    # "mock" runs the real orchestrator against scripted model answers (no API key needed).
    # "crusoe" calls Nemotron on Crusoe Managed Inference.
    llm_backend: str
    crusoe_api_key: str
    crusoe_base_url: str
    lead_model: str
    child_model: str
    # "europepmc" (live, no key), "youcom" (not wired yet), or "fixture" (offline, for tests).
    search_backend: str
    max_depth: int
    max_nodes_per_run: int
    max_concurrent_inference: int
    max_replans_per_branch: int
    db_path: Path
    repo_root: Path = REPO_ROOT


def load_settings() -> Settings:
    key = os.environ.get("CRUSOE_API_KEY", "")
    return Settings(
        llm_backend=os.environ.get("LLM_BACKEND") or ("crusoe" if key else "mock"),
        crusoe_api_key=key,
        crusoe_base_url=os.environ.get("CRUSOE_BASE_URL", "https://api.inference.crusoecloud.com/v1"),
        lead_model=os.environ.get("LEAD_MODEL", "nvidia/Nemotron-3-Super-120B-A12B"),
        child_model=os.environ.get("CHILD_MODEL", "nvidia/Nemotron-3-Nano-30B-A3B"),
        search_backend=os.environ.get("SEARCH_BACKEND", "europepmc"),
        max_depth=_int("MAX_DEPTH", 3),
        max_nodes_per_run=_int("MAX_NODES_PER_RUN", 24),
        max_concurrent_inference=_int("MAX_CONCURRENT_INFERENCE", 3),
        max_replans_per_branch=_int("MAX_REPLANS_PER_BRANCH", 1),
        db_path=Path(os.environ.get("RDD_DB_PATH") or REPO_ROOT / "backend" / "rdd.sqlite3"),
    )
