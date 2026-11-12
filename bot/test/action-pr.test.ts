import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAssessment, assessmentPrompt, parseFindings, InvalidAssessmentError } from "../src/assessment.js";
import { prepareUpdate, updateManifest } from "../src/updates.js";
import { checkedOutBranch, createDependencyPr } from "../src/pull-request.js";
import { scanRepository } from "../src/scan.js";
import * as updateModule from "../src/updates.js";
import * as prModule from "../src/pull-request.js";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const directory = () => {
  const root = mkdtempSync(join(tmpdir(), "action-pr-test-"));
  directories.push(root);
  return root;
};
const dependency = { ecosystem: "npm" as const, package: "zod", declared: "^3.23.0",
  currentVersion: "3.23.8", source: "package.json" };
const finding = { ecosystem: "npm" as const, package: "zod", source: "package.json", currentVersion: "3.23.8",
  targetVersion: "4.0.0", issue: "outdated" as const, reason: "A newer supported major release is available",
  cves: [], sources: ["https://example.org/releases"] };
const evidence = { minerId: "302", intent: "QUESTION_ANSWERING_GENERAL", amountUsdc: 0.01,
  receiptHash: "receipt", signalHash: "signal", txHash: "tx" };
const answer = (entry = finding) => JSON.stringify({ findings: [entry] });
const pythonFinding = { ...finding, ecosystem: "PyPI" as const, package: "requests", source: "requirements.txt",
  currentVersion: "2.31.0", targetVersion: "2.32.3" };

describe("action assessment", () => {
  it("accepts concrete upgrades and an empty clean assessment", () => {
    expect(parseFindings(answer(), [dependency])).toEqual([finding]);
    expect(parseFindings('{"findings":[]}', [dependency])).toEqual([]);
    expect(assessmentPrompt([dependency])).toContain('"currentVersion":"3.23.8"');
    expect(assessmentPrompt([dependency])).toContain("no preferred target is supplied");
  });
  it.each([
    { ecosystem: "npm" as const, currentVersion: "4.0.0-rc.1", targetVersion: "4.0.0" },
    { ecosystem: "PyPI" as const, currentVersion: "1", targetVersion: "2.0" },
    { ecosystem: "PyPI" as const, currentVersion: "1.0rc1", targetVersion: "1.0" },
    { ecosystem: "PyPI" as const, currentVersion: "1.0.post1", targetVersion: "1.1" },
    { ecosystem: "PyPI" as const, currentVersion: "1.0.dev1", targetVersion: "1.0" },
  ])("accepts ecosystem current versions: %j", (versions) => {
    const entry = { ...finding, ...versions };
    expect(parseFindings(JSON.stringify({ findings: [entry] }), [{ ...dependency, ...versions }])).toEqual([entry]);
  });
  it.each([
    { ecosystem: "npm" as const, currentVersion: "4.0.0+build.1", targetVersion: "4.0.0" },
    { ecosystem: "npm" as const, currentVersion: "4.0.0-rc.1", targetVersion: "3.9.0" },
    { ecosystem: "PyPI" as const, currentVersion: "1!1.0", targetVersion: "9.0" },
    { ecosystem: "PyPI" as const, currentVersion: "1.0.post1", targetVersion: "1.0" },
    { ecosystem: "PyPI" as const, currentVersion: "1.0.0", targetVersion: "1.0" },
  ])("rejects equal versions and ecosystem downgrades: %j", (versions) => {
    const entry = { ...finding, ...versions };
    expect(() => parseFindings(JSON.stringify({ findings: [entry] }), [{ ...dependency, ...versions }])).toThrow(/must upgrade/);
  });
  it("keeps findings for distinct conditional Python pins", () => {
    const findings = [pythonFinding, { ...pythonFinding, currentVersion: "2.30.0" }];
    const dependencies = findings.map((entry) => ({ ...dependency, ...entry }));
    expect(parseFindings(JSON.stringify({ findings }), dependencies)).toEqual(findings);
  });
  it.each([
    { ...finding, source: "../package.json" }, { ...finding, package: "other" },
    { ...finding, currentVersion: "1.0.0" }, { ...finding, targetVersion: "3.23.8" },
    { ...finding, targetVersion: "2.0.0" }, { ...finding, targetVersion: "4.0.0; echo hacked" },
    { ...finding, sources: ["http://example.org"] }, { ...finding, issue: "cve" },
  ])("rejects mismatched or unsafe findings: %j", (invalid) => {
    expect(() => parseFindings(JSON.stringify({ findings: [invalid] }), [dependency])).toThrow();
  });
  it("rejects prose, duplicate findings and arbitrary extra instructions", () => {
    expect(() => parseFindings("upgrade zod!", [dependency])).toThrow();
    expect(() => parseFindings(JSON.stringify({ findings: [finding, finding] }), [dependency])).toThrow(/Duplicate/);
    expect(() => parseFindings(JSON.stringify({ findings: [{ ...finding, command: "npm install" }] }), [dependency])).toThrow();
  });
});

