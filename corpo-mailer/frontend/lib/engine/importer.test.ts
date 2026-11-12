import { beforeEach, describe, expect, it } from "vitest";
import { Core } from "./core";
import { parseCsv, sniffDelimiter, writeCsv } from "./csv";
import { applyPlan, exportCsv, MAX_ROWS, parseRows, planImport, previewOf } from "./importer";

const SHEET = `NAME,COMPANY NAME,POINT OF CONTACT,CONTACT,POSITION,STATUS,REMARKS
harshit,Orbit AI,Ana Lopez,https://www.linkedin.com/in/ana-lopez-123/,Founder/CEO,,linkedin request
Ritwik,Lumen Labs,Ben Ito,https://www.linkedin.com/in/benito/,CEO,,
Sidharth,Quill,Cara Nwosu,https://www.linkedin.com/in/cnwosu7/,Co-Founder,Contacted,
Shivansh,Nimbus,Dev Rao,https://www.linkedin.com/in/devrao/,Co-Founder,,mail sent
Abhinash,Globex,Eli Park,https://www.linkedin.com/in/elipark/,Community Manager,,V imp to note in the proposal
Abhinash,Globex,Fay Stone,https://www.linkedin.com/in/faystone-68420713/,University Relations Lead,Responded,
Piyush,Initech,Gus Mehta,https://www.linkedin.com/in/gusm/,DevRel,,request sent
,Palisade Networks,Hal Verma,https://www.linkedin.com/in/halv/,Director,,Actually the partnerships team handles this
Harshit,Firebrand,Ivy Chan,https://www.linkedin.com/in/ivychan/,Chief Growth Officer,No response,Also Discord
,Rivet,,opensource@rivet.example,,,
Ritwik,Tandem AI,Jon Ved,https://www.linkedin.com/in/jonved/,CEO,,Mail: jon.ved@tandem.example
`;

let clock = new Date("2026-03-10T10:00:00Z");
let core: Core;
let saves = 0;
beforeEach(() => {
  saves = 0;
  core = new Core(undefined, () => clock, () => (saves += 1));
});

const rows = (text = SHEET, infer = true) => {
  const r = parseRows(text, infer);
  const by = new Map(r.rows.map((x) => [`${x.company}|${x.name ?? ""}`, x]));
  return { ...r, get: (company: string, name = "") => by.get(`${company}|${name}`)! };
};
const preview = (text = SHEET, overwrite = false) => previewOf(planImport(core, text, overwrite));
const commit = (text = SHEET, overwrite = false) => applyPlan(core, planImport(core, text, overwrite));
const lead = (name: string) => core.listContacts().find((c) => c.name === name)!;
const throwsMsg = (fn: () => unknown, re: RegExp) => expect(fn).toThrow(re);

describe("reading the CSV text", () => {
  it("handles quotes, doubled quotes and line breaks inside a cell", () => {
    expect(parseCsv('a,"b, c","say ""hi""","line1\nline2"\n1,2,3,4\n')).toEqual([
      ["a", "b, c", 'say "hi"', "line1\nline2"],
      ["1", "2", "3", "4"],
    ]);
  });
  it("copes with Windows newlines, a missing final newline and empty cells", () => {
    expect(parseCsv("a,b\r\n,x\r\ny,")).toEqual([["a", "b"], ["", "x"], ["y", ""]]);
  });
  it("finds the separator", () => {
    expect(sniffDelimiter("a;b;c\n1,2,3")).toBe(";");
    expect(sniffDelimiter("a\tb\tc")).toBe("\t");
    expect(sniffDelimiter('"a;b",c,d\n')).toBe(",");
    expect(sniffDelimiter("single")).toBe(",");
  });
  it("writes only the quotes it needs", () => {
    expect(writeCsv([["a", "b,c", 'd"e', "f\ng"]])).toBe('a,"b,c","d""e","f\ng"\r\n');
  });
});

