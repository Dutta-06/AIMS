"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { soft } from "@/components/motion/springs";
import WordReveal from "@/components/motion/WordReveal";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, Empty, ErrorNote, Field, Input, Loading, Pill, SectionTitle, StageBadge, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useAction, useQuery } from "@/lib/hooks";
import type { Company, Contact } from "@/lib/types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function CompanyForm({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: company.name,
    industry: company.industry ?? "",
    website: company.website ?? "",
    source: company.source ?? "",
    notes: company.notes ?? "",
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Card className="space-y-3">
      <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-body/80">Company</p>
      <Field label="Name">
        <Input value={f.name} onChange={set("name")} />
      </Field>
      <Field label="Industry">
        <Input value={f.industry} onChange={set("industry")} />
      </Field>
      <Field label="Website">
        <Input value={f.website} onChange={set("website")} />
      </Field>
      <Field label="Where did you find them?">
        <Input value={f.source} onChange={set("source")} />
      </Field>
      <Field label="Notes">
        <Textarea value={f.notes} onChange={set("notes")} rows={3} />
      </Field>
      <ErrorNote message={error} />
      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !f.name.trim()}
        onClick={async () => {
          const ok = await run(() =>
            api.companies.update(company.id, {
              name: f.name.trim(),
              industry: f.industry.trim() || null,
              website: f.website.trim() || null,
              source: f.source.trim() || null,
              notes: f.notes.trim() || null,
            }),
          );
          if (ok) {
            toast("Company saved");
            onSaved();
          }
        }}
      >
        {busy ? "Saving…" : "Save company"}
      </Button>
    </Card>
  );
}

function ContactCard({
  contact,
  busy,
  onToggle,
  onRemove,
}: {
  contact: Contact;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <Card glass className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium text-heading">
          {contact.name}
          {contact.do_not_contact && <Pill tone="rose">Do not contact</Pill>}
        </p>
        <p className="mt-0.5 text-sm text-body">{contact.role ?? "—"}</p>
        <p className="mt-1 font-mono text-[0.82rem] text-body">{contact.email}</p>
      </div>
      <div className="flex gap-1">
        <Button small variant="ghost" disabled={busy} onClick={onToggle}>
          {contact.do_not_contact ? "Allow contact" : "Do not contact"}
        </Button>
        <Button small variant="ghost" disabled={busy} onClick={onRemove} className="hover:text-danger">
          Remove
        </Button>
      </div>
    </Card>
  );
}

