import { expect, it, vi } from "vitest";
import { cutoffCandidates } from "../actions/src/cutoff.js";
import { parseFindings } from "../actions/src/assessment.js";

const dependency = { ecosystem: "npm" as const, package: "foo", currentVersion: "1.0.0", source: "package.json", declared: "^1.0.0" };
const cutoff = new Date("2025-01-01");
const response = (body: unknown) => async () => new Response(JSON.stringify(body));
const npm = { name: "foo", "dist-tags": { latest: "2.0.0" }, versions: { "2.0.0": {} }, time: { "2.0.0": "2026-01-01T00:00:00Z" } };

it("selects a verified newer release strictly after the cutoff", async () => {
  expect(await cutoffCandidates([dependency], cutoff, response(npm))).toEqual([
    { ...dependency, targetVersion: "2.0.0", releaseDate: "2026-01-01T00:00:00Z" },
  ]);
});

it.each(["2024-12-31", "2025-01-01", "invalid", "2999-01-01", undefined])("does not pay for an old or unverifiable date: %s", async (date) => {
  expect(await cutoffCandidates([dependency], cutoff, response({ ...npm, time: { "2.0.0": date } }))).toEqual([]);
});

it("excludes unchanged and older targets, missing packages, and registry mismatches", async () => {
  for (const currentVersion of ["2.0.0", "3.0.0"]) {
    expect(await cutoffCandidates([{ ...dependency, currentVersion }], cutoff, response(npm))).toEqual([]);
  }
  expect(await cutoffCandidates([dependency], cutoff, async () => new Response("", { status: 404 }))).toEqual([]);
  expect(await cutoffCandidates([dependency], cutoff, response({ ...npm, name: "wrong" }))).toEqual([]);
  const report = vi.fn();
  expect(await cutoffCandidates([dependency], cutoff, async () => new Response("", { status: 500 }), report)).toEqual([]);
  expect(report).toHaveBeenCalledWith(dependency, expect.objectContaining({ message: expect.stringContaining("500") }));
});

it("falls back to the highest stable npm version when latest is prerelease", async () => {
  expect((await cutoffCandidates([dependency], cutoff, response({ ...npm, "dist-tags": { latest: "3.0.0-rc.1" },
    versions: { ...npm.versions, "3.0.0-rc.1": {} } })))[0].targetVersion).toBe("2.0.0");
});

it("uses PEP 440 and non-yanked Python artifact dates", async () => {
  const python = { ...dependency, ecosystem: "PyPI" as const, source: "requirements.txt", currentVersion: "1" };
  const metadata = { info: { name: "foo" }, releases: {
    "1.5": [{ yanked: false, upload_time_iso_8601: "2024-01-01T00:00:00Z" }],
    "2.0": [{ yanked: false, upload_time_iso_8601: "2026-01-01T00:00:00Z" }],
    "3.0": [{ yanked: true, upload_time_iso_8601: "2026-02-01T00:00:00Z" }],
    "4.0rc1": [{ yanked: false, upload_time_iso_8601: "2026-03-01T00:00:00Z" }],
  } };
  expect((await cutoffCandidates([python], cutoff, response(metadata)))[0].targetVersion).toBe("2.0");
  metadata.releases["2.0"][0].upload_time_iso_8601 = "invalid";
  expect(await cutoffCandidates([python], cutoff, response(metadata))).toEqual([]);
});

it("does not let a miner substitute a different target after the cutoff check", () => {
  const finding = { ...dependency, targetVersion: "3.0.0", issue: "outdated", reason: "upgrade", cves: [], sources: ["https://npmjs.com/foo"] };
  delete (finding as Partial<typeof finding>).declared;
  expect(() => parseFindings(JSON.stringify({ findings: [finding] }), [{ ...dependency, targetVersion: "2.0.0" }])).toThrow(/differs/);
});

it("uses the original Python release date, including earlier yanked artifacts", async () => {
  const python = { ...dependency, ecosystem: "PyPI" as const };
  expect(await cutoffCandidates([python], cutoff, response({ info: { name: "foo" }, releases: {
    "2.0": [{ yanked: true, upload_time_iso_8601: "2024-01-01T00:00:00Z" },
      { yanked: false, upload_time_iso_8601: "2026-01-01T00:00:00Z" }],
  } }))).toEqual([]);
});

it.each([429, 503])("keeps verified candidates when one dependency lookup fails with %s", async (status) => {
  const report = vi.fn();
  const failed = { ...dependency, package: "missing" };
  const fetchImpl: typeof fetch = async (input) => String(input).includes("/missing")
    ? new Response("", { status }) : new Response(JSON.stringify(npm));
  expect((await cutoffCandidates([dependency, failed, dependency], cutoff, fetchImpl, report)).map((entry) => entry.package))
    .toEqual(["foo", "foo"]);
  expect(report).toHaveBeenCalledTimes(1);
});
