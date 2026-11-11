import httpx

from app.core.config import Settings, get_settings


class LLMError(Exception):
    pass


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
        for model in self.s.llm_models:
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
