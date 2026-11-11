"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import AddLead from "@/components/leads/AddLead";
import Board from "@/components/leads/Board";
import StatusPicker from "@/components/leads/StatusPicker";
import { snap } from "@/components/motion/springs";
import Sheet from "@/components/Sheet";
import { useSignal } from "@/components/signal/SignalProvider";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, ChannelPicker, Empty, ErrorNote, Loading, PageHeader, Pill, StatusSelect } from "@/components/ui";
import { api, type ContactPatch } from "@/lib/api";
import { STATUS_COLOR, STATUS_LABEL, contactLabel, daysAgo } from "@/lib/format";
import { errorMessage, useQuery } from "@/lib/hooks";
import { STATUSES, type Contact, type Status } from "@/lib/types";


/** A text cell that saves when you leave it (Enter saves, Esc puts back what was there). */
function InlineText({
  value,
  placeholder,
  label,
  list,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  label: string;
  list?: string;
  onSave: (value: string) => void;
}) {
  return (
    <input
      defaultValue={value ?? ""}
      aria-label={label}
      placeholder={placeholder}
      list={list}
      onBlur={(e) => {
        if (e.target.value.trim() !== (value ?? "")) onSave(e.target.value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value ?? "";
          e.currentTarget.blur();
        }
      }}
      className="h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-[0.85rem] text-heading outline-none transition-colors placeholder:text-faint hover:border-hairline focus:border-white/30 focus:bg-white/[0.04]"
    />
  );
}

