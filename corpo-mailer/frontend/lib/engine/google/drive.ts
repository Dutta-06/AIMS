/**
 * Where the data lives: one JSON file in Google Drive that the whole team shares.
 *
 * The app asks for Google's `drive` permission so that a teammate who has been added to the file can
 * simply sign in and have the app find it (the narrower `drive.file` permission would make every
 * teammate pick the file by hand). The app only ever looks for, reads and writes that one file.
 */
import type { GoogleAuth } from "./auth";
import { google } from "./api";
import type { Fetcher } from "./api";

export const WORKSPACE_FILE_NAME = "Corpo Mailer shared data";
const API = "https://www.googleapis.com/drive/v3/files";

export interface DriveFile {
  id: string;
  name?: string;
  modifiedTime: string;
  /** Drive's counter that goes up on every change; used to notice a teammate's save. */
  version: string;
}

export type Collaborator = { email: string; name: string | null; role: string };

export interface DriveLike {
  /** The team's file, if this account owns it or has been added to it (newest first if there are several). */
  find(name: string): Promise<DriveFile | null>;
  meta(id: string): Promise<DriveFile>;
  read(id: string): Promise<string>;
  create(name: string, json: string): Promise<DriveFile>;
  update(id: string, json: string): Promise<DriveFile>;
  /** Give a teammate edit access (Google emails them a link). */
  share(id: string, email: string): Promise<void>;
  collaborators(id: string): Promise<Collaborator[]>;
}

const FIELDS = "id,name,modifiedTime,version";

export class DriveStore implements DriveLike {
  constructor(
    private auth: GoogleAuth,
    private fetchImpl: Fetcher = (...a) => fetch(...a),
  ) {}

  async find(name: string): Promise<DriveFile | null> {
    const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
    const res = await google(this.auth, `${API}?q=${q}&orderBy=modifiedTime%20desc&pageSize=10&fields=files(${FIELDS})`, {}, this.fetchImpl);
    const body = (await res.json()) as { files?: DriveFile[] };
    return body.files?.[0] ?? null;
  }

  async meta(id: string): Promise<DriveFile> {
    const res = await google(this.auth, `${API}/${encodeURIComponent(id)}?fields=${FIELDS}`, {}, this.fetchImpl);
    return (await res.json()) as DriveFile;
  }

  async read(id: string): Promise<string> {
    const res = await google(this.auth, `${API}/${encodeURIComponent(id)}?alt=media`, {}, this.fetchImpl);
    return res.text();
  }

  async create(name: string, json: string): Promise<DriveFile> {
    const boundary = "corpo" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, mimeType: "application/json" });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const res = await google(
      this.auth,
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}`,
      { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
      this.fetchImpl,
    );
    return (await res.json()) as DriveFile;
  }

  async update(id: string, json: string): Promise<DriveFile> {
    const res = await google(
      this.auth,
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: json },
      this.fetchImpl,
    );
    return (await res.json()) as DriveFile;
  }

  async share(id: string, email: string): Promise<void> {
    await google(
      this.auth,
      `${API}/${encodeURIComponent(id)}/permissions?sendNotificationEmail=true&fields=id`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }) },
      this.fetchImpl,
    );
  }

  async collaborators(id: string): Promise<Collaborator[]> {
    const res = await google(this.auth, `${API}/${encodeURIComponent(id)}/permissions?fields=permissions(emailAddress,displayName,role,type)&pageSize=100`, {}, this.fetchImpl);
    const body = (await res.json()) as { permissions?: { emailAddress?: string; displayName?: string; role: string; type: string }[] };
    return (body.permissions ?? [])
      .filter((p) => p.type === "user" && p.emailAddress)
      .map((p) => ({ email: p.emailAddress!.toLowerCase(), name: p.displayName ?? null, role: p.role }));
  }
}
