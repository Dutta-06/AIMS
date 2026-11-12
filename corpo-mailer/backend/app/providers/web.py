"""Fetch public web pages safely, for checking that a suggested company is real and relevant.

The URLs come from an AI model, so they are untrusted. The fetcher therefore:
  * only speaks http(s) on ports 80/443, with no credentials in the URL;
  * refuses any host that resolves to a private, loopback, link-local or otherwise
    non-public address (so a suggested "website" can't make us probe your own network),
    and re-checks every redirect hop;
  * caps the download size and time, follows only a few redirects, and reads HTML only;
  * identifies itself honestly and obeys robots.txt.

Known limit: the DNS lookup used for the safety check and the one used to connect are separate
(a hostile DNS server could answer differently the second time). The risk is small for a
single-user tool on localhost, and is the reason this is documented rather than ignored.
"""

import ipaddress
import re
import socket
from dataclasses import dataclass, field
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Protocol
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx

USER_AGENT = "CorpoMailerBot/1.0 (+student hackathon outreach; checks public pages only)"
_EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")
_SKIP_TAGS = {"script", "style", "noscript", "svg", "template"}


class FetchError(Exception):
    """A page could not be fetched; the message is safe to show."""


class RobotsBlocked(FetchError):
    """The site's robots.txt asks bots to stay away, so we didn't look."""


@dataclass
class Page:
    url: str  # what we asked for
    final_url: str  # where we ended up after redirects
    status: int
    title: str = ""
    text: str = ""  # visible text only, whitespace-normalised
    links: list[tuple[str, str]] = field(default_factory=list)  # (absolute url, anchor text)
    emails: list[str] = field(default_factory=list)
    last_modified: str | None = None
    fetched_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class PageFetcher(Protocol):
    def fetch(self, url: str) -> Page: ...


# ------------------------------------------------------------------ URL safety
def _is_public(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if getattr(addr, "ipv4_mapped", None):
        addr = addr.ipv4_mapped
    return addr.is_global


def validate_public_url(url: str, *, allow_private: bool = False) -> str:
    """Return a normalised http(s) URL, or raise FetchError if it is not safe to fetch."""
    url = (url or "").strip()
    parts = urlsplit(url if "://" in url else f"https://{url}")
    if parts.scheme not in ("http", "https"):
        raise FetchError("Only http and https links can be checked")
    if parts.username or parts.password:
        raise FetchError("Links with a username or password are not checked")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host or "." not in host and not allow_private:
        raise FetchError("That doesn't look like a public website address")
    try:
        port = parts.port
    except ValueError:
        raise FetchError("Invalid port") from None
    if port not in (None, 80, 443) and not allow_private:
        raise FetchError("Only the standard web ports are checked")
    if not allow_private:
        try:
            infos = socket.getaddrinfo(host, port or (443 if parts.scheme == "https" else 80))
        except socket.gaierror:
            raise FetchError(f"Couldn't find {host}") from None
        if not infos or not all(_is_public(i[4][0]) for i in infos):
            raise FetchError("That address isn't a public website")
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path or "/", parts.query, ""))


# ------------------------------------------------------------------ HTML -> text
class _Extract(HTMLParser):
    def __init__(self, base: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base = base
        self.title = ""
        self.chunks: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.emails: list[str] = []
        self._skip = 0
        self._in_title = False
        self._href: str | None = None
        self._anchor: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in _SKIP_TAGS:
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "meta" and (
            a.get("property") == "og:site_name" or a.get("name") == "application-name"
        ):
            self.chunks.append(a.get("content") or "")
        elif tag == "img" and self._href is not None:
            self._anchor.append((a.get("alt") or a.get("title") or "").strip())  # a logo's name
        elif tag == "a" and a.get("href"):
            href = a["href"].strip()
            if href.lower().startswith("mailto:"):
                self.emails += [e.lower() for e in _EMAIL.findall(href[7:].split("?")[0])]
            elif not href.lower().startswith(("javascript:", "tel:", "#")):
                self._href = urljoin(self.base, href)
                self._anchor = []

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False
        elif tag == "a" and self._href:
            self.links.append((self._href, " ".join(self._anchor).strip()))
            self._href = None

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.chunks.append(data)
            if self._href is not None:
                self._anchor.append(data.strip())


def parse_html(html: str, base_url: str) -> tuple[str, str, list[tuple[str, str]], list[str]]:
    p = _Extract(base_url)
    p.feed(html)
    text = re.sub(r"\s+", " ", " ".join(p.chunks)).strip()[:200_000]
    emails = list(dict.fromkeys(p.emails + [e.lower() for e in _EMAIL.findall(text)]))
    return re.sub(r"\s+", " ", p.title).strip(), text, p.links, emails


# ------------------------------------------------------------------ the fetcher
class HttpFetcher:
    def __init__(
        self,
        *,
        timeout: float = 8.0,
        max_bytes: int = 600_000,
        max_redirects: int = 3,
        allow_private: bool = False,
        respect_robots: bool = True,
    ) -> None:
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.max_redirects = max_redirects
        self.allow_private = allow_private
        self.respect_robots = respect_robots
        self._robots: dict[str, RobotFileParser | None] = {}

    def _get(self, client: httpx.Client, url: str) -> tuple[httpx.Response, bytes, str]:
        """GET with manual redirects, checking every hop. Returns (response, body, final url)."""
        for _ in range(self.max_redirects + 1):
            safe = validate_public_url(url, allow_private=self.allow_private)
            try:
                with client.stream(
                    "GET", safe, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.5"}
                ) as r:
                    if r.is_redirect and r.headers.get("location"):
                        url = urljoin(safe, r.headers["location"])
                        continue
                    body = b""
                    for chunk in r.iter_bytes():
                        body += chunk
                        if len(body) >= self.max_bytes:
                            break  # enough to read the page; never download more
                    return r, body[: self.max_bytes], safe
            except httpx.TimeoutException:
                raise FetchError("The site took too long to answer") from None
            except httpx.HTTPError as exc:
                raise FetchError(f"Couldn't connect: {type(exc).__name__}") from None
        raise FetchError("Too many redirects")

    def _allowed(self, client: httpx.Client, url: str) -> bool:
        if not self.respect_robots:
            return True
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            parser: RobotFileParser | None = RobotFileParser()
            try:
                r, body, _ = self._get(client, f"{origin}/robots.txt")
                if r.status_code == 200:
                    parser.parse(body.decode("utf-8", "replace").splitlines())
                else:
                    parser = None  # no robots.txt: everything is allowed
            except FetchError:
                parser = None
            self._robots[origin] = parser
        parser = self._robots[origin]
        return parser is None or parser.can_fetch(USER_AGENT, url)

    def fetch(self, url: str) -> Page:
        url = validate_public_url(url, allow_private=self.allow_private)
        with httpx.Client(timeout=self.timeout, follow_redirects=False) as client:
            if not self._allowed(client, url):
                raise RobotsBlocked("The site's robots.txt asks bots not to read this page")
            r, body, final = self._get(client, url)
        ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
        page = Page(
            url=url,
            final_url=final,
            status=r.status_code,
            last_modified=r.headers.get("last-modified"),
        )
        if r.status_code < 400 and ctype in ("text/html", "application/xhtml+xml", ""):
            enc = r.charset_encoding or "utf-8"
            page.title, page.text, page.links, page.emails = parse_html(
                body.decode(enc, "replace"), final
            )
        return page


def get_fetcher() -> PageFetcher:
    return HttpFetcher()
