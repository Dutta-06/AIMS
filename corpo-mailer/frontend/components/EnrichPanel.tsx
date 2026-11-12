"use client";

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, ErrorNote, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Enrichment } from "@/lib/types";

const TONE = { verified: "green", needs_check: "amber", failed: "rose", unverified: "muted" } as const;
const LABEL = { verified: "Verified", needs_check: "Needs your check", failed: "Couldn't verify", unverified: "Not checked" } as const;

const host = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
};

/** Looks at a tracked company's public website and offers what's missing. Saves nothing until chosen. */
export default function EnrichPanel({ companyId, onSaved }: { companyId: number; onSaved: () => void }) {
  const toast = useToast();
  const look = useAction();
  const save = useAction();
  const [r, setR] = useState<Enrichment | null>(null);
  const [site, setSite] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const nothing = !site && picked.size === 0;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-heading">Check their website</p>
          <p className="mt-0.5 max-w-prose text-xs text-body">
            Opens their public website and looks for a missing web address and public inboxes (info@, partnerships@…). Nothing is saved until you choose, and nothing is contacted.
          </p>
        </div>
        <Button
          small
          disabled={look.busy}
          onClick={async () => {
            setR(null);
            await look.run(async () => {
              const found = await api.discovery.enrich(companyId);
              setR(found);
              setSite(found.website_is_new);
              setPicked(new Set(found.emails.filter((e) => !e.already_tracked).map((e) => e.email)));
            });
          }}
        >
          {look.busy ? "Checking…" : r ? "Check again" : "Check"}
        </Button>
      </div>
      <ErrorNote message={look.error} />

      {r && (
        <div className="space-y-3 border-t border-hairline pt-3" aria-live="polite">
          <p className="flex flex-wrap items-center gap-2 text-sm text-body">
            <Pill tone={TONE[r.verdict]}>{LABEL[r.verdict]}</Pill>
            {r.verdict_note}
          </p>

          {r.website_is_new && r.website && (
            <label className="flex items-center gap-2 text-sm text-heading">
              <input type="checkbox" checked={site} onChange={(e) => setSite(e.target.checked)} className="h-4 w-4 accent-[var(--st-responded)]" />
              Save <span className="font-mono text-[0.85rem]">{host(r.website)}</span> as their website
              <span className="text-xs text-faint">(the model guessed it; the page confirms it&apos;s them)</span>
            </label>
          )}

          {r.emails.length > 0 && (
            <ul className="space-y-1.5">
              {r.emails.map((e) => (
                <li key={e.email} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-2 text-heading">
                    <input
                      type="checkbox"
                      disabled={e.already_tracked}
                      checked={!e.already_tracked && picked.has(e.email)}
                      onChange={(ev) => {
                        const next = new Set(picked);
                        if (ev.target.checked) next.add(e.email);
                        else next.delete(e.email);
                        setPicked(next);
                      }}
                      className="h-4 w-4 accent-[var(--st-responded)]"
                    />
                    <span className="font-mono text-[0.85rem]">{e.email}</span>
                  </label>
                  <span className="text-xs text-faint">
                    {e.already_tracked ? "already in your leads · " : ""}written on{" "}
                    <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-heading hover:underline">
                      {host(e.source_url)} ↗
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {r.evidence.length > 0 && (
            <ul className="space-y-1 text-xs text-faint">
              {r.evidence.map((e) => (
                <li key={e.url}>
                  Saw <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-body hover:text-heading hover:underline">{host(e.url)} ↗</a> on {fmtDate(e.fetched_at)}: “{e.snippet.slice(0, 110)}{e.snippet.length > 110 ? "…" : ""}”
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              small
              disabled={save.busy || nothing}
              onClick={async () => {
                let result: { website_set: boolean; contacts_added: number; skipped: string[] } | null = null;
                const ok = await save.run(async () => {
                  result = await api.discovery.applyEnrichment(companyId, { set_website: site, emails: [...picked] });
                });
                if (ok && result) {
                  const done = result as { website_set: boolean; contacts_added: number; skipped: string[] };
                  toast(
                    done.skipped.length
                      ? `Saved ${done.contacts_added}; ${done.skipped.length} no longer on their website`
                      : `Saved ${done.contacts_added} ${done.contacts_added === 1 ? "inbox" : "inboxes"}${done.website_set ? " and the website" : ""}`,
                  );
                  setR(null);
                  onSaved();
                }
              }}
            >
              {save.busy ? "Saving…" : "Save selected"}
            </Button>
            <a href={r.linkedin_search_url} target="_blank" rel="noopener noreferrer" className="text-xs text-body hover:text-heading hover:underline">
              Find the right person on LinkedIn ↗
            </a>
          </div>
          <ErrorNote message={save.error} />
        </div>
      )}
    </Card>
  );
}
