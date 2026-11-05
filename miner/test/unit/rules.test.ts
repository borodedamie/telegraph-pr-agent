import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractRules, pointerLink } from "../../src/extract/rules.js";
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
    const { candidates, handled } = extractRules(sections, () => "release");
    expect(candidates.map((c) => c.kind)).toEqual(["breaking", "breaking", "deprecation", "security_fix"]);
    // A line-start release keeps its unmarked prose open for the model; a later minor is handled by its headings.
    expect(handled.has(0)).toBe(false);
    expect(extractRules([{ ...sections[0], version: "2.1.0" }], () => "release").handled.has(0)).toBe(true);
    const { items } = verify(candidates, sections, [{ id: "s2", type: "release" }]);
    expect(items[0]).toMatchObject({ migrationEvidence: "documented" });
    expect(items[1]).toMatchObject({ migrationEvidence: "manual_review" });
    expect(items[3].ids).toEqual(["CVE-2024-11111"]);
  });

  it("finds marked bullets outside headings and leaves plain notes to the model", () => {
    const text = [
      "- feat!: drop the default export",
      "- **BREAKING**: rename `a` to `b`",
      "- **Deprecated API methods removed**: old signatures are gone",
      "- remove duplicate location test",
      "- Bump min TS version to 5.0",
      "- Fix non-breaking space handling",
      "- Breakpoints now work in Safari",
      "- Deprecated `foo()`; it will be removed in v6",
    ].join("\n");
    const { candidates, handled } = extractRules([{ version: "1.0.0", consulted: 0, text }], () => "release");
    expect(candidates.map((c) => c.kind)).toEqual(["breaking", "breaking", "breaking", "deprecation"]);
    expect(handled.size).toBe(0);
  });

  it("treats a label bullet as a heading, not as an item", () => {
    const text = "- **Breaking Changes**\n  - `getQueryData` takes a queryKey only";
    const { candidates } = extractRules([{ version: "5.0.0", consulted: 0, text }], () => "release");
    expect(candidates.map((c) => c.excerpt)).toEqual(["`getQueryData` takes a queryKey only"]);
  });

  it("reads the zod v4 migration guide headings as verified changes", () => {
    const text = normalizeText(readFileSync(new URL("../fixtures/github/zod.v4-changelog.mdx", import.meta.url), "utf8"));
    const sections: Section[] = [{ version: "4.0.0", consulted: 0, text }];
    const { candidates } = extractRules(sections, () => "migration_guide");
    const { items } = verify(candidates, sections, [{ id: "s3", type: "migration_guide" }]);
    expect(items.length).toBeGreaterThan(20);
    expect(items.find((i) => i.excerpt === "deprecates `message` parameter")?.kind).toBe("deprecation");
    expect(items.find((i) => i.excerpt === "drops `errorMap`")?.kind).toBe("breaking");
    expect(items.every((i) => text.includes(i.excerpt!))).toBe(true);
  });

  it("reads a guide heading without its anchor and skips the headings that group changes", () => {
    // From eslint's migrate-to-9.0.0 guide.
    const text = [
      "## Breaking changes for users",
      "",
      '## <a name="drop-old-node"></a> Node.js < v18.18, v19 are no longer supported',
      "",
      "Upgrade Node.js to v18.18.0 or later.",
    ].join("\n");
    const { candidates } = extractRules([{ version: "9.0.0", consulted: 0, text }], () => "migration_guide");
    expect(candidates.map((c) => [c.kind, c.excerpt])).toEqual([["breaking", "Node.js < v18.18, v19 are no longer supported"]]);
  });

  it("stays fast on long lines of untrusted release-note text", () => {
    const long = " ".repeat(20_000);
    const text = [`# a${long}b`, `# a${long}#${long}b`, `- a${long}b`, `**a${long}b`, `## a${long}`].join("\n");
    const started = Date.now();
    extractRules([{ version: "1.0.0", consulted: 0, text }], () => "release");
    extractRules([{ version: "1.0.0", consulted: 0, text }], () => "migration_guide");
    expect(Date.now() - started).toBeLessThan(500);
  });

  // Lines taken from real major-release notes (miner/bench/phrase-rules.md).
  it("finds breaking changes written without a marker in a major release", () => {
    const text = [
      "## React 19",
      "",
      "Below is a list of all new features, APIs, deprecations, and breaking changes.",
      "Storybook 10 contains one breaking change: it’s ESM-only. This simplifies our distribution.",
      "",
      "### Other",
      "- Removed: `react-test-renderer/shallow`: This has been a re-export of react-shallow-renderer since React 18.",
      "- Change the `enableUnixSockets` option to be `false` by default",
      "- \"assertions\" have been replaced with \"attributes\" in various places of the plugin interface (#5073)",
      "- `ApplicationRef.tick` will no longer catch and report errors",
      "- Require Node.js 18",
      "- Added a new `useOptimistic` hook",
      "- remove duplicate location test",
      "- Deprecated `foo()`; it will be removed in v20",
      "### Bug Fixes",
      "- The dev overlay no longer crashes on empty errors",
    ].join("\n");
    const { candidates, handled } = extractRules([{ version: "19.0.0", consulted: 0, text }], () => "release");
    expect(candidates.map((c) => [c.kind, c.excerpt!.slice(0, 30)])).toEqual([
      ["breaking", "Storybook 10 contains one brea"],
      ["breaking", "Removed: `react-test-renderer/"],
      ["breaking", "Change the `enableUnixSockets`"],
      ["breaking", "\"assertions\" have been replace"],
      ["breaking", "`ApplicationRef.tick` will no "],
      ["breaking", "Require Node.js 18"],
      ["deprecation", "Deprecated `foo()`; it will be"],
    ]);
    expect(handled.size).toBe(0);
  });

  it("reads phrases only in line-start releases and never in code diffs", () => {
    const text = "- Removed the `legacy` option\n- `fetch` no longer retries";
    expect(extractRules([{ version: "19.1.2", consulted: 0, text }], () => "release").candidates).toEqual([]);
    expect(extractRules([{ version: "19.0.0", consulted: 0, text }], () => "tag_compare").candidates).toEqual([]);
    expect(extractRules([{ version: "0.5.0", consulted: 0, text }], () => "changelog").candidates).toHaveLength(2);
  });

  it("marks a major release whose notes only point to a guide as not assessed", () => {
    const text = "Read the [Migration guide](https://example.org/docs/migrating-to-v5) and the [release blog post](https://example.org/blog/v5).";
    const { candidates, unassessed } = extractRules([{ version: "5.0.0", consulted: 0, text }], () => "release");
    expect(candidates).toEqual([]);
    expect(unassessed).toEqual([{ section: 0, url: "https://example.org/docs/migrating-to-v5" }]);
  });

  it("recognises notes that only point to a changelog or announcement, in any release", () => {
    // The shapes of typescript 5.6.2, react-router 7.0.0, vue 3.5.0 and prettier 3.0.0 on GitHub.
    const typescript =
      "For release notes, check out the [release announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-5-6/).\n\n" +
      "For the complete list of fixed issues, check out the\n\n* [fixed issues query for Typescript 5.6.2 (Stable)](https://github.com/Microsoft/TypeScript/issues?q=milestone).";
    expect(pointerLink(typescript)).toBe("https://devblogs.microsoft.com/typescript/announcing-typescript-5-6/");
    expect(pointerLink("See the changelog for release notes: https://github.com/remix-run/react-router/blob/main/CHANGELOG.md#v700")).toBe(
      "https://github.com/remix-run/react-router/blob/main/CHANGELOG.md#v700"
    );
    expect(pointerLink("For stable releases, please refer to [CHANGELOG.md](https://github.com/vuejs/core/blob/main/CHANGELOG.md) for details.")).toBe(
      "https://github.com/vuejs/core/blob/main/CHANGELOG.md"
    );
    expect(pointerLink("🔗 [Release note](https://prettier.io/blog/2023/07/05/3.0.0.html)")).toBe("https://prettier.io/blog/2023/07/05/3.0.0.html");

    const { unassessed, handled } = extractRules([{ version: "5.6.2", consulted: 0, text: typescript }], () => "release");
    expect(unassessed).toEqual([{ section: 0, url: "https://devblogs.microsoft.com/typescript/announcing-typescript-5-6/" }]);
    expect(handled).toEqual(new Set([0]));
  });

  it("does not take notes that list changes of their own for a pointer", () => {
    const text = `- Fixed a crash when the config is empty\n- ${"Improved the error message for a missing file. ".repeat(8)}\n\nFull changelog: https://github.com/a/b/blob/main/CHANGELOG.md`;
    expect(pointerLink(text)).toBeNull();
  });
});
