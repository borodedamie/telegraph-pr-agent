// The answer pipeline, in the data-model.md lifecycle order:
// parse → resolve → releases → retrieval → cache lookup → extract → verify → coverage → outcome → render → store.
import semver from "semver";
import { Budget, limitsFromEnv, type BudgetLimits } from "./budget.js";
import {
  acquireLock,
  answerKey,
  getAnswer,
  isCacheable,
  putAnswer,
  releaseLock,
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
import { render } from "./render.js";
import { resolve } from "./resolve.js";
import { Timeout, Upstream, safeFetch } from "./safeFetch.js";
import { retrieveComparisons } from "./sources/compare.js";
import { BudgetExhausted, newRetrieval, type Retrieval, type SourceDocument } from "./sources/fetch.js";
import { githubHeaders, repoIdentity, retrieveReleaseNotes, type Consulted, type Material } from "./sources/github.js";
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
  metrics: Omit<MetricsRecord, "requestHash" | "authOk" | "msTotal">;
}

/** Vercel kills the function at maxDuration (vercel.json). */
const MAX_DURATION_MS = 30_000;
const LOCK_WAIT_DEFAULT_MS = 5_000;

const NOT_CHECKED: Security = { status: "not_checked", checkedAt: null, advisories: [], documentedFixes: 0 };