describe("dependency preparation", () => {
  it("preserves npm range prefixes and unrelated manifest fields", () => {
    const content = '{\n  "scripts": {"test": "test-command"},\n  "dependencies": {"zod": "^3.23.0", "other": "1.0.0"}\n}\n';
    const updated = JSON.parse(updateManifest(content, finding));
    expect(updated.dependencies).toEqual({ zod: "^4.0.0", other: "1.0.0" });
    expect(updated.scripts.test).toBe("test-command");
  });
  it("preserves Python extras, markers, comments, and unrelated pins", () => {
    const content = 'Requests[security]==2.31.0; python_version >= "3.10" # required\nflask==3.0.0\n';
    expect(updateManifest(content, pythonFinding)).toBe(content.replace("2.31.0", "2.32.3"));
    expect(() => updateManifest("requests==2.31.0 --hash=sha256:old\n", pythonFinding)).toThrow(/hash/i);
    expect(() => updateManifest("requests==2.31.0 \\\n --hash=sha256:old\n", pythonFinding)).toThrow(/continued/);
  });
  it("checks PyPI target availability and rejects yanked versions", async () => {
    const root = directory();
    writeFileSync(join(root, "requirements.txt"), "requests==2.31.0\n");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ info: { name: "requests", version: "2.32.3" }, urls: [{ yanked: false }] })));
    const update = await prepareUpdate(root, pythonFinding, fetchImpl);
    expect(update.files).toEqual([{ path: "requirements.txt", content: "requests==2.32.3\n" }]);
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ info: { name: "requests", version: "2.32.3" }, urls: [{ yanked: true }] })));
    await expect(prepareUpdate(root, pythonFinding, fetchImpl)).rejects.toThrow(/yanked/);
  });
  it("regenerates the npm lock alongside the manifest without changing the checkout", async () => {
    const root = directory();
    const manifest = { dependencies: { zod: "^3.23.0" } };
    writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {
      "": manifest, "node_modules/zod": { version: "3.23.8", resolved: "https://registry.npmjs.org/zod/-/zod-3.23.8.tgz" },
    } }));
    const npm = vi.fn((temporary: string) => {
      expect(JSON.parse(readFileSync(join(temporary, "package.json"), "utf8")).dependencies.zod).toBe("4.0.0");
      writeFileSync(join(temporary, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {
        "": { dependencies: { zod: "4.0.0" } }, "node_modules/zod": { version: "4.0.0" },
      } }));
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: "zod", version: "4.0.0" })));
    const update = await prepareUpdate(root, finding, fetchImpl, npm);
    expect(update.files.map((file) => file.path)).toEqual(["package.json", "package-lock.json"]);
    expect(JSON.parse(update.files[1].content).packages[""].dependencies.zod).toBe("^4.0.0");
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).toEqual(manifest);
    expect(npm).toHaveBeenCalledOnce();
  });
  it("runs lock generation without inherited wallet or GitHub credentials", async () => {
    const root = directory();
    const manifest = { dependencies: { zod: "^3.23.0" } };
    writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": manifest } }));
    const observed = join(root, "observed.json");
    const fakeNpm = join(root, "npm");
    const nextLock = { lockfileVersion: 3, packages: {
      "": { dependencies: { zod: "4.0.0" } }, "node_modules/zod": { version: "4.0.0" },
    } };
    writeFileSync(fakeNpm, `#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(observed)}, JSON.stringify({keys:Object.keys(process.env), args:process.argv.slice(2)}));\nfs.writeFileSync("package-lock.json", ${JSON.stringify(JSON.stringify(nextLock))});\n`);
    chmodSync(fakeNpm, 0o755);
    const previousPath = process.env.PATH;
    const previousWallet = process.env.TELEGRAPH_EVM_PRIVATE_KEY;
    const previousToken = process.env.GITHUB_TOKEN;
    try {
      process.env.PATH = root;
      process.env.TELEGRAPH_EVM_PRIVATE_KEY = "dummy-wallet";
      process.env.GITHUB_TOKEN = "dummy-token";
      await prepareUpdate(root, finding, async () => new Response(JSON.stringify({ name: "zod", version: "4.0.0" })));
      const invocation = JSON.parse(readFileSync(observed, "utf8"));
      expect(invocation.keys).not.toContain("TELEGRAPH_EVM_PRIVATE_KEY");
      expect(invocation.keys).not.toContain("GITHUB_TOKEN");
      expect(invocation.args).toContain("--ignore-scripts");
      expect(invocation.args).toContain("--package-lock-only");
      const configs = invocation.args.filter((arg: string) => /^--(?:user|global)config=/.test(arg));
      expect(configs).toHaveLength(2);
      expect(configs[0].split("=")[1]).not.toBe(configs[1].split("=")[1]);
    } finally {
      for (const [name, value] of [["PATH", previousPath], ["TELEGRAPH_EVM_PRIVATE_KEY", previousWallet], ["GITHUB_TOKEN", previousToken]]) {
        if (value === undefined) delete process.env[name!];
        else process.env[name!] = value;
      }
    }
  });

  it("rejects workspace members even with a local lock", async () => {
    const root = directory();
    mkdirSync(join(root, "packages/member"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    writeFileSync(join(root, "packages/member/package.json"), JSON.stringify({ dependencies: { zod: "^3.23.0" } }));
    writeFileSync(join(root, "packages/member/package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));
    const npm = vi.fn();
    await expect(prepareUpdate(root, { ...finding, source: "packages/member/package.json" },
      async () => new Response(JSON.stringify({ name: "zod", version: "4.0.0" })), npm)).rejects.toThrow(/workspace members/);
    expect(npm).not.toHaveBeenCalled();
  });


  it("rejects unresolvable target versions", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    await expect(prepareUpdate(directory(), pythonFinding, fetchImpl)).rejects.toThrow(/HTTP 404/);
  });
});

const publisherFixture = (baseBranch = "feature/current") => {
  const root = directory();
  writeFileSync(join(root, "requirements.txt"), "requests==2.31.0\n");
  const baseSha = "a".repeat(40);
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace("/repos/team/repo", "");
    const method = init?.method ?? "GET";
    const body: Record<string, unknown> = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body });
    let response: unknown;
    if (path === "/pulls" && method === "GET") response = [];
    else if (path === "") response = { private: false, default_branch: "main" };
    else if (path === `/git/ref/heads/${encodeURIComponent(baseBranch)}`) response = { object: { sha: baseSha } };
    else if (path === `/git/commits/${baseSha}`) response = { tree: { sha: "old-tree" } };
    else if (path === "/git/trees") response = { sha: "new-tree" };
    else if (path === "/git/commits") response = { sha: "new-commit" };
    else if (path.startsWith("/git/matching-refs/")) response = [];
    else if (path === "/git/refs") response = { ref: body.ref };
    else if (path === "/pulls" && method === "POST") response = { html_url: "https://github.com/team/repo/pull/1" };
    else throw new Error(`Unexpected API call ${method} ${path}`);
    return new Response(JSON.stringify(response));
  });
  return { root, baseSha, baseBranch, fetchImpl, calls, repository: "team/repo", token: "test-token", purchase: evidence,
    update: { finding: pythonFinding, files: [{ path: "requirements.txt", content: "requests==2.32.3\n" }] } };
};

