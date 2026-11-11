"""Print OpenRouter's free models with their exact IDs, for the LLM_MODELS setting.

uv run python scripts/list_free_models.py            # all free models
uv run python scripts/list_free_models.py gemma nemotron   # filter by name
"""

import sys

import httpx

resp = httpx.get("https://openrouter.ai/api/v1/models", timeout=30)
resp.raise_for_status()
terms = [t.lower() for t in sys.argv[1:]]
for m in sorted(resp.json()["data"], key=lambda m: m["id"]):
    free = all(float(m["pricing"].get(k) or 0) == 0 for k in ("prompt", "completion"))
    if free and (not terms or any(t in (m["id"] + m["name"]).lower() for t in terms)):
        print(f"{m['id']:60} {m['name']}  ({m.get('context_length')} ctx)")
