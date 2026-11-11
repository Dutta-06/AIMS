import itertools
import threading

import httpx

from app.core.config import Settings, get_settings


class LLMError(Exception):
    pass


# Process-wide so rotation continues across requests (a new client is built per request).
_counter = itertools.count()
_counter_lock = threading.Lock()


def rotated(models: list[str]) -> list[str]:
    """Round-robin start point, so free-tier rate limits are spread across models.

    Each call starts one model further along; the rest follow as fallbacks.
    """
    if not models:
        return []
    with _counter_lock:
        start = next(_counter) % len(models)
    return models[start:] + models[:start]


class LLM:
    """Anything that turns a system + user prompt into text."""

    def complete(self, *, system: str, user: str) -> str:
        raise NotImplementedError


class OpenRouterLLM(LLM):
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def complete(self, *, system: str, user: str) -> str:
        if not self.s.openrouter_api_key:
            raise LLMError("OPENROUTER_API_KEY is not configured")
        errors: list[str] = []
        for model in rotated(self.s.llm_models):
            try:
                resp = httpx.post(
                    f"{self.s.openrouter_base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.s.openrouter_api_key}"},
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                    },
                    timeout=self.s.llm_timeout_seconds,
                )
                resp.raise_for_status()
                text = resp.json()["choices"][0]["message"]["content"]
                if text and text.strip():
                    return text
                errors.append(f"{model}: empty response")
            except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
                errors.append(f"{model}: {exc}")  # try the next model (rate limits are common)
        raise LLMError("All models failed: " + "; ".join(errors))


def get_llm() -> LLM:
    return OpenRouterLLM(get_settings())
