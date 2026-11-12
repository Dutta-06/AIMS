import { describe, expect, it } from "vitest";
import { adminList, DEFAULT_ADMINS, isAdmin } from "./admin";

describe("who the admins are", () => {
  it("are the two named addresses by default", () => {
    expect(DEFAULT_ADMINS).toEqual(["odwitiyo.dutta@gmail.com", "aims@dtu.ac.in"]);
    expect(adminList(undefined)).toEqual(DEFAULT_ADMINS);
    expect(adminList("  ")).toEqual(DEFAULT_ADMINS);
  });

  it("can be replaced by a setting, in any separator and case", () => {
    expect(adminList("A@x.com, b@y.org;  C@z.io")).toEqual(["a@x.com", "b@y.org", "c@z.io"]);
  });

  it("recognises an admin whatever the letter case or stray spaces", () => {
    expect(isAdmin("odwitiyo.dutta@gmail.com")).toBe(true);
    expect(isAdmin("AIMS@DTU.AC.IN")).toBe(true);
    expect(isAdmin("  aims@dtu.ac.in ")).toBe(true);
  });

  it("refuses everyone else, and nobody", () => {
    expect(isAdmin("someone@gmail.com")).toBe(false);
    expect(isAdmin("aims@dtu.ac.in.evil.com")).toBe(false);
    expect(isAdmin("xaims@dtu.ac.in")).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin("")).toBe(false);
  });

  it("uses a list you pass instead of the default", () => {
    expect(isAdmin("a@x.com", ["a@x.com"])).toBe(true);
    expect(isAdmin("aims@dtu.ac.in", ["a@x.com"])).toBe(false);
  });
});
