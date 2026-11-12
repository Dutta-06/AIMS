"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { soft } from "@/components/motion/springs";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { STATUS_BAR, STATUS_LABEL } from "@/lib/format";
import { STATUSES } from "@/lib/types";
import { useAction, useQuery } from "@/lib/hooks";
import { companyHref } from "@/lib/routes";

function AddCompany({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", industry: "", website: "", source: "" });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let created = false;
    const ok = await run(async () => {
      const c = await api.companies.create({
        name: f.name.trim(),
        industry: f.industry.trim() || null,
        website: f.website.trim() || null,
        source: f.source.trim() || null,
      });
      created = true;
      void c;
    });
    if (ok) {
      toast(`Added ${f.name.trim()}`);
      onDone();
      onClose();
    } else if (created) {
      onDone();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-4">
      <Field label="Company name">
        <Input value={f.name} onChange={set("name")} required autoFocus />
      </Field>
      <Field label="Industry">
        <Input value={f.industry} onChange={set("industry")} placeholder="e.g. Fintech" />
      </Field>
      <Field label="Website">
        <Input value={f.website} onChange={set("website")} placeholder="https://" />
      </Field>
      <Field label="Where did you find them?">
        <Input value={f.source} onChange={set("source")} placeholder="e.g. HackIndia 2025 sponsor list" />
      </Field>
      <ErrorNote message={error} />
      <div className="mt-auto flex gap-2 pt-4">
        <Button type="submit" variant="primary" disabled={busy || !f.name.trim()} className="flex-1">
          {busy ? "Adding…" : "Add company"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function CompaniesPage() {
  const reduce = useReducedMotion();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  // Everything is loaded once and filtered as you type, so searching never flashes a loading state.
  const { data, error, loading, reload } = useQuery("companies", async () => {
    const [companies, contacts] = await Promise.all([api.companies.list(), api.contacts.list()]);
    return { companies, contacts };
  });

  const needle = q.trim().toLowerCase();
  const shown = data?.companies.filter((c) => !needle || `${c.name} ${c.industry ?? ""}`.toLowerCase().includes(needle)) ?? [];

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle="Everyone you might ask for sponsorship."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add company
          </Button>
        }
      />

      <div className="relative mb-6 max-w-md">
        <svg viewBox="0 0 16 16" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-body" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          type="search"
          aria-label="Search companies"
          placeholder="Search companies…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-11 w-full rounded-full border border-glass-border bg-glass pl-11 pr-4 text-[0.92rem] text-heading outline-none backdrop-blur-[14px] transition-[border-color,box-shadow] duration-150 focus:border-white/30 focus:shadow-[0_0_0_4px_rgba(255,107,94,0.14)]"
        />
      </div>

      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote message={error} />
      ) : shown.length === 0 ? (
        <Empty>{q ? "No company matches that search." : "No companies yet. Add your first prospect."}</Empty>
      ) : (
        <Card className="p-2">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_9rem_1.5rem] gap-4 px-4 pb-2 pt-2 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-faint md:grid">
            <span>Company</span>
            <span>Industry</span>
            <span>Contacts</span>
            <span>Progress</span>
            <span />
          </div>
          <ul>
            {shown.map((c, i) => {
              const people = data.contacts.filter((x) => x.company_id === c.id);
              const contacts = people.length;
              const mix = STATUSES.map((st) => ({ st, n: people.filter((p) => p.status === st).length }));
              return (
                <motion.li
                  key={c.id}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...soft, delay: Math.min(i, 20) * 0.03 }}
                >
                  <Link
                    href={companyHref(c.id)}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl px-4 py-3 transition-colors hover:bg-glass focus-visible:bg-glass focus-visible:outline-none md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_9rem_1.5rem]"
                  >
                    <span className="truncate font-medium text-heading">{c.name}</span>
                    <span className="col-start-1 row-start-2 truncate text-[0.82rem] text-body md:col-start-auto md:row-start-auto md:text-[0.9rem]">
                      {c.industry ?? "—"}
                      <span className="md:hidden"> · {contacts} {contacts === 1 ? "contact" : "contacts"}</span>
                    </span>
                    <span className="hidden font-mono text-[0.9rem] tabular-nums text-body md:block">{contacts}</span>
                    <span className="col-start-2 row-start-1 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-start">
                      {contacts === 0 ? (
                        <span className="text-sm text-faint">No contacts</span>
                      ) : (
                        <span
                          className="flex h-2 w-full max-w-[8rem] gap-px overflow-hidden rounded-full bg-white/[0.07]"
                          title={mix.map(({ st, n }) => `${STATUS_LABEL[st]} ${n}`).join(" · ")}
                          role="img"
                          aria-label={mix.filter(({ n }) => n).map(({ st, n }) => `${n} ${STATUS_LABEL[st]}`).join(", ")}
                        >
                          {mix.map(({ st, n }) => n > 0 && <span key={st} className={`h-full ${STATUS_BAR[st]}`} style={{ width: `${(n / contacts) * 100}%` }} />)}
                        </span>
                      )}
                    </span>
                    <span aria-hidden="true" className="hidden -translate-x-1 text-faint opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 md:block">
                      →
                    </span>
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        </Card>
      )}

      <AnimatePresence>
        {adding && (
          <Sheet title="Add a company" onClose={() => setAdding(false)}>
            <AddCompany onDone={reload} onClose={() => setAdding(false)} />
          </Sheet>
        )}
      </AnimatePresence>
    </>
  );
}
