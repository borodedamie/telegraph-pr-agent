# Software specification

Revised 2 Nov 2026 after external review, and again after the second review ([docs/reviews/2026-11-02-docs-review.md](reviews/2026-11-02-docs-review.md)). Plan: [HACKATHON-PLAN.md](HACKATHON-PLAN.md). Owners: [TEAM.md](TEAM.md). Live QA intent contract: [telegraph/qa-intent-contract-2026-11-02.md](telegraph/qa-intent-contract-2026-11-02.md). Live rules and docs are authoritative: [rules](https://hackathon.telegraphprotocol.com/rules), [Model Economy mission](https://hackathon.telegraphprotocol.com/missions/model-economy), [Telegraph docs](https://anjoman.ai/docs/introduction), [miner registration](https://anjoman.ai/docs/miners/miner-registration), [validation API](https://anjoman.ai/docs/miners/validation-api). Recheck them before submission; do not rely on copied endpoint examples or old notes.

**Labels.** Every requirement carries one:

| Label | Meaning |
| --- | --- |
| [ELIGIBILITY] | Explicit requirement in the hackathon rules |
| [MISSION] | Needed to demonstrate the Model Economy mission meaningfully |
| [PRODUCT] | Requirement of this product's chosen design |
| [SCORE] | Feature intended to improve judging results |

Nothing labelled [PRODUCT] or [SCORE] is mandated by Telegraph.

**The vertical slice to protect.** Package release → model knowledge gap → autonomous Telegraph purchase → purchased release intelligence → actual repository migration → independent tests → human merge → auditable economic result. Do not spend the event on multiple paid verification integrations or dashboard polish before this slice reliably buys one useful answer and turns it into a passing migration.

## 0. Blockers

Two separate gates. The App never waits on the Miner gate.

**App gate (blocks the Apps & Agents entry):**

1. [MISSION] Exact canonical Q&A intent, request shape and provider discovery resolved from the live node and saved as a dated contract snapshot. Done for 2 Nov: `QUESTION_ANSWERING_GENERAL`, free-form `query`, no request/response schema ([snapshot](telegraph/qa-intent-contract-2026-11-02.md)). Recheck before each milestone.
2. [MISSION] One useful package-release answer purchased through a supported Telegraph flow and materially used in a passing migration.
3. [PRODUCT] Purchase idempotency with crash-safe attempt records (§2.6). Scheduled runs never buy the same package/version answer twice, and an ambiguous attempt never triggers an automatic repurchase.
4. [PRODUCT] Complete the GitHub Actions trust boundary: secret-bearing payment/LLM job, secretless repository execution, privileged commit/push, merge accounting.
5. [SCORE] `CODE_GENERATION` and paid verification are conditional on demonstrated provider quality. Unavailable or unsuitable miners are never mandatory for the core product.

**Miner gate (blocks only the Provider entry; go/no-go 9 Nov, proposed):** a compatible canonical intent exists; the miner's response matches its contract; the evaluation pool is eligible (≥ `min_submitters` distinct submitters); a truth-source path exists if the scoring class needs one; the intent's test questions are ones a package-release miner can answer well; active snapshot, score and rank are observable. On 2 Nov `QUESTION_ANSWERING_GENERAL` had 3 of 5 submitters, so no miner on it had a QA score, and its test set is general questions, on which a package-only miner would rank last (§3.5). Status 9 Nov: the pool is eligible (5 of 5), the intent is `judgment` so no truth source is needed, and the miner is registered, answering and scored (rank 11 of 17); the test set is still mostly general questions. The go/no-go decision itself is not recorded yet.

## 1. Hackathon scoring (checked 2 Nov 2026)

| Category | Points |
| --- | --- |
| Technical quality and mainnet readiness (minimum 24) | 35 |
| Commercial viability | 25 |
| Genuine independent adoption and retention | 10 |
| Telegraph integration and usage quality | 5 |
| Reproducibility, demo/tutorial and proof | 5 |
| Organic growth, education and developer activation | 20 |

- [ELIGIBILITY] At least one genuinely autonomous machine-to-machine purchase, followed by meaningful use of the purchased intelligence. Buying several intents is not required.
- [SCORE] Cost per merged PR is our product KPI, not a formal mission requirement; the mission's own example is cost per verified correct answer. Show both cost per useful/verified answer and cost per merged migration PR.
- [SCORE] At least three meaningful original public updates on separate dates, plus educational material and evidence of independent developer activity; posts alone do not earn the 20 growth points.
- [ELIGIBILITY] Final deadline 1 Dec 2026, 23:59 UTC: 2–5 minute demo video, reproducible evidence, five-question commercial summary. 14 Nov is an internal integration milestone only.
- Reviewer's estimate at the reviewed stage: about 35/100; technical minimum not yet met. The gap is the lack of a post-event paid answer from a suitable provider that drives a useful migration.

## 2. Bot (GitHub Action)

### 2.1 Architecture

- [PRODUCT] GitHub Action with draft PR and human label approval. The automatic first Q&A purchase followed by approval for the fix stage satisfies the autonomy requirement provided: the first purchase is initiated by the agent with no human approving that transaction; it is paid through Telegraph; the answer is used to complete a meaningful task, not merely displayed. It must not be a disguised manual or pre-funded demonstration.

### 2.2 Installation and trigger

- [PRODUCT] One workflow file installs it. Initial scope: public GitHub repositories only.
- [PRODUCT] Runs on a schedule the developer sets in their workflow file (`on: schedule` cron; the example workflow uses weekly) and on manual `workflow_dispatch`; one run per repository at a time via concurrency controls. The Action does not trigger on human PRs: a developer who has already bumped a dependency gets nothing useful from it (decided 2 Nov; [ADR 0001 amendment](adr/0001-deterministic-cutoff-detection.md)).
- [PRODUCT] The Action is pinned to a release or immutable commit SHA; installers never execute an unpinned latest.
- [PRODUCT] Document repository Actions permissions, the setting allowing Actions to create pull requests, required `contents` and `pull-requests` permissions, fork limitations and unsupported layouts.

### 2.3 Dependency eligibility and `MODEL_CUTOFF`

- [PRODUCT] `Eligible(A, B) = semver(B) > semver(A) AND releaseDate(B) > MODEL_CUTOFF`, where A is the installed version from the lockfile and B the latest eligible stable version from the registry. Release timestamps come from registry metadata, never the LLM. Prereleases excluded. Missing or ambiguous dates fail closed. If B equals A, do nothing. This rule is our design, not a Telegraph or hackathon requirement; the eligibility requirement is the autonomous purchase and its meaningful use (§1).
- [PRODUCT] A comes from the lockfile, never from stripping `^`/`~` off a `package.json` range.
- [PRODUCT] Edge cases, MVP behaviour: B is the registry `latest` dist-tag when it is stable, otherwise the highest stable version; aliases (`npm:`), Git URLs, `file:`, `link:` and `workspace:` specifiers are skipped with a diagnostic; invalid or non-semver ranges are skipped; scoped packages are supported; lockfile and `package.json` disagreeing (lockfile out of date) fails closed for that package; a version missing from the registry is skipped; release timestamp missing fails closed.
- [PRODUCT] Multi-major jumps: if B is more than one major version above A, the question and report cover every intervening major release (or the PR targets the next major only); asking only "A to B" may miss intermediate deprecations. The target stays B, the eligible post-cutoff version; the question and report cover every intervening major release. Never retarget a PR to an intermediate version released before the cutoff: that would pay for something the model already knows. Splitting large jumps into steps is open.
- [PRODUCT] Internal classification is `post_cutoff_candidate`, not `unknown_to_model`: a published cutoff is a heuristic, not proof the model cannot know later information.
- [PRODUCT] Config records provider, exact model identifier, cutoff date, cutoff source URL, whether the cutoff is provider-documented or team-assumed, and configuration timestamp. The cutoff belongs to the installer's configured model; there is no project-wide universal cutoff. If the provider documents none, the date is labelled team-assumed.
- [PRODUCT] Do not require unused credentials: either the LLM call is implemented or `LLM_API_KEY` is not required.

| Dependency type | MVP policy |
| --- | --- |
| `dependencies` | Include |
| `devDependencies` | Include |
| `optionalDependencies` | Exclude initially |
| `peerDependencies` | Exclude |
| Transitive dependencies | Exclude |
| npm workspaces | Exclude initially |
| npm lockfile v2/v3 | Support and test |
| Missing or unsupported lockfile | Fail closed with a clear diagnostic |

Never scan incomplete dependency information silently.

### 2.4 Telegraph purchase and provider selection

- [MISSION] Telegraph V2 separates an intent family from a concrete canonical intent id. Miners register for specific canonical intents; `QUESTION_ANSWERING`, `QUESTION_ANSWERING_GENERAL` and similar names are not interchangeable. Before the design is frozen, establish for every purchased intent:

| Required fact | Live source |
| --- | --- |
| Exact canonical intent ids | `GET /engine/v1/intents` |
| Class, request and response schema | `GET /engine/v1/intents/{intentId}` (`class`, `request`, `response`, `wasm`) |
| Registered providers with activation, price and per-intent scores | `GET /api/miners?intent={canonicalId}` |
| Providers competing for the intent | `GET /engine/v1/intents/{intentId}/miners` |
| Registration detail and activation | `GET /api/miners/{registrationId}` |
| Evaluation-pool status | `GET /api/evalpool/status?intent_id={intentId}` |

- [PRODUCT] Always query with the canonical id. `/api/miners?intent=QUESTION_ANSWERING` returns `[]` because that is the family prefix; with `QUESTION_ANSWERING_GENERAL` it returns the 10 registered providers with `scores[]`. On 2 Nov `/engine/v1/intents/{id}/miners` returned no rank or score fields, and no provider had a `QUESTION_ANSWERING_GENERAL` score. Do not repair `rankMiners()` by guessing fields; read rank from `scores[]` for the exact intent id, or report "rank unavailable".
- [MISSION] Intent fit is a gate, not just canonicality. The chosen intent must accept the package/version question the agent sends, and its response must be usable. `QUESTION_ANSWERING_GENERAL` has no input schema: the node rejects `params` (400 `no_input_schema`) and takes a free-form `query`. It has no response schema, so there are no canonical fields to validate; the agent validates the answer itself (package, version, sources, claims). If a future canonical child adds schemas, re-snapshot and adapt.
- [PRODUCT] Config entries `QA_INTENT_ID`, `CODEGEN_INTENT_ID`, `PATCH_VERIFY_INTENT_ID`, `REGRESSION_VERIFY_INTENT_ID`, validated at startup against the live catalogue. A missing, unavailable or schema-incompatible intent disables that capability with an explicit diagnostic. Never substitute another intent silently.
- [PRODUCT] Routing policy, one of two, chosen explicitly:

| Approach | Meaning |
| --- | --- |
| Engine auto-routing | Telegraph selects the provider by its routing policy; record the actual miner and its rank/score snapshot |
| Manual top-rank selection | Our own policy: pick a miner and call its id endpoint; not Telegraph's weighted routing |

Open, not yet decided by the team. Recommendation: Engine auto-routing (`POST /engine/v1/ask` with `intent` = the canonical id and a free-form `query`) for the qualifying purchase, because it matches the mission's procurement story. Counter-evidence: the current client calls a ranked miner directly because on 28 Oct a routed QA query was re-classified to `SECURITY_REVIEW` (comment in `bot/src/x402.ts`), and on 2 Nov none of the routable QA providers knew package releases. Re-test routing with the canonical id before deciding. Higher-scoring providers receive proportionally more traffic; the weights are not hardcoded or quoted. Never claim the Engine chose a miner when the application did; a direct `POST /engine/v1/ask/{minerId}` purchase is labelled as our choice and steps down only on an explicitly classified failure. A delivered but low-quality answer is not a transport failure; retrying it causes extra charges. Since 6 Nov the client can also try one miner of our choosing first (`PREFERRED_MINER_ID`, e.g. the team's miner 7314 while it is unranked); such a purchase is recorded as `selectedBy: "our_choice"`, and on a failed call the client steps down to the ranked miners.

