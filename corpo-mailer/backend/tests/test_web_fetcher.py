"""The page fetcher, against a real local web server, plus its address-safety rules."""

import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.providers import web
from app.providers.web import FetchError, HttpFetcher, parse_html, validate_public_url

HOME = """<html><head><title> Acme
 Robotics </title><meta property="og:site_name" content="Acme Robotics"></head><body>
<script>var secret = "hidden-script-text";</script><style>.a{color:red}</style>
<h1>We build robots</h1>
<a href="/community">Community</a>
<a href="mailto:Partnerships@acme.test?subject=Hi">Email us</a>
<a href="javascript:void(0)">nope</a><a href="#top">top</a><a href="tel:123">call</a>
<p>Contact info@acme.test. &copy; 2026 Acme</p></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code=200, body=b"", ctype="text/html; charset=utf-8", **headers):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        for k, v in headers.items():
            self.send_header(k.replace("_", "-"), v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path
        if path == "/":
            self.reply(body=HOME.encode(), Last_Modified="Wed, 01 Jan 2025 00:00:00 GMT")
        elif path == "/redirect":
            self.reply(302, Location="/")
        elif path == "/loop":
            self.reply(302, Location="/loop")
        elif path == "/to-private":
            self.reply(302, Location="/evil-target")
        elif path == "/big":
            self.reply(body=b"<p>" + b"x" * 5_000_000 + b"</p>")
        elif path == "/slow":
            time.sleep(2)
            self.reply(body=b"late")
        elif path == "/pdf":
            self.reply(body=b"%PDF-1.4", ctype="application/pdf")
        elif path == "/missing":
            self.reply(404, b"nope")
        elif path == "/robots.txt":
            self.reply(body=b"User-agent: *\nDisallow: /private\n", ctype="text/plain")
        elif path == "/private":
            self.reply(body=b"<title>Private</title>secret page")
        else:
            self.reply(404, b"nope")


@pytest.fixture(scope="module")
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def local(**kw):
    return HttpFetcher(allow_private=True, **kw)  # the test server is on loopback


# ------------------------------------------------------------------ parsing
def test_page_is_reduced_to_visible_text_title_links_and_emails(server):
    p = local().fetch(f"{server}/")
    assert p.status == 200 and p.title == "Acme Robotics"
    assert (
        "We build robots" in p.text
        and "hidden-script-text" not in p.text
        and "color:red" not in p.text
    )
    assert "Acme Robotics" in p.text  # og:site_name is kept as text
    assert (f"{server}/community", "Community") in p.links
    assert not any(u.startswith(("javascript:", "tel:", f"{server}/#")) for u, _ in p.links)
    assert p.emails == ["partnerships@acme.test", "info@acme.test"]
    assert p.last_modified == "Wed, 01 Jan 2025 00:00:00 GMT"


def test_parse_html_handles_junk_without_raising():
    title, text, links, emails = parse_html("<p>unclosed <b>tags <a href=>x", "https://a.test/")
    assert "unclosed" in text and emails == []


# ------------------------------------------------------------------ fetching
def test_redirects_are_followed_and_the_final_url_reported(server):
    p = local().fetch(f"{server}/redirect")
    assert p.final_url == f"{server}/" and p.title == "Acme Robotics"


def test_redirect_loops_stop(server):
    with pytest.raises(FetchError, match="Too many redirects"):
        local().fetch(f"{server}/loop")


def test_downloads_are_capped(server):
    p = local(max_bytes=100_000).fetch(f"{server}/big")
    assert p.status == 200 and len(p.text) <= 100_000  # never reads the whole 5 MB


def test_slow_sites_time_out(server):
    with pytest.raises(FetchError, match="too long"):
        local(timeout=0.5).fetch(f"{server}/slow")


def test_non_html_is_not_parsed(server):
    p = local().fetch(f"{server}/pdf")
    assert p.status == 200 and p.text == "" and p.title == ""


def test_error_pages_are_reported_not_raised(server):
    assert local().fetch(f"{server}/missing").status == 404


def test_an_unreachable_host_is_a_clear_error():
    with pytest.raises(FetchError, match="Couldn't connect"):
        local(timeout=1).fetch("http://127.0.0.1:9/")  # nothing listens on port 9


# ------------------------------------------------------------------ robots.txt
def test_robots_txt_is_obeyed(server):
    with pytest.raises(FetchError, match="robots.txt"):
        local().fetch(f"{server}/private")
    assert local().fetch(f"{server}/").status == 200  # other pages are fine


def test_robots_can_be_switched_off_for_tests(server):
    assert "secret page" in local(respect_robots=False).fetch(f"{server}/private").text


# ------------------------------------------------------------------ safety
def test_every_redirect_hop_is_re_checked(server, monkeypatch):
    """A public-looking page that redirects into a private address must be refused."""
    real = web.validate_public_url

    def checked(url, *, allow_private=False):
        if "evil-target" in url:
            raise FetchError("That address isn't a public website")
        return real(url, allow_private=True)

    monkeypatch.setattr(web, "validate_public_url", checked)
    with pytest.raises(FetchError, match="isn't a public website"):
        HttpFetcher(respect_robots=False).fetch(f"{server}/to-private")


def fake_dns(monkeypatch, mapping):
    def getaddrinfo(host, port, *a, **k):
        if host not in mapping:
            raise socket.gaierror("not found")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in mapping[host]]

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "gopher://example.com",
        "http://user:pass@example.com/",
        "http://example.com:22/",
        "http://example.com:8080/",
        "http://localhost/",
        "http://metadata/",  # no dot: not a public name
        "",
    ],
)
def test_unsafe_urls_are_refused(url, monkeypatch):
    fake_dns(
        monkeypatch,
        {
            "example.com": ["93.184.216.34"],
            "localhost": ["127.0.0.1"],
            "metadata": ["169.254.169.254"],
        },
    )
    with pytest.raises(FetchError):
        validate_public_url(url)


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.5",
        "192.168.1.1",
        "172.16.0.9",
        "169.254.169.254",
        "0.0.0.0",
        "100.64.0.1",
        "::1",
        "fe80::1",
        "fd00::1",
        "::ffff:10.0.0.1",
    ],
)
def test_names_that_resolve_to_private_addresses_are_refused(ip, monkeypatch):
    fake_dns(monkeypatch, {"sneaky.example": [ip]})
    with pytest.raises(FetchError, match="isn't a public website"):
        validate_public_url("https://sneaky.example/")


def test_a_name_with_any_private_answer_is_refused(monkeypatch):
    fake_dns(monkeypatch, {"mixed.example": ["93.184.216.34", "10.0.0.1"]})
    with pytest.raises(FetchError):
        validate_public_url("https://mixed.example/")


def test_dns_failure_is_a_clear_error(monkeypatch):
    fake_dns(monkeypatch, {})
    with pytest.raises(FetchError, match="Couldn't find"):
        validate_public_url("https://nope.example/")


def test_public_sites_are_accepted_and_normalised(monkeypatch):
    fake_dns(monkeypatch, {"www.acme.test": ["93.184.216.34"]})
    assert validate_public_url("WWW.Acme.test/About?x=1#frag") == "https://www.acme.test/About?x=1"
    assert validate_public_url("http://www.acme.test:80") == "http://www.acme.test:80/"
