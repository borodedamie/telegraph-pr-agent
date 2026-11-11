import { commitLedgerRow, type AttemptRow } from "../../src/ledger.js";
import type { Ledger } from "./purchase";

export const RECONCILE_OUTCOMES = ["failed_and_credited", "failed_not_charged", "failed_and_charged"] as const;
export type ReconcileOutcome = typeof RECONCILE_OUTCOMES[number];

export interface Reconciliation {
  attemptId: string;
  outcome: ReconcileOutcome;
  note: string;
  actor: string;
  /** Required for failed_and_charged: the on-chain payment the person found. */
  txHash?: string;
  /** failed_and_charged only; defaults to the attempt's quote on its request_sent row. */
  amountUsdc?: number;
}

/** Validate the inputs before the ledger is opened. */
export const checkReconciliation = (input: Reconciliation): void => {
  if (!input.attemptId.trim()) throw new Error("reconcile-attempt-id is required");
  if (!RECONCILE_OUTCOMES.includes(input.outcome)) {
    throw new Error(`reconcile-outcome must be one of ${RECONCILE_OUTCOMES.join(", ")}`);
  }
  if (!input.note.trim() || input.note.length > 500) throw new Error("reconcile-note is required (at most 500 characters)");
  if (!input.actor.trim()) throw new Error("GITHUB_ACTOR is required to record who reconciled the attempt");
  if (input.txHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
    throw new Error("reconcile-tx-hash must be a 0x-prefixed 32-byte transaction hash");
  }
  if (input.outcome === "failed_and_charged" && input.txHash === undefined) {
    throw new Error("failed_and_charged needs reconcile-tx-hash: recorded spend must link to its on-chain payment");
  }
  if (input.amountUsdc !== undefined && !(Number.isFinite(input.amountUsdc) && input.amountUsdc > 0)) {
    throw new Error("reconcile-amount-usdc must be a positive number when set");
  }
};

/**
 * Close an attempt stuck at request_sent or unknown_needs_reconciliation with the outcome
 * a person established from the wallet, escrow balance and signal. Appends one row; the
 * same reconciliation run twice adds nothing.
 */
export const reconcileAttempt = async (ledger: Ledger, input: Reconciliation): Promise<void> => {
  checkReconciliation(input);
  await commitLedgerRow(ledger.directory, (fresh) => {
    const rows = fresh.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
      .filter((row): row is AttemptRow => row?.kind === "attempt" && row.attemptId === input.attemptId);
    const latest = rows.at(-1);
    if (!latest) throw new Error(`No attempt ${input.attemptId} on the ledger`);
    if (latest.reconciledBy && latest.state === input.outcome) return [];
    if (latest.state !== "request_sent" && latest.state !== "unknown_needs_reconciliation") {
      throw new Error(`Attempt ${input.attemptId} is ${latest.state}; only request_sent or unknown_needs_reconciliation can be reconciled`);
    }
    const charged = input.outcome === "failed_and_charged"
      ? input.amountUsdc ?? rows.map((row) => row.quotedAmountUsdc).filter((amount) => typeof amount === "number").at(-1)
      : undefined;
    if (input.outcome === "failed_and_charged" && charged === undefined) {
      throw new Error(`Attempt ${input.attemptId} has no quote; set reconcile-amount-usdc to the amount charged`);
    }
    const row: AttemptRow = {
      kind: "attempt", repo: latest.repo, headSha: latest.headSha, step: latest.step,
      ...(latest.prNumber === undefined ? {} : { prNumber: latest.prNumber }),
      ...(latest.assessmentId === undefined ? {} : { assessmentId: latest.assessmentId }),
      ...(latest.model === undefined ? {} : { model: latest.model }),
      attemptId: latest.attemptId, attempt: latest.attempt, state: input.outcome, minerId: latest.minerId,
      reason: `reconciled: ${input.note}`, reconciledBy: input.actor,
      ...(input.txHash === undefined ? {} : { txHash: input.txHash }),
      ...(charged === undefined ? {} : { chargedAmountUsdc: charged }),
      timestamp: new Date().toISOString(),
    };
    return row;
  }, ledger);
};
