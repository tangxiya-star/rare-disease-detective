"""Model clients. The orchestrator only calls `complete_json(role, model, payload)`.

CrusoeClient: Nemotron on Crusoe Managed Inference via the OpenAI SDK (API client only).
MockClient (mock_llm.py): scripted answers so the real orchestrator runs without a key.
"""

import json
import re
from typing import Protocol

from .config import Settings
from .prompts import PROMPTS


class ModelOutputError(RuntimeError):
    pass


class LLMClient(Protocol):
    name: str

    async def complete_json(self, role: str, model: str, payload: dict) -> dict: ...


_THINK = re.compile(r"<think>.*?</think>", re.S)


def parse_json_object(text: str) -> dict:
    """Extract the first JSON object from model text (tolerates <think> blocks and code fences)."""
    text = _THINK.sub("", text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        obj = json.loads(text)
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
                        obj = json.loads(text[start:i + 1])
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
        self.client = AsyncOpenAI(base_url=settings.crusoe_base_url, api_key=settings.crusoe_api_key)

    async def complete_json(self, role: str, model: str, payload: dict) -> dict:
        messages = [
            {"role": "system", "content": PROMPTS[role]},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        last_err: Exception | None = None
        for _ in range(2):
            resp = await self.client.chat.completions.create(
                model=model, messages=messages, temperature=0.2, max_tokens=4096,
            )
            text = resp.choices[0].message.content or ""
            try:
                return parse_json_object(text)
            except ModelOutputError as e:
                last_err = e
                messages = messages + [
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": "That was not a valid JSON object. Return only the JSON object."},
                ]
        raise ModelOutputError(str(last_err))


def make_llm(settings: Settings) -> LLMClient:
    if settings.llm_backend == "crusoe":
        return CrusoeClient(settings)
    from .mock_llm import MockClient

    return MockClient()
