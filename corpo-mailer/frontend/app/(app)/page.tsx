"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import CountUp from "@/components/CountUp";
import Reveal from "@/components/motion/Reveal";
import WordReveal from "@/components/motion/WordReveal";
import ReplyCheck from "@/components/ReplyCheck";
import { Card, Empty, ErrorNote, Loading, SectionTitle, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { STATUS_BAR, STATUS_COLOR, STATUS_LABEL, contactLabel, daysAgo, fmtDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { STATUSES, type Contact, type Status } from "@/lib/types";

async function load() {
  const [dash, replyStatus] = await Promise.all([api.dashboard(), api.replies.status()]);
  return { dash, replyStatus };
}

const partOfDay = () => {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
};

function Tile({ status, value, total, index }: { status: Status; value: number; total: number; index: number }) {
  return (
    <Reveal delay={400 + index * 80} className="h-full">
      <Link href={`/leads?status=${status}`} className="block h-full rounded-[1.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading/70">
        <Card glass className="h-full transition-colors hover:border-white/25">
          <p className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-faint">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
            {STATUS_LABEL[status]}
          </p>
          <p className="mt-2 font-mono text-[2.6rem] font-medium leading-none tabular-nums text-heading">
            <CountUp value={value} />
          </p>
          <p className="mt-3 text-[0.82rem] text-body">{total ? `${Math.round((value / total) * 100)}% of ${total} leads` : "no leads yet"}</p>
        </Card>
      </Link>
    </Reveal>
  );
}

function LeadRow({ lead, note }: { lead: Contact; note: string }) {
  return (
    <li>
      <Link href={`/leads/${lead.id}`} className="group flex items-center justify-between gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-glass">
        <div className="min-w-0">
          <p className="truncate font-medium text-heading">
            {contactLabel(lead)} <span className="font-normal text-body">· {lead.company_name}</span>
          </p>
          <p className="mt-0.5 text-xs text-body">
            {note}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={lead.status} />
          <span aria-hidden="true" className="-translate-x-1 text-faint opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
            →
          </span>
        </div>
      </Link>
    </li>
  );
}

export default function DashboardPage() {
  const reduce = useReducedMotion();
  const { data, error, loading, reload } = useQuery("dashboard", load);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;

  const { dash, replyStatus } = data;
  const waiting = new Set([...dash.new_replies, ...dash.needs_followup].map((c) => c.id)).size;
  const headline =
    dash.total === 0
      ? "No leads yet."
      : waiting === 0
        ? "You're all caught up."
        : `${waiting} ${waiting === 1 ? "person needs" : "people need"} you.`;
  const accent = dash.total === 0 ? ["yet."] : waiting === 0 ? ["caught", "up."] : [String(waiting)];

  return (
    <>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <WordReveal as="p" text={`Good ${partOfDay()}.`} stagger={40} duration={500} rise={10} className="text-[0.95rem] text-body" />
          <WordReveal as="h1" text={headline} accent={accent} delay={120} className="mt-2 max-w-[34rem] text-[2.4rem] font-medium leading-[1.1] tracking-[-0.02em] text-heading" />
        </div>
        <Reveal delay={300}>
          <ReplyCheck status={replyStatus} onDone={reload} />
        </Reveal>
      </header>

      {dash.total === 0 ? (
        <Empty>
          Nothing here yet. <Link href="/leads/import" className="text-heading underline">Import your spreadsheet</Link> or{" "}
          <Link href="/leads" className="text-heading underline">add a lead</Link>.
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {STATUSES.map((s, i) => (
              <Tile key={s} index={i} status={s} value={dash.status_counts[s]} total={dash.total} />
            ))}
          </div>

          {dash.new_replies.length > 0 && (
            <Reveal delay={800} className="mt-10">
              <SectionTitle>New replies</SectionTitle>
              {/* A 1px ember border: an opaque inner surface over a gradient with 1px of padding. */}
              <div className="rounded-[1.25rem] bg-[image:var(--ember)] p-px">
                <ul className="rounded-[calc(1.25rem-1px)] bg-[rgba(14,13,20,0.94)] p-2 backdrop-blur-xl">
                  {dash.new_replies.map((c) => (
                    <LeadRow key={c.id} lead={c} note={`Replied ${daysAgo(c.last_contacted_at) === 0 ? "today" : fmtDate(c.last_contacted_at)}`} />
                  ))}
                </ul>
              </div>
            </Reveal>
          )}

          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <Reveal delay={900}>
              <SectionTitle>Follow up now</SectionTitle>
              {dash.needs_followup.length === 0 ? (
                <Empty>Nobody is overdue. Nice.</Empty>
              ) : (
                <Card className="p-2">
                  <ul>
                    {dash.needs_followup.map((c) => (
                      <LeadRow
                        key={c.id}
                        lead={c}
                        note={c.next_followup_at && new Date(c.next_followup_at) <= new Date() ? `Follow-up was due ${fmtDate(c.next_followup_at)}` : `No reply for ${daysAgo(c.last_contacted_at)} days`}
                      />
                    ))}
                  </ul>
                </Card>
              )}
            </Reveal>

            <Reveal delay={1000}>
              <SectionTitle>Pipeline</SectionTitle>
              <Card className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-heading">Everyone</span>
                    <span className="font-mono text-xs text-body">{dash.total}</span>
                  </div>
                  <div className="flex h-2 gap-px overflow-hidden rounded-full bg-white/[0.07]" title={STATUSES.map((s) => `${STATUS_LABEL[s]} ${dash.status_counts[s]}`).join(" · ")}>
                    {STATUSES.map((s) =>
                      dash.status_counts[s] === 0 ? null : (
                        <motion.div
                          key={s}
                          className={`h-full origin-left ${STATUS_BAR[s]}`}
                          style={{ width: `${(dash.status_counts[s] / dash.total) * 100}%` }}
                          initial={reduce ? false : { scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: reduce ? 0 : 0.7, delay: reduce ? 0 : 1.1, ease: [0.2, 0, 0, 1] }}
                        />
                      ),
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-3 text-xs text-body">
                  {STATUSES.map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                      {STATUS_LABEL[s]}
                    </span>
                  ))}
                </div>
              </Card>
            </Reveal>
          </div>
        </>
      )}
    </>
  );
}
