import httpx
import pytest

from app.core.config import Settings
from app.providers import llm as llm_mod
from app.providers.llm import LLMError, OpenRouterLLM, rotated


def settings(models):
    return Settings(openrouter_api_key="sk", llm_models=models)


def test_rotated_cycles_start_model():
    llm_mod._counter = iter(range(100))
    models = ["a", "b", "c"]
    assert [rotated(models)[0] for _ in range(4)] == ["a", "b", "c", "a"]
    assert sorted(rotated(models)) == models  # all remain as fallbacks
    assert rotated([]) == []


def fake_post(behaviour, calls):
    def post(url, headers, json, timeout):
        calls.append(json["model"])
        req = httpx.Request("POST", url)
        outcome = behaviour[json["model"]]
        if outcome == "429":
            return httpx.Response(429, request=req)
        return httpx.Response(
            200, json={"choices": [{"message": {"content": outcome}}]}, request=req
        )

    return post


def test_each_request_starts_on_the_next_model(monkeypatch):
    llm_mod._counter = iter(range(100))
    calls: list[str] = []
    monkeypatch.setattr(httpx, "post", fake_post({"a": "A", "b": "B"}, calls))
    client = OpenRouterLLM(settings(["a", "b"]))
    assert [client.complete(system="s", user="u") for _ in range(3)] == ["A", "B", "A"]
    assert calls == ["a", "b", "a"]


def test_rate_limited_model_falls_through_to_next(monkeypatch):
    llm_mod._counter = iter(range(100))
    calls: list[str] = []
    monkeypatch.setattr(httpx, "post", fake_post({"a": "429", "b": "B"}, calls))
    assert OpenRouterLLM(settings(["a", "b"])).complete(system="s", user="u") == "B"
    assert calls == ["a", "b"]


def test_all_models_failing_raises(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(httpx, "post", fake_post({"a": "429", "b": "429"}, calls))
    with pytest.raises(LLMError, match="All models failed"):
        OpenRouterLLM(settings(["a", "b"])).complete(system="s", user="u")
    assert sorted(calls) == ["a", "b"]


def test_missing_key_raises():
    s = Settings(openrouter_api_key="")
    with pytest.raises(LLMError, match="OPENROUTER_API_KEY"):
        OpenRouterLLM(s).complete(system="s", user="u")
