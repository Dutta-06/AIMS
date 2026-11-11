"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import DraftCard from "@/components/DraftCard";
import {
  Button, Card, Empty, ErrorNote, Field, Input, Loading, PageHeader, Pill, SectionTitle, Select, Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { STAGE_LABEL, fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { useAction, useQuery } from "@/lib/hooks";
import { STAGES, type Contact, type Deal, type DraftKind, type InteractionType, type Stage } from "@/lib/types";

const TYPE_LABEL: Record<InteractionType, string> = {
  email_sent: "Email sent",
  email_reply: "Reply received",
  call: "Call",
  meeting: "Meeting",
  note: "Note",
};
const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))));

function DealForm({ deal, onSaved }: { deal: Deal; onSaved: () => void }) {
  const [f, setF] = useState({
    stage: deal.stage,
    owner: deal.owner ?? "",
    target: deal.target_amount?.toString() ?? "",
    committed: deal.committed_amount?.toString() ?? "",
    followup: toLocalInput(deal.next_followup_at),
    notes: deal.notes ?? "",
  });
  const { busy, error, run } = useAction();
  const text = (k: "owner" | "target" | "committed" | "followup" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Stage">
          <Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Owner (who's handling this)"><Input value={f.owner} onChange={text("owner")} /></Field>
        <Field label="Next follow-up"><Input type="datetime-local" value={f.followup} onChange={text("followup")} /></Field>
        <Field label="Target amount (₹)"><Input type="number" min={0} value={f.target} onChange={text("target")} /></Field>
        <Field label="Committed amount (₹)"><Input type="number" min={0} value={f.committed} onChange={text("committed")} /></Field>
      </div>
      <Field label="Notes"><Textarea value={f.notes} onChange={text("notes")} rows={3} /></Field>
      <ErrorNote message={error} />
      <Button
        variant="primary"
        disabled={busy}
        onClick={async () => {
          const ok = await run(() =>
            api.deals.update(deal.id, {
              stage: f.stage,
              owner: f.owner.trim() || null,
              target_amount: num(f.target),
              committed_amount: num(f.committed),
              next_followup_at: fromLocalInput(f.followup),
              notes: f.notes.trim() || null,
            }),
          );
          if (ok) onSaved();
        }}
      >
        Save deal
      </Button>
    </Card>
  );
}

function Generate({ dealId, contacts, onDone }: { dealId: number; contacts: Contact[]; onDone: () => void }) {
  const usable = contacts.filter((c) => !c.do_not_contact);
  const [contactId, setContactId] = useState<string>("");
  const [kind, setKind] = useState<DraftKind>("intro");
  const [instructions, setInstructions] = useState("");
  const { busy, error, run } = useAction();
  const selected = contactId || (usable[0]?.id.toString() ?? "");

  if (usable.length === 0) {
    return <Empty>Add a contact (who isn’t marked do-not-contact) to this company to draft an email.</Empty>;
  }
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="To">
          <Select value={selected} onChange={(e) => setContactId(e.target.value)}>
            {usable.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.email}</option>)}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
            <option value="intro">First introduction</option>
            <option value="followup">Follow-up</option>
            <option value="thank_you">Thank you</option>
          </Select>
        </Field>
      </div>
      <Field label="Anything specific to mention? (optional)">
        <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. they sponsored HackIndia last year" />
      </Field>
      <ErrorNote message={error} />
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            const ok = await run(() =>
              api.drafts.generate({ deal_id: dealId, contact_id: Number(selected), kind, instructions: instructions.trim() || undefined }),
            );
            if (ok) { setInstructions(""); onDone(); }
          }}
        >
          {busy ? "Writing… (can take ~20s)" : "Write a draft with AI"}
        </Button>
        <span className="text-xs text-muted">It becomes a draft for you to edit. Nothing is sent.</span>
      </div>
    </Card>
  );
}

function LogForm({ dealId, contacts, onDone }: { dealId: number; contacts: Contact[]; onDone: () => void }) {
  const [type, setType] = useState<InteractionType>("note");
  const [content, setContent] = useState("");
  const [contactId, setContactId] = useState("");
  const { busy, error, run } = useAction();
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened">
          <Select value={type} onChange={(e) => setType(e.target.value as InteractionType)}>
            <option value="note">Note</option>
            <option value="email_reply">They replied</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
          </Select>
        </Field>
        <Field label="With (optional)">
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">—</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Details"><Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} /></Field>
      <ErrorNote message={error} />
      <Button
        variant="primary"
        disabled={busy || !content.trim()}
        onClick={async () => {
          const ok = await run(() =>
            api.deals.logInteraction(dealId, { type, content: content.trim(), contact_id: contactId ? Number(contactId) : null }),
          );
          if (ok) { setContent(""); onDone(); }
        }}
      >
        Log it
      </Button>
    </Card>
  );
}

export default function DealPage() {
  const id = Number(useParams<{ id: string }>().id);
  const { data, error, loading, reload } = useQuery(`deal:${id}`, async () => {
    const deal = await api.deals.get(id);
    const [company, contacts, interactions, drafts] = await Promise.all([
      api.companies.get(deal.company_id),
      api.contacts.list(deal.company_id),
      api.deals.interactions(id),
      api.drafts.list({ deal_id: id }),
    ]);
    return { deal, company, contacts, interactions, drafts };
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;
  const { deal, company, contacts, interactions, drafts } = data;
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/pipeline" className="text-muted hover:text-foreground">← Pipeline</Link></p>
      <PageHeader
        title={company.name}
        subtitle={`Deal #${deal.id}`}
        actions={<Link href={`/companies/${company.id}`} className="text-sm text-accent hover:underline">Company &amp; contacts →</Link>}
      />

      <div className="space-y-8">
        <DealForm
          key={`${deal.stage}-${deal.target_amount}-${deal.committed_amount}-${deal.next_followup_at}-${deal.notes}-${deal.owner}`}
          deal={deal}
          onSaved={reload}
        />

        <section>
          <SectionTitle>Emails</SectionTitle>
          <div className="space-y-4">
            <Generate dealId={id} contacts={contacts} onDone={reload} />
            {drafts.map((d) => (
              <DraftCard
                key={`${d.id}-${d.status}-${d.approved_at}-${d.subject.length}-${d.body.length}`}
                draft={d}
                contact={contactById.get(d.contact_id)}
                onChange={reload}
              />
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Timeline</SectionTitle>
          <div className="space-y-4">
            <LogForm dealId={id} contacts={contacts} onDone={reload} />
            {interactions.length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : (
              <ol className="space-y-2">
                {[...interactions].reverse().map((i) => (
                  <li key={i.id}>
                    <Card className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Pill tone={i.type === "email_reply" ? "green" : i.type === "email_sent" ? "indigo" : "muted"}>{TYPE_LABEL[i.type]}</Pill>
                        {i.contact_id && contactById.get(i.contact_id) && <span>{contactById.get(i.contact_id)!.name}</span>}
                        {i.source === "auto" && <Pill>auto-detected</Pill>}
                        <span className="ml-auto text-xs text-muted">{fmtDateTime(i.occurred_at)}</span>
                      </div>
                      {i.subject && <p className="text-sm font-medium">{i.subject}</p>}
                      {i.content && <p className="whitespace-pre-wrap text-sm text-muted">{i.content}</p>}
                      {i.approved_by && <p className="text-xs text-muted">Approved by {i.approved_by}</p>}
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