describe("draft dependency PR publication", () => {
  it("creates a feature branch and draft PR with issue, sources, and receipt", async () => {
    const fixture = publisherFixture();
    expect(await createDependencyPr(fixture)).toBe("https://github.com/team/repo/pull/1");
    const commit = fixture.calls.find((call) => call.path === "/git/commits" && call.method === "POST")!;
    expect(commit.body.parents).toEqual([fixture.baseSha]);
    const ref = fixture.calls.find((call) => call.path === "/git/refs")!;
    expect(ref.body.ref).toMatch(/^refs\/heads\/fix\/telegraph-dependency-/);
    const pr = fixture.calls.find((call) => call.path === "/pulls" && call.method === "POST")!;
    expect(pr.body.draft).toBe(true);
    expect(pr.body.base).toBe("feature/current");
    expect(new URL(String(fixture.fetchImpl.mock.calls[0][0])).searchParams.get("base")).toBe("feature/current");
    expect(fixture.calls.find((call) => call.path === "/git/trees")!.body.tree).toEqual([
      { path: "requirements.txt", mode: "100644", type: "blob", content: "requests==2.32.3\n" },
    ]);
    expect(pr.body.body).toContain("receipt");
    expect(pr.body.body).toContain("https://example.org/releases");
    expect(fixture.calls.some((call) => call.method === "PATCH")).toBe(false);
  });
  it("creates distinct fix branches for the same update on different target branches", async () => {
    const first = publisherFixture("release/one");
    const second = publisherFixture("release/two");
    await createDependencyPr(first);
    await createDependencyPr(second);
    const firstRef = first.calls.find((call) => call.path === "/git/refs")!.body.ref;
    const secondRef = second.calls.find((call) => call.path === "/git/refs")!.body.ref;
    expect(firstRef).not.toBe(secondRef);
  });

  it("reuses an existing PR, including closed PRs, without Git writes", async () => {
    const fixture = publisherFixture();
    fixture.fetchImpl.mockImplementation(async () => new Response(JSON.stringify([{ html_url: "https://github.com/team/repo/pull/2", state: "closed" }])));
    expect(await createDependencyPr(fixture)).toContain("/pull/2");
    expect(fixture.fetchImpl).toHaveBeenCalledOnce();
  });
  it("rejects arbitrary file edits before making GitHub requests", async () => {
    const fixture = publisherFixture();
    fixture.update.files.push({ path: ".github/workflows/evil.yml", content: "arbitrary" });
    await expect(createDependencyPr(fixture)).rejects.toThrow(/unexpected/);
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
    fixture.update.files = [{ path: "requirements.txt", content: "requests==2.32.3\narbitrary==1.0\n" }];
    await expect(createDependencyPr(fixture)).rejects.toThrow(/does not match/);
  });
  it("refuses publication after the checked-out branch has moved", async () => {
    const fixture = publisherFixture();
    const original = fixture.fetchImpl.getMockImplementation()!;
    fixture.fetchImpl.mockImplementation(async (input, init) => {
      if (String(input).endsWith(`/git/ref/heads/${encodeURIComponent(fixture.baseBranch)}`)) {
        return new Response(JSON.stringify({ object: { sha: "b".repeat(40) } }));
      }
      return original(input, init);
    });
    await expect(createDependencyPr(fixture)).rejects.toThrow(/Checked-out branch changed/);
    expect(fixture.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("refuses to overwrite a pre-existing conflicting branch", async () => {
    const fixture = publisherFixture();
    const original = fixture.fetchImpl.getMockImplementation()!;
    fixture.fetchImpl.mockImplementation(async (input, init) => {
      if (String(input).includes("/git/matching-refs/")) {
        const branch = String(input).split("/git/matching-refs/heads/")[1];
        return new Response(JSON.stringify([{ ref: `refs/heads/${branch}`, object: { sha: "existing" } }]));
      }
      if (String(input).endsWith("/git/commits/existing")) {
        return new Response(JSON.stringify({ tree: { sha: "different-tree" }, parents: [{ sha: fixture.baseSha }] }));
      }
      return original(input, init);
    });
    await expect(createDependencyPr(fixture)).rejects.toThrow(/refusing to overwrite/);
    expect(fixture.calls.some((call) => call.path === "/git/refs")).toBe(false);
  });

  it("surfaces GitHub permission errors", async () => {
    const fixture = publisherFixture();
    fixture.fetchImpl.mockImplementation(async () => new Response("", { status: 403 }));
    await expect(createDependencyPr(fixture)).rejects.toThrow(/HTTP 403/);
  });
});

it.each([
  { status: 200, body: { private: true } },
  { status: 200, body: {} },
  { status: 403, body: {} },
])("fails closed on private or unknown repository visibility: %j", async ({ status, body }) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
  await expect(prModule.assertPublicRepository("team/repo", "token")).rejects.toThrow();
});

it("scans mixed current versions offline and detects the repository without a workspace variable", async () => {
  const root = directory();
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { zod: "^3.23.0" } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/zod": { version: "3.23.8" } } }));
  writeFileSync(join(root, "requirements.txt"), "requests==2.31.0\nflask>=3.0\n");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
  try {
    const scan = await scanRepository(root);
    expect(scan.dependencies.map((entry) => [entry.ecosystem, entry.package, entry.currentVersion])).toEqual([
      ["npm", "zod", "3.23.8"], ["PyPI", "requests", "2.31.0"],
    ]);
    expect(scan.skipped).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { fetchSpy.mockRestore(); }
});


it("skips inconsistent or invalid versions before assessment without losing valid dependencies", async () => {
  const root = directory();
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: {
    zod: "^4.0.0", valid: "^1.0.0", prerelease: "^2.0.0-rc.1", invalid: "*", invalidrange: "broken",
  } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {
    "node_modules/zod": { version: "3.23.8" }, "node_modules/valid": { version: "1.2.0" },
    "node_modules/prerelease": { version: "2.0.0-rc.2" }, "node_modules/invalid": { version: "01.0.0" },
    "node_modules/invalidrange": { version: "1.0.0" },
  } }));
  writeFileSync(join(root, "requirements.txt"), "short==1\ninvalid==nonsense\npreview==1.0rc1\n");
  const scan = await scanRepository(root);
  expect(scan.dependencies.map((entry) => [entry.package, entry.currentVersion])).toEqual([
    ["valid", "1.2.0"], ["prerelease", "2.0.0-rc.2"], ["short", "1"], ["preview", "1.0rc1"],
  ]);
  expect(scan.skipped.map((entry) => entry.package)).toEqual(["zod", "invalid", "invalidrange", "invalid"]);
  const findings = scan.dependencies.map((entry) => ({ ...finding, ecosystem: entry.ecosystem,
    package: entry.package, source: entry.source, currentVersion: entry.currentVersion }));
  expect(parseFindings(JSON.stringify({ findings }), scan.dependencies)).toHaveLength(4);
});

