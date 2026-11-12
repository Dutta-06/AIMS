"""Web search, used only to find *pages* (e.g. other hackathons' sponsor lists) for a human to pick.

Search results are third-party text and are never trusted: they only suggest where to look. The
companies themselves still come from the plain-code sponsor-page extractor and must pass
verification against their own website.
"""

import re
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

import httpx

from app.core.config import Settings, get_settings


class SearchError(Exception):
    """Search isn't available or failed; the message is safe to show."""


@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str = ""
    age: str | None = None  # how old the search engine says the page is, as it words it


class SearchClient(Protocol):
    def search(self, query: str, count: int = 10) -> list[SearchHit]: ...


def _plain(text: str) -> str:
    """Search snippets contain light HTML (<strong>); keep just the words."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text or "")).strip()


class BraveSearch:
    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def search(self, query: str, count: int = 10) -> list[SearchHit]:
        if not self.s.search_api_key:
            raise SearchError("Web search isn't set up. Add SEARCH_API_KEY to the backend.")
        try:
            resp = httpx.get(
                self.s.search_base_url,
                params={"q": query, "count": max(1, min(count, 20)), "freshness": "py"},
                headers={
                    "X-Subscription-Token": self.s.search_api_key,
                    "Accept": "application/json",
                },
                timeout=self.s.search_timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise SearchError(f"Couldn't reach the search service: {type(exc).__name__}") from None
        if resp.status_code in (401, 403):
            raise SearchError("The search service refused the key. Check SEARCH_API_KEY.")
        if resp.status_code == 429:
            raise SearchError("The search quota is used up for now. Try again later.")
        if resp.status_code >= 400:
            raise SearchError(f"The search service answered with an error ({resp.status_code})")
        try:
            results = resp.json()["web"]["results"]
        except (ValueError, KeyError, TypeError):
            raise SearchError("The search service returned something unreadable") from None
        if not isinstance(results, list):
            raise SearchError("The search service returned something unreadable")
        hits = []
        for r in results:
            if not isinstance(r, dict):
                continue
            url = str(r.get("url") or "")
            if urlsplit(url).scheme in ("http", "https"):
                hits.append(
                    SearchHit(
                        title=_plain(str(r.get("title") or ""))[:200],
                        url=url,
                        snippet=_plain(str(r.get("description") or ""))[:300],
                        age=(str(r["age"]) if r.get("age") else None),
                    )
                )
        return hits


def get_search() -> SearchClient:
    return BraveSearch(get_settings())
