// Boundary schemas from specs/001-package-release-miner/data-model.md.
import { z } from "zod";

export const Outcome = z.enum([
  "found",
  "not_found",
  "needs_clarification",
  "out_of_scope",
  "temporarily_unavailable",
]);
export type Outcome = z.infer<typeof Outcome>;

const isoTimestamp = z.string().datetime({ offset: true });
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const NormalizedRequest = z.object({
  ecosystem: z.literal("npm"),
  package: z.string().min(1),
  fromRequested: z.string().nullable(),
  toRequested: z.string().nullable(),
  fromResolved: z.string().nullable(),
  toResolved: z.string().nullable(),
  fromAssumed: z.boolean(),
});
export type NormalizedRequest = z.infer<typeof NormalizedRequest>;

export const ReleaseSource = z
  .object({
    id: z.string().regex(/^s\d+$/),
    type: z.enum(["registry", "release", "changelog", "tag_compare", "advisory"]),
    url: z.string().url(),
    retrievedAt: isoTimestamp,
    versionFrom: z.string().nullable(),
    versionTo: z.string().nullable(),
    contentHash: sha256Hex,
    snapshotKey: z.string().startsWith("snap:"),
    trust: z.enum(["official", "repository_evidence", "advisory_db"]),
  })
  .superRefine((source, ctx) => {
    if (source.type === "tag_compare" && source.trust !== "repository_evidence") {
      ctx.addIssue({ code: "custom", message: "tag_compare sources are repository_evidence" });
    }
    if (source.type === "advisory" && source.trust !== "advisory_db") {
      ctx.addIssue({ code: "custom", message: "advisory sources are advisory_db" });
    }
  });
export type ReleaseSource = z.infer<typeof ReleaseSource>;

export const ChangeItem = z
  .object({
    id: z.string().regex(/^c\d+$/),
    kind: z.enum(["breaking", "deprecation", "security_fix"]),
    version: z.string().min(1),
    evidenceType: z.enum(["documented", "repository_evidence", "inferred"]),
    change: z.string().min(1),
    excerpt: z.string().min(1).nullable(),
    inferredFrom: z.array(z.string()),
    migration: z.string().min(1).nullable(),
    migrationEvidence: z.enum(["documented", "inferred", "manual_review"]),
    migrationExcerpt: z.string().min(1).nullable(),
    migrationSourceId: z.string().nullable(),
    migrationInferredFrom: z.array(z.string()),
    ids: z.array(z.string()),
    sourceId: z.string(),
  })
  .superRefine((item, ctx) => {
    if (item.evidenceType !== "inferred" && item.excerpt === null) {
      ctx.addIssue({ code: "custom", message: `${item.id}: documented and repository items need an excerpt` });
    }
    if (item.evidenceType === "inferred" && item.inferredFrom.length === 0) {
      ctx.addIssue({ code: "custom", message: `${item.id}: inferred items name what they are inferred from` });
    }
    if ((item.migrationEvidence === "manual_review") !== (item.migration === null)) {
      ctx.addIssue({ code: "custom", message: `${item.id}: migration is null exactly when manual_review` });
    }
    if (item.migrationEvidence === "documented" && (item.migrationExcerpt === null || item.migrationSourceId === null)) {
      ctx.addIssue({ code: "custom", message: `${item.id}: documented migration needs its own excerpt and source` });
    }
    if (item.migrationEvidence === "inferred" && item.migrationInferredFrom.length === 0) {
      ctx.addIssue({ code: "custom", message: `${item.id}: inferred migration names its evidence` });
    }
  });
export type ChangeItem = z.infer<typeof ChangeItem>;

const affectedState = z.enum(["yes", "no", "unknown"]);

export const Advisory = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string()),
  severity: z.array(z.object({ type: z.string(), score: z.string() })),
  displaySeverity: z.enum(["critical", "high", "moderate", "low", "unknown"]),
  affectedVersions: z.array(z.string()),
  ranges: z.array(
    z.object({
      type: z.string(),
      events: z.array(
        z.object({
          introduced: z.string().optional(),
          fixed: z.string().optional(),
          lastAffected: z.string().optional(),
          limit: z.string().optional(),
        })
      ),
    })
  ),
  fromAffected: affectedState,
  targetAffected: affectedState,
  conclusion: z.enum(["fixed_by_upgrade", "still_affected", "introduced_by_upgrade", "not_applicable", "unknown"]),
  releaseNoteItemId: z.string().nullable(),
  sourceId: z.string(),
});
export type Advisory = z.infer<typeof Advisory>;

