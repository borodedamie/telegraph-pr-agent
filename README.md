# Telegraph PR Agent

A testnet prototype of a dependency-migration agent that is designed to buy release intelligence through [Telegraph](https://anjoman.ai/docs/introduction) instead of guessing. The current CLI demonstrates dependency-change detection and one historical Telegraph x402 purchase; it has not yet demonstrated a useful package-release answer, a completed migration PR or cost per merged PR. The GitHub Action, migration PR and cost-per-merged-PR workflow are in development.

Built for the Telegraph Hackathon Season II, mission [Model Economy](https://hackathon.telegraphprotocol.com/missions/model-economy). Specification (source of truth): [docs/SPEC.md](docs/SPEC.md). Milestones: [docs/HACKATHON-PLAN.md](docs/HACKATHON-PLAN.md). Who does what: [docs/TEAM.md](docs/TEAM.md). Live QA intent contract: [docs/telegraph/qa-intent-contract-2026-11-02.md](docs/telegraph/qa-intent-contract-2026-11-02.md).

> **Testnet prototype.** The current CLI completed one Telegraph x402 purchase on the devnode on 28 Oct 2026; the answer was unrelated to the package. The project has not yet demonstrated a useful package-release answer, a complete package migration or production customer usage. Testnet USDC is not revenue.

## Status

Status is a snapshot, not a promise.

| Item | Value |
| --- | --- |
| Documentation revision | 2 Nov 2026 review update on top of `831b1ce` |
| Last implementation snapshot whose unit tests were run | `9faf16a`, 2026-11-02 04:52 UTC |
| Last successful live Telegraph purchase | 28 Oct 2026, pre-event, old client against the node interface of that date; answer not useful |
| Last live contract check (no payment) | 2 Nov 2026, see [the contract snapshot](docs/telegraph/qa-intent-contract-2026-11-02.md) |
| Event-period evidence (1 Nov to 1 Dec 2026) | None yet |

| Part | State |
| --- | --- |
| Detect a dependency upgrade released after the cutoff | The action resolves supported installed versions and selects newer stable npm/PyPI releases strictly after `MODEL_CUTOFF`, reusing `bot/src/trigger.ts` for npm date checks. Covered by offline tests; hosted operation remains unverified. |
| Buy an answer on Telegraph with x402; record receipt hash, signal hash, tx hash | Historical integration test only: one pre-event payment succeeded on 28 Oct 2026; the returned content was unrelated to package releases. The current client is not compatible with the 2 Nov live intent contract until it sends the canonical intent id and request shape and is retested. |
| Append-only purchase ledger on a `ledger` git branch | Shared attempts and per-receipt records are wired into the action. Pre-PR assessments use dependency/version/query identity across commits; the slice retains its PR/commit keys. Failure and concurrency behavior is covered by offline tests; hosted writes remain unverified. |
| Purchase dashboard | Works locally: `pnpm install`, then `pnpm --filter @telegraph-pr-agent/web dev`; it reads `ledger.jsonl` from GitHub raw for a public repository. Not deployed to a public URL yet. Shows purchases, cost per merged PR (all-time and for the 1 Nov – 1 Dec event window), PRs proposed, merged, closed and open with the merge rate and sample size, closed-PR spend, cost per useful answer, and escrow credits and refused quotes as non-spend. Add `?repo=owner/name` to view another public repository's ledger. Hosted merge capture remains unverified. |
| GitHub Action, draft dependency PRs, migration and merge accounting | Packaged action with cutoff gating, attempt ledger and draft dependency PR preparation; validated locally. `telegraph:fix` and migration execution remain planned. Receipt-linked merge accounting is implemented and tested offline. |
| Package-release Q&A miner | Working, in production at `https://telegraph-pr-miner-n30sk.vercel.app` and registered on Telegraph since 6 Nov as miner 7314 (`package-release-intel`, `QUESTION_ANSWERING_GENERAL`, 0.02 USDC). It answers what changed in an npm package between two versions from npm, GitHub release material, migration guides and OSV, each change with a verbatim quote and its source. A paid direct call through Telegraph was served and settled on 6 Nov; Engine routing sent the same kind of question to another intent (`WEB_SEARCH_GENERAL`), so buyers ask it by id. Benchmark: 67.1% of reviewed breaking changes by word matching, 82.6% with an LLM judge (target 80%), every quote checked. Scored by the intent's general-purpose judge: rank 6 of 17 on 9 Nov (11 of 17 on 8 Nov), measured with our own 30 questions in the pool (1 of 6 contributors), so it is not independent evidence of quality; the benchmark is the quality evidence. Details: [miner/README.md](miner/README.md). |

**About the one purchase so far.** On 28 Oct 2026 the CLI paid 0.01 testnet USDC through the devnode to Crossref QA, which was third in the provider list the old client read for question answering on that date (the client's ordering, not a saved Telegraph ranking snapshot), and recorded the tx hash, receipt hash and signal hash. The returned answer was academic search results unrelated to the package. That run is a pre-event integration test: it shows the payment flow was exercised. It is not event-period hackathon evidence and not a successful package-release answer. It also used the node interface as it stood on that date; the request shape and intent ids have to be rechecked against the live node before any new run.

## How it will work

Each stage is marked current or planned.

1. **Scan** (planned): on a schedule the developer sets in the workflow (the example uses weekly) or a manual run, read the installed version A of each direct dependency from `package-lock.json`, look up the latest stable version B on npm, and query OSV for known advisories in A. Current slice: compares two `package.json` files only.
2. **Learn** (current, partly): when B is newer than A *and* B was released after the configured cutoff, buy one question-answering request on Telegraph on the live canonical intent (`QUESTION_ANSWERING_GENERAL` on 2 Nov). The current client calls a chosen miner directly; whether the Action uses Engine routing instead is still open ([SPEC §2.4](docs/SPEC.md)). The quote comes from the 402 challenge and can vary; 0.01 USDC is an observed example, not a price.
3. **Report** (planned): open one draft PR per package and target version, updated on later runs, never duplicated. It lists why to upgrade, known advisories, which changed symbols the repository uses (found by a local search, not by the miner), what to change, spend so far and an estimated fix cost. If the answer is `not_found`, the purchase and receipt are kept, the PR is report-only, and no migration is invented.
4. **Fix** (planned, after a maintainer with write access adds `telegraph:fix`): generate a patch with the purchased answer as input. Paid `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` calls are conditional on a provider passing our quality tests; until then the installer's own LLM writes the patch. The repository's install, typecheck and tests run in a job with no secrets. Nothing is pushed unless they pass.
5. **Merge** (planned): a human reviews and merges. The bot never merges.
6. **Account** (planned): cost per merged bot PR = all net automation spend (Telegraph, LLM, closed and unmerged proposals) divided by merged bot PRs, shown with the proposal and merge counts; `N/A` when nothing has merged.

## What runs today

`bot/src/slice.ts` takes a base `package.json`, a head `package.json`, a PR number and a commit SHA. It:

- diffs declared dependencies (`dependencies` and `devDependencies`), resolves each changed range to its bare version, and asks the npm registry for that version's release date;
- picks the first dependency released after `MODEL_CUTOFF` (one purchase per run);
- lists providers for the intent, keeps only those with a Telegraph score for that intent, sorts them by rank and pays the top one through `POST /engine/v1/ask/{minerId}` with the provider's native request, stepping down to the next (up to 3) on a failed call. This is the application's choice, not Engine routing. It records the answer plus tx, receipt and signal hashes;
- appends one ledger row and pushes it to the `ledger` branch, after the answer has been received.

Known gaps in this slice, kept here so nobody mistakes them for features:

- The intent id `QUESTION_ANSWERING_GENERAL` is hardcoded; it was checked against `GET /engine/v1/intents` on 3 Nov 2026 and must be rechecked if the catalogue changes.
- Each payment try is recorded on the ledger branch at every stage (`reserved`, then `quote_refused` or `request_sent`, then `delivered`, `failed_and_credited`, `failed_not_charged` or `unknown_needs_reconciliation`; definitions in [SPEC §2.6](docs/SPEC.md)) before the bot moves on. If a run dies or its push fails after `request_sent`, the next run for that PR and commit stops instead of paying again, and a person checks the wallet, escrow balance and signal. Before recording `reserved` and `request_sent`, the run re-checks the freshly fetched ledger, and a push loses if another run pushed first, so two runs for the same PR and commit can't both pay; the second stops. Nothing yet marks a stuck attempt as reconciled; that is done by hand on the ledger branch.
- A purchase is recorded once per `receipt_hash`; writing a receipt that is already on the ledger is refused. Each purchase row has a `resultStatus` for answer quality, kept apart from payment: new rows start `unchecked`, and `useful`, `unusable` or `not_found` can be recorded separately. The dependency action automatically appends `useful` when an answer produces a published PR and `unusable` for invalid findings; the dashboard uses the latest quality update.
- Each purchase row stores the network, chain id, USDC contract and explorer URL of the 402 option it paid, and transaction links are built from that. Rows written before 5 Nov 2026 lack these fields; their links use the date (before 1 Nov: Basescan, Base Sepolia; after: Etherscan, Ethereum Sepolia). The memo's summary line still names Ethereum Sepolia as fixed text.

## Repository layout

```
bot/                TypeScript agent, Node 22.20+, vitest
  src/config.ts       env validation
  src/trigger.ts      post-cutoff detection from two package.json files
  src/x402.ts         Telegraph client: provider list, x402 payment, receipt capture
  src/ledger.ts       ledger.jsonl on the `ledger` branch, push retry
  src/memo.ts         PR comment text (not posted by the slice)
  src/slice.ts        CLI runner
  test/               43 unit tests; no network, no payments
  .env.example        configuration template (see Configuration for known stale values)
web/                static purchase dashboard (Vite); reads ledger.jsonl from GitHub raw
docs/               plan, specification, team split, ADRs
CONTEXT.md          glossary used during design; reviewers can skip it
```

No workflow YAML, fixtures or sample ledger export exist yet; the `examples/` files below are created by hand.

## Run the current slice

Prerequisites: Node 22.20 or later, pnpm 9 or later, macOS or Linux shell, a dedicated testnet wallet holding a few cents of test USDC on the network the devnode quotes (Ethereum Sepolia as of 2 Nov 2026; the 402 challenge is authoritative), and a fine-grained GitHub token limited to a public repository you control (`DEMO_REPO`) with `contents: read/write`, so the run can push its ledger branch. Gas is handled by the x402 facilitator; the wallet needs test USDC only.

All commands run from the repository root, in one shell.

**1. Offline: install and unit tests (no network, no payment).**

```bash
pnpm install
cp bot/.env.example bot/.env     # then edit; see Configuration for values to correct
pnpm --filter ./bot test
```

**2. Create the input files.** These pin `zod` before the cutoff (3.23.8, May 2024), after it (4.6.7, 12 Oct 2026), and a pre-cutoff bump (3.24.1, Dec 2024), assuming `MODEL_CUTOFF=January 1, 2026`:

```bash
mkdir -p examples
printf '{"name":"fixture-app","version":"1.0.0","dependencies":{"zod":"%s"}}\n' 3.23.8 > examples/base-package.json
printf '{"name":"fixture-app","version":"1.0.0","dependencies":{"zod":"%s"}}\n' 4.6.7  > examples/head-package.json
printf '{"name":"fixture-app","version":"1.0.0","dependencies":{"zod":"%s"}}\n' 3.24.1 > examples/head-pre-cutoff-package.json
```

**3. Paid testnet run.** Not runnable against the live node until the client is updated (see Known gaps). The PR number and SHA are placeholders that label the ledger row; they need not exist.

```bash
pnpm --filter ./bot exec tsx --env-file=.env src/slice.ts \
  ../examples/base-package.json \
  ../examples/head-package.json \
  1 \
  0123456789abcdef0123456789abcdef01234567
```

This command spends testnet USDC and pushes to the ledger branch of `DEMO_REPO`. Until fixtures and the updated client are committed, this is not a one-command reviewer reproduction.

Expected output, post-cutoff case with the fixtures above (the purchase line is the shape of the 28 Oct run, values redacted; the intent id, provider and rank field will differ once the client is updated to the live catalogue, and on 2 Nov no QA rank existed):

```
triggers: [{ package: "zod", version: "4.6.7", releaseDate: "2026-10-12T16:29:37.778Z", status: "past-cutoff" }]
purchase: { intent: "QUESTION_ANSWERING_GENERAL", minerId: "…", minerName: "…", minerRank: 3,
            amountUsdc: 0.01, txHash: "0x…", receiptHash: "0x…", signalHash: "0x…",
            answer: "…", status: "settled" }
ledger row committed: PR #1 QUESTION_ANSWERING_GENERAL 0x…
```

No-spend case: run the same command with `../examples/head-pre-cutoff-package.json` as the head file. The run prints that there is no post-cutoff candidate and exits with zero spend, without any Telegraph request.

## Verify a purchase

Open `https://devnode.telegraphprotocol.com/engine/v1/signal/<signalHash>` to inspect the request and response Telegraph recorded, and the tx hash on the explorer for the chain named in the quote. The signal and receipt show what was bought and returned; they do not by themselves show the answer is factually correct. Package-release claims have to be checked against their linked registry and release-note sources, and migration correctness by the repository's tests.

## Configuration

Variables read by the current slice:

| Variable | Meaning |
| --- | --- |
| `NODE_URL` | Base node URL, e.g. `https://devnode.telegraphprotocol.com`; the client appends `/engine/v1/…` and `/api/…` |
| `CHAIN_ID`, `USDC_ADDRESS` | Local allowlist: the network and token the client will pay on. The 402 challenge decides what is offered; a quote outside this allowlist must be refused |
| `MODEL_CUTOFF` | The cutoff date used as a heuristic for "the model may not know this release". Record in your notes which model and source the date comes from; the slice does not store that yet |
| `MAX_PRICE_PER_CALL_USDC` | Refuse any single quote above this, checked against the quoted amount |
| `BUDGET_CAP_USDC` | Ceiling for one CLI invocation, enforced in the application |
| `TELEGRAPH_EVM_PRIVATE_KEY` | The paying wallet. Dedicated, low balance, never committed, never printed, never exposed to repository code |
| `GH_PAT`, `DEMO_REPO` | Token and `owner/repo` for pushing the ledger branch |
| `PREFERRED_MINER_ID` | Optional. A miner id to try before the leaderboard, even if it is not ranked yet; on a failed call the client steps down to the ranked miners. Its purchases are recorded with `selectedBy: "our_choice"`, ranked ones with `"rank"` (SPEC §2.4). If the node has not ranked it, `minerRank` and `minerScore` are `null`. Unset or empty: rank only |
| `LLM_API_KEY`, `LLM_BASE_URL` | Required by config validation today but unused by the slice. Known defect: they are to be removed from validation until patch generation exists. Until then the template's placeholder values pass; never put a real key here for the slice |

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

- npm only; `package.json` comparison only; no lockfile parsing. The CLI is a manifest-diff prototype; the planned Action scans the lockfile instead.
- One Q&A purchase per CLI run; the first eligible dependency only.
- Package-release answer quality has not been demonstrated by existing providers.
- The team's package-release miner is registered and scored, but the intent's test questions are mostly general, so its rank moves with the pool (6 of 17 on 9 Nov, 11 of 17 on 8 Nov).
- GitHub Action, draft PR, label approval, patch generation, secretless CI and merge accounting are planned.
- `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` are conditional on providers passing quality tests.
- The dashboard is not deployed publicly.
- Public repositories only. Testnet only; no revenue or adoption claim.

## Disclosure

- The same team controls the agent and the package-release miner (payout wallet `0x74f2840C8A564F791f50aD76c38EF078258588dC`). Any agent purchase from that miner is related-party testing, not independent demand, adoption or third-party validation.
- Buyer wallet and miner wallet addresses, with explorer links, will be listed here before submission. Keys are never published.
- Code written before 1 Nov 2026: the CLI vertical slice described above (commit `9faf16a` and earlier). Work added during the event will be summarised here.
- Event window: purchases, transactions, usage, demos and adoption evidence claimed for Season II fall between 1 Nov and 1 Dec 2026. Package release notes and registry records keep their original dates, including dates before the event.
- Reused open source: `@x402/fetch` and `@x402/evm` (Apache-2.0), `viem` (MIT), `zod` (MIT), `vitest` (MIT), `vite` (MIT). Confirm each licence from the package before submission.

## For reviewers and the hackathon submission

To be filled in as each item exists; nothing below is claimed yet.

| Item | Status |
| --- | --- |
| Tested commit and public repository | this repository, commit listed under Status |
| Public dashboard URL | not deployed |
| Testnet and token in use | from the live 402 challenge; Ethereum Sepolia test USDC as of 2 Nov 2026 |
| One command for a new realistic input | the slice command above, once fixtures and the updated client are committed |
| No-post-cutoff, no-spend case | the slice command with `examples/head-pre-cutoff-package.json` |
| Failing typecheck, no push case | planned with the Action |
| Event-period receipts, signal links, transactions, ledger export | none yet |
| 2–5 minute demo | not recorded |
| Five-question commercial summary | not written |
| Public updates (at least three, separate dates) | none yet |
| Technical tutorial and independent reproduction evidence | none yet |

If you try the slice, open an issue with what you ran, the signal hash and whether the answer was useful. That is the kind of independent test the project needs.

## Dependency update Action

The workflow in `.github/workflows/dependency-updates.yml` runs automatically only
on pushes to `main` that change `**/package.json`, `**/package-lock.json`,
`**/requirements*.txt`, or `requirements/**`. Manual dispatch remains available
for a selected branch. Branch-deletion events do not run it. One action invocation scans dependencies, purchases an assessment,
prepares updates, and opens draft PRs; no stage inputs, intermediate artifact files,
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
        uses: ./bot/actions
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
The packaged `bot/actions/dist/index.js` is included so callers need no install or
build steps. For another repository, use `OWNER/REPO/bot/actions@IMMUTABLE_SHA` after
publishing a commit containing the bundle, rather than the local `./bot/actions` path.

Before purchasing, the action selects newer stable npm/PyPI releases with verified
release dates strictly after `MODEL_CUTOFF`. No candidate means no purchase or PR. Registry failures are reported per dependency
without discarding other verified candidates; the run reports failure afterward
so an outage is not mistaken for a clean no-upgrade result.
The miner receives one dependency and its verified target per assessment. Findings must
identify a scanned ecosystem, package, source and current version, a newer target,
`cve` or `outdated`, a reason and HTTPS evidence sources. CVE findings require CVE IDs.
Invalid/prose answers fail; no findings means no updates or PRs.

Recommended targets are checked against npm/PyPI. Existing dependency files are
updated on `fix/telegraph-dependency-*` branches, with a draft PR per finding back
to the checked-out branch. Standalone public npm projects get a regenerated
package-lock v2/v3 alongside package.json. Plain Python pins retain extras, markers
and comments. Matching PRs are reused, and existing branches are never force-updated.
No assessment or prepared-update files are added to the repository.

All orchestration now runs in one job with wallet and GitHub credentials. It never
executes repository scripts or tests. npm lock generation runs in a temporary
directory with `--package-lock-only --ignore-scripts`, a minimal environment without
inherited wallet/GitHub credentials, and no repository npm configuration. Human
review and merge remain required; this does not provide separate-runner isolation.

`bot/actions/src/scan.ts` detects the repository from the current working directory
using Git; no workspace environment variable is required. It reads npm dependencies
and devDependencies from standalone npm package-lock v2/v3 entries, and
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
- Configure `MODEL_PROVIDER`, `MODEL_ID`, `MODEL_CUTOFF_SOURCE_URL` (HTTPS), and
  `MODEL_CUTOFF_STATUS` (`provider-documented` or `team-assumed`) for provenance.
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
- Public settings default in `bot/actions/action.yml`: `node-url` is
  `https://devnode.telegraphprotocol.com`, `max-price-per-call-usdc` is `0.10`,
  and `budget-cap-usdc` is `2`. Optional
  `with:` inputs can override these defaults. These are spending limits, not live prices.
- Supply secret `TELEGRAPH_EVM_PRIVATE_KEY` for a dedicated wallet. Private keys
  are not bundled as action defaults.
- Allow GitHub Actions to create pull requests in repository settings and grant the
  job `contents: write` and `pull-requests: write`.
- Run **Telegraph dependency updates** on the branch you want to update. A named
  branch must be checked out; detached HEAD is rejected instead of guessing a target.
- After editing action source, run `npm run build:prod` in
  `bot/actions` and include its updated distribution bundle in the same change.
  Building requires the existing action and shared bot dependencies; callers do not.

The action has no stage or artifact inputs. Public node/spending settings have
action-defined defaults; the wallet remains a secret. Outputs are `has-findings`,
`pull-requests` (JSON URLs), `message` (purchase details, retained even if later
validation fails), and `status`. Repository visibility is checked before assessment;
private or unknown visibility fails closed. The `pull-requests` output retains earlier
URLs if a later publication fails. Action dependency PRs also include a rebuilt
`bot/actions/dist/index.js`, verified by two identical builds using fixed tooling
and installs with lifecycle scripts disabled.

### Workflow checks

`.github/workflows/test.yml` runs on pushes, pull requests and manual dispatch.
It installs action dependencies from their npm lockfile and shared bot dependencies
from the workspace pnpm lockfile without lifecycle scripts, typechecks the bot/tests,
builds the action, checks that the checked-in bundle matches its source, and runs
the offline bot/action test suite. The standalone `cli/` package has been removed. It receives no wallet or write credentials.

`.github/workflows/dependency-updates.yml` runs on dependency-file pushes to
`main` and manual dispatch, excluding generated fix branches and branch deletions. It checks out
the triggering branch without persisted Git credentials and invokes the packaged
action once. Only the update job has write permissions. It supplies the wallet
secret and GitHub token, relies on the action's public configuration defaults, and
sets up Node 24 for npm lockfile generation and exposes `status`, `has-findings`,
`pull-requests`, and `message` job outputs. It does not install, build, or
execute repository test scripts. No chain or USDC repository variables are needed.

### Verified scope and limits

Automated tests mock Telegraph, registry and GitHub responses. They cover findings,
manifest updates, lock-generation orchestration, offline mixed-language scanning,
branch/PR creation and duplicate suppression. Typechecks and the action bundle build
run locally. No live payment, GitHub PR or hosted workflow execution is claimed.

PR preparation currently rejects pnpm/workspace updates, non-public npm registry
sources and hashed/continued Python pins rather than publish stale lock data.
Python ranges, includes and pyproject/Pipfile/setup manifests need exported exact pins.
Current npm prereleases and valid PEP 440 Python pins (including `==1`) are
accepted and ordered using their ecosystem rules. Recommended targets remain
stable versions; npm targets require major.minor.patch. The action uses
`semver` and `@renovatebot/pep440` for version validation and ordering. Unsupported findings fail preparation before publication.
Registry checks confirm target availability, not the truth of CVE claims or migration
compatibility. Repository tests and code migrations are not run automatically; draft
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
