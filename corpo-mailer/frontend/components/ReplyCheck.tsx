"use client";

import { useState } from "react";
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

/** Manual "check now" for reply tracking, plus whether the automatic check is healthy. */
export default function ReplyCheck({ status, onDone }: { status: ReplyStatus; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const [result, setResult] = useState<string | null>(null);

  if (!status.configured) {
    return (
      <p className="max-w-xs text-right text-xs text-muted">
        Reply tracking is off. Add the Gmail app password (IMAP) to the backend settings, or log
        replies by hand on each deal.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={busy}
        onClick={async () => {
          setResult(null);
          const ok = await run(async () => setResult(summary(await api.replies.sync())));
          onDone();
          if (!ok) setResult(null);
        }}
      >
        {busy ? "Checking…" : "Check for replies"}
      </Button>
      <p className={`max-w-xs text-right text-xs ${error || status.last_error ? "text-rose-600" : "text-muted"}`}>
        {error ??
          result ??
          (status.last_error
            ? `Last check failed: ${status.last_error}`
            : status.last_sync_at
              ? `Checked ${age(status.last_sync_at)}${status.polling ? " · checks automatically" : ""}`
              : "Not checked yet")}
      </p>
    </div>
  );
}
