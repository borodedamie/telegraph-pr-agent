# Consolidated documentation review — Telegraph PR Agent

**Reviewed revision supplied:** `borodedamie/main @ 831b1ce`  
**Review date:** 2 November 2026  
**Files reviewed:**

1. `README.md`
2. `docs/SPEC.md`
3. `docs/HACKATHON-PLAN.md`
4. `docs/TEAM.md`
5. `docs/adr/0001-deterministic-cutoff-detection.md`

**Review scope:** This review checks the five documents together, including their internal consistency, the claims they make about the current implementation, and the live Telegraph/Hackathon documentation available on 2 November 2026. It does not inspect the repository source code, package manifests, workflows, live node responses, or deployed services. Treat implementation claims below as document claims unless a reproducible proof is linked.

---

## 0. Executive verdict

**Verdict: substantially improved; not ready to freeze.**

This is a meaningful improvement over the previous documentation set. The README is much more honest about what exists, the specification separates eligibility from product choices, the payment and ledger model is more mature, and the team has a clearer vertical slice to protect.

The remaining problem is **document drift**. The five files do not describe one consistent implementation plan. The SPEC has been revised, but the PLAN and TEAM still contain the older four-paid-intent design. The ADR describes a PR-diff trigger while the current product plan describes a scheduled repository scan. The README records the old CLI's current limitations but still uses terminology and examples that can mislead a reviewer about what the prototype actually does.

I would not freeze these docs until the following are resolved:

1. Pick and record an exact canonical Telegraph QA Intent; `QUESTION_ANSWERING` is a family prefix, not a miner-registerable Intent.
2. Distinguish the live miner catalogue from the per-Intent ranking endpoint. The two endpoints serve different purposes.
3. Make the purchase and routing design consistent: automatic Engine routing versus manually selecting a ranked miner.
4. Decide whether the Action scans the default branch on a schedule or reacts to a human PR diff. The ADR and new spec currently describe different systems.
5. Remove mandatory CODE_GENERATION / CODE_PATCH_VERIFY / REGRESSION_VERIFY purchases from PLAN and TEAM. They are conditional in SPEC and not all appear in the Model Economy mission's listed Intent set.
6. Prove that the package-release miner can satisfy the exact QA Intent's request/response contract and be evaluated. Registration alone is not enough.
7. Add a crash-safe purchase-attempt state model. The SPEC has useful logical idempotency keys, but it does not yet solve the README's known payment-success/ledger-push-failure duplicate-spend case.
8. Correct the event-evidence wording and the growth work plan.

**Strategic recommendation:** Keep the Apps & Agents vertical slice as the primary delivery target. Treat the Miner entry as a separately gated workstream. The application should not wait for the team's miner to become ranked, and the team should not build paid verification integrations just to increase the number of receipts.

---

## 1. Live facts that the documents must reflect

These are protocol/rules facts checked against the public documentation on 2 November 2026. Live node data can change; the node remains authoritative for the current Intent catalogue, schemas, providers, prices and rankings.

### 1.1 Hackathon rules and judging

The current Apps & Agents scoring is:

| Category | Points |
|---|---:|
| Technical quality and mainnet readiness | 35 |
| Commercial viability | 25 |
| Genuine independent adoption and retention | 10 |
| Telegraph network integration and usage quality | 5 |
| Reproducibility, demo/tutorial and verifiable proof | 5 |
| Organic growth, education and developer activation | 20 |
| **Total** | **100** |

