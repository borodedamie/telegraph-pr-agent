# Telegraph PR Agent: source notes for an article

Raw material for a write-up of what the team built for the Telegraph Hackathon Season II
(mission "Model Economy", 1 Nov – 1 Dec 2026). Every number has its date. Re-check the live
figures (dashboard, miner health, rank) before publishing anything.

Team: borodedamie, lemind (Dmitrii Lemin), codexempire.
Repository: https://github.com/borodedamie/telegraph-pr-agent
Dashboard: https://telegraph-pr-agent.vercel.app
Miner: https://telegraph-pr-miner-n30sk.vercel.app (Telegraph miner id 7314)

---

## 1. The problem, in one paragraph

AI coding assistants have a training cutoff. Your dependencies don't. Every week packages ship
majors, deprecations and security fixes the assistant has never seen, and Dependabot or Renovate
happily bump the version without telling you what breaks. So either a human reads release notes
for every upgrade, or the assistant guesses about APIs it doesn't know. Our bet: an agent
should notice when it is outside its knowledge and **buy** that knowledge, for cents, with a
receipt, from a market of specialised providers.

On our test repos, with a 1 Jan 2026 cutoff, the bot found 5 and 6 post-cutoff dependencies in
two small repositories. This isn't a rare edge case.

## 2. What we built: two halves of a market

The same team built both sides of the trade. That matters for the article (see §9, honesty).

1. **The buyer: Telegraph PR Agent.** A GitHub Action (`borodedamie/telegraph-pr-agent@v1`).
   It scans the lockfile, decides which upgrades are past the model's cutoff, pays a Telegraph
   miner for "what changed between version A and B", and opens one PR per upgrade. The PR lists
   the breaking changes, migration steps and the lines in your repository that use the changed
   APIs. Every purchase, PR, merge and close goes on a public ledger.
2. **The seller: Package Release Intelligence, miner 7314.** A Telegraph miner that answers
   exactly one kind of question: what changed in an npm package between two versions. Every
   item comes with a verbatim quote and the link it came from. When it can't find the answer it
   says so instead of guessing.
3. **The scoreboard: the dashboard.** A static site that reads each installation's ledger and
   computes the spend and the **cost per merged PR**: what it actually costs to get an upgrade
   merged with sourced knowledge.

## 3. How Telegraph fits

Telegraph is a marketplace for machine intelligence: miners register an intent (a kind of
question) with a YAML spec and a price. Buyers pay per answer with x402 (HTTP 402 Payment
Required) in test USDC on Ethereum Sepolia. Miners are scored on evaluation questions and
ranked per intent.

- **Intent used:** `QUESTION_ANSWERING_GENERAL`, a free-form `query`. There's no dedicated
  "package release" intent, so we used the canonical QA intent.
