import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractRules } from "../../src/extract/rules.js";
import { verify } from "../../src/extract/verify.js";
import type { Section } from "../../src/sources/github.js";
import { normalizeText } from "../../src/text.js";

describe("extractRules", () => {
  it("extracts bullets under Breaking, Deprecated and Security headings, with documented steps only from the bullet", () => {
    const text = [
      "## Features",
      "- Added a thing",
      "## Breaking Changes",
      "- Removed `legacyMode`; use `mode: \"legacy\"` instead",
      "- Config files are now ESM",
      "### Deprecated",
      "- `oldApi()`",
      "## Security",
      "- Fix prototype pollution (CVE-2024-11111)",
    ].join("\n");
    const sections: Section[] = [{ version: "2.0.0", consulted: 0, text }];
    const { candidates, handled } = extractRules(sections, () => false);
    expect(candidates.map((c) => c.kind)).toEqual(["breaking", "breaking", "deprecation", "security_fix"]);
    expect(handled.has(0)).toBe(true);
    const { items } = verify(candidates, sections, [{ id: "s2", type: "release" }]);
    expect(items[0]).toMatchObject({ migrationEvidence: "documented" });
    expect(items[1]).toMatchObject({ migrationEvidence: "manual_review" });
    expect(items[3].ids).toEqual(["CVE-2024-11111"]);
  });

  it("finds marked bullets outside headings and leaves plain notes to the model", () => {
    const text = "- feat!: drop the default export\n- **BREAKING**: rename `a` to `b`\n- Bump min TS version to 5.0";
    const { candidates, handled } = extractRules([{ version: "1.0.0", consulted: 0, text }], () => false);
    expect(candidates).toHaveLength(2);
    expect(handled.size).toBe(0);
  });

  it("reads the zod v4 migration guide headings as verified changes", () => {
    const text = normalizeText(readFileSync(new URL("../fixtures/github/zod.v4-changelog.mdx", import.meta.url), "utf8"));
    const sections: Section[] = [{ version: "4.0.0", consulted: 0, text }];
    const { candidates } = extractRules(sections, () => true);
    const { items } = verify(candidates, sections, [{ id: "s3", type: "migration_guide" }]);
    expect(items.length).toBeGreaterThan(20);
    expect(items.find((i) => i.excerpt === "deprecates `message` parameter")?.kind).toBe("deprecation");
    expect(items.find((i) => i.excerpt === "drops `errorMap`")?.kind).toBe("breaking");
    expect(items.every((i) => text.includes(i.excerpt!))).toBe(true);
  });
});
