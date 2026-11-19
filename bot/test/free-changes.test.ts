import { describe, expect, it, vi } from "vitest";
import { answerQuestion } from "../../miner/src/answer.js";
import { registryUrl as npmRegistryUrl } from "../../miner/src/resolve.js";
// The miner's own recorded zod 3.23.8 → 4.0.0 registry, release and OSV responses: no network.
import { ZOD_GITHUB, ZOD_OSV, fixtureFetcher } from "../../miner/test/fixtures.js";
import { applyFreeUpgrade, readFreeChanges } from "../src/assessment.js";
import { IntroducedVulnerabilityError } from "../src/miner-assessment.js";
import * as prModule from "../src/pull-request.js";
import * as updateModule from "../src/updates.js";

const zod = { ecosystem: "npm" as const, package: "zod", source: "package.json", declared: "^3.23.8",
  currentVersion: "3.23.8", targetVersion: "4.0.0" };
const offline: typeof answerQuestion = (query, deps) => answerQuestion(query, {
  ...deps, fetcher: fixtureFetcher({ [npmRegistryUrl("zod")]: "npm/zod.json", ...ZOD_GITHUB, ...ZOD_OSV }).fetcher,
});

describe("free changes", () => {
  it("reads documented changes from release notes with the miner's rules pass, no model and only the token", async () => {
    const ask = vi.fn(offline);
    const finding = await readFreeChanges(zod, "run-token", ask);
    expect(ask).toHaveBeenCalledWith("What changed in zod from 3.23.8 to 4.0.0?",
      expect.objectContaining({ env: { GITHUB_TOKEN: "run-token" }, caller: null }));
    expect(finding).toMatchObject({ package: "zod", currentVersion: "3.23.8", targetVersion: "4.0.0" });
    expect(finding!.changes!.length).toBeGreaterThan(0);
    expect(finding!.changes![0].kind).toBe("breaking");
    expect(finding!.sources.every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("returns nothing for PyPI or when no release information was found", async () => {
    const ask = vi.fn();
    expect(await readFreeChanges({ ...zod, ecosystem: "PyPI", source: "requirements.txt" }, "t", ask)).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
    ask.mockResolvedValue({ answer: { outcome: "not_found" } });
    expect(await readFreeChanges(zod, "t", ask)).toBeUndefined();
  });

  it("refuses an upgrade the notes say introduces a vulnerability", async () => {
    const ask = vi.fn(async (query: string, deps: Parameters<typeof answerQuestion>[1]) => {
      const result = await offline(query, deps);
      result.answer.security.advisories.push({ ...result.answer.security.advisories[0] ?? {}, id: "GHSA-test",
        aliases: [], conclusion: "introduced_by_upgrade" } as never);
      return result;
    });
    await expect(readFreeChanges(zod, "t", ask)).rejects.toBeInstanceOf(IntroducedVulnerabilityError);
  });

  const freeOptions = (readChanges: typeof readFreeChanges, onWarning = vi.fn()) => ({ root: "/repo", repository: "team/repo",
    baseBranch: "main", baseSha: "a".repeat(40), token: "t", dependency: zod, targetVersion: "4.0.0",
    releaseDate: "2025-07-09T18:47:37.886Z", cutoff: "2026-06-01", notesUrl: "https://github.com/colinhacks/zod/releases",
    onWarning, readChanges });

  it("still opens a links-only free PR, with a warning, when the notes cannot be read", async () => {
    const prepare = vi.spyOn(updateModule, "prepareUpdate").mockImplementation(async (_root, finding) => ({ finding, files: [] }));
    const publish = vi.spyOn(prModule, "createDependencyPr").mockResolvedValue("https://github.com/team/repo/pull/9");
    const onWarning = vi.fn();
    const { finding } = await applyFreeUpgrade(freeOptions(async () => { throw new Error("blocked: host resolves to 198.18.2.26"); }, onWarning));
    expect(finding.changes).toBeUndefined();
    expect(finding.sources).toEqual(["https://www.npmjs.com/package/zod/v/4.0.0", "https://github.com/colinhacks/zod/releases"]);
    expect(publish).toHaveBeenCalledOnce();
    expect(onWarning).toHaveBeenCalledWith(
      "zod 4.0.0: release notes could not be read (blocked: host resolves to 198.18.2.26); the free PR links them instead");
    prepare.mockRestore();
    publish.mockRestore();
  });

  it("opens no free PR when the target introduces a vulnerability", async () => {
    const publish = vi.spyOn(prModule, "createDependencyPr");
    await expect(applyFreeUpgrade(freeOptions(async () => { throw new IntroducedVulnerabilityError("introduced"); })))
      .rejects.toBeInstanceOf(IntroducedVulnerabilityError);
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
  });

  it("puts the changes read for free into the free PR, keeping the registry and notes links first", async () => {
    const prepare = vi.spyOn(updateModule, "prepareUpdate").mockImplementation(async (_root, finding) => ({ finding, files: [] }));
    const publish = vi.spyOn(prModule, "createDependencyPr").mockResolvedValue("https://github.com/team/repo/pull/9");
    const changes = [{ kind: "breaking" as const, version: "4.0.0", change: "Dropped `z.oldThing`", quote: null, migration: null }];
    const { finding } = await applyFreeUpgrade(freeOptions(async () => ({ ...zod, issue: "outdated", reason: "r", cves: [], changes,
        sources: ["https://github.com/colinhacks/zod/releases", "https://github.com/colinhacks/zod/releases/tag/v4.0.0"] })));
    expect(finding.changes).toEqual(changes);
    expect(finding.sources).toEqual(["https://www.npmjs.com/package/zod/v/4.0.0", "https://github.com/colinhacks/zod/releases",
      "https://github.com/colinhacks/zod/releases/tag/v4.0.0"]);
    expect(publish.mock.calls[0][0]).toMatchObject({ free: { cutoff: "2026-06-01" } });
    prepare.mockRestore();
    publish.mockRestore();
  });
});
