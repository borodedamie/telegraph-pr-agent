import { describe, expect, it } from "vitest";
import type { Candidate } from "../../src/extract/candidate.js";
import { findSpan, verify, type VerifySource } from "../../src/extract/verify.js";
import type { Section } from "../../src/sources/github.js";
import { normalizeText } from "../../src/text.js";

const source = normalizeText(
  "## Breaking changes\r\n- `z.string().email()` is deprecated; use `z.email()` instead.   \r\n- Dropped support for Node 16 (CVE-2025-12345)\r\n"
);
const sections: Section[] = [{ version: "4.0.0", consulted: 0, text: source }];
const sources: VerifySource[] = [{ id: "s2", type: "release" }];

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    ref: "m1",
    section: 0,
    kind: "breaking",
    inferred: false,
    change: "Node 16 dropped",
    excerpt: "Dropped support for Node 16",
    inferredFrom: [],
    migration: null,
    migrationExcerpt: null,
    migrationInferredFrom: [],
    ...overrides,
  };
}

describe("findSpan", () => {
  it("passes an exact substring and fails a paraphrase", () => {
    expect(findSpan(source, "Dropped support for Node 16")).toBe("Dropped support for Node 16");
    expect(findSpan(source, "Node 16 is no longer supported")).toBeNull();
  });

  it("passes CRLF and NFC differences once the source is normalized", () => {
    const decomposed = normalizeText("Café removed\r\n");
    expect(findSpan(decomposed, "Café removed")).toBe("Café removed");
  });

  it("matches an excerpt that only lacks backticks and returns the original span", () => {
    expect(findSpan(source, "z.string().email() is deprecated; use z.email() instead.")).toBe(
      "`z.string().email()` is deprecated; use `z.email()` instead."
    );
  });
});

describe("verify", () => {
  it("keeps a verified item as documented, with its version, source and advisory ids", () => {
    const { items } = verify([candidate({ excerpt: "Dropped support for Node 16 (CVE-2025-12345)" })], sections, sources);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "c1", version: "4.0.0", sourceId: "s2", evidenceType: "documented", ids: ["CVE-2025-12345"] });
  });

  it("drops an item without an excerpt unless it is inferred from a kept item", () => {
    const { items, dropped } = verify(
      [
        candidate({ ref: "m1" }),
        candidate({ ref: "m2", excerpt: null }),
        candidate({ ref: "m3", inferred: true, excerpt: null, inferredFrom: ["m1"], change: "CI images on Node 16 break" }),
        candidate({ ref: "m4", inferred: true, excerpt: null, inferredFrom: ["m9"] }),
      ],
      sections,
      sources
    );
    expect(items.map((i) => [i.id, i.evidenceType])).toEqual([
      ["c1", "documented"],
      ["c2", "inferred"],
    ]);
    expect(items[1].inferredFrom).toEqual(["c1"]);
    expect(dropped.map((d) => d.ref)).toEqual(["m2", "m4"]);
  });

  it("makes a step inferred when it names existing evidence, and manual review otherwise", () => {
    const { items } = verify(
      [
        candidate({ ref: "m1", migration: "Upgrade CI to Node 18", migrationInferredFrom: ["m1"] }),
        candidate({ ref: "m2", excerpt: "is deprecated", kind: "deprecation", migration: "Use something", migrationInferredFrom: ["x9"] }),
      ],
      sections,
      sources
    );
    expect(items[0]).toMatchObject({ migrationEvidence: "inferred", migration: "Upgrade CI to Node 18", migrationInferredFrom: ["c1"] });
    expect(items[1]).toMatchObject({ migrationEvidence: "manual_review", migration: null });
  });

  it("documents a step only with its own verified excerpt, shown in the source's words", () => {
    const { items } = verify(
      [
        candidate({
          ref: "m1",
          kind: "deprecation",
          excerpt: "z.string().email() is deprecated",
          migration: "replace every string schema with z.email()",
          migrationExcerpt: "use z.email() instead",
        }),
        candidate({
          ref: "m2",
          kind: "deprecation",
          excerpt: "z.string().email() is deprecated; use",
          migration: "replace every string schema with z.email()",
          migrationExcerpt: "replace every string schema with z.email()",
        }),
      ],
      sections,
      sources
    );
    expect(items[0]).toMatchObject({ migrationEvidence: "documented", migration: "use `z.email()` instead", migrationSourceId: "s2" });
    expect(items[1].migrationEvidence).not.toBe("documented");
  });

  it("labels items from a tag comparison as repository evidence", () => {
    const { items } = verify([candidate({})], sections, [{ id: "s5", type: "tag_compare" }]);
    expect(items[0].evidenceType).toBe("repository_evidence");
  });
});
