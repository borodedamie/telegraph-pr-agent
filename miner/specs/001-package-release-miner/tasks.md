---
description: "Task list for the package-release miner"
---

# Tasks: Package-release miner

**Input**: Design documents from `miner/specs/001-package-release-miner/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Included. The spec's success criteria (SC-001 to SC-012) and the plan's testing section require unit, fixture and benchmark tests.

**Organization**: Grouped by user story, in priority order: US1, US2 and US4 are P1; US3 and US5 are P2. The quality benchmark sits before registration, because it gates it.

**⚠ = needs explicit approval first**: adds a dependency, spends money, signs a transaction, registers on chain, or posts publicly (AGENTS.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1–US5 from spec.md
- Paths are relative to the repository root

---

## Phase 1: Setup

**Purpose**: Create the `miner` package next to `bot/` and `web/`.

- [x] T001 Add `miner` to `pnpm-workspace.yaml` packages, and create `miner/package.json` mirroring `bot/package.json`:
  - name `@telegraph-pr-agent/miner`, `type: module`, Node ≥20;
  - scripts `test`, `build`, `dev` (`vercel dev`) and `bench`.
- [x] T002 ⚠ Add dependencies to `miner/package.json`. Justification: plan.md Complexity Tracking.
  - Runtime: `zod`, `@x402/fetch`, `@x402/evm` and `viem` (same versions as `bot/`), `semver`, `@upstash/redis`. Approved 3 Nov. The two `@x402` packages were removed on 5 Nov, when model calls moved to escrow payments.
  - Dev: `typescript`, `vitest`, `tsx`, `@types/node`, `@types/semver`, `@vercel/node`.
- [x] T003 [P] Create `miner/tsconfig.json`, copied from `bot/tsconfig.json`, with `include: ["src", "api", "test", "bench"]`
- [x] T004 [P] Create `miner/.env.example`, each variable with a one-line comment, and confirm `miner/.env` is ignored by the root `.gitignore` (`.env*`). Variables:
  - `MINER_API_KEY`, `GITHUB_TOKEN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`;
  - `TELEGRAPH_NODE_URL`, `MINER_SPEND_KEY` (spend wallet, never the payout wallet) and `LLM_MINERS` (ordered `<minerId>:<method>:<path>` list, research R7);
  - `PROCESSING_VERSION`;
  - the R9 budget overrides, including `LOCK_WAIT_MS`;
  - `SIMULATE_UPSTREAM_OUTAGE` (default unset; used only in T063).
- [x] T005 [P] Create `miner/vercel.json` mapping `api/*.ts` to the Node runtime with `maxDuration: 30`. No rewrites: the routes are `/api/answer` and `/api/health`, and the YAML maps `/answer` to `external_path: /api/answer`
- [x] T006 [P] Create the empty directories from plan.md: `miner/src/sources`, `miner/src/extract`, `miner/test/unit`, `miner/test/fixtures`, `miner/bench`

---

## Phase 2: Foundational (blocks every story)

**Purpose**: schemas, safe fetching, budgets, cache, auth, health probes, metrics, and the pre-registration Telegraph contract (plan phases 1–2).

- [x] T007 Define zod schemas and inferred types in `miner/src/types.ts`, exactly as in data-model.md, with a check that every `sourceId`, `migrationSourceId`, `inferredFrom` and `migrationInferredFrom` reference exists. Types:
  - `NormalizedRequest` and `ReleaseSource`;
  - `ChangeItem`, with `id`, `migrationEvidence`, `migrationExcerpt` and `migrationInferredFrom`;
  - `Advisory`, with full ranges, versions and `conclusion`;
  - `Security`, with `status` and `checkedAt`;
  - `Coverage`, `Answer` and the metrics record.
- [x] T008 [P] Implement `safeFetch(url, opts)` in `miner/src/safeFetch.ts`:
  - host and path allowlist from research R8, including `api.osv.dev` `POST /v1/query` only; `https` only, default port only;
  - DNS lookup with refusal of loopback, private, link-local, CGNAT and metadata IPv4/IPv6 ranges;
  - the connection pinned to the validated address via `node:https` with a custom `lookup`;
  - manual redirect following, at most 3 hops, each revalidated;
  - conditional GET support, returning `304` as a distinct result;
  - an `AbortSignal` from the budget;
  - streaming size cap per host (registry 64 MB, others 2 MB) and timeout;
  - typed errors `BlockedHost`, `TooLarge`, `Timeout` and `Upstream(status)`.
- [x] T009 [P] Unit tests for `safeFetch` in `miner/test/unit/safeFetch.test.ts`:
  - an allowed host, a blocked host, `http://` and an odd port;
  - an OSV path other than `/v1/query`;
  - redirects to `127.0.0.1` and `169.254.169.254`, and IPv6 `::1`;
  - a hostname resolving to `10.0.0.1` (mocked DNS);
  - a resolver returning a public address and then a private one, where the connection uses the first;
  - the per-host size caps;
  - an abort.
- [x] T010 [P] Implement the per-request budget tracker in `miner/src/budget.ts` with the R9 defaults.
  - It counts source requests, bytes, elapsed time, releases processed, and model calls, input characters and cost in test USDC.
  - It owns an `AbortController` that fires at the time budget (the hard deadline).
  - `canCallModel(inputChars)` refuses a call that would cross any model limit, or that would not finish within `LLM_TIMEOUT_MS` before the deadline.
  - `exhausted(kind)` reports which limit stopped the work.
- [x] T011 [P] Implement the cache in `miner/src/cache.ts`, per research R3. Use Upstash Redis when `KV_REST_API_URL` is set, and an in-memory Map otherwise (local runs only: on Vercel a missing Redis config is an error).
  - **Source manifest**: keyed by URL, or by the query body for OSV, storing `{etag, lastModified, fetchedAt, contentHash, snapshotKey}`. Entries are fresh for 1 h; stale ones are revalidated by conditional GET, and OSV entries are re-queried.
  - **Snapshots**: content-addressed `snap:<hash>`, with no TTL, holding whole normalized documents. For the registry, only the fields used.
  - **Answers**: `getAnswer` / `putAnswer`, keyed by `sha256(canonical NormalizedRequest + sorted contentHashes of all consulted sources + PROCESSING_VERSION)`, stored and returned as exact JSON strings. `putAnswer` refuses answers with `security.status ≠ complete` or `outcome = temporarily_unavailable`.
  - **Lock**: an in-flight lock with `SET NX` and TTL = time budget + 5 s, plus `waitForAnswer(key, LOCK_WAIT_MS)`.
- [x] T012 [P] Unit tests for the cache in `miner/test/unit/cache.test.ts`:
  - the key does not depend on source order;
  - a changed source hash, OSV response hash, `PROCESSING_VERSION` or `fromAssumed` changes the key; the same resolved pair asked explicitly or with an assumed "from" gives different keys;
  - lookup and store compute the same key from the same consulted set;
  - a hit is byte-identical;
  - a snapshot read back by its hash yields any version's section;
  - a `304` reuses the snapshot;
  - answers with incomplete security are not stored;
  - a waiter gives up after `LOCK_WAIT_MS`.
- [x] T013 [P] Implement the metrics record writer in `miner/src/metrics.ts`. It logs one structured JSON line per request with the data-model.md fields (`declaredFailure` and `extractorMode` included) and never logs the API key
- [x] T014 [P] Implement `miner/src/auth.ts`:
  - `checkKey(req)`: constant-time comparison of `X-Telegraph-Key` with `MINER_API_KEY`; fails closed in production when the variable is unset;
  - `admit(req)`: a per-minute origin rate counter and a cap on concurrent first-time computations, both in Redis, with a `429` reason above either.
- [x] T015 [P] Unit tests for auth in `miner/test/unit/auth.test.ts`: a missing key, a wrong key and a right key; an unset `MINER_API_KEY` in production; the rate limit; and the concurrency cap
- [x] T016 [P] Implement `miner/src/probe.ts` per contracts/answer-endpoint.md. It runs cheap upstream probes (registry `/-/ping`, GitHub `/rate_limit`, one fixed OSV query, Redis `PING`), caches them in Redis for 5 minutes, and refreshes them at most once per 5 minutes
- [x] T017 Implement the endpoints per contracts/answer-endpoint.md:
  - `GET /api/answer` in `miner/api/answer.ts`: runs `checkKey` and `admit` first (`401` / `429`), validates `query` (required, at most 2,000 chars, otherwise `400`), and returns a fixed `Answer` with `outcome: "out_of_scope"` until T043;
  - `GET /api/health` in `miner/api/health.ts`: public, served from `probe.ts`.
- [x] T018 Deploy the stub to a Vercel preview from `miner/`, with a preview `MINER_API_KEY`. Record the URL in `miner/bench/network.md`, and check that calls without the key get `401`
- [ ] T019 Capture the Telegraph contract before registration (plan phase 1):
  1. Read the live intent definition for `QUESTION_ANSWERING_GENERAL`, including any latency or timeout requirement, and save it as a dated snapshot under `docs/telegraph/`.
  2. Paste `contracts/telegraph-miner.yaml` into the anjoman.ai/dashboard/earn validator, with the preview `base_url`, `external_path: /api/answer`, the header auth and the errors block.
  3. Sandbox-test the endpoint. Record the validation result and the exact request the sandbox sends (path, query param, headers) in `miner/bench/network.md`.

  No registration and no payment. If the dashboard asks for a signature or a payment, stop and ask.

  Status 3 Nov: steps 1 and 2 done and validation passed (`miner/bench/network.md`). Step 3 is open: the validator sent no `query` param, so the param name and headers the Engine sends on a real ask are still unknown. Capture them from the first sandbox or test ask before T062.
- [x] T020 With what T019 found, update research R1 and R9 in `miner/specs/001-package-release-miner/research.md` (the time budget and `LOCK_WAIT_MS` must fit the Engine timeout), and update `contracts/telegraph-miner.yaml`
- [x] T021 Check Vercel Hobby eligibility for a payment-taking provider (research R2) and record the decision in `miner/bench/network.md`: stay on Hobby, or move to Pro (that is done in T059, with approval)

**Checkpoint**: schemas, safe fetch, budget, cache, auth, probes and an authenticated stub are deployed; the pre-registration contract is validated.

---

## Phase 3: User Story 1 — Sourced migration answer (P1) 🎯 MVP

**Goal**: "What changed in <pkg> from A to B?" covers every release between A and B. It returns the documented breaking changes and deprecations, each with a verbatim excerpt, a version, a source link and a migration step whose evidence is stated, plus the coverage.

**Independent Test**: `curl -H "X-Telegraph-Key: …" "<preview>/api/answer?query=What changed in zod from 3.23.8 to 4.0.0?"`. The answer considers 3.24.x, 3.25.x and 4.0.0, lists the documented breaking changes, states the coverage, and every excerpt and documented migration excerpt is found in its linked source.

### Tests for User Story 1

- [x] T022 [P] [US1] Record registry fixtures (reduced to the fields used) into `miner/test/fixtures/npm/`:
  - `zod`, `@tanstack/react-query`, one monorepo package (e.g. `@babel/core`) and one 0.x package;
  - one package that skipped a major;
  - the full-size `typescript` document, to test the size cap.
- [x] T023 [P] [US1] Record GitHub fixtures (releases pages, `CHANGELOG.md`, one compare response with patches) for the same packages into `miner/test/fixtures/github/`
- [x] T024 [P] [US1] Unit tests for `parse.ts` in `miner/test/unit/parse.test.ts`, covering the FR-002 input forms: an exact pair, a scoped name, a range, "to" only, and an ambiguous question such as "React after 18"
- [x] T025 [P] [US1] Unit tests for `resolve.ts` in `miner/test/unit/resolve.test.ts`:
  - an exact version, and a range resolving to the highest match;
  - every FR-004 default, with `fromAssumed`:
    - `5.0.0` → highest stable below `5.0.0`, including when 4.x was never published;
    - `0.5.0` → highest stable below `0.5.0`;
    - `0.0.3` → `needs_clarification`;
    - no stable version below the bound → `needs_clarification`;
  - a prerelease;
  - no substitution of similar names;
  - the full `typescript` document is accepted under the registry cap.
- [x] T026 [P] [US1] Unit tests for `match.ts` in `miner/test/unit/match.test.ts`:
  - tag patterns `v1.2.3`, `1.2.3`, `pkg@1.2.3`, `pkg-v1.2.3` and `pkg/v1.2.3` match;
  - a monorepo release naming another package is rejected;
  - changelog headings `## 4.0.0`, `## [4.0.0] - 2025-07-09` and `# v4.0.0` are split correctly.
- [x] T027 [P] [US1] Unit tests for `verify.ts` in `miner/test/unit/verify.test.ts`. One policy applies: normalize the source once (data-model.md), then require exact substrings.
  - An exact substring passes; CRLF and NFC differences in the source pass after normalization; a paraphrase fails.
  - An excerpt that only lacks the source's backticks (as `302` returned) matches, and is stored as the original span with backticks.
  - An item without an excerpt fails unless it is `inferred` with an existing `inferredFrom`.
  - A step without a verified `migrationExcerpt` becomes `inferred` when `migrationInferredFrom` names existing ids, and `manual_review` otherwise.
  - A valid change excerpt paired with an unsupported migration ("replace every string schema with z.email()") does not yield a `documented` migration.
- [x] T028 [P] [US1] Unit tests for `compare.ts` in `miner/test/unit/compare.test.ts`:
  - only patches under the package `directory` are used;
  - commit messages alone produce no item;
  - a truncated response (300 files, 250 commits or a missing patch) puts the affected releases in `notCovered` with reason `truncated`;
  - items are `repository_evidence`.
- [x] T029 [P] [US1] Unit tests for `coverage.ts` in `miner/test/unit/coverage.test.ts`:
  - `releasesBetween` includes every stable release with A < v ≤ B, minors and 0.x included, and excludes prereleases unless B is one;
  - releases without material get `no_material`, and releases with unmatched material get `unmatched`.

### Implementation for User Story 1

- [x] T030 [US1] Implement `parse(query)` in `miner/src/parse.ts`.
  - It is deterministic and regex-based: npm package names (scoped included), versions and ranges, and "from…to", "A → B" and "upgrade to" phrasings.
  - It returns an unresolved `NormalizedRequest`, or a reason for `needs_clarification` / `out_of_scope`.
- [x] T031 [US1] Implement `resolve(req)` in `miner/src/resolve.ts`.
  - It reads `https://registry.npmjs.org/<encoded name>` via `safeFetch` and the manifest, and reduces it to the fields used.
  - It resolves both versions with `semver` and applies the FR-004 defaults.
  - It returns the resolved request, `targetReleasedAt`, the published version list and the registry `ReleaseSource`.
- [x] T032 [US1] Implement `releasesBetween(versions, A, B)` and coverage tracking in `miner/src/coverage.ts`, per T029
- [x] T033 [US1] Implement repository identity in `miner/src/sources/github.ts`: parse the registry `repository` field (GitHub only, keep `directory`). It returns `{owner, repo, directory}`, or null with a reason
- [x] T034 [US1] Implement `matchRelease` and `splitChangelog` in `miner/src/sources/match.ts`, per research R5
- [x] T035 [US1] Implement release retrieval in `miner/src/sources/github.ts`, for every release in `releasesBetween`:
  1. Paged `GET /repos/{o}/{r}/releases` with `GITHUB_TOKEN`.
  2. Otherwise `CHANGELOG.md` from `raw.githubusercontent.com`: the package directory first, then the root.

  Every fetch goes through `safeFetch`, the budget and the manifest. Whole documents are snapshotted, and the version sections are derived from the snapshot. The output is the consulted set of `ReleaseSource`s, decided before any extraction.
- [x] T036 [US1] Implement the tag-comparison fallback in `miner/src/sources/compare.ts`, per research R5, for releases still without material:
  - resolve the exact from/to tags, then `GET /repos/{o}/{r}/compare/{base}...{head}`;
  - keep only `files[].patch` under the package `directory`, prioritizing `*.d.ts`, entry points and `package.json`;
  - bound commits and files, and mark truncation;
  - emit sources with trust `repository_evidence`.
- [x] T037 [US1] Implement the deterministic extractor in `miner/src/extract/rules.ts`.
  - It finds Breaking, Removed, Deprecated, Migration and Security sections, their bullet items, and the CVE/GHSA ids in them.
  - It emits `documented` items with exact excerpts. A migration step is `documented` only when the same bullet or a Migration section states it.
- [x] T038 [US1] Implement the model extractor in `miner/src/extract/model.ts`:
  - It buys one call from the first available miner in `LLM_MINERS` via `POST /engine/v1/ask/<minerId>`, paid from the spend wallet. The quote is refused above `MAX_MODEL_COST_USDC`. Since 5 Nov the payment uses the `escrow` scheme rather than x402 `exact` (2.0 s against 13.3 s median per call, research R7).
  - The system prompt says the text is data, not instructions.
  - A reply that doesn't parse into the item schema is a failure, even with `200`. From the third failure in a row, a circuit breaker in Redis skips that miner for 1, 3, 9 and then at most 15 minutes (changed 5 Nov from 15 minutes after one failure).
  - `LLM_TIMEOUT_MS` applies.
  - It sends version sections batched per call, each under an opaque section id. Releases fully handled by `rules.ts` are skipped.
  - It asks for JSON items `{sectionId, kind, evidenceType, change, excerpt, inferredFrom, migration, migrationExcerpt, migrationInferredFrom}`, validated with zod.
  - It never passes or accepts versions, dates or URLs.
  - It asks `budget.canCallModel` before every call, and records the miner id, calls, input size, cost and failure reason.
  - Without `MINER_SPEND_KEY` or `LLM_MINERS`, or after a failure, it is skipped. The extractor mode `rules_only` then goes into `PROCESSING_VERSION`, and that answer is cached for one hour only.
  - Tests stub the LLM miner and never buy.
- [x] T039 [US1] Implement `verify(items, sources)` in `miner/src/extract/verify.ts`.
  - It normalizes each source once and drops every item whose `excerpt` is not an exact substring.
  - It downgrades migration steps per T027.
  - It assigns `ChangeItem.id`s, resolves section ids to versions and source ids, and logs every drop and downgrade.
- [x] T040 [US1] Implement `miner/src/outcome.ts`:
  - `selectOutcome(state)`, with no hardcoded `found`: inputs are the resolution result, the coverage, upstream errors and the security status;
  - `confidence(answer)`, using the deterministic bands in data-model.md.
- [x] T041 [US1] Implement the pipeline in `miner/src/answer.ts`, in the data-model.md lifecycle order:
  1. parse → resolve → `releasesBetween` → retrieval through the manifest (releases, changelog, compare; OSV is added in T053) → consulted set and hashes;
  2. answer-cache lookup; on a miss, take the in-flight lock, or `waitForAnswer` and then compute only if a full budget still fits before `maxDuration`, returning `temporarily_unavailable` otherwise;
  3. derive sections → rules + model extraction → verify → coverage → `selectOutcome` → assemble → `putAnswer`.

  Any budget cut is recorded in `notCovered` with reason `budget`.
- [x] T042 [US1] Implement `render(answer)` in `miner/src/render.ts`. It builds the plain-text `answer` field, readable on its own:
  - a header with package, requested versus resolved versions, the target date and counts;
  - "(from version assumed: …)" when `fromAssumed`;
  - a coverage line: "Coverage complete", or "Coverage partial: not covered 3.0.0 (no material), …";
  - numbered items with version, migration (marked documented, inferred or manual review needed), excerpt and `[sN]`;
  - a notice in `rules_only` mode;
  - the sources list.
- [x] T043 [US1] Wire `miner/api/answer.ts` to the pipeline. Keep auth, admission and the `400` on bad input; return `200` with the JSON answer; write the metrics record
- [x] T044 [US1] Fixture test in `miner/test/unit/answer.us1.test.ts`, for zod 3.23.8 → 4.0.0 with recorded fixtures and a stubbed model:
  - every release from 3.24.0 to 4.0.0 is in `covered` or `notCovered`;
  - documented items are present and all excerpts verify;
  - the version and date come from the registry;
  - an unsupported model migration is shown as not documented;
  - the assumed-"from" variant says so in the text;
  - a repeat call returns an identical string without calling the model;
  - a rules-only run uses a different cache key.

**Checkpoint**: MVP. One real transition, with its intermediate releases, is answered with verified evidence and honest coverage.

Status 3 Nov: T022–T044 done; 120 unit tests pass. Deviations, recorded in research R5, R7 and data-model.md:
- the full 15 MB `typescript` document is replaced in tests by a generated 16 MB document, to keep the repository small;
- a migration-guide step was added to retrieval (zod 4.0.0 has no GitHub release or changelog, only a guide in the repository);
- until T053 adds OSV, `security.status` is `not_checked` for every answer, and such found/not_found answers are cached;
- the model pass is tested with a stub only. No paid LLM call has been made from the pipeline yet; the preview runs without `MINER_SPEND_KEY` and `LLM_MINERS`, so every live answer there is `rules_only`.

---

## Phase 4: User Story 2 — Honest "not found" (P1)

**Goal**: no material, an unknown version, an unrelated question or an upstream outage each give the right explicit outcome, never a guess.

**Independent Test**: ask about a package with registry metadata but no release notes. The outcome is `not_found`, the checked sources are listed, and nothing says the upgrade is safe.

- [x] T045 [P] [US2] Record negative fixtures into `miner/test/fixtures/negative/`:
  - a package without releases or changelog;
  - a nonexistent version;
  - a monorepo release that doesn't name the package;
  - a registry `500` and a GitHub timeout;
  - a changelog `500` while releases work (optional source failure).
- [x] T046 [US2] Extend `selectOutcome` in `miner/src/outcome.ts`:
  - `not_found` when no release in range has version-matched material, listing the sources checked;
  - an unknown version → `not_found`, naming the closest published versions;
  - `out_of_scope` and `needs_clarification` from `parse` and `resolve`;
  - any `Upstream`/`Timeout` error on a required source → `temporarily_unavailable`, never cached, with `declaredFailure: true` in the metrics record;
  - `SIMULATE_UPSTREAM_OUTAGE=1` (environment only, never a request parameter) forces that path, for T063.
- [x] T047 [US2] Make `render.ts` produce explicit text for each non-`found` outcome. None may suggest the upgrade is safe
- [x] T048 [US2] Fixture tests in `miner/test/unit/answer.us2.test.ts`:
  - each negative fixture maps to its outcome and confidence band;
  - `temporarily_unavailable` is not written to the answer cache, and `not_found` is;
  - the `outcome` values match the YAML `errors.success_values` (every billable outcome listed, `temporarily_unavailable` not);
  - the outage flag works only from the environment.

**Status (2026-11-04), model step and phrase rules**: four paid model calls (0.04 test USDC, `miner/bench/network.md`) showed miner 302 takes 8–28 s and was given the wrong text: a release with any marked heading was never sent to it. The model stays off the live answer path. Instead the deterministic pass now reads breaking-change phrases in line-start releases (research R7, `miner/bench/phrase-rules.md`); on 284 major releases it finds items in 236 instead of 177. `PROCESSING_VERSION` is now `p2`.

**Status (2026-11-04)**: Phase 4 is done, with these notes:
- the negative fixtures in `miner/test/fixtures/negative/` are hand-written, not recorded: the packages `no-notes` and `@mono/a` are invented, and the registry `500`, GitHub timeout and changelog `500` are simulated by the test fetcher;
- a changelog or migration guide that is down is an optional source failure: the answer goes on with the 0.6 `not_found` band and is not cached, so it is retried;
- a `not_found` answer lists every URL looked up, including those that returned 404; the 404s are not part of the answer-cache key, so a cached `not_found` stays until the registry metadata or another consulted document changes.

**Checkpoint**: US1 and US2 together give an honest miner for ordinary transitions.

---

## Phase 5: User Story 4 — Security fixes in the upgrade (P1)

**Goal**: the answer states, per advisory, whether A and B are affected and what the upgrade does about it, using the complete OSV data for both versions. It quotes documented security fixes, following the spec's User Story 4 table. The check's status is always shown.

**Independent Test**: a transition where A has an OSV advisory fixed at or before B, and the release notes mention it. The answer names the advisory, its severity and range, quotes the note, gives `conclusion: fixed_by_upgrade`, and shows `security.status: complete`.

- [x] T049 [P] [US4] Record OSV fixtures into `miner/test/fixtures/osv/`, for both A and B queries:
  - one per row of the US4 correlation table, from real packages (for example `lodash` 4.17.20 and `minimist` 1.2.5);
  - a multi-range record where B is newer than A but still affected;
  - an advisory affecting B but not A;
  - records using `introduced: "0"`, `last_affected` and `limit`;
  - a versions-only record;
  - an OSV `503` and a paged response.
- [x] T050 [US4] Implement `advisoriesFor(pkg, A, B)` in `miner/src/sources/osv.ts`:
  - two `POST https://api.osv.dev/v1/query` calls via `safeFetch` and the manifest, each a consulted source;
  - the union of advisories, keeping aliases, the severity entries as they are, `displaySeverity`, and every npm range with all its events plus the `versions` list;
  - it returns `Security.status` and `checkedAt`.
- [x] T051 [US4] Implement `isAffected(advisory, version)` in `miner/src/affected.ts`, per the data-model.md affected check:
  - events sorted per range, with `introduced: "0"` handled as the lowest version and never passed to `semver`;
  - `fixed` exclusive and `last_affected` inclusive;
  - `limit` as a cap on the whole range;
  - the explicit `versions` list.

  It returns `yes`, `no` or `unknown`.
- [x] T052 [P] [US4] Unit tests in `miner/test/unit/affected.test.ts`:
  - vulnerable 1.0.0–1.0.5, fixed 1.0.6, affected again 3.0.0–3.0.2, fixed 3.0.3: `3.0.1` is affected and `2.0.0` is not;
  - unsorted events;
  - `introduced: "0"`;
  - `last_affected`;
  - `limit`;
  - a versions-only record;
  - an unknown range type → `unknown`.
- [x] T053 [US4] Implement `correlate(advisories, changes, A, B)` in `miner/src/correlate.ts`.
  - It sets `fromAffected`, `targetAffected` and `conclusion` per advisory, including `introduced_by_upgrade`.
  - It links documented `security_fix` items by CVE/GHSA id or alias.
  - With no evidence it makes no claim.

  Add the OSV sources to the consulted set in `miner/src/answer.ts`.
- [x] T054 [US4] Add the security section to `miner/src/render.ts`:
  - "OSV checked, no known advisories" only when `status = complete`, and "advisory check unavailable" or "partial" otherwise;
  - one line per advisory with its conclusion.

  An OSV failure never changes the migration outcome. It lowers confidence and prevents caching, per data-model.md.
- [x] T055 [US4] Unit tests in `miner/test/unit/correlate.test.ts`, one per correlation-table row, plus:
  - "a newer version alone is never a security fix";
  - an OSV outage still yields `found`, with `security.status: unavailable` and no cache entry;
  - a changed OSV response changes the answer key.

**Status (2026-11-04)**: Phase 5 is done; 178 unit tests pass. `PROCESSING_VERSION` is now `p3`. Notes:
- T049: real OSV responses are recorded for `lodash` 4.17.20 and 4.17.21, `minimist` 0.2.4, 1.2.5 and 1.2.6 (two ranges, `introduced: "0"`, B newer but still affected, an advisory only B is affected by), and `zod` 3.23.8 and 4.0.0. No real npm record with `limit` or with `versions` only was found, so those, unsorted events, a paged response and a `503` are synthetic records in `affected.test.ts` and `osv.test.ts`.
- `Advisory` gained `summary` (OSV's one-line title) for the rendered line.
- A `not_found` answer also shows the security line and its advisories.
- Checked locally against the live npm, GitHub and OSV on 4 Nov: lodash 4.17.20 → 4.17.21 lists 2 advisories fixed by the upgrade and 2 still affecting 4.17.21; minimist 1.2.5 → 1.2.6 is `fixed_by_upgrade`; minimist 0.2.4 → 1.2.5 is `introduced_by_upgrade`.

**Checkpoint**: all P1 stories are done.

---

## Phase 6: Quality benchmark (gates registration)

**Purpose**: plan phase 9. Show answer quality before a paid provider is registered.

- [x] T056 Build the benchmark set in `miner/bench/transitions.json`:
  - 30 reviewed transitions across different packages and release styles: monorepos, scoped packages, sparse changelogs, at least one 0.x package, and at least 5 multi-release jumps, some of them beyond the US1 model budget;
  - the expected breaking changes and migration steps for each, drafted by one model, checked against the sources by at least two other models, with every quote verified word for word;
  - 10 or more negative cases, including a simulated upstream outage and an OSV outage.
- [x] T057 Implement the benchmark harness in `miner/bench/run.ts`.
  - It runs the set against a local or deployed URL, with the key.
  - It writes `miner/bench/report.md` with SC-001 to SC-006, SC-008, SC-011 and SC-012, plus p50/p95 latency, model calls and cost, split into cache-hit and first-time runs.
- [x] T058 [P] Security tests in `miner/test/unit/security.test.ts` (SC-008):
  - a release note containing instruction text produces no behaviour change and no extra fetch;
  - a package with an `install` script is never executed (nothing is downloaded);
  - a repository URL pointing at a private host is refused;
  - an unauthenticated direct call does no upstream work.
- [ ] T059 Run the benchmark on the preview and commit `miner/bench/report.md`.
  - **Gate**: SC-001 to SC-006, SC-008 and SC-012 pass, excluding only the jumps beyond the US1 model budget, which must still be reported as partial with the cut releases named. First-time cost must be within the planned price.
  - If the gate fails, fix before Phase 7.

  Status 5 Nov, preview `p5-bench6` (`bench/report.md`, `bench/judge-report.md`):
  - Pass: SC-001 (673/673), SC-003 (0 invented), SC-004 (8/8), SC-005 (38/38), SC-006 identical and free repeats (38/38), SC-008 (security tests) and SC-012 (38/38).
  - SC-002 recall: 67.1% by word matching. With the judge it is 82.6%; 2 of the judged pairs were read by hand and found wrong, which leaves 82.1% (302/368), above the 80% target.
  - Not met, and deferred by decision on 5 Nov so that registration can go ahead: repeat latency p95 is 1056 ms against a target under 500 ms. A repeat still revalidates every source to compute its cache key; a short cache keyed by package and versions would fix it.
  - Not run: n08 and n09, which need a local run with a simulated outage.
  - First-time cost: at most one model call at 0.01 USDC per answer.

---

## Phase 7: User Story 5 — Purchasable on Telegraph (P2)

**Goal**: the miner is registered, protected by the installed key, and an independent agent can buy from it. Activation, purchase, routing, rank and payout are recorded separately.

**Independent Test**: a wallet the team does not control buys one answer through Telegraph, with receipt, signal and settlement evidence.

- [x] T060 [US5] ⚠ Deploy to Vercel production from `miner/`, on the plan chosen in T021 (Pro spends money). Set the env vars in the dashboard, add the Upstash Redis integration from the Vercel Marketplace, and record the production URL in `miner/bench/network.md`
- [x] T061 [US5] ⚠ Create two miner wallets, both separate from the bot's `0x46D0…C77b`, and record only their addresses in `miner/bench/network.md`:
  - **Payout wallet**: its key goes in a local gitignored file only, never in chat, the repo or the server.
  - **Spend wallet** (research R11): mint a small test-USDC balance to it, and set its key as `MINER_SPEND_KEY` in Vercel production.
- [x] T062 [US5] Finalize and validate `miner/specs/001-package-release-miner/contracts/telegraph-miner.yaml`:
  - the production `base_url`;
  - an unused numeric `id` and an unused slug, checked with `GET /api/miners`;
  - `external_path`, the auth header, `errors`, the rate limits, `on_chain.transform` and `min_price_usdc` as a decimal;
  - re-check the field rules against the live YAML docs, and `isCanonicalIntent("QUESTION_ANSWERING_GENERAL")` live.
- [x] T063 [US5] ⚠ Register, install the key and run the paid tests, in this order, recording each step in `miner/bench/network.md`:
  1. Register at anjoman.ai/dashboard/earn from the payout wallet. This is on chain and permanent. Record the registration tx, id and activation status.
  2. Immediately afterwards, generate the API key locally, install it against the slug (signed by the payout wallet), and set the same value as `MINER_API_KEY` in Vercel production. Verify that a direct unauthenticated call gets `401` and does no work. Record the install time, never the key.
  3. Paid test from the bot wallet, capped at 0.03 test USDC:
     - one direct `POST /engine/v1/ask/<minerId>`;
     - one Engine-routed `POST /engine/v1/ask` with `intent: QUESTION_ANSWERING_GENERAL`;
     - one more direct call with `SIMULATE_UPSTREAM_OUTAGE=1` set on production for that call only and removed straight after. Compare `declaredFailure` in our metrics with `charged` on Telegraph's receipt.

     Capture the routed request as our endpoint received it. Record the receipt, signal, tx, which miner answered, the latency and the charge. Update research R1 and `render.ts` if the routed request differs from the sandbox one. Note that the bot wallet is team-controlled.

  Status 6 Nov (`miner/bench/network.md`):
  - Registered: registrationId 5083, miner id 7314, slug `package-release-intel`, `active`, floor 0.02 USDC; registerMiner tx `0xffa82f09…4157`.
  - Key installed and validated by the node.
  - Paid tests: the direct call was served by our miner, settled 0.02 USDC. The routed call was classified as `WEB_SEARCH_GENERAL` and went to another miner.
  - Not run: the outage call, which needs `SIMULATE_UPSTREAM_OUTAGE` on production.
  - Evaluation pool: not re-checked before registering. Read afterwards, it had 4 eligible submitters against `min_submitters` 5 (`docs/telegraph/qa-evalpool-2026-11-06.md`). Even so, by 11:41 UTC the same day it was scored: rank 4, score 0.9363 on `QUESTION_ANSWERING_GENERAL`, epoch 2026.

- [ ] T064 [US5] Ranking check (plan phase 11), from the three endpoints in research R12:
  - `/api/miners?intent=…` (`scores[]`, `activation_status`, `scored`);
  - `/engine/v1/intents/QUESTION_ANSWERING_GENERAL/miners` (whether the miner is listed);
  - `/leaderboard/miners` (rank in the current epoch);
  - the evaluation-pool status.

  Record each response's actual shape, plus the score and rank if present or the observed reason they are absent, in `miner/bench/network.md`.
- [ ] T065 [US5] Monitor `https://<prod>/api/health` with an external uptime check (any free monitor). Log failures and routing suspensions in `miner/bench/network.md` (SC-007)
- [ ] T066 [US5] Record payout accounting in `miner/bench/network.md`:
  - per call: the quoted and settled amount, and `charged` from the receipt;
  - per settlement batch: the protocol share, the provider accrual and the actual payout with its currency, from receipts and settlement data. This confirms or corrects the review's 2% / 98% / MACHINA description.

---

## Phase 8: User Story 3 — Large multi-version jumps (P2)

**Goal**: jumps beyond the US1 budget (tens of releases) are covered as far as the model, time and request budgets allow, with every cut release named. This can run in parallel with Phases 6–7; until it passes, such jumps are reported as partial.

**Independent Test**: a 40-release jump makes at most `MAX_MODEL_CALLS` model calls, covers what fits, groups releases without material, and names every release cut by a budget.

- [ ] T067 [P] [US3] Record a multi-major fixture with one missing intermediate release, and a 40-release jump, into `miner/test/fixtures/multi/`
- [ ] T068 [US3] Extend `miner/src/extract/model.ts` and `miner/src/answer.ts` for large ranges:
  - run the rules extractor on every release first;
  - pack the remaining sections into as few model calls as the limits allow (`MAX_MODEL_CALLS`, `MAX_MODEL_RELEASES`, token and cost limits), newest releases first;
  - mark everything cut as `notCovered` with reason `budget`.
- [ ] T069 [US3] Extend `render.ts` to group adjacent releases that have no changes or no material in the display, without dropping any from `covered` / `notCovered`
- [ ] T070 [US3] Fixture test in `miner/test/unit/answer.us3.test.ts`:
  - each item carries its version;
  - the missing release is named;
  - the 40-release jump respects `MAX_MODEL_CALLS` and names the releases it cut.
- [ ] T071 [US3] Re-run the benchmark (T059), including the large jumps, and update `miner/bench/report.md`

---

## Phase 9: Polish, integration and evidence

- [ ] T072 [P] Write `miner/README.md`:
  - what it does, and the curl example with the key;
  - the outcomes and which are billed, and the limits;
  - origin authentication;
  - the payout wallet address and the payout economics as measured;
  - team-ownership disclosure (FR-026).
- [ ] T073 Add a pointer to this spec in `docs/SPEC.md` §3, so the miner has one source of truth (plan Constitution Check)
- [ ] T074 ⚠ PR-bot integration (plan phase 12): the bot buys from the miner, and one migration whose patch uses the answer passes the repository's tests (SC-010). Coordinate with the bot work in `bot/`
- [ ] T075 ⚠ External adoption (plan phase 13): invite other hackathon teams or developers, publicly, to buy from the miner. Record any independent purchase with receipt, signal and settlement in `miner/bench/network.md` (SC-009)
- [ ] T076 Package the Miners-track evidence (FR-028) in `miner/bench/evidence.md`: registration record, payout wallet, five sample requests and answers, network test results, benchmark report, latency, cost and payout

---

## Dependencies & Execution Order

- **Setup (T001–T006)** → **Foundational (T007–T021)** → stories.
- **US1 (T022–T044)** is the MVP and blocks US2, US4 and US3, which extend `answer.ts`, `outcome.ts` and `render.ts`.
- **US2 (T045–T048)** and **US4 (T049–T055)** can proceed in parallel after US1. They touch different source modules but the same `answer.ts` and `outcome.ts`, so merge carefully.
- **Benchmark (T056–T059)**: T056–T058 can start after US1. T059 needs US1, US2 and US4, and gates Phase 7.
- **US5 (T060–T066)** needs T059 to pass. T019/T020 come before T062. The three steps of T063 run back to back.
- **US3 (T067–T071)** after US1, alongside Phases 6–7.
- **Polish**: T074 needs US5. T076 comes last.

## Parallel Examples

- **Foundational**: T008, T010, T011, T013, T014 and T016 in parallel; then T009, T012 and T015.
- **US1 tests**: T022–T029 in parallel, before T030–T044.
- **After US1**: one person on US2 (T045–T048), another on US4 (T049–T055), a third on the benchmark set (T056) and then US3.

## Implementation Strategy

1. **MVP**: Setup, Foundational, then US1. Deploy an authenticated preview and demo zod 3.23.8 → 4.0.0, with its intermediate releases covered and the evidence verified.
2. **Honest and useful**: add US2 and US4.
3. **Prove quality**: the benchmark gate (T059).
4. **Register** (US5): install the key at once, run the paid tests, then the ranking check.
5. **US3** large jumps, re-benchmark, then integration and evidence.
