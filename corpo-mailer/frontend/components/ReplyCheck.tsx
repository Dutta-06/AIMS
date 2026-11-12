"use client";

import { useRef, useState } from "react";
import { useSignal } from "@/components/signal/SignalProvider";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { daysAgo, fmtDateTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { ReplyStatus, SyncResult } from "@/lib/types";

function summary(r: SyncResult): string {
  const parts = [
    r.replies && `${r.replies} new ${r.replies === 1 ? "reply" : "replies"}`,
    r.bounces && `${r.bounces} bounced`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "No new replies";
}

function age(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const days = daysAgo(iso) ?? 0;
  return days < 1 ? `${Math.floor(mins / 60)} h ago` : fmtDateTime(iso);
}

/** Manual "check now" for reply tracking, with a dot showing whether the automatic check is healthy. */
export default function ReplyCheck({ status, onDone }: { status: ReplyStatus; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const signal = useSignal();
  const button = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<string | null>(null);

  const failing = Boolean(error || status.last_error);
  const checked = Boolean(status.last_sync_at);
  const dot = !status.configured || (!checked && !failing) ? "bg-faint" : failing ? "bg-danger" : "bg-ok";

  const line = !status.configured
    ? "Sign in with Google to check for replies."
    : (error ??
      result ??
      (status.last_error
        ? `Last check failed: ${status.last_error}`
        : status.last_sync_at
          ? `Checked ${age(status.last_sync_at)}${status.polling ? " · checks every 5 minutes while this page is open" : ""}`
          : "Not checked yet"));

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      {status.configured && (
        <Button
          ref={button}
          disabled={busy}
          onClick={async () => {
            setResult(null);
            let found = false;
            const ok = await run(async () => {
              const r = await api.replies.sync();
              setResult(summary(r));
              found = r.replies > 0 || r.bounces > 0;
            });
            if (ok && found) signal.pulse(button.current); // the light answers when something arrived
            onDone();
          }}
        >
          {busy ? "Checking…" : "Check for replies"}
        </Button>
      )}
      <p
        aria-live="polite"
        className={`flex max-w-xs items-center gap-2 text-xs sm:justify-end ${failing ? "text-danger" : "text-body"}`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        {line}
      </p>
    </div>
  );
}
