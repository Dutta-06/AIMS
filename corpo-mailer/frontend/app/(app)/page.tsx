"use client";

import Link from "next/link";
import { Card, DealLink, Empty, ErrorNote, Loading, PageHeader, SectionTitle, StageBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { STAGE_BAR, STAGE_LABEL, daysAgo, fmtDate, fmtMoney } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import { CLOSED_STAGES, STAGES, type Deal } from "@/lib/types";

async function load() {
  const [dash, deals, companies, drafts] = await Promise.all([
    api.dashboard(),
    api.deals.list(),
    api.companies.list(),
    api.drafts.list(),
  ]);
  return { dash, deals, companies, drafts };
}

function Tile({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (
    <Card className={href ? "transition-colors hover:border-accent" : ""}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function DashboardPage() {
  const { data, error, loading } = useQuery("dashboard", load);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;

  const { dash, deals, companies, drafts } = data;
  const name = new Map(companies.map((c) => [c.id, c.name]));
  const open = deals.filter((d) => !CLOSED_STAGES.includes(d.stage));
  const committed = deals.reduce((s, d) => s + (d.committed_amount ?? 0), 0);
  const pipelineTarget = open.reduce((s, d) => s + (d.target_amount ?? 0), 0);
  const toReview = drafts.filter((d) => d.status === "draft" || d.status === "approved").length;
  const maxCount = Math.max(1, ...Object.values(dash.stage_counts));

  const row = (d: Deal, extra: string) => (
    <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <DealLink id={d.id}>{name.get(d.company_id) ?? `Deal ${d.id}`}</DealLink>
        <p className="text-xs text-muted">{extra}</p>
      </div>
      <StageBadge stage={d.stage} />
    </li>
  );

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Who needs attention, and where every sponsor stands." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Open deals" value={open.length} hint={`${deals.length} total`} href="/pipeline" />
        <Tile
          label="Follow-ups due"
          value={dash.followups_due.length + dash.stale.length}
          hint={`${dash.followups_due.length} scheduled · ${dash.stale.length} gone quiet`}
        />
        <Tile label="Emails to review" value={toReview} hint="drafts not yet sent" href="/drafts" />
        <Tile
          label="Committed"
          value={fmtMoney(committed)}
          hint={pipelineTarget ? `${fmtMoney(pipelineTarget)} targeted in open deals` : undefined}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>Follow up now</SectionTitle>
          {dash.followups_due.length + dash.stale.length === 0 ? (
            <Empty>Nothing overdue. Nice.</Empty>
          ) : (
            <Card className="divide-y divide-border py-1">
              <ul className="divide-y divide-border">
                {dash.followups_due.map((d) => row(d, `Follow-up was due ${fmtDate(d.next_followup_at)}`))}
                {dash.stale.map((d) => row(d, `No contact for ${daysAgo(d.last_contacted_at)} days`))}
              </ul>
            </Card>
          )}
        </section>

        <section>
          <SectionTitle>Pipeline</SectionTitle>
          <Card className="space-y-2.5">
            {STAGES.map((s) => (
              <div key={s} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-muted">{STAGE_LABEL[s]}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className={`h-full rounded-full ${STAGE_BAR[s]}`}
                    style={{ width: `${(dash.stage_counts[s] / maxCount) * 100}%` }}
                  />
                </div>
                <span className="w-6 text-right tabular-nums">{dash.stage_counts[s]}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </>
  );
}
