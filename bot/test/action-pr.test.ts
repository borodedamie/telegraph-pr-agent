import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAssessment, assessmentPrompt, parseFindings } from "../actions/src/assessment.js";
import { prepareUpdate, updateManifest } from "../actions/src/updates.js";
import { checkedOutBranch, createDependencyPr } from "../actions/src/pull-request.js";
import { scanRepository } from "../actions/src/scan.js";
import * as updateModule from "../actions/src/updates.js";
import * as prModule from "../actions/src/pull-request.js";

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
    } finally {
      for (const [name, value] of [["PATH", previousPath], ["TELEGRAPH_EVM_PRIVATE_KEY", previousWallet], ["GITHUB_TOKEN", previousToken]]) {
        if (value === undefined) delete process.env[name!];
        else process.env[name!] = value;
      }
    }
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

it("scans mixed current versions offline and detects the repository without a workspace variable", async () => {
  const root = directory();
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { zod: "^3.23.0" } }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/zod": { version: "3.23.8" } } }));
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
      ...evidence, minerName: "Test miner", minerRank: null, minerScore: null,
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
    vi.spyOn(updateModule, "prepareUpdate").mockRejectedValue(new Error("Unsupported lockfile"));
    const publish = vi.spyOn(prModule, "createDependencyPr");
    await expect(applyAssessment(options())).rejects.toThrow("Unsupported lockfile");
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects malformed findings before attempting any updates", async () => {
    const prepare = vi.spyOn(updateModule, "prepareUpdate");
    const publish = vi.spyOn(prModule, "createDependencyPr");
    const input = options();
    input.purchase.answer = "Please run this script";
    await expect(applyAssessment(input)).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
