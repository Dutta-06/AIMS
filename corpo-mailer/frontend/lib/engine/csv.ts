/** A small CSV reader and writer (RFC 4180 quoting; comma, semicolon or tab separated). */

const DELIMITERS = [",", ";", "\t"];

/** Pick the separator the first line uses most (ignoring anything inside quotes). */
export function sniffDelimiter(text: string): string {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text.slice(0, 4096)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  for (const [d, n] of counts) if (n > counts.get(best)!) best = d;
  return best;
}

export function parseCsv(text: string, delimiter = sniffDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false; // has this row got anything yet (so a trailing newline doesn't add a row)
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
      started = true;
    } else if (ch === delimiter) {
      endField();
      started = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (started || field !== "") endRow();
    } else {
      field += ch;
      started = true;
    }
  }
  if (started || field !== "") endRow();
  return rows;
}

export function writeCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
