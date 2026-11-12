"""A tiny in-process IMAP server: just enough protocol to exercise IMAPMailboxReader."""

import base64
import re
import socketserver
import threading


class _Handler(socketserver.StreamRequestHandler):
    def send(self, text: str | bytes) -> None:
        self.wfile.write(text.encode() if isinstance(text, str) else text)

    def handle(self):
        srv: FakeIMAPServer = self.server  # type: ignore[assignment]
        self.send("* OK IMAP4rev1 ready\r\n")
        while line := self.rfile.readline().decode().strip():
            srv.commands.append(line)
            tag, _, rest = line.partition(" ")
            cmd, _, args = rest.partition(" ")
            cmd = cmd.upper()
            if cmd == "CAPABILITY":
                self.send(f"* CAPABILITY IMAP4rev1\r\n{tag} OK done\r\n")
            elif cmd == "AUTHENTICATE" and args.upper() == "XOAUTH2":
                self.send("+ \r\n")
                got = base64.b64decode(self.rfile.readline().strip()).decode()
                srv.oauth_logins.append(got)
                want = f"user={srv.user}\x01auth=Bearer {srv.token}\x01\x01"
                self.send(
                    f"{tag} OK ok\r\n"
                    if got == want
                    else f"{tag} NO [AUTHENTICATIONFAILED] bad\r\n"
                )
            elif cmd in ("SELECT", "EXAMINE"):
                self.send(
                    f"* {len(srv.messages)} EXISTS\r\n* OK [UIDVALIDITY {srv.uidvalidity}] ok\r\n"
                    f"{tag} OK [READ-ONLY] done\r\n"
                )
            elif cmd == "UID" and args.upper().startswith("SEARCH"):
                self.send(
                    f"* SEARCH {' '.join(map(str, self.search(srv, args)))}\r\n{tag} OK done\r\n"
                )
            elif cmd == "UID" and args.upper().startswith("FETCH"):
                uid = int(args.split()[1])
                raw = srv.messages[uid]
                self.send(f"* 1 FETCH (UID {uid} BODY[]<0> {{{len(raw)}}}\r\n")
                self.send(raw)
                self.send(f")\r\n{tag} OK done\r\n")
            elif cmd == "LOGOUT":
                self.send(f"* BYE\r\n{tag} OK bye\r\n")
                return
            else:
                self.send(f"{tag} BAD unsupported\r\n")

    @staticmethod
    def search(srv, args: str) -> list[int]:
        uids = sorted(srv.messages)
        if m := re.search(r"UID (\d+):\*", args):
            # Real servers always include the newest message, even if it is below n.
            return [u for u in uids if u >= int(m.group(1))] or uids[-1:]
        return uids  # SINCE <date>


class FakeIMAPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, messages: dict[int, bytes], uidvalidity=42, user="us@gmail.com"):
        super().__init__(("127.0.0.1", 0), _Handler)
        self.messages, self.uidvalidity = messages, uidvalidity
        self.user = user
        self.token = "good-token"  # accepted by AUTHENTICATE XOAUTH2
        self.oauth_logins: list[str] = []
        self.commands: list[str] = []
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def port(self) -> int:
        return self.server_address[1]
