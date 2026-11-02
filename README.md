# Telegraph PR Agent

A testnet prototype of a dependency-migration agent that buys release intelligence instead of guessing. It detects npm releases newer than a configured model-knowledge cutoff and can purchase a package-specific answer through [Telegraph](https://anjoman.ai/docs/introduction). The current CLI slice records the returned answer and payment evidence; the GitHub Action, migration PR and cost-per-merged-PR workflow are in development.

Built for the Telegraph Hackathon Season II, mission [Model Economy](https://hackathon.telegraphprotocol.com/missions/model-economy). Plan: [docs/HACKATHON-PLAN.md](docs/HACKATHON-PLAN.md). Specification: [docs/SPEC.md](docs/SPEC.md). Who does what: [docs/TEAM.md](docs/TEAM.md).

> **Testnet prototype.** The current CLI has completed a Telegraph x402 purchase on the devnode. The project has not yet demonstrated a complete package migration or production customer usage. Testnet USDC is not revenue.

## Status

Status last verified: 2026-11-02 04:52 UTC, commit `9faf16a`. Status is a snapshot, not a promise.

| Part | State |
| --- | --- |
| Detect a post-cutoff npm dependency | Works. `bot/src/trigger.ts` diffs two `package.json` files and checks npm release dates. It does not read a lockfile. |
| Buy an answer on Telegraph with x402; record receipt hash, signal hash, tx hash | Exercised once, on 28 Oct 2026 (pre-event). See below. |
| Append-only purchase ledger on a `ledger` git branch | Works; one row per CLI run, keyed on (PR, commit). |
| Purchase dashboard | Works locally (`pnpm --filter web dev`); reads the ledger branch. Not deployed to a public URL yet. Shows purchases only, not cost per merged PR. |
| GitHub Action, draft PR, `telegraph:fix` label, fix job, merge accounting, cost per merged PR | Planned. |
| Package-release `QUESTION_ANSWERING` miner | Planned. The network's current Q&A providers have not shown package-release competence. |
| Event-period evidence (1 Nov to 1 Dec 2026) | None yet. |

**About the one purchase so far.** On 28 Oct 2026 the CLI paid 0.01 testnet USDC through the devnode to the provider that the node listed as rank 3 for question answering (Crossref QA) and recorded the tx hash, receipt hash and signal hash. The returned answer was academic search results unrelated to the package. That run is a pre-event integration test: it shows the payment flow was exercised. It is not event-period hackathon evidence and not a successful package-release answer. It also used the node interface as it stood on that date; the request shape and intent ids have to be rechecked against the live node before any new run.

## How it will work

Each stage is marked current or planned.

1. **Scan** (planned): inspect `package.json` and supported lockfiles, find direct dependencies with a newer stable release, and query OSV for known advisories. Current slice: compares two `package.json` files only.
2. **Learn** (current, partly): for a dependency whose installed version is older than the proposed stable release *and* whose release date is after the configured cutoff, buy one question-answering request on Telegraph. The quote comes from the 402 challenge and can vary; 0.01 USDC is an observed example, not a price.
3. **Report** (planned): open one draft PR per package and target version, updated on later runs, never duplicated. It lists why to upgrade, known advisories, which changed symbols the repository uses (found by a local search, not by the miner), what to change, spend so far and an estimated fix cost. If the answer is `not_found`, the purchase and receipt are kept, the PR is report-only, and no migration is invented.
4. **Fix** (planned, after a maintainer with write access adds `telegraph:fix`): generate a patch with the purchased answer as input. Paid `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` calls are conditional on a provider passing our quality tests; until then the installer's own LLM writes the patch. The repository's install, typecheck and tests run in a job with no secrets. Nothing is pushed unless they pass.
5. **Merge** (planned): a human reviews and merges. The bot never merges.
6. **Account** (planned): cost per merged bot PR = all net automation spend (Telegraph, LLM, closed and unmerged proposals) divided by merged bot PRs, shown with the proposal and merge counts; `N/A` when nothing has merged.

## What runs today

`bot/src/slice.ts` takes a base `package.json`, a head `package.json`, a PR number and a commit SHA. It:

- diffs declared dependencies (`dependencies` and `devDependencies`), resolves each changed range to its bare version, and asks the npm registry for that version's release date;
- picks the first dependency released after `MODEL_CUTOFF` (one purchase per run);
- lists providers for the intent, pays the top-listed one through `POST /engine/v1/ask/{minerId}` with the provider's native request, and records the answer plus tx, receipt and signal hashes;
- appends one ledger row and pushes it to the `ledger` branch, after the answer has been received.

Known gaps in this slice, kept here so nobody mistakes them for features:

- The client sends the family label `QUESTION_ANSWERING`. The live node's canonical ids differ (they carry a suffix); the exact id must be read from `GET /engine/v1/intents` and the client updated before the next paid run.
- Provider listing reads `/api/miners?intent=…`, which returned no providers on 1 Nov; the intent-specific `GET /engine/v1/intents/{id}/miners` is the correct source.
- If the payment succeeds but the ledger push fails, a rerun can pay again. The ledger key (PR, commit) only suppresses an exact repeat of a completed run.
- Explorer links are hardcoded to Basescan; they must follow the chain named in the 402 challenge.

## Repository layout

```
bot/                TypeScript agent, Node 20, vitest
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

No workflow YAML, fixtures or sample ledger export exist yet.

## Run the current slice

Prerequisites: Node 20.x, pnpm 9 or later, macOS or Linux shell, a dedicated testnet wallet holding a few cents of test USDC on the network the devnode quotes (Ethereum Sepolia as of 1 Nov 2026; the 402 challenge is authoritative), and a fine-grained GitHub token limited to the demo repository with `contents: read/write` for the ledger branch. Gas is handled by the x402 facilitator; the wallet needs test USDC only.

```bash
pnpm install
cp bot/.env.example bot/.env     # then edit; see Configuration for values to correct
cd bot && pnpm test              # unit tests only: no network, no payment
```

A paid run needs two `package.json` files. The repository does not ship fixtures yet; create two files where the head bumps a dependency to a version released after the cutoff, then run (values below are examples, replace them with yours):

```bash
cd bot
pnpm exec tsx --env-file=.env src/slice.ts \
  ../examples/base-package.json \
  ../examples/head-package.json \
  1 \
  0123456789abcdef0123456789abcdef01234567
```

This command spends testnet USDC and pushes to the ledger branch.

Expected output, post-cutoff case (shape from the 28 Oct run, values redacted; the intent id and provider will differ once the client is updated to the live catalogue):

```
triggers: [{ package: "zod", version: "^4.6.7", releaseDate: "2026-03-14T…", status: "past-cutoff" }]
purchase: { intent: "QUESTION_ANSWERING", minerId: "…", minerName: "…", minerRank: 3,
            amountUsdc: 0.01, txHash: "0x…", receiptHash: "0x…", signalHash: "0x…",
            answer: "…", status: "settled" }
ledger row committed: PR #1 QUESTION_ANSWERING 0x…
```

Expected output when no dependency is newer than the cutoff: the run prints that there is no post-cutoff candidate and exits with zero spend.

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
| `LLM_API_KEY`, `LLM_BASE_URL` | Required by config validation today but unused by the slice; any non-empty values work. They become real once patch generation exists, and the installer pays that provider |

Known stale values in `bot/.env.example`: `CHAIN_ID=84532` and `USDC_ADDRESS=0x036C…` are Base Sepolia. On 1 Nov 2026 the devnode quoted Ethereum Sepolia (`eip155:11155111`, USDC `0xcc194e1a843B658526D0D5C431f670028582Ae17`). Set those two values from the live 402 challenge until the example file is corrected.

## Network and spending limits

The 402 challenge supplies the current quote and payment options. The client's local spending policy must allow the quoted network and token, and must reject a quote above the configured per-call maximum. The run budget is enforced separately across calls. The observed 0.01 USDC quote is an example; a provider's floor price, the quoted amount and the charged amount are different figures, and a demand multiplier can raise the quote.

Invalid requests are rejected before payment. If a valid payment is made but the provider then fails, the amount is credited to the caller's Telegraph escrow balance and is not consumed for a delivered answer. A delivered HTTP 200 with an error inside its body may still be billable, so the result and `field_status` have to be inspected, not only the HTTP status. `receipt_hash` identifies an individual delivered call; a transaction hash can cover several calls.

## Security model (planned Action)

- The payment and LLM job holds the wallet and LLM credentials and runs no repository scripts.
- The install, typecheck and test job receives no wallet, LLM or write-token secret.
- A separate commit job receives only a minimal short-lived write credential, validates the patch artifact, restricts it to permitted paths and the expected base SHA, and never executes repository code.
- `pull_request_target` is never combined with checking out and running PR code. Third-party Actions are pinned to commit SHAs.
- The installer supplies both the wallet and the LLM key in repository secrets and pays both Telegraph and the LLM provider.

## Limitations

- npm only; `package.json` comparison only; no lockfile parsing.
- One Q&A purchase per CLI run; the first eligible dependency only.
- Package-release answer quality has not been demonstrated by existing providers.
- The team's package-release miner is planned, not registered or ranked.
- GitHub Action, draft PR, label approval, patch generation, secretless CI and merge accounting are planned.
- `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` are conditional on providers passing quality tests.
- The dashboard shows purchase records, not cost per merged PR, and is not deployed publicly.
- Public repositories only. Testnet only; no revenue or adoption claim.

## Disclosure

- The same team controls the agent and the planned package-release miner. Any agent purchase from that miner is related-party testing, not independent demand, adoption or third-party validation.
- Buyer wallet and miner wallet addresses, with explorer links, will be listed here before submission. Keys are never published.
- Code written before 1 Nov 2026: the CLI vertical slice described above (commit `9faf16a` and earlier). Work added during the event will be summarised here.
- Reused open source: `@x402/fetch` and `@x402/evm` (Apache-2.0), `viem` (MIT), `zod` (MIT), `vitest` (MIT), `vite` (MIT). Confirm each licence from the package before submission.

## For reviewers and the hackathon submission

To be filled in as each item exists; nothing below is claimed yet.

| Item | Status |
| --- | --- |
| Tested commit and public repository | this repository, commit listed under Status |
| Public dashboard URL | not deployed |
| Testnet and token in use | from the live 402 challenge; Ethereum Sepolia test USDC as of 1 Nov 2026 |
| One command for a new realistic input | the slice command above, once fixtures are added |
| No-post-cutoff, no-spend case | the slice command with a head file whose versions predate the cutoff |
| Failing typecheck, no push case | planned with the Action |
| Event-period receipts, signal links, transactions, ledger export | none yet |
| 2–5 minute demo | not recorded |
| Five-question commercial summary | not written |
| Public updates (at least three, separate dates) | none yet |
| Technical tutorial and independent reproduction evidence | none yet |

If you try the slice, open an issue with what you ran, the signal hash and whether the answer was useful. That is the kind of independent test the project needs.
