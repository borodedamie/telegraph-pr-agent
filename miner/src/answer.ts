// The answer pipeline, in the data-model.md lifecycle order:
// parse → resolve → releases → retrieval → cache lookup → extract → verify → coverage → outcome → render → store.
import semver from "semver";
import { Budget, limitsFromEnv, type BudgetLimits } from "./budget.js";
import {
  acquireLock,
  answerKey,
  getAnswer,
  getRepeat,
  isCacheable,
  putAnswer,
  putRepeat,
  releaseLock,
  repeatKey,
  waitForAnswer,
  type Store,
} from "./cache.js";
import { CoverageTracker, releasesBetween } from "./coverage.js";
import type { Candidate } from "./extract/candidate.js";
import { extractModel, llmMinersFromEnv, telegraphCaller, type ModelCaller, type ModelResult } from "./extract/model.js";
import { extractRules } from "./extract/rules.js";
import { verify, type VerifySource } from "./extract/verify.js";
import { confidence, selectOutcome, type OutcomeState } from "./outcome.js";
import { parse } from "./parse.js";
import { render, type Lookups } from "./render.js";
import { resolve } from "./resolve.js";
import { Timeout, TooLarge, Upstream, safeFetch } from "./safeFetch.js";
import { retrieveComparisons } from "./sources/compare.js";
import { BudgetExhausted, newRetrieval, type Retrieval, type SourceDocument } from "./sources/fetch.js";
import { githubHeaders, repoIdentity, retrieveReleaseNotes, type Consulted, type Material } from "./sources/github.js";
import { OSV_QUERY_URL, advisoriesFor, type OsvResult } from "./sources/osv.js";
import { correlate } from "./correlate.js";
import { Answer, type ChangeItem, type MetricsRecord, type NormalizedRequest, type ReleaseSource, type Security } from "./types.js";
import { PROCESSING_VERSION } from "./version.js";

export interface PipelineDeps {
  store: Store;
  env: NodeJS.ProcessEnv;
  fetcher?: typeof safeFetch;
  /** Overrides the Telegraph caller; null means no model. */
  caller?: ModelCaller | null;
  limits?: BudgetLimits;
  now?: () => number;
  /** When the request arrived, for the "a full budget still fits before maxDuration" check. */
  startedAt?: number;
  /** Reserves a first-time computation slot (auth.ts enterCompute); throws ComputeRefused when none is free. */
  enterCompute?: () => Promise<() => Promise<void>>;
}

export class ComputeRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ComputeRefused";
  }
}

export interface PipelineResult {
  json: string;
  answer: Answer;
  cacheHit: boolean;
  metrics: Omit<MetricsRecord, "requestHash" | "authOk" | "headerNames" | "msTotal">;
}

/** Vercel kills the function at maxDuration (vercel.json). */
const MAX_DURATION_MS = 30_000;
const LOCK_WAIT_DEFAULT_MS = 5_000;
const PARTIAL_ANSWER_TTL_SEC = 3_600;

const NOT_CHECKED: Security = { status: "not_checked", checkedAt: null, advisories: [], documentedFixes: 0 };

function emptyMetrics(): PipelineResult["metrics"] {
  return {
    cacheHit: false, outcome: null, declaredFailure: false, extractorMode: null,
    msResolve: 0, msFetch: 0, msModel: 0, upstreamRequests: 0, conditionalHits: 0,
    llmMinerId: null, modelCalls: 0, modelInputChars: 0, modelCostUsdc: 0, llmFailure: null, budgetExhausted: null,
    package: null, fromVersion: null, toVersion: null, changes: 0, confidence: null, releasesCovered: 0, notCovered: {},
    rulesItems: 0, modelItems: 0, modelItemsKept: 0, modelDrops: {}, modelSectionsCut: 0, modelSectionsSkipped: 0, modelSectionsFailed: 0,
  };
}

/** The answer's own fields in the metrics record, for computed and cached answers alike. */
function describeAnswer(answer: Answer, metrics: PipelineResult["metrics"]): void {
  metrics.outcome = answer.outcome;
  metrics.package = answer.request?.package ?? null;
  metrics.fromVersion = answer.request?.fromResolved ?? null;
  metrics.toVersion = answer.request?.toResolved ?? null;
  metrics.changes = answer.changes.length;
  metrics.confidence = answer.confidence;
  metrics.releasesCovered = answer.coverage?.covered.length ?? 0;
  metrics.notCovered = countBy((answer.coverage?.notCovered ?? []).map((gap) => gap.reason));
}

