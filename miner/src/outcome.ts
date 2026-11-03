// Outcome and confidence (data-model.md): decided from what happened, never hardcoded.
import type { Answer, ChangeItem, Coverage, Outcome, Security } from "./types.js";

export type OutcomeState =
  | { stage: "parse"; kind: "needs_clarification" | "out_of_scope" }
  | { stage: "resolve"; kind: "unknown_package" | "needs_clarification" | "version_missing" }
  | { stage: "upstream_unavailable" }
  | { stage: "retrieved"; coverage: Coverage; optionalSourceFailed: boolean };

export function selectOutcome(state: OutcomeState): Outcome {
  switch (state.stage) {
    case "parse":
      return state.kind;
    case "resolve":
      if (state.kind === "unknown_package") return "out_of_scope";
      if (state.kind === "version_missing") return "not_found";
      return "needs_clarification";
    case "upstream_unavailable":
      return "temporarily_unavailable";
    case "retrieved":
      // Found means at least one release between A and B had material to read.
      return state.coverage.covered.length > 0 ? "found" : "not_found";
  }
}

export function confidence(
  answer: Pick<Answer, "outcome" | "coverage"> & { changes: ChangeItem[]; security: Pick<Security, "status"> },
  optionalSourceFailed = false
): number {
  let value: number;
  switch (answer.outcome) {
    case "found": {
      if (!answer.coverage?.complete) value = 0.5;
      else if (answer.changes.every((c) => c.evidenceType === "documented")) value = 0.9;
      else value = 0.7;
      break;
    }
    case "not_found":
      value = optionalSourceFailed ? 0.6 : 0.8;
      break;
    case "needs_clarification":
    case "out_of_scope":
      return 0.9;
    case "temporarily_unavailable":
      return 0;
  }
  // The OSV check is not wired in yet (T053); not_checked answers carry no security penalty until it is.
  if (answer.security.status !== "complete" && answer.security.status !== "not_checked") value -= 0.1;
  return Math.round(value * 100) / 100;
}
