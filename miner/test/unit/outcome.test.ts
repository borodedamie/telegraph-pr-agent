import { describe, expect, it } from "vitest";
import { confidence, selectOutcome } from "../../src/outcome.js";
import type { ChangeItem } from "../../src/types.js";

const complete = { complete: true, covered: ["4.0.0"], notCovered: [] };
const partial = { complete: false, covered: ["4.0.0"], notCovered: [{ version: "3.25.0", reason: "budget" as const }] };
const item = (evidenceType: ChangeItem["evidenceType"]) => ({ evidenceType }) as ChangeItem;

describe("selectOutcome", () => {
  it("follows the lifecycle instead of assuming found", () => {
    expect(selectOutcome({ stage: "parse", kind: "out_of_scope" })).toBe("out_of_scope");
    expect(selectOutcome({ stage: "resolve", kind: "unknown_package" })).toBe("out_of_scope");
    expect(selectOutcome({ stage: "resolve", kind: "version_missing" })).toBe("not_found");
    expect(selectOutcome({ stage: "upstream_unavailable" })).toBe("temporarily_unavailable");
    expect(selectOutcome({ stage: "retrieved", coverage: complete, optionalSourceFailed: false })).toBe("found");
    expect(
      selectOutcome({ stage: "retrieved", coverage: { complete: false, covered: [], notCovered: [] }, optionalSourceFailed: false })
    ).toBe("not_found");
  });
});

describe("confidence", () => {
  const security = { status: "complete" as const };
  it("uses the fixed bands", () => {
    expect(confidence({ outcome: "found", coverage: complete, changes: [item("documented")], security })).toBe(0.9);
    expect(confidence({ outcome: "found", coverage: complete, changes: [], security })).toBe(0.9);
    expect(confidence({ outcome: "found", coverage: complete, changes: [item("inferred")], security })).toBe(0.7);
    expect(confidence({ outcome: "found", coverage: partial, changes: [], security })).toBe(0.5);
    expect(confidence({ outcome: "found", coverage: complete, changes: [], security }, false, true)).toBe(0.5);
    expect(confidence({ outcome: "not_found", coverage: null, changes: [], security })).toBe(0.8);
    expect(confidence({ outcome: "not_found", coverage: null, changes: [], security }, true)).toBe(0.6);
    expect(confidence({ outcome: "temporarily_unavailable", coverage: null, changes: [], security })).toBe(0);
  });

  it("subtracts 0.1 when the security check did not complete", () => {
    expect(confidence({ outcome: "found", coverage: complete, changes: [], security: { status: "partial" } })).toBe(0.8);
  });
});
