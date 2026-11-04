import { describe, expect, it } from "vitest";
import { CoverageTracker, releasesBetween } from "../../src/coverage.js";

const versions = ["0.9.0", "1.0.0", "1.1.0-beta.1", "1.1.0", "1.1.1", "2.0.0-rc.1", "2.0.0-rc.2", "2.0.0", "2.1.0"];

describe("releasesBetween", () => {
  it("includes every stable release with from < v <= to, minors and 0.x included", () => {
    expect(releasesBetween(versions, "0.9.0", "2.0.0")).toEqual(["1.0.0", "1.1.0", "1.1.1", "2.0.0"]);
  });

  it("includes the target line's prereleases only when the target is one", () => {
    expect(releasesBetween(versions, "1.1.1", "2.0.0-rc.2")).toEqual(["2.0.0-rc.1", "2.0.0-rc.2"]);
  });
});

describe("CoverageTracker", () => {
  it("reports releases without material as no_material and keeps other reasons", () => {
    const tracker = new CoverageTracker(["1.0.0", "1.1.0", "2.0.0"]);
    tracker.covered("2.0.0");
    tracker.notCovered("1.1.0", "unmatched");
    expect(tracker.missing()).toEqual(["1.0.0"]);
    expect(tracker.result()).toEqual({
      complete: false,
      covered: ["2.0.0"],
      notCovered: [
        { version: "1.0.0", reason: "no_material" },
        { version: "1.1.0", reason: "unmatched" },
      ],
    });
  });

  it("is complete when every release is covered", () => {
    const tracker = new CoverageTracker(["1.0.0"]);
    tracker.covered("1.0.0");
    tracker.notCovered("1.0.0", "truncated");
    expect(tracker.result().complete).toBe(true);
  });
});
