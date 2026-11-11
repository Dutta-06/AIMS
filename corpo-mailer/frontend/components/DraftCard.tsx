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
import { fmtDateTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Contact, Draft } from "@/lib/types";

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
  const { busy, error, run } = useAction();

  const subject = subjectEdit ?? draft.subject;
  const body = bodyEdit ?? draft.body;
  const locked = draft.status === "sent" || draft.status === "sending";
  const dirty = subject !== draft.subject || body !== draft.body;
  const dnc = contact?.do_not_contact ?? false;
  const recipient = contact ? `${contact.name} <${contact.email}>` : `contact #${draft.contact_id}`;
  const email = contact?.email ?? "recipient";

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
          <ApprovalRail status={draft.status} />
        </div>
        <div className="flex gap-1.5">
          {draft.generated_by_ai && <Pill>AI-written</Pill>}
          {dnc && <Pill tone="rose">Do not contact</Pill>}
        </div>
      </div>

      <p className="text-sm text-body">
        <span className="text-faint">To </span>
        <span className="text-heading">{contact?.name ?? `Contact #${draft.contact_id}`}</span>
        {contact && <span className="ml-2 font-mono text-[0.82rem] text-body">{contact.email}</span>}
      </p>

      <Field label="Subject">
        <Input value={subject} onChange={(e) => setSubjectEdit(e.target.value)} disabled={locked} />
      </Field>
      <Field label="Body">
        <Textarea value={body} onChange={(e) => setBodyEdit(e.target.value)} disabled={locked} rows={9} />
      </Field>

      {draft.last_error && <ErrorNote message={`Last send failed: ${draft.last_error}`} />}
      <ErrorNote message={error} />

      {draft.status === "sent" ? (
        <p className="text-sm text-body">
          Sent {fmtDateTime(draft.sent_at)}
          {draft.approved_by && <> · approved by {draft.approved_by}</>}
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

          {draft.status === "draft" && (
            <Button
              variant={dirty ? "secondary" : "primary"}
              disabled={busy || dirty || dnc}
              title={dirty ? "Save your changes first" : dnc ? "This contact is do-not-contact" : undefined}
              onClick={approve}
            >
              Approve
            </Button>
          )}

          {draft.status === "approved" && !dirty && (
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

          {draft.status === "approved" && !dirty && (
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
