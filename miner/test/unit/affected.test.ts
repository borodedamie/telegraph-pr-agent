import { describe, expect, it } from "vitest";
import { isAffected } from "../../src/affected.js";

const semverRange = (...events: Record<string, string>[]) => ({ type: "SEMVER", events });

describe("isAffected", () => {
  it("walks every interval of a range: fixed in one line, affected again in a later one", () => {
    const advisory = {
      affectedVersions: [],
      ranges: [semverRange({ introduced: "1.0.0" }, { fixed: "1.0.6" }, { introduced: "3.0.0" }, { fixed: "3.0.3" })],
    };
    expect(isAffected(advisory, "1.0.5")).toBe("yes");
    expect(isAffected(advisory, "1.0.6")).toBe("no");
    expect(isAffected(advisory, "2.0.0")).toBe("no");
    expect(isAffected(advisory, "3.0.1")).toBe("yes");
    expect(isAffected(advisory, "3.0.3")).toBe("no");
  });

  it("sorts events before walking them", () => {
    const advisory = { affectedVersions: [], ranges: [semverRange({ fixed: "3.0.3" }, { introduced: "3.0.0" }, { fixed: "1.0.6" }, { introduced: "1.0.0" })] };
    expect(isAffected(advisory, "3.0.1")).toBe("yes");
    expect(isAffected(advisory, "2.0.0")).toBe("no");
  });

  it('treats introduced "0" as the lowest version without passing it to semver', () => {
    const advisory = { affectedVersions: [], ranges: [semverRange({ introduced: "0" }, { fixed: "0.2.4" })] };
    expect(isAffected(advisory, "0.0.1")).toBe("yes");
    expect(isAffected(advisory, "0.2.4")).toBe("no");
  });

  it("includes last_affected and excludes fixed", () => {
    const lastAffected = { affectedVersions: [], ranges: [semverRange({ introduced: "4.0.0" }, { lastAffected: "4.5.1" })] };
    expect(isAffected(lastAffected, "4.5.1")).toBe("yes");
    expect(isAffected(lastAffected, "4.5.2")).toBe("no");
    const fixed = { affectedVersions: [], ranges: [semverRange({ introduced: "4.0.0" }, { fixed: "4.17.21" })] };
    expect(isAffected(fixed, "4.17.20")).toBe("yes");
    expect(isAffected(fixed, "4.17.21")).toBe("no");
  });

  it("caps the whole range at limit", () => {
    const advisory = { affectedVersions: [], ranges: [semverRange({ introduced: "0" }, { limit: "2.0.0" })] };
    expect(isAffected(advisory, "1.9.9")).toBe("yes");
    expect(isAffected(advisory, "2.0.0")).toBe("no");
    expect(isAffected(advisory, "5.0.0")).toBe("no");
  });

  it("reads a versions-only record as complete data", () => {
    const advisory = { affectedVersions: ["1.2.3", "1.2.4"], ranges: [] };
    expect(isAffected(advisory, "1.2.4")).toBe("yes");
    expect(isAffected(advisory, "1.2.5")).toBe("no");
  });

  it("answers unknown when only an unusable range is there", () => {
    expect(isAffected({ affectedVersions: [], ranges: [{ type: "GIT", events: [{ introduced: "abc123" }] }] }, "1.0.0")).toBe("unknown");
    expect(isAffected({ affectedVersions: [], ranges: [semverRange({ introduced: "not-a-version" })] }, "1.0.0")).toBe("unknown");
    expect(isAffected({ affectedVersions: [], ranges: [] }, "1.0.0")).toBe("unknown");
  });

  it("compares prereleases in version order", () => {
    const advisory = { affectedVersions: [], ranges: [semverRange({ introduced: "0" }, { fixed: "4.0.0-beta.2" })] };
    expect(isAffected(advisory, "4.0.0-beta.1")).toBe("yes");
    expect(isAffected(advisory, "4.0.0")).toBe("no");
  });
});
