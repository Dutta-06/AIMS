"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader, StageBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useQuery } from "@/lib/hooks";

export default function CompaniesPage() {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", industry: "", website: "", source: "" });
  const { busy, error, run } = useAction();

  const { data, error: loadError, loading, reload } = useQuery(`companies:${q}`, async () => {
    const [companies, contacts, deals] = await Promise.all([
      api.companies.list(q),
      api.contacts.list(),
      api.deals.list(),
    ]);
    return { companies, contacts, deals };
  });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      const c = await api.companies.create({
        name: form.name.trim(),
        industry: form.industry.trim() || null,
        website: form.website.trim() || null,
        source: form.source.trim() || null,
      });
      await api.deals.create({ company_id: c.id }); // every company starts as a prospect
    });
    if (ok) {
      setForm({ name: "", industry: "", website: "", source: "" });
      setAdding(false);
      reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle="Everyone you might ask for sponsorship."
        actions={<Button variant="primary" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "Add company"}</Button>}
      />

      {adding && (
        <form onSubmit={add} className="mb-6">
          <Card className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </Field>
              <Field label="Industry">
                <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
              </Field>
              <Field label="Website">
                <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </Field>
              <Field label="Where did you find them?">
                <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. HackIndia 2025 sponsor list" />
              </Field>
            </div>
            <ErrorNote message={error} />
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Adding…" : "Add as prospect"}</Button>
          </Card>
        </form>
      )}

      <div className="mb-4 max-w-sm">
        <Input placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? (
        <Loading />
      ) : loadError || !data ? (
        <ErrorNote message={loadError} />
      ) : data.companies.length === 0 ? (
        <Empty>{q ? "No company matches that search." : "No companies yet. Add your first prospect."}</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Industry</th>
                <th className="px-4 py-3">Contacts</th>
                <th className="px-4 py-3">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.companies.map((c) => {
                const deals = data.deals.filter((d) => d.company_id === c.id);
                return (
                  <tr key={c.id} className="hover:bg-foreground/[0.03]">
                    <td className="px-4 py-3">
                      <Link href={`/companies/${c.id}`} className="font-medium hover:text-accent hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{c.industry ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{data.contacts.filter((x) => x.company_id === c.id).length}</td>
                    <td className="px-4 py-3">
                      {deals.length ? <StageBadge stage={deals[0].stage} /> : <span className="text-muted">No deal</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
