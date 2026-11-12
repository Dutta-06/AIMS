"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { soft } from "@/components/motion/springs";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { errorMessage, useAction, useQuery } from "@/lib/hooks";
import type { Prospect, ProspectState, SearchHit, Verdict } from "@/lib/types";
import { companyHref } from "@/lib/routes";

const TABS: { value: ProspectState; label: string }[] = [
  { value: "new", label: "To review" },
  { value: "snoozed", label: "Snoozed" },
  { value: "rejected", label: "Rejected" },
  { value: "accepted", label: "Accepted" },
];

const VERDICT: Record<Verdict, { label: string; tone: "green" | "amber" | "rose" | "muted"; heading: string }> = {
  verified: { label: "Verified", tone: "green", heading: "Verified on their website" },
  needs_check: { label: "Needs your check", tone: "amber", heading: "Worth a look by hand" },
  unverified: { label: "Not checked yet", tone: "muted", heading: "Not checked yet" },
  failed: { label: "Couldn't verify", tone: "rose", heading: "Couldn't verify" },
};
const GROUPS: Verdict[] = ["verified", "needs_check", "unverified", "failed"];

const host = (url: string) => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
};

function Evidence({ p }: { p: Prospect }) {
  const [open, setOpen] = useState(false);
  if (p.evidence.length === 0 && p.emails.length === 0) return null;
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs text-body underline-offset-2 hover:text-heading hover:underline">
        {open ? "Hide" : "Show"} what I saw ({p.evidence.length} {p.evidence.length === 1 ? "page" : "pages"}
        {p.emails.length > 0 ? `, ${p.emails.length} public ${p.emails.length === 1 ? "address" : "addresses"}` : ""})
      </button>
      {open && (
        <ul className="mt-2 space-y-3">
          {p.evidence.map((e) => (
            <li key={e.url} className="rounded-xl border border-hairline bg-white/[0.03] p-3 text-sm">
              <p className="text-body">“{e.snippet}”</p>
              <p className="mt-1.5 text-xs text-faint">
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:text-heading hover:underline">
                  {host(e.url)} ↗
                </a>{" "}
                · seen {fmtDate(e.fetched_at)}
                {e.last_modified ? ` · page says updated ${e.last_modified}` : ""}
              </p>
            </li>
          ))}
          {p.emails.map((m) => (
            <li key={m.email} className="text-xs text-body">
              <span className="font-mono text-heading">{m.email}</span> · written on{" "}
              <a href={m.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-heading hover:underline">
                {host(m.source_url)} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProspectCard({ p, tab, onChanged, checking }: { p: Prospect; tab: ProspectState; onChanged: () => void; checking: boolean }) {
  const toast = useToast();
  const { busy, error, run } = useAction();
  const [fixing, setFixing] = useState(false);
  const [site, setSite] = useState(p.website ?? "");
  const v = VERDICT[p.verdict];
  const canAccept = (p.verdict === "verified" || p.verdict === "needs_check") && !p.stale;
  const recheck = (website?: string) =>
    run(async () => {
      await api.discovery.verify(p.id, website);
      setFixing(false);
      onChanged();
    });

  return (
    <Card className="space-y-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-[1.05rem] font-medium text-heading">
            {p.name}
            <Pill tone={checking ? "muted" : v.tone}>{checking ? "Checking…" : v.label}</Pill>
            {p.stale && <Pill tone="amber">Out of date: re-check</Pill>}
            {p.industry && <span className="text-xs font-normal text-faint">{p.industry}</span>}
          </h3>
          <p className="mt-0.5 text-xs text-body">
            {p.website ? (
              <a href={p.website} target="_blank" rel="noopener noreferrer" className="hover:text-heading hover:underline">
                {p.domain} ↗
              </a>
            ) : (
              "No website"
            )}
            {p.checked_at ? ` · checked ${fmtDate(p.checked_at)}` : ""}
          </p>
        </div>
        {tab === "new" && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              small
              disabled={busy || checking || !canAccept}
              title={canAccept ? "Add to your companies and leads" : "Only checked, up-to-date companies can be accepted"}
              onClick={async () => {
                let id: number | null = null;
                const ok = await run(async () => {
                  id = (await api.discovery.accept(p.id)).company_id;
                });
                if (ok && id) {
                  toast(`Added ${p.name} to your companies`);
                  onChanged();
                }
              }}
            >
              Accept
            </Button>
            <Button small disabled={busy || checking} onClick={() => recheck()}>
              {busy ? "Checking…" : p.checked_at ? "Re-check" : "Check"}
            </Button>
            <Button small variant="ghost" disabled={busy || checking} onClick={() => run(async () => { await api.discovery.snooze(p.id); toast(`Snoozed ${p.name} for 30 days`); onChanged(); })}>
              Snooze
            </Button>
            <Button small variant="danger" disabled={busy || checking} onClick={() => run(async () => { await api.discovery.reject(p.id); toast(`${p.name} won't be suggested again`); onChanged(); })}>
              Reject
            </Button>
          </div>
        )}
        {tab === "accepted" && p.company_id && (
          <Link href={companyHref(p.company_id)} className="text-sm text-body hover:text-heading hover:underline">
            Open company →
          </Link>
        )}
        {(tab === "snoozed" || tab === "rejected") && (
          <Button small disabled={busy} onClick={() => run(async () => { await api.discovery.verify(p.id); onChanged(); })}>
            Check again
          </Button>
        )}
      </div>

      {p.verdict_note && <p className="pt-1 text-sm text-body">{p.verdict_note}</p>}
      {p.source && <p className="text-xs text-faint">Found on: {p.source}. The name is a guess from the link; the check below confirms it.</p>}
      {p.why && (
        <p className="text-xs text-faint">
          The AI&apos;s reason (not checked): {p.why}
        </p>
      )}
      <Evidence p={p} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-xs">
        <a href={p.linkedin_search_url} target="_blank" rel="noopener noreferrer" className="text-body hover:text-heading hover:underline">
          Find the right person on LinkedIn ↗
        </a>
        {tab === "new" && p.verdict === "failed" && !fixing && (
          <button type="button" className="text-body hover:text-heading hover:underline" onClick={() => setFixing(true)}>
            Wrong website? Correct it
          </button>
        )}
      </div>
      {fixing && (
        <form
          className="flex items-end gap-2 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void recheck(site);
          }}
        >
          <div className="flex-1">
            <Field label="Company website">
              <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="example.com" className="h-10" />
            </Field>
          </div>
          <Button type="submit" small disabled={busy || !site.trim()}>
            Check this address
          </Button>
        </form>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}

export default function DiscoveryPage() {
  const toast = useToast();
  const [tab, setTab] = useState<ProspectState>("new");
  const [asking, setAsking] = useState(false);
  const [count, setCount] = useState("8");
  const [focus, setFocus] = useState("");
  const [mode, setMode] = useState<"ideas" | "page" | "search">("ideas");
  const [query, setQuery] = useState(`hackathon sponsors ${new Date().getFullYear()} students`);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const searching = useAction();
  const [pageUrl, setPageUrl] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data, error, loading, reload } = useQuery(`discovery:${tab}`, () => api.discovery.list(tab));

  async function findAndCheck() {
    setErr(null);
    setAsking(false);
    try {
      let added: Prospect[];
      let skipped: number;
      if (mode === "page") {
        setProgress({ done: 0, total: 0, name: "Reading the sponsor page…" });
        const r = await api.discovery.fromPage(pageUrl.trim());
        added = r.added;
        skipped = r.skipped_duplicates;
      } else if (mode === "search") {
        const urls = [...picked];
        const byId = new Map<number, Prospect>();
        skipped = 0;
        for (const [i, u] of urls.entries()) {
          setProgress({ done: i, total: urls.length, name: `Reading page ${i + 1} of ${urls.length}…` });
          try {
            const r = await api.discovery.fromPage(u);
            r.added.forEach((p) => byId.set(p.id, p));
            skipped += r.skipped_duplicates;
          } catch (e) {
            setErr(`Couldn't read ${u}: ${errorMessage(e)}`);
          }
        }
        added = [...byId.values()];
      } else {
        setProgress({ done: 0, total: 0, name: "Asking the model for ideas…" });
        const r = await api.discovery.suggest({ count: Number(count) || 8, focus: focus.trim() || undefined });
        added = r.added;
        skipped = r.skipped_duplicates;
      }
      if (added.length === 0) {
        toast(skipped ? "Nothing new: every company was already in your list" : mode === "ideas" ? "The model had no new ideas" : "No companies found on those pages");
        return;
      }
      setTab("new");
      reload();
      for (const [i, p] of added.entries()) {
        setProgress({ done: i, total: added.length, name: p.name });
        try {
          await api.discovery.verify(p.id);
        } catch (e) {
          setErr(`Couldn't check ${p.name}: ${errorMessage(e)}`);
        }
        reload();
      }
      toast(`Checked ${added.length} ${added.length === 1 ? "company" : "companies"} against their websites`);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setProgress(null);
      reload();
    }
  }

  const busy = progress !== null;
  const groups = GROUPS.map((g) => ({ g, items: (data ?? []).filter((p) => p.verdict === g) })).filter((x) => x.items.length > 0);

  return (
    <>
      <PageHeader
        title="Discovery"
        subtitle="The AI suggests companies; I open each one's website to check it's real, current and relevant before you decide."
        actions={
          <Button variant="primary" disabled={busy} onClick={() => setAsking(true)}>
            Find prospects
          </Button>
        }
      />

      {asking && (
        <Card className="mb-6 space-y-3">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void findAndCheck();
            }}
          >
            <div role="tablist" aria-label="Where to look" className="inline-flex rounded-full border border-glass-border bg-glass p-1">
              {([["ideas", "AI ideas"], ["page", "From a sponsor page"], ["search", "Search the web"]] as const).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={mode === v} onClick={() => setMode(v)} className={`h-8 rounded-full px-3.5 text-sm transition-colors ${mode === v ? "bg-glass-strong text-heading" : "text-body hover:text-heading"}`}>
                  {label}
                </button>
              ))}
            </div>
            {mode === "ideas" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                  <Field label="How many">
                    <Input type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} />
                  </Field>
                  <Field label="Focus (optional)">
                    <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. cloud and AI infrastructure companies" maxLength={300} />
                  </Field>
                </div>
                <p className="text-xs text-body">New ideas are modelled on the companies already in your list. Each is then checked against its real website. Nothing is contacted.</p>
              </>
            ) : mode === "page" ? (
              <>
                <Field label="Link to a page that lists sponsors">
                  <Input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://some-hackathon.example/sponsors" maxLength={500} />
                </Field>
                <p className="text-xs text-body">Try another hackathon&apos;s sponsors page. I take the companies it links to (not its own pages or social links), then check each against its real website. Nothing is contacted.</p>
              </>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label="Search the web for pages that list sponsors">
                      <Input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} />
                    </Field>
                  </div>
                  <Button
                    type="button"
                    disabled={searching.busy || query.trim().length < 3}
                    onClick={async () => {
                      setHits(null);
                      setPicked(new Set());
                      await searching.run(async () => setHits(await api.discovery.search(query.trim())));
                    }}
                  >
                    {searching.busy ? "Searching…" : "Search"}
                  </Button>
                </div>
                <ErrorNote message={searching.error} />
                {hits && hits.length === 0 && <p className="text-sm text-body">No pages found. Try different words.</p>}
                {hits && hits.length > 0 && (
                  <ul className="max-h-80 space-y-2 overflow-y-auto" data-lenis-prevent>
                    {hits.map((h) => (
                      <li key={h.url} className="rounded-xl border border-hairline bg-white/[0.03] p-3">
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={picked.has(h.url)}
                            onChange={(e) => {
                              const next = new Set(picked);
                              if (e.target.checked) next.add(h.url);
                              else next.delete(h.url);
                              setPicked(next);
                            }}
                            className="mt-1 h-4 w-4 shrink-0 accent-[var(--st-responded)]"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-heading">{h.title || h.domain}</span>
                            {h.snippet && <span className="block text-xs text-body">{h.snippet}</span>}
                            <span className="block text-xs text-faint">
                              {h.domain}
                              {h.age ? ` · ${h.age}` : ""}
                            </span>
                          </span>
                        </label>
                        <a href={h.url} target="_blank" rel="noopener noreferrer" className="ml-7 text-xs text-body hover:text-heading hover:underline">
                          Open the page ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-body">Only the words you type are sent to the search service. Tick the pages that really list sponsors; I take the companies they link to, then check each against its real website. Nothing is contacted.</p>
              </>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={(mode === "page" && pageUrl.trim().length < 4) || (mode === "search" && picked.size === 0)}>
                {mode === "search" ? `Pull companies from ${picked.size} ${picked.size === 1 ? "page" : "pages"}` : "Find and check"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {progress && (
        <Card glass className="mb-6" role="status" aria-live="polite">
          <p className="text-sm text-heading">
            {progress.total > 0 ? `Checking ${Math.min(progress.done + 1, progress.total)} of ${progress.total}: ${progress.name}` : progress.name}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.div className="h-full rounded-full bg-heading/70" animate={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "6%" }} transition={soft} />
          </div>
        </Card>
      )}
      <ErrorNote message={err} />

      <div role="tablist" aria-label="Prospect filter" className="mb-6 inline-flex flex-wrap rounded-full border border-glass-border bg-glass p-1 backdrop-blur-[14px]">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`relative h-9 rounded-full px-4 text-sm transition-colors ${tab === t.value ? "bg-glass-strong text-heading" : "text-body hover:text-heading"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote message={error} />
      ) : data.length === 0 ? (
        <Empty>
          {tab === "new" ? "No prospects to review. Press “Find prospects” to get ideas, each checked against its real website." : "Nothing here."}
        </Empty>
      ) : tab === "new" ? (
        <div className="space-y-8">
          {groups.map(({ g, items }) => (
            <section key={g} aria-label={VERDICT[g].heading}>
              <h2 className="mb-3 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-body/80">
                {VERDICT[g].heading} · {items.length}
              </h2>
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {items.map((p) => (
                    <motion.div key={p.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.18 } }} transition={soft}>
                      <ProspectCard p={p} tab={tab} onChanged={reload} checking={progress?.name === p.name && progress.total > 0} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((p) => (
            <ProspectCard key={p.id} p={p} tab={tab} onChanged={reload} checking={false} />
          ))}
        </div>
      )}
    </>
  );
}
