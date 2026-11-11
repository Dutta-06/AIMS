"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import DraftCard from "@/components/DraftCard";
import { snap, soft } from "@/components/motion/springs";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/hooks";

type Tab = "open" | "sent";
const TABS: { value: Tab; label: string }[] = [
  { value: "open", label: "To review / send" },
  { value: "sent", label: "Sent" },
];

export default function DraftsPage() {
  const [tab, setTab] = useState<Tab>("open");
  // Emails sent during this visit stay on the review tab, showing their Sent state, until you leave.
  const [justSent, setJustSent] = useState<Set<number>>(new Set());
  const { data, error, loading, reload } = useQuery("drafts-page", async () => {
    const [drafts, contacts, deals, companies] = await Promise.all([
      api.drafts.list(),
      api.contacts.list(),
      api.deals.list(),
      api.companies.list(),
    ]);
    const company = new Map(companies.map((c) => [c.id, c.name]));
    return {
      drafts,
      contact: new Map(contacts.map((c) => [c.id, c])),
      dealCompany: new Map(deals.map((d) => [d.id, company.get(d.company_id) ?? `Deal ${d.id}`])),
    };
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;

  const shown = data.drafts.filter((d) =>
    tab === "sent" ? d.status === "sent" : d.status !== "sent" || justSent.has(d.id),
  );

  return (
    <>
      <PageHeader title="Drafts" subtitle="Nothing is sent until you approve it here, then hold to send." />
      <div role="tablist" aria-label="Draft filter" className="mb-6 inline-flex rounded-full border border-glass-border bg-glass p-1 backdrop-blur-[14px]">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`relative h-9 rounded-full px-4 text-sm transition-colors ${
              tab === t.value ? "text-heading" : "text-body hover:text-heading"
            }`}
          >
            {tab === t.value && (
              <motion.span layoutId="drafts-tab" transition={snap} className="absolute inset-0 rounded-full bg-glass-strong" />
            )}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>
          {tab === "sent" ? "Nothing sent yet." : "No drafts waiting. Open a deal and write one."}
        </Empty>
      ) : (
        <div className="space-y-4">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((d) => (
              <motion.div
                key={d.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.2 } }}
                transition={soft}
              >
                <DraftCard
                  draft={d}
                  contact={data.contact.get(d.contact_id)}
                  heading={data.dealCompany.get(d.deal_id)}
                  onChange={reload}
                  onSent={() => setJustSent((s) => new Set(s).add(d.id))}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