export default function CompanyPage() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [contactForm, setContactForm] = useState({ name: "", email: "", role: "" });
  const [confirm, setConfirm] = useState<{ kind: "company" } | { kind: "contact"; contact: Contact } | null>(null);
  const addContact = useAction();
  const rowAction = useAction();
  const dealAction = useAction();
  const del = useAction();

  const { data, error, loading, reload } = useQuery(`company:${id}`, async () => {
    const [company, contacts, deals, drafts] = await Promise.all([
      api.companies.get(id),
      api.contacts.list(id),
      api.deals.list({ company_id: id }),
      api.drafts.list(),
    ]);
    const dealIds = new Set(deals.map((d) => d.id));
    return { company, contacts, deals, draftCount: drafts.filter((d) => dealIds.has(d.deal_id)).length };
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;
  const { company, contacts, deals, draftCount } = data;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/companies" className="text-body hover:text-heading">
          ← Companies
        </Link>
      </p>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <WordReveal as="h1" text={company.name} className="text-[2.4rem] font-medium leading-[1.1] tracking-[-0.02em] text-heading" />
          {(company.industry || company.website) && (
            <p className="mt-2 text-[0.95rem] text-body">{[company.industry, company.website].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <Button variant="danger" onClick={() => setConfirm({ kind: "company" })}>
          Delete company
        </Button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-10">
          <section>
            <SectionTitle>Contacts</SectionTitle>
            <ErrorNote message={rowAction.error} />
            {contacts.length === 0 ? (
              <Empty>No contacts yet. Add someone you can email.</Empty>
            ) : (
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {contacts.map((c, i) => (
                    <motion.div
                      key={c.id}
                      layout
                      initial={reduce ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.2 } }}
                      transition={{ ...soft, delay: Math.min(i, 10) * 0.04 }}
                    >
                      <ContactCard
                        contact={c}
                        busy={rowAction.busy}
                        onToggle={async () => {
                          if (await rowAction.run(() => api.contacts.update(c.id, { do_not_contact: !c.do_not_contact }))) reload();
                        }}
                        onRemove={() => setConfirm({ kind: "contact", contact: c })}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            <form
              className="mt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await addContact.run(() =>
                  api.contacts.create({
                    company_id: id,
                    name: contactForm.name.trim(),
                    email: contactForm.email.trim(),
                    role: contactForm.role.trim() || undefined,
                  }),
                );
                if (ok) {
                  toast(`Added ${contactForm.name.trim()}`);
                  setContactForm({ name: "", email: "", role: "" });
                  reload();
                }
              }}
            >
              <Card className="space-y-3">
                <p className="text-sm font-medium text-heading">Add a contact</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Name">
                    <Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} required />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} required className="font-mono text-[0.85rem]" />
                  </Field>
                  <Field label="Role">
                    <Input value={contactForm.role} onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })} placeholder="e.g. University Relations" />
                  </Field>
                </div>
                <ErrorNote message={addContact.error} />
                <Button type="submit" variant="primary" disabled={addContact.busy}>
                  {addContact.busy ? "Adding…" : "Add contact"}
                </Button>
              </Card>
            </form>
          </section>

          <section>
            <SectionTitle>Deals</SectionTitle>
            {deals.length === 0 ? (
              <Empty>No deal for this company yet.</Empty>
            ) : (
              <div className="space-y-3">
                {deals.map((d) => (
                  <Link key={d.id} href={`/deals/${d.id}`} className="block rounded-[1.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading/70">
                    <Card glass className="flex flex-wrap items-center justify-between gap-3 transition-colors hover:border-white/25">
                      <span className="text-sm text-body">
                        Target <span className="font-mono text-heading">{fmtMoney(d.target_amount)}</span>
                        <span className="mx-2 text-faint">·</span>
                        Committed <span className="font-mono text-heading">{fmtMoney(d.committed_amount)}</span>
                      </span>
                      <StageBadge stage={d.stage} />
                    </Card>
                  </Link>
                ))}
              </div>
            )}
            {deals.length === 0 && (
              <Button
                className="mt-3"
                variant="primary"
                disabled={dealAction.busy}
                onClick={async () => {
                  if (await dealAction.run(() => api.deals.create({ company_id: id }))) reload();
                }}
              >
                Start a deal
              </Button>
            )}
            <div className="mt-3">
              <ErrorNote message={dealAction.error} />
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-[5.5rem] lg:self-start">
          <CompanyForm key={`${company.id}-${company.name}-${company.industry}-${company.website}-${company.source}-${company.notes}`} company={company} onSaved={reload} />
        </aside>
      </div>

      <AnimatePresence>
        {confirm?.kind === "company" && (
          <ConfirmDialog
            title={`Delete ${company.name}?`}
            confirmLabel="Delete company"
            confirmVariant="danger"
            busy={del.busy}
            onCancel={() => setConfirm(null)}
            onConfirm={async () => {
              if (await del.run(() => api.companies.remove(id))) {
                setConfirm(null);
                toast(`Deleted ${company.name}`);
                router.replace("/companies");
              }
            }}
          >
            <p>
              This permanently removes {plural(contacts.length, "contact")}, {plural(deals.length, "deal")}, {plural(draftCount, "email draft")}, and the
              full history on every deal.
            </p>
            <p className="mt-2 text-faint">It can&apos;t be undone.</p>
            {del.error && <p className="mt-3 text-danger">{del.error}</p>}
          </ConfirmDialog>
        )}
        {confirm?.kind === "contact" && (
          <ConfirmDialog
            title={`Remove ${confirm.contact.name}?`}
            confirmLabel="Remove contact"
            confirmVariant="danger"
            busy={rowAction.busy}
            onCancel={() => setConfirm(null)}
            onConfirm={async () => {
              const c = confirm.contact;
              if (await rowAction.run(() => api.contacts.remove(c.id))) {
                setConfirm(null);
                toast(`Removed ${c.name}`);
                reload();
              }
            }}
          >
            <p>Emails drafted to them are deleted with them. Anything already logged on the deal stays.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </>
  );
}
