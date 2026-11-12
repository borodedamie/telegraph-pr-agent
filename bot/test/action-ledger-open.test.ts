import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const git = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(), execFileSync: git,
}));
import { openLedger } from "../src/purchase.js";

const directories: string[] = [];
afterEach(() => { git.mockReset(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it.each([true, false])("opens the ledger with isolated credentials and bootstraps only a missing branch (missing: %s)", async (missing) => {
  git.mockImplementation((_command, args, { cwd, env }) => {
    expect(env.TELEGRAPH_EVM_PRIVATE_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_1).toBe("core.hooksPath");
    expect(env.GIT_CONFIG_VALUE_1).toBe("/dev/null");
    if (args[0] === "ls-remote" && missing) throw Object.assign(new Error("branch missing"), { status: 2 });
    if (args[0] === "checkout") writeFileSync(join(cwd, "ledger.jsonl"), "");
    return Buffer.from("");
  });
  const ledger = await openLedger("team/repo", "test-token");
  directories.push(ledger.directory);
  const args = git.mock.calls.map((call) => call[1]);
  expect(args.some((a) => a[0] === "push")).toBe(missing);
  expect(args.find((a) => a[0] === "remote")).toEqual(["remote", "add", "origin", "https://github.com/team/repo.git"]);
  expect(args.flat().some((arg) => arg.includes("test-token"))).toBe(false);
});

it("does not bootstrap after an authentication or fetch error", async () => {
  let directory = "";
  git.mockImplementation((_command, args, { cwd }) => {
    directory = cwd;
    if (args[0] === "ls-remote") throw Object.assign(new Error("authentication failed"), { status: 128 });
    return Buffer.from("");
  });
  await expect(openLedger("team/repo", "test-token")).rejects.toThrow("authentication failed");
  expect(git.mock.calls.some((call) => call[1][0] === "push")).toBe(false);
  expect(existsSync(directory)).toBe(false);
});