function countBy(keys: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

function isUpstreamFailure(err: unknown): boolean {
  return err instanceof Upstream || err instanceof Timeout;
}

/** The release order used when the release budget cuts: target, then x.y.0 releases, then newest first. */
function releasePriority(releases: string[], target: string): string[] {
  const rank = (v: string) => (v === target ? 0 : semver.patch(v) === 0 ? 1 : 2);
  return [...releases].sort((a, b) => rank(a) - rank(b) || semver.rcompare(a, b));
}

export async function answerQuestion(query: string, deps: PipelineDeps): Promise<PipelineResult> {
  const now = deps.now ?? Date.now;
  const startedAt = deps.startedAt ?? now();
  const metrics = emptyMetrics();
  const limits = deps.limits ?? limitsFromEnv(deps.env);
  // The configured LLM miners are part of every key; the miner actually used and the mode are added per answer.
  const processingBase = `${PROCESSING_VERSION}-miners_${(deps.env.LLM_MINERS ?? "").replace(/[^0-9,]/g, "").replace(/,/g, "_") || "none"}`;

  const finish = (answer: Answer): PipelineResult => {
    const parsed = Answer.parse(answer);
    describeAnswer(parsed, metrics);
    metrics.declaredFailure = parsed.outcome === "temporarily_unavailable";
    return { json: JSON.stringify(parsed), answer: parsed, cacheHit: false, metrics };
  };
  const simple = (
    outcome: Answer["outcome"],
    request: NormalizedRequest | null,
    sources: ReleaseSource[],
    note: { clarification?: string; summary?: string } = {}
  ): Answer => {
    const base = {
      outcome, request, targetReleasedAt: null, changes: [], security: NOT_CHECKED, coverage: null, sources,
      clarification: note.clarification ?? null, processingVersion: `${processingBase}-none`,
    };
    const rendered = render(base, false);
    const summary = note.summary ?? rendered.summary;
    // A not_found from resolve states its own reason in place of the generic "no release material" line.
    const lines = rendered.answer.split("\n");
    const text = !note.summary ? rendered.answer : [note.summary, ...(outcome === "not_found" ? lines.slice(1) : lines)].join("\n");
    return { ...base, answer: text, summary, confidence: confidence(base) };
  };

  // 1. Parse
  const parsed = parse(query);
  if (parsed.kind !== "ok") {
    return finish(simple(parsed.kind, null, [], parsed.kind === "needs_clarification" ? { clarification: parsed.reason } : { summary: `Out of scope: ${parsed.reason}.` }));
  }

  // For the T063 outage check: environment only, never a request parameter.
  if (deps.env.SIMULATE_UPSTREAM_OUTAGE === "1") {
    console.warn(JSON.stringify({ kind: "simulated_upstream_outage" }));
    return finish(simple("temporarily_unavailable", null, []));
  }

  // A repeat within the pointer's hour is served without touching npm, GitHub or OSV (SC-006 repeat latency).
  const repeat = repeatKey(parsed, processingBase);
  const repeated = await getRepeat(deps.store, repeat);
  if (repeated !== null) return fromCache(repeated, metrics);

  const budget = new Budget(limits, now);
  const retrieval = newRetrieval(deps.store, budget, deps.fetcher ?? safeFetch);
  try {
    // 2. Resolve
    const resolveStart = now();
    let resolved: Awaited<ReturnType<typeof resolve>>;
    try {
      resolved = await resolve(retrieval, parsed);
    } catch (err) {
      if (!isUpstreamFailure(err) && !(err instanceof BudgetExhausted) && !(err instanceof TooLarge)) throw err;
      console.warn(JSON.stringify({ kind: "registry_unavailable", error: String(err) }));
      return finish(simple("temporarily_unavailable", null, []));
    } finally {
      metrics.msResolve = now() - resolveStart;
    }
    if (resolved.kind === "unknown_package") {
      return finish(simple(selectOutcome({ stage: "resolve", kind: "unknown_package" }), null, [], { summary: `Out of scope: ${resolved.reason}.` }));
    }
    const registrySource = toSource("s1", "registry", resolved.registry, null, resolved.request.toResolved, "official");
    if (resolved.kind !== "ok") {
      const outcome = selectOutcome({ stage: "resolve", kind: resolved.kind });
      return finish(
        simple(outcome, resolved.request, [registrySource], outcome === "needs_clarification" ? { clarification: resolved.reason } : { summary: `Not found: ${resolved.reason}.` })
      );
    }

    const request = resolved.request;
    const from = request.fromResolved!;
    const to = request.toResolved!;

    // 3. Releases between A and B, within the release budget.
    const releases = releasesBetween(resolved.versions, from, to);
    const tracker = new CoverageTracker(releases);
    for (const version of releasePriority(releases, to)) {
      if (!budget.takeRelease()) tracker.notCovered(version, "budget");
    }

    // 4. Retrieval, decided before any extraction. OSV first: two small queries whose hashes join the key.
    const fetchStart = now();
    const osv = await advisoriesFor(retrieval, request.package, [from, to]);
    const material: Material = { consulted: [], sections: [] };
    let upstreamFailed = false;
    let retrievalCut = false;
    const tooLargeFor = new Set<string>();
    const repo = repoIdentity(resolved.packument.repository);
    if ("reason" in repo) {
      console.info(JSON.stringify({ kind: "no_repository", package: request.package, reason: repo.reason }));
    } else {
      const steps = [
        () => retrieveReleaseNotes(retrieval, repo, resolved.packument, from, tracker, deps.env),
        () => retrieveComparisons(retrieval, repo, from, tracker, (v) => (material.tagTemplate ?? "v{v}").replace("{v}", v), githubHeaders(deps.env)),
      ];
      for (const step of steps) {
        if (tracker.missing().length === 0) break;
        const saved = tracker.save();
        try {
          const found = await step();
          material.consulted.push(...found.consulted);
          const offset = material.consulted.length - found.consulted.length;
          material.sections.push(...found.sections.map((s) => ({ ...s, consulted: s.consulted + offset })));
          material.tagTemplate ??= found.tagTemplate;
          material.optionalSourceFailed ||= found.optionalSourceFailed;
          for (const version of found.tooLargeFor ?? []) tooLargeFor.add(version);
        } catch (err) {
          // The step's material is lost with it, so the releases it marked covered are not.
          tracker.restore(saved);
          if (err instanceof TooLarge) {
            // A document over the size cap: the next step may still cover these releases.
            console.warn(JSON.stringify({ kind: "source_too_large", error: String(err) }));
            for (const version of tracker.missing()) tooLargeFor.add(version);
            continue;
          }
          // budget.signal fires on the hard deadline; the safeFetch it aborts throws Timeout.
          if (err instanceof BudgetExhausted || budget.signal.aborted) {
            retrievalCut = true;
            for (const version of tracker.missing()) tracker.notCovered(version, "budget");
            break;
          }
          if (!isUpstreamFailure(err)) throw err;
          console.warn(JSON.stringify({ kind: "github_unavailable", error: String(err) }));
          upstreamFailed = true;
          for (const version of tracker.missing()) tracker.notCovered(version, "upstream_unavailable");
          break;
        }
      }
    }
    // A step that met the source budget or deadline returns what it read; what it did not reach was cut.
    if (budget.hit("time") || budget.hit("source_requests")) {
      retrievalCut = true;
      for (const version of tracker.missing()) tracker.notCovered(version, "budget");
    }
    // Only the releases an oversized source would have covered are truncated; the rest keep their own reason.
    for (const version of tracker.missing()) if (tooLargeFor.has(version)) tracker.notCovered(version, "truncated");
    metrics.msFetch = now() - fetchStart;
    metrics.upstreamRequests = retrieval.upstreamRequests;
    metrics.conditionalHits = retrieval.conditionalHits;

    // Nothing read because GitHub failed or the budget ran out is not evidence that nothing exists.
    if ((upstreamFailed || retrievalCut) && tracker.result().covered.length === 0) {
      return finish(simple(selectOutcome({ stage: "upstream_unavailable" }), request, [registrySource]));
    }

    // 5. The consulted set is fixed: look up the answer cache.
    const hashes = [...new Set(retrieval.documents.map((d) => d.contentHash))];
    const key = answerKey(request, hashes, processingBase);
    const cached = await getAnswer(deps.store, key);
    if (cached !== null) {
      await putRepeat(deps.store, repeat, key);
      return fromCache(cached, metrics);
    }

    const locked = await acquireLock(deps.store, key, limits.maxTimeMs);
    if (!locked) {
      const waited = await waitForAnswer(deps.store, key, Number(deps.env.LOCK_WAIT_MS || LOCK_WAIT_DEFAULT_MS));
      if (waited !== null) {
        await putRepeat(deps.store, repeat, key);
        return fromCache(waited, metrics);
      }
      if (now() - startedAt + limits.maxTimeMs > MAX_DURATION_MS) {
        return finish(simple("temporarily_unavailable", request, [registrySource]));
      }
    }
    let leave: (() => Promise<void>) | null = null;
    try {
      if (deps.enterCompute) leave = await deps.enterCompute();
      const { answer, complete } = await compute(request, resolved.targetReleasedAt, registrySource, material, tracker, budget, deps, metrics, processingBase, {
        // Both lower the confidence band; only an outage (retried next time) also keeps the answer out of the cache.
        optionalSourceFailed: tooLargeFor.size > 0 || material.optionalSourceFailed === true,
        // The advisory check has its own line; these lists name the release material looked up.
        lookups: {
          checked: retrieval.checked.filter((url) => url !== OSV_QUERY_URL),
          unreadable: retrieval.unreadable.filter((url) => url !== OSV_QUERY_URL),
        },
        osv,
      });
      const result = finish(answer);
      // A full answer is kept. One with text left unread (the model pass did not run, an optional source was down)
      // is kept for an hour: a repeat gets the same bytes at once (SC-006), and a later one retries the sources.
      const full = complete && !material.optionalSourceFailed;
      if (await putAnswer(deps.store, key, result.answer, result.json, full ? undefined : PARTIAL_ANSWER_TTL_SEC)) {
        await putRepeat(deps.store, repeat, key);
      }
      return result;
    } finally {
      if (leave) await leave();
      if (locked) await releaseLock(deps.store, key);
    }
  } finally {
    metrics.budgetExhausted = budget.exhausted();
    budget.dispose();
  }
}

function fromCache(json: string, metrics: PipelineResult["metrics"]): PipelineResult {
  const answer = Answer.parse(JSON.parse(json));
  metrics.cacheHit = true;
  describeAnswer(answer, metrics);
  return { json, answer, cacheHit: true, metrics };
}

function toSource(
  id: string,
  type: ReleaseSource["type"],
  document: SourceDocument,
  versionFrom: string | null,
  versionTo: string | null,
  trust: ReleaseSource["trust"],
  url = document.url
): ReleaseSource {
  return { id, type, url, retrievedAt: document.retrievedAt, versionFrom, versionTo, contentHash: document.contentHash, snapshotKey: document.snapshotKey, trust };
}

async function compute(
  request: NormalizedRequest,
  targetReleasedAt: string | null,
  registrySource: ReleaseSource,
  material: Material,
  tracker: CoverageTracker,
  budget: Budget,
  deps: PipelineDeps,
  metrics: PipelineResult["metrics"],
  processingBase: string,
  { optionalSourceFailed, lookups, osv }: { optionalSourceFailed: boolean; lookups: Lookups; osv: OsvResult }
): Promise<{ answer: Answer; complete: boolean }> {
  const sources: ReleaseSource[] = [registrySource];
  const verifySources: VerifySource[] = material.consulted.map((c: Consulted, i) => {
    const id = `s${i + 2}`;
    // migration_guide is stored as the changelog type: repository documentation of the same trust.
    const type = c.type === "migration_guide" ? "changelog" : c.type;
    sources.push(toSource(id, type, c.document, c.versionFrom, c.versionTo, c.trust, c.url));
    return { id, type: c.type };
  });
  const advisorySourceIds = new Map<SourceDocument, string>();
  for (const document of osv.documents) {
    const id = `s${sources.length + 1}`;
    advisorySourceIds.set(document, id);
    sources.push(toSource(id, "advisory", document, null, null, "advisory_db"));
  }

  // 6. Extraction: rules first; the model reads only what the rules did not handle.
  const rules = extractRules(material.sections, (s) => material.consulted[s.consulted].type);
  const miners = llmMinersFromEnv(deps.env);
  const caller = deps.caller !== undefined ? deps.caller : telegraphCaller(deps.env, budget.limits.maxModelCostMicroUsdc);
  const model: ModelResult = await extractModel(material.sections, rules.handled, request.toResolved!, budget, deps.store, miners, caller);
  metrics.msModel = model.msModel;
  metrics.llmMinerId = model.minerId;
  metrics.modelCalls = budget.modelCalls;
  metrics.modelInputChars = model.inputChars;
  metrics.modelCostUsdc = model.costMicroUsdc / 1_000_000;
  metrics.llmFailure = model.failure;
  const modelRan = model.answered;
  const mode = model.complete || modelRan ? "rules_and_model" : "rules_only";
  metrics.extractorMode = mode;
  // Sections the model should have read but could not fit: those releases are not fully covered.
  if (modelRan) for (const index of model.skipped) tracker.uncover(material.sections[index].version, "budget");
  // Sections whose call failed while another call answered: the LLM miner is a source that was down for them.
  for (const index of model.failed) tracker.uncover(material.sections[index].version, "upstream_unavailable");
  // Sections the model read only the start of: the rest of those notes may hold changes this answer misses.
  for (const index of model.cut) tracker.uncover(material.sections[index].version, "truncated");

  const candidates: Candidate[] = [...rules.candidates, ...model.candidates];
  const { items, dropped } = verify(candidates, material.sections, verifySources);
  const changes: ChangeItem[] = items;
  const modelRefs = new Set(model.candidates.map((c) => c.ref));
  const modelDropped = dropped.filter((drop) => modelRefs.has(drop.ref));
  metrics.rulesItems = items.length - (model.candidates.length - modelDropped.length);
  metrics.modelItems = model.candidates.length;
  metrics.modelItemsKept = model.candidates.length - modelDropped.length;
  metrics.modelDrops = countBy(modelDropped.map((drop) => drop.reason));
  metrics.modelSectionsCut = model.cut.length;
  metrics.modelSectionsSkipped = model.skipped.length;
  metrics.modelSectionsFailed = model.failed.length;

  // A release whose notes only point elsewhere, with nothing found in any source, was not read: it is not
  // covered, so the answer cannot say it has no changes.
  const withItems = new Set(candidates.map((c) => material.sections[c.section].version));
  const unassessed = rules.unassessed
    .map((gap) => ({ version: material.sections[gap.section].version, url: gap.url }))
    .filter((gap, i, gaps) => !withItems.has(gap.version) && gaps.findIndex((g) => g.version === gap.version) === i);
  for (const gap of unassessed) tracker.uncover(gap.version, "no_material");

  // 7. Coverage, outcome, rendering.
  const coverage = tracker.result();
  const materialRead = material.sections.some((s) => s.text.trim() !== "");
  const state: OutcomeState = { stage: "retrieved", coverage, optionalSourceFailed, materialRead };
  const outcome = selectOutcome(state);
  const security: Security = {
    status: osv.status,
    checkedAt: osv.checkedAt,
    advisories: correlate(
      osv.vulns.map(({ vuln, document }) => ({ vuln, sourceId: advisorySourceIds.get(document)! })),
      changes,
      request.fromResolved!,
      request.toResolved!
    ),
    documentedFixes: changes.filter((c) => c.kind === "security_fix").length,
  };
  const processingVersion = `${processingBase}-${model.minerId && modelRan ? `llm${model.minerId}` : "nollm"}-${mode}-s1`;
  const base = { outcome, request, targetReleasedAt, changes, security, coverage, sources, clarification: null, processingVersion };
  const rendered = render(base, mode === "rules_only", { ...lookups, unassessed });
  const answer: Answer = { ...base, ...rendered, confidence: confidence(base, optionalSourceFailed, mode === "rules_only" || unassessed.length > 0) };
  // A model pass that ran is cached even when sections did not fit: their releases are already reported
  // as not covered ("budget"), and the same document set would be cut the same way again. A failed call is
  // not: the next run may read its sections, so that answer is kept only for the partial-answer hour.
  return { answer, complete: mode === "rules_and_model" && model.failed.length === 0 };
}
