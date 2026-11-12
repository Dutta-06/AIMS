/**
 * Import and export the outreach tracker as CSV (the shape of the team's Google Sheet).
 *
 * Design rules:
 *  - Preview and commit run the *same* plan, so what you review is what gets saved.
 *  - Re-importing is safe: people are matched (LinkedIn link, then email, then name within the
 *    company) and updated instead of duplicated.
 *  - By default an import only fills blanks and moves a status *forward* (never regresses a lead,
 *    never overwrites what someone typed in the app). `overwrite` makes the sheet authoritative.
 *  - Anything the importer had to guess is flagged on its row.
 */
import { CHANNELS } from "../types";
import type { Channel, ImportPreview, ImportRow, Status } from "../types";
import type { Core } from "./core";
import { invalid } from "./errors";
import { parseCsv, writeCsv } from "./csv";
import { normalise } from "./rules";

export const MAX_ROWS = 5000;
const PREVIEW_ROWS = 2000;

/** Columns that name a teammate are known but not imported (leads aren't assigned to people). */
const UNUSED = new Set(["name", "owner", "assigned to", "assignee", "handled by", "teammate", "member"]);
const ALIASES: Record<string, string[]> = {
  company: ["company name", "company", "organisation", "organization"],
  person: ["point of contact", "contact person", "person", "poc", "contact name"],
  contact: ["contact", "linkedin", "linkedin url", "profile", "link"],
  email: ["email", "e mail", "email address"],
  role: ["position", "role", "title", "designation", "job title"],
  status: ["status"],
  remarks: ["remarks", "remark", "notes", "comments"],
  channels: ["channels", "channel"],
};

const group = (words: string[], status: Status): [string, Status][] => words.map((w) => [w, status]);
const STATUS_WORDS = new Map<string, Status>([
  ...group(["", "not contacted", "new", "todo", "to do", "pending"], "not_contacted"),
  ...group(["contacted", "reached", "reached out", "sent", "messaged"], "contacted"),
  ...group(["responded", "replied", "response", "responded yes"], "responded"),
  ...group(["no response", "no reply", "not responded", "no resp", "ghosted"], "no_response"),
]);

/** Only strong phrases count as evidence that we already reached out. "Mail: x@y.com" is an
 * address, not proof of an email, and "also Discord" is a hint, not a message. */
const INFER: [Channel, RegExp][] = [
  ["linkedin", /linkedin\s*(request|message|dm|connect)|(connection\s*)?request\s*sent|connection\s*sent/i],
  ["email", /\b(e-?mail|mail)(ed)?\s*sent\b|\bemailed\b|\bmailed\b/i],
  ["discord", /discord\s*(dm|message)|(dm|messag)\w*\s*(on|via)?\s*discord/i],
  ["personal", /\bin person\b|\bpersonal(ly)?\b|\bwhatsapp\b/i],
];
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/[^\s,;]+/i;
const EMAIL_RE = /[\p{L}\p{N}_.+'-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu;
const emailsIn = (s: string): string[] => Array.from(s.match(EMAIL_RE) ?? []);

// ------------------------------------------------------------------ normalisation
export const normCompany = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

export function normLinkedin(url: string): string {
  let u = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  u = u.split("?")[0].split("#")[0];
  return u.replace(/\/+$/, "").toLowerCase();
}

const statusOf = (text: string): Status | null => STATUS_WORDS.get(text.trim().toLowerCase().replace(/[\s_-]+/g, " ")) ?? null;

// ------------------------------------------------------------------ parsing
export type ParsedRow = {
  line: number;
  company: string;
  name: string | null;
  email: string | null;
  linkedin: string | null;
  role: string | null;
  status: Status;
  channels: Channel[];
  remarks: string | null;
  warnings: string[];
  skip_reason: string | null;
};

function readTable(text: string): { header: string[]; body: string[][] } {
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) throw invalid("The file is empty");
  const rows = parseCsv(clean).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) throw invalid("I need a header row and at least one data row");
  if (rows.length - 1 > MAX_ROWS) throw invalid(`That's more than ${MAX_ROWS} rows; split the file`);
  return { header: rows[0], body: rows.slice(1) };
}