it("detects the checked-out branch and rejects detached HEAD instead of defaulting to main", () => {
  const root = directory();
  execFileSync("git", ["init", "-q", "-b", "feature/current", root]);
  expect(checkedOutBranch(root)).toBe("feature/current");
  execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.org", "commit", "--allow-empty", "-qm", "fixture"]);
  execFileSync("git", ["-C", root, "checkout", "--detach", "-q"]);
  expect(() => checkedOutBranch(root)).toThrow(/detached HEAD/);
});


describe("one-invocation dependency updates", () => {
  const options = () => ({ root: "/unused", repository: "team/repo", baseBranch: "feature/current",
    baseSha: "a".repeat(40), token: "dummy-token", dependencies: [dependency], purchase: {
      ...evidence, minerName: "Test miner", minerRank: null, minerScore: null, selectedBy: "rank" as const,
      network: "eip155:11155111", chainId: 11155111,
      usdcContract: `0x${"b".repeat(40)}`, explorerBaseUrl: "https://sepolia.etherscan.io",
      status: "settled" as const, answer: answer(),
    } });

  it("prepares the update and opens its PR without stage inputs or artifact files", async () => {
    const update = { finding, files: [{ path: "package.json", content: "updated manifest" }] };
    const prepare = vi.spyOn(updateModule, "prepareUpdate").mockResolvedValue(update);
    const publish = vi.spyOn(prModule, "createDependencyPr").mockResolvedValue("https://github.com/team/repo/pull/1");
    const input = options();
    expect(await applyAssessment(input)).toEqual(["https://github.com/team/repo/pull/1"]);
    expect(prepare).toHaveBeenCalledWith(input.root, finding);
    expect(publish).toHaveBeenCalledWith({ root: input.root, repository: input.repository,
      baseBranch: input.baseBranch, baseSha: input.baseSha, token: input.token, update, purchase: evidence });
  });

  it("does not prepare or publish when the miner reports no issues", async () => {
    const prepare = vi.spyOn(updateModule, "prepareUpdate");
    const publish = vi.spyOn(prModule, "createDependencyPr");
    const input = options();
    input.purchase.answer = '{"findings":[]}';
    expect(await applyAssessment(input)).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not create a PR when a recommended update cannot be prepared", async () => {
    const prepare = vi.spyOn(updateModule, "prepareUpdate")
      .mockResolvedValueOnce({ finding, files: [] })
      .mockRejectedValueOnce(new Error("Unsupported lockfile"));
    const publish = vi.spyOn(prModule, "createDependencyPr");
    const input = options();
    input.dependencies.push({ ...dependency, package: "other" });
    input.purchase.answer = JSON.stringify({ findings: [finding, { ...finding, package: "other" }] });
    await expect(applyAssessment(input)).rejects.toThrow("Unsupported lockfile");
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(publish).not.toHaveBeenCalled();
  });

  it("reports earlier PRs when a later publication fails", async () => {
    vi.spyOn(updateModule, "prepareUpdate").mockResolvedValue({ finding, files: [] });
    vi.spyOn(prModule, "createDependencyPr").mockResolvedValueOnce("https://github.com/team/repo/pull/1")
      .mockRejectedValueOnce(new Error("GitHub unavailable"));
    const input = options();
    input.dependencies.push({ ...dependency, package: "other" });
    input.purchase.answer = JSON.stringify({ findings: [finding, { ...finding, package: "other" }] });
    const onPublished = vi.fn();
    await expect(applyAssessment({ ...input, onPublished })).rejects.toThrow("GitHub unavailable");
    expect(onPublished).toHaveBeenCalledExactlyOnceWith(["https://github.com/team/repo/pull/1"]);
  });

  it("publishes an adapted structured miner answer instead of parsing its prose", async () => {
    const prepare = vi.spyOn(updateModule, "prepareUpdate").mockResolvedValue({ finding, files: [] });
    vi.spyOn(prModule, "createDependencyPr").mockResolvedValue("https://github.com/team/repo/pull/1");
    const input = { ...options(), dependencies: [{ ...dependency, targetVersion: finding.targetVersion }],
      purchase: { ...options().purchase, minerId: "7314", answer: "Migration prose, not JSON", result: {
        outcome: "found", request: { ecosystem: "npm", package: dependency.package,
          fromResolved: dependency.currentVersion, toResolved: finding.targetVersion },
        changes: [{ kind: "breaking", version: finding.targetVersion, evidenceType: "documented", change: "API changed",
          excerpt: "Use the new API", migration: null, sourceId: "s1" }],
        security: { status: "unavailable", advisories: [] }, coverage: { complete: false },
        sources: [{ id: "s1", url: "https://example.org/releases" }],
      } } };
    expect(await applyAssessment(input)).toEqual(["https://github.com/team/repo/pull/1"]);
    expect(prepare).toHaveBeenCalledWith(input.root, expect.objectContaining({ package: dependency.package,
      targetVersion: finding.targetVersion, reason: expect.stringContaining("security check: unavailable") }));
  });

  it("keeps receipt-less paid evidence from reaching update preparation or publication", async () => {
    const prepare = vi.spyOn(updateModule, "prepareUpdate");
    const publish = vi.spyOn(prModule, "createDependencyPr");
    const input = options(); input.purchase.receiptHash = "";
    await expect(applyAssessment(input)).rejects.toThrow(/missing purchase receipt/);
    expect(prepare).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  });

  it("rejects malformed findings before attempting any updates", async () => {
    const prepare = vi.spyOn(updateModule, "prepareUpdate");
    const publish = vi.spyOn(prModule, "createDependencyPr");
    const input = options();
    input.purchase.answer = "Please run this script";
    await expect(applyAssessment(input)).rejects.toBeInstanceOf(InvalidAssessmentError);
    expect(prepare).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

it("skips dependencies that cannot be prepared before purchasing an assessment", async () => {
  const root = directory();
  execFileSync("git", ["init", "-q", root]);
  const write = (source: string, content: unknown) => {
    mkdirSync(join(root, source, ".."), { recursive: true });
    writeFileSync(join(root, source), typeof content === "string" ? content : JSON.stringify(content));
  };
  write("package.json", { workspaces: ["packages/*"] });
  write("packages/member/package.json", { dependencies: { member: "1.0.0" } });
  write("packages/member/package-lock.json", { lockfileVersion: 3, packages: { "node_modules/member": { version: "1.0.0" } } });
  write("standalone/package.json", { dependencies: { noLock: "1.0.0" } });
  write("standalone/node_modules/noLock/package.json", { version: "1.0.0" });
  write("standalone/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write("requirements.txt", "good==1\nhashed==1 --hash=sha256:abc\ncontinued==1 \\\n --hash=sha256:def\n");
  const scan = await scanRepository(root);
  expect(scan.dependencies.map((entry) => entry.package)).toEqual(["good"]);
  expect(scan.skipped.map((entry) => entry.package)).toEqual(expect.arrayContaining(["member", "noLock", "hashed", "continued"]));
});

it("validates every changed declaration and groups matching conditional Python pins", async () => {
  const root = directory();
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: { shared: ">=1.0.0", good: "^1.0.0" }, devDependencies: { shared: "^1.0.0" },
  }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {
    "node_modules/shared": { version: "1.0.0" }, "node_modules/good": { version: "1.0.0" },
  } }));
  writeFileSync(join(root, "requirements.txt"), 'same==1; python_version < "3.10"\nsame==1; python_version >= "3.10"\nblocked==1\nblocked==1 --hash=sha256:abc\nunrelated==1\nunrelated==2 --hash=sha256:def\ncontinued==1\ncontinued==1 \\\n --hash=sha256:def\n');
  const scan = await scanRepository(root);
  expect(scan.dependencies.map((entry) => entry.package)).toEqual(["good", "same", "unrelated"]);
  expect(scan.dependencies.find((entry) => entry.package === "same")!.declared.split("\n")).toHaveLength(2);
  expect(scan.skipped.map((entry) => entry.package)).toEqual(expect.arrayContaining(["shared", "blocked", "continued"]));
});

it("skips pnpm members with npm locks while including excluded standalone and tracked build packages", async () => {
  const root = directory();
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'other/*'\n# additional sources\n  - 'packages/*'\n  - '!packages/standalone'\n");
  for (const [project, name] of [["packages/member", "member"], ["packages/standalone", "standalone"],
    ["tools/build", "source"], ["generated/build", "generated"]]) {
    mkdirSync(join(root, project), { recursive: true });
    writeFileSync(join(root, project, "package.json"), JSON.stringify({ dependencies: { [name]: "1.0.0" } }));
    writeFileSync(join(root, project, "package-lock.json"), JSON.stringify({ lockfileVersion: 3,
      packages: { [`node_modules/${name}`]: { version: "1.0.0" } } }));
  }
  execFileSync("git", ["-C", root, "add", "tools/build"]);
  const scan = await scanRepository(root);
  expect(scan.dependencies.map((entry) => entry.package)).toEqual(["standalone", "source"]);
  expect(scan.skipped).toContainEqual(expect.objectContaining({ package: "member", reason: expect.stringContaining("pnpm workspace") }));
});