describe("parsing the sheet", () => {
  it("maps the headers the way the sheet uses them", () => {
    const { columns, ignored_columns } = rows();
    expect(columns).toEqual({ company: "COMPANY NAME", person: "POINT OF CONTACT", contact: "CONTACT", role: "POSITION", status: "STATUS", remarks: "REMARKS" });
    expect(ignored_columns).toEqual([]); // the teammate NAME column is skipped quietly
  });

  it("reports unrecognised columns instead of dropping them silently", () => {
    const text = SHEET.replace("REMARKS", "REMARKS,PRIORITY").replace("linkedin request", "linkedin request,high");
    expect(rows(text).ignored_columns).toEqual(["PRIORITY"]);
  });

  it("reads the contact cell as a LinkedIn link or an email", () => {
    const r = rows();
    const ana = r.get("Orbit AI", "Ana Lopez");
    expect([ana.linkedin, ana.email]).toEqual(["https://www.linkedin.com/in/ana-lopez-123/", null]);
    const rivet = r.get("Rivet");
    expect([rivet.email, rivet.linkedin, rivet.name]).toEqual(["opensource@rivet.example", null, null]);
  });

  it("lowercases an email wherever it appears (contact cell, email column, remarks)", () => {
    const r = parseRows("COMPANY,PERSON,CONTACT,EMAIL,REMARKS\nA,One,Info@Rivet.Example,,\nB,Two,,Two@B.COM,\nC,Three,,,Mail: Boss@C.Org\n").rows;
    expect(r.map((x) => x.email)).toEqual(["info@rivet.example", "two@b.com", "boss@c.org"]);
  });

  it("reads statuses in the sheet's words", () => {
    const r = rows();
    expect(r.get("Quill", "Cara Nwosu").status).toBe("contacted");
    expect(r.get("Globex", "Fay Stone").status).toBe("responded");
    expect(r.get("Firebrand", "Ivy Chan").status).toBe("no_response");
    expect(r.get("Lumen Labs", "Ben Ito").status).toBe("not_contacted");
  });

  it("infers 'contacted' from strong remarks and flags it", () => {
    const r = rows();
    const ana = r.get("Orbit AI", "Ana Lopez");
    expect([ana.status, ana.channels]).toEqual(["contacted", ["linkedin"]]);
    expect(ana.warnings.some((w) => w.includes("remarks say so"))).toBe(true);
    expect(r.get("Nimbus", "Dev Rao").channels).toEqual(["email"]);
    expect(r.get("Initech", "Gus Mehta").channels).toEqual(["linkedin"]);
  });

  it("does not treat weak hints as having reached out", () => {
    const r = rows();
    for (const [c, n] of [["Globex", "Eli Park"], ["Palisade Networks", "Hal Verma"]]) expect(r.get(c, n).status).toBe("not_contacted");
    expect(r.get("Firebrand", "Ivy Chan").channels).not.toContain("discord");
  });

  it("uses an email hidden in the remarks, and flags it", () => {
    const jon = rows().get("Tandem AI", "Jon Ved");
    expect(jon.email).toBe("jon.ved@tandem.example");
    expect(jon.warnings.some((w) => w.includes("taken from the remarks"))).toBe(true);
    expect(jon.status).toBe("not_contacted"); // "Mail: addr" is an address, not "mail sent"
  });

  it("can have inference switched off", () => {
    const r = rows(SHEET, false);
    expect(r.get("Orbit AI", "Ana Lopez").status).toBe("not_contacted");
    expect(r.get("Nimbus", "Dev Rao").channels).toEqual([]);
  });

  it("flags an unknown status and keeps an unreadable contact cell in the remarks", () => {
    const [r] = parseRows("COMPANY NAME,POINT OF CONTACT,CONTACT,STATUS\nAcme,Zed,call his PA,Maybe later\n").rows;
    expect(r.status).toBe("not_contacted");
    expect(r.warnings.some((w) => w.includes("Unknown status"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("kept it in remarks"))).toBe(true);
    expect(r.remarks).toBe("Contact: call his PA");
  });

  it("honours explicit channel and email columns", () => {
    const [r] = parseRows('COMPANY,PERSON,EMAIL,STATUS,CHANNELS\nAcme,Zed,Zed@Acme.com,Contacted,"email, Discord; fax"\n').rows;
    expect([r.email, r.channels]).toEqual(["zed@acme.com", ["email", "discord"]]); // 'fax' is dropped
  });

  it("drops channels for someone not contacted", () => {
    expect(parseRows("COMPANY,PERSON,STATUS,CHANNELS\nAcme,Zed,,email\n").rows[0].channels).toEqual([]);
  });

  it.each([";", "\t"])("copes with %j separators, a byte-order mark and Windows newlines", (sep) => {
    const text = "﻿" + SHEET.replaceAll(",", sep).replaceAll("\n", "\r\n");
    const r = parseRows(text);
    expect(r.rows).toHaveLength(11);
    expect(r.rows[0].company).toBe("Orbit AI");
  });

  it.each([
    ["", /empty/],
    ["COMPANY NAME,STATUS\n", /header row and at least one/],
    ["NAME,POSITION\nharshit,CEO\n", /company column/],
  ])("explains an unusable file (%j)", (text, re) => throwsMsg(() => parseRows(text), re));

  it("refuses too many rows", () => {
    const big = "COMPANY NAME,POINT OF CONTACT\n" + Array.from({ length: MAX_ROWS + 1 }, (_, i) => `C${i},P${i}`).join("\n");
    throwsMsg(() => parseRows(big), /more than/);
  });

  it("skips a row with no company, saying why", () => {
    const { rows: r } = parseRows("COMPANY NAME,POINT OF CONTACT\n,Orphan\nAcme,Real\n");
    expect(r[0].skip_reason).toBe("No company on this row");
    expect(r[1].company).toBe("Acme");
  });
});

describe("preview and commit", () => {
  it("preview saves nothing", () => {
    const p = preview();
    expect(p.summary).toEqual({ rows: 11, create: 11, update: 0, unchanged: 0, skip: 0, new_companies: 10 });
    expect([core.db.companies.length, core.db.contacts.length, saves]).toEqual([0, 0, 0]);
  });

  it("commit does what the preview said", () => {
    const planned = preview().summary;
    expect(commit()).toEqual(planned);
    expect(core.db.companies).toHaveLength(10);
    expect(core.db.contacts).toHaveLength(11); // Globex has two people
    const ana = lead("Ana Lopez");
    expect([ana.status, ana.channels, ana.role]).toEqual(["contacted", ["linkedin"], "Founder/CEO"]);
    expect(core.listContacts().find((c) => c.company_name === "Rivet")!.email).toBe("opensource@rivet.example");
    expect(lead("Eli Park").remarks).toBe("V imp to note in the proposal");
    expect(core.db.companies.every((c) => c.source === "CSV import")).toBe(true);
  });

  it("saves once, not once per row", () => {
    commit();
    expect(saves).toBe(1);
  });

  it("starts the follow-up clock for rows that were already contacted (the sheet has no date)", () => {
    commit();
    expect(lead("Cara Nwosu").last_contacted_at).toBe(clock.toISOString());
    expect(lead("Ben Ito").last_contacted_at).toBeNull();
  });

  it("importing twice changes nothing", () => {
    commit();
    const again = preview().summary;
    expect([again.create, again.update, again.skip, again.new_companies, again.unchanged]).toEqual([0, 0, 0, 0, 11]);
    commit();
    expect(core.db.contacts).toHaveLength(11);
  });

  it("a re-import moves status forward and fills blanks", () => {
    commit();
    const updated = SHEET.replace("Ritwik,Lumen Labs,Ben Ito,https://www.linkedin.com/in/benito/,CEO,,", "Ritwik,Lumen Labs,Ben Ito,https://www.linkedin.com/in/benito,CEO,Responded,Met at expo");
    const p = preview(updated);
    const ben = p.rows.find((r) => r.name === "Ben Ito")!;
    expect(ben.action).toBe("update"); // matched despite the trailing slash
    expect(ben.changes).toEqual(expect.arrayContaining(["status: not_contacted → responded", "remarks: — → Met at expo"]));
    expect([p.summary.update, p.summary.create]).toEqual([1, 0]);
    commit(updated);
    expect([lead("Ben Ito").status, lead("Ben Ito").remarks]).toEqual(["responded", "Met at expo"]);
  });

  it("by default never overwrites work done in the app", () => {
    commit();
    core.updateContact(lead("Cara Nwosu").id, { status: "responded", remarks: "Call booked" });
    commit(SHEET); // the sheet still says Contacted, with no remarks
    expect([lead("Cara Nwosu").status, lead("Cara Nwosu").remarks]).toEqual(["responded", "Call booked"]);
  });

  it("by default keeps what is in the app even when the sheet says something different", () => {
    const sheet = (remark: string, role: string) => `COMPANY NAME,POINT OF CONTACT,POSITION,REMARKS\nAcme,Pat,${role},${remark}\n`;
    commit(sheet("Our note", "CTO"));
    commit(sheet("Different note from the sheet", "VP Eng"));
    expect([lead("Pat").remarks, lead("Pat").role]).toEqual(["Our note", "CTO"]);
    commit(sheet("Different note from the sheet", "VP Eng"), true); // ...unless the sheet is authoritative
    expect([lead("Pat").remarks, lead("Pat").role]).toEqual(["Different note from the sheet", "VP Eng"]);
  });

  it("matches a LinkedIn link whatever tracking text, slash or www is on it (when there is no name)", () => {
    commit("COMPANY NAME,CONTACT\nAcme,https://www.linkedin.com/in/pat/\n");
    const p = preview("COMPANY NAME,CONTACT\nAcme,https://linkedin.com/in/pat?trk=abc#top\n");
    expect([p.summary.create, p.summary.skip]).toEqual([0, 0]); // found, not duplicated
    expect(p.rows[0].action).toBe("unchanged");
  });

  it("overwrite mode makes the sheet authoritative", () => {
    commit();
    core.updateContact(lead("Cara Nwosu").id, { status: "responded" });
    commit(SHEET, true);
    expect(lead("Cara Nwosu").status).toBe("contacted");
  });

  it("imports the same person twice in one file once", () => {
    const dup = SHEET + "Ritwik,Lumen Labs,Ben Ito,https://linkedin.com/in/benito?trk=x,CEO,,\n";
    const p = preview(dup);
    expect(p.summary.skip).toBe(1);
    expect(p.rows.find((r) => r.action === "skip")!.reason).toBe("Same person as line 3");
  });

  it("finds existing people by email, then by name, ignoring company spacing and case", () => {
    const co = core.createCompany({ name: "ACME  Corp" });
    const a = core.createContact({ company_id: co.id, name: "Old Name", email: "pat@acme.com" });
    const b = core.createContact({ company_id: co.id, name: "Sam Roe" });
    const text = "COMPANY NAME,POINT OF CONTACT,EMAIL,POSITION\nacme corp,Pat Q,pat@acme.com,CTO\nAcme Corp,sam roe,,Lead\n";
    const r = commit(text);
    expect([r.create, r.update, r.new_companies]).toEqual([0, 2, 0]);
    expect([core.getContact(a.id).role, core.getContact(b.id).role]).toEqual(["CTO", "Lead"]);
  });

  it("a company-only row creates just the company", () => {
    const text = "COMPANY NAME,POINT OF CONTACT\nSolo Inc,\n";
    const r = commit(text);
    expect([r.new_companies, core.db.contacts.length]).toEqual([1, 0]);
    expect(preview(text).summary.new_companies).toBe(0);
  });

  it("bad files give a readable error and change nothing", () => {
    throwsMsg(() => preview("NAME,POSITION\nharshit,CEO\n"), /company column/);
    throwsMsg(() => commit(""), /empty/);
    expect(core.db.companies).toHaveLength(0);
  });

  it("is all-or-nothing: a row that can't be saved leaves the data exactly as it was", () => {
    core.createCompany({ name: "Keep" });
    const before = JSON.stringify(core.db);
    const tooLong = "x".repeat(300);
    const text = `COMPANY NAME,POINT OF CONTACT\nFine Co,Good Person\nOther Co,${tooLong}\n`;
    expect(() => commit(text)).toThrow(/too long/);
    expect(JSON.stringify(core.db)).toBe(before);
  });

  it("caps the preview at 2000 rows but still plans them all", () => {
    const body = Array.from({ length: 2100 }, (_, i) => `C${i},P${i}`).join("\n");
    const p = preview("COMPANY NAME,POINT OF CONTACT\n" + body);
    expect([p.rows.length, p.truncated, p.summary.create]).toEqual([2000, true, 2100]);
  });

  it("does not expose the plan's private bookkeeping to the screens", () => {
    const row = preview().rows[0] as unknown as Record<string, unknown>;
    for (const k of ["contact_id", "company_key", "values"]) expect(row).not.toHaveProperty(k);
  });
});

describe("export", () => {
  it("has the sheet's columns first and readable status labels", () => {
    commit();
    const lines = exportCsv(core).split("\r\n");
    expect(lines[0]).toBe("COMPANY NAME,POINT OF CONTACT,CONTACT,POSITION,STATUS,REMARKS,EMAIL,CHANNELS");
    expect(lines.some((l) => l.startsWith("Orbit AI,Ana Lopez,https://www.linkedin.com/in/ana-lopez-123/,Founder/CEO,Contacted"))).toBe(true);
    expect(lines.some((l) => l.includes(",Responded,"))).toBe(true);
    expect(lines.some((l) => l.includes(",No response,"))).toBe(true);
  });

  it("exporting then importing is a no-op", () => {
    commit();
    const s = preview(exportCsv(core)).summary;
    expect([s.create, s.update, s.skip, s.new_companies, s.unchanged]).toEqual([0, 0, 0, 0, 11]);
  });

  it("exporting into a fresh database recreates the same people", () => {
    commit();
    const exported = exportCsv(core);
    core = new Core(undefined, () => clock);
    commit(exported);
    expect(core.db.contacts).toHaveLength(11);
    const ana = lead("Ana Lopez");
    expect([ana.status, ana.channels]).toEqual(["contacted", ["linkedin"]]);
    expect(lead("Jon Ved").email).toBe("jon.ved@tandem.example");
  });

  it("quotes remarks that contain commas, quotes and line breaks, and they survive a round trip", () => {
    const co = core.createCompany({ name: "Acme, Inc." });
    core.createContact({ company_id: co.id, name: 'Zed "Z" Q', remarks: "line one\nline two, with comma" });
    const text = exportCsv(core);
    core = new Core(undefined, () => clock);
    commit(text);
    const z = core.listContacts()[0];
    expect([z.company_name, z.name, z.remarks]).toEqual(["Acme, Inc.", 'Zed "Z" Q', "line one\nline two, with comma"]);
  });
});