function mapHeaders(header: string[]): { cols: Record<string, number>; ignored: string[] } {
  const cols: Record<string, number> = {};
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const key = h.toLowerCase().replace(/[\W_]+/g, " ").trim();
    const field = Object.entries(ALIASES).find(([f, names]) => names.includes(key) && !(f in cols))?.[0];
    if (field) cols[field] = i;
    else if (h.trim() && !UNUSED.has(key)) ignored.push(h.trim());
  });
  if (!("company" in cols)) throw invalid("I couldn't find a company column (looked for COMPANY NAME or COMPANY)");
  return { cols, ignored };
}

export function parseRows(text: string, infer = true): { rows: ParsedRow[]; columns: Record<string, string>; ignored_columns: string[] } {
  const { header, body } = readTable(text);
  const { cols, ignored } = mapHeaders(header);
  const cell = (row: string[], f: string) => (f in cols && cols[f] < row.length ? row[cols[f]].trim() : "");
  const out: ParsedRow[] = [];

  body.forEach((row, idx) => {
    const line = idx + 2; // line 1 is the header
    const company = cell(row, "company").replace(/\s+/g, " ");
    const r: ParsedRow = {
      line,
      company,
      name: cell(row, "person") || null,
      email: null,
      linkedin: null,
      role: cell(row, "role") || null,
      status: "not_contacted",
      channels: [],
      remarks: cell(row, "remarks") || null,
      warnings: [],
      skip_reason: null,
    };
    if (!company) {
      out.push({ ...r, skip_reason: "No company on this row" });
      return;
    }

    // CONTACT is a LinkedIn link or an email (the sheet mixes both in one column)
    const raw = cell(row, "contact");
    const linkedin = LINKEDIN_RE.exec(raw);
    const emails = emailsIn(raw);
    if (linkedin) r.linkedin = linkedin[0];
    if (emails.length) r.email = emails[0].toLowerCase();
    if (raw && !(linkedin || emails.length)) {
      r.warnings.push(`Couldn't read the contact cell ('${raw.slice(0, 40)}'); kept it in remarks`);
      r.remarks = r.remarks ? `${r.remarks}\nContact: ${raw}` : `Contact: ${raw}`;
    }
    const emailCell = cell(row, "email");
    if (emailCell) {
      const found = emailsIn(emailCell);
      if (found.length) r.email = found[0].toLowerCase();
      else r.warnings.push(`Ignored an invalid email ('${emailCell.slice(0, 40)}')`);
    }

    // an address hiding in the remarks ("Mail: someone@company.com") when there is none yet
    if (!r.email && r.remarks) {
      const hidden = [...new Set(emailsIn(r.remarks).map((m) => m.toLowerCase()))];
      if (hidden.length === 1) {
        r.email = hidden[0];
        r.warnings.push(`Email ${hidden[0]} was taken from the remarks`);
      } else if (hidden.length > 1) r.warnings.push("Several emails in the remarks; add the right one by hand");
    }

    const statusText = cell(row, "status");
    let status = statusOf(statusText);
    if (status === null) {
      r.warnings.push(`Unknown status '${statusText}'; imported as Not contacted`);
      status = "not_contacted";
    }
    r.status = status;

    const channels: Channel[] = [];
    for (const token of cell(row, "channels").toLowerCase().split(/[,;/|\s]+/)) {
      if (token && (CHANNELS as readonly string[]).includes(token) && !channels.includes(token as Channel)) channels.push(token as Channel);
    }
    if (infer && r.remarks) {
      const hits = INFER.filter(([, rx]) => rx.test(r.remarks!)).map(([c]) => c);
      if (hits.length && r.status === "not_contacted") {
        r.status = "contacted";
        r.warnings.push(`Marked Contacted because the remarks say so (${hits.join(", ")})`);
      }
      if (r.status !== "not_contacted") for (const h of hits) if (!channels.includes(h)) channels.push(h);
    }
    r.channels = r.status !== "not_contacted" ? channels : [];
    out.push(r);
  });
  return { rows: out, columns: Object.fromEntries(Object.entries(cols).map(([f, i]) => [f, header[i]])), ignored_columns: ignored };
}

