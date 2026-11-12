"""Web search: finds pages for a human to pick. The client is tested against a real local server."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest

from app.core.config import Settings
from app.providers.search import BraveSearch, SearchError, SearchHit

API = "/api/v1/discovery"
SECRET = "sk-test-secret-123"
SEEN: list[dict] = []
MODE = {"status": 200, "body": None}

RESULTS = {
    "web": {
        "results": [
            {
                "title": "Hack <strong>Sponsors</strong> 2026",
                "url": "https://hack.test/sponsors",
                "description": "Our <b>sponsors</b>  include\n many",
                "age": "2 weeks ago",
            },
            {"title": "No url", "description": "x"},
            {"title": "Weird scheme", "url": "javascript:alert(1)"},
            {"title": "Second", "url": "https://other.test/p", "description": "d"},
        ]
    }
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        parts = urlsplit(self.path)
        SEEN.append(
            {"params": parse_qs(parts.query), "token": self.headers.get("X-Subscription-Token")}
        )
        body = json.dumps(MODE["body"] if MODE["body"] is not None else RESULTS).encode()
        self.send_response(MODE["status"])
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/search"
    srv.shutdown()


@pytest.fixture(autouse=True)
def _reset():
    SEEN.clear()
    MODE.update(status=200, body=None)


def client_for(url, key=SECRET):
    return BraveSearch(Settings(search_api_key=key, search_base_url=url))


def test_the_key_and_a_one_year_freshness_filter_are_sent(server):
    client_for(server).search("hackathon sponsors", count=7)
    (req,) = SEEN
    assert req["token"] == SECRET
    assert req["params"] == {"q": ["hackathon sponsors"], "count": ["7"], "freshness": ["py"]}


def test_results_are_cleaned_and_unusable_ones_dropped(server):
    hits = client_for(server).search("q")
    assert hits == [
        SearchHit(
            "Hack Sponsors 2026",
            "https://hack.test/sponsors",
            "Our sponsors include many",
            "2 weeks ago",
        ),
        SearchHit("Second", "https://other.test/p", "d", None),
    ]


@pytest.mark.parametrize(
    ("status", "message"),
    [(401, "refused the key"), (403, "refused the key"), (429, "quota"), (500, r"error \(500\)")],
)
def test_failures_are_clear_and_never_leak_the_key(server, status, message):
    MODE["status"] = status
    with pytest.raises(SearchError, match=message) as exc:
        client_for(server).search("q")
    assert SECRET not in str(exc.value)


@pytest.mark.parametrize(
    "body", [["a", "list"], {"web": {}}, {"web": {"results": "nope"}}, {"web": None}]
)
def test_unreadable_answers_are_a_clear_error(server, body):
    MODE["body"] = body
    with pytest.raises(SearchError, match="unreadable"):
        client_for(server).search("q")


def test_a_result_list_with_junk_entries_still_yields_the_good_ones(server):
    MODE["body"] = {
        "web": {"results": ["junk", 7, None, {"title": "Ok", "url": "https://ok.test/"}]}
    }
    assert [h.url for h in client_for(server).search("q")] == ["https://ok.test/"]


def test_unreachable_services(server):
    with pytest.raises(SearchError, match="Couldn't reach") as exc:
        client_for("http://127.0.0.1:9/search").search("q")
    assert SECRET not in str(exc.value)


def test_without_a_key_it_says_how_to_set_one_up_and_calls_nothing(server):
    with pytest.raises(SearchError, match="SEARCH_API_KEY"):
        client_for(server, key="").search("q")
    assert SEEN == []


# ------------------------------------------------------------------ the endpoint
def hit(url, title="T", **kw):
    return SearchHit(title, url, kw.get("snippet", ""), kw.get("age"))


def test_endpoint_returns_pages_with_their_domain_and_age(client, search):
    search.hits = [
        hit("https://www.hack.test/sponsors", "Hack 2026", age="3 days ago", snippet="s")
    ]
    r = client.post(f"{API}/search", json={"query": "hackathon sponsors 2026"})
    assert r.json() == [
        {
            "title": "Hack 2026",
            "url": "https://www.hack.test/sponsors",
            "snippet": "s",
            "age": "3 days ago",
            "domain": "hack.test",
        }
    ]
    assert search.queries == ["hackathon sponsors 2026"]


def test_social_networks_duplicates_and_pile_ups_are_filtered(client, search):
    search.hits = [
        hit("https://twitter.com/x/status/1"),
        hit("https://www.linkedin.com/posts/y"),
        hit("https://a.test/1"),
        hit("https://a.test/1"),
        hit("https://a.test/2"),
        hit("https://blog.a.test/3"),
        hit("https://b.test/1"),
        hit("http://10.0.0.1/x"),
    ]
    urls = [h["url"] for h in client.post(f"{API}/search", json={"query": "sponsors"}).json()]
    assert urls == ["https://a.test/1", "https://a.test/2", "https://b.test/1"]  # max 2 per site


def test_search_failures_are_a_502_with_the_reason(client, search):
    search.error = "The search quota is used up for now. Try again later."
    r = client.post(f"{API}/search", json={"query": "sponsors"})
    assert r.status_code == 502 and "quota" in r.json()["detail"]


def test_queries_are_validated(client):
    assert client.post(f"{API}/search", json={"query": "x"}).status_code == 422
    assert client.post(f"{API}/search", json={"query": "q" * 201}).status_code == 422


def test_searching_saves_nothing_and_fetches_nothing(client, search, fetcher):
    search.hits = [hit("https://hack.test/sponsors")]
    client.post(f"{API}/search", json={"query": "sponsors"})
    assert fetcher.calls == [] and client.get(f"{API}", params={"state": "all"}).json() == []


def test_a_picked_result_flows_into_the_sponsor_extractor_and_verification(client, search, fetcher):
    from tests.conftest import page

    search.hits = [hit("https://hack.test/sponsors")]
    (found,) = client.post(f"{API}/search", json={"query": "sponsors"}).json()
    fetcher.pages[found["url"]] = page(
        found["url"], "Sponsors", links=[("https://acme.test/", "Acme Robotics")]
    )
    r = client.post(f"{API}/from-page", json={"url": found["url"]}).json()
    assert [p["name"] for p in r["added"]] == ["Acme Robotics"] and r["added"][0][
        "verdict"
    ] == "unverified"
