"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import DraftCard from "@/components/DraftCard";
import { snap, soft } from "@/components/motion/springs";
import WordReveal from "@/components/motion/WordReveal";
import { useSignal } from "@/components/signal/SignalProvider";
import { useToast } from "@/components/ToastProvider";
import {
  Button,
  Card,
  ChannelPicker,
  Empty,
  ErrorNote,
  Field,
  Input,
  Loading,
  Pill,
  SectionTitle,
  Select,
  StatusSelect,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/api";
import { CHANNEL_LABEL, contactLabel, fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { useAction, useQuery } from "@/lib/hooks";
import { CHANNELS, type Channel, type Contact, type DraftKind, type Interaction, type InteractionType, type Status } from "@/lib/types";

const TYPE_LABEL: Record<InteractionType, string> = {
  email_sent: "Email sent",
  email_reply: "Email reply",
  outreach: "We reached out",
  reply: "They replied",
  call: "Call",
  meeting: "Meeting",
  note: "Note",
};
const NODE_COLOR: Record<InteractionType, string> = {
  email_sent: "var(--st-contacted)",
  email_reply: "var(--st-responded)",
  outreach: "var(--st-contacted)",
  reply: "var(--st-responded)",
  call: "var(--faint)",
  meeting: "var(--faint)",
  note: "var(--faint)",
};

/* ---------------------------------------------------------------- reply banner */

function ReplyBanner({ lead, reply, onDone }: { lead: Contact; reply?: Interaction; onDone: () => void }) {
  const signal = useSignal();
  const { busy, error, run } = useAction();
  const clear = async (status?: Status, el?: HTMLElement) => {
    if (await run(() => api.contacts.update(lead.id, { reply_unread: false, ...(status && { status }) }))) {
      if (status === "responded") signal.pulse(el ?? null);
      onDone();
    }
  };
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={soft} className="rounded-[1.25rem] bg-[image:var(--ember)] p-px">
      <div className="space-y-3 rounded-[calc(1.25rem-1px)] bg-[rgba(14,13,20,0.9)] p-5 backdrop-blur-xl">
        <p className="font-medium text-heading">
          They replied
          {reply && <span className="ml-2 font-mono text-[0.8rem] font-normal text-body">{fmtDateTime(reply.occurred_at)}</span>}
        </p>
        {reply?.content && (
          <blockquote className="max-h-48 overflow-y-auto whitespace-pre-wrap border-l-2 border-[var(--st-responded)]/60 pl-3 text-[0.92rem] text-heading" data-lenis-prevent>
            {reply.content}
          </blockquote>
        )}
        <p className="text-sm text-body">The status hasn&apos;t changed. You decide what the reply means.</p>
        <ErrorNote message={error} />
        <div className="flex flex-wrap gap-2">
          {lead.status !== "responded" && (
            <Button variant="primary" disabled={busy} onClick={(e) => clear("responded", e.currentTarget)}>
              Mark as Responded
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

/* ---------------------------------------------------------------- rail: lead form */

function LeadForm({ lead, owners, onSaved }: { lead: Contact; owners: string[]; onSaved: () => void }) {
  const toast = useToast();
  const signal = useSignal();
  const [f, setF] = useState({
    name: lead.name ?? "",
    role: lead.role ?? "",
    owner: lead.owner ?? "",
    email: lead.email ?? "",
    linkedin: lead.linkedin ?? "",
    followup: toLocalInput(lead.next_followup_at),
    remarks: lead.remarks ?? "",
  });
  const [status, setStatus] = useState<Status>(lead.status);
  const [channels, setChannels] = useState<Channel[]>(lead.channels);
  const [dnc, setDnc] = useState(lead.do_not_contact);
  const { busy, error, run } = useAction();
  const text = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const identified = f.name.trim() || f.email.trim() || f.linkedin.trim();

  return (
    <Card className="space-y-3">
      <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-body/80">Lead</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={f.name} onChange={text("name")} />
        </Field>
        <Field label="Position">
          <Input value={f.role} onChange={text("role")} />
        </Field>
      </div>
      <Field label="Owner (who's handling them)">
        <Input value={f.owner} onChange={text("owner")} list="lead-page-owners" />
        <datalist id="lead-page-owners">
          {owners.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </Field>
      <Field label="LinkedIn link">
        <Input value={f.linkedin} onChange={text("linkedin")} />
      </Field>
      <Field label="Email">
        <Input type="email" value={f.email} onChange={text("email")} className="font-mono text-[0.85rem]" />
      </Field>
      <Field label="Status">
        <StatusSelect label="Status" value={status} onChange={(s) => { setStatus(s); if (s === "not_contacted") setChannels([]); }} />
      </Field>
      {status !== "not_contacted" && (
        <Field label="Reached by">
          <ChannelPicker value={channels} onChange={setChannels} />
        </Field>
      )}
      <Field label="Next follow-up">
        <Input type="datetime-local" value={f.followup} onChange={text("followup")} className="font-mono text-[0.85rem]" />
      </Field>
      <Field label="Remarks">
        <Textarea value={f.remarks} onChange={text("remarks")} rows={3} />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-body">
        <input type="checkbox" checked={dnc} onChange={(e) => setDnc(e.target.checked)} className="h-4 w-4 accent-[var(--danger)]" />
        Do not contact (never email this person)
      </label>
      {!identified && <p className="text-xs text-danger">A lead needs a name, an email or a LinkedIn link.</p>}
      <ErrorNote message={error} />
      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !identified}
        onClick={async (e) => {
          const el = e.currentTarget;
          const ok = await run(() =>
            api.contacts.update(lead.id, {
              name: f.name,
              role: f.role,
              owner: f.owner,
              email: f.email,
              linkedin: f.linkedin,
              status,
              channels: status === "not_contacted" ? [] : channels,
              next_followup_at: fromLocalInput(f.followup),
              remarks: f.remarks,
              do_not_contact: dnc,
            }),
          );
          if (ok) {
            toast("Lead saved");
            if (status === "responded" && lead.status !== "responded") signal.pulse(el);
            onSaved();
          }
        }}
      >
        {busy ? "Saving…" : "Save lead"}
      </Button>
    </Card>
  );
}

/* ---------------------------------------------------------------- rail: AI composer */

function Composer({ lead, onDone }: { lead: Contact; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<DraftKind>(lead.status === "not_contacted" ? "intro" : "followup");
  const [instructions, setInstructions] = useState("");
  const { busy, error, run } = useAction();

  if (lead.do_not_contact) return <Empty>Marked do-not-contact, so no emails can be written.</Empty>;
  if (!lead.email) return <Empty>Add an email address to write an email. (LinkedIn and Discord are done by hand: log it in the thread.)</Empty>;
  return (
    // While the model is writing, the border becomes a slowly rotating ember gradient.
    <div className={`rounded-[1.25rem] p-px transition-colors ${busy ? "ember-spin" : "bg-hairline"}`}>
      <Card className="space-y-3 border-transparent">
        <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-body/80">Write an email</p>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as DraftKind)} disabled={busy}>
            <option value="intro">First introduction</option>
            <option value="followup">Follow-up</option>
            <option value="thank_you">Thank you</option>
          </Select>
        </Field>
        <Field label="Anything specific to mention? (optional)">
          <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. they sponsored HackIndia last year" disabled={busy} />
        </Field>
        <ErrorNote message={error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            const ok = await run(() => api.drafts.generate({ contact_id: lead.id, kind, instructions: instructions.trim() || undefined }));
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
          {busy ? "Writing… this can take about 20 seconds." : "It becomes a draft for you to edit. Nothing is sent."}
        </p>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- thread */

function LogForm({ lead, onDone }: { lead: Contact; onDone: () => void }) {
  const signal = useSignal();
  const [type, setType] = useState<InteractionType>("outreach");
  const [channel, setChannel] = useState<Channel>("linkedin");
  const [content, setContent] = useState("");
  const { busy, error, run } = useAction();
  const needsChannel = type === "outreach" || type === "reply";
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened">
          <Select value={type} onChange={(e) => setType(e.target.value as InteractionType)}>
            <option value="outreach">We reached out</option>
            <option value="reply">They replied</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="note">Note</option>
          </Select>
        </Field>
        {needsChannel && (
          <Field label="On">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label={type === "outreach" ? "What you sent (optional)" : "Details"}>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} />
      </Field>
      <ErrorNote message={error} />
      <Button
        variant="primary"
        disabled={busy || (type !== "outreach" && !content.trim())}
        onClick={async (e) => {
          const el = e.currentTarget;
          const ok = await run(() => api.contacts.log(lead.id, { type, channel: needsChannel ? channel : null, content: content.trim() || undefined }));
          if (ok) {
            if (type === "reply") signal.pulse(el);
            setContent("");
            onDone();
          }
        }}
      >
        Log it
      </Button>
      {(type === "outreach" || type === "reply") && (
        <p className="text-xs text-faint">
          {type === "outreach" ? "This marks them Contacted and adds the channel." : "This marks them Responded."}
        </p>
      )}
    </Card>
  );
}

/** A node on the thread. The line extends, the node pops, then the panel fades up, once. */
function TimelineEntry({ item, last }: { item: Interaction; last: boolean }) {
  const reduce = useReducedMotion();
  const view = { once: true, amount: 0.15 } as const;
  const color = NODE_COLOR[item.type];
  return (
    <li className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-4">
      <div className="relative flex justify-center">
        {!last && (
          <motion.span aria-hidden="true" className="absolute bottom-[-1rem] top-4 w-px origin-top bg-white/12" initial={reduce ? false : { scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={view} transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }} />
        )}
        <motion.span aria-hidden="true" className="relative mt-4 h-3 w-3 rounded-full ring-4 ring-[var(--base)]" style={{ background: color }} initial={reduce ? false : { scale: 0 }} whileInView={{ scale: 1 }} viewport={view} transition={{ ...snap, delay: 0.15 }} />
      </div>
      <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={view} transition={{ ...soft, delay: 0.25 }} className="mb-4">
        <Card className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[0.72rem] font-medium uppercase tracking-[0.08em]" style={{ color }}>
              {TYPE_LABEL[item.type]}
            </span>
            {item.channel && <Pill>{CHANNEL_LABEL[item.channel]}</Pill>}
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

/* ---------------------------------------------------------------- page */

export default function LeadPage() {
  const id = Number(useParams<{ id: string }>().id);
  const { data, error, loading, reload } = useQuery(`lead:${id}`, async () => {
    const lead = await api.contacts.get(id);
    const [interactions, drafts, everyone] = await Promise.all([
      api.contacts.interactions(id),
      api.drafts.list({ contact_id: id }),
      api.contacts.list(),
    ]);
    return { lead, interactions, drafts, owners: [...new Set(everyone.map((c) => c.owner).filter((o): o is string => !!o))].sort() };
  });

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error} />;
  const { lead, interactions, drafts, owners } = data;
  const newestFirst = [...interactions].reverse();
  const latestReply = newestFirst.find((i) => i.type === "email_reply" || i.type === "reply");

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/leads" className="text-body hover:text-heading">
          ← Leads
        </Link>
      </p>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <WordReveal as="h1" text={contactLabel(lead)} className="text-[2.4rem] font-medium leading-[1.1] tracking-[-0.02em] text-heading" />
          <p className="mt-2 text-[0.95rem] text-body">
            {lead.role ? `${lead.role} at ` : ""}
            <Link href={`/companies/${lead.company_id}`} className="text-heading hover:underline">
              {lead.company_name}
            </Link>
            {lead.linkedin && (
              <>
                {" · "}
                <a href={lead.linkedin.startsWith("http") ? lead.linkedin : `https://${lead.linkedin}`} target="_blank" rel="noopener noreferrer" className="hover:text-heading hover:underline">
                  LinkedIn ↗
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lead.do_not_contact && <Pill tone="rose">Do not contact</Pill>}
          <StatusSelect
            label="Status"
            value={lead.status}
            onChange={async (s) => {
              await api.contacts.update(lead.id, { status: s });
              reload();
            }}
          />
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-10">
          {lead.reply_unread && <ReplyBanner lead={lead} reply={latestReply} onDone={reload} />}

          <section>
            <SectionTitle>Emails</SectionTitle>
            {drafts.length === 0 ? (
              <Empty>No emails yet. Write one from the panel on the right.</Empty>
            ) : (
              <div className="space-y-4">
                {drafts.map((d) => (
                  <DraftCard key={d.id} draft={d} contact={lead} onChange={reload} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle>Thread</SectionTitle>
            <div className="mb-6">
              <LogForm lead={lead} onDone={reload} />
            </div>
            {newestFirst.length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : (
              <ol>
                {newestFirst.map((i, idx) => (
                  <TimelineEntry key={i.id} item={i} last={idx === newestFirst.length - 1} />
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside data-lenis-prevent className="-m-1 space-y-5 p-1 lg:sticky lg:top-[5.5rem] lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
          <LeadForm key={`${lead.updated_at}`} lead={lead} owners={owners} onSaved={reload} />
          <Composer lead={lead} onDone={reload} />
        </aside>
      </div>
    </>
  );
}
