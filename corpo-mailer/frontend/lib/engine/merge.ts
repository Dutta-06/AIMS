/**
 * Merging two people's edits to the shared data.
 *
 * Three copies are compared: `base` (what this browser last saved or loaded), `local` (what is on
 * screen now) and `remote` (what the shared file holds now). Whatever changed since `base` is what
 * this person did; it is laid over `remote`, so nobody's work is thrown away:
 *
 *  - Every record (company, lead, draft, interaction) is merged on its own. If both people edited the
 *    same record, the later edit wins. Different records never conflict.
 *  - Deleting leaves a small tombstone, so a teammate's older copy can't bring the record back.
 *  - A sent email stays sent, whatever else a teammate's copy says.
 *  - Settings merge field by field; each person's mailbox position stays their own.
 *  - If two people added the same company or lead at the same moment, the duplicate is folded in.
 *
 * Pure: nothing here touches the network or the screen.
 */
import type { Company } from "../types";
import type { DB, DraftRow, Tombstones } from "./model";

type Rec = { id: number; updated_at?: string; created_at?: string; occurred_at?: string };
type Kind = keyof Tombstones;
const COLLECTIONS = [
  ["company", "companies"],
  ["contact", "contacts"],
  ["draft", "drafts"],
  ["interaction", "interactions"],
] as const;

const TOMBSTONE_DAYS = 180;

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Stable text for a value, ignoring `updated_at`: "did anything really change?" */
export function canon(v: unknown): string {
  return JSON.stringify(v, (k, val: unknown) => {
    if (k === "updated_at") return undefined;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return val;
  });
}

/** Same shared content (ignoring edit stamps and each person's own mailbox position)? */
export function sameData(a: DB, b: DB): boolean {
  const pick = (d: DB) => ({ c: d.companies, k: d.contacts, i: d.interactions, d: d.drafts, s: d.settings, t: d.tombstones });
  return canon(pick(a)) === canon(pick(b));
}

const ts = (r: Rec) => r.updated_at ?? r.created_at ?? r.occurred_at ?? "";

/** Mark what this person changed since `base`: new/changed records get an edit time, vanished ones a tombstone. */
function stamp(local: DB, base: DB, now: string) {
  for (const [kind, key] of COLLECTIONS) {
    const baseById = new Map((base[key] as Rec[]).map((r) => [r.id, r]));
    const seen = new Set<number>();
    for (const r of local[key] as Rec[]) {
      seen.add(r.id);
      const b = baseById.get(r.id);
      if (b && canon(r) === canon(b)) continue;
      // Keep an edit time the app already set when it is newer than the one we started from.
      if (!(r.updated_at && r.updated_at > (b?.updated_at ?? ""))) r.updated_at = now;
    }
    for (const id of baseById.keys()) if (!seen.has(id)) local.tombstones[kind][id] ??= now;
  }
}

function pickDraft(l: DraftRow, r: DraftRow): DraftRow {
  if (l.status === "sent" || r.status === "sent") {
    if (l.status !== r.status) return l.status === "sent" ? l : r;
    return (l.sent_at ?? "") < (r.sent_at ?? "") ? l : r; // the first send is the one that happened
  }
  if (l.status === "sending" && r.status === "sending" && l.claimed_by !== r.claimed_by) {
    // Two people pressed Send at once: the earlier claim keeps it, the other must stand down.
    const a = `${l.claimed_at ?? ""}|${l.claimed_by ?? ""}`;
    const b = `${r.claimed_at ?? ""}|${r.claimed_by ?? ""}`;
    return a <= b ? l : r;
  }
  return ts(l) > ts(r) ? l : r;
}

function mergeCollection<T extends Rec>(kind: Kind, local: T[], remote: T[], tomb: Tombstones[Kind], pick: (l: T, r: T) => T): T[] {
  const l = new Map(local.map((x) => [x.id, x]));
  const r = new Map(remote.map((x) => [x.id, x]));
  const out: T[] = [];
  for (const id of new Set([...r.keys(), ...l.keys()])) {
    const a = l.get(id);
    const b = r.get(id);
    const chosen = a && b ? pick(a, b) : (a ?? b)!;
    const t = tomb[id];
    if (t) {
      if (t >= ts(chosen)) continue; // deleted after its last edit
      delete tomb[id]; // edited after the deletion: it's back
    }
    out.push(chosen);
  }
  void kind;
  return out;
}

/** Combine `local` (what's on screen) with `remote` (what the shared file holds). `base` is what
 * this browser last agreed with the file on; without it nothing is stamped and the later edit wins. */
