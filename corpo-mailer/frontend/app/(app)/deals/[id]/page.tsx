"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import DraftCard from "@/components/DraftCard";
import { snap, soft } from "@/components/motion/springs";
import WordReveal from "@/components/motion/WordReveal";
import { useToast } from "@/components/ToastProvider";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Loading,
  Pill,
  SectionTitle,
  Select,
  StageBadge,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { STAGE_LABEL, fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { useAction, useQuery } from "@/lib/hooks";
import {
  STAGES,
  type Contact,
  type Deal,
  type DraftKind,
  type Interaction,
  type InteractionType,
  type Stage,
} from "@/lib/types";

const TYPE_LABEL: Record<InteractionType, string> = {
  email_sent: "Email sent",
  email_reply: "Reply received",
  call: "Call",
  meeting: "Meeting",
  note: "Note",
};
const NODE_COLOR: Record<InteractionType, string> = {
  email_sent: "var(--st-in_discussion)",
  email_reply: "var(--st-replied)",
  call: "var(--st-paid)",
  meeting: "var(--st-paid)",
  note: "var(--faint)",
};
const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))));

/* ------------------------------------------------------------------ reply banner */

function ReplyBanner({ deal, reply, onDone }: { deal: Deal; reply?: Interaction; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const canAdvance = deal.stage === "prospect" || deal.stage === "contacted";
  const clear = async (stage?: Stage) => {
    if (await run(() => api.deals.update(deal.id, { reply_unread: false, ...(stage && { stage }) }))) onDone();
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="rounded-[1.25rem] bg-[image:var(--ember)] p-px"
    >
      <div className="space-y-3 rounded-[calc(1.25rem-1px)] bg-[rgba(14,13,20,0.9)] p-5 backdrop-blur-xl">
        <p className="font-medium text-heading">
          They replied
          {reply && <span className="ml-2 font-mono text-[0.8rem] font-normal text-body">{fmtDateTime(reply.occurred_at)}</span>}
        </p>
        {reply?.content && (
          <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap border-l-2 border-[var(--st-replied)]/60 pl-3 text-[0.92rem] text-heading" data-lenis-prevent>
            {reply.content}
          </blockquote>
        )}
        <p className="text-sm text-body">The stage hasn&apos;t changed. You decide what the reply means.</p>
        <ErrorNote message={error} />
        <div className="flex flex-wrap gap-2">
          {canAdvance && (
            <Button variant="primary" disabled={busy} onClick={() => clear("replied")}>
              Move to Replied
            </Button>
          )}
          <Button disabled={busy} onClick={() => clear()}>
            Mark as seen
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ rail: deal form */

function DealForm({ deal, onSaved }: { deal: Deal; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    stage: deal.stage,
    owner: deal.owner ?? "",
    target: deal.target_amount?.toString() ?? "",
    committed: deal.committed_amount?.toString() ?? "",
    followup: toLocalInput(deal.next_followup_at),
    notes: deal.notes ?? "",
  });
  const { busy, error, run } = useAction();
  const text =
    (k: "owner" | "target" | "committed" | "followup" | "notes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF({ ...f, [k]: e.target.value });

  return (
    <Card className="space-y-3">
      <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-body/80">Deal</p>
      <Field label="Stage">
        <Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Owner (who's handling this)">
        <Input value={f.owner} onChange={text("owner")} />
      </Field>
      <Field label="Next follow-up">
        <Input type="datetime-local" value={f.followup} onChange={text("followup")} className="font-mono text-[0.85rem]" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target (₹)">
          <Input type="number" min={0} value={f.target} onChange={text("target")} className="font-mono" />
        </Field>
        <Field label="Committed (₹)">
          <Input type="number" min={0} value={f.committed} onChange={text("committed")} className="font-mono" />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={f.notes} onChange={text("notes")} rows={3} />
      </Field>
      <ErrorNote message={error} />
      <Button
        variant="primary"
        className="w-full"
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
          if (ok) {
            toast("Deal saved");
            onSaved();
          }
        }}
      >
        {busy ? "Saving…" : "Save deal"}
      </Button>
    </Card>
  );
}

/* ------------------------------------------------------------------ rail: AI composer */

function Composer({ dealId, contacts, onDone }: { dealId: number; contacts: Contact[]; onDone: () => void }) {
  const toast = useToast();
  const usable = contacts.filter((c) => !c.do_not_contact);
  const [contactId, setContactId] = useState("");
  const [kind, setKind] = useState<DraftKind>("intro");
  const [instructions, setInstructions] = useState("");
  const { busy, error, run } = useAction();
  const selected = contactId || (usable[0]?.id.toString() ?? "");

  if (usable.length === 0) {
    return <Empty>Add a contact (not marked do-not-contact) to this company to draft an email.</Empty>;
  }
  return (
    // While the model is writing, the border becomes a slowly rotating ember gradient.
    <div className={`rounded-[1.25rem] p-px transition-colors ${busy ? "ember-spin" : "bg-hairline"}`}>
      <Card className="space-y-3 border-transparent">
        <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-body/80">Write an email</p>
        <Field label="To">
          <Select value={selected} onChange={(e) => setContactId(e.target.value)} disabled={busy}>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as DraftKind)} disabled={busy}>
            <option value="intro">First introduction</option>
            <option value="followup">Follow-up</option>
            <option value="thank_you">Thank you</option>
          </Select>
        </Field>
        <Field label="Anything specific to mention? (optional)">
          <Input
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. they sponsored HackIndia last year"
            disabled={busy}
          />
        </Field>
        <ErrorNote message={error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            const ok = await run(() =>
              api.drafts.generate({
                deal_id: dealId,
                contact_id: Number(selected),
                kind,
                instructions: instructions.trim() || undefined,
              }),
            );
            if (ok) {
              setInstructions("");
              toast("Draft ready to review");
              onDone();
            }
          }}
        >
          {busy ? "Writing…" : "Write a draft with AI"}
        </Button>
        <p aria-live="polite" className="text-xs text-faint">
          {busy
            ? "Writing… this can take about 20 seconds."
            : "It becomes a draft for you to edit. Nothing is sent."}
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ thread */

function LogForm({ dealId, contacts, onDone }: { dealId: number; contacts: Contact[]; onDone: () => void }) {
  const [type, setType] = useState<InteractionType>("note");
  const [content, setContent] = useState("");
  const [contactId, setContactId] = useState("");
  const { busy, error, run } = useAction();
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Log a call, meeting, reply or note">
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
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Details">
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} />
      </Field>
      <ErrorNote message={error} />
      <Button
        variant="primary"
        disabled={busy || !content.trim()}
        onClick={async () => {
          const ok = await run(() =>
            api.deals.logInteraction(dealId, {
              type,
              content: content.trim(),
              contact_id: contactId ? Number(contactId) : null,
            }),
          );
          if (ok) {
            setContent("");
            onDone();
          }
        }}
      >
        Log it
      </Button>
    </Card>
  );
}

