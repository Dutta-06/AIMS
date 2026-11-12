/**
 * Where the data lives: one JSON file in the app's private Drive folder ("appDataFolder"). Only this
 * app can see that folder, it doesn't show up in the person's Drive, and removing the app's access
 * at myaccount.google.com/permissions deletes it.
 */
import type { GoogleAuth } from "./auth";
import { google } from "./api";
import type { Fetcher } from "./api";

const FILE_NAME = "corpo-mailer-data.json";

export interface DriveFile {
  id: string;
  modifiedTime: string;
}

export interface DriveLike {
  find(): Promise<DriveFile | null>;
  read(id: string): Promise<string>;
  create(json: string): Promise<DriveFile>;
  update(id: string, json: string): Promise<DriveFile>;
}

export class DriveStore implements DriveLike {
  constructor(
    private auth: GoogleAuth,
    private fetchImpl: Fetcher = (...a) => fetch(...a),
  ) {}

  async find(): Promise<DriveFile | null> {
    const q = encodeURIComponent(`name='${FILE_NAME}'`);
    const res = await google(this.auth, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=1`, {}, this.fetchImpl);
    const body = (await res.json()) as { files?: DriveFile[] };
    return body.files?.[0] ?? null;
  }

  async read(id: string): Promise<string> {
    const res = await google(this.auth, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {}, this.fetchImpl);
    return res.text();
  }

  async create(json: string): Promise<DriveFile> {
    const boundary = "corpo" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const res = await google(
      this.auth,
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime",
      { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
      this.fetchImpl,
    );
    return (await res.json()) as DriveFile;
  }

  async update(id: string, json: string): Promise<DriveFile> {
    const res = await google(
      this.auth,
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: json },
      this.fetchImpl,
    );
    return (await res.json()) as DriveFile;
  }
}
