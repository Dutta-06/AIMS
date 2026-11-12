"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { soft } from "@/components/motion/springs";
import WordReveal from "@/components/motion/WordReveal";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, ChannelPills, Empty, ErrorNote, Field, Input, Loading, Pill, SectionTitle, StatusSelect, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { contactLabel } from "@/lib/format";
import { useAction, useQuery } from "@/lib/hooks";
import type { Company, Contact } from "@/lib/types";
import { leadHref } from "@/lib/routes";

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
  onStatus,
}: {
  contact: Contact;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onStatus: (status: Contact["status"]) => void;
}) {
  return (
    <Card glass className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium text-heading">
          <Link href={leadHref(contact.id)} className="hover:underline">
            {contactLabel(contact)}
          </Link>
          {contact.do_not_contact && <Pill tone="rose">Do not contact</Pill>}
          {contact.reply_unread && <Pill tone="green">New reply</Pill>}
        </p>
        <p className="mt-0.5 text-sm text-body">
          {contact.role || "—"}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.82rem] text-body">
          {contact.email && <span className="font-mono">{contact.email}</span>}
          {contact.linkedin && (
            <a href={contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}`} target="_blank" rel="noopener noreferrer" className="hover:text-heading hover:underline">
              LinkedIn ↗
            </a>
          )}
        </p>
        {contact.channels.length > 0 && (
          <div className="mt-2">
            <ChannelPills channels={contact.channels} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <StatusSelect label={`Status of ${contactLabel(contact)}`} value={contact.status} disabled={busy} onChange={onStatus} />
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

function CompanyView({ id }: { id: number }) {
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion();
  const [contactForm, setContactForm] = useState({ name: "", email: "", linkedin: "", role: "" });
  const [confirm, setConfirm] = useState<{ kind: "company" } | { kind: "contact"; contact: Contact } | null>(null);
  const addContact = useAction();
  const rowAction = useAction();
  const del = useAction();

  const { data, error, loading, reload } = useQuery(`company:${id}`, async () => {
    const [company, contacts, drafts] = await Promise.all([api.companies.get(id), api.contacts.list({ company_id: id }), api.drafts.list()]);
    const ids = new Set(contacts.map((c) => c.id));
    return { company, contacts, draftCount: drafts.filter((d) => ids.has(d.contact_id)).length };
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;
  const { company, contacts, draftCount } = data;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/companies" className="text-body hover:text-heading">
          ← Companies
        </Link>
      </p>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <WordReveal as="h1" text={company.name} className="[overflow-wrap:anywhere] text-[2.4rem] font-medium leading-[1.1] tracking-[-0.02em] text-heading" />
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
                        onStatus={async (status) => {
                          if (await rowAction.run(() => api.contacts.update(c.id, { status }))) reload();
                        }}
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
                    name: contactForm.name,
                    email: contactForm.email,
                    linkedin: contactForm.linkedin,
                    role: contactForm.role,
                  }),
                );
                if (ok) {
                  toast(`Added ${contactForm.name.trim() || contactForm.email.trim() || "the lead"}`);
                  setContactForm({ name: "", email: "", linkedin: "", role: "" });
                  reload();
                }
              }}
            >
              <Card className="space-y-3">
                <p className="text-sm font-medium text-heading">Add a contact</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} />
                  </Field>
                  <Field label="Position">
                    <Input value={contactForm.role} onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })} placeholder="e.g. University Relations" />
                  </Field>
                  <Field label="LinkedIn link">
                    <Input value={contactForm.linkedin} onChange={(e) => setContactForm({ ...contactForm, linkedin: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} className="font-mono text-[0.85rem]" />
                  </Field>
                </div>
                <ErrorNote message={addContact.error} />
                <Button type="submit" variant="primary" disabled={addContact.busy || !(contactForm.name.trim() || contactForm.email.trim() || contactForm.linkedin.trim())}>
                  {addContact.busy ? "Adding…" : "Add contact"}
                </Button>
              </Card>
            </form>
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
              This permanently removes {plural(contacts.length, "contact")}, {plural(draftCount, "email draft")}, and everything logged on
              them (the whole thread of emails, calls and notes).
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
            <p>Their email drafts and everything logged on them (the thread of emails, calls and notes) are deleted too.</p>
            <p className="mt-2 text-faint">It can&apos;t be undone.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </>
  );
}

function CompanyInner() {
  const raw = useSearchParams().get("id");
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id < 1) return <ErrorNote message="No company chosen. Open one from the list." />;
  return <CompanyView id={id} />;
}

export default function CompanyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CompanyInner />
    </Suspense>
  );
}
