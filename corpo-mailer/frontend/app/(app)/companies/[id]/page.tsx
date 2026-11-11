"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader, Pill, SectionTitle, StageBadge, Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useAction, useQuery } from "@/lib/hooks";
import type { Company } from "@/lib/types";

function CompanyForm({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [f, setF] = useState({
    name: company.name,
    industry: company.industry ?? "",
    website: company.website ?? "",
    source: company.source ?? "",
    notes: company.notes ?? "",
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Industry"><Input value={f.industry} onChange={set("industry")} /></Field>
        <Field label="Website"><Input value={f.website} onChange={set("website")} /></Field>
        <Field label="Source"><Input value={f.source} onChange={set("source")} /></Field>
      </div>
      <Field label="Notes"><Textarea value={f.notes} onChange={set("notes")} rows={3} /></Field>
      <ErrorNote message={error} />
      <Button
        variant="primary"
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
          if (ok) onSaved();
        }}
      >
        Save company
      </Button>
    </Card>
  );
}

export default function CompanyPage() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const [contactForm, setContactForm] = useState({ name: "", email: "", role: "" });
  const addContact = useAction();
  const rowAction = useAction();
  const dealAction = useAction();
  const del = useAction();

  const { data, error, loading, reload } = useQuery(`company:${id}`, async () => {
    const [company, contacts, deals] = await Promise.all([
      api.companies.get(id),
      api.contacts.list(id),
      api.deals.list({ company_id: id }),
    ]);
    return { company, contacts, deals };
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;
  const { company, contacts, deals } = data;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/companies" className="text-muted hover:text-foreground">← Companies</Link></p>
      <PageHeader
        title={company.name}
        subtitle={[company.industry, company.website].filter(Boolean).join(" · ") || undefined}
        actions={
          <Button
            variant="danger"
            disabled={del.busy}
            onClick={async () => {
              if (window.confirm(`Delete ${company.name} with all its contacts, deals and drafts? This can't be undone.`)) {
                if (await del.run(() => api.companies.remove(id))) router.replace("/companies");
              }
            }}
          >
            Delete
          </Button>
        }
      />
      <ErrorNote message={del.error} />

      <div className="space-y-8">
        <CompanyForm key={`${company.id}-${company.name}-${company.notes}`} company={company} onSaved={reload} />

        <section>
          <SectionTitle>Deals</SectionTitle>
          {deals.length === 0 ? (
            <Empty>No deal for this company yet.</Empty>
          ) : (
            <div className="space-y-2">
              {deals.map((d) => (
                <Link key={d.id} href={`/deals/${d.id}`}>
                  <Card className="mb-2 flex items-center justify-between transition-colors hover:border-accent">
                    <span className="text-sm">Target {fmtMoney(d.target_amount)} · Committed {fmtMoney(d.committed_amount)}</span>
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
              onClick={async () => { if (await dealAction.run(() => api.deals.create({ company_id: id }))) reload(); }}
            >
              Start a deal
            </Button>
          )}
          <ErrorNote message={dealAction.error} />
        </section>

        <section>
          <SectionTitle>Contacts</SectionTitle>
          <ErrorNote message={rowAction.error} />
          {contacts.length === 0 ? (
            <Empty>No contacts yet. Add someone you can email.</Empty>
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-border">
                  {contacts.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{c.name} {c.do_not_contact && <Pill tone="rose">Do not contact</Pill>}</p>
                        <p className="text-xs text-muted">{c.role ?? "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">{c.email}</td>
                      <td className="px-4 py-3 text-right">
                        <Button small variant="ghost" disabled={rowAction.busy}
                          onClick={async () => { if (await rowAction.run(() => api.contacts.update(c.id, { do_not_contact: !c.do_not_contact }))) reload(); }}>
                          {c.do_not_contact ? "Allow contact" : "Do not contact"}
                        </Button>
                        <Button small variant="ghost" disabled={rowAction.busy}
                          onClick={async () => {
                            if (window.confirm(`Remove ${c.name}?`) && (await rowAction.run(() => api.contacts.remove(c.id)))) reload();
                          }}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <form
            className="mt-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await addContact.run(() =>
                api.contacts.create({ company_id: id, name: contactForm.name.trim(), email: contactForm.email.trim(), role: contactForm.role.trim() || undefined }),
              );
              if (ok) { setContactForm({ name: "", email: "", role: "" }); reload(); }
            }}
          >
            <Card className="space-y-3">
              <p className="text-sm font-medium">Add a contact</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name"><Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} required /></Field>
                <Field label="Email"><Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} required /></Field>
                <Field label="Role"><Input value={contactForm.role} onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })} placeholder="e.g. Head of University Relations" /></Field>
              </div>
              <ErrorNote message={addContact.error} />
              <Button type="submit" variant="primary" disabled={addContact.busy}>Add contact</Button>
            </Card>
          </form>
        </section>
      </div>
    </>
  );
}
