"use client";

import { useState } from "react";
import DraftCard from "@/components/DraftCard";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/hooks";
import type { DraftStatus } from "@/lib/types";

const TABS: { value: DraftStatus | "open"; label: string }[] = [
  { value: "open", label: "To review / send" },
  { value: "sent", label: "Sent" },
];

export default function DraftsPage() {
  const [tab, setTab] = useState<"open" | "sent">("open");
  const { data, error, loading, reload } = useQuery("drafts-page", async () => {
    const [drafts, contacts, deals, companies] = await Promise.all([
      api.drafts.list(),
      api.contacts.list(),
      api.deals.list(),
      api.companies.list(),
    ]);
    const company = new Map(companies.map((c) => [c.id, c.name]));
    return {
      drafts: drafts,
      contact: new Map(contacts.map((c) => [c.id, c])),
      dealCompany: new Map(deals.map((d) => [d.id, company.get(d.company_id) ?? `Deal ${d.id}`])),
    };
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;

  const shown = data.drafts.filter((d) => (tab === "sent" ? d.status === "sent" : d.status !== "sent"));

  return (
    <>
      <PageHeader
        title="Drafts"
        subtitle="Nothing is sent until you approve it here, then click send."
      />
      <div className="mb-5 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value as "open" | "sent")}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === t.value ? "bg-accent/15 font-medium text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty>
          {tab === "sent"
            ? "Nothing sent yet."
            : "No drafts waiting. Open a deal and generate one."}
        </Empty>
      ) : (
        <div className="space-y-4">
          {shown.map((d) => (
            <DraftCard
              key={`${d.id}-${d.status}-${d.approved_at}-${d.subject.length}-${d.body.length}`}
              draft={d}
              contact={data.contact.get(d.contact_id)}
              heading={data.dealCompany.get(d.deal_id)}
              onChange={reload}
            />
          ))}
        </div>
      )}
    </>
  );
}
