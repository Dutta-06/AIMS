"use client";

import { Card, DealLink, ErrorNote, Loading, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { STAGE_BAR, STAGE_LABEL, daysAgo, fmtDate, fmtMoney } from "@/lib/format";
import { useAction, useQuery } from "@/lib/hooks";
import { STAGES, type Deal, type Stage } from "@/lib/types";

export default function PipelinePage() {
  const { data, error, loading, reload } = useQuery("pipeline", async () => {
    const [deals, companies] = await Promise.all([api.deals.list(), api.companies.list()]);
    return { deals, name: new Map(companies.map((c) => [c.id, c.name])) };
  });
  const move = useAction();

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;

  const byStage = (s: Stage) => data.deals.filter((d) => d.stage === s);

  async function setStage(d: Deal, stage: Stage) {
    if (await move.run(() => api.deals.update(d.id, { stage }))) reload();
  }

  return (
    <>
      <PageHeader title="Pipeline" subtitle="Move a deal between stages with the dropdown on its card." />
      <div className="mb-4">
        <ErrorNote message={move.error} />
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4">
        {STAGES.map((s) => {
          const deals = byStage(s);
          const total = deals.reduce((sum, d) => sum + (d.target_amount ?? 0), 0);
          return (
            <div key={s} className="w-64 shrink-0">
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className={`h-2.5 w-2.5 rounded-full ${STAGE_BAR[s]}`} />
                <h2 className="text-sm font-semibold">{STAGE_LABEL[s]}</h2>
                <span className="text-xs text-muted">{deals.length}</span>
                {total > 0 && <span className="ml-auto text-xs text-muted">{fmtMoney(total)}</span>}
              </div>
              <div className="space-y-2">
                {deals.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted">
                    Empty
                  </p>
                )}
                {deals.map((d) => (
                  <Card key={d.id} className="space-y-2 p-3">
                    <DealLink id={d.id}>{data.name.get(d.company_id) ?? `Deal ${d.id}`}</DealLink>
                    <p className="text-xs text-muted">
                      {d.target_amount != null && <>Target {fmtMoney(d.target_amount)} · </>}
                      {d.last_contacted_at
                        ? `Contacted ${daysAgo(d.last_contacted_at)}d ago`
                        : "Not contacted yet"}
                      {d.next_followup_at && <> · Follow up {fmtDate(d.next_followup_at)}</>}
                    </p>
                    <Select
                      aria-label="Stage"
                      value={d.stage}
                      onChange={(e) => setStage(d, e.target.value as Stage)}
                      disabled={move.busy}
                      className="py-1 text-xs"
                    >
                      {STAGES.map((st) => (
                        <option key={st} value={st}>
                          {STAGE_LABEL[st]}
                        </option>
                      ))}
                    </Select>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
