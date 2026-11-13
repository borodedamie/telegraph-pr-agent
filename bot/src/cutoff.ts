import semver from "semver";
import * as pep440 from "@renovatebot/pep440";
import { detectCutoffTriggers } from "./trigger.js";
import { isUpgrade } from "./assessment.js";
import type { Dependency } from "./scan.js";

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected registry object");
  return value as Record<string, unknown>;
};

type PythonFile = { yanked?: boolean; upload_time_iso_8601?: string };

export const cutoffCandidates = async (
  dependencies: Dependency[],
  cutoff: Date,
  fetchImpl: typeof fetch = fetch,
  report: (dependency: Dependency, error: unknown) => void = (
    dependency,
    error,
  ) =>
    console.warn(
      `${dependency.package}: ${error instanceof Error ? error.message : String(error)}`,
    ),
): Promise<Dependency[]> => {
  if (!Number.isFinite(cutoff.getTime()))
    throw new Error("MODEL_CUTOFF must be a valid date");
  const candidates: Dependency[] = [];
  for (const dependency of dependencies) {
    try {
      const npm = dependency.ecosystem === "npm";
      const response = await fetchImpl(
        npm
          ? `https://registry.npmjs.org/${encodeURIComponent(dependency.package)}`
          : `https://pypi.org/pypi/${encodeURIComponent(dependency.package)}/json`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (response.status === 404) continue;
      if (!response.ok)
        throw new Error(`Registry lookup failed: HTTP ${response.status}`);
      const metadata = asObject(await response.json());
      const name = npm ? metadata.name : asObject(metadata.info ?? {}).name;
      if (
        typeof name !== "string" ||
        (npm ? name : name.toLowerCase().replace(/[-_.]+/g, "-")) !==
          dependency.package
      )
        continue;
      let targetVersion: string | undefined;
      let releaseDate: string | undefined;
      if (npm) {
        const versions = asObject(metadata.versions ?? {});
        const latest = asObject(metadata["dist-tags"] ?? {}).latest;
        targetVersion =
          typeof latest === "string" &&
          semver.valid(latest) &&
          !semver.prerelease(latest) &&
          versions[latest]
            ? latest
            : Object.keys(versions)
                .filter((v) => semver.valid(v) && !semver.prerelease(v))
                .sort(semver.rcompare)[0];
        if (
          !targetVersion ||
          !isUpgrade(dependency.currentVersion, targetVersion, "npm")
        )
          continue;
        const triggers = await detectCutoffTriggers(
          {
            basePackageJson: JSON.stringify({
              dependencies: { [dependency.package]: dependency.currentVersion },
            }),
            headPackageJson: JSON.stringify({
              dependencies: { [dependency.package]: targetVersion },
            }),
          },
          cutoff,
          async () => new Response(JSON.stringify(metadata)),
        );
        releaseDate =
          triggers.find((t) => t.status === "past-cutoff")?.releaseDate ??
          undefined;
      } else {
        const releases = asObject(metadata.releases ?? {});
        targetVersion = Object.keys(releases)
          .filter((v) => {
            const parsed = pep440.explain(v);
            const files = releases[v];
            return (
              parsed &&
              !parsed.is_prerelease &&
              !parsed.is_devrelease &&
              !parsed.local &&
              Array.isArray(files) &&
              files.some((file: PythonFile) => file.yanked === false)
            );
          })
          .sort(pep440.rcompare)[0];
        if (
          !targetVersion ||
          !isUpgrade(dependency.currentVersion, targetVersion, "PyPI")
        )
          continue;
        const files = releases[targetVersion] as PythonFile[];
        const dates = files.map((file) => file.upload_time_iso_8601);
        if (dates.some((date) => !date || !Number.isFinite(Date.parse(date))))
          continue;
        releaseDate = new Date(
          Math.min(...dates.map((date) => Date.parse(date!))),
        ).toISOString();
      }
      if (
        releaseDate &&
        Date.parse(releaseDate) > cutoff.getTime() &&
        Date.parse(releaseDate) <= Date.now()
      ) {
        candidates.push({ ...dependency, targetVersion, releaseDate });
      }
    } catch (error) {
      report(dependency, error);
    }
  }
  return candidates;
};