- [PRODUCT] Ranking snapshot per purchase: the miner registration id the Engine returned; the raw provider/score response fetched immediately before or after the request, with capture timestamp and content hash; rank and score mapped from it only when present for the exact intent id, otherwise "rank unavailable". The snapshot is observational, not a guarantee of what the router evaluated at that instant. Never show a rank the evidence does not contain.

### 2.5 Quote, payment and accounting

- [PRODUCT] The 402 challenge's `accepts[]` is authoritative for network, chain id, asset, amount and pay-to address. Never hardcode a network or USDC address from an earlier configuration.
- [PRODUCT] Enforce `MAX_PRICE_PER_CALL_USDC` and the remaining run/stage budget in the application and in the x402 client's spend controls where supported.
- [PRODUCT] Store `min_price_usdc`, quoted amount and actual charged amount separately; a floor is not the payment, demand multipliers change the quote.
- [PRODUCT] A successful HTTP response is not a useful answer. Inspect the Engine `result_shape` and `field_status`; an HTTP 200 with an error-like body can still be delivered and billable.
- [PRODUCT] Payment may settle before the miner call; failed delivery may be credited to escrow. Record settlement, delivery and refund/credit as separate states. The x402 guide and the protocol overview describe settlement timing differently: a controlled failed-delivery test against the current node (payment response, settlement, escrow balance, receipt absence) is required before the docs state the behaviour as fact.
- [PRODUCT] On 2 Nov the challenge offered two schemes on Ethereum Sepolia: `exact` (per-request x402) and `escrow` (deducted from a pre-funded Telegraph escrow balance at the next epoch close). Which scheme the MVP uses is open; attempt and ledger records must be able to represent both.
- [PRODUCT] A transaction hash is not a unique purchase id; one transaction can settle several requests. `receipt_hash` identifies a delivered purchase; `signal_hash` and `tx_hash` are separate evidence links.