/** A node on the thread. The line extends, the node pops, then the panel fades up, once. */
function TimelineEntry({
  item,
  contact,
  last,
}: {
  item: Interaction;
  contact?: Contact;
  last: boolean;
}) {
  const reduce = useReducedMotion();
  const view = { once: true, amount: 0.15 } as const;
  const color = NODE_COLOR[item.type];
  return (
    <li className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-4">
      <div className="relative flex justify-center">
        {!last && (
          <motion.span
            aria-hidden="true"
            className="absolute bottom-[-1rem] top-4 w-px origin-top bg-white/12"
            initial={reduce ? false : { scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={view}
            transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
          />
        )}
        <motion.span
          aria-hidden="true"
          className="relative mt-4 h-3 w-3 rounded-full ring-4 ring-[var(--base)]"
          style={{ background: color }}
          initial={reduce ? false : { scale: 0 }}
          whileInView={{ scale: 1 }}
          viewport={view}
          transition={{ ...snap, delay: 0.15 }}
        />
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={view}
        transition={{ ...soft, delay: 0.25 }}
        className="mb-4"
      >
        <Card className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[0.72rem] font-medium uppercase tracking-[0.08em]" style={{ color }}>
              {TYPE_LABEL[item.type]}
            </span>
            {contact && <span className="text-heading">{contact.name}</span>}
            {item.source === "auto" && <Pill>auto-detected</Pill>}
            <span className="ml-auto font-mono text-xs text-faint">{fmtDateTime(item.occurred_at)}</span>
          </div>
          {item.subject && <p className="text-[0.95rem] font-medium text-heading">{item.subject}</p>}
          {item.content && <p className="whitespace-pre-wrap text-sm text-body">{item.content}</p>}
          {item.approved_by && <p className="text-xs text-faint">Approved by {item.approved_by}</p>}
        </Card>
      </motion.div>
    </li>
  );
}

/* ------------------------------------------------------------------ page */

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
  const newestFirst = [...interactions].reverse();
  const latestReply = newestFirst.find((i) => i.type === "email_reply");

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/pipeline" className="text-body hover:text-heading">
          ← Pipeline
        </Link>
      </p>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <WordReveal
            as="h1"
            text={company.name}
            className="text-[2.4rem] font-medium leading-[1.1] tracking-[-0.02em] text-heading"
          />
          <div className="mt-3 flex items-center gap-3">
            <StageBadge stage={deal.stage} />
            <span className="font-mono text-xs text-faint">Deal #{deal.id}</span>
          </div>
        </div>
        <Link href={`/companies/${company.id}`} className="text-sm text-body hover:text-heading">
          Company &amp; contacts →
        </Link>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-10">
          {deal.reply_unread && <ReplyBanner deal={deal} reply={latestReply} onDone={reload} />}

          <section>
            <SectionTitle>Emails</SectionTitle>
            {drafts.length === 0 ? (
              <Empty>No emails yet. Write one from the panel on the right.</Empty>
            ) : (
              <div className="space-y-4">
                {drafts.map((d) => (
                  <DraftCard key={d.id} draft={d} contact={contactById.get(d.contact_id)} onChange={reload} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle>Thread</SectionTitle>
            <div className="mb-6">
              <LogForm dealId={id} contacts={contacts} onDone={reload} />
            </div>
            {newestFirst.length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : (
              <ol>
                {newestFirst.map((i, idx) => (
                  <TimelineEntry
                    key={i.id}
                    item={i}
                    contact={i.contact_id ? contactById.get(i.contact_id) : undefined}
                    last={idx === newestFirst.length - 1}
                  />
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside
          data-lenis-prevent
          className="-m-1 space-y-5 p-1 lg:sticky lg:top-[5.5rem] lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto"
        >
          <DealForm
            key={`${deal.stage}-${deal.target_amount}-${deal.committed_amount}-${deal.next_followup_at}-${deal.notes}-${deal.owner}`}
            deal={deal}
            onSaved={reload}
          />
          <Composer dealId={id} contacts={contacts} onDone={reload} />
        </aside>
      </div>
    </>
  );
}
