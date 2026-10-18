import { describe, expect, it } from "vitest";
import { scopedRestPath } from "./liferay";

// The company form of the path is what Liferay reports for EVERY Object,
// including the site-scoped ones — which is why this rule has to exist.
const GEAR = "/o/c/outfittergears";
const HIRES = "/o/c/outfitterhires";

describe("scopedRestPath", () => {
  it("leaves a company-scoped Object alone", () => {
    expect(scopedRestPath(HIRES, "company", "354702")).toBe(HIRES);
  });

  it("addresses a site-scoped Object through the site", () => {
    expect(scopedRestPath(GEAR, "site", "354702")).toBe(
      "/o/c/outfittergears/scopes/354702"
    );
  });

  it("treats a missing scope as company, so older portals still work", () => {
    expect(scopedRestPath(GEAR, undefined, "354702")).toBe(GEAR);
  });

  it("does not scope a path twice", () => {
    const already = "/o/c/outfittergears/scopes/354702";
    expect(scopedRestPath(already, "site", "999")).toBe(already);
  });

  it("leaves the path alone when there is no site to point at", () => {
    // Standalone dev harness: inventing a group id would 404 instead of 409,
    // which is a worse error to debug.
    expect(scopedRestPath(GEAR, "site", null)).toBe(GEAR);
  });
});
