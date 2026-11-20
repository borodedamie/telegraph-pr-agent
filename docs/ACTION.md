# How the Action works

Internal reference for the dependency update Action: configuration details, workflow checks, supported package managers and their limits, ledger and merge-accounting behaviour. To install the Action, follow [Install in your repository](../README.md#install-in-your-repository-5-minutes) in the README; this page is for contributors and reviewers who want the details.

## Ledger behaviour and known gaps

- The intent id `QUESTION_ANSWERING_GENERAL` is hardcoded; it was checked against `GET /engine/v1/intents` on 3 Nov 2026 and must be rechecked if the catalogue changes.
- Each payment try is recorded on the ledger branch at every stage (`reserved`, then `quote_refused` or `request_sent`, then `delivered`, `failed_and_credited`, `failed_not_charged` or `unknown_needs_reconciliation`; definitions in [SPEC §2.6](docs/SPEC.md)) before the bot moves on. If a run dies or its push fails after `request_sent`, the next run for that PR and commit stops instead of paying again, and a person checks the wallet, escrow balance and signal. Before recording `reserved` and `request_sent`, the run re-checks the freshly fetched ledger, and a push loses if another run pushed first, so two runs for the same PR and commit can't both pay; the second stops. To clear a stuck attempt, check the wallet, escrow balance and signal, then run the **Reconcile a stuck payment attempt** workflow (`.github/workflows/reconcile-attempt.yml`, Actions tab, default branch) with the `attemptId`, the outcome (`failed_and_credited`, `failed_not_charged`, or `failed_and_charged` when the payment was charged but no answer was kept) and a note. `failed_and_charged` requires the payment's transaction hash and counts as spend. The workflow holds no wallet key; it refuses attempts that aren't stuck, and records who reconciled.
- A purchase is recorded once per `receipt_hash`; writing a receipt that is already on the ledger is refused. Each purchase row has a `resultStatus` for answer quality, kept apart from payment: new rows start `unchecked`, and `useful`, `unusable` or `not_found` can be recorded separately. The dependency action automatically appends `useful` when an answer produces a published PR and `unusable` for invalid findings; the dashboard uses the latest quality update.
- Each purchase row stores the network, chain id, USDC contract and explorer URL of the 402 option it paid, and transaction links are built from that. Rows written before 5 Nov 2026 lack these fields; their links use the date (before 1 Nov: Basescan, Base Sepolia; after: Etherscan, Ethereum Sepolia). Escrow purchases (from 20 Nov 2026) have no transaction hash of their own; they record the receipt hash and the Telegraph ledger epoch.

## Verify a purchase

Open `https://devnode.telegraphprotocol.com/engine/v1/signal/<signalHash>` to inspect the request and response Telegraph recorded, and the tx hash on the explorer for the chain named in the quote. The signal and receipt show what was bought and returned; they do not by themselves show the answer is factually correct. Package-release claims have to be checked against their linked registry and release-note sources, and migration correctness by the repository's tests.

## Network and spending limits

The 402 challenge supplies the current quote and payment options. The client's local spending policy must allow the quoted network and token, and must reject a quote above the configured per-call maximum. The run budget is enforced separately across calls. The observed 0.01 USDC quote is an example; a provider's floor price, the quoted amount and the charged amount are different figures, and a demand multiplier can raise the quote.

Invalid requests are rejected before payment (for example, `params` sent to an intent without an input schema returns 400). On 2 Nov the challenge offered two schemes on Ethereum Sepolia: `exact` (per-request x402) and `escrow` (deducted from a pre-funded Telegraph escrow balance at the next epoch close). On 20 Nov the node stopped offering `exact` on Sepolia (it kept `exact` on Base Sepolia and Solana, and `escrow` on Sepolia). The bot pays `exact` when the challenge offers it on its chain in its USDC, and otherwise pays from escrow on its chain: it signs the challenge message (EIP-191) and records the receipt hash and ledger epoch; an escrow purchase has no transaction hash of its own.

On the documented x402 path a valid payment may settle before the miner is called; if delivery then fails, the amount is credited to the caller's Telegraph escrow balance and is not consumed. A delivered 200 returns a Telegraph receipt. A 200 whose body contains an error is still treated as delivered, so the client checks the result itself (and `result_shape` and `field_status` when present), not only the HTTP status. The x402 guide and the protocol overview describe settlement timing differently; a controlled failed-delivery test against the current node is planned and will be linked here. Until then, do not read this as "failed calls cost nothing".

`receipt_hash` identifies an individual delivered call; a transaction hash can cover several calls.

## Security model (planned Action)

- The payment and LLM job holds the wallet and LLM credentials and runs no repository scripts.
- The install, typecheck and test job receives no wallet, LLM or write-token secret.
- A separate commit job receives only a minimal short-lived write credential, validates the patch artifact, restricts it to permitted paths and the expected base SHA, and never executes repository code.
- `pull_request_target` is never combined with checking out and running PR code. Third-party Actions are pinned to commit SHAs.
- The installer supplies both the wallet and the LLM key in repository secrets and pays both Telegraph and the LLM provider.

## The workflow in this repository

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

## Enable the workflow

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

## Workflow checks

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

## Package-manager tools on consumer runners

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

## Verified scope and limits

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