export const Security = z.object({
  status: z.enum(["complete", "partial", "unavailable", "not_checked"]),
  checkedAt: isoTimestamp.nullable(),
  advisories: z.array(Advisory),
  documentedFixes: z.number().int().nonnegative(),
});
export type Security = z.infer<typeof Security>;

export const Coverage = z.object({
  complete: z.boolean(),
  covered: z.array(z.string()),
  notCovered: z.array(
    z.object({
      version: z.string(),
      reason: z.enum(["no_material", "unmatched", "budget", "upstream_unavailable", "truncated"]),
    })
  ),
});
export type Coverage = z.infer<typeof Coverage>;

export const Answer = z
  .object({
    answer: z.string().min(1),
    summary: z.string().min(1),
    outcome: Outcome,
    confidence: z.number().min(0).max(1),
    request: NormalizedRequest.nullable(),
    targetReleasedAt: isoTimestamp.nullable(),
    changes: z.array(ChangeItem),
    security: Security,
    coverage: Coverage.nullable(),
    sources: z.array(ReleaseSource),
    clarification: z.string().nullable(),
    processingVersion: z.string().min(1),
  })
  .superRefine((answer, ctx) => {
    if (answer.outcome === "found" && answer.coverage === null) {
      ctx.addIssue({ code: "custom", message: "found answers carry coverage (FR-015)" });
    }
    const sourceIds = new Set(answer.sources.map((s) => s.id));
    const changeIds = new Set(answer.changes.map((c) => c.id));
    const missing = (id: string, where: string) =>
      ctx.addIssue({ code: "custom", message: `${where} references unknown id ${id}` });

    for (const item of answer.changes) {
      if (!sourceIds.has(item.sourceId)) missing(item.sourceId, `${item.id}.sourceId`);
      if (item.migrationSourceId !== null && !sourceIds.has(item.migrationSourceId)) {
        missing(item.migrationSourceId, `${item.id}.migrationSourceId`);
      }
      for (const id of item.inferredFrom) if (!changeIds.has(id)) missing(id, `${item.id}.inferredFrom`);
      for (const id of item.migrationInferredFrom) {
        if (!changeIds.has(id) && !sourceIds.has(id)) missing(id, `${item.id}.migrationInferredFrom`);
      }
    }
    for (const advisory of answer.security.advisories) {
      if (!sourceIds.has(advisory.sourceId)) missing(advisory.sourceId, `${advisory.id}.sourceId`);
      if (advisory.releaseNoteItemId !== null && !changeIds.has(advisory.releaseNoteItemId)) {
        missing(advisory.releaseNoteItemId, `${advisory.id}.releaseNoteItemId`);
      }
    }
  });
export type Answer = z.infer<typeof Answer>;

export const MetricsRecord = z.object({
  requestHash: z.string(),
  authOk: z.boolean(),
  cacheHit: z.boolean(),
  outcome: Outcome.nullable(),
  declaredFailure: z.boolean(),
  extractorMode: z.enum(["rules_only", "rules_and_model"]).nullable(),
  msResolve: z.number().nonnegative(),
  msFetch: z.number().nonnegative(),
  msModel: z.number().nonnegative(),
  msTotal: z.number().nonnegative(),
  upstreamRequests: z.number().int().nonnegative(),
  conditionalHits: z.number().int().nonnegative(),
  llmMinerId: z.string().nullable(),
  modelCalls: z.number().int().nonnegative(),
  modelInputChars: z.number().int().nonnegative(),
  modelCostUsdc: z.number().nonnegative(),
  llmFailure: z.enum(["timeout", "invalid_reply", "payment"]).nullable(),
  budgetExhausted: z.string().nullable(),
});
export type MetricsRecord = z.infer<typeof MetricsRecord>;
