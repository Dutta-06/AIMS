"""There is no login, so these requests are the protection: who may change things."""

API = "/api/v1"
ORIGIN = "http://localhost:3000"


def test_reads_need_nothing(client):
    client.headers.pop("X-Corpo-Mailer")
    assert client.get(f"{API}/companies").status_code == 200
    assert client.get("/health").status_code == 200


def test_changes_without_the_header_are_refused(client):
    client.headers.pop("X-Corpo-Mailer")
    for method, url in [
        ("post", f"{API}/companies"),
        ("delete", f"{API}/companies/1"),
        ("patch", f"{API}/contacts/1"),
        ("post", f"{API}/drafts/1/send"),
    ]:
        r = client.request(method.upper(), url, json={"name": "x"})
        assert r.status_code == 403, (method, url)
    assert client.get(f"{API}/companies").json() == []  # and nothing got created


def test_a_bodyless_send_from_a_stranger_site_is_refused(client, lead, draft):
    """The drive-by case: a bare POST a browser sends from any website, with no preflight."""
    client.post(f"{API}/drafts/{draft['id']}/approve")
    r = client.post(
        f"{API}/drafts/{draft['id']}/send",
        headers={"Origin": "https://evil.example", "X-Corpo-Mailer": ""},
    )
    assert r.status_code == 403


def test_a_foreign_origin_is_refused_even_with_the_header(client):
    r = client.post(
        f"{API}/companies", json={"name": "x"}, headers={"Origin": "https://evil.example"}
    )
    assert r.status_code == 403 and "Origin" in r.json()["detail"]


def test_the_real_frontend_origin_is_allowed(client):
    r = client.post(f"{API}/companies", json={"name": "ok"}, headers={"Origin": ORIGIN})
    assert r.status_code == 201


def test_preflight_from_a_foreign_origin_gets_no_permission(client):
    r = client.options(
        f"{API}/drafts/1/send",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-corpo-mailer",
        },
    )
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_preflight_from_the_frontend_is_allowed(client):
    r = client.options(
        f"{API}/drafts/1/send",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-corpo-mailer",
        },
    )
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_there_is_no_login_route_any_more(client):
    assert client.post(f"{API}/auth/login", json={"password": "x", "name": "y"}).status_code == 404