function Leads() {
  const params = useSearchParams();
  const toast = useToast();
  const signal = useSignal();
  const [view, setView] = useState<"table" | "board">("table");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "">(() => {
    const s = params.get("status");
    return STATUSES.includes(s as Status) ? (s as Status) : "";
  });
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState<{ lead: Contact; trigger: HTMLElement } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const busyRef = useRef(false);

  const { data, error, loading, reload } = useQuery("leads", async () => {
    const [leads, companies] = await Promise.all([api.contacts.list(), api.companies.list()]);
    return { leads, companies };
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;

  const needle = q.trim().toLowerCase();
  const matchesBase = (l: Contact) =>
    (!needle || `${contactLabel(l)} ${l.company_name} ${l.role ?? ""} ${l.remarks ?? ""} ${l.email ?? ""}`.toLowerCase().includes(needle));
  const base = data.leads.filter(matchesBase);
  const shown = status ? base.filter((l) => l.status === status) : base;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, base.filter((l) => l.status === s).length])) as Record<Status, number>;

  async function patch(lead: Contact, body: ContactPatch, pulseAt?: HTMLElement | { x: number; y: number } | null) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(lead.id);
    try {
      await api.contacts.update(lead.id, body);
      reload();
      if (body.status === "responded" && lead.status !== "responded") signal.pulse(pulseAt ?? null);
    } catch (e) {
      toast(`Couldn't update ${contactLabel(lead)}: ${errorMessage(e)}`, "error");
      reload(); // put the row back as the server has it
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Everyone we're reaching out to: who has them, how we reached them, and what happened."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/leads/import" className="inline-flex h-10 items-center rounded-full border border-glass-border bg-glass px-[1.125rem] text-[0.9rem] font-medium text-heading backdrop-blur-xl transition-colors hover:bg-glass-strong">
              Import CSV
            </Link>
            <a href={api.import.exportUrl} download className="inline-flex h-10 items-center rounded-full border border-glass-border bg-glass px-[1.125rem] text-[0.9rem] font-medium text-heading backdrop-blur-xl transition-colors hover:bg-glass-strong">
              Export
            </a>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add lead
            </Button>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="Search leads"
          placeholder="Search name, company, remarks…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 w-72 max-w-full rounded-full border border-glass-border bg-glass px-4 text-[0.9rem] text-heading outline-none backdrop-blur-[14px] transition-[border-color,box-shadow] focus:border-white/30 focus:shadow-[0_0_0_4px_rgba(255,107,94,0.14)]"
        />

        {view === "table" && (
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={status === ""}
              onClick={() => setStatus("")}
              className={`h-8 rounded-full border px-3 text-[0.78rem] transition-colors ${status === "" ? "border-transparent bg-heading/90 font-medium text-action-fg" : "border-glass-border bg-glass text-body hover:text-heading"}`}
            >
              All <span className="ml-1 font-mono opacity-70">{base.length}</span>
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(status === s ? "" : s)}
                className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.78rem] transition-colors ${status === s ? "border-white/40 bg-glass-strong text-heading" : "border-glass-border bg-glass text-body hover:text-heading"}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]}
                <span className="font-mono opacity-70">{counts[s]}</span>
              </button>
            ))}
          </div>
        )}

        <div role="tablist" aria-label="View" className="ml-auto inline-flex rounded-full border border-glass-border bg-glass p-1 backdrop-blur-[14px]">
          {(["table", "board"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`relative h-8 rounded-full px-4 text-sm capitalize transition-colors ${view === v ? "text-heading" : "text-body hover:text-heading"}`}
            >
              {view === v && <motion.span layoutId="leads-view" transition={snap} className="absolute inset-0 rounded-full bg-glass-strong" />}
              <span className="relative">{v}</span>
            </button>
          ))}
        </div>
      </div>

      {view === "board" ? (
        <Board
          leads={base}
          onMoveLead={(lead, to, at) => lead.status !== to && patch(lead, { status: to }, at)}
          onPickMove={(lead, trigger) => setPicking({ lead, trigger })}
        />
      ) : shown.length === 0 ? (
        <Empty>
          {data.leads.length === 0 ? (
            <>
              No leads yet. <Link href="/leads/import" className="text-heading underline">Import your sheet</Link> or add one.
            </>
          ) : (
            "No lead matches those filters."
          )}
        </Empty>
      ) : (
        <Card className="p-0">
          <div data-lenis-prevent className="overflow-x-auto">
            <table className="w-full min-w-[70rem] text-left text-sm">
              <thead className="border-b border-hairline text-[0.72rem] uppercase tracking-[0.08em] text-faint">
                <tr>
                  {["Company", "Contact", "Status", "Reached by", "Remarks", "Last"].map((h) => (
                    <th key={h} className="px-3 py-3 font-medium first:pl-5 last:pr-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {shown.map((l) => {
                  const busy = busyId === l.id;
                  return (
                    <tr key={l.id} className="align-middle transition-colors hover:bg-foreground/[0.03]">
                      <td className="w-[10rem] py-2 pl-5 pr-3">
                        <Link href={`/companies/${l.company_id}`} className="block max-w-[9rem] truncate text-body hover:text-heading hover:underline">
                          {l.company_name}
                        </Link>
                      </td>
                      <td className="w-[15rem] px-3 py-2">
                        <Link href={`/leads/${l.id}`} className="flex items-center gap-2 font-medium text-heading hover:underline">
                          <span className="truncate">{contactLabel(l)}</span>
                          {l.reply_unread && <Pill tone="green">New reply</Pill>}
                          {l.do_not_contact && <Pill tone="rose">Don&apos;t contact</Pill>}
                        </Link>
                        <p className="flex items-center gap-2 truncate text-xs text-body">
                          <span className="truncate">{l.role ?? "—"}</span>
                          {l.linkedin && (
                            <a href={l.linkedin.startsWith("http") ? l.linkedin : `https://${l.linkedin}`} target="_blank" rel="noopener noreferrer" aria-label={`LinkedIn profile of ${contactLabel(l)}`} className="shrink-0 rounded px-1 text-faint transition-colors hover:bg-glass-strong hover:text-heading">
                              LinkedIn ↗
                            </a>
                          )}
                          {l.email && (
                            <a href={`mailto:${l.email}`} title={l.email} aria-label={`Email address of ${contactLabel(l)}: ${l.email}`} className="shrink-0 rounded px-1 text-faint transition-colors hover:bg-glass-strong hover:text-heading">
                              ✉
                            </a>
                          )}
                        </p>
                      </td>
                      <td className="w-[9rem] px-3 py-2">
                        <StatusSelect label={`Status of ${contactLabel(l)}`} value={l.status} disabled={busy} onChange={(s) => patch(l, { status: s }, null)} />
                      </td>
                      <td className="w-[16.5rem] px-3 py-2">
                        {l.status === "not_contacted" ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <ChannelPicker small value={l.channels} disabled={busy} onChange={(c) => patch(l, { channels: c })} />
                        )}
                      </td>
                      <td className="min-w-[12rem] px-1 py-1.5">
                        <InlineText key={`${l.id}-${l.updated_at}`} value={l.remarks} placeholder="Add a note…" label={`Remarks for ${contactLabel(l)}`} onSave={(v) => patch(l, { remarks: v || null })} />
                      </td>
                      <td className="w-[6rem] whitespace-nowrap px-3 py-2 pr-5 font-mono text-xs text-body">
                        {l.last_contacted_at ? `${daysAgo(l.last_contacted_at)}d ago` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-hairline px-5 py-3 text-xs text-faint">
            {shown.length} of {data.leads.length} leads · edit a cell and press Enter
          </p>
        </Card>
      )}

      <AnimatePresence>
        {adding && (
          <Sheet title="Add a lead" onClose={() => setAdding(false)}>
            <AddLead companies={data.companies} onDone={() => reload()} onClose={() => setAdding(false)} />
          </Sheet>
        )}
        {picking && (
          <StatusPicker
            who={contactLabel(picking.lead)}
            current={picking.lead.status}
            onClose={() => setPicking(null)}
            onPick={(s) => {
              const { lead, trigger } = picking;
              setPicking(null);
              patch(lead, { status: s }, trigger);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default function LeadsPage() {
  // useSearchParams needs a Suspense boundary so the page can still be prerendered.
  return (
    <Suspense fallback={<Loading />}>
      <Leads />
    </Suspense>
  );
}
