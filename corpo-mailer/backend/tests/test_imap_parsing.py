"""Parsing real-shaped raw emails (no network)."""

from app.providers.imap import parse_message, strip_quoted

PLAIN_REPLY = b"""\
From: Raj Mehta <Raj@Acme.com>
To: us@gmail.com
Subject: Re: Sponsor brAInwave 3
Message-ID: <reply-1@acme.com>
In-Reply-To: <sent-1@mail.gmail.com>
References: <older@x.com> <sent-1@mail.gmail.com>
Date: Tue, 10 Nov 2026 09:30:00 +0530
Content-Type: text/plain; charset=utf-8

Hi, sounds interesting. Can we talk Thursday?

Regards,
Raj

On Mon, 9 Nov 2026 at 18:00, Team <us@gmail.com> wrote:
> Hello Raj, we'd love your support.
> Thanks
"""

HTML_REPLY = b"""\
From: priya@acme.com
Subject: Re: hello
Message-ID: <h1@acme.com>
Date: Tue, 10 Nov 2026 10:00:00 +0000
Content-Type: text/html; charset=utf-8

<html><style>p{color:red}</style><body>
<p>Yes, please send the deck.</p><div>Thanks</div></body></html>
"""

OUT_OF_OFFICE = b"""\
From: raj@acme.com
Subject: Automatic reply: Sponsor brAInwave 3
Message-ID: <ooo@acme.com>
Auto-Submitted: auto-replied
Date: Tue, 10 Nov 2026 09:31:00 +0000

I'm away until Monday.
"""

BOUNCE = b"""\
From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
Subject: Delivery Status Notification (Failure)
Message-ID: <dsn@googlemail.com>
Date: Tue, 10 Nov 2026 09:32:00 +0000
Content-Type: multipart/report; report-type=delivery-status; boundary="b"

--b
Content-Type: text/plain

Address not found. Your message wasn't delivered to ghost@acme.com.

--b
Content-Type: message/delivery-status

Final-Recipient: rfc822; ghost@acme.com
Action: failed
Status: 5.1.1

--b--
"""


def test_plain_reply_fields_and_quote_stripping():
    m = parse_message(7, PLAIN_REPLY, uidvalidity=3)
    assert m.uid == 7 and m.message_id == "<reply-1@acme.com>"
    assert m.from_email == "raj@acme.com"  # lowercased, display name dropped
    assert m.subject == "Re: Sponsor brAInwave 3"
    assert m.in_reply_to == ["<sent-1@mail.gmail.com>", "<older@x.com>", "<sent-1@mail.gmail.com>"]
    assert m.body == "Hi, sounds interesting. Can we talk Thursday?\n\nRegards,\nRaj"
    assert "We'd love" not in m.body and "wrote:" not in m.body
    assert m.sent_at.isoformat() == "2026-11-10T04:00:00+00:00"  # converted to UTC
    assert not m.is_auto_reply and not m.is_bounce


def test_html_only_reply_is_converted_to_text():
    m = parse_message(1, HTML_REPLY)
    assert "Yes, please send the deck." in m.body
    assert "color:red" not in m.body and "<" not in m.body


def test_out_of_office_is_flagged_auto_reply():
    assert parse_message(1, OUT_OF_OFFICE).is_auto_reply


def test_bounce_is_detected_and_keeps_raw_text():
    m = parse_message(1, BOUNCE)
    assert m.is_bounce and not m.is_auto_reply
    assert "Final-Recipient: rfc822; ghost@acme.com" in m.raw_text


def test_missing_message_id_gets_a_stable_synthetic_one():
    raw = b"From: a@b.com\nSubject: hi\n\nbody\n"
    assert parse_message(5, raw, uidvalidity=9).message_id == "<imap-9-5@no-message-id>"
    assert parse_message(5, raw, uidvalidity=9).message_id == parse_message(5, raw, 9).message_id


def test_missing_or_bad_date_falls_back_to_now():
    m = parse_message(1, b"From: a@b.com\nDate: not a date\n\nx\n")
    assert m.sent_at.tzinfo is not None


def test_strip_quoted_variants():
    assert strip_quoted("Thanks!\n\n> old text\n> more") == "Thanks!"
    assert strip_quoted("Sure.\n\n-----Original Message-----\nFrom: x\nold") == "Sure."
    assert strip_quoted("Yes\r\n\r\nOn 1 Jan 2026, A <a@b.c> wrote:\r\nold") == "Yes"
    assert strip_quoted("x" * 10_000) == "x" * 4000
