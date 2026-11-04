// Fixed answer served by GET /api/answer until the pipeline lands (T017, replaced in T043).
import type { Answer } from "./types.js";
import { PROCESSING_VERSION } from "./version.js";

export function stubAnswer(): Answer {
  return {
    answer:
      "This miner answers what changed in an npm package between two versions. " +
      "It is not answering questions yet: this endpoint is a placeholder while the pipeline is built.",
    summary: "Placeholder: no package version-change analysis was run.",
    outcome: "out_of_scope",
    confidence: 0.9,
    request: null,
    targetReleasedAt: null,
    changes: [],
    security: { status: "not_checked", checkedAt: null, advisories: [], documentedFixes: 0 },
    coverage: null,
    sources: [],
    clarification: null,
    processingVersion: PROCESSING_VERSION,
  };
}