### 2.6 Purchase idempotency

- [PRODUCT] Identity: `repository + ecosystem + package + installed_version + proposed_version + intent_id + normalized_question_hash`. Reuse a previous valid answer while all of these are unchanged.
- [PRODUCT] A new Q&A purchase is allowed only when the installed version changes, the proposed target changes, a refresh is explicitly requested, or the previous attempt delivered no usable result and the retry policy allows another provider/attempt.
- [PRODUCT] Generation and verification operations are keyed on patch digest + operation name + attempt number.
- [PRODUCT] The ledger, not Actions concurrency alone, is the source of truth for duplicate suppression.
- [PRODUCT] Crash safety. The logical key above stops repeat purchases after a result is recorded; it does not stop a second payment if the process dies after paying but before recording. Each paid call is a durable attempt with a state machine:

```text
reserved → quote_refused
         ↘ request_sent → delivered
                        ↘ failed_and_credited
                        ↘ failed_not_charged
                        ↘ unknown_needs_reconciliation
```

- [PRODUCT] `quote_refused`: our price or budget limit refused the quote; nothing was sent. `failed_and_credited`: a valid payment settled, then the call failed (miner down, timeout, error status); the amount is credited to escrow and never charged. `failed_not_charged`: the node rejected the signed payment (402, or 400 "Invalid payment") or the settlement header reported `success: false`. `unknown_needs_reconciliation`: the request went out and no readable outcome came back. Source for the two failure meanings: [x402 inference, Step 3](https://anjoman.ai/docs/using/x402-inference). `quote_refused`, `failed_and_credited` and `failed_not_charged` are final and allow a new attempt.

- [PRODUCT] Persist the attempt as `reserved` before the external request and as `request_sent` immediately before sending. Persist payment response, receipt and signal immediately after the call. A run that finds an attempt in `request_sent` or `unknown_needs_reconciliation` for the same key halts automatic retries for that key and reports it; a person reconciles it against settlement, escrow and signal evidence. Where attempt state is persisted (the ledger branch or a run artifact) and who reconciles are part of C's ledger design. No exactly-once claim unless the payment rail offers an idempotency key and we use it.

### 2.7 Q&A result and `not_found` handling

- [PRODUCT] The answer is untrusted text: evidence and input for the PR body and the LLM prompt, never instructions to the agent or a shell.
- [PRODUCT] On `not_found` or an unusable answer: keep the delivered purchase and receipt; mark `unanswered` or the explicit status; state that suitable release information was not found; do not ask the LLM to invent a migration; do not proceed to the fix stage; leave a report-only draft or close by documented policy. Absence of release notes never implies an upgrade is safe.
- [PRODUCT] A 4 KB display cap is fine, but never truncate the only stored copy. Preserve the raw result or a content-addressed copy/hash; cap the displayed excerpt separately.

### 2.8 Draft PR report and call-site discovery

- [PRODUCT] The miner cannot know which functions the repository calls. Add a free, local, deterministic step: extract renamed/removed/deprecated symbols from the answer → search the repository and/or inspect the AST → map symbols to files and call sites → build the report. No extra purchase.
- [PRODUCT] Fixture acceptance test: a source file containing a deprecated or renamed API; the report must name the correct file and symbol.
- [PRODUCT] One PR per package and target version, with a stable branch/PR identity, updated on later runs, never duplicated. Define behaviour when the installed base SHA changes while the draft is open.
- [PRODUCT] Report contents: version bump, why upgrade, known vulnerabilities in the installed version (OSV, free), changed functions/methods, affected files and call sites, what to change, spend so far, estimated fix cost, and the `telegraph:fix` instruction. Only users with write access can add labels; closing the PR ends the flow.
- [PRODUCT] OSV is used only to strengthen the upgrade report ("this upgrade also fixes CVE-…") and to process vulnerable packages first. No standalone vulnerability PRs and no general vulnerability scanner: that space is crowded (Dependabot alerts, `npm audit`, Snyk, Socket); our niche is the upgrade plus the code migration.

### 2.9 Fix stage and paid provider availability

| Operation | Priority |
| --- | --- |
| Telegraph Q&A purchase | [MISSION] MUST |
| Use purchased Q&A in migration generation | [MISSION] MUST |
| Telegraph `CODE_GENERATION` | [SCORE] SHOULD, only a provider that passes quality tests |
| Telegraph `CODE_PATCH_VERIFY` | [SCORE] SHOULD, validate live intent and provider first |
| Telegraph `REGRESSION_VERIFY` | [SCORE] SHOULD, validate live intent and provider first |
| Local install, typecheck, tests | [PRODUCT] MUST |

- [PRODUCT] Use the team's or installer's LLM for patch generation until a Telegraph `CODE_GENERATION` miner passes real tests. The paid Q&A is a material input to the patch. Never pay a provider only to increase receipt count.
- [PRODUCT] A usable code-generation response: valid patch/diff; applies against the expected base SHA; touches only permitted files; no out-of-scope modifications; passes subsequent independent verification.
- [PRODUCT] A failed or unavailable paid verification provider never blocks the core workflow. Local CI remains mandatory. The fix stage has its own spend cap.

### 2.10 Security and trust boundaries

| Job | Secrets | Responsibility |
| --- | --- | --- |
| 1. Intelligence/payment | Wallet key; installer LLM key if needed | Read repository files as data, make Telegraph purchases, generate a proposed patch. Execute no repository scripts |
| 2. Verification | None | Apply the patch; install dependencies; run typecheck and tests on an isolated runner. Repository code is untrusted |
| 3. Commit/push | Minimal short-lived write token | Validate artifact integrity, permitted paths and expected base SHA; push without executing repository code |
| 4. Merge accounting | Minimal read/report permissions | Record the human merge event; update public accounting |

- [PRODUCT] The patch from the untrusted job is an artifact; the privileged job never trusts it blindly. Define provenance/integrity checks and an allowed-path policy before pushing.
- [PRODUCT] Never execute repository code in a job holding wallet, LLM or write-token secrets. Never combine `pull_request_target` with checking out and executing PR code. Pin third-party Actions to full commit SHAs. Least-privilege job permissions. Do not persist credentials in checkout configuration.
- [PRODUCT] Treat miner output, release notes, issue text and generated code as untrusted; resist prompt and shell injection; render no arbitrary HTML; trust no arbitrary URLs from provider output. A generated diff may not modify the workflow, the Action or privileged scripts unless explicitly allowed.
- [PRODUCT] LLM payment ownership is explicit: the installer supplies their own LLM key in a separate repository secret and pays the provider directly. README and dashboard state that the installer pays both Telegraph and LLM costs. Central payment would be a different architecture and must be stated honestly.

### 2.11 Reviewer acceptance tests

1. No post-cutoff dependency: no PR, no spend.
2. Eligible dependency with usable Q&A: one purchase, one draft PR.
3. Repeated scheduled run, same package and versions: no duplicate purchase, no duplicate PR.
4. No label added: no fix-stage purchase.
5. Unauthorised user attempts the label: no fix-stage purchase.
6. Maintainer adds the label: fix stage starts within its separate budget.
7. `not_found` Q&A: no invented migration, no automatic fix.
8. Generated patch fails typecheck: nothing is pushed as a successful fix.
9. Generated patch passes tests: the privileged job pushes only the validated patch.
10. PR closed: workflow stops; previous spend remains accounted.
11. PR merged: one merge outcome recorded exactly once.
12. Malicious package lifecycle script cannot access any secret.

## 3. Miner (package-release `QUESTION_ANSWERING`)

The miner's detailed spec, plan and tasks are in [miner/specs/001-package-release-miner/](../miner/specs/001-package-release-miner/spec.md), the source of truth for the miner; this section keeps the product rules and the Telegraph constraints. Status and usage: [miner/README.md](../miner/README.md).

### 3.1 Service

- [PRODUCT] Public HTTPS endpoint answering package/version-specific release intelligence for npm and PyPI; deterministic use of registry metadata.
- [PRODUCT] Source priority: registry metadata (release date, repository URL) → GitHub Releases → repository `CHANGELOG.md` → git tag comparison. Dates and repository URLs come from registries, source URLs from retrieved material, never from the LLM.
- [PRODUCT] Return `not_found` when no usable notes exist; never imply notes exist or let the model infer them.
- [PRODUCT] Source fetching is an SSRF and prompt-injection boundary. Package metadata URLs are untrusted. Allow only `https` and the hosts actually needed (npm and PyPI registries, `github.com`, `api.github.com`, `raw.githubusercontent.com`); block loopback, private, link-local and cloud-metadata addresses after DNS resolution and after every redirect; cap redirects, response size and time; strip credentials from URLs; validate content type; never execute fetched scripts or package code; treat release-note text as data, never as instructions to the model.
- [PRODUCT] Internal response shape (illustrative; the external response must satisfy the live canonical intent `response.fields`, result shape and `field_status` contract):

```json
{
  "answer": "...",
  "package": "...", "ecosystem": "npm", "version": "...", "released_at": "...",
  "breaking_changes": [{ "change": "...", "migration": "...", "evidence_quote": "...", "source_id": "source_1" }],
  "deprecations":     [{ "change": "...", "migration": "...", "evidence_quote": "...", "source_id": "source_1" }],
  "sources": [{ "id": "source_1", "url": "...", "title": "..." }],
  "signal": "found"
}
```

### 3.2 Evidence and answer quality

- [PRODUCT] Each breaking change and deprecation includes a supporting quote, a source id and an actionable migration line. Never invent a breaking change because a major version changed. Distinguish explicit release-note statements from inferred compatibility concerns. A bare source list without claim-to-source mapping is insufficient.
- [PRODUCT] `not_found` when: registry metadata exists but no notes or commit evidence can be found; candidate URLs are invalid or unavailable; retrieved material does not identify the requested version; sources do not support a reliable answer. The LLM never produces plausible dates or URLs.

### 3.3 Cache and latency

- [PRODUCT] Cache key includes package, ecosystem, version and a source revision/content hash, so edited notes or tags do not serve stale answers.
- [PRODUCT] Targets: the mission lists `< 2 s` for QUESTION_ANSWERING, so cached under 500 ms and warm under 2 s are the normal targets; cold path p50/p95 measured through the Engine, not only against the local endpoint, and published. A cold path that fetches several APIs and runs an LLM will miss 2 s: pre-index and cache release material for popular packages. Do not advertise `< 2 s` until measured through the Engine.
- [PRODUCT] Health checks and structured failure logs; timeouts, rate limits and graceful degradation. Telegraph spot-checks about hourly and may stop routing after consecutive failures.

### 3.4 YAML and canonical intent contract

- [MISSION] Check the current schema for every required field: top-level `name`, `version: "1"`, `kind: miner`, unique id and slug, `base_url`, endpoint `path`, `external_path`, `method`, `description`, `intents`, `params` (for `GET /query`, `query` is a required string tied to the exact intent), `semantics.supported_intents`, documented `input_schema`/`output_schema`, `intent_mapping` where needed, `signal_mapping` using only the documented fields (`confidence_field`, `label_field`, `reason_field`).
- [MISSION] The exact canonical intent id comes from the live catalogue; never a family prefix or an assumed `_GENERAL` name.
- [MISSION] Compatibility test: an internally valid JSON response is not necessarily a valid Telegraph result. Test the full Engine request and confirm the returned result uses the canonical intent shape with valid `field_status` values.
- [PRODUCT] Validate and register at [anjoman.ai/dashboard/earn](https://anjoman.ai/dashboard/earn); the `cast` commands in the registration docs are the manual fallback. The documented `POST https://anjoman.ai/dashboard/validate` endpoint currently does not accept requests; scripted checks validate the YAML against the schema instead.

### 3.5 Scoring and evaluation pool

- [PRODUCT] `QUESTION_ANSWERING_GENERAL` is class `judgment` on the live node (the mission page calls the QA capability hybrid; the node wins). There is no truth source or fact check: the `GENERIC` fallback evaluator adapter, a reward model on ModernBERT-base, scores each answer from 0 to 1, reading the question and answer up to 512 tokens. Miners are ranked each epoch on questions from the ranking half of the intent's evaluation pool, sampled evenly across contributors. Details and commands: [docs/telegraph/qa-scoring-2026-11-09.md](telegraph/qa-scoring-2026-11-09.md).
- [PRODUCT] The former stop-ship gate is passed: the pool reached 5 of 5 eligible submitters, and miner 7314 has been scored since 6 Nov (rank 11 of 17, score 0.7955 at epoch 2042).
- [PRODUCT] Fit of the test set. The pool's questions are general (news, science, economics), so a miner that only answers package-release questions ranks below general answerers. Done on 9 Nov: 30 package-upgrade questions with better and worse answers uploaded, signed by the miner's payout wallet, so openly the team's; found answers lead with a "Key changes" line inside the judge's 512 tokens (processing version `p8`). Rows from the team's own wallets do not count as independent; the rules treat related wallets as one group. Still open: a dedicated sub-intent such as `QUESTION_ANSWERING_PACKAGE_RELEASE`, requested from Telegraph on 2 Nov; no reply is recorded here.
- [PRODUCT] Re-check `GET /engine/v1/intents/{exactIntentId}`, `GET /api/wasm?resolve={exactIntentId}` and `GET /api/evalpool/status?intent_id={exactIntentId}` before relying on these facts. New rows enter the active snapshot only at an epoch rollover.
- [MISSION] A miner cannot extend the intent's public result shape. Rich internal JSON (`breaking_changes`, `sources`, …) is either mapped into the intent's declared response fields or reaches the caller only as free text or raw miner output. With no response schema on `QUESTION_ANSWERING_GENERAL`, prove through the Engine what the caller actually receives before writing the PR generator against it.

### 3.6 Registration, activation and ranking

- [PRODUCT] Track as distinct states: YAML validated → registered on chain → `activation_status: active` → grace period → scored → ranked/eligible for weighted routing. `active` is not proof of a leaderboard rank. Confirm the current grace-period behaviour and registration availability live; timing matters.
- [ELIGIBILITY] Evidence: validated YAML, registration transaction, activation status, exact intent id, grace-period status, score and rank if available, active evaluation snapshot, a working provider request and response.
- [ELIGIBILITY] Use a wallet different from the bot's operationally and disclose common team ownership; separate wallets do not make activity independent.

### 3.7 Pricing

- [PRODUCT] Distinguish `min_price_usdc`, `quoted_amount_usdc` and `actual_amount_usdc`. The x402 challenge states the actual amount. Never display the floor as revenue or spend.

### 3.8 Miner-track evidence

- [ELIGIBILITY] Public endpoint URL; exact registration YAML; validation result; registration transaction and wallet disclosure; five sample requests with complete answers; evaluation rows and provenance; truth-source configuration if required; active snapshot and scoring/ranking evidence; README with a repeatable answer-quality test; measured latency and failure behaviour.
- [PRODUCT] The miner is sellable to unrelated agents. The bot buys from it only when live routing/ranking selects it, or when an explicitly documented manual policy does.

## 4. Dashboard and accounting

### 4.1 Payment attempts versus delivered receipts

- [PRODUCT] Two related records. Payment attempts: `attempt_id, repo, pr, head_sha, step, attempt, quoted_amount_usdc, payment_status, delivery_status, escrow_credit_usdc, created_at`. Delivered purchases: `receipt_hash, signal_hash, tx_hash, miner_id, intent, amount_usdc, rank, score, result_status, timestamp`. One operation may have several attempts; each delivered call has its own receipt record; preserve the link between them.

### 4.2 Identities

| Record | Identity |
| --- | --- |
| Delivered purchase | `receipt_hash` |
| Application operation | repo + PR + headSha + step + attempt |
| Merge outcome | repo + PR + mergedHeadSha + eventType |
| Q&A cache/purchase reuse | repo + ecosystem + package + installed version + proposed version + intent + normalised question hash |

`(PR, headSha)` alone is never the key: Q&A, generation, verification and retries are distinct billable activities. A duplicate merge event never creates a second merge count.

### 4.3 Cost per merged PR

Cost per merged PR = total net automation expenditure ÷ number of merged bot PRs. Default window: cumulative over the repository's whole ledger; a dated reporting window (for example the event period) is shown as a separate figure with its dates.

| Item | Treatment |
| --- | --- |
| Successful Telegraph calls | Include |
| Valid `not_found` answers | Include |
| Team or installer LLM generation | Include, attributed to PR and operation |
| Paid delivery credited back to escrow | Exclude from net; show separately |
| Closed or unmerged proposals | Include actual expenditure |
| Rejected proposal after Q&A | Include prior expenditure |
| Quote refused before payment | Not expenditure; show refused quote separately |
| LLM cost for failed patches | Include |

- [SCORE] Zero merged PRs shows `N/A`, never zero. Show numerator, denominator, proposal count, merged count, merge rate and sample size, labelled honestly (for example n=2).
- [SCORE] Also show cost per useful/verified answer; Telegraph spend and LLM spend separately; merged versus unmerged/declined spend; escrow credits/refunds; refused quotes.

### 4.4 LLM cost attribution

- [PRODUCT] Per LLM operation: provider and model, input/output tokens, billed amount or documented rate with its rate-card version, repository/PR/operation identity, timestamp, success state. Otherwise Telegraph spend is accurate while total automation cost is undercounted.

### 4.4a Three kinds of success

Recorded separately, never inferred from one another: **payment delivered** (valid response and receipt), **answer useful** (source checks and quality evaluation pass), **migration successful** (patch applies and repository tests pass). A receipt proves neither answer quality nor migration correctness; HTTP 200 is not a product success state.

### 4.5 Public data and network metadata

- [PRODUCT] Public repositories only; never expose private repo code, paths or PR metadata.
- [PRODUCT] Per payment store `network`, `chain_id`, `USDC_contract`, `explorer_base_url` from the actual challenge; generate transaction links from stored metadata, never from a hardcoded network.

### 4.6 Detail and evidence export

- [ELIGIBILITY] PR-centric public view: repo, PR, package, installed and proposed versions, steps completed, fix pushed, merged, total cost; per paid call the miner, rank/score snapshot, amount, receipt hash, signal link, transaction link; testnet label on every figure; downloadable ledger export and CSV of receipt/signal/transaction links.
- [PRODUCT] The dashboard reads public raw ledger data. No private GitHub token in browser JavaScript.

### 4.7 Ledger scenarios

| Scenario | Expected result |
| --- | --- |
| Q&A purchase | One delivered purchase record |
| Same scheduled run repeated | No duplicate purchase |
| Process dies after payment, before recording | Attempt left `request_sent`; next run halts retries for that key until reconciled |
| Patch generation | Separate operation/attempt |
| Second paid request | Separate receipt |
| Retry | New attempt, correctly linked |
| Quote refused | No spend; refused quote recorded |
| Failed paid delivery | Settlement/credit recorded separately |
| `not_found` delivered answer | Spend included; status `unanswered` |
| Tests fail | No successful patch/merge record |
| PR closed unmerged | Spend retained |
| PR merged | Separate merge outcome |
| Duplicate merge event | No duplicate merge count |

## 5. Shared requirements and submission

- [ELIGIBILITY] Disclose: buyer wallet, miner wallet, common ownership/control, that the team runs the miner, any self-purchases, code written before 1 Nov, reused open-source components and licences. Self-purchases never count as third-party adoption; the rules group related wallets and prohibit manufactured activity.
- [SCORE] At least three original public updates on separate dates: build announcement; working result with a real purchase and meaningful outcome; an educational/technical update showing how another developer reproduces or uses the integration. Add onboarding and quickstart material and seek independent developer trials.
- [ELIGIBILITY] Final materials with owners and acceptance criteria: public submission summary; README/quickstart; 2–5 minute demo video; reproducible fixture repository; evidence pack whose purchases, transactions, usage, demos and adoption evidence fall in 1 Nov–1 Dec 2026 (package release notes and registry records keep their original dates); ledger export and receipt CSV; network/testnet disclosures; wallet and related-party disclosures; licence list; five-question commercial summary (target user, improvement over alternatives, current functionality, reason to adopt, how to try it), not left to the last minute.
- 14 Nov: internal target for one full cycle on a fixture repository. 1 Dec 23:59 UTC: final deadline, reconfirmed on the official site before submitting.

## 6. Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Trigger | Developer-configured schedule (default weekly) + manual run; lockfile A vs registry B; no PR-diff trigger in the Action | A developer who already bumped a dependency gets nothing from the bot; CLI v0 stays a prototype |
| Purchase route | Open: Engine auto-routing (recommended) or direct call to a chosen miner (current client) | Re-test routing with the canonical id first (§2.4) |
| Vulnerabilities | OSV only inside upgrade PRs; no standalone vulnerability PRs | Scanners are a crowded space; our niche is the code migration |
| Miner track | Separate entry; go/no-go 9 Nov (proposed) | Never blocks the App |
| Spend approval | Buy Q&A automatically; `telegraph:fix` label for patch work | Qualifying purchase stays autonomous; maintainers control spend |
| Who pays Telegraph | Installer's dedicated low-balance wallet in repo secrets | No custody or relay; disclose testnet funding |
| Who pays LLM | Installer's own key for MVP | Dashboard economics match the real payer |
| Who writes the patch | Team/installer LLM with the purchased answer as input | Codegen provider quality unproven; switch after a provider passes tests |
| Paid verification | Optional until proven | Secretless local CI already verifies |
| Dashboard | One public ledger per public repository | Small; aggregation later |
| `MODEL_CUTOFF` | Tied to the exact model; documented vs assumed recorded | Transparent heuristic |
| Package scope | npm direct dependencies, one package/version per PR | Smallest testable slice |
| Payment | x402 | Few calls; escrow later if usage justifies |
| Own-miner purchases | Disclosed, not counted as demand | No misleading adoption claims |

## 7. Week-one checks (1–7 Nov 2026), in order

**Check 1 — live intent catalogue.** Done 2 Nov for the QA intent ([snapshot](telegraph/qa-intent-contract-2026-11-02.md)); repeat for any other intent and before each milestone. `GET $NODE/engine/v1/intents`; for each candidate id: `/engine/v1/intents/$INTENT`, `/engine/v1/intents/$INTENT/miners`, `/api/miners?intent=$INTENT`, `/api/evalpool/status?intent_id=$INTENT`. Inspect class, schemas, scoring modules, providers, score fields, pool requirements, active snapshot. Save the result as a dated snapshot. Kill: intent not canonical, no usable provider, or no compatible request shape.

**Check 2 — miner evaluation eligibility.** For the exact QA intent: class, test-set fit, `min_submitters`, `eligible_submitters`, active snapshot and epoch, row schema and `label_kind`, provenance, truth-source configuration. Kill: no truth-source path, no contributor path, or no realistic chance of a ranked miner in the window.

**Check 3 — payment network and quote without spending.** `POST $NODE/engine/v1/ask` with a valid request and no payment header; expect 402; decode `accepts[]` and confirm network/chain id, USDC asset, amount, pay-to, scheme and facilitator. Sign nothing. Kill: no valid quote on a usable network, or payment schema incompatible with the client.

**Check 3b — failed delivery.** One valid paid request that is expected to fail at the miner; inspect payment response, settlement, escrow balance, receipt absence and retry behaviour. Kill: payment/credit accounting cannot be determined.

**Check 4 — package-release answer quality.** Start with one tightly capped request (Engine routing with the canonical id, and LiveCert directly as the only general web-search QA provider); continue only if useful. A few paid requests for realistic npm transitions; verify package/version identity, dates against the registry, every breaking-change claim against cited sources, deprecations and migration steps, resolving links; record price, latency, receipt, signal; retrieve and validate the signal by hash. Kill: providers repeatedly return generic or unsupported answers.

**Check 5 — our miner.** Validate YAML; confirm registration is open on the current chain; register; query activation; call the service directly; call it through the Engine; validate canonical result shape and signal mapping; check grace, scoring, rank. Kill: cannot activate promptly, cannot return a compatible result, or answers are inaccurate.

**Check 6 — Action events and security** on a fixture repo: schedule, `workflow_dispatch`, draft PR creation, human `telegraph:fix` label, unauthorised label, closure, merge, failed typecheck, successful tests and push; a malicious lifecycle script that tries to read a test secret must find no wallet, LLM or write-token credential. Validate the actual event types (`labeled`, `closed` differ from open/synchronize) against current GitHub documentation. Kill: repo code can run in a job with secrets, or the event model cannot support approval/push without unsafe permissions.

**Check 7 — ledger correctness.** Run the scenario table in 4.7.

## 8. Execution order

1. B and A jointly resolve exact intent ids, schemas, payment network and provider discovery (QA done 2 Nov).
2. A proves whether the QA miner can be scored/ranked and answers package-release questions accurately, by the 9 Nov gate. This runs in parallel and never blocks steps 3–5.
3. B proves one useful paid Q&A purchase and uses it in a real migration with the installer's LLM.
4. B completes the secure Action vertical slice and fixture failure cases.
5. C finalises attempt/receipt accounting and the dashboard on real data structures.
6. A continues miner-track work only while the scoring/registration path stays viable.
7. C coordinates developer trials, public updates, demo and evidence pack.

The differentiator is not buying four AI responses. It is knowing when information may be stale, procuring relevant external intelligence, applying it to real software, verifying the change and accounting for the economics.
