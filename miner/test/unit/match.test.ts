import { describe, expect, it } from "vitest";
import { matchRelease, splitChangelog } from "../../src/sources/match.js";

describe("matchRelease", () => {
  it("matches the supported tag patterns", () => {
    expect(matchRelease("v1.2.3", "", "zod", false)).toBe("1.2.3");
    expect(matchRelease("1.2.3", "", "zod", false)).toBe("1.2.3");
    expect(matchRelease("@babel/core@7.24.0", "", "@babel/core", true)).toBe("7.24.0");
    expect(matchRelease("react-query-v5.0.0", "", "@tanstack/react-query", true)).toBe("5.0.0");
    expect(matchRelease("zod/v4.0.0", "", "zod", false)).toBe("4.0.0");
    expect(matchRelease("v4.0.0-beta.1", "", "zod", false)).toBe("4.0.0-beta.1");
  });

  it("rejects a monorepo release that names another package", () => {
    expect(matchRelease("@babel/parser@7.24.0", "", "@babel/core", true)).toBeNull();
    expect(matchRelease("v7.24.0", "Changes in @babel/parser only", "@babel/core", true)).toBeNull();
    expect(matchRelease("v7.24.0", "- `@babel/core`: fix config loading", "@babel/core", true)).toBe("7.24.0");
  });
});

describe("splitChangelog", () => {
  it("splits on the supported heading styles", () => {
    const text = [
      "# Changelog",
      "",
      "## 4.0.0",
      "- Breaking: removed x",
      "",
      "## [3.25.0] - 2025-07-09",
      "- Added y",
      "",
      "# v3.24.0",
      "- Fixed z",
    ].join("\n");
    const sections = splitChangelog(text, "zod");
    expect(sections.map((s) => s.version)).toEqual(["4.0.0", "3.25.0", "3.24.0"]);
    expect(sections[0].text).toBe("## 4.0.0\n- Breaking: removed x");
    expect(sections[1].text).toContain("- Added y");
    expect(sections[2].text).toBe("# v3.24.0\n- Fixed z");
  });

  it("keeps only this package's headings in a monorepo root changelog", () => {
    const text = ["## @scope/b@2.0.0", "- Breaking: b only", "", "## @scope/a@1.5.0", "- Breaking: a change", "", "## a@1.4.0", "- Fixed"].join("\n");
    const sections = splitChangelog(text, "@scope/a");
    expect(sections.map((s) => s.version)).toEqual(["1.5.0", "1.4.0"]);
    expect(sections[0].text).toBe("## @scope/a@1.5.0\n- Breaking: a change");
  });
});
