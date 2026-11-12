"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import ApprovalRail from "@/components/ApprovalRail";
import ConfirmDialog from "@/components/ConfirmDialog";
import HoldToSend from "@/components/HoldToSend";
import { useSignal } from "@/components/signal/SignalProvider";
import { useToast } from "@/components/ToastProvider";
import { Button, Card, ErrorNote, Field, Input, Pill, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { contactLabel, fmtDateTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Contact, Draft } from "@/lib/types";

const NOTE_LIMIT = 300; // LinkedIn's cap on a connection note
const QUICK = ["Make it shorter", "Warmer tone", "More formal", "Add a clear, low-effort ask"];

/**
 * One outgoing email. Approving and sending are two separate, deliberate human actions: there is
 * no "approve and send", and no path from Approved to Sent that doesn't end in a hold or an
 * explicit confirmation naming the recipient. The server enforces the same rules.
 *
 * Keep this component mounted across status changes (key it by draft id) so the rail can animate.
 */
export default function DraftCard({
  draft,
  contact,
  heading,
  onChange,
  onSent,
}: {
  draft: Draft;
  contact?: Contact;
  heading?: string;
  onChange: () => void;
  onSent?: () => void;
}) {
  const reduce = useReducedMotion();
  const signal = useSignal();
  const toast = useToast();
  const holdRef = useRef<HTMLButtonElement>(null);
  const [subjectEdit, setSubjectEdit] = useState<string | null>(null);
  const [bodyEdit, setBodyEdit] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sweep, setSweep] = useState(0);
  const [voided, setVoided] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [asking, setAsking] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const { busy, error, run } = useAction();
  const isNote = draft.channel === "linkedin";

  const subject = subjectEdit ?? draft.subject;
  const body = bodyEdit ?? draft.body;
  const locked = draft.status === "sent" || draft.status === "sending";
  const dirty = subject !== draft.subject || body !== draft.body;
  const dnc = contact?.do_not_contact ?? false;
  const linkedin = contact?.linkedin ? (contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}`) : null;
  const email = contact?.email ?? "recipient";
  const recipient = contact ? `${contactLabel(contact)} <${contact.email ?? "no email"}>` : `contact #${draft.contact_id}`;

  const refresh = () => {
    setSubjectEdit(null);
    setBodyEdit(null);
    onChange();
  };

  const save = async () => {
    const wasApproved = draft.status === "approved";
    if (await run(() => api.drafts.edit(draft.id, { subject, body }))) {
      if (wasApproved) setVoided(true);
      toast(wasApproved ? "Saved. Approval cleared." : "Draft saved");
      refresh();
    }
  };

  const approve = async () => {
    if (await run(() => api.drafts.approve(draft.id))) {
      setVoided(false);
      refresh();
    }
  };

  const revise = async () => {
    if (await run(() => api.drafts.revise(draft.id, feedback.trim()))) {
      toast("Revised. Read it through, then approve again.");
      setFeedback("");
      setAsking(false);
      setVoided(draft.status === "approved");
      refresh();
    }
  };

  const undo = async () => {
    if (await run(() => api.drafts.undo(draft.id))) {
      toast("Went back to the earlier version");
      refresh();
    }
  };

  const copyNote = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast("Note copied");
    } catch {
      toast("Couldn't copy. Select the text and copy it", "error");
    }
  };

  const markSent = async () => {
    if (await run(() => api.drafts.markSent(draft.id))) {
      toast("Recorded as sent on LinkedIn");
      onSent?.();
      refresh();
    }
  };

  const revoke = async () => {
    if (await run(() => api.drafts.revoke(draft.id))) refresh();
  };

  const send = async () => {
    setConfirming(false);
    if (await run(() => api.drafts.send(draft.id))) {
      signal.pulse(holdRef.current); // the light travels out from the control that sent it
      setSweep((n) => n + 1);
      onSent?.();
      refresh();
    }
  };

  return (
    <Card className="space-y-4" data-draft-id={draft.id} data-status={draft.status}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {heading && <span className="font-medium text-heading">{heading}</span>}
          {isNote ? <Pill tone="indigo">LinkedIn note</Pill> : <ApprovalRail status={draft.status} />}
        </div>
        <div className="flex gap-1.5">
          {draft.generated_by_ai && <Pill>AI-written</Pill>}
          {dnc && <Pill tone="rose">Do not contact</Pill>}
        </div>
      </div>

      <p className="text-sm text-body">
        <span className="text-faint">To </span>
        <span className="text-heading">{contact ? contactLabel(contact) : `Contact #${draft.contact_id}`}</span>
        {isNote ? (
          linkedin ? (
            <a href={linkedin} target="_blank" rel="noopener noreferrer" className="ml-2 text-[0.82rem] text-body hover:text-heading hover:underline">
              Open their LinkedIn ↗
            </a>
          ) : (
            <span className="ml-2 text-[0.82rem] text-faint">no LinkedIn link saved</span>
          )
        ) : contact?.email ? (
          <span className="ml-2 font-mono text-[0.82rem] text-body">{contact.email}</span>
        ) : (
          <span className="ml-2 text-[0.82rem] text-danger">no email address</span>
        )}
      </p>

      {!isNote && (
        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubjectEdit(e.target.value)} disabled={locked} />
        </Field>
      )}
      <Field label={isNote ? "Note" : "Body"}>
        <Textarea value={body} onChange={(e) => setBodyEdit(e.target.value)} disabled={locked} rows={isNote ? 5 : 9} />
        {isNote && (
          <span aria-live="polite" className={`mt-1 block text-right font-mono text-xs ${body.length > NOTE_LIMIT ? "text-danger" : "text-faint"}`}>
            {body.length}/{NOTE_LIMIT}
            {body.length > NOTE_LIMIT ? " · too long for LinkedIn" : ""}
          </span>
        )}
      </Field>

      {!locked && (
        <div className="space-y-2 rounded-xl border border-hairline bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-center gap-2">
            {!asking && (
              <Button small onClick={() => setAsking(true)} disabled={busy}>
                Ask for changes
              </Button>
            )}
            {draft.history.length > 0 && (
              <Button small variant="ghost" onClick={undo} disabled={busy}>
                Undo last change
              </Button>
            )}
            {draft.history.length > 0 && (
              <button type="button" aria-expanded={earlier} onClick={() => setEarlier(!earlier)} className="text-xs text-body hover:text-heading hover:underline">
                {earlier ? "Hide" : "Show"} earlier versions ({draft.history.length})
              </button>
            )}
          </div>
          {asking && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void revise();
              }}
            >
              <label className="block text-xs text-body" htmlFor={`fb-${draft.id}`}>
                What should change? Plain words are fine.
              </label>
              <Textarea id={`fb-${draft.id}`} rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. shorter, and mention that we run it at DTU in March" maxLength={1000} disabled={busy} />
              <div className="flex flex-wrap gap-1.5">
                {QUICK.map((q) => (
                  <button key={q} type="button" disabled={busy} onClick={() => setFeedback(feedback.trim() ? `${feedback.trim()}. ${q}` : q)} className="rounded-full border border-hairline px-2.5 py-1 text-xs text-body transition-colors hover:border-white/30 hover:text-heading">
                    {q}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="primary" small disabled={busy || dirty || feedback.trim().length < 2} title={dirty ? "Save or discard your own edits first" : undefined}>
                  {busy ? "Revising…" : "Revise with AI"}
                </Button>
                <Button type="button" small variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
                  Close
                </Button>
                <span aria-live="polite" className="text-xs text-faint">
                  {busy ? "This can take about 20 seconds." : dirty ? "Save or discard your edits first." : "The earlier wording is kept, so you can undo."}
                </span>
              </div>
            </form>
          )}
          {earlier && draft.history.length > 0 && (
            <ol className="space-y-1.5 border-t border-hairline pt-2 text-xs text-body">
              {[...draft.history].reverse().map((h) => (
                <li key={h.at}>
                  <span className="text-faint">{fmtDateTime(h.at)} · you asked: </span>“{h.feedback}”
                  <span className="mt-0.5 block text-faint">Before that: {h.body.slice(0, 120)}{h.body.length > 120 ? "…" : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {draft.last_error && <ErrorNote message={`Last send failed: ${draft.last_error}`} />}
      <ErrorNote message={error} />

      {draft.status === "sent" ? (
        <p className="text-sm text-body">
          {isNote ? "Sent on LinkedIn" : "Sent"} {fmtDateTime(draft.sent_at)}
          {isNote ? " · by hand" : draft.approved_by && <> · approved by {draft.approved_by}</>}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          {dirty && (
            <Button variant="primary" disabled={busy || !subject.trim() || !body.trim()} onClick={save}>
              Save changes
            </Button>
          )}
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setSubjectEdit(null);
                setBodyEdit(null);
              }}
            >
              Discard
            </Button>
          )}

          {isNote && (
            <>
              <Button variant="primary" disabled={busy || dirty || !body.trim()} onClick={copyNote} title={dirty ? "Save your changes first" : undefined}>
                Copy note
              </Button>
              <Button disabled={busy || dirty || dnc || body.length > NOTE_LIMIT} onClick={markSent} title="Click after you've pasted and sent it on LinkedIn. Nothing is sent from here.">
                I sent it on LinkedIn
              </Button>
              <span className="text-xs text-faint">Paste it into LinkedIn yourself. Nothing is sent from here.</span>
            </>
          )}
          {!isNote && draft.status === "draft" && (
            <Button
              variant={dirty ? "secondary" : "primary"}
              disabled={busy || dirty || dnc || !contact?.email}
              title={dirty ? "Save your changes first" : dnc ? "This contact is do-not-contact" : !contact?.email ? "Add an email address first" : undefined}
              onClick={approve}
            >
              Approve
            </Button>
          )}

          {!isNote && draft.status === "approved" && !dirty && (
            <>
              <HoldToSend
                recipient={email}
                buttonRef={holdRef}
                busy={busy || draft.status !== "approved"}
                disabled={dnc}
                onHoldComplete={send}
                onConfirmRequest={() => setConfirming(true)}
              />
              <Button variant="ghost" disabled={busy} onClick={revoke}>
                Revoke approval
              </Button>
            </>
          )}

          {!isNote && draft.status === "approved" && !dirty && (
            <span className="text-xs text-faint">
              Approved by {draft.approved_by}. Editing clears the approval.
            </span>
          )}
          {draft.status === "approved" && dirty && (
            <span className="text-xs text-faint">Save to apply your edit. That clears the approval.</span>
          )}
          {draft.status === "draft" && voided && !dirty && (
            <span className="text-xs text-body">Edited. Needs approval again.</span>
          )}
        </div>
      )}

      {/* One soft sweep across the card when an email goes out. */}
      <AnimatePresence>
        {sweep > 0 && !reduce && (
          <motion.div
            key={sweep}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent"
              initial={{ x: "-60%" }}
              animate={{ x: "260%" }}
              transition={{ duration: 0.9, ease: [0.33, 1, 0.68, 1] }}
              onAnimationComplete={() => setSweep(0)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirming && (
          <ConfirmDialog
            title={`Send this email to ${recipient}?`}
            confirmLabel="Send"
            confirmVariant="ember"
            busy={busy}
            onConfirm={send}
            onCancel={() => setConfirming(false)}
          >
            <p className="text-heading">{draft.subject}</p>
            <p className="mt-1 text-faint">Once sent, it can&apos;t be recalled.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </Card>
  );
}
