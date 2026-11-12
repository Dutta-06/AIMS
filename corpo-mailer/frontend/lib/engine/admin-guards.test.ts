import { afterEach, describe, expect, it } from "vitest";
import { api } from "../api";
import { App, setApp } from "./app";
import { ApiError } from "./errors";
import { emptyDb } from "./model";

const as = (email: string | null) => {
  const a = new App();
  a.state = { ...a.state, email };
  setApp(a);
  return a;
};
const status = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
};
afterEach(() => setApp(null));

describe("only the admins can use the team controls, even past the screen", () => {
  it("a non-admin is refused the settings, the team's keys, backups and sharing", async () => {
    const a = as("ben@gmail.com");
    expect(a.isAdmin()).toBe(false);
    expect(await status(api.settings.get())).toBe(403);
    expect(await status(api.settings.update({ team_ai_keys: "sk-x" }))).toBe(403);
    expect(await status(api.backup.export())).toBe(403);
    expect(await status(api.backup.restore(JSON.stringify({ ...emptyDb() })))).toBe(403);
    expect(await status(a.shareWith("cy@gmail.com"))).toBe(403);
    expect(() => a.restoreBackup(emptyDb())).toThrow(/Only the team admins/);
  });

  it("someone not signed in is refused too", async () => {
    as(null);
    expect(await status(api.settings.get())).toBe(403);
  });

  it("an admin gets past the check (and then meets the normal rules, such as being signed in)", async () => {
    const a = as("Odwitiyo.Dutta@gmail.com");
    expect(a.isAdmin()).toBe(true);
    expect(await status(api.settings.get())).toBe(401); // not past the sign-in, but not "admins only"
    expect(await status(a.shareWith("cy@gmail.com"))).toBe(409); // no workspace open
  });
});
