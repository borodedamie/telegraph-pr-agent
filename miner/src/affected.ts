// The OSV affected check for one version (data-model.md, Advisory): every range and the explicit versions list.
import semver from "semver";
import type { Advisory } from "./types.js";

type Affected = Advisory["fromAffected"];
type Range = Advisory["ranges"][number];

/** `introduced: "0"` is OSV's "since the first version": not semver, so it sorts first and is never compared. */
const ZERO = "0";

function eventVersion(event: Range["events"][number]): string | undefined {
  return event.introduced ?? event.fixed ?? event.lastAffected ?? event.limit;
}

function compareEvents(a: Range["events"][number], b: Range["events"][number]): number {
  const va = eventVersion(a)!;
  const vb = eventVersion(b)!;
  if (va === ZERO || vb === ZERO) return va === vb ? 0 : va === ZERO ? -1 : 1;
  return semver.compare(va, vb);
}

/** One SEMVER or ECOSYSTEM range; null when an event version is not semver. */
function inRange(range: Range, version: string): boolean | null {
  const events = range.events.filter((e) => eventVersion(e) !== undefined);
  if (events.some((e) => eventVersion(e) !== ZERO && semver.valid(eventVersion(e)!) === null)) return null;
  events.sort(compareEvents);
  // Walk in version order: each event at or below V switches the state, so V ends in the last interval it reached.
  let affected = false;
  for (const event of events) {
    if (event.introduced !== undefined && (event.introduced === ZERO || semver.gte(version, event.introduced))) affected = true;
    else if (event.fixed !== undefined && semver.gte(version, event.fixed)) affected = false;
    else if (event.lastAffected !== undefined && semver.gt(version, event.lastAffected)) affected = false;
  }
  const limit = events.find((e) => e.limit !== undefined)?.limit;
  if (limit !== undefined && semver.gte(version, limit)) return false;
  return affected;
}

export function isAffected(advisory: Pick<Advisory, "affectedVersions" | "ranges">, version: string): Affected {
  if (advisory.affectedVersions.includes(version)) return "yes";
  let unreadable = false;
  let evaluated = false;
  for (const range of advisory.ranges) {
    // GIT ranges name commits, not versions; other types are not defined for npm.
    if (range.type !== "SEMVER" && range.type !== "ECOSYSTEM") continue;
    const result = inRange(range, version);
    if (result === null) {
      unreadable = true;
      continue;
    }
    evaluated = true;
    if (result) return "yes";
  }
  if (unreadable) return "unknown";
  // A versions list alone is complete data; with neither ranges nor versions there is nothing to go on.
  return evaluated || advisory.affectedVersions.length > 0 ? "no" : "unknown";
}
