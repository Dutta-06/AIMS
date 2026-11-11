"use client";

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { Button, ChannelPicker, ErrorNote, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { STATUSES, type Channel, type Company, type Status } from "@/lib/types";

const NEW = "__new__";

/** The form inside the "Add a lead" sheet. A lead is one person (or inbox) at a company. */
export default function AddLead({
  companies,
  onDone,
  onClose,
}: {
  companies: Company[];
  onDone: (id: number) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [companyId, setCompanyId] = useState(companies[0] ? String(companies[0].id) : NEW);
  const [newCompany, setNewCompany] = useState("");
  const [f, setF] = useState({ name: "", email: "", linkedin: "", role: "", remarks: "" });
  const [status, setStatus] = useState<Status>("not_contacted");
  const [channels, setChannels] = useState<Channel[]>([]);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let created: number | null = null;
    const ok = await run(async () => {
      let cid = Number(companyId);
      if (companyId === NEW) cid = (await api.companies.create({ name: newCompany.trim() })).id;
      const c = await api.contacts.create({
        company_id: cid,
        name: f.name,
        email: f.email,
        linkedin: f.linkedin,
        role: f.role,
        status,
        channels: status === "not_contacted" ? [] : channels,
        remarks: f.remarks,
      });
      created = c.id;
    });
    if (ok && created !== null) {
      toast("Lead added");
      onDone(created);
      onClose();
    }
  }

  const identified = f.name.trim() || f.email.trim() || f.linkedin.trim();
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col gap-4">
      <Field label="Company">
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW}>+ A new company…</option>
        </Select>
      </Field>
      {companyId === NEW && (
        <Field label="New company name">
          <Input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} required autoFocus />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={f.name} onChange={set("name")} autoFocus={companyId !== NEW} />
        </Field>
        <Field label="Position">
          <Input value={f.role} onChange={set("role")} placeholder="e.g. DevRel" />
        </Field>
      </div>
      <Field label="LinkedIn link">
        <Input value={f.linkedin} onChange={set("linkedin")} placeholder="https://linkedin.com/in/…" />
      </Field>
      <Field label="Email">
        <Input type="email" value={f.email} onChange={set("email")} className="font-mono text-[0.85rem]" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {status !== "not_contacted" && (
        <Field label="Reached by">
          <ChannelPicker value={channels} onChange={setChannels} />
        </Field>
      )}
      <Field label="Remarks">
        <Textarea value={f.remarks} onChange={set("remarks")} rows={3} />
      </Field>
      {!identified && <p className="text-xs text-faint">Give them a name, an email or a LinkedIn link.</p>}
      <ErrorNote message={error} />
      <div className="mt-auto flex gap-2 pt-2">
        <Button type="submit" variant="primary" disabled={busy || !identified || (companyId === NEW && !newCompany.trim())} className="flex-1">
          {busy ? "Adding…" : "Add lead"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
