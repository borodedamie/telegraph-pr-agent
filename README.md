# Telegraph PR Agent

A GitHub Action that keeps your dependencies up to date when your coding model can't know
what changed. For each dependency released after your model's training cutoff it buys a
sourced answer ("what changed between version A and B?") from a miner on
[Telegraph](https://anjoman.ai/docs/introduction), then opens a PR with the breaking changes,
their migration steps and the lines in your repository that use them. Every purchase is
recorded with its receipt, and the dashboard shows the spend and the **cost per merged PR**.

- **Dashboard:** https://telegraph-pr-agent.vercel.app
- **Install:** [5 minutes](#install-in-your-repository-5-minutes), testnet only
- Built for the Telegraph Hackathon Season II, mission [Model Economy](https://hackathon.telegraphprotocol.com/missions/model-economy)

> **Testnet prototype.** Payments are Ethereum Sepolia test USDC, which is not revenue. Most
> purchases come from the team's own installations, and the miner bought from (7314) is also the
> team's, so those are related-party tests. Two paid bot PRs have been merged, both in team
> repositories (cost per merged PR 0.83 USDC, n=2). Two outside installations exist:
> `shadrxcc/porncrit-fe` (22 purchases, 13 open PRs; independence not yet confirmed) and
> `linda-ochem/temp` (no purchase yet). Figures: [evidence index](#evidence-index-every-repository-running-the-bot).

## Demo

<video src="docs/demo.mp4" controls muted loop playsinline width="100%"></video>

## How it works

| Stage | What happens | State |
| --- | --- | --- |
| Scan | On a push that changes dependency files, or a manual run, read installed versions from the lockfile (npm, pnpm, Yarn, Bun) or exact Python pins, and find newer stable releases on npm/PyPI | works |
| Learn | For each release after `MODEL_CUTOFF`, buy one `QUESTION_ANSWERING_GENERAL` answer, from miner 7314 first, then ranked miners | works with per-call `exact` payment (live, 8 and 11 Nov 2026); escrow payment, needed since 20 Nov 2026, is covered by offline tests and its first hosted run is pending |
| Report | Open one PR per package and target version (never duplicated), listing what changed and where the repository uses it. Releases on or before the cutoff get a free PR with links, no purchase | works |
| Account | Record every attempt, purchase, PR proposal, merge and close on the repository's `ledger` branch; the dashboard computes cost per merged PR | works; no paid PR merged yet |
| Fix | After a maintainer adds `telegraph:fix`, generate the migration patch and run the repository's tests in a job without secrets | planned |

A human reviews and merges; the bot never merges. The bot uses no LLM: its knowledge comes from
Telegraph miners ([SPEC §2](docs/SPEC.md)).

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
| `TELEGRAPH_EVM_PRIVATE_KEY` | Private key of a dedicated, low-balance wallet holding Sepolia test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`, chain `11155111`) and a little Sepolia ETH for the deposit below. Each answer costs about 0.02 USDC. |

**3b. Deposit test USDC into Telegraph escrow (one time).** Since 20 Nov 2026 Telegraph takes
payment on Sepolia only from a pre-funded escrow balance, so the wallet above needs a deposit
before the first purchase. Without one, every call is refused and nothing is charged. Two
transactions from that wallet: approve the escrow contract to take the USDC, then deposit it.
For example 0.20 USDC (`200000`, 6 decimals; about 10 answers) with Foundry's `cast`:

```sh
cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "approve(address,uint256)" \
  0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b 200000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$TELEGRAPH_EVM_PRIVATE_KEY"
cast send 0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b "depositUSDC(uint256)" 200000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$TELEGRAPH_EVM_PRIVATE_KEY"
```

Check the balance at `https://devnode.telegraphprotocol.com/v1/ledger/account/<wallet address>`
(`available`). Telegraph's guide, including withdrawal:
[escrow inference](https://anjoman.ai/docs/using/escrow-inference).

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

**5. Two workflow files.** Copy both. They reference this Action by its major tag,
`borodedamie/telegraph-pr-agent@v1`, which follows the latest v1.x release.

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
it buys one answer per package and opens one PR per update. Before buying, it checks that the package manager can install the target next to your current dependencies; an upgrade it refuses (for example `react-dom` 19 while `react` is still 18) is skipped with npm's reason and nothing is bought. Upgrade the package it depends on first, and the next run picks it up. PRs open ready for review (add
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
repository's `ledger` branch: every purchase with its receipt and signal (and its transaction for per-call `exact` payments; escrow purchases settle per Telegraph epoch and have no transaction of their own), and
cost per merged PR once a dependency PR has merged. You don't need to build the URL: each
run that buys prints it on the run page, and every dependency PR ends with it.

Limits by default: 0.10 USDC per call and 2 USDC per run (`max-price-per-call-usdc`,
`budget-cap-usdc` inputs). A payment stuck mid-flight blocks a repeat purchase for that
package until it is reconciled with [reconcile-attempt.yml](.github/workflows/reconcile-attempt.yml) (copy it
and change `uses: ./` to `uses: borodedamie/telegraph-pr-agent@v1`).

Configuration details, ledger behaviour, supported lockfiles and their limits: [docs/ACTION.md](docs/ACTION.md).

## Status

Status is a snapshot, not a promise.

| Item | Value |
| --- | --- |
| Escrow payment in the Action | #52, merged 20 Nov 2026: pays from Telegraph escrow when the node offers no `exact` payment. `@v1` serves it once the `v1` tag is moved to release v1.2.0. Covered by offline tests; the first hosted escrow run is pending |
| Escrow payment, live | 20 Nov 2026: a paid escrow call to miner 7314 from a script with the same signing as the Action returned HTTP 200 and was recorded by Telegraph in epoch 18 |
| Last live purchase with a transaction (this repository) | 11 Nov 2026, from the Action: 0.02 USDC to the team's own miner 7314 (`our_choice`) for `@renovatebot/pep440` 4.2.4 → 6.0.0 ([tx](https://sepolia.etherscan.io/tx/0xa3c9d78b8183f499959a2c4ed138c7e358ffdefb0a97527d6c32ffef1955e954)). The answer was marked useful and opened draft PR #27, closed without merging to test merge accounting |
| Last live contract check (no payment) | 14 Nov 2026, unsigned and unpaid catalogue and quote check: [preflight snapshot](docs/telegraph/four-package-tests-preflight-2026-11-14.json) |
| Purchases in other installations | see each repository's dashboard in the [evidence index](#evidence-index-every-repository-running-the-bot) |
| Package-release miner | Miner 7314 (`package-release-intel`, `QUESTION_ANSWERING_GENERAL`, 0.02 USDC), at `https://telegraph-pr-miner-n30sk.vercel.app`, registered since 6 Nov 2026. Engine routing sends this kind of question to another intent (`WEB_SEARCH_GENERAL`), so buyers ask it by id. Answers what changed in an npm package between two versions, each change with a verbatim quote and its source. Benchmark: 82.6% of reviewed breaking changes with an LLM judge (67.1% by word matching), every quote checked. Details: [miner/README.md](miner/README.md) |
| Not done yet | the `telegraph:fix` stage; a merged paid PR; an installation outside the team; a public fixture repository for reviewers ([TEAM.md](docs/TEAM.md)) |

## For reviewers and the hackathon submission

To be filled in as each item exists; nothing below is claimed yet.

| Item | Status |
| --- | --- |
| Tested commit and public repository | this repository; CI (`test.yml`) runs the offline tests and checks the Action bundle on every push and PR, so any commit on `main` has a test run in the Actions tab |
| Public dashboard URL | https://telegraph-pr-agent.vercel.app: all known installations, team and outside totals split (`?repo=owner/name` for one repository) |
| Testnet and token in use | from the live 402 challenge; Ethereum Sepolia test USDC as of 2 Nov 2026 |
| One command for a new realistic input | planned: the Action on a public fixture repository ([TEAM.md](docs/TEAM.md)) |
| No-post-cutoff, no-spend case | planned on the fixture repository; offline test: no purchase or PR when no dependency is past the cutoff |
| Failing typecheck, no push case | planned with the `telegraph:fix` stage |
| Event-period receipts, signal links, transactions, ledger export | Across all installations: see the [evidence index](#evidence-index-every-repository-running-the-bot) below. For this repository alone, the dashboard's **Download evidence CSV** plus the raw `ledger.jsonl`. As of 19 Nov 2026: 4 purchases (0.06 USDC): two CLI test buys from third-party miners (3 and 4 Nov, answers not useful) and two Action assessments from the team's own miner 7314 (8 and 11 Nov, `our_choice`, self-purchases, not independent adoption) |
| 2–5 minute demo | [demo.mp4](docs/demo.mp4) |
| Five-question commercial summary | not written |
| Public updates (at least three, separate dates) | none yet |
| Technical tutorial and independent reproduction evidence | none yet |

### Evidence index: every repository running the bot

Each installation keeps its own public ledger on its `ledger` branch, so evidence is spread across repositories. This index lists every installation we know of. Each repository is labelled **team** (owned by a team member, so related-party) or **outside**, and totals are split by that label. Figures cover the event window (1 Nov – 1 Dec 2026), as of 22 Nov 2026 11:45 UTC. Each purchase's receipt, Telegraph signal and, for per-call `exact` payments, on-chain transaction are linked from that repository's dashboard and its **Download evidence CSV**.

| Repository | Owner | Evidence | Purchases (spend) | Paid PRs: merged / closed / open | Free PRs (merged) | Cost per merged PR |
| --- | --- | --- | --- | --- | --- | --- |
| [`borodedamie/telegraph-pr-agent`](https://github.com/borodedamie/telegraph-pr-agent) | team | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=borodedamie/telegraph-pr-agent) · [ledger](https://raw.githubusercontent.com/borodedamie/telegraph-pr-agent/ledger/ledger.jsonl) | 4 (0.06 USDC) | 0 / 2 / 0 | 0 | N/A |
| [`borodedamie/grpc-tutorial`](https://github.com/borodedamie/grpc-tutorial) | team | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=borodedamie/grpc-tutorial) · [ledger](https://raw.githubusercontent.com/borodedamie/grpc-tutorial/ledger/ledger.jsonl) | 5 (0.10 USDC) | 0 / 4 / 0 | 3 (2) | N/A¹ |
| [`lemind/onewallet-radar`](https://github.com/lemind/onewallet-radar) | team | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=lemind/onewallet-radar) · [ledger](https://raw.githubusercontent.com/lemind/onewallet-radar/ledger/ledger.jsonl) | 9 (0.17 USDC) | 1 / 2 / 2 | 0 | 0.17 USDC (n=1) |
| [`borodedamie/code-generator`](https://github.com/borodedamie/code-generator) | team | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=borodedamie/code-generator) · [ledger](https://raw.githubusercontent.com/borodedamie/code-generator/ledger/ledger.jsonl) | 5 (0.09 USDC) | 1 / 0 / 3 | 0 | 0.09 USDC (n=1) |
| [`codexempire/chat_space_app`](https://github.com/codexempire/chat_space_app) | team | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=codexempire/chat_space_app) · [ledger](https://raw.githubusercontent.com/codexempire/chat_space_app/ledger/ledger.jsonl) | 6 (0.11 USDC) | 0 / 0 / 5 | 1 (0) | N/A |
| [`codexempire/flight-check`](https://github.com/codexempire/flight-check) | team | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=codexempire/flight-check) · [ledger](https://raw.githubusercontent.com/codexempire/flight-check/ledger/ledger.jsonl) | 6 (0.12 USDC) | 0 / 0 / 6 | 3 (0) | N/A |
| [`codexempire/web-crawler`](https://github.com/codexempire/web-crawler) | team | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=codexempire/web-crawler) · [ledger](https://raw.githubusercontent.com/codexempire/web-crawler/ledger/ledger.jsonl) | 30 (0.57 USDC) | 0 / 0 / 7 | 11 (0) | N/A |
| [`codexempire/crypto-giant`](https://github.com/codexempire/crypto-giant) | team | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=codexempire/crypto-giant) · [ledger](https://raw.githubusercontent.com/codexempire/crypto-giant/ledger/ledger.jsonl) | 23 (0.43 USDC) | 0 / 0 / 0 | 0 | N/A |
| [`linda-ochem/temp`](https://github.com/linda-ochem/temp) | outside | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=linda-ochem/temp) · [ledger](https://raw.githubusercontent.com/linda-ochem/temp/ledger/ledger.jsonl) | 0² | 0 / 0 / 0 | 0 | N/A |
| [`shadrxcc/porncrit-fe`](https://github.com/shadrxcc/porncrit-fe) | outside | [dashboard](https://telegraph-pr-agent.vercel.app/?repo=shadrxcc/porncrit-fe) · [ledger](https://raw.githubusercontent.com/shadrxcc/porncrit-fe/ledger/ledger.jsonl) | 22 (0.44 USDC)³ | 0 / 0 / 13 | 5 (0) | N/A |
| **Team total** | | | **88 (1.65 USDC)** | **2 / 8 / 23** | **18 (2)** | **0.83 USDC (n=2)** |
| **Outside total** | | | **22 (0.44 USDC)** | **0 / 0 / 13** | **5 (0)** | **N/A: no outside PR merged yet** |

¹ grpc-tutorial's PR #3 merged into `test/readable-changes`, a test branch, not the default branch. Its merge row was written before merge accounting checked the branch, so it carries no base reference. It is counted as closed, not merged, and never enters cost per merged PR.

² `linda-ochem/temp` is owned outside the team. It ran the bot three times on 20 Nov (10:25–13:29 UTC), before the escrow fallback (#52) reached `@v1`. Every attempt stopped before payment, because Telegraph's devnode no longer offered `exact` payment on Ethereum Sepolia (see the [21 Nov payment-options snapshot](docs/telegraph/payment-options-2026-11-21.json)). A new run needs the one-time escrow deposit in step 3b. No purchase was made, and nothing is claimed as adoption.

³ `shadrxcc/porncrit-fe` is owned outside the team. One manual run on 22 Nov 2026 (11:24–11:31 UTC) bought 22 answers from miner 7314, the team's own miner (escrow, epoch 37), and opened 13 paid and 5 free PRs. Not yet confirmed: who controls the paying wallet (Telegraph's billing record for epoch 37 was not yet published at 11:45 UTC) and how the owner found the bot. Until both are confirmed it is not claimed as independent adoption.

How the list is kept: every Monday until 1 Dec, the **Find installs of the Action** workflow (`.github/workflows/find-installs.yml`) runs `scripts/find-installs.mjs`. The script uses a GitHub code search for `borodedamie/telegraph-pr-agent@` in workflow files and the repository's dependents page, then posts each repository's team or outside label, whether it has a ledger, and anything new to the issue "Installs of the Action". It can also be run by hand. The search index lags: on 21 Nov it found `borodedamie/gRPC-tutorial` and `linda-ochem/temp` but missed `lemind/onewallet-radar` and `borodedamie/code-generator`, which also use `@v1`. A repository that runs the bot without appearing here can open an issue to be added.

If you try the Action, open an issue with what you ran, the signal hash and whether the answer was useful. That is the kind of independent test the project needs.

## Disclosure

- The same team controls the agent and the package-release miner (payout wallet `0x74f2840C8A564F791f50aD76c38EF078258588dC`). Any agent purchase from that miner is related-party testing, not independent demand, adoption or third-party validation.
- Cutoff provenance on old rows (note added 19 Nov 2026): the Action purchases of 8 and 11 Nov 2026 record `MODEL_PROVIDER=telegraph` and `MODEL_ID=7314`. Those values named the miner, not a coding model; the cutoff (2026-01-01, team-assumed) belongs to the installer's coding model. The rows are left as written. From 19 Nov 2026 (#46) the Action rejects Telegraph or a miner id in these fields.
- Buyer wallets (both team-controlled): [`0x85Bb8c5Db7505a348af0C2aC03819827d4e435C8`](https://sepolia.etherscan.io/address/0x85Bb8c5Db7505a348af0C2aC03819827d4e435C8) paid on 3, 4 and 11 Nov 2026, and [`0x30A33F953a9bCc9Aff927caC815984ab2Eab305f`](https://sepolia.etherscan.io/address/0x30A33F953a9bCc9Aff927caC815984ab2Eab305f) paid on 8 Nov 2026. Payments go to Telegraph's payment contract [`0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b`](https://sepolia.etherscan.io/address/0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b), not directly to a miner. Purchases from miner 7314 by these wallets are related-party. Keys are never published.
- Code written before 1 Nov 2026: the CLI vertical slice (commit `9faf16a` and earlier; removed on 11 Nov 2026). Work added during the event will be summarised here.
- Event window: purchases, transactions, usage, demos and adoption evidence claimed for Season II fall between 1 Nov and 1 Dec 2026. Package release notes and registry records keep their original dates, including dates before the event.
- Reused open source, with licences read from each package on 19 Nov 2026. Runtime: `@x402/fetch`, `@x402/evm`, `@renovatebot/pep440` (Apache-2.0); `@actions/core`, `viem`, `zod`, `jsonc-parser`, `@upstash/redis` (MIT); `@yarnpkg/parsers` (BSD-2-Clause); `semver` (ISC). Development only: `typescript`, `@vercel/node` (Apache-2.0); `vitest`, `vite`, `esbuild`, `tsx`, `@types/node`, `@types/semver` (MIT).
- Pre-event integration test: on 28 Oct 2026 the since-removed CLI prototype paid 0.01 testnet USDC to Crossref QA and recorded the tx, receipt and signal hashes. The answer was unrelated to the package. It shows the payment flow was exercised and is not event-period evidence.

## Limitations

- Package-release answer quality has not been demonstrated by existing providers.
- The team's package-release miner is registered and scored, but the intent's test questions are mostly general, so its rank moves with the pool (6 of 17 on 9 Nov, 11 of 17 on 8 Nov).
- The `telegraph:fix` label stage is planned: patch generation, install/typecheck/tests in a job without secrets, and pushing only a validated patch. The Action, draft PRs and merge accounting exist.
- `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` are conditional on providers passing quality tests.
- Public repositories only. Testnet only; no revenue or adoption claim.

## Development

Specification (source of truth): [docs/SPEC.md](docs/SPEC.md). Milestones:
[docs/HACKATHON-PLAN.md](docs/HACKATHON-PLAN.md). Who does what: [docs/TEAM.md](docs/TEAM.md).
How the Action works in detail: [docs/ACTION.md](docs/ACTION.md). Live QA intent contract:
[docs/telegraph/qa-intent-contract-2026-11-02.md](docs/telegraph/qa-intent-contract-2026-11-02.md).

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

Offline checks (no network, no payment), from the repository root:

```bash
npm ci --prefix bot --ignore-scripts
npm test --prefix bot
npm install --prefix web --ignore-scripts
npm test --prefix web
npm run dev --prefix web    # dashboard; add ?repo=owner/name for another public repository
```

After editing bot source (or `miner/src`, which the Action bundles), run
`npm run build --prefix bot` and commit the updated `bot/dist/index.cjs`; CI fails when the
committed bundle differs from a fresh build.
