"use client";

import { useState } from "react";
import { Button, Card, ErrorNote, Field, Input, Pill, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Contact, Draft } from "@/lib/types";

const STATUS_TONE = { draft: "amber", approved: "indigo", sending: "muted", sent: "green" } as const;
const STATUS_LABEL = {
  draft: "Needs review",
  approved: "Approved, not sent",
  sending: "Sending…",
  sent: "Sent",
} as const;

/**
 * One outgoing email. Approving and sending are two separate, deliberate clicks, and the send
 * button states the exact recipient. The server enforces the same rules; this is just the UI.
 */
export default function DraftCard({
  draft,
  contact,
  heading,
  onChange,
}: {
  draft: Draft;
  contact?: Contact;
  heading?: string;
  onChange: () => void;
}) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const { busy, error, run } = useAction();

  const locked = draft.status === "sent" || draft.status === "sending";
  const dirty = subject !== draft.subject || body !== draft.body;
  const to = contact ? `${contact.name} <${contact.email}>` : `contact #${draft.contact_id}`;

  const act = async (fn: () => Promise<unknown>) => {
    if (await run(fn)) onChange();
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {heading && <span className="font-medium">{heading}</span>}
        <Pill tone={STATUS_TONE[draft.status]}>{STATUS_LABEL[draft.status]}</Pill>
        {draft.generated_by_ai && <Pill>AI-written</Pill>}
        {contact?.do_not_contact && <Pill tone="rose">Do not contact</Pill>}
        <span className="ml-auto text-xs text-muted">To: {to}</span>
      </div>

      <Field label="Subject">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={locked} />
      </Field>
      <Field label="Body">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={locked} rows={9} />
      </Field>

      {draft.last_error && <ErrorNote message={`Last send failed: ${draft.last_error}`} />}
      <ErrorNote message={error} />

      {draft.status === "sent" ? (
        <p className="text-xs text-muted">
          Sent {fmtDateTime(draft.sent_at)}
          {draft.approved_by && <> · approved by {draft.approved_by}</>}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Button
              variant="primary"
              disabled={busy || !subject.trim() || !body.trim()}
              onClick={() => act(() => api.drafts.edit(draft.id, { subject, body }))}
            >
              Save changes
            </Button>
          )}
          {draft.status === "draft" && (
            <Button
              variant={dirty ? "secondary" : "primary"}
              disabled={busy || dirty || contact?.do_not_contact}
              title={dirty ? "Save your changes first" : undefined}
              onClick={() => act(() => api.drafts.approve(draft.id))}
            >
              Approve
            </Button>
          )}
          {draft.status === "approved" && (
            <>
              <Button
                variant="primary"
                disabled={busy || dirty}
                onClick={() => {
                  if (window.confirm(`Send this email to ${to}?\n\nSubject: ${draft.subject}`)) {
                    void act(() => api.drafts.send(draft.id));
                  }
                }}
              >
                Send to {contact?.email ?? "recipient"}
              </Button>
              <Button disabled={busy} onClick={() => act(() => api.drafts.revoke(draft.id))}>
                Revoke approval
              </Button>
            </>
          )}
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setSubject(draft.subject);
                setBody(draft.body);
              }}
            >
              Discard edits
            </Button>
          )}
          {draft.status === "approved" && (
            <span className="text-xs text-muted">
              Approved by {draft.approved_by}. Editing voids the approval.
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
