"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, ChannelPills, ErrorNote, PageHeader, Pill, SectionTitle, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/hooks";
import type { ImportPreview, ImportRow } from "@/lib/types";

type Opts = { overwrite: boolean; infer_status: boolean };
type Filter = "all" | "changes" | "warnings" | "skipped";

const ACTION: Record<ImportRow["action"], { label: string; tone: "green" | "amber" | "muted" | "rose" }> = {
  create: { label: "New", tone: "green" },
  update: { label: "Update", tone: "amber" },
  unchanged: { label: "No change", tone: "muted" },
  skip: { label: "Skipped", tone: "rose" },
};
const FIELD_LABEL: Record<string, string> = {
  owner: "NAME (teammate)",
  company: "COMPANY",
  person: "Contact person",
  contact: "CONTACT (LinkedIn or email)",
  email: "Email",
  role: "Position",
  status: "Status",
  remarks: "Remarks",
  channels: "Channels",
};
const SHOW_ROWS = 300;

export default function ImportPage() {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [opts, setOpts] = useState<Opts>({ overwrite: false, infer_status: true });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportPreview["summary"] | null>(null);
  const [dragging, setDragging] = useState(false);

  async function runPreview(text: string, o: Opts) {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.import.preview(text, o));
    } catch (e) {
      setPreview(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function load(f: File) {
    setDone(null);
    setFilter("all");
    const text = await f.text();
    setFile({ name: f.name, text });
    await runPreview(text, opts);
  }

  function changeOpts(next: Opts) {
    setOpts(next);
    if (file) void runPreview(file.text, next);
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.import.commit(file.text, opts);
      setDone(s);
      setPreview(null);
      setFile(null);
      toast(`Imported ${s.create} new, updated ${s.update}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = preview?.rows ?? [];
  const warned = rows.filter((r) => r.warnings.length > 0);
  const visible = rows.filter((r) =>
    filter === "all" ? true : filter === "changes" ? r.action === "create" || r.action === "update" : filter === "warnings" ? r.warnings.length > 0 : r.action === "skip",
  );
  const s = preview?.summary;
  const willChange = s ? s.create + s.update + s.new_companies : 0;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/leads" className="text-body hover:text-heading">
          ← Leads
        </Link>
      </p>
      <PageHeader title="Import leads" subtitle="Upload the CSV export of your spreadsheet. You'll see exactly what will happen before anything is saved." />

      {done && (
        <Card glass className="mb-6 space-y-3">
          <p className="font-medium text-heading">Imported.</p>
          <p className="text-sm text-body">
            {done.create} new {done.create === 1 ? "lead" : "leads"}, {done.update} updated, {done.unchanged} already up to date, {done.skip} skipped
            {done.new_companies ? `, ${done.new_companies} new ${done.new_companies === 1 ? "company" : "companies"}` : ""}.
          </p>
          <div className="flex gap-2">
            <Link href="/leads" className="inline-flex h-10 items-center rounded-full bg-action px-[1.125rem] text-[0.9rem] font-medium text-action-fg hover:bg-action/85">
              See the leads
            </Link>
            <Link href="/" className="inline-flex h-10 items-center rounded-full border border-glass-border bg-glass px-[1.125rem] text-[0.9rem] text-heading hover:bg-glass-strong">
              Dashboard
            </Link>
          </div>
        </Card>
      )}

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) void load(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[1.25rem] border border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-heading/70 ${dragging ? "border-white/50 bg-glass-strong" : "border-hairline bg-glass hover:bg-glass-strong"}`}
      >
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = ""; // allow choosing the same file again after editing it
          }}
        />
        <span className="text-[1rem] font-medium text-heading">{file ? file.name : "Choose a CSV file, or drop it here"}</span>
        <span className="text-sm text-body">Columns I recognise: NAME (teammate), COMPANY NAME, POINT OF CONTACT, CONTACT, POSITION, STATUS, REMARKS</span>
      </label>

      <ErrorNote message={error} />

      <fieldset className="mt-5 space-y-3" disabled={busy}>
        <legend className="sr-only">Import options</legend>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-body">
          <input type="checkbox" checked={opts.infer_status} onChange={(e) => changeOpts({ ...opts, infer_status: e.target.checked })} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="text-heading">Read remarks like &ldquo;mail sent&rdquo; or &ldquo;linkedin request&rdquo; as Contacted</span> when the status is blank. Every row this affects is flagged.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-body">
          <input type="checkbox" checked={opts.overwrite} onChange={(e) => changeOpts({ ...opts, overwrite: e.target.checked })} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="text-heading">Let the sheet override what&apos;s in the app.</span> Off by default: an import only fills blanks and moves a status forward, so it never undoes work done here.
          </span>
        </label>
      </fieldset>

      {busy && !preview && <p className="mt-8 text-sm text-body">Reading the file…</p>}

      {preview && s && (
        <section className="mt-10 space-y-6" aria-live="polite">
          <div>
            <SectionTitle>What I found</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(preview.columns).map(([f, header]) => (
                <span key={f} className="rounded-full bg-white/[0.07] px-3 py-1 text-xs text-body">
                  <span className="text-heading">{header}</span> → {FIELD_LABEL[f] ?? f}
                </span>
              ))}
            </div>
            {preview.ignored_columns.length > 0 && (
              <p className="mt-2 text-sm text-body">
                Not used (no matching field): <span className="text-heading">{preview.ignored_columns.join(", ")}</span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["New leads", s.create],
              ["Updated", s.update],
              ["No change", s.unchanged],
              ["Skipped", s.skip],
              ["New companies", s.new_companies],
            ].map(([label, n]) => (
              <Card key={label} glass className="p-3.5">
                <p className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-faint">{label}</p>
                <p className="mt-1 font-mono text-2xl tabular-nums text-heading">{n}</p>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={busy || willChange === 0} onClick={commit}>
              {busy ? "Importing…" : willChange === 0 ? "Nothing to import" : `Import ${s.create + s.update} ${s.create + s.update === 1 ? "lead" : "leads"}`}
            </Button>
            {warned.length > 0 && <span className="text-sm text-body">{warned.length} {warned.length === 1 ? "row needs" : "rows need"} a look (flagged below).</span>}
          </div>

          <div>
            <div role="group" aria-label="Show rows" className="mb-3 flex flex-wrap gap-1.5">
              {(
                [
                  ["all", `All ${rows.length}`],
                  ["changes", `Will change ${s.create + s.update}`],
                  ["warnings", `Needs a look ${warned.length}`],
                  ["skipped", `Skipped ${s.skip}`],
                ] as [Filter, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={filter === v}
                  onClick={() => setFilter(v)}
                  className={`h-8 rounded-full border px-3 text-[0.78rem] transition-colors ${filter === v ? "border-transparent bg-heading/90 font-medium text-action-fg" : "border-glass-border bg-glass text-body hover:text-heading"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Card className="p-0">
              <div data-lenis-prevent className="overflow-x-auto">
                <table className="w-full min-w-[60rem] text-left text-sm">
                  <thead className="border-b border-hairline text-[0.72rem] uppercase tracking-[0.08em] text-faint">
                    <tr>
                      {["Line", "Action", "Company", "Contact", "Owner", "Status", "Reached by", "Notes"].map((h) => (
                        <th key={h} className="px-3 py-3 font-medium first:pl-5 last:pr-5">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {visible.slice(0, SHOW_ROWS).map((r) => (
                      <tr key={r.line} className="align-top">
                        <td className="py-2.5 pl-5 pr-3 font-mono text-xs text-faint">{r.line}</td>
                        <td className="px-3 py-2.5">
                          <Pill tone={ACTION[r.action].tone}>{ACTION[r.action].label}</Pill>
                        </td>
                        <td className="px-3 py-2.5 text-heading">
                          {r.company || "—"}
                          {r.company_new && <span className="ml-2 text-xs text-ok">new</span>}
                        </td>
                        <td className="px-3 py-2.5 text-body">{r.name ?? "—"}</td>
                        <td className="px-3 py-2.5 text-body">{r.owner ?? "—"}</td>
                        <td className="px-3 py-2.5">{r.company ? <StatusBadge status={r.status} /> : null}</td>
                        <td className="px-3 py-2.5">
                          <ChannelPills channels={r.channels} />
                        </td>
                        <td className="max-w-[22rem] px-3 py-2.5 pr-5 text-xs">
                          {r.reason && <p className="text-body">{r.reason}</p>}
                          {r.action === "update" && r.changes.map((c) => <p key={c} className="font-mono text-body">{c}</p>)}
                          {r.warnings.map((w) => (
                            <p key={w} className="text-amber-300">⚠ {w}</p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visible.length === 0 && <p className="px-5 py-6 text-center text-sm text-faint">Nothing in this view.</p>}
              {(visible.length > SHOW_ROWS || preview.truncated) && (
                <p className="border-t border-hairline px-5 py-3 text-xs text-faint">Showing the first {SHOW_ROWS} of {visible.length}. The import covers every row.</p>
              )}
            </Card>
          </div>
        </section>
      )}
    </>
  );
}