The entry needs at least **24/35 technical points**, at least **70/100 overall** to win, and a working Telegraph purchase. Apps & Agents must make at least one genuinely autonomous machine-to-machine purchase or sale and use the intelligence to complete a meaningful task. A supported testnet implementation can qualify. The 14 November integration milestone is not a final-app deadline. The main deadline is 1 December 2026, 23:59 UTC. [Official Rules](https://hackathon.telegraphprotocol.com/rules)

The mission's own first example emphasizes **cost per verified correct answer**. Cost per merged PR remains a good product metric, but it is not a formal Model Economy requirement. Show both metrics if the app can support them. [Model Economy mission](https://hackathon.telegraphprotocol.com/missions/model-economy)

For the 20 growth points, the current rubric looks for original educational content, easy adoption, at least three meaningful updates on separate dates, technical discussion/follow-up, and verified independent developer actions. A post, star, signup, follower or impression alone is not proof of developer activation. The submission asks for a public summary, a 2–5 minute demo or accessible equivalent, reproducible run instructions, evidence, a five-question commercial summary, and showcase permissions. [Official Rules, judging and submission](https://hackathon.telegraphprotocol.com/rules)

**Evidence-window distinction:** the rules allow preparation and reuse of pre-event work, but H2-specific activity and transaction evidence must come from the event period. This does **not** mean historical package release notes or registry data must have dates between 1 November and 1 December. Historical sources are necessary to explain the package changes; the purchase, demo and hackathon activity being claimed as event evidence must be in-window.

### 1.2 Intents are not the same as Intent families

Telegraph V2 distinguishes:

- A **prefix/family**, which determines the scoring family.
- A **canonical Intent/sub-Intent**, which is a specific capability registered and ranked independently.

A miner registers for canonical Intent IDs, not family prefixes. The protocol rule is a registered prefix followed by `_` and a suffix. `_GENERAL` exists for some families, but it is not a universal suffix rule. The exact live catalogue is authoritative. [Intents documentation](https://docs.telegraphprotocol.com/docs/using/intents) · [YAML Configuration](https://anjoman.ai/docs/miners/yaml-config)

The Model Economy mission page uses `QUESTION_ANSWERING` as a human-readable family/capability label and describes it as **hybrid**, with a target below 2 seconds. It also lists `LLM_OUTPUT_EVALUATION` and `CODE_GENERATION`; it does not make `CODE_PATCH_VERIFY` or `REGRESSION_VERIFY` required mission capabilities. [Model Economy mission](https://hackathon.telegraphprotocol.com/missions/model-economy)

Before building either consumer or miner code, read the exact Intent contract from the node:

```bash
NODE=https://devnode.telegraphprotocol.com

curl -fsS "$NODE/engine/v1/intents" | jq .
curl -fsS "$NODE/engine/v1/intents/$INTENT_ID" | jq .
```

Record the complete contract used: canonical ID, class, request schema, response fields, schema/format versions and miner count. Do not guess the suffix or request/response fields.

### 1.3 Miner discovery and ranking endpoints have different jobs

Do not describe either endpoint as the only source for everything:

| Endpoint | Meaning |
|---|---|
| `GET /api/miners?intent=<canonicalIntentId>` | Filtered catalogue of registered miners and their metadata, schemas, activation status and prices. |
| `GET /engine/v1/intents/{intentId}/miners` | Providers competing for that specific Intent and its ranking/score information. |
| `GET /api/miners/{registrationId}` | Registration detail, including activation/rejection state. |
| `GET /engine/v1/intents` and `GET /engine/v1/intents/{intentId}` | Canonical catalogue and consumption contract. |

The current x402 guide documents `/api/miners?intent=` as the filtered miner catalogue. The inference-path documentation separately documents `/engine/v1/intents/{intent}/miners` as the per-Intent competitors/ranking view. If `/api/miners?intent=QUESTION_ANSWERING` returned no entries, that may simply be because `QUESTION_ANSWERING` is a prefix rather than a canonical child Intent. It does not, by itself, prove `/api/miners` is broken. [x402 guide](https://anjoman.ai/docs/using/x402-inference) · [Inference paths](https://anjoman.ai/docs/using/inference-paths)

### 1.4 Engine routing versus direct miner calls

The current docs support both:

- `POST /engine/v1/ask` for Engine routing, including canonical `intent` + `params` requests.
- `POST /engine/v1/ask/{minerId}` when the caller deliberately targets a specific miner.

The mission's “procurement, not selection” example emphasizes asking the Engine to route to the best-ranked provider and observing provider changes. If the app manually chooses the top miner and calls its ID, that is a valid direct-provider policy, but it is not the same demonstration as Engine auto-routing. [Make a Request](https://docs.telegraphprotocol.com/docs/using/engine-ask) · [Model Economy mission](https://hackathon.telegraphprotocol.com/missions/model-economy)

For the qualifying App purchase, prefer Engine auto-routing with the exact canonical Intent and typed params. Record the miner actually returned. If the product deliberately does manual top-rank selection, say so and preserve the ranking snapshot used for the choice. Do not claim the Engine chose the miner when the application chose it.

### 1.5 Evaluation pool and hybrid scoring

The Model Economy page describes QUESTION_ANSWERING as hybrid. Current evaluation-pool docs say:

- Questions with better/worse answers serve judgment and hybrid intents.
- Truth sources serve deterministic intents and the checkable part of hybrid intents.
- Questions are used only once the Intent's pool has material from at least **five distinct contributors**.
- Truth sources have no such five-contributor minimum; one can be enough for an Intent to be scored.
- New rows are admitted/frozen into an epoch snapshot; `snapshot` and `active_snapshot` are not necessarily the same. A newly uploaded row may not be active until the next epoch.

[Evaluation data documentation](https://anjoman.ai/docs/scoring/contribute-evaluation-data) · [How it works](https://anjoman.ai/docs/protocol/how-it-works)

This means “upload 20 evaluation rows” is not a complete evaluation plan. A single wallet contributing 20 questions does not satisfy the five-contributor condition. A truth source is a separate public, keyless API description, not merely a source URL attached to a question. The team must demonstrate that a truth source can actually answer the selected package-release Intent in the required output shape. If that is not feasible, A should not assume the Miner will get a useful ranking.

### 1.6 Registration and ranking are separate states

The registration guide says the miner becomes active/routable and then enters a seven-day grace period. During grace it receives a flat share of 5% of total routed requests, divided among grace-period miners. After grace, its score establishes its initial ranking. Therefore:

```text
YAML validated → registered → active/routable → grace period → scored → ranked
```

`activation_status: active` is not proof of a leaderboard position. [Miner registration](https://anjoman.ai/docs/miners/miner-registration) · [How it works](https://anjoman.ai/docs/protocol/how-it-works)

### 1.7 x402 pricing and failure accounting

The 402 `accepts[]` challenge is authoritative for network, asset, amount, pay-to address and payment scheme. The current x402 guide documents Ethereum Sepolia (`eip155:11155111`) and test USDC contract `0xcc194e1a843B658526D0D5C431f670028582Ae17`, but the README should continue to read the live challenge rather than hardcode these values. The quoted amount is in six-decimal USDC units; 10,000 means 0.01 USDC. The actual quote can vary with the miner floor and demand multiplier. [x402 guide](https://anjoman.ai/docs/using/x402-inference)

There is a documentation nuance that deserves an explicit test. The detailed x402 page says a valid payment settles before the miner is called; if delivery then fails, the amount is credited to the caller's escrow balance and is not consumed. Only a delivered 200 carries a Telegraph receipt. A miner that returns 200 with an error inside the answer is still treated as delivered/billable. The broader protocol overview describes payment as verified before calling the miner and says billing follows delivery. Do not simplify this into “failed calls have no payment activity.” Test a valid paid request that deliberately fails at the miner, then inspect the payment response, transaction/settlement, escrow balance and receipt behavior. [x402 failure and receipt sections](https://anjoman.ai/docs/using/x402-inference) · [Protocol flow](https://anjoman.ai/docs/protocol/how-it-works)

`receipt_hash` identifies an individual delivered call; a transaction hash can cover multiple calls. Keep payment attempt/settlement evidence separate from delivered-call receipts.

---

## 2. P0 cross-document problems

### P0.1 — `QUESTION_ANSWERING` is still being used as though it were a canonical Intent

**Where it appears:**

- README: says the CLI sends the family label `QUESTION_ANSWERING` and that live canonical IDs carry a suffix.
- SPEC: correctly says to fetch exact canonical IDs, but uses generic names such as `QA_INTENT_ID` without recording the chosen real ID.
- HACKATHON-PLAN: calls `QUESTION_ANSWERING` an Intent and says “Intent ids end in `_GENERAL`”.
- TEAM: says B should switch to `_GENERAL` IDs and A should be ranked on `QUESTION_ANSWERING`.

**Problem:** the mission page's `QUESTION_ANSWERING` is the family/capability label. Miners register canonical child Intents. `_GENERAL` is not a universal rule and must not be guessed. The old `/api/miners?intent=QUESTION_ANSWERING` empty result may be a prefix-vs-Intent mistake, not an endpoint failure.

**Required fix:** resolve the actual canonical child from the current node, confirm its request/response contract and miner count, and copy the exact value into a dated protocol-contract note or generated fixture. Replace every generic/family use in code/config examples with an unmistakably named placeholder until that check is complete. Do not write a literal guessed ID into docs.

**Acceptance:** a script prints the selected ID, `canonical: true`, Intent class, request params, response fields, miner count, filtered catalogue result, ranking result and scoring module. A consumer request and a miner registration both use that same canonical child ID.

### P0.2 — Provider catalogue and ranking are conflated

**Where it appears:** README's “Known gaps”; SPEC 2.4; PLAN “Devnode facts”; TEAM Week 1.

**Problem:** `/api/miners?intent=` is the documented filtered catalogue. `/engine/v1/intents/{intent}/miners` is the Intent-specific ranking/competition view. These are complementary, not interchangeable. The empty result from a prefix query does not justify saying the catalogue endpoint is stale.

**Required fix:** update README and plan to describe the two APIs separately. For ranking, read the ranking endpoint. For miner metadata/activation, use the catalogue and registration-detail endpoint. Use only the canonical child Intent in both.

**Acceptance:** tests cover a canonical ID against both endpoints and prove that the selected miner's registration ID, supported Intent and ranking snapshot correspond to the same Intent.

### P0.3 — The product's routing policy is not consistent

**Where it appears:** README's current CLI directly calls `/ask/{minerId}`; SPEC recommends Engine auto-routing; PLAN describes buying the Intent but doesn't make the choice explicit; TEAM says the agent buys from whichever miner is top-ranked.

**Problem:** manually selecting the top-ranked provider is not the same as Engine procurement/weighted routing. The mission example specifically sells “procurement, not selection.”

**Required fix:** make the qualifying App purchase use `POST /engine/v1/ask` with canonical `intent` + `params`, unless a specific technical limitation is demonstrated. Record the actual `miner_id` returned. Preserve a ranking snapshot around the request if rank/score is shown. Do not assert the returned miner was rank #1 unless the evidence shows it.

Direct `/ask/{minerId}` remains useful for controlled provider tests or an explicitly documented manual-selection mode.

### P0.4 — The daily-scan design and the ADR describe different triggers

**Where it appears:**

- SPEC and PLAN: daily schedule/manual dispatch scans the installed repo and opens bot PRs.
- README current slice: takes base and head `package.json` files and diffs them.
- ADR 0001: parses dependency changes from a human PR diff.
- TEAM: expects the scheduled Action fixture and a draft PR flow.

**Problem:** a scheduled default-branch scan has no human PR diff to parse. It compares the currently installed repository state with registry state. The ADR remains valid as historical rationale for the CLI prototype, but not as the complete architecture decision for the Action.

**Recommended decision:**

- **CLI v0:** keep it labelled as a two-manifest PR-diff prototype.
- **Action v1:** scan the default branch on schedule/manual dispatch; derive installed version A from the supported lockfile; resolve latest stable registry version B; open/update one bot PR per package/target.
- Add ADR 0002 for the scheduled lockfile scanner, or amend ADR 0001 and clearly mark the original decision as superseded for Action v1.

Do not pretend the existing CLI already implements the Action's installed-version/latest-stable algorithm.

### P0.5 — PLAN and TEAM still mandate the four-call paid flow that SPEC removed

**Where it appears:** PLAN step 4 says to buy CODE_GENERATION, CODE_PATCH_VERIFY and REGRESSION_VERIFY and says both verification purchases still run if local LLM fallback is used. TEAM says B builds “the four Telegraph purchases” and the same four paid calls are part of week 1.

**Problem:** SPEC now correctly makes code generation and paid verification conditional on suitable providers. The current Model Economy mission lists `QUESTION_ANSWERING`, `CODE_GENERATION` and `LLM_OUTPUT_EVALUATION`; it does not establish `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` as mandatory capabilities. A team cannot promise a provider quality level it has not demonstrated.

**Required fix:** change PLAN and TEAM to:

- One automatic Telegraph Q&A purchase is the required paid operation.
- The purchased answer must be a material input to the migration patch.
- Local install/typecheck/tests are mandatory.
- Telegraph CODE_GENERATION and any verification Intents are optional experiments until a real provider passes a test set.
- The installer/team LLM fallback is the planned normal path until a Telegraph codegen miner proves usable.

Remove the fixed `~0.03 USDC` statement. Use a budget estimate only after measuring current quotes; each payment must be re-quoted.

### P0.6 — The purchase idempotency design does not yet solve the documented crash case

**Where it appears:** README explicitly says a successful purchase followed by a ledger push failure can cause a second payment on rerun. SPEC adds good package/version/question idempotency keys, but not a durable attempt lifecycle.

**Problem:** the new logical identity prevents repeated ordinary scheduled runs after a result has been recorded. It does not prevent a duplicate purchase if the process dies after payment/response but before the ledger is durably written. Actions concurrency also does not solve this.

**Required fix:** model each purchase attempt as a durable state machine, not only a receipt row:

```text
reserved → request_sent → delivered
                       ↘ failed_and_credited
                       ↘ unknown_needs_reconciliation
```

Persist the operation/attempt before the external request. Persist payment/response/receipt facts immediately after the call. If the run fails in an ambiguous state, **halt automatic retries** and reconcile the settlement/escrow/signal evidence first. Do not claim exactly-once payment semantics unless the payment rail provides an idempotency key and the implementation uses it.

For this testnet prototype, a conservative “unknown attempt blocks retry until reconciled” policy is safer than charging twice.

### P0.7 — Miner-track feasibility is not a shared App blocker

**Where it appears:** SPEC Blockers says prove the team's miner is rankable before implementation is unblocked; TEAM expects A to register and rank it while B builds the app.

**Problem:** the Miner track's evaluation/registration path is a blocker for A's Provider entry, but it does not have to block the Apps & Agents vertical slice. The app can consume a suitable independent provider if one exists. Conversely, A's miner becoming active does not prove it is ranked or suitable.

**Required fix:** separate gates:

- **App gate:** one useful package-release answer can be purchased through a supported Telegraph flow and materially used in a passing migration.
- **Miner gate:** a compatible canonical QA child Intent exists; the miner response matches its contract; the hybrid evaluation path is demonstrated; active snapshot/score/rank evidence exists.

If the Miner gate fails by the agreed date, drop or downgrade the Miner entry and keep B/C focused on the App. Do not freeze App progress while waiting for a ranked in-house provider.

### P0.8 — Event evidence wording is wrong in PLAN

**Where it appears:** PLAN “Rules we keep”: “All cited evidence is dated 1 Nov to 1 Dec.”

**Problem:** historical package release notes and npm/PyPI metadata may predate 1 November; they are essential source material for migrations. The event-period rule concerns H2-specific activity/transaction evidence, not the publication date of every underlying external source.

**Required replacement:** “Hackathon-specific purchases, transactions, usage, demos and adoption evidence claimed for Season II must fall in the event window (1 Nov–1 Dec 2026). Underlying package release notes, tags and registry records retain their original dates, including dates before the event.”

---

## 3. Review by file

## 3.1 README.md

### What is good

- The opening now calls this a testnet prototype rather than a finished coding agent.
- It distinguishes the current CLI from the planned GitHub Action and migration workflow.
- It explicitly says the 28 October Crossref answer was irrelevant and pre-event.
- It does not claim a public dashboard deployment, completed migration, production customer or event-period evidence that does not exist.
- It explains that signal/receipt evidence proves what was returned, not factual correctness.
- It identifies stale network config, the current Intent/API mismatch, lockfile gaps and the ledger-push retry risk.
- The disclosure section is transparent about common team control of buyer and planned miner wallets.

### Changes required

**1. Make the first paragraph slightly more precise.**

“Can purchase a package-specific answer” sounds like package-specific answer quality has been demonstrated. It has not: the documented 28 October answer was irrelevant. Suggested wording:

> A testnet prototype of a dependency-migration agent that is designed to buy release intelligence instead of guessing. The current CLI demonstrates dependency-change detection and one historical Telegraph x402 purchase; it has not yet demonstrated a useful package-release answer, a completed migration PR or cost per merged PR.

**2. Separate source-code revision from documentation revision.**

The supplied bundle is `831b1ce`, but README says “Status last verified ... commit `9faf16a`.” That may be intentional, but it is ambiguous. State both explicitly, for example:

- Documentation revision: `831b1ce`.
- Last implementation/test snapshot actually exercised: `9faf16a`.
- Live Telegraph integration last tested: date/time and the exact API/Intent used.

If the code at `831b1ce` was actually tested, update the status SHA. Do not imply the current main commit has been validated when only an earlier code revision was.

**3. Clarify that the live CLI integration is currently stale.**

The 28 October call proves that the old payment path was exercised once. It does not prove that the current CLI can call the current node. The README itself says the client still sends a family label and the provider path needs updating. Change the status from “Buy an answer ... Exercised once” to something like:

> Historical x402 integration test: one pre-event payment succeeded on 28 Oct; returned content was unrelated to package releases. The current client is not considered compatible with the 2 Nov live Intent contract until the canonical Intent and request shape are updated and retested.

**4. Do not describe the current CLI as a general outdated-dependency scanner.**

The current slice compares two `package.json` files. It does not read a lockfile, scan the whole default branch, or discover the registry's latest stable version. It finds a changed dependency declaration in the supplied base/head manifests and checks the release date of the version resolved from that declaration. A package.json range is not the same thing as the actual installed version.

Use “changed-dependency prototype” for v0. Reserve “installed version A → latest stable version B” for the planned Action after lockfile and registry resolution are implemented.

**5. Correct the provider-discovery explanation.**

Replace the current statement that `/api/miners?intent=…` is the wrong source with the distinction in section 1.3 above. The old query may have used the family prefix instead of a canonical child. The catalogue endpoint and ranking endpoint are both useful; they answer different questions.

**6. Resolve the rank contradiction in the sample output.**

The current implementation description says it selects the “top-listed” miner, while the 28 October example says Crossref QA was rank 3. State what “rank 3” actually means in that historical snapshot and do not claim “top-ranked” without a saved snapshot. If the 28 October endpoint was not the current ranking endpoint, say so.

**7. Update the quickstart so it can actually be followed.**

- The command references `../examples/base-package.json` and `../examples/head-package.json`, but the README says no fixtures exist. Either add those files or show exact commands that create them.
- The sample PR number and SHA are placeholders. Label them as such and explain that `DEMO_REPO` must be a real public repository where the token can push the ledger branch.
- The shell examples repeat `cd bot`. If a reviewer runs the blocks sequentially in one shell, the second `cd bot` may run from inside `bot` and fail. Use one command block with a single working-directory transition, or make all commands root-relative.
- Add the expected no-trigger fixture and the expected output for that case.
- Provide an offline test command distinct from the paid testnet command.
- Until fixtures are committed, do not call the command a one-command reviewer reproduction.

**8. Remove the unused required LLM key from the current-slice setup.**

`LLM_API_KEY` and `LLM_BASE_URL` are required by config validation but unused. Do not tell reviewers to put arbitrary non-empty values into a secret field. Remove them from current-slice validation until LLM calls are implemented, or make them explicitly optional. A dummy API key is confusing and unsafe operational practice.

**9. Fix the stale `.env.example`, not just the prose.**

The README says the example file still contains Base Sepolia values and instructs users to correct it manually. A judge following the README should not have to repair the project configuration before testing. Update `.env.example`, or remove obsolete chain/token fields if the 402 challenge plus a local allowlist can supply the values safely. Keep the allowlist and per-payment cap; use the challenge as the payment source of truth.

**10. Improve the payment explanation with the exact state distinction.**

The current paragraph is close to the detailed x402 guide, but should avoid collapsing settlement, consumption and receipt into one concept. Suggested wording:

> The 402 challenge supplies the offered payment options. On the documented x402 path, a valid payment may settle before the miner call; if delivery then fails, the amount is credited to the caller's Telegraph escrow balance and is not consumed. A delivered 200 returns a Telegraph receipt. A 200 response containing an error is still treated as delivered, so the client checks `result`, `result_shape` and `field_status`, not only HTTP status. The x402 and protocol overview pages describe settlement timing differently; this behavior is verified against the current node by the test linked here.

Add the result of the controlled failure test when completed. Do not write “failed calls cost nothing” without explaining escrow credit and possible settlement evidence.

**11. Clarify the dashboard status.**

“Works locally” is fine, but include the exact local command and required environment/config to locate the public ledger. Keep “not publicly deployed” prominent until a judge can open a public URL without local setup.

**12. Do not imply source citations themselves must be event-dated.**

The README's current event-evidence wording is more careful than PLAN's. Keep the distinction: event purchases/transactions/demos must be in-window; package source material may be older.

**13. Current CLI ledger is prototype-only.**

README says one ledger row per CLI run keyed `(PR, commit)`, while SPEC requires attempt records and delivered purchase rows keyed by `receipt_hash`. State that the current ledger schema is temporary and will be migrated before Action use. The current key is not adequate once one PR can have several paid steps or retries.

### README overall

Good transparency; weak reproducibility. The README should remain the public source of truth for **what works today**, not a sales page for the planned workflow. Add actual fixtures and a successful, useful package-specific answer before changing “in development” to “working.”

---

## 3.2 docs/SPEC.md

### What is good

- The `[ELIGIBILITY]`, `[MISSION]`, `[PRODUCT]` and `[SCORE]` labels are a major improvement.
- It correctly identifies the canonical Intent, evaluation-pool, purchase idempotency and security-boundary risks.
- It protects the purchase→intelligence→migration vertical slice.
- It correctly demotes paid code generation and verification to optional capabilities.
- It distinguishes payment attempts from delivered receipts and `receipt_hash` from `tx_hash`.
- It gives `not_found` a safe behavior instead of turning missing information into an LLM guess.
- It recognizes that a miner being `active` is not the same as being scored/ranked.

### Changes required

**1. Correct requirement labels where they overstate what Telegraph mandates.**

The deterministic npm/lockfile cutoff algorithm is your product design, not a protocol or hackathon mandate. Likewise one YAML file, a daily schedule, one PR per package and `MODEL_CUTOFF` are product requirements. The hackathon eligibility core is the autonomous Telegraph purchase followed by meaningful use of the purchased intelligence. Adjust labels so the document does not accidentally represent product choices as rules from Telegraph.

**2. Split the opening blockers into App blockers and Miner-track blockers.**

The evaluation-pool and own-miner-ranking work is a blocker for A's Provider entry, not for B's application if a suitable independent provider can be used. Make two separate go/no-go lists and explicitly prioritize the App vertical slice.

**3. Exact QA Intent fit must be tested, not merely canonicality.**

The selected Intent has to support:

- the package/version question the agent sends;
- the information the miner can retrieve;
- the stable output shape the Engine expects;
- the scoring/evaluation contract the network actually applies.

If no existing canonical child has a suitable request and response schema, the team needs to propose a new sub-Intent under the appropriate family and wait for approval. A miner cannot invent extra canonical response fields by returning custom JSON. The node reads the answer into the Intent's declared response shape.

Add this as a hard acceptance gate before A builds the endpoint/YAML around an assumed `query` parameter.

**4. Do not hardcode an assumed routing-weight example.**

SPEC says documentation describes an example weighted split such as 70/20/10. Current protocol docs explain that higher-scoring providers receive proportionally more traffic; the live weighting may change. Unless the current docs or node expose a stable exact value, remove the numerical example and say “proportional/weighted routing; verify current policy; do not hardcode weights.”

**5. Clarify the ranking snapshot for auto-routing.**

The spec requires storing rank and score at purchase time. Auto-routing returns the actual provider, but the response/receipt should not be assumed to contain a rank/score snapshot. Store:

- actual returned miner registration ID;
- raw per-Intent ranking response retrieved immediately before or after the request;
- capture timestamp and content hash;
- mapped rank/score if fields are present;
- a note that the snapshot is observational, not an atomic guarantee of what the router evaluated at the exact instant.

If rank cannot be obtained reliably, display “rank unavailable” rather than inventing one.

**6. Add crash/recovery semantics to purchase idempotency.**

The logical purchase key is good, but add durable attempt state and reconciliation. An ambiguous attempt must stop automatic retry. Otherwise the known README issue remains unresolved. Specify where the reservation record is persisted before calling Telegraph, what happens if the process dies after the payment response, and who resolves an `unknown_needs_reconciliation` row.

**7. Reconcile Q&A intent evaluation with the actual package-release truth problem.**

It is not enough to write “hybrid needs preference pairs and truth sources.” State what the truth API returns for the chosen package question and how the comparator checks it. A truth source that merely returns a release-note URL is not necessarily a usable reference for the hybrid's checkable fields. Prove a complete example from the exact Intent request through source response to scoring. Keep the five-contributor question-pool condition and epoch-snapshot condition explicit.

**8. Add miner source-fetch security.**

The miner follows package registry repository links and fetches release notes/CHANGELOG/tag comparisons. Package metadata is not automatically trusted. Add:

- allowlisted schemes and hosts (initially registry and GitHub domains actually needed);
- block loopback, private, link-local and cloud-metadata addresses, including after redirects and DNS resolution;
- response-size, redirect-count and time limits;
- no arbitrary credentials from URLs;
- content-type validation and caching limits;
- no execution of fetched scripts or package code;
- prompt-injection handling for fetched Markdown and release notes.

**9. Align the miner latency target with the mission.**

The mission page labels QUESTION_ANSWERING target `<2s`. The Miner plan's “cold under 10 seconds” is not a competitive target for that Intent. Keep the cold-path p50/p95 measurement requirement, but make the normal target consistent with the selected live Intent. If the architecture cannot meet it, explain the limitation and consider a precomputed/cached release index.

**10. Specify the data model for LLM cost and cost windows.**

The ledger needs provider/model, input/output tokens, rate-card/version or actual billed amount, operation identity, timestamp and outcome. Define whether a cost-per-merged-PR dashboard is cumulative over the whole repo ledger or scoped to a reporting window. A zero-merge denominator must remain `N/A`.

**11. Clarify dependency resolution and edge cases.**

The A/B rule is good, but add behavior for:

- registry `latest` dist-tag and prerelease tags;
- invalid/non-semver ranges, aliases, Git URLs, `file:` dependencies and workspace protocols;
- missing package-lock or unsupported lockfile version;
- lockfile/package.json disagreement;
- scoped packages and npm workspaces (explicitly skipped for MVP);
- package version not found in registry;
- release timestamps missing/ambiguous;
- a proposed version multiple major releases beyond A.

The bot must not treat stripping `^`/`~` from a range as proof of the installed version. The installed version must come from the lockfile for the planned Action.

**12. Keep the first paid operation minimal.**

Do not buy codegen/verification just because the labels exist. The core task is proven when a purchased package-release answer materially changes the generated migration and independent repository tests verify it. Optional protocol evaluations can be shown as separate experiments.

### SPEC overall

This is the best of the five docs and should be the source of truth. It still needs the exact Intent contract, crash-safe attempt lifecycle, the App/Miner gate split and source-fetch security before it is implementation-ready.

---

## 3.3 docs/HACKATHON-PLAN.md

### What is good

- Clear six-step story.
- One-package-per-PR scope is sensible for a hackathon.
- Two budget caps, buyer wallet security, PR de-duplication and human merge are good product decisions.
- The 14 November target is explicitly an internal milestone.

### Changes required

**1. The plan still describes the old paid architecture.**

Step 4 says to buy three additional Intents and says the two paid verifications still run with the own-LLM fallback. This directly conflicts with SPEC 2.9 and README. Replace it with the conditional approach from the SPEC.

**2. Stop quoting `~0.01` and `~0.03` as though these are stable costs.**

Keep only a clearly marked planning estimate. Actual price is returned by the 402 challenge and depends on the provider floor and demand multiplier. There is no demonstrated basis for a universal 0.03 fix-stage cost, especially while all three calls are conditional.

**3. Fix “Intent ids end in `_GENERAL`.”**

This is false as a blanket statement. A miner must list the exact canonical child Intent. Some families have `_GENERAL` children; others may have a different suffix or a different approved set. Replace the statement with: “Fetch the canonical Intent IDs from the live node; family prefixes are not registerable Intents.”

**4. Correct the two miner APIs.**

The plan currently mentions only `/engine/v1/intents/{intent}/miners`. Add `/api/miners?intent=<canonicalId>` for the filtered catalogue and explain that the Engine endpoint supplies the per-Intent competition/ranking view. The README should not claim that the catalogue endpoint itself is obsolete.

**5. Correct the purchase-selection story.**

The phrase “buy from the top-ranked miner” suggests manual selection. Use the Engine auto-routing path for the main demonstration, or explicitly decide to do manual top-rank selection and stop calling it Engine-selected procurement. The current mission example emphasizes Engine routing and provider changes.

**6. Fix the evidence-date rule.**

Replace “all cited evidence is dated 1 Nov to 1 Dec” with the event-period distinction in P0.8. Do not discard historical release notes or registry facts because they predate the hackathon.

**7. Keep the App and Miner tracks separate in the plan.**

Add a date for the Miner-track go/no-go. If A cannot prove a canonical Intent fit, working truth-source path and viable active snapshot, stop expanding the Miner workstream. Do not let it consume the time reserved for the App.

**8. Expand “Scope for 14 Nov” into acceptance criteria.**

Specify one concrete fixture package, its installed version, target version and source notes; one successful paid answer; one generated code migration; one passing install/typecheck/test; one human label; one PR; one merge/accounting result; and a failing typecheck case that is not pushed. Clarify whether the full merge must happen by that date or whether the complete reviewable cycle is sufficient for the internal milestone.

**9. Make budget language consistent.**

The README correctly says 0.01 was an observed example. PLAN should say “budget estimates are illustrative; quote and caps control actual spend.”

### PLAN overall

Shorten the plan and make it a milestone summary derived from SPEC. It should not duplicate protocol endpoint details or reintroduce decisions already rejected in the specification.

---

## 3.4 docs/TEAM.md

### What is good

- Three clear workstreams.
- Shared ledger and miner-answer contracts are agreed in week 1.
- C owns the public evidence/dashboard work instead of leaving it ownerless.
- The fixture repository and the typecheck-failure case are included.

### Changes required

**1. Remove “the four Telegraph purchases” from B's scope.**

It contradicts the revised SPEC. B owns one mandatory Q&A purchase plus the conditional codegen/verification experiments only if providers pass quality tests. Local CI stays mandatory regardless.

**2. Do not schedule 3–5 paid QA calls before provider suitability is established.**

The current live providers have not demonstrated package-release answer quality in the supplied evidence. First inspect the exact canonical Intent and current providers, then run a tightly capped representative quality test. A paid call returning generic/irrelevant content is not a usable fixture. Save only useful results as migration test fixtures; preserve unusable results as failure evidence.

**3. Change the `_GENERAL` and `QUESTION_ANSWERING` milestone wording.**

A should aim for the exact chosen canonical child Intent, not “ranked on QUESTION_ANSWERING.” B should not hardcode `_GENERAL` as an assumed suffix.

**4. Add the missing five-contributor/truth-source work to A's week-one plan.**

A's week-one checklist should include:

- exact canonical Intent and schema;
- scoring class/module;
- preference-pair row requirements and five distinct eligible contributors for question material;
- a real public keyless truth source for the hybrid checkable portion;
- pool submission status and active-snapshot epoch;
- direct API test and Engine-routed test;
- seven-day grace-period start/end and first possible ranking check.

Do not equate “YAML validates” or `activation_status: active` with “miner ranked.”

**5. Add a hard Miner-track stop/go date.**

Set the gate after the live contract and evaluation-pool tests. If the QA sub-Intent cannot be scored with available evaluation material, A should stop the Miner-track build or seek a suitable already-existing Intent rather than polishing a service that cannot become competitive.

**6. Clarify App versus Miner package scope.**

The bot MVP is npm-only. The miner service is described as npm + PyPI. That can be a deliberate distinction, but say it explicitly so reviewers do not expect PyPI support in the Action by 14 November.

**7. Fix the growth/evidence plan.**

The table currently schedules a build announcement in week 1 and a working-result update by 1 December: only two updates are explicit. The rules award points for at least three meaningful original updates on separate dates, plus technical discussion and actual independent developer actions. Add a third date and make the tasks concrete:

| Milestone | Content/action | Evidence to retain |
|---|---|---|
| Early build announcement | Explain the problem and why the agent buys release knowledge | Public URL/date |
| Working integration update | Show a real purchase and the result it enables | Video/thread, signal/receipt references |
| Technical tutorial/result update | Show setup, canonical Intent discovery, reproduction or failure lessons | Tutorial URL, independent test/feedback |
| Developer activation | Invite a developer to reproduce/test and respond to their feedback | Issue, reproduction notes, external request or contribution |

C can coordinate these, but B/A must provide technical evidence. Do not count team's own wallets or self-purchases as independent external adoption.

**8. Make “three outside repos” a target, not a hackathon rule.**

It is a useful stretch target, but three installations alone do not demonstrate use or retention. The scoring rubric rewards verified actions, meaningful use and repeat use. Define a minimum evidence goal such as one independent reproduction plus one further independently verified contribution/repeat use, and list three repos as an aspirational target.

**9. Add the security regression test.**

B's fixture matrix must include a malicious package lifecycle script attempting to read secrets. It must run only in the secretless test job. Also test that the privileged commit job never executes repository code, validates artifact paths/base SHA and uses a minimal write token.

**10. Replace the standing “top-ranked” rule with the selected routing policy.**

If the app uses Engine auto-routing, say it records the returned miner and rank snapshot. If a manual top-rank policy is selected, document that it is the app's policy rather than Telegraph auto-routing. Disclose self-purchases and never count them as independent demand.

**11. Identify the people.**

“Person 1/2/3” is fine for an anonymized review copy, but the operational TEAM.md should have the actual owners or GitHub handles, a backup owner for shared contracts and a person responsible for the Miner-track stop/go decision.

### TEAM overall

The team table is useful, but it is still executing the older plan. Bring it into line with SPEC before work is divided. Assign explicit ownership for the canonical Intent contract snapshot, failed-payment reconciliation, the third public update/tutorial and the Miner go/no-go decision.

---

## 3.5 docs/adr/0001-deterministic-cutoff-detection.md

### What is good

- Records why deterministic registry-based detection was preferred over asking the LLM to self-report uncertainty.
- Defines a reproducible test: a pre-cutoff dependency should not trigger a purchase.
- Keeps model self-reporting out of v1.
- The 19 October date is useful historical provenance for pre-event work disclosure.

### Changes required

**1. The ADR describes the CLI, not the planned Action.**

Its decision is “parse dependency changes from the PR diff.” The new Action is daily/manual and scans the default branch. Its proposed algorithm uses the installed lockfile version A and latest stable registry version B. These are different triggers. Mark this ADR as applying to CLI v0 only, or amend it and add ADR 0002 for Action v1.

**2. `modelCutoff` and `MODEL_CUTOFF` terminology should match.**

Use one configuration name and define the metadata stored with it: provider, exact model identifier, date, source URL, whether documented or team-assumed, and when the config was set.

**3. Do not say the deterministic check proves the model does not know the release.**

The release date being later than a model's published cutoff is a useful and reproducible proxy. It does not prove the model cannot know the fact through later updates, retrieval, pretraining ambiguity or another source. Name the state `post_cutoff_candidate`, not `unknown_to_model`, and show the cutoff's provenance in the PR.

**4. “Cold-demo-proof” overstates the property.**

The predicate is deterministic for fixed registry data and config. A live npm request can fail, metadata can be missing, and current registry state changes. Say “reproducible under pinned fixture data; live registry lookup fails closed when data is unavailable.”

**5. Correct the scoring claim.**

“35% of scoring is mainnet-readiness/honesty” is not accurate. The 35-point category is technical quality and mainnet readiness. Honesty is part of the broader requirements for accurate claims; it is not a substitute name for the full 35-point category.

**6. Update the exact algorithm.**

For Action v1, the algorithm should be:

```text
A = actual installed version from supported lockfile
B = latest stable version from registry metadata
Eligible = semver(B) > semver(A)
        AND registryReleaseDate(B) > MODEL_CUTOFF
```

The CLI v0 implementation remains a PR-manifest-diff prototype and should not be represented as already implementing this rule.

**7. Clarify the scope of future model self-reporting.**

The current decision to exclude self-reporting from v1 is fine. A future self-report mechanism may add a second signal, but it should not silently bypass the deterministic eligibility rule or produce additional spending without an explicit policy/ADR.

### ADR overall

Preserve the original ADR as a history of the CLI prototype, but add a new ADR for the scheduled scanner rather than silently letting the old decision describe a different product.

---

## 4. Further engineering gaps not yet fully captured

These are not necessarily new blockers for the prototype, but should be visible in the specification or issue tracker.

### 4.1 Release-note ingestion is an SSRF and prompt-injection boundary

The Miner follows repository URLs from package metadata and fetches GitHub release notes, CHANGELOG files or tag comparisons. Treat those URLs and documents as untrusted. Use host allowlists, DNS/IP checks, redirect limits, size/time limits and no arbitrary credentials. Never execute fetched package scripts. Treat release-note text as data, not instructions to the model.

### 4.2 The exact canonical response may not support your custom JSON

A miner cannot freely extend the Intent's public result shape. The service's rich internal JSON (`breaking_changes`, `deprecations`, `sources`, etc.) must be mapped into the exact response fields defined by the chosen Intent. If the canonical Intent only provides a generic answer field, the extra fields may remain miner-native/raw or be dropped by Engine normalization. Prove the Engine's `result_shape` and `field_status` behavior before writing the PR generator against a custom response.

### 4.3 Q&A latency and sourcing need a practical plan

The Model Economy mission lists a `<2s` target for QUESTION_ANSWERING. A cold path that fetches several APIs and runs an LLM may exceed this. Cache package/version release material, pre-index release notes where feasible, and publish measured p50/p95. Do not advertise `<2s` until measured through Engine, not only against the miner's local endpoint.

### 4.4 A package version can have multiple intervening breaking releases

If A is several major versions behind B, asking only “what changed from A to B” may miss the migration path or intermediate deprecations. For the MVP, either cap the jump (e.g. no more than one major version) or fetch/compare release notes across all intervening versions and clearly identify the range.

### 4.5 `MODEL_CUTOFF` is model-specific but the Action may let users change model

If the installer can configure an arbitrary LLM provider/model, the cutoff must be configured for that exact model. Do not have a single project-wide cutoff presented as universal. If it is only the team's chosen model, say so. If the model provider has no documented cutoff, label the date as a team assumption.

### 4.6 Cost accounting needs a no-retry ambiguity policy

The new attempt/receipt model is a good start. It must be resilient to process termination between (a) payment submission, (b) delivered response, (c) receipt capture and (d) Git push. A public git branch alone is not automatically a transaction coordinator. Keep a pending-attempt checkpoint and stop on an ambiguous state until reconciled.

### 4.7 A public ledger is not suitable for private repos

The initial public-repository-only scope is correct. Keep private repo content, PR metadata and code out of public raw ledger data and the public dashboard. Do not put GitHub tokens in browser code.

### 4.8 Three different meanings of “success” should be separated

Record separately:

- **Payment delivered:** valid response/receipt exists.
- **Answer useful/correct:** source checks and quality evaluation pass.
- **Migration successful:** patch applies and repository tests pass.

A receipt proves neither answer quality nor migration correctness. An HTTP 200 is not sufficient as a product success state.

---

## 5. Recommended single-source-of-truth structure

The five-document split is sensible. The responsibilities need to be tighter:

| File | Should be authoritative for | Should not duplicate |
|---|---|---|
| `README.md` | Public status, what works today, safe quickstart, limitations, disclosures, reviewer links | Future architecture details that are already specified elsewhere |
| `docs/SPEC.md` | Current product requirements, acceptance tests, security, accounting, scope | Mutable provider lists and stale endpoint guesses |
| `docs/HACKATHON-PLAN.md` | Milestones, critical path, go/no-go dates and submission checklist | Detailed protocol contract and requirements already in SPEC |
| `docs/TEAM.md` | Owners, deliverables, dates, dependencies and decision owners | A second copy of architectural decisions |
| `docs/adr/*.md` | Why a decision was made, what it supersedes and its scope | Current implementation status or a second current spec |

Add one dated protocol-contract artifact, for example `docs/telegraph/qa-intent-contract-2026-11-02.json`, containing the actual node response for the selected canonical Intent (sanitized if needed), plus a short note with the node URL and capture time. Regenerate/review it when the live schema changes. Do not guess or manually reconstruct the contract from an old response.

Also add a small status table that distinguishes:

- code implementation status;
- last unit/integration test date;
- last successful live Telegraph test date;
- whether the result was useful;
- whether the evidence is pre-event or event-period.

This prevents the README from describing a past success as a currently working integration.

---

## 6. Recommended corrected decisions

| Topic | Decision to freeze | Reason |
|---|---|---|
| Primary entry | Apps & Agents first; Miner workstream gated separately | Protects the qualifying end-to-end app result |
| Trigger v0 | Keep current CLI as a manifest-diff prototype | Honest description of existing implementation |
| Trigger v1 | Daily/manual default-branch scan using lockfile A and registry latest stable B | Matches SPEC and scheduled Action design |
| Cutoff wording | `post_cutoff_candidate`, with model/provider/source metadata | A cutoff is a heuristic, not proof of ignorance |
| Purchase Intent | Exact live canonical QA child only after request/response contract is checked | Family prefix is not registerable |
| Main purchase route | Engine auto-routing via canonical `intent` + `params` | Best fit for mission's procurement story |
| Manual provider selection | Allowed for controlled tests; report it honestly | Separates test method from network routing |
| Paid codegen/verification | Optional until actual providers pass tests | Avoids mandatory reliance on unavailable/unsuitable supply |
| Patch generator | Installer's LLM with purchased Q&A as material input | Works without pretending codegen supply exists |
| Verification | Secretless repo CI is mandatory | Independent verification of actual migration |
| Own miner | Separate Provider entry, hard go/no-go after Intent/evaluation proof | Avoids blocking the App or building unrankable supply |
| Evidence | H2 purchases/transactions/demo/adoption in event window; external package sources retain original dates | Matches rules and preserves valid release evidence |
| Growth | Three meaningful public updates on separate dates, tutorial and independently verifiable developer actions | Matches the 20-point growth rubric |

---

## 7. Week-one / immediate acceptance checklist

Use this as the next practical checklist, in this order.

### Gate 1 — Canonical Intent and schema (B + A)

- [ ] Fetch the live Intent catalogue.
- [ ] Identify a canonical QA child Intent; do not use the family prefix.
- [ ] Save the complete Intent contract and capture timestamp.
- [ ] Inspect request and response schema, class and miner count.
- [ ] Test the exact canonical ID against `/api/miners?intent=` and `/engine/v1/intents/{id}/miners`.
- [ ] Confirm whether the current miners can return a useful package-release answer in the required result shape.
- [ ] Choose Engine auto-routing or documented manual selection.

**Stop condition:** no canonical Intent with a compatible request/response contract and usable provider path.

### Gate 2 — Payment behavior (B)

- [ ] Send a valid request without payment and decode the 402 `accepts[]` challenge.
- [ ] Confirm current network, token, amount, pay-to and scheme.
- [ ] Confirm `spendControls`/local allowlist and per-call/run caps.
- [ ] Run one valid delivered test and preserve `PAYMENT-RESPONSE`, `X-TELEGRAPH-RECEIPT` and signal hash.
- [ ] Run one controlled failed-delivery test; inspect settlement evidence, escrow credit, receipt absence and retry behavior.
- [ ] Confirm `result_shape` and `field_status` for the delivered response.

**Stop condition:** unclear payment/credit accounting or inability to enforce the cap from the actual challenge.

### Gate 3 — Useful answer and migration (B)

- [ ] Use one realistic package version transition.
- [ ] Check release date and repository metadata against the package registry.
- [ ] Check every breaking-change claim against the linked release source.
- [ ] Show how the purchased answer changes the patch prompt or patch output.
- [ ] Detect the affected symbol and source call site locally.
- [ ] Produce a patch that applies to the expected base SHA.
- [ ] Run install/typecheck/tests in a secretless job.
- [ ] Demonstrate a failing typecheck that is not pushed.

**Stop condition:** the paid answer is generic/irrelevant or the migration succeeds without materially using it.

### Gate 4 — Miner viability (A)

- [ ] Verify that the exact canonical QA child is hybrid and inspect its scoring module.
- [ ] Define the actual truth-source API and how its response maps to checkable fields.
- [ ] Confirm the preference-pair schema and five-distinct-contributor threshold for question material.
- [ ] Confirm truth-source eligibility and no-minimum rule.
- [ ] Submit rows and verify admitted/eligible state.
- [ ] Check `snapshot`, `active_snapshot`, current epoch and contributor counts.
- [ ] Register only after endpoint and schema checks pass.
- [ ] Verify active state, grace-period dates, scoring and rank separately.

**Stop condition:** no valid truth-source/evaluation path or no credible way to show the package-release service is scored and useful.

### Gate 5 — Crash-safe ledger and accounting (C + B)

- [ ] Implement pending attempt before external paid call.
- [ ] Record delivered receipts per `receipt_hash`.
- [ ] Keep payment attempt, settlement/escrow credit and delivered receipt separate.
- [ ] Treat ambiguous failures as reconciliation-required; no automatic repurchase.
- [ ] Record LLM provider/model/tokens/billed amount against PR and operation.
- [ ] Verify duplicate scheduled run does not buy twice.
- [ ] Verify repeated merge event does not count twice.
- [ ] Verify zero merged PRs renders `N/A`.

### Gate 6 — Growth and reviewer proof (C, with A/B support)

- [ ] Publish first meaningful update and record URL/date.
- [ ] Schedule second and third original updates on separate dates.
- [ ] Publish a practical technical tutorial that explains Telegraph's role.
- [ ] Invite independent developers to reproduce a request or test the Action.
- [ ] Keep actual feedback, reproduction reports, issues/PRs and repeat usage as evidence.
- [ ] Do not count self-purchases, related wallets or internal repos as independent adoption.
- [ ] Prepare public summary, 2–5 minute demo, five commercial answers and showcase permissions.

---

## 8. Priority-ranked changes before the docs are handed to implementation

| Priority | Owner | Change |
|---:|---|---|
| **P0** | B + A | Resolve exact canonical QA child Intent and its request/response schema from live node |
| **P0** | B | Resolve routing approach and document the difference between catalogue and ranking endpoints |
| **P0** | B | Define Action v1 scheduled scan; update/supersede ADR 0001 |
| **P0** | B + C | Add durable purchase-attempt lifecycle and crash/ambiguous retry policy |
| **P0** | B | Make Q&A purchase + meaningful use the only mandatory paid path; align PLAN and TEAM |
| **P0** | A | Prove miner response contract and hybrid evaluation/truth-source feasibility before building deeper |
| **P1** | A | Add SSRF controls, source provenance and prompt-injection-safe release-note processing |
| **P1** | B | Fix README quickstart, add real fixtures, fix shell working-directory steps and stale `.env.example` |
| **P1** | C | Replace the two-update plan with three dated updates, tutorial and independent developer activation work |
| **P1** | C + B | Migrate ledger from one CLI-run row to attempts + per-receipt purchases + merge outcomes |
| **P1** | A + B | Measure Engine-level QA p50/p95 against the selected Intent target |
| **P2** | C | Deploy the public dashboard and add richer reporting after ledger data is stable |

---

## 9. Final verdict

**Approve the direction; do not freeze the documentation package yet.**

The new SPEC is strong enough to guide implementation after the P0 decisions are closed. The README is honest but still cannot serve as a reviewer quickstart until its fixture paths, shell commands, stale `.env.example` and live API compatibility are corrected. PLAN and TEAM must be brought into alignment with the SPEC; right now they reintroduce the old four-purchase architecture. ADR 0001 should remain as the record of the original CLI decision, but it must be marked as scoped to that prototype or superseded by a new ADR for the scheduled lockfile scanner.

The product's differentiator is not “four paid AI calls.” It is:

```text
Detect a possible knowledge gap
        ↓
Buy relevant release intelligence through Telegraph
        ↓
Use that purchased intelligence in a real migration
        ↓
Verify the migration in isolated repository CI
        ↓
Human reviews and merges
        ↓
Publish honest, receipt-backed cost accounting
```

Protect this one vertical slice. If it works on a fresh public fixture repository, with a real useful answer, a reproducible failure case and complete testnet accounting, the project has a credible Model Economy submission. Everything else should be subordinate to that proof.

---

## 10. Sources checked on 2 November 2026

1. [Telegraph Hackathon Season II — Official Rules](https://hackathon.telegraphprotocol.com/rules) — eligibility, scoring, milestones, evidence, submission and growth criteria.
2. [Model Economy mission](https://hackathon.telegraphprotocol.com/missions/model-economy) — mission framing, example purchase flow, listed Intents and latency targets.
3. [Telegraph Intents](https://docs.telegraphprotocol.com/docs/using/intents) — family prefixes, canonical sub-Intents, schemas and live catalogue.
4. [Make a Request / Engine Inference](https://docs.telegraphprotocol.com/docs/using/engine-ask) — canonical request flow, direct requests and miner discovery.
5. [Choose a Delivery Path](https://anjoman.ai/docs/using/inference-paths) — miner catalogue, per-Intent ranking endpoint and signal lookup.
6. [Pay per Request (x402)](https://anjoman.ai/docs/using/x402-inference) — 402 challenge, network/asset, spending controls, failure/escrow behavior, receipts and dynamic pricing.
7. [Miner YAML Configuration](https://anjoman.ai/docs/miners/yaml-config) — V2 YAML schema and canonical-Intent requirements.
8. [Miner Registration](https://anjoman.ai/docs/miners/miner-registration) — activation and grace-period behavior.
9. [Contribute Evaluation Data](https://anjoman.ai/docs/scoring/contribute-evaluation-data) — preference pairs, truth sources, contributor thresholds, row status and active snapshots.
10. [Protocol: How It Works](https://anjoman.ai/docs/protocol/how-it-works) — routing, intent families, response shaping and scoring pipeline.

**Important:** live node responses override examples and snapshots in these documents. Re-run the discovery and acceptance checks immediately before implementing or submitting; do not treat this review as a permanent copy of the Telegraph API contract.
