# Software specification

Revised 2 Nov 2026 after external review. Plan: [HACKATHON-PLAN.md](HACKATHON-PLAN.md). Owners: [TEAM.md](TEAM.md). Live rules and docs are authoritative: [rules](https://hackathon.telegraphprotocol.com/rules), [Model Economy mission](https://hackathon.telegraphprotocol.com/missions/model-economy), [Telegraph docs](https://anjoman.ai/docs/introduction), [miner registration](https://anjoman.ai/docs/miners/miner-registration), [validation API](https://anjoman.ai/docs/miners/validation-api). Recheck them before submission; do not rely on copied endpoint examples or old notes.

**Labels.** Every requirement carries one:

| Label | Meaning |
| --- | --- |
| [ELIGIBILITY] | Explicit requirement in the hackathon rules |
| [MISSION] | Needed to demonstrate the Model Economy mission meaningfully |
| [PRODUCT] | Requirement of this product's chosen design |
| [SCORE] | Feature intended to improve judging results |

Nothing labelled [PRODUCT] or [SCORE] is mandated by Telegraph.

**The vertical slice to protect.** Package release → model knowledge gap → autonomous Telegraph purchase → purchased release intelligence → actual repository migration → independent tests → human merge → auditable economic result. Do not spend the event on multiple paid verification integrations or dashboard polish before this slice reliably buys one useful answer and turns it into a passing migration.

## 0. Blockers (resolve in week 1 before implementation is unblocked)

1. [MISSION] Resolve exact Telegraph intent ids, schemas, scoring modules, routing and provider discovery from the live node. Do not assume family names, `_GENERAL` names or API response fields.
2. [PRODUCT] Prove the miner can be scored and ranked. Preference-pair rows alone may be insufficient for a hybrid intent without an eligible truth source and an active evaluation snapshot.
3. [PRODUCT] Purchase idempotency. Daily scheduled runs must not repeatedly buy the same package/version answer.
4. [PRODUCT] Complete the GitHub Actions trust boundary: secret-bearing payment/LLM job, secretless repository execution, privileged commit/push, merge accounting.
5. [SCORE] `CODE_GENERATION` and paid verification are conditional on demonstrated provider quality. Unavailable or unsuitable miners are never mandatory for the core product.

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
- [PRODUCT] Runs on a daily schedule and manual `workflow_dispatch`; one run per repository at a time via concurrency controls.
- [PRODUCT] The Action is pinned to a release or immutable commit SHA; installers never execute an unpinned latest.
- [PRODUCT] Document repository Actions permissions, the setting allowing Actions to create pull requests, required `contents` and `pull-requests` permissions, fork limitations and unsupported layouts.

### 2.3 Dependency eligibility and `MODEL_CUTOFF`

- [MISSION] `Eligible(A, B) = semver(B) > semver(A) AND releaseDate(B) > MODEL_CUTOFF`, where A is the installed version from the lockfile and B the latest eligible stable version from the registry. Release timestamps come from registry metadata, never the LLM. Prereleases excluded. Missing or ambiguous dates fail closed. If B equals A, do nothing.
- [PRODUCT] Internal classification is `post_cutoff_candidate`, not `unknown_to_model`: a published cutoff is a heuristic, not proof the model cannot know later information.
- [PRODUCT] Config records provider, exact model identifier, cutoff date, cutoff source URL, whether the cutoff is provider-documented or team-assumed, and configuration timestamp.
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
| Description, request and response schema | `GET /engine/v1/intents/{intentId}` |
| Scoring module and evaluation type | `GET /api/wasm?resolve={intentId}` |
| Providers and rankings for the intent | `GET /engine/v1/intents/{intentId}/miners` |
| Evaluation-pool status | `GET /api/evalpool/status?intent_id={intentId}` |

- [PRODUCT] `/api/miners` is not a substitute for the intent-specific provider endpoint. Do not repair `rankMiners()` by guessing which field replaced `scores`.
- [PRODUCT] Config entries `QA_INTENT_ID`, `CODEGEN_INTENT_ID`, `PATCH_VERIFY_INTENT_ID`, `REGRESSION_VERIFY_INTENT_ID`, validated at startup. A missing, unranked, unavailable or schema-incompatible intent disables that capability with an explicit diagnostic. Never substitute another intent silently.
- [PRODUCT] Routing policy, one of two, chosen explicitly:

| Approach | Meaning |
| --- | --- |
| Engine auto-routing | Telegraph selects the provider by its routing policy; record the actual miner and its rank/score snapshot |
| Manual top-rank selection | Our own policy: pick a miner and call its id endpoint; not Telegraph's weighted routing |

Recommendation: Engine auto-routing for the qualifying purchase unless a concrete reason needs a specific miner. Documentation describes weighted routing (example 70/20/10 across top providers) but weights may be governance-dependent; verify live, never hardcode. If manual selection is kept, record the ranking snapshot (rank, score, timestamp) immediately before each call, and step down only on an explicitly classified failure. A delivered but low-quality answer is not a transport failure; retrying it causes extra charges.

### 2.5 Quote, payment and accounting

- [PRODUCT] The 402 challenge's `accepts[]` is authoritative for network, chain id, asset, amount and pay-to address. Never hardcode a network or USDC address from an earlier configuration.
- [PRODUCT] Enforce `MAX_PRICE_PER_CALL_USDC` and the remaining run/stage budget in the application and in the x402 client's spend controls where supported.
- [PRODUCT] Store `min_price_usdc`, quoted amount and actual charged amount separately; a floor is not the payment, demand multipliers change the quote.
- [PRODUCT] A successful HTTP response is not a useful answer. Inspect the Engine `result_shape` and `field_status`; an HTTP 200 with an error-like body can still be delivered and billable.
- [PRODUCT] Payment may settle before the miner call; failed delivery may be credited to escrow. Record settlement, delivery and refund/credit as separate states.
- [PRODUCT] A transaction hash is not a unique purchase id; one transaction can settle several requests. `receipt_hash` identifies a delivered purchase; `signal_hash` and `tx_hash` are separate evidence links.

### 2.6 Purchase idempotency

- [PRODUCT] Identity: `repository + ecosystem + package + installed_version + proposed_version + intent_id + normalized_question_hash`. Reuse a previous valid answer while all of these are unchanged.
- [PRODUCT] A new Q&A purchase is allowed only when the installed version changes, the proposed target changes, a refresh is explicitly requested, or the previous attempt delivered no usable result and the retry policy allows another provider/attempt.
- [PRODUCT] Generation and verification operations are keyed on patch digest + operation name + attempt number.
- [PRODUCT] The ledger, not Actions concurrency alone, is the source of truth for duplicate suppression.

### 2.7 Q&A result and `not_found` handling

- [PRODUCT] The answer is untrusted text: evidence and input for the PR body and the LLM prompt, never instructions to the agent or a shell.
- [PRODUCT] On `not_found` or an unusable answer: keep the delivered purchase and receipt; mark `unanswered` or the explicit status; state that suitable release information was not found; do not ask the LLM to invent a migration; do not proceed to the fix stage; leave a report-only draft or close by documented policy. Absence of release notes never implies an upgrade is safe.
- [PRODUCT] A 4 KB display cap is fine, but never truncate the only stored copy. Preserve the raw result or a content-addressed copy/hash; cap the displayed excerpt separately.

### 2.8 Draft PR report and call-site discovery

- [PRODUCT] The miner cannot know which functions the repository calls. Add a free, local, deterministic step: extract renamed/removed/deprecated symbols from the answer → search the repository and/or inspect the AST → map symbols to files and call sites → build the report. No extra purchase.
- [PRODUCT] Fixture acceptance test: a source file containing a deprecated or renamed API; the report must name the correct file and symbol.
- [PRODUCT] One PR per package and target version, with a stable branch/PR identity, updated on later runs, never duplicated. Define behaviour when the installed base SHA changes while the draft is open.
- [PRODUCT] Report contents: version bump, why upgrade, known vulnerabilities in the installed version (OSV, free), changed functions/methods, affected files and call sites, what to change, spend so far, estimated fix cost, and the `telegraph:fix` instruction. Only users with write access can add labels; closing the PR ends the flow.

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

### 3.1 Service

- [PRODUCT] Public HTTPS endpoint answering package/version-specific release intelligence for npm and PyPI; deterministic use of registry metadata.
- [PRODUCT] Source priority: registry metadata (release date, repository URL) → GitHub Releases → repository `CHANGELOG.md` → git tag comparison. Dates and repository URLs come from registries, source URLs from retrieved material, never from the LLM.
- [PRODUCT] Return `not_found` when no usable notes exist; never imply notes exist or let the model infer them.
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
- [PRODUCT] Targets: cached under 500 ms; warm under 2 s; cold path p50/p95 measured and published (10 s is an initial ceiling, not a competitive target). Verify the live intent's latency expectation before claiming compliance.
- [PRODUCT] Health checks and structured failure logs; timeouts, rate limits and graceful degradation. Telegraph spot-checks about hourly and may stop routing after consecutive failures.

### 3.4 YAML and canonical intent contract

- [MISSION] Check the current schema for every required field: top-level `name`, `version: "1"`, `kind: miner`, unique id and slug, `base_url`, endpoint `path`, `external_path`, `method`, `description`, `intents`, `params` (for `GET /query`, `query` is a required string tied to the exact intent), `semantics.supported_intents`, documented `input_schema`/`output_schema`, `intent_mapping` where needed, `signal_mapping` using only the documented fields (`confidence_field`, `label_field`, `reason_field`).
- [MISSION] The exact canonical intent id comes from the live catalogue; never a family prefix or an assumed `_GENERAL` name.
- [MISSION] Compatibility test: an internally valid JSON response is not necessarily a valid Telegraph result. Test the full Engine request and confirm the returned result uses the canonical intent shape with valid `field_status` values.
- [PRODUCT] Validate and register at [anjoman.ai/dashboard/earn](https://anjoman.ai/dashboard/earn); the `cast` commands in the registration docs are the manual fallback. The documented `POST https://anjoman.ai/dashboard/validate` endpoint currently does not accept requests; scripted checks validate the YAML against the schema instead.

### 3.5 Hybrid scoring and evaluation pool (stop-ship)

- [PRODUCT] The mission describes its QA capability as hybrid: preference-style judging plus truth-source evaluation. Twenty preference-pair rows alone may not make the miner rankable. Before building the dataset, verify `GET /api/wasm?resolve={exactIntentId}` and `GET /api/evalpool/status?intent_id={exactIntentId}`.
- [PRODUCT] Dataset plan: rows in the exact current schema with `label_kind`, `provenance.source_kind` and `provenance.source_url`; eligible public keyless truth-source APIs if the hybrid module requires them; successful pool submission; evidence that rows are eligible and present in the active snapshot. A truth source is a separately defined public HTTPS API with the documented configuration, not a URL in a question row.
- [PRODUCT] Check live `min_submitters`, `eligible_submitters`, active snapshot and epoch. Five contributors means five distinct eligible contributors, not twenty rows from one wallet. New rows may not enter the active snapshot until epoch rollover.
- [PRODUCT] Do not approve miner implementation until the exact chosen intent is proven to score a package-release answer with the proposed materials. If no truth source exists or the pool cannot become eligible in time, drop the miner track rather than build an unrankable provider.

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

Cost per merged PR = total net automation expenditure ÷ number of merged bot PRs.

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

- [PRODUCT] Per LLM operation: provider and model, input/output tokens, billed amount or documented rate, repository/PR/operation identity, timestamp, success state. Otherwise Telegraph spend is accurate while total automation cost is undercounted.

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
| Same daily run repeated | No duplicate purchase |
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
- [ELIGIBILITY] Final materials with owners and acceptance criteria: public submission summary; README/quickstart; 2–5 minute demo video; reproducible fixture repository; evidence pack dated 1 Nov–1 Dec 2026; ledger export and receipt CSV; network/testnet disclosures; wallet and related-party disclosures; licence list; five-question commercial summary (target user, improvement over alternatives, current functionality, reason to adopt, how to try it), not left to the last minute.
- 14 Nov: internal target for one full cycle on a fixture repository. 1 Dec 23:59 UTC: final deadline, reconfirmed on the official site before submitting.

## 6. Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
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

**Check 1 — live intent catalogue.** `GET $NODE/engine/v1/intents`; for each candidate id: `/engine/v1/intents/$INTENT`, `/engine/v1/intents/$INTENT/miners`, `/api/miners?intent=$INTENT`, `/api/wasm?resolve=$INTENT`, `/api/evalpool/status?intent_id=$INTENT`. Inspect schemas, result shape, scoring module, providers, rank fields, pool requirements, active snapshot. Kill: intent not canonical, no usable provider, cannot be scored, or no compatible contract.

**Check 2 — miner evaluation eligibility.** For the exact QA intent: scoring module, `min_submitters`, `eligible_submitters`, active snapshot and epoch, row schema and `label_kind`, provenance, truth-source configuration. Kill: no truth-source path, no contributor path, or no realistic chance of a ranked miner in the window.

**Check 3 — payment network and quote without spending.** `POST $NODE/engine/v1/ask` with a valid request and no payment header; expect 402; decode `accepts[]` and confirm network/chain id, USDC asset, amount, pay-to, scheme and facilitator. Sign nothing. Kill: no valid quote on a usable network, or payment schema incompatible with the client.

**Check 4 — package-release answer quality.** A few paid requests for realistic npm transitions; verify package/version identity, dates against the registry, every breaking-change claim against cited sources, deprecations and migration steps, resolving links; record price, latency, receipt, signal; retrieve and validate the signal by hash. Kill: providers repeatedly return generic or unsupported answers.

**Check 5 — our miner.** Validate YAML; confirm registration is open on the current chain; register; query activation; call the service directly; call it through the Engine; validate canonical result shape and signal mapping; check grace, scoring, rank. Kill: cannot activate promptly, cannot return a compatible result, or answers are inaccurate.

**Check 6 — Action events and security** on a fixture repo: schedule, `workflow_dispatch`, draft PR creation, human `telegraph:fix` label, unauthorised label, closure, merge, failed typecheck, successful tests and push; a malicious lifecycle script that tries to read a test secret must find no wallet, LLM or write-token credential. Validate the actual event types (`labeled`, `closed` differ from open/synchronize) against current GitHub documentation. Kill: repo code can run in a job with secrets, or the event model cannot support approval/push without unsafe permissions.

**Check 7 — ledger correctness.** Run the scenario table in 4.7.

## 8. Execution order

1. B and A jointly resolve exact intent ids, schemas, payment network and provider discovery.
2. A proves whether the QA miner can be scored/ranked and answers package-release questions accurately.
3. B proves one useful paid Q&A purchase and uses it in a real migration with the team's/installer's LLM.
4. B completes the secure Action vertical slice and fixture failure cases.
5. C finalises attempt/receipt accounting and the dashboard on real data structures.
6. A continues miner-track work only while the scoring/registration path stays viable.
7. C coordinates developer trials, public updates, demo and evidence pack.

The differentiator is not buying four AI responses. It is knowing when information may be stale, procuring relevant external intelligence, applying it to real software, verifying the change and accounting for the economics.
