"""Model clients. The orchestrator only calls `complete_json(role, model, payload)`.

CrusoeClient: Nemotron on Crusoe Managed Inference via the OpenAI SDK (API client only).
MockClient (mock_llm.py): scripted answers so the real orchestrator runs without a key.
"""

import json
import re
from typing import Protocol

from .config import Settings
from .prompts import get_prompt


class ModelOutputError(RuntimeError):
    pass


class LLMClient(Protocol):
    name: str

    async def complete_json(self, role: str, model: str, payload: dict) -> dict: ...


_THINK = re.compile(r"<think>.*?</think>", re.S)
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")

# Keys each role must return; a reply missing any of them is re-requested.
REQUIRED_KEYS = {
    "lead_plan": {"hypotheses", "decision"},
    "investigator_plan": {"search_queries", "investigation_requests"},
    "investigator_analyze": {"findings", "decision"},
    "verifier": {"verdict"},
    "replan": {"decision"},
    "lead_report": {"differential", "cant_miss"},
}


def _loads(s: str):
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return json.loads(_TRAILING_COMMA.sub(r"\1", s))


def parse_json_object(text: str) -> dict:
    """Extract the first JSON object from model text (tolerates <think> blocks and code fences)."""
    text = _THINK.sub("", text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        obj = _loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = _loads(text[start:i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    raise ModelOutputError(f"No JSON object in model output: {text[:200]!r}")


class CrusoeClient:
    name = "crusoe"

    def __init__(self, settings: Settings):
        from openai import AsyncOpenAI

        if not settings.crusoe_api_key:
            raise RuntimeError("CRUSOE_API_KEY is not set")
        # The SDK backs off exponentially and honours Retry-After on 429s; the default of 2 retries
        # gives up within seconds, which a shared inference endpoint can exceed.
        self.client = AsyncOpenAI(base_url=settings.crusoe_base_url, api_key=settings.crusoe_api_key,
                                  max_retries=5)

    async def complete_json(self, role: str, model: str, payload: dict) -> dict:
        messages = [
            {"role": "system", "content": get_prompt(role)},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        last_err: Exception | None = None
        for _ in range(2):
            resp = await self.client.chat.completions.create(
                model=model, messages=messages, temperature=0.2, max_tokens=8192,
            )
            text = resp.choices[0].message.content or ""
            try:
                obj = parse_json_object(text)
                missing = REQUIRED_KEYS.get(role, set()) - set(obj)
                if missing:
                    raise ModelOutputError(f"Missing keys {sorted(missing)}; got {sorted(obj)}")
                return obj
            except ModelOutputError as e:
                last_err = e
                messages = messages + [
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": f"Invalid reply ({e}). Return only the complete JSON object "
                                                "with every required key, valid JSON, no trailing commas."},
                ]
        raise ModelOutputError(str(last_err))


def make_llm(settings: Settings) -> LLMClient:
    if settings.llm_backend == "crusoe":
        return CrusoeClient(settings)
    from .mock_llm import MockClient

    return MockClient()
