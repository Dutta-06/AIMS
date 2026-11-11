"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import CountUp from "@/components/CountUp";
import Reveal from "@/components/motion/Reveal";
import WordReveal from "@/components/motion/WordReveal";
import ReplyCheck from "@/components/ReplyCheck";
import { Card, Empty, ErrorNote, Loading, SectionTitle, StageBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { getToken, operatorName } from "@/lib/auth";
import { STAGE_BAR, STAGE_LABEL, daysAgo, fmtDate, fmtMoney } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { CLOSED_STAGES, STAGES, type Deal } from "@/lib/types";

async function load() {
  const [dash, deals, companies, drafts, replyStatus] = await Promise.all([
    api.dashboard(),
    api.deals.list(),
    api.companies.list(),
    api.drafts.list(),
    api.replies.status(),
  ]);
  return { dash, deals, companies, drafts, replyStatus };
}

const partOfDay = () => {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
};

function Tile({
  label,
  value,
  format,
  hint,
  href,
  index,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  hint?: string;
  href?: string;
  index: number;
}) {
  const body = (
    <Card glass className="h-full transition-colors hover:border-white/25">
      <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className="mt-2 font-mono text-[1.75rem] font-medium leading-none tabular-nums text-heading sm:text-[2.6rem] lg:text-[2.2rem] xl:text-[2.6rem]">
        <CountUp value={value} format={format} />
      </p>
      {hint && <p className="mt-3 text-[0.82rem] text-body">{hint}</p>}
    </Card>
  );
  return (
    <Reveal delay={400 + index * 80} className="h-full">
      {href ? (
        <Link href={href} className="block h-full rounded-[1.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading/70">
          {body}
        </Link>
      ) : (
        body
      )}
    </Reveal>
  );
}

function DealRow({ deal, name, note }: { deal: Deal; name: string; note: string }) {
  return (
    <li>
      <Link
        href={`/deals/${deal.id}`}
        className="group flex items-center justify-between gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-glass"
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-heading">{name}</p>
          <p className="mt-0.5 text-xs text-body">{note}</p>
        </div>
        <div className="flex items-center gap-2">
          <StageBadge stage={deal.stage} />
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

  const { dash, deals, companies, drafts, replyStatus } = data;
  const name = new Map(companies.map((c) => [c.id, c.name]));
  const company = (d: Deal) => name.get(d.company_id) ?? `Deal ${d.id}`;
  const open = deals.filter((d) => !CLOSED_STAGES.includes(d.stage));
  const committed = deals.reduce((s, d) => s + (d.committed_amount ?? 0), 0);
  const pipelineTarget = open.reduce((s, d) => s + (d.target_amount ?? 0), 0);
  const toReview = drafts.filter((d) => d.status === "draft" || d.status === "approved").length;
  const maxCount = Math.max(1, ...Object.values(dash.stage_counts));
  const followups = dash.followups_due.length + dash.stale.length;

  // Everyone waiting on you, counted once even if they are both unread and overdue.
  const waiting = new Set([...dash.new_replies, ...dash.followups_due, ...dash.stale].map((d) => d.id)).size;
  const first = operatorName(getToken()).split(" ")[0];
  const headline =
    waiting === 0
      ? "You're all caught up."
      : `${waiting} ${waiting === 1 ? "sponsor is" : "sponsors are"} waiting on you.`;
  const accent = waiting === 0 ? ["caught", "up."] : [String(waiting)];

  return (
    <>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <WordReveal
            as="p"
            text={`Good ${partOfDay()}${first ? `, ${first}` : ""}.`}
            stagger={40}
            duration={500}
            rise={10}
            className="text-[0.95rem] text-body"
          />
          <WordReveal
            as="h1"
            text={headline}
            accent={accent}
            delay={120}
            className="mt-2 max-w-[34rem] text-[2.4rem] font-medium leading-[1.1] tracking-[-0.02em] text-heading"
          />
        </div>
        <Reveal delay={300}>
          <ReplyCheck status={replyStatus} onDone={reload} />
        </Reveal>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile index={0} label="Open deals" value={open.length} hint={`${deals.length} total`} href="/pipeline" />
        <Tile
          index={1}
          label="Follow-ups due"
          value={followups}
          hint={`${dash.followups_due.length} scheduled · ${dash.stale.length} gone quiet`}
        />
        <Tile index={2} label="Emails to review" value={toReview} hint="drafts not yet sent" href="/drafts" />
        <Tile
          index={3}
          label="Committed"
          value={committed}
          format={fmtMoney}
          hint={pipelineTarget ? `${fmtMoney(pipelineTarget)} targeted in open deals` : undefined}
        />
      </div>

      {dash.new_replies.length > 0 && (
        <Reveal delay={800} className="mt-10">
          <SectionTitle>New replies</SectionTitle>
          {/* A 1px ember border: an opaque inner surface over a gradient with 1px of padding. */}
          <div className="rounded-[1.25rem] bg-[image:var(--ember)] p-px">
            <ul className="rounded-[calc(1.25rem-1px)] bg-[rgba(14,13,20,0.94)] p-2 backdrop-blur-xl">
              {dash.new_replies.map((d) => (
                <DealRow
                  key={d.id}
                  deal={d}
                  name={company(d)}
                  note={`Replied ${daysAgo(d.last_contacted_at) === 0 ? "today" : fmtDate(d.last_contacted_at)}`}
                />
              ))}
            </ul>
          </div>
        </Reveal>
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <Reveal delay={900}>
          <SectionTitle>Follow up now</SectionTitle>
          {followups === 0 ? (
            <Empty>Nothing overdue. Nice.</Empty>
          ) : (
            <Card className="p-2">
              <ul>
                {dash.followups_due.map((d) => (
                  <DealRow key={`due-${d.id}`} deal={d} name={company(d)} note={`Follow-up was due ${fmtDate(d.next_followup_at)}`} />
                ))}
                {dash.stale.map((d) => (
                  <DealRow key={`stale-${d.id}`} deal={d} name={company(d)} note={`No contact for ${daysAgo(d.last_contacted_at)} days`} />
                ))}
              </ul>
            </Card>
          )}
        </Reveal>

        <Reveal delay={1000}>
          <SectionTitle>Pipeline</SectionTitle>
          <Card className="space-y-3">
            {STAGES.map((s, i) => {
              const count = dash.stage_counts[s];
              return (
                <div key={s} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 text-body">{STAGE_LABEL[s]}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <motion.div
                      className={`h-full origin-left rounded-full ${STAGE_BAR[s]}`}
                      initial={reduce ? false : { scaleX: 0 }}
                      animate={{ scaleX: count / maxCount }}
                      transition={{ duration: reduce ? 0 : 0.7, delay: reduce ? 0 : 1.1 + i * 0.05, ease: [0.2, 0, 0, 1] }}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono tabular-nums text-heading">{count}</span>
                </div>
              );
            })}
          </Card>
        </Reveal>
      </div>
    </>
  );
}
