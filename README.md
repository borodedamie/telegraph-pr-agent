# Telegraph PR Agent

A testnet prototype of a dependency-migration agent that is designed to buy release intelligence through [Telegraph](https://anjoman.ai/docs/introduction) instead of guessing. The product is a GitHub Action ([Dependency update Action](#dependency-update-action); to add it to your own repository, see [Install in your repository](#install-in-your-repository-5-minutes)); an earlier CLI prototype made the first test purchases and was removed on 11 Nov 2026. The project has not yet demonstrated a completed migration PR or cost per merged PR.

Built for the Telegraph Hackathon Season II, mission [Model Economy](https://hackathon.telegraphprotocol.com/missions/model-economy). Specification (source of truth): [docs/SPEC.md](docs/SPEC.md). Milestones: [docs/HACKATHON-PLAN.md](docs/HACKATHON-PLAN.md). Who does what: [docs/TEAM.md](docs/TEAM.md). Live QA intent contract: [docs/telegraph/qa-intent-contract-2026-11-02.md](docs/telegraph/qa-intent-contract-2026-11-02.md).

> **Testnet prototype.** Since 1 Nov 2026 the agent has made 4 testnet purchases (0.06 USDC). Two answers from third-party QA miners (3 and 4 Nov, through the since-removed CLI prototype) were unrelated to the package. Two came from the team's own miner 7314, so they are self-purchases; one of them (11 Nov, `@renovatebot/pep440`) was used to open a draft PR, which was closed without merging to test merge accounting. No PR has been merged, no package migration has been completed, and there is no production or third-party usage. Testnet USDC is not revenue.

## Status

Status is a snapshot, not a promise.

| Item | Value |
| --- | --- |
| Documentation revision | 19 Nov 2026 status refresh on top of `633417b` |
| Last implementation snapshot whose unit tests were run | `633417b`, 2026-11-18 17:04 UTC: bot 360, dashboard 15 and miner 235 tests pass; bot build passes |
| Last successful live Telegraph purchase | 11 Nov 2026, from the Action: 0.02 USDC to the team's own miner 7314 (`our_choice`) for `@renovatebot/pep440` 4.2.4 → 6.0.0 ([tx](https://sepolia.etherscan.io/tx/0xa3c9d78b8183f499959a2c4ed138c7e358ffdefb0a97527d6c32ffef1955e954)). The answer was marked useful and opened draft PR #27, closed without merging to test merge accounting |
| Last live contract check (no payment) | 14 Nov 2026, unsigned and unpaid catalogue and quote check: [preflight snapshot](docs/telegraph/four-package-tests-preflight-2026-11-14.json) |
| Event-period evidence (1 Nov to 1 Dec 2026) | 4 purchases, 0.06 USDC; see the evidence row under [For reviewers](#for-reviewers-and-the-hackathon-submission) |

| Part | State |
| --- | --- |
| Detect a dependency upgrade released after the cutoff | The action resolves supported installed versions and selects newer stable npm/PyPI releases strictly after `MODEL_CUTOFF`, reusing `bot/src/trigger.ts` for npm date checks. Covered by offline tests; hosted operation remains unverified. |
| Buy an answer on Telegraph with x402; record receipt hash, signal hash, tx hash | Works in the Action: pays on Ethereum Sepolia with x402 and records the receipt, signal and transaction hashes on the ledger branch. Live purchases on 8 and 11 Nov 2026 (miner 7314, `our_choice`). The third-party answers bought on 3 and 4 Nov through the removed CLI were unrelated to the packages asked about. |
| Append-only purchase ledger on a `ledger` git branch | Shared attempts and per-receipt records are wired into the action. Pre-PR assessments use dependency/version/query identity across commits; rows written by the removed CLI keep their PR/commit keys. Failure and concurrency behavior is covered by offline tests; hosted writes remain unverified. |
| Purchase dashboard | Works locally: `npm install --prefix web --ignore-scripts`, then `npm run dev --prefix web`; it reads `ledger.jsonl` from GitHub raw for a public repository. Deployed at https://telegraph-pr-agent.vercel.app. Shows purchases, cost per merged PR (all-time and for the 1 Nov – 1 Dec event window), PRs proposed, merged, closed and open with the merge rate and sample size, closed-PR spend, cost per useful answer, and escrow credits and refused quotes as non-spend. Add `?repo=owner/name` to view another public repository's ledger. **Download evidence CSV** exports, for 1 Nov – 1 Dec 2026, one line per settled purchase and per attempt reconciled as charged with no answer: date, repo, package and versions, miner and how it was selected (`rank` or `our_choice`), amount, network, receipt hash, signal and transaction links, answer quality and PR outcome. It is built in the browser from the public ledger; the raw `ledger.jsonl` is linked beside it. Hosted capture of a PR closed without merging was verified on 11 Nov (PR #27); no PR has been merged yet, so cost per merged PR shows N/A. |
| GitHub Action, dependency PRs, migration and merge accounting | Packaged action with cutoff gating, attempt ledger and dependency PR preparation (ready for review; drafts with `draft-prs: true`); validated locally. `telegraph:fix` and migration execution remain planned. Receipt-linked merge accounting is implemented and tested offline. |
| Package-release Q&A miner | Working, in production at `https://telegraph-pr-miner-n30sk.vercel.app` and registered on Telegraph since 6 Nov as miner 7314 (`package-release-intel`, `QUESTION_ANSWERING_GENERAL`, 0.02 USDC). It answers what changed in an npm package between two versions from npm, GitHub release material, migration guides and OSV, each change with a verbatim quote and its source. A paid direct call through Telegraph was served and settled on 6 Nov; Engine routing sent the same kind of question to another intent (`WEB_SEARCH_GENERAL`), so buyers ask it by id. Benchmark: 67.1% of reviewed breaking changes by word matching, 82.6% with an LLM judge (target 80%), every quote checked. Scored by the intent's general-purpose judge: rank 6 of 17 on 9 Nov (11 of 17 on 8 Nov), measured with our own 30 questions in the pool (1 of 6 contributors), so it is not independent evidence of quality; the benchmark is the quality evidence. Details: [miner/README.md](miner/README.md). |

**About the one purchase so far.** On 28 Oct 2026 the CLI prototype (since removed) paid 0.01 testnet USDC through the devnode to Crossref QA, which was third in the provider list the old client read for question answering on that date (the client's ordering, not a saved Telegraph ranking snapshot), and recorded the tx hash, receipt hash and signal hash. The returned answer was academic search results unrelated to the package. That run is a pre-event integration test: it shows the payment flow was exercised. It is not event-period hackathon evidence and not a successful package-release answer. It also used the node interface as it stood on that date; the request shape and intent ids have to be rechecked against the live node before any new run.

## How it will work

Each stage is marked current or planned.

1. **Scan** (planned): on a schedule the developer sets in the workflow (the example uses weekly) or a manual run, read the installed version A of each direct JavaScript dependency from its supported lockfile, look up the latest stable version B on npm, and query OSV for known advisories in A.
2. **Learn** (current, partly): when B is newer than A *and* B was released after the configured cutoff, buy one question-answering request on Telegraph on the live canonical intent (`QUESTION_ANSWERING_GENERAL` on 2 Nov). The current client calls a chosen miner directly; whether the Action uses Engine routing instead is still open ([SPEC §2.4](docs/SPEC.md)). The quote comes from the 402 challenge and can vary; 0.01 USDC is an observed example, not a price.
3. **Report** (planned): open one draft PR per package and target version, updated on later runs, never duplicated. It lists why to upgrade, known advisories, which changed symbols the repository uses (found by a local search, not by the miner), what to change, spend so far and an estimated fix cost. If the answer is `not_found`, the purchase and receipt are kept, the PR is report-only, and no migration is invented.
4. **Fix** (planned, after a maintainer with write access adds `telegraph:fix`): generate a patch with the purchased answer as input. Paid `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` calls are conditional on a provider passing our quality tests; until then the installer's own LLM writes the patch. The repository's install, typecheck and tests run in a job with no secrets. Nothing is pushed unless they pass.
5. **Merge** (planned): a human reviews and merges. The bot never merges.
6. **Account** (planned): cost per merged bot PR = all net automation spend (Telegraph, LLM, closed and unmerged proposals) divided by merged bot PRs, shown with the proposal and merge counts; `N/A` when nothing has merged.

## What runs today

The GitHub Action under [Dependency update Action](#dependency-update-action) is what runs; [Enable the workflow](#enable-the-workflow) covers setup and configuration. The CLI prototype (`bot/src/slice.ts`, with `bot/src/memo.ts` and `bot/.env.example`) that made the purchases of 28 Oct, 3 Nov and 4 Nov was removed on 11 Nov 2026. Those purchases stay on the ledger with their original PR/commit keys, so their repo, package and version fields are empty on the dashboard and in the evidence CSV.

Ledger behaviour and known gaps:

- The intent id `QUESTION_ANSWERING_GENERAL` is hardcoded; it was checked against `GET /engine/v1/intents` on 3 Nov 2026 and must be rechecked if the catalogue changes.
- Each payment try is recorded on the ledger branch at every stage (`reserved`, then `quote_refused` or `request_sent`, then `delivered`, `failed_and_credited`, `failed_not_charged` or `unknown_needs_reconciliation`; definitions in [SPEC §2.6](docs/SPEC.md)) before the bot moves on. If a run dies or its push fails after `request_sent`, the next run for that PR and commit stops instead of paying again, and a person checks the wallet, escrow balance and signal. Before recording `reserved` and `request_sent`, the run re-checks the freshly fetched ledger, and a push loses if another run pushed first, so two runs for the same PR and commit can't both pay; the second stops. To clear a stuck attempt, check the wallet, escrow balance and signal, then run the **Reconcile a stuck payment attempt** workflow (`.github/workflows/reconcile-attempt.yml`, Actions tab, default branch) with the `attemptId`, the outcome (`failed_and_credited`, `failed_not_charged`, or `failed_and_charged` when the payment was charged but no answer was kept) and a note. `failed_and_charged` requires the payment's transaction hash and counts as spend. The workflow holds no wallet key; it refuses attempts that aren't stuck, and records who reconciled.
- A purchase is recorded once per `receipt_hash`; writing a receipt that is already on the ledger is refused. Each purchase row has a `resultStatus` for answer quality, kept apart from payment: new rows start `unchecked`, and `useful`, `unusable` or `not_found` can be recorded separately. The dependency action automatically appends `useful` when an answer produces a published PR and `unusable` for invalid findings; the dashboard uses the latest quality update.
- Each purchase row stores the network, chain id, USDC contract and explorer URL of the 402 option it paid, and transaction links are built from that. Rows written before 5 Nov 2026 lack these fields; their links use the date (before 1 Nov: Basescan, Base Sepolia; after: Etherscan, Ethereum Sepolia). The dashboard header still names Ethereum Sepolia as fixed text.

## Repository layout

```
bot/                TypeScript, Node 22.20+, vitest
  src/config.ts       model provenance validation
  src/trigger.ts      post-cutoff release-date checks against the npm registry
  src/x402.ts         Telegraph client: provider list, x402 payment, receipt capture
  src/ledger.ts       ledger.jsonl on the `ledger` branch: attempts, purchases, PR outcomes
  src/action.ts       the GitHub Action entry point (with scan, purchase, PR and ledger modules)
  dist/index.cjs      the packaged Action that runners execute (CommonJS)
  test/               unit tests; no network, no payments
web/                static dashboard (Vite); reads ledger.jsonl from GitHub raw
.github/workflows/  dependency updates, merge accounting, attempt reconciliation, tests
docs/               plan, specification, team split, ADRs
CONTEXT.md          glossary used during design; reviewers can skip it
```

No public fixture repository for reviewers exists yet ([TEAM.md](docs/TEAM.md)).

## Run it

Offline checks (no network, no payment), from the repository root:

```bash
npm ci --prefix bot --ignore-scripts
npm test --prefix bot
npm install --prefix web --ignore-scripts
npm test --prefix web
npm run dev --prefix web    # dashboard; add ?repo=owner/name for another public repository
```

To make a purchase, install the workflow on a public repository: see [Enable the workflow](#enable-the-workflow). It spends testnet USDC from the wallet you configure and writes to that repository's `ledger` branch.

## Verify a purchase

Open `https://devnode.telegraphprotocol.com/engine/v1/signal/<signalHash>` to inspect the request and response Telegraph recorded, and the tx hash on the explorer for the chain named in the quote. The signal and receipt show what was bought and returned; they do not by themselves show the answer is factually correct. Package-release claims have to be checked against their linked registry and release-note sources, and migration correctness by the repository's tests.

## Network and spending limits

The 402 challenge supplies the current quote and payment options. The client's local spending policy must allow the quoted network and token, and must reject a quote above the configured per-call maximum. The run budget is enforced separately across calls. The observed 0.01 USDC quote is an example; a provider's floor price, the quoted amount and the charged amount are different figures, and a demand multiplier can raise the quote.

Invalid requests are rejected before payment (for example, `params` sent to an intent without an input schema returns 400). On 2 Nov the challenge offered two schemes on Ethereum Sepolia: `exact` (per-request x402) and `escrow` (deducted from a pre-funded Telegraph escrow balance at the next epoch close).

On the documented x402 path a valid payment may settle before the miner is called; if delivery then fails, the amount is credited to the caller's Telegraph escrow balance and is not consumed. A delivered 200 returns a Telegraph receipt. A 200 whose body contains an error is still treated as delivered, so the client checks the result itself (and `result_shape` and `field_status` when present), not only the HTTP status. The x402 guide and the protocol overview describe settlement timing differently; a controlled failed-delivery test against the current node is planned and will be linked here. Until then, do not read this as "failed calls cost nothing".

`receipt_hash` identifies an individual delivered call; a transaction hash can cover several calls.

## Security model (planned Action)

- The payment and LLM job holds the wallet and LLM credentials and runs no repository scripts.
- The install, typecheck and test job receives no wallet, LLM or write-token secret.
- A separate commit job receives only a minimal short-lived write credential, validates the patch artifact, restricts it to permitted paths and the expected base SHA, and never executes repository code.
- `pull_request_target` is never combined with checking out and running PR code. Third-party Actions are pinned to commit SHAs.
- The installer supplies both the wallet and the LLM key in repository secrets and pays both Telegraph and the LLM provider.

## Limitations

- Package-release answer quality has not been demonstrated by existing providers.
- The team's package-release miner is registered and scored, but the intent's test questions are mostly general, so its rank moves with the pool (6 of 17 on 9 Nov, 11 of 17 on 8 Nov).
- The `telegraph:fix` label stage is planned: patch generation, install/typecheck/tests in a job without secrets, and pushing only a validated patch. The Action, draft PRs and merge accounting exist.
- `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` are conditional on providers passing quality tests.
- Public repositories only. Testnet only; no revenue or adoption claim.

## Disclosure

- The same team controls the agent and the package-release miner (payout wallet `0x74f2840C8A564F791f50aD76c38EF078258588dC`). Any agent purchase from that miner is related-party testing, not independent demand, adoption or third-party validation.
- Cutoff provenance on old rows (note added 19 Nov 2026): the Action purchases of 8 and 11 Nov 2026 record `MODEL_PROVIDER=telegraph` and `MODEL_ID=7314`. Those values named the miner, not a coding model; the cutoff (2026-01-01, team-assumed) belongs to the installer's coding model. The rows are left as written. From 19 Nov 2026 (#46) the Action rejects Telegraph or a miner id in these fields.
- Buyer wallets (both team-controlled): [`0x85Bb8c5Db7505a348af0C2aC03819827d4e435C8`](https://sepolia.etherscan.io/address/0x85Bb8c5Db7505a348af0C2aC03819827d4e435C8) paid on 3, 4 and 11 Nov 2026, and [`0x30A33F953a9bCc9Aff927caC815984ab2Eab305f`](https://sepolia.etherscan.io/address/0x30A33F953a9bCc9Aff927caC815984ab2Eab305f) paid on 8 Nov 2026. Payments go to Telegraph's payment contract [`0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b`](https://sepolia.etherscan.io/address/0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b), not directly to a miner. Purchases from miner 7314 by these wallets are related-party. Keys are never published.
- Code written before 1 Nov 2026: the CLI vertical slice (commit `9faf16a` and earlier; removed on 11 Nov 2026). Work added during the event will be summarised here.
- Event window: purchases, transactions, usage, demos and adoption evidence claimed for Season II fall between 1 Nov and 1 Dec 2026. Package release notes and registry records keep their original dates, including dates before the event.
- Reused open source, with licences read from each package on 19 Nov 2026. Runtime: `@x402/fetch`, `@x402/evm`, `@renovatebot/pep440` (Apache-2.0); `@actions/core`, `viem`, `zod`, `jsonc-parser`, `@upstash/redis` (MIT); `@yarnpkg/parsers` (BSD-2-Clause); `semver` (ISC). Development only: `typescript`, `@vercel/node` (Apache-2.0); `vitest`, `vite`, `esbuild`, `tsx`, `@types/node`, `@types/semver` (MIT).

## For reviewers and the hackathon submission

To be filled in as each item exists; nothing below is claimed yet.

| Item | Status |
| --- | --- |
| Tested commit and public repository | this repository, commit listed under Status |
| Public dashboard URL | https://telegraph-pr-agent.vercel.app (add `?repo=owner/name` for another public repository) |
| Testnet and token in use | from the live 402 challenge; Ethereum Sepolia test USDC as of 2 Nov 2026 |
| One command for a new realistic input | planned: the Action on a public fixture repository ([TEAM.md](docs/TEAM.md)) |
| No-post-cutoff, no-spend case | planned on the fixture repository; offline test: no purchase or PR when no dependency is past the cutoff |
| Failing typecheck, no push case | planned with the `telegraph:fix` stage |
| Event-period receipts, signal links, transactions, ledger export | Dashboard **Download evidence CSV** plus the raw `ledger.jsonl`. As of 19 Nov 2026: 4 purchases (0.06 USDC): two CLI test buys from third-party miners (3 and 4 Nov, answers not useful) and two Action assessments from the team's own miner 7314 (8 and 11 Nov, `our_choice`, self-purchases, not independent adoption) |
| 2–5 minute demo | not recorded |
| Five-question commercial summary | not written |
| Public updates (at least three, separate dates) | none yet |
| Technical tutorial and independent reproduction evidence | none yet |

If you try the Action, open an issue with what you ran, the signal hash and whether the answer was useful. That is the kind of independent test the project needs.

## Install in your repository (5 minutes)

Runs on testnet: payments are Ethereum Sepolia test USDC. Nothing here spends real money.

**1. Check your repository fits.**

- Public repository. Private ones fail closed before any purchase.
- Standalone projects with npm `package-lock.json` v2/v3, pnpm `pnpm-lock.yaml` v6/v9,
  Yarn Classic/modern `yarn.lock`, or Bun text `bun.lock`; and/or Python exact pins
  (`name==1.2.3`) in `requirements*.txt` or `requirements/*.txt`. Workspaces remain
  excluded. Install the matching package manager on the action runner first.

**2. Repository settings (the step most often missed).** Settings → Actions → General →
Workflow permissions: tick **Allow GitHub Actions to create and approve pull requests** and
click **Save**. Without it the run buys its answers and then fails with a 403 when opening
PRs; tick it and re-run, and the saved answers are reused with nothing bought again. The Action creates a
`ledger` branch on first use; a branch protection rule covering every branch would block it.

**3. One secret.** Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `TELEGRAPH_EVM_PRIVATE_KEY` | Private key of a dedicated, low-balance wallet holding Sepolia test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`, chain `11155111`). Each answer costs about 0.02 USDC; the facilitator pays gas. |

**4. Repository variables** (same page, Variables tab). The cutoff is your coding model's
training cutoff: only dependency releases published after it are bought.

| Variable | Required | Example |
| --- | --- | --- |
| `MODEL_CUTOFF` | yes | `2026-01-01` |
| `MODEL_CUTOFF_SOURCE_URL` | yes | HTTPS page that documents or explains the cutoff |
| `MODEL_CUTOFF_STATUS` | yes | `provider-documented` or `team-assumed` |
| `MODEL_PROVIDER` | no | your coding model's provider, e.g. `anthropic`; never `telegraph` |
| `MODEL_ID` | no | the exact coding model your team uses; never a miner id. Set both or neither; with neither, the cutoff must be `team-assumed` |
| `PREFERRED_MINER_ID` | no | miner tried first; defaults to `7314` |
| `MERGE_BRANCHES` | no | branches besides the default whose merges count, e.g. `release/*` |
| `MONTHLY_BUDGET_USDC` | no | cap across all runs in a calendar month (UTC), e.g. `1` |

**5. Two workflow files.** Copy both. They reference this Action by tag:
`borodedamie/telegraph-pr-agent@v1` is published when the Action's restructure merges; until
then, replace `@v1` with the full commit SHA of `main`.

`.github/workflows/telegraph-dependency-updates.yml`, scans and opens PRs (change
`main` if your default branch has another name):

```yaml
name: Telegraph dependency updates

on:
  push:
    branches: [main]
    paths: ['**/package.json', '**/package-lock.json', '**/requirements*.txt', 'requirements/**']
  workflow_dispatch:

concurrency:
  group: telegraph-dependency-updates-${{ github.repository }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  update-dependencies:
    if: github.ref_type == 'branch' && github.event.deleted != true && !startsWith(github.ref_name, 'fix/telegraph-dependency-')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4
        with:
          ref: ${{ github.ref_name }}
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 24
      - uses: borodedamie/telegraph-pr-agent@v1
        with:
          monthly-budget-usdc: ${{ vars.MONTHLY_BUDGET_USDC }}
        env:
          TELEGRAPH_EVM_PRIVATE_KEY: ${{ secrets.TELEGRAPH_EVM_PRIVATE_KEY }}
          GITHUB_TOKEN: ${{ github.token }}
          MODEL_CUTOFF: ${{ vars.MODEL_CUTOFF }}
          MODEL_PROVIDER: ${{ vars.MODEL_PROVIDER }}
          MODEL_ID: ${{ vars.MODEL_ID }}
          MODEL_CUTOFF_SOURCE_URL: ${{ vars.MODEL_CUTOFF_SOURCE_URL }}
          MODEL_CUTOFF_STATUS: ${{ vars.MODEL_CUTOFF_STATUS }}
          PREFERRED_MINER_ID: ${{ vars.PREFERRED_MINER_ID || '7314' }}
```

`.github/workflows/telegraph-pr-outcomes.yml`, records each closed dependency PR (merged or
not) on the ledger, which is what cost per merged PR is computed from. It checks out your
default branch, never the PR's code, and has no wallet key:

```yaml
name: Telegraph PR outcomes

on:
  pull_request_target:
    types: [closed]

permissions:
  contents: read

jobs:
  record-outcome:
    if: github.event.pull_request.head.repo.full_name == github.repository && startsWith(github.event.pull_request.head.ref, 'fix/telegraph-dependency-')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4
        with:
          ref: ${{ github.event.repository.default_branch }}
          persist-credentials: false
      - uses: borodedamie/telegraph-pr-agent@v1
        with:
          merge-pr-number: ${{ github.event.pull_request.number }}
          merge-branches: ${{ vars.MERGE_BRANCHES }}
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

A merge counts toward cost per merged PR only when it lands on your default branch, or on a
branch matching the optional `MERGE_BRANCHES` variable (e.g. `release/*`) if you ship from
release branches. A dependency PR merged anywhere else, such as a test branch, is recorded as
closed: its spend stays in the total but it is not counted as merged.

**6. Run it.** Actions → Telegraph dependency updates → Run workflow. With no dependency
released after your cutoff it ends with "no purchase made" and spends nothing. Otherwise
it buys one answer per package and opens one PR per update, ready for review (add
`draft-prs: "true"` under `with:` to open drafts instead); review it, run your CI,
merge or close it. Each PR starts with **What changed**: the documented breaking changes,
deprecations and security fixes between your version and the target, breaking changes
first, each with its migration step and a quote from the release notes. Below it, **Where
this repository uses what changed** links every line (pinned to the scanned commit) where a
tracked source file that imports the package uses a name quoted in a breaking change or
deprecation. It is a text search, not a type check; tested offline, not yet run on a live
repository.

Newer releases on or before your cutoff are within your model's knowledge, so nothing is
bought for them: the bot still opens a free PR for each (up to 5 per run, `max-free-prs`;
`"0"` turns them off), stating the release date and the cutoff and linking the registry page
and the release notes. An upgrade already proposed is not proposed again. Releases with an
unknown date are only listed in the run log as skipped. Free PRs and their merges are marked
`free` on the ledger and the dashboard counts them on their own line; they never enter cost
per merged PR. Live-tested on the gRPC-tutorial fixture repository (three free PRs, no purchase).

For npm packages a free PR also shows **What changed** and **Where this repository uses what
changed**, like a paid PR. The bot reads the release notes itself with our miner's rules pass
(`miner/src`), run inside the Action with no model, no wallet and only the run's
`GITHUB_TOKEN` for GitHub's API. Rules alone catch less than the paid answer, which adds a model
pass: notes the rules can't parse are skipped, and the PR then keeps just the links. PyPI free
PRs keep just the links. Tested offline against recorded zod release data; not yet run live.

**7. See the spend.** `https://telegraph-pr-agent.vercel.app/?repo=OWNER/REPO` reads your
repository's `ledger` branch: every purchase with its receipt, signal and transaction, and
cost per merged PR once a dependency PR has merged. You don't need to build the URL: each
run that buys prints it on the run page, and every dependency PR ends with it.

Limits by default: 0.10 USDC per call and 2 USDC per run (`max-price-per-call-usdc`,
`budget-cap-usdc` inputs). A payment stuck mid-flight blocks a repeat purchase for that
package until it is reconciled with [reconcile-attempt.yml](.github/workflows/reconcile-attempt.yml) (copy it
and change `uses: ./` to `uses: borodedamie/telegraph-pr-agent@v1`).

## Dependency update Action

The workflow in `.github/workflows/dependency-updates.yml` runs automatically only
on pushes to `main` that change `**/package.json`, `**/package-lock.json`,
`**/requirements*.txt`, or `requirements/**`. Manual dispatch remains available
for a selected branch. Branch-deletion events do not run it. One action invocation scans dependencies, purchases an assessment,
prepares updates, and opens PRs (drafts with `draft-prs: true`); no stage inputs, intermediate artifact files,
or separate caller jobs are needed.

```yaml
permissions:
  contents: write
  pull-requests: write

jobs:
  update-dependencies:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: ${{ github.ref_name }}
          persist-credentials: false
      - name: Update dependencies
        uses: ./ # inside this repository only; other repositories: see "Install in your repository"
        env:
          TELEGRAPH_EVM_PRIVATE_KEY: ${{ secrets.TELEGRAPH_EVM_PRIVATE_KEY }}
          GITHUB_TOKEN: ${{ github.token }}
          MODEL_CUTOFF: ${{ vars.MODEL_CUTOFF }}
          PREFERRED_MINER_ID: ${{ vars.PREFERRED_MINER_ID || '7314' }}
          MODEL_PROVIDER: ${{ vars.MODEL_PROVIDER }}
          MODEL_ID: ${{ vars.MODEL_ID }}
          MODEL_CUTOFF_SOURCE_URL: ${{ vars.MODEL_CUTOFF_SOURCE_URL }}
          MODEL_CUTOFF_STATUS: ${{ vars.MODEL_CUTOFF_STATUS }}
          MODEL_CONFIGURED_AT: ${{ vars.MODEL_CONFIGURED_AT }}
```

Checkout makes the repository available; the dependency automation is a single step.
The packaged `bot/dist/index.cjs` is included so callers need no install or
build steps. `action.yml` sits at the repository root, so another repository uses
`OWNER/REPO@IMMUTABLE_SHA` after publishing a commit containing the bundle, rather than
the local `./` path.

Before purchasing, the action selects newer stable npm/PyPI releases with verified
release dates strictly after `MODEL_CUTOFF`. No candidate means no purchase or PR. Registry failures are reported per dependency
without discarding other verified candidates; the run reports failure afterward
so an outage is not mistaken for a clean no-upgrade result.
The miner receives one dependency and its verified target per assessment. Findings must
identify a scanned ecosystem, package, source and current version, a newer target,
`cve` or `outdated`, a reason and HTTPS evidence sources. CVE findings require CVE IDs.
Invalid/prose answers fail; no findings means no updates or PRs.

Recommended targets are checked against npm/PyPI. Existing dependency files are
updated on `fix/telegraph-dependency-*` branches, with a PR per finding back
to the checked-out branch. Standalone JavaScript projects get a regenerated lockfile
alongside package.json using their matching npm, pnpm, Yarn or Bun executable. Plain Python pins retain extras, markers
and comments. Matching PRs are reused, and existing branches are never force-updated.
No assessment or prepared-update files are added to the repository.

All orchestration now runs in one job with wallet and GitHub credentials. It never
executes repository scripts or tests. Lock generation runs in a temporary directory
with scripts disabled, no inherited wallet/GitHub credentials, and no repository
package-manager configuration. pnpm hooks are disabled as well. npm, pnpm and Bun
use lockfile-only mode; modern Yarn uses update-lockfile mode. Yarn Classic performs
an install with scripts disabled. Human
review and merge remain required; this does not provide separate-runner isolation.

`bot/src/scan.ts` detects the repository from the current working directory
using Git; no workspace environment variable is required. It reads npm dependencies
and devDependencies from the supported standalone npm, pnpm, Yarn and Bun lockfiles, and
Python exact pins from requirements.txt, requirements-*.txt and requirements/*.txt.
The scanner performs no registry requests. It checks npm resolved versions against
manifest ranges using SemVer and validates Python pins using PEP 440; invalid or
inconsistent entries are skipped before assessment. All declarations the updater
would change are validated; matching Python package/version pins are grouped with
their markers preserved. Unsupported workspace/no-lock
npm projects and hashed/continued Python pins are also skipped before spending.
pnpm membership checks support block-style package globs and exclusions; other
workspace YAML forms fail closed until a full workspace resolver is supported. Python markers
are preserved, not evaluated. Tracked source packages under `build` are included;
untracked generated directories remain excluded. Pins describe the repository environment rather than
proving what is installed in a running interpreter. Unresolved versions are reported.

### Enable the workflow

- The action uses the existing ranked-miner payment client for
  `QUESTION_ANSWERING_GENERAL`. Optional `preferred-miner-id` (or `PREFERRED_MINER_ID`
  env/repository variable) tries a chosen miner before the ranked list. Its purchases
  retain the client's `selectedBy: "our_choice"`; an unranked choice has null rank/score.
- Set repository variable `MODEL_CUTOFF` (or action input `model-cutoff`) to the model's
  training cutoff date, for example `2025-01-01`. Missing/invalid dates fail before payment.
- Configure `MODEL_CUTOFF_SOURCE_URL` (HTTPS) and `MODEL_CUTOFF_STATUS`
  (`provider-documented` or `team-assumed`) for provenance. `MODEL_PROVIDER` and
  `MODEL_ID` optionally name your coding model; the bot itself uses no LLM.
  `MODEL_CONFIGURED_AT` is optional; otherwise the configuration-load time is recorded.
  The workflow requires explicit cutoff and model provenance repository variables.
  Placeholder provider/model names are rejected before payment. A team-assumed
  cutoff is supported when the actual provider and model are named and its source
  records the assumption. The preferred miner defaults to `7314`.
- Inputs `chain-id` and `usdc-address` default the payment allowlist to Sepolia (`11155111`) and USDC
  `0xcc194e1a843B658526D0D5C431f670028582Ae17`. No chain or token variables
  are required; inputs can override the allowlist. These defaults were verified with an unsigned, unpaid devnode
  [402 challenge on 5 Nov 2026](docs/telegraph/action-payment-2026-11-05.json).
  The wallet must hold this token; quotes for other networks or assets are refused.
- Public settings default in `action.yml`: `node-url` is
  `https://devnode.telegraphprotocol.com`, `max-price-per-call-usdc` is `0.10`,
  and `budget-cap-usdc` is `2`. Optional
  `with:` inputs can override these defaults. These are spending limits, not live prices.
- `budget-cap-usdc` applies to one run. To cap spend across runs, set the optional
  `monthly-budget-usdc` input (off when empty): before each purchase the action adds up
  the calendar month's (UTC) settled purchases on the ledger branch, counts any attempt
  still mid-payment at `max-price-per-call-usdc`, and refuses the purchase if one more
  worst-case call would exceed the cap. Nothing is recorded or paid when it refuses. In this repository's workflow it comes from the repository variable `MONTHLY_BUDGET_USDC`.
- Supply secret `TELEGRAPH_EVM_PRIVATE_KEY` for a dedicated wallet. Private keys
  are not bundled as action defaults.
- Allow GitHub Actions to create pull requests in repository settings and grant the
  job `contents: write` and `pull-requests: write`.
- Run **Telegraph dependency updates** on the branch you want to update. A named
  branch must be checked out; detached HEAD is rejected instead of guessing a target.
- After editing bot source, run `pnpm --filter @telegraph-pr-agent/bot build` (or
  `npm run build --prefix bot`) and include the updated `bot/dist/index.cjs` in the same
  change; CI fails when the committed bundle differs from a fresh build. Building needs
  the bot's dependencies; callers do not.

The action has no stage or artifact inputs. Public node/spending settings have
action-defined defaults; the wallet remains a secret. Outputs are `has-findings`,
`pull-requests` (JSON URLs), `message` (purchase details, retained even if later
validation fails), and `status`. Repository visibility is checked before assessment;
private or unknown visibility fails closed. The `pull-requests` output retains earlier
URLs if a later publication fails. The agent does not update its own dependencies:
the bot remains a workspace member, and automatic workspace updates are excluded,
so its dependency upgrades are made by hand.

### Workflow checks

`.github/workflows/test.yml` runs on pushes, pull requests and manual dispatch.
It installs bot dependencies from the workspace pnpm lockfile without lifecycle
scripts, typechecks the bot/tests, builds the action, checks that the checked-in
bundle matches its source, and runs
the offline bot/action test suite. The standalone `cli/` package has been removed. It receives no wallet or write credentials.
Local bot installations use npm and `bot/package-lock.json`; dependency changes
keep that npm lockfile and the workspace pnpm lockfile synchronized so the existing
CI and deployment configuration can stay unchanged. The bot imports the miner's
source (`miner/src`) for free PRs, so building or testing the bot also needs the
miner's dependencies: run `pnpm install` at the repository root (CI installs both
packages from the workspace lockfile). The action bundle includes most of `miner/src`,
so a change to `miner/src` also needs `npm run build --prefix bot` and a commit of
`bot/dist/index.cjs`; CI fails until then. Such a change also changes the Action's
behaviour from the next release tag, so miner PRs need a bot-side review too.

`.github/workflows/dependency-updates.yml` runs on dependency-file pushes to
`main` and manual dispatch, excluding generated fix branches and branch deletions. It checks out
the triggering branch without persisted Git credentials and invokes the packaged
action once. Only the update job has write permissions. It supplies the wallet
secret and GitHub token, relies on the action's public configuration defaults, and
sets up Node 24 for npm lockfile generation and exposes `status`, `has-findings`,
`pull-requests`, and `message` job outputs. It does not install, build, or
execute repository test scripts. No chain or USDC repository variables are needed.

### Package-manager tools on consumer runners

Install the executable matching the target repository's `packageManager` release
before invoking the action. Keep wallet secrets on the action step only. For example,
these optional setup commands install tools with npm in a temporary directory:

```sh
npm install --prefix "$RUNNER_TEMP/telegraph-tools" --no-audit --no-fund pnpm@10.18.3 @yarnpkg/cli-dist@4.9.2 bun@1.3.3
echo "$RUNNER_TEMP/telegraph-tools/node_modules/.bin" >> "$GITHUB_PATH"
```

Choose versions matching your target repository; use `yarn@1.22.22` instead of
`@yarnpkg/cli-dist` for Yarn Classic. These are consumer setup examples; the project's
CI/CD workflows are unchanged. Bot project dependencies continue to use npm.

### Verified scope and limits

Automated tests mock Telegraph, registry and GitHub responses. They cover findings,
manifest updates, lock-generation orchestration, offline mixed-language scanning,
branch/PR creation and duplicate suppression. Typechecks and the action bundle build
run locally. Unpaid live updater/publisher tests produced four draft fixture PRs:
[npm #35](https://github.com/borodedamie/telegraph-pr-agent/pull/35),
[pnpm #36](https://github.com/borodedamie/telegraph-pr-agent/pull/36),
[Yarn #37](https://github.com/borodedamie/telegraph-pr-agent/pull/37), and
[Python #38](https://github.com/borodedamie/telegraph-pr-agent/pull/38).
Their changed paths and published contents were verified against prepared updates;
all target an isolated `test/` branch and were closed after review verification. No Telegraph assessment, payment or purchase
ledger row was produced by these component tests. They do not verify the full paid
bot flow or hosted workflow. Details: [dated test report](docs/telegraph/four-package-pr-tests-2026-11-14.json).

PR preparation rejects workspace updates, conflicting lockfiles, non-public registry
sources and hashed/continued Python pins rather than publish stale lock data.
Binary `bun.lockb` needs migration to text `bun.lock` first. Custom pnpm settings,
overrides and resolutions remain unsupported for the additional managers. A declared
pnpm/Yarn/Bun `packageManager` release must match the installed executable; otherwise
the dependency is skipped with a warning before any assessment purchase. The same
version and lock-format checks run again during preparation. Valid Corepack
SHA-1/224/256/384/512 suffixes are accepted.
Updates temporarily pin the exact recommendation, restore the original range style,
and finalize with the same native manager; the resulting lock must retain that target.
Yarn's built-in TypeScript, resolve and fsevents compatibility patches are accepted;
custom local or remote patches remain unsupported.
`@yarnpkg/parsers` handles Yarn and pnpm parsing; `jsonc-parser` handles Bun's
comments and trailing commas. Both are retained for these formats, with no new
dependencies introduced by the review fixes. A test detects npm/workspace lock drift.
Python ranges, includes and pyproject/Pipfile/setup manifests need exported exact pins.
Current npm prereleases and valid PEP 440 Python pins (including `==1`) are
accepted and ordered using their ecosystem rules. Recommended targets remain
stable versions; npm targets require major.minor.patch. The action uses
`semver` and `@renovatebot/pep440` for version validation and ordering. Unsupported findings fail preparation before publication.
Registry checks confirm target availability, not the truth of CVE claims or migration
compatibility. Repository tests and code migrations are not run automatically; dependency
PRs must be independently checked. GitHub's behavior for workflows triggered by a
`GITHUB_TOKEN` PR can require human approval before checks run; check the PR's Actions
status rather than assuming CI ran ([GitHub token behavior](https://docs.github.com/en/actions/concepts/security/github_token)).

The action uses `bot/src/ledger.ts` on the target repository's `ledger` branch,
bootstrapping it only when Git confirms the branch is missing. It records each
attempt before advancing payment, rechecks freshly fetched state during push retries,
and records the purchase and delivered state before preparing PRs. Authentication
or ledger write failures stop payment. Unknown payment outcomes halt retries for
manual reconciliation. Ledger Git subprocesses disable repository hooks and do not
inherit wallet credentials.

Assessment identity includes repository, intent, dependency source/name, installed
and target versions, and query hash; a new base SHA alone does not buy again. A
delivered assessment reuses its validated saved purchase, including after publication
failed, without paying again. Findings and target availability are checked again
before preparing or reusing a PR. A publication/answer failure is reported after
processing other candidates; payment, ledger and uncertain-outcome failures stop
further purchases immediately.
Each new assessment records provider, exact configured model, cutoff date/source,
assumed-or-documented status and configuration timestamp in its attempt and purchase
rows. A settled answer with missing hashes is retained and can be reused without
another purchase; the ledger/dashboard flags incomplete evidence for reconciliation.
Each published dependency PR appends a `proposal` row (repo, PR number and URL, package and versions, and the attempt and receipt that paid for it), once per PR. When a generated PR closes, merge accounting appends a `merge` row if it was merged or a `closed` row if it was not; a merge outranks an earlier close, and reruns add nothing. Merge accounting refuses receipts that are missing or do not match settled evidence.

Purchase rows include amount, receipt, selection policy, package/version context,
and `resultStatus: "unchecked"`. A published PR appends a `useful` quality update; invalid findings append `unusable`;
the dashboard displays the latest quality without rewriting payment evidence.
Publication failures do not mark answers unusable. Valid miner `not_found` answers
append `not_found`, emit a notice and create no PR; invalid answers remain `unusable`.
A missing receipt blocks publication until the saved evidence is reconciled. Set `PREFERRED_MINER_ID=7314`
to use the team's npm migration miner. It receives an exact two-version migration
question; its structured response is retained in the purchase and ledger. The
adapter validates package/version identity and source evidence, includes coverage
and security caveats, and refuses introduced vulnerabilities. Python dependencies
skip this npm-only miner before payment; ranked fallback retains the generic
assessment prompt. Preferred miner `0` remains a notice-only setup placeholder.
The existing dashboard displays purchases as assessments
when no PR exists yet. `.github/workflows/merge-accounting.yml` records closed generated PRs, merged or not,
from this repository on any supported target branch, including release branches.
Missing or reformatted evidence fails with a recovery message rather than silently
omitting a merged cost. It checks out the trusted default branch, receives
no wallet key, and verifies the PR evidence and branch identity against an existing
settled receipt before appending an idempotent merge row. The dashboard derives
recorded net spend per merged PR from all settled spending, including unmerged
and `not_found` assessments. Receipt-linked allocation and unmerged/unallocated
spend are displayed separately; duplicate receipts and merge events are not counted twice. No merged costs are claimed until actual merge rows exist.

Live intent/provider compatibility and answer quality must be verified before
enabling payments. No live payment or hosted ledger write was exercised by these
changes. The intent remains `QUESTION_ANSWERING_GENERAL`.

Merge-accounting recovery: restore the evidence in the merged PR body, then rerun
its accounting job or manually dispatch **Record merged dependency PR costs** from
the default branch with `pr-number`. Both paths fetch the current PR body and
validate the receipt against the hosted ledger. No payment wallet is used.
Legacy prose-only miner 7314 purchases remain recorded. Their replacement migration
question has a distinct versioned request identity; outstanding legacy payments
must be reconciled before that request can be bought. New structured answers and
other miners' saved answers continue to be reused.
