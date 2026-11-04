// Which releases an answer must consider, and which of them it covered (FR-012, FR-015).
import semver from "semver";
import type { Coverage } from "./types.js";

export type NotCoveredReason = Coverage["notCovered"][number]["reason"];

/**
 * Every published release with from < v ≤ to, ascending. Prereleases count only when the target is one,
 * and then only those of the target's own version line.
 */
export function releasesBetween(versions: string[], from: string, to: string): string[] {
  const target = semver.parse(to)!;
  return versions
    .filter((v) => semver.gt(v, from) && semver.lte(v, to))
    .filter((v) => {
      const pre = semver.prerelease(v);
      if (pre === null) return true;
      if (target.prerelease.length === 0) return false;
      const parsed = semver.parse(v)!;
      return parsed.major === target.major && parsed.minor === target.minor && parsed.patch === target.patch;
    })
    .sort(semver.compare);
}

/** Tracks each release's state; a release with no state at the end had no material. */
export class CoverageTracker {
  private readonly states = new Map<string, "covered" | NotCoveredReason>();

  constructor(readonly releases: string[]) {}

  covered(version: string): void {
    this.states.set(version, "covered");
  }

  notCovered(version: string, reason: NotCoveredReason): void {
    if (this.states.get(version) !== "covered") this.states.set(version, reason);
  }

  /** Takes back a release that had material but was not fully read (the model could not fit it). */
  uncover(version: string, reason: NotCoveredReason): void {
    this.states.set(version, reason);
  }

  /** The current states, for restore when a retrieval step fails and its material is thrown away. */
  save(): Map<string, "covered" | NotCoveredReason> {
    return new Map(this.states);
  }

  restore(saved: Map<string, "covered" | NotCoveredReason>): void {
    this.states.clear();
    for (const [version, state] of saved) this.states.set(version, state);
  }

  state(version: string): "covered" | NotCoveredReason | undefined {
    return this.states.get(version);
  }

  /** Releases that still have no material. */
  missing(): string[] {
    return this.releases.filter((v) => !this.states.has(v));
  }

  result(): Coverage {
    const covered: string[] = [];
    const notCovered: Coverage["notCovered"] = [];
    for (const version of this.releases) {
      const state = this.states.get(version) ?? "no_material";
      if (state === "covered") covered.push(version);
      else notCovered.push({ version, reason: state });
    }
    return { complete: notCovered.length === 0, covered, notCovered };
  }
}
