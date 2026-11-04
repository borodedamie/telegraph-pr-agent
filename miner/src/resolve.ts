// Resolves the package and both versions against the npm registry (research R4, FR-003 to FR-005).
import semver from "semver";
import { z } from "zod";
import { canonicalJson } from "./cache.js";
import { fetchDocument, type Retrieval, type SourceDocument } from "./sources/fetch.js";
import type { NormalizedRequest } from "./types.js";

// Only the fields the miner uses are kept, hashed and snapshotted.
export const Packument = z.object({
  name: z.string(),
  versions: z.array(z.string()),
  time: z.record(z.string()),
  "dist-tags": z.record(z.string()),
  repository: z
    .union([z.string(), z.object({ type: z.string().optional(), url: z.string().optional(), directory: z.string().optional() })])
    .nullable(),
});
export type Packument = z.infer<typeof Packument>;

const RawPackument = z.object({
  name: z.string(),
  versions: z.record(z.unknown()),
  time: z.record(z.string()).default({}),
  "dist-tags": z.record(z.string()).default({}),
  repository: Packument.shape.repository.optional(),
});

export function reducePackument(body: string): string {
  const raw = RawPackument.parse(JSON.parse(body));
  const reduced: Packument = {
    name: raw.name,
    versions: Object.keys(raw.versions),
    time: raw.time,
    "dist-tags": raw["dist-tags"],
    repository: raw.repository ?? null,
  };
  return canonicalJson(reduced);
}

export function registryUrl(name: string): string {
  // Scoped names keep the @ and encode the slash: @scope%2Fname.
  return `https://registry.npmjs.org/${name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)}`;
}

export type ResolveResult =
  | {
      kind: "ok";
      request: NormalizedRequest;
      targetReleasedAt: string | null;
      /** Every published version, ascending. */
      versions: string[];
      packument: Packument;
      registry: SourceDocument;
    }
  | { kind: "unknown_package"; reason: string }
  | { kind: "needs_clarification"; reason: string; request: NormalizedRequest; registry: SourceDocument }
  | { kind: "version_missing"; reason: string; request: NormalizedRequest; registry: SourceDocument };

export interface Requested {
  package: string;
  fromRequested: string | null;
  toRequested: string;
}

export async function resolve(retrieval: Retrieval, requested: Requested): Promise<ResolveResult> {
  const registry = await fetchDocument(retrieval, registryUrl(requested.package), {
    headers: { accept: "application/json" },
    toText: reducePackument,
  });
  if (registry === null) return { kind: "unknown_package", reason: `no npm package named ${requested.package}` };
  const packument = Packument.parse(JSON.parse(registry.text));
  return resolveVersions(packument, registry, requested);
}

export function resolveVersions(packument: Packument, registry: SourceDocument, requested: Requested): ResolveResult {
  const versions = packument.versions.filter((v) => semver.valid(v) !== null).sort(semver.compare);
  const request: NormalizedRequest = {
    ecosystem: "npm",
    package: requested.package,
    fromRequested: requested.fromRequested,
    toRequested: requested.toRequested,
    fromResolved: null,
    toResolved: null,
    fromAssumed: false,
  };

  const to = resolveOne(versions, requested.toRequested);
  if (to === null) {
    return { kind: "version_missing", reason: missingReason(requested.package, requested.toRequested, versions), request, registry };
  }
  request.toResolved = to;

  let from: string | null;
  if (requested.fromRequested !== null) {
    from = resolveOne(versions, requested.fromRequested);
    if (from === null) {
      return { kind: "version_missing", reason: missingReason(requested.package, requested.fromRequested, versions), request, registry };
    }
  } else {
    const assumed = defaultFrom(versions, to);
    if (assumed.kind === "none") return { kind: "needs_clarification", reason: assumed.reason, request, registry };
    from = assumed.version;
    request.fromAssumed = true;
  }
  request.fromResolved = from;

  if (!semver.lt(from, to)) {
    return { kind: "needs_clarification", reason: `the "from" version ${from} is not lower than the target ${to}`, request, registry };
  }
  return { kind: "ok", request, targetReleasedAt: packument.time[to] ?? null, versions, packument, registry };
}

/** Names the published stable versions just below and above the one asked for (spec US2, scenario 2). */
function missingReason(name: string, spec: string, versions: string[]): string {
  const stable = versions.filter((v) => semver.prerelease(v) === null);
  const target = semver.coerce(spec)?.version;
  const closest = target
    ? [stable.filter((v) => semver.lte(v, target)).at(-1), stable.find((v) => semver.gt(v, target))]
    : [stable.at(-1)];
  const named = closest.filter((v): v is string => v !== undefined);
  const hint =
    named.length === 0
      ? "; it has no stable release"
      : `; the closest published ${named.length === 1 ? "version is" : "versions are"} ${named.join(" and ")}`;
  return `${name} has no published version ${spec}${hint}`;
}

/** An exact version must be published as written; a range resolves to its highest published match. */
function resolveOne(versions: string[], spec: string): string | null {
  const exact = semver.valid(spec);
  if (exact !== null) return versions.includes(exact) ? exact : null;
  if (semver.validRange(spec) === null) return null;
  return semver.maxSatisfying(versions, spec);
}

/** FR-004: the highest stable version below the target's major line, or below 0.y.0 for a 0.y.z target. */
export function defaultFrom(
  versions: string[],
  target: string
): { kind: "ok"; version: string } | { kind: "none"; reason: string } {
  const parsed = semver.parse(target)!;
  let bound: string;
  if (parsed.major >= 1) bound = `${parsed.major}.0.0`;
  else if (parsed.minor >= 1) bound = `0.${parsed.minor}.0`;
  else return { kind: "none", reason: `name the "from" version: ${target} is a 0.0.x release with no default` };

  const below = versions.filter((v) => semver.prerelease(v) === null && semver.lt(v, bound));
  if (below.length === 0) return { kind: "none", reason: `name the "from" version: no stable release below ${bound}` };
  return { kind: "ok", version: below[below.length - 1] };
}