export function reconcile(base: DB | null, localIn: DB, remote: DB, now: string, me: string): DB {
  const local = clone(localIn);
  if (base) stamp(local, base, now);
  const out = clone(remote);

  // Deletions: everyone's tombstones count; old ones are dropped.
  const cutoff = new Date(Date.parse(now) - TOMBSTONE_DAYS * 86_400_000).toISOString();
  for (const [kind] of COLLECTIONS) {
    const merged: Record<string, string> = { ...remote.tombstones[kind] };
    for (const [id, at] of Object.entries(local.tombstones[kind])) if (!(merged[id] >= at)) merged[id] = at;
    for (const id of Object.keys(merged)) if (merged[id] < cutoff) delete merged[id];
    out.tombstones[kind] = merged;
  }

  out.companies = mergeCollection("company", local.companies, remote.companies, out.tombstones.company, (a, b) => (ts(a) > ts(b) ? a : b));
  out.contacts = mergeCollection("contact", local.contacts, remote.contacts, out.tombstones.contact, (a, b) => (ts(a) > ts(b) ? a : b));
  out.drafts = mergeCollection("draft", local.drafts, remote.drafts, out.tombstones.draft, pickDraft);
  out.interactions = mergeCollection("interaction", local.interactions, remote.interactions, out.tombstones.interaction, (a, b) => (ts(a) > ts(b) ? a : b));

  foldDuplicates(out, now);
  dropOrphans(out, now);

  // Settings: a field this person changed is theirs; otherwise the file's value stands.
  out.settings = clone(remote.settings);
  if (base) {
    for (const k of Object.keys(local.settings) as (keyof DB["settings"])[]) {
      if (canon(local.settings[k]) !== canon(base.settings[k])) (out.settings as Record<string, unknown>)[k] = local.settings[k];
    }
  }

  out.mailbox = clone(local.mailbox);
  out.mailboxes = { ...remote.mailboxes, [me]: clone(local.mailbox) };
  out.seq = {
    company: Math.max(local.seq.company, remote.seq.company),
    contact: Math.max(local.seq.contact, remote.seq.contact),
    interaction: Math.max(local.seq.interaction, remote.seq.interaction),
    draft: Math.max(local.seq.draft, remote.seq.draft),
  };
  return out;
}

const first = <T extends Rec>(a: T, b: T) => (ts2(a) < ts2(b) || (ts2(a) === ts2(b) && a.id < b.id) ? a : b);
const ts2 = (r: Rec) => r.created_at ?? r.occurred_at ?? "";

/** Two people adding the same company (same name) or the same lead (same company and email) at the
 * same moment leaves twins. Keep the older, move everything onto it, and tombstone the other. */
function foldDuplicates(db: DB, now: string) {
  const companyOf = new Map<number, number>();
  const byName = new Map<string, Company>();
  for (const c of db.companies) {
    const key = c.name.trim().toLowerCase();
    const keeper = byName.get(key);
    if (!keeper) byName.set(key, c);
    else byName.set(key, first(keeper, c));
  }
  for (const c of db.companies) {
    const keeper = byName.get(c.name.trim().toLowerCase())!;
    if (keeper.id !== c.id) {
      companyOf.set(c.id, keeper.id);
      db.tombstones.company[c.id] = now;
    }
  }
  if (companyOf.size) {
    db.companies = db.companies.filter((c) => !companyOf.has(c.id));
    for (const c of db.contacts) c.company_id = companyOf.get(c.company_id) ?? c.company_id;
  }

  const contactOf = new Map<number, number>();
  const byEmail = new Map<string, (typeof db.contacts)[number]>();
  for (const c of db.contacts) {
    if (!c.email) continue;
    const key = `${c.company_id}|${c.email.toLowerCase()}`;
    const keeper = byEmail.get(key);
    byEmail.set(key, keeper ? first(keeper, c) : c);
  }
  for (const c of db.contacts) {
    if (!c.email) continue;
    const keeper = byEmail.get(`${c.company_id}|${c.email.toLowerCase()}`)!;
    if (keeper.id !== c.id) {
      contactOf.set(c.id, keeper.id);
      db.tombstones.contact[c.id] = now;
    }
  }
  if (contactOf.size) {
    db.contacts = db.contacts.filter((c) => !contactOf.has(c.id));
    for (const i of db.interactions) i.contact_id = contactOf.get(i.contact_id) ?? i.contact_id;
    for (const d of db.drafts) d.contact_id = contactOf.get(d.contact_id) ?? d.contact_id;
  }
}

/** Anything whose company or lead was deleted goes with it. */
function dropOrphans(db: DB, now: string) {
  const companies = new Set(db.companies.map((c) => c.id));
  db.contacts = db.contacts.filter((c) => {
    if (companies.has(c.company_id)) return true;
    db.tombstones.contact[c.id] = now;
    return false;
  });
  const contacts = new Set(db.contacts.map((c) => c.id));
  db.interactions = db.interactions.filter((i) => {
    if (contacts.has(i.contact_id)) return true;
    db.tombstones.interaction[i.id] = now;
    return false;
  });
  db.drafts = db.drafts.filter((d) => {
    if (contacts.has(d.contact_id)) return true;
    db.tombstones.draft[d.id] = now;
    return false;
  });
}