// ------------------------------------------------------------------ planning
type Rec = {
  id: number | null;
  name: string | null;
  email: string | null;
  linkedin: string | null;
  role: string | null;
  status: Status;
  channels: Channel[];
  remarks: string | null;
  first_line: number | null; // set for contacts created by this file
};

export type PlannedRow = ImportRow & { contact_id: number | null; company_key: string; values: Record<string, unknown> };
export type Plan = {
  rows: PlannedRow[];
  new_companies: Map<string, string>; // key -> display name
  columns: Record<string, string>;
  ignored_columns: string[];
};

export function summary(plan: Plan): ImportPreview["summary"] {
  const counts = { create: 0, update: 0, unchanged: 0, skip: 0 };
  for (const r of plan.rows) counts[r.action] += 1;
  return { rows: plan.rows.length, ...counts, new_companies: plan.new_companies.size };
}

function find(recs: Rec[], row: ParsedRow): Rec | null {
  if (row.linkedin) {
    const want = normLinkedin(row.linkedin);
    const hit = recs.find((r) => r.linkedin && normLinkedin(r.linkedin) === want);
    if (hit) return hit;
  }
  if (row.email) {
    const hit = recs.find((r) => r.email && r.email.toLowerCase() === row.email);
    if (hit) return hit;
  }
  if (row.name) return recs.find((r) => r.name && r.name.toLowerCase() === row.name!.toLowerCase()) ?? null;
  return null;
}

/** What should change on an existing lead. Fill blanks; only move a status forward. */
function merge(rec: Rec, row: ParsedRow, overwrite: boolean): { values: Record<string, unknown>; notes: string[] } {
  const values: Record<string, unknown> = {};
  const notes: string[] = [];
  const put = (attr: "name" | "email" | "linkedin" | "role" | "remarks", label: string) => {
    const next = row[attr];
    const old = rec[attr];
    if (next === null || next === "" || next === old) return;
    if (old === null || old === "" || overwrite) {
      values[attr] = next;
      notes.push(`${label}: ${old || "—"} → ${next}`);
      rec[attr] = next;
    }
  };
  put("name", "name");
  put("email", "email");
  put("linkedin", "LinkedIn");
  put("role", "role");
  put("remarks", "remarks");
  if (row.status !== rec.status) {
    const advance = rec.status === "not_contacted" && row.status !== "not_contacted";
    if (advance || (overwrite && row.status !== "not_contacted")) {
      notes.push(`status: ${rec.status} → ${row.status}`);
      values.status = row.status;
      rec.status = row.status;
    }
  }
  const merged = rec.status !== "not_contacted" ? [...new Set([...rec.channels, ...row.channels])] : [];
  if (merged.join() !== rec.channels.join()) {
    notes.push(`channels: ${rec.channels.join(", ") || "—"} → ${merged.join(", ") || "—"}`);
    values.channels = merged;
    rec.channels = merged;
  }
  return { values, notes };
}