function emptyMetrics(): PipelineResult["metrics"] {
  return {
    cacheHit: false, outcome: null, declaredFailure: false, extractorMode: null,
    msResolve: 0, msFetch: 0, msModel: 0, upstreamRequests: 0, conditionalHits: 0,
    llmMinerId: null, modelCalls: 0, modelInputChars: 0, modelCostUsdc: 0, llmFailure: null, budgetExhausted: null,
  };
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
  const processingBase = `${PROCESSING_VERSION}-${(deps.env.LLM_MINERS ?? "").replace(/[^0-9,]/g, "") || "nollm"}`;

  const finish = (answer: Answer): PipelineResult => {
    const parsed = Answer.parse(answer);
    metrics.outcome = parsed.outcome;
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
    return { ...base, answer: note.summary ? `${note.summary}\n${rendered.answer}` : rendered.answer, summary, confidence: confidence(base) };
  };

  // 1. Parse
  const parsed = parse(query);
  if (parsed.kind !== "ok") {
    return finish(simple(parsed.kind, null, [], parsed.kind === "needs_clarification" ? { clarification: parsed.reason } : { summary: `Out of scope: ${parsed.reason}.` }));
  }

  const budget = new Budget(limits, now);
  const retrieval = newRetrieval(deps.store, budget, deps.fetcher ?? safeFetch);
  try {
    // 2. Resolve
    const resolveStart = now();
    let resolved: Awaited<ReturnType<typeof resolve>>;
    try {
      resolved = await resolve(retrieval, parsed);
    } catch (err) {
      if (!isUpstreamFailure(err) && !(err instanceof BudgetExhausted)) throw err;
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

    // 4. Retrieval, decided before any extraction.
    const fetchStart = now();
    const material: Material = { consulted: [], sections: [] };
    let upstreamFailed = false;
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
        try {
          const found = await step();
          material.consulted.push(...found.consulted);
          const offset = material.consulted.length - found.consulted.length;
          material.sections.push(...found.sections.map((s) => ({ ...s, consulted: s.consulted + offset })));
          material.tagTemplate ??= found.tagTemplate;
        } catch (err) {
          if (err instanceof BudgetExhausted || budget.exhausted() === "time") {
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
    metrics.msFetch = now() - fetchStart;
    metrics.upstreamRequests = retrieval.upstreamRequests;
    metrics.conditionalHits = retrieval.conditionalHits;

    if (upstreamFailed && tracker.result().covered.length === 0) {
      return finish(simple(selectOutcome({ stage: "upstream_unavailable" }), request, [registrySource]));
    }

    // 5. The consulted set is fixed: look up the answer cache.
    const hashes = [...new Set(retrieval.documents.map((d) => d.contentHash))];
    const key = answerKey(request, hashes, processingBase);
    const cached = await getAnswer(deps.store, key);
    if (cached !== null) return fromCache(cached, metrics);

    const locked = await acquireLock(deps.store, key, limits.maxTimeMs);
    if (!locked) {
      const waited = await waitForAnswer(deps.store, key, Number(deps.env.LOCK_WAIT_MS || LOCK_WAIT_DEFAULT_MS));
      if (waited !== null) return fromCache(waited, metrics);
      if (now() - startedAt + limits.maxTimeMs > MAX_DURATION_MS) {
        return finish(simple("temporarily_unavailable", request, [registrySource]));
      }
    }
    let leave: (() => Promise<void>) | null = null;
    try {
      if (deps.enterCompute) leave = await deps.enterCompute();
      const { answer, complete } = await compute(request, resolved.targetReleasedAt, registrySource, material, tracker, budget, deps, metrics, processingBase);
      const result = finish(answer);
      if (complete && isCacheable(result.answer)) await putAnswer(deps.store, key, result.answer, result.json);
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
  metrics.outcome = answer.outcome;
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
  processingBase: string
): Promise<{ answer: Answer; complete: boolean }> {
  const sources: ReleaseSource[] = [registrySource];
  const verifySources: VerifySource[] = material.consulted.map((c: Consulted, i) => {
    const id = `s${i + 2}`;
    // migration_guide is stored as the changelog type: repository documentation of the same trust.
    const type = c.type === "migration_guide" ? "changelog" : c.type;
    sources.push(toSource(id, type, c.document, c.versionFrom, c.versionTo, c.trust, c.url));
    return { id, type: c.type };
  });

  // 6. Extraction: rules first; the model reads only what the rules did not handle.
  const rules = extractRules(material.sections, (s) => material.consulted[s.consulted].type === "migration_guide");
  const miners = llmMinersFromEnv(deps.env);
  const caller = deps.caller !== undefined ? deps.caller : telegraphCaller(deps.env, budget.limits.maxModelCostMicroUsdc);
  const model: ModelResult = await extractModel(material.sections, rules.handled, request.toResolved!, budget, deps.store, miners, caller);
  metrics.msModel = model.msModel;
  metrics.llmMinerId = model.minerId;
  metrics.modelCalls = budget.modelCalls;
  metrics.modelInputChars = model.inputChars;
  metrics.modelCostUsdc = model.costMicroUsdc / 1_000_000;
  metrics.llmFailure = model.failure;
  const modelRan = model.minerId !== null && model.failure === null;
  const mode = model.complete || modelRan ? "rules_and_model" : "rules_only";
  metrics.extractorMode = mode;
  // Sections the model should have read but could not fit: those releases are not fully covered.
  if (modelRan) for (const index of model.skipped) tracker.notCovered(material.sections[index].version, "budget");

  const candidates: Candidate[] = [...rules.candidates, ...model.candidates];
  const { items } = verify(candidates, material.sections, verifySources);
  const changes: ChangeItem[] = items;

  // 7. Coverage, outcome, rendering.
  const coverage = tracker.result();
  const state: OutcomeState = { stage: "retrieved", coverage, optionalSourceFailed: false };
  const outcome = selectOutcome(state);
  const security: Security = { ...NOT_CHECKED, documentedFixes: changes.filter((c) => c.kind === "security_fix").length };
  const processingVersion = `${processingBase}-${model.minerId && modelRan ? `llm${model.minerId}` : "nollm"}-${mode}-s1`;
  const base = { outcome, request, targetReleasedAt, changes, security, coverage, sources, clarification: null, processingVersion };
  const rendered = render(base, mode === "rules_only");
  const answer: Answer = { ...base, ...rendered, confidence: confidence(base) };
  return { answer, complete: mode === "rules_and_model" };
}