- **Price:** 0.02 USDC per answer (the miner's floor). Telegraph keeps 2%. The other 98% is
  swapped to MACHINA at the end of each epoch and credited to the miner. First payout measured
  9 Nov: 0.0196 USDC = 0.00368 MACHINA for one call.
- **Payment schemes, an important plot point:**
  - Early November: per-call `exact` payments, one on-chain transaction per answer. Measured
    median for a paid LLM call: 13.3 s.
  - 5 Nov, we tested the `escrow` scheme: pre-deposit USDC into Telegraph's escrow contract,
    then sign each call off-chain. The same call's median dropped to **2.0 s**. Settlement
    happens per epoch, with no transaction per call.
  - Since 20 Nov Telegraph accepts payment on Sepolia only from escrow. The Action got an escrow
    payment path (#52), so installers now do a one-time `approve` + `depositUSDC`.
- **Routing:** Telegraph's engine can route a question to "the best miner for this intent".
  On 6 Nov it classified package questions as `WEB_SEARCH_GENERAL` and sent them elsewhere, so
  the bot asks miner 7314 by id first (`PREFERRED_MINER_ID`), then falls back to ranked miners.
  Every ledger row records which miner answered and labels our pick as `our_choice`, never as
  the engine's.

## 4. The miner (7314): how it works

### Pipeline

The core design rule: **resolution, sourcing and verification are deterministic; a language
model only helps extract items from text we already fetched, and every quote it returns must be
an exact substring of that text.** The model never supplies versions, dates or links.

1. **Parse.** Free-form question → package + version A + version B. "The word right before the
   first version is the package." More than two versions → `needs_clarification`.
2. **Resolve.** npm registry + semver: do both versions exist? If not, name the closest
   published ones ("the closest published version is 4.6.7").
3. **Retrieve sources** through `safeFetch`: an allowlist of hosts, DNS/IP checks (no
   private-network requests), manual redirects, and size and time limits.
   - npm registry metadata
   - GitHub releases and CHANGELOG files, with monorepo-aware tag/heading → version matching
   - migration guides in the repo, or on the package's own website when linked from the
     release notes
   - a tag-comparison fallback when there are no notes
   - OSV (api.osv.dev) for known advisories
4. **Extract.**
   - The **rules pass** (deterministic): section headings like "Breaking changes", phrase rules
     ("Removed: `propTypes`"), and CVE/GHSA ids.
   - The **model pass** (optional): bought from another Telegraph miner, an LLM miner, paid from
     the miner's own spend wallet via escrow. That's a miner buying from a miner (see §6).
5. **Verify.** Normalise, then check that each excerpt and migration step is an exact substring
   of the fetched source. Items that fail are dropped and counted.
6. **Correlate security.** For each OSV advisory affecting version A: is it fixed by the
   upgrade, or still affected at B?
7. **Coverage.** List every release between A and B and say which ones were read and which
   weren't (no notes, budget, truncated, upstream down). Never claim a "safe upgrade" from
   missing data.
8. **Outcome + render.** Outcomes are `found`, `not_found`, `needs_clarification`,
   `out_of_scope` and `temporarily_unavailable`. The last one is declared to Telegraph as a
   failure, so the buyer is **not charged** when an upstream source is down.
9. **Cache.** Answers are keyed by question + source content hashes + processing version. A
   repeat is byte-identical and served in about 0.45 s. A new processing version invalidates
   everything.

### Stack

- TypeScript on a Node Vercel function, with no web framework.
- `zod` and `semver` for parsing and version resolution; `@upstash/redis` for the cache.
- `viem` signs the escrow payments to the LLM miner.
- About 30 source files. Tests run offline with recorded registry, GitHub and OSV responses.
- Spec-driven: spec → plan → tasks with spec-kit (`miner/specs/001-package-release-miner/`).
  Tasks that spend money or register anything were marked ⚠ and needed explicit approval.

### Limits and budgets

- Questions up to 2,000 characters.
- 120 requests/min at the origin and 4 concurrent first-time computations.
- 20 s per first answer.
- At most 2 model calls (0.01 USDC each) of up to 4,000 characters each.
- Text not read because of these limits is reported as *not covered*, never silently skipped.
- The origin only answers requests carrying Telegraph's `X-Telegraph-Key`. Anything else gets a
  401 and does no work.

### Processing versions: a useful story device

| Version | Date | What changed |
| --- | --- | --- |
| p1 | 4 Nov | rules only |
| p2 | 4 Nov | phrase rules (React 18 → 19: 0 → 42 breaking changes found) |
| p3 | 4 Nov | OSV security check |
| p5-bench1…6 | 5 Nov | benchmark iterations: pointer releases, migration guides, website guides |
| p7 | 6 Nov | first production deploy |
| p8 | 9 Nov | "Key changes" answer layout |
| p9 | 11 Nov | large jumps split across 2 model calls; LLM miner switched 302 → 7413 (AIWire) after 302 began answering with unrelated feeds on 10 Nov |
| p10 | 23 Nov | migration-guide items named only by their parent heading now carry the API name. Triggered by the code-generation gate, see §7 |

### Quality: the benchmark

There are 40 hand-reviewed cases (30 positive, 10 negative), and real packages like zod,
express, react, next, vite and tailwindcss. Run against production `p9` on 11 Nov:

| Criterion | Result | Target |
| --- | --- | --- |
| Every quote found in the cited source, at a version in range | 675/675 (100%) | ≥ 90% |
| Invented versions, dates or links | 0 | 0 |
| Negative cases with the right outcome, no false "safe" claim | 8/8 | all |
| Coverage names every release in range | 38/38 | all |
| Repeats byte-identical | 38/38 | all |
| Security conclusions match OSV | 38/38 | all |
| Recall of reviewed breaking changes, word matching | 67.1% (247/368) | 80% (**missed**) |
| Same, with an LLM judge counting paraphrases | 82.6% (304/368) | 80% |
| First-time latency p50 / p95 | 2.1 s / 9.8 s | — |
| Repeat latency p95 | 606 ms | < 500 ms (**missed**) |

An honest headline: **precision is perfect by construction; recall is the hard part.** Release
notes are messy, and the rules + one cheap model call get about two thirds of the breaking
changes by strict matching.

### Ranking on Telegraph

- 8 Nov: rank 11 of 17 (score 0.7955).
- 9 Nov: rank 6 of 17 (0.9732), after two changes the same day: the p8 layout, and 30
  evaluation questions we uploaded to the intent's pool.
- The organisers confirmed operator-contributed rows are allowed if the miner doesn't train on
  them. It has no trained model and never reads them. Still, rank 6 is not independent proof
  of quality.
- The intent's judge is general-purpose, so rank moves with the pool. The benchmark is the
  real quality evidence.

### Registration, the practical bits (good tutorial material)

1. Deploy the endpoint.
2. Validate the YAML in the Telegraph dashboard. The first try failed with
   `on_chain: fields is required`.
3. From the payout wallet: get gas, mint test USDC, swap 3 USDC → MACHINA on the 0.3% pool
   (registration needs MACHINA), approve, then call `registerMiner`.
4. Wait about 6 min for `activation_status: active`.
5. Install the API key: a challenge, an EIP-191 signature, then install. The node validates it.
6. Paid acceptance test through `/engine/v1/ask/7314`.

Gotchas:
- The test USDC contract has an open `mint` (not documented in our README). The Google Sepolia
  faucet gives ETH for gas.
- Deposits can revert when the RPC lags behind the approve.
- Escrow debits show up late.
- Vercel Hobby, with deploys through the REST API because the CLI rejected the team token.

## 5. The agent (GitHub Action): how it works

| Stage | What happens |
| --- | --- |
| Scan | On a push that changes dependency files (or a manual run), read installed versions from the lockfile (npm, pnpm, Yarn, Bun) or exact Python pins; find newer stable releases on npm/PyPI |
| Decide | Release date > `MODEL_CUTOFF`? Deterministic, registry-based (ADR 0001): no "ask the model if it knows", which is reproducible and testable. Before buying, check the package manager can actually install the target (e.g. `react-dom` 19 with `react` 18 is skipped with npm's reason, nothing bought) |
| Learn | Buy one answer per package + target version, miner 7314 first, then ranked miners. Unusable answers are saved and skipped, never paid for twice |
| Report | One PR per upgrade, never duplicated: **What changed** (breaking first, each with migration step and quote) and **Where this repository uses what changed** (links to the lines, pinned to the scanned commit; a text search, not a type check). Releases *before* the cutoff get a **free PR**: no purchase, the rules pass of the miner run inside the Action |
| Account | Attempts, purchases (receipt, signal, tx), PR opened, merge or close: all appended to `ledger.jsonl` on a `ledger` branch in the installer's own repo. A `pull_request_target` workflow records outcomes; a merge counts only when it lands on the default branch (or `MERGE_BRANCHES`) |
| Fix (not built) | Design: after a maintainer adds `telegraph:fix`, buy a patch from a code-generation miner and push it only if the repo's tests pass in a job with no secrets. Its quality gate failed on 22–23 Nov, so it isn't in the submission; the design is ADR 0002, deferred until after the hackathon (§7) |

Design points worth writing about:

- **The bot itself uses no LLM.** All its knowledge comes from Telegraph miners.
- **A human merges; the bot never merges.**
- **Money safety:**
  - per-call price cap (0.10), per-run cap (2 USDC) and an optional monthly budget;
  - an attempt state machine (reserved → request_sent → delivered / failed_and_credited /
    unknown_needs_reconciliation), so a crash mid-payment can't cause a double payment;
  - a reconcile workflow for stuck attempts;
  - private repositories fail closed before any purchase.
- **Install is two workflow files + one secret** (a dedicated low-balance testnet wallet key) +
  a one-time escrow deposit + a few variables (cutoff, its source URL, and whether it is
  provider-documented or team-assumed). About 5 minutes.
- **Install discovery:** an hourly workflow searches GitHub for the bot's branch prefix and
  lists new installations as "found automatically, not verified". They join the totals only
  after a human checks them, because anyone could fake a ledger.

## 6. The model economy, concretely: a chain of purchases

One upgrade PR in production involves this chain:

```
GitHub Action ──0.02 USDC──▶ Telegraph ──▶ miner 7314 (ours)
                                              │ fetches npm / GitHub / OSV (free)
                                              └──0.01 USDC──▶ Telegraph ──▶ LLM miner 7413 (AIWire)
                                                                             extracts items
                                              ◀── verified quotes only ──┘
◀── answer + receipt + signal ──┘
opens PR, writes ledger row
```

Check before publishing: the model hop doesn't run on every answer. The p10 answer the fixture
bought on 23 Nov (telegraph-fix-fixture PR #2) was rules-only
(`processingVersion: p10-miners_7413-nollm-rules_only-s1`). Confirm on the miner's metrics how often
the model pass ran recently before writing "every upgrade".

So the agent buys from a miner, and that miner buys from another miner. Every hop is paid per
call with a receipt. The miner's margin on a first-time answer is about 0.02 − 0.01…0.02 model
cost. **On repeats it's the full 0.02**, because the cache serves them with zero model calls.
Caching is the business model.

## 7. The code-generation gate: an honest negative result

Question (22 Nov): can a Telegraph `CODE_GENERATION_GENERAL` miner migrate real code using our
paid "what changed" answer, so that the repo's own typecheck and tests pass?

- **Fixture:** zod 3.25.76 with 4 APIs that zod 4 removed, plus 6 behaviour tests.
- **Code miner:** CodeWire (the only live code-writing miner; the other 12 are data feeds).
- **Result: 0 of 3 passed.**
  - It migrated 3 of 4 breaking uses correctly.
  - It missed `z.record(z.string())`, and the typecheck failed.
- **Root cause was in our answer.** It said "4.0.0: drops single argument usage" without naming
  `z.record`, because in zod's changelog the API name is in the *parent* heading. The code
  miner couldn't know which call to change.
- **Fix:** processing version p10 (23 Nov). Migration-guide items now carry the parent
  heading's API name ("`z.record()`: drops single argument usage"). The quote itself is
  unchanged, so verification still holds.
- **Run 2 (23 Nov), with the fixed answer:** CodeWire was asked once and retried once with a
  slightly different request. Both times it returned its error reply ("model unavailable",
  "minimax returned no answer text") and no code, and both replies were charged (2 × 0.01 USDC).
- **Decision:** the fix stage is not built for the submission; PRs offer the call-site report.
  ADR 0002 records the design for after the hackathon: buy from Telegraph's top-ranked code
  miner and push only when the repo's tests pass. The team deferred it because ranked routing
  resolved to CodeWire alone. Evidence: `docs/telegraph/codegen-gate-2026-11-22/` and
  `docs/telegraph/codegen-gate-2026-11-23/`.
- **Lessons:**
  - Identical requests are answered from cache and **still charged**, so retries must differ.
  - The quality of a downstream agent's work is bounded by the precision of the knowledge it
    bought.
  - The check now runs in a Docker container with no network, because generated code is
    untrusted.

## 8. Traction and numbers (snapshot, re-check before publishing)

As of 22 Nov 2026, from the README evidence index:

- **12 repositories** running the bot: 10 team, 2 owned by outside developers.
- **Team repos:** 93 purchases (1.75 USDC); 2 paid PRs merged (`lemind/onewallet-radar` #12
  and `borodedamie/code-generator` #1, 21 Nov), 8 closed, 39 open. **Cost per merged PR:
  0.88 USDC (n=2).**
- **Outside repos** (`linda-ochem/temp`, `shadrxcc/porncrit-fe`): 37 purchases (0.74 USDC);
  **19 paid PRs merged** (6 and 13, all on 22 Nov; ledgers checked 25 Nov), including `next`
  14 → 16, `react` 18 → 19 and `tailwindcss` 3 → 4. Cost per merged PR about 0.04 USDC.
  - Caveats: team testnet wallets paid, the miner is ours, all merges happened within 16
    minutes, and Vercel deploy checks failed on the sampled PRs. "Merged" doesn't mean
    "verified to build".
- **Latency (bot side):** about 4.5 s median, 20 s p95, from the paid request to the recorded
  answer (108 answers). The miner's own: 2.1 s median for new questions.
- **Example run** (21 Nov, onewallet-radar): the bot skipped `@types/node` (saved unusable
  answer, nothing paid), bought `undici` for 0.02, and opened #12, which was merged. The
  dashboard immediately showed 1 merged, 0.17 USDC per merged PR.
- **Clean-room reproduction by a team member** (issue #69, filed from `lemind-bt`, a second
  account of a team member, following only the README): 3 minutes of setup, a 1-minute run,
  0.06 USDC spent, PRs opened. It also found real bugs (next section). Not independent: the
  README rightly lists "Independent reproduction: none yet".
- **Demo video:** 3:08, narrated (PR #71).

## 9. Honesty section: say this in the article, don't hide it

- **Related-party:** the same team runs the agent and miner 7314. Most purchases are
  team-to-team testing, not demand or revenue. Testnet USDC is not money.
- Outside developers were *invited* and used team-funded wallets: outside **use**, not outside
  **demand**.
- 99 of the first 110 answers came from our own miner (the bot prefers it by default).
- The miner's good rank came partly after we added our own evaluation questions to the pool.
- Recall misses its 80% target with strict matching.
- The fix stage didn't pass its quality gate.

Framing: "we built both sides of a market to prove the loop works end to end, with receipts;
the open question is whether outside buyers and sellers show up."

## 10. Bugs and lessons from the reproduction and from running it (issue #69 and others)

- The README didn't say where to get test USDC (open mint) or gas ETH (Google faucet). It also
  assumed `cast` was installed.
- Call-site search missed names written as `` `.flatten` ``, `` `.email` `` and `` `.int` ``.
- Express history listed pre-release entries as 5.0.0, with duplicates; empty
  Deprecations/Security headings were rendered; the dotenv 17 `quiet` change was missed; zod
  `##`-level sections were dropped.
- The run log doesn't show purchase details. Our "settled" doesn't match Telegraph's
  "unbilled".
- The bot doesn't close its own superseded PRs, and PRs don't say they were opened by the
  Telegraph PR Agent.
- Telegraph platform lessons:
  - the exact → escrow switch mid-hackathon;
  - engine routing misclassifies niche questions;
  - LLM miner 302 started returning unrelated feeds, so we switched to 7413 (AIWire);
  - escrow debits appear late;
  - a cached answer is still charged.
- Working style: spec-driven development (spec-kit) with AI coding agents, every paid action
  approved by a human, AGENTS.md rules (no secrets, no silent failures, untrusted miner text,
  "never claim in docs what wasn't run").

## 11. Timeline

| Date | Event |
| --- | --- |
| 19 Oct | ADR 0001: deterministic cutoff detection |
| 28 Oct | Pre-event CLI prototype pays 0.01 USDC to a Crossref QA miner (wrong answer, but the flow works) |
| 1 Nov | Hackathon starts |
| 2 Nov | Decision: the Action scans lockfiles itself and doesn't react to human PR diffs |
| 3 Nov | Miner scaffold on Vercel, Upstash Redis, spend and payout wallets |
| 4 Nov | First live answers (zod, express), phrase rules, OSV, first paid model call |
| 5 Nov | Escrow tested: 13.3 s → 2.0 s per paid call. Benchmark: recall 44.8% → 67.1% (82.6% judged) |
| 6 Nov | Production deploy, YAML validated, miner registered and active, first paid answer through Telegraph |
| 8 Nov | First Action purchase from 7314 |
| 9 Nov | 30 pool questions uploaded; rank 11 → 6; first payout measured |
| 11 Nov | p9: LLM miner 7413, large jumps split; per-request metrics |
| 13 Nov | First install on a team member's real repo (onewallet-radar) |
| 20 Nov | Telegraph goes escrow-only on Sepolia; escrow payment in the Action (#52) |
| 21 Nov | First paid PRs merged (onewallet-radar #12, code-generator #1); v1.3.0 |
| 22 Nov | Outside developers merge 19 paid PRs; code-gen gate run 1 fails 0/3 |
| 23 Nov | p10 deployed; gate run 2: code miner unavailable twice, fix stage not built (ADR 0002 deferred); team reproduction issue #69; new demo video |
| 1 Dec | Deadline |

## 12. Possible article angles

1. **"My dependency bot pays another AI for what changed"**: the buyer story, with the PR
   screenshot, the receipt and cost per merged PR.
2. **"Building a Telegraph miner that never makes things up"**: deterministic sourcing +
   substring-verified quotes, the benchmark, precision vs recall.
3. **"Agents buying from agents"**: the 3-hop purchase chain, escrow vs per-call latency, and
   caching as the margin.
4. **"A negative result: we tried to let a code miner fix the upgrade"**: the code-gen gate,
   and how one missing word in our answer broke the patch.
5. **Tutorial:** register a Telegraph miner, step by step, with the gotchas from §4.

## 13. Still open before 1 Dec

- Public updates: done, three on X on 14, 22 and 24 Nov (README, #74). Extra drafts in
  `public-updates.md`.
- Technical tutorial: drafted in `docs/TUTORIAL.md`; still to be posted publicly.
- Bug-fix PRs from #69: README funding, call sites, miner quality.
- A bot attribution line in PRs; closing superseded PRs.
- Genuinely independent buyers, and other miners chosen on rank rather than our own.