export function planImport(core: Core, text: string, overwrite = false, infer = true): Plan {
  const { rows: parsed, columns, ignored_columns } = parseRows(text, infer);
  const companies = new Map(core.db.companies.map((c) => [normCompany(c.name), c]));
  const recs = new Map<string, Rec[]>();
  for (const [key, comp] of companies) {
    recs.set(
      key,
      core.db.contacts
        .filter((c) => c.company_id === comp.id)
        .map((c) => ({ id: c.id, name: c.name, email: c.email, linkedin: c.linkedin, role: c.role, status: c.status, channels: [...c.channels], remarks: c.remarks, first_line: null })),
    );
  }
  const newCompanies = new Map<string, string>();
  const rows: PlannedRow[] = [];

  for (const p of parsed) {
    const base = { contact_id: null, company_key: "", values: {} };
    if (p.skip_reason) {
      rows.push({ line: p.line, action: "skip", company: "", company_new: false, name: null, status: "not_contacted", channels: [], warnings: [], reason: p.skip_reason, changes: [], ...base });
      continue;
    }
    const key = normCompany(p.company);
    const isNew = !companies.has(key) && !newCompanies.has(key);
    if (isNew) {
      newCompanies.set(key, p.company);
      recs.set(key, []);
    }
    const row: PlannedRow = {
      line: p.line,
      action: "unchanged",
      company: p.company,
      company_new: isNew,
      name: p.name,
      status: p.status,
      channels: p.channels,
      warnings: [...p.warnings],
      reason: null,
      changes: [],
      ...base,
      company_key: key,
    };
    if (!(p.name || p.email || p.linkedin)) {
      row.reason = "No person on this row";
      row.action = isNew ? "create" : "unchanged";
      if (isNew) row.changes = ["new company"];
      rows.push(row);
      continue;
    }
    const list = recs.get(key)!;
    const rec = find(list, p);
    if (rec === null) {
      list.push({ id: null, name: p.name, email: p.email, linkedin: p.linkedin, role: p.role, status: p.status, channels: [...p.channels], remarks: p.remarks, first_line: p.line });
      row.action = "create";
      row.values = { name: p.name, email: p.email, linkedin: p.linkedin, role: p.role, status: p.status, channels: [...p.channels], remarks: p.remarks };
      row.changes = [isNew ? "new company, new contact" : "new contact"];
    } else if (rec.first_line !== null) {
      row.action = "skip";
      row.reason = `Same person as line ${rec.first_line}`;
    } else {
      row.contact_id = rec.id;
      const { values, notes } = merge(rec, p, overwrite);
      row.values = values;
      row.changes = notes;
      row.action = Object.keys(values).length ? "update" : "unchanged";
    }
    rows.push(row);
  }
  return { rows, new_companies: newCompanies, columns, ignored_columns };
}

export function previewOf(plan: Plan): ImportPreview {
  const strip = ({ contact_id, company_key, values, ...rest }: PlannedRow): ImportRow => {
    void contact_id;
    void company_key;
    void values;
    return rest;
  };
  return {
    summary: summary(plan),
    rows: plan.rows.slice(0, PREVIEW_ROWS).map(strip),
    truncated: plan.rows.length > PREVIEW_ROWS,
    columns: plan.columns,
    ignored_columns: plan.ignored_columns,
  };
}

/** Save the plan. All or nothing: if anything fails the data is left exactly as it was. */
export function applyPlan(core: Core, plan: Plan): ImportPreview["summary"] {
  const snapshot = structuredClone(core.db);
  const saved = core.onChange;
  core.onChange = () => {}; // save once, at the end
  try {
    const ids = new Map(core.db.companies.map((c) => [normCompany(c.name), c.id]));
    for (const [key, name] of plan.new_companies) ids.set(key, core.createCompany({ name, source: "CSV import" }).id);
    for (const row of plan.rows) {
      const v = row.values as Record<string, never>;
      if (row.action === "create" && Object.keys(v).length) {
        core.createContact({ company_id: ids.get(row.company_key)!, ...(v as object) });
      } else if (row.action === "update" && row.contact_id !== null) {
        const c = core.requireContact(row.contact_id);
        Object.assign(c, v);
        normalise(c);
        core.updateContact(c.id, {}); // fills the follow-up clock if it is now contacted, and re-checks
      }
    }
  } catch (e) {
    core.db = snapshot;
    throw e;
  } finally {
    core.onChange = saved;
  }
  core.changed();
  return summary(plan);
}

// ------------------------------------------------------------------ export
const LABEL: Record<Status, string> = { not_contacted: "", contacted: "Contacted", responded: "Responded", no_response: "No response" };
export const EXPORT_HEADER = ["COMPANY NAME", "POINT OF CONTACT", "CONTACT", "POSITION", "STATUS", "REMARKS", "EMAIL", "CHANNELS"];

export function exportCsv(core: Core): string {
  const rows = core.listContacts().map((c) => [
    c.company_name,
    c.name ?? "",
    c.linkedin ?? c.email ?? "",
    c.role ?? "",
    LABEL[c.status],
    c.remarks ?? "",
    c.email ?? "",
    c.channels.join(", "),
  ]);
  return writeCsv([EXPORT_HEADER, ...rows]);
}
