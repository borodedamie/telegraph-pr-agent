import { describe, expect, it } from "vitest";
import { stubAnswer } from "../../src/stub.js";
import { Answer, ChangeItem } from "../../src/types.js";

const source = {
  id: "s1",
  type: "release" as const,
  url: "https://github.com/colinhacks/zod/releases/tag/v4.0.0",
  retrievedAt: "2026-11-03T12:00:00.000Z",
  versionFrom: "3.25.76",
  versionTo: "4.0.0",
  contentHash: "a".repeat(64),
  snapshotKey: `snap:${"a".repeat(64)}`,
  trust: "official" as const,
};

const item = {
  id: "c1",
  kind: "breaking" as const,
  version: "4.0.0",
  evidenceType: "documented" as const,
  change: "String formats moved to top level",
  excerpt: "String format validators moved to the top level.",
  inferredFrom: [],
  migration: "Use z.email() instead of z.string().email()",
  migrationEvidence: "documented" as const,
  migrationExcerpt: "Use `z.email()` instead of `z.string().email()`.",
  migrationSourceId: "s1",
  migrationInferredFrom: [],
  ids: [],
  sourceId: "s1",
};

function found(overrides: Partial<Answer> = {}) {
  return {
    ...stubAnswer(),
    outcome: "found" as const,
    coverage: { complete: true, covered: ["4.0.0"], notCovered: [] },
    changes: [item],
    sources: [source],
    ...overrides,
  };
}

describe("Answer schema", () => {
  it("accepts the stub answer", () => {
    expect(Answer.safeParse(stubAnswer()).success).toBe(true);
  });

  it("accepts a found answer whose references all resolve", () => {
    expect(Answer.safeParse(found()).success).toBe(true);
  });

  it("rejects a dangling sourceId", () => {
    const result = Answer.safeParse(found({ sources: [] }));
    expect(result.success).toBe(false);
  });

  it("requires coverage on found answers", () => {
    expect(Answer.safeParse(found({ coverage: null })).success).toBe(false);
  });
});

describe("ChangeItem schema", () => {
  it("requires a migration excerpt for a documented migration", () => {
    expect(ChangeItem.safeParse({ ...item, migrationExcerpt: null }).success).toBe(false);
  });

  it("requires evidence ids for an inferred migration", () => {
    expect(
      ChangeItem.safeParse({ ...item, migrationEvidence: "inferred", migrationExcerpt: null, migrationSourceId: null })
        .success
    ).toBe(false);
  });

  it("requires migration to be null exactly for manual_review", () => {
    expect(
      ChangeItem.safeParse({ ...item, migrationEvidence: "manual_review", migrationExcerpt: null, migrationSourceId: null })
        .success
    ).toBe(false);
    expect(
      ChangeItem.safeParse({
        ...item,
        migration: null,
        migrationEvidence: "manual_review",
        migrationExcerpt: null,
        migrationSourceId: null,
      }).success
    ).toBe(true);
  });
});
