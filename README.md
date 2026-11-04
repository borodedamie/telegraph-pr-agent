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
| Detect a changed dependency released after the cutoff | Works as a manifest-diff prototype. `bot/src/trigger.ts` diffs two `package.json` files and checks the npm release date of the version named in the changed range. It does not read a lockfile, scan a branch or look up the latest registry version. |
| Buy an answer on Telegraph with x402; record receipt hash, signal hash, tx hash | Historical integration test only: one pre-event payment succeeded on 28 Oct 2026; the returned content was unrelated to package releases. The current client is not compatible with the 2 Nov live intent contract until it sends the canonical intent id and request shape and is retested. |
| Append-only purchase ledger on a `ledger` git branch | Works; one row per CLI run, keyed on (PR, commit). Prototype schema: replaced by attempt and per-receipt records ([SPEC §4](docs/SPEC.md)) before the Action uses it. |
| Purchase dashboard | Works locally: `pnpm install`, then `pnpm --filter @telegraph-pr-agent/web dev`; it reads `ledger.jsonl` from GitHub raw for a public repository. Not deployed to a public URL yet. Shows purchases only, not cost per merged PR. |
| GitHub Action (developer-configured schedule and manual run, lockfile scan), draft PR, `telegraph:fix` label, fix job, merge accounting, cost per merged PR | Planned. |
| Package-release Q&A miner | In progress. A Vercel preview gives real sourced answers from npm and GitHub release material, rules only (no model pass, no OSV check yet); live runs on 4 Nov are in [miner/bench/network.md](miner/bench/network.md). Without the model pass it misses breaking changes written as prose: React 18 → 19 came back with none. Its registration YAML passed the Telegraph dashboard validation on 3 Nov. `not_found` for a missing version and `out_of_scope` were checked live; the outage and no-release-material cases only by fixture tests. Not registered. Still behind a go/no-go gate. On 2 Nov the live QA intent had too few evaluation contributors (3 of 5) for any miner to be scored, and its test set is general questions; we asked Telegraph for a dedicated package-release intent. The network's current Q&A providers have not shown package-release competence. |

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

- The client sends the family prefix `QUESTION_ANSWERING`. The live canonical id on 2 Nov is `QUESTION_ANSWERING_GENERAL`, a judgment-class intent with no request or response schema; the node rejects `params` for it and expects a free-form `query`. The client must be updated before the next paid run.
- Provider listing reads `/api/miners?intent=QUESTION_ANSWERING`, which returns nothing because that is the family prefix, not because the endpoint is broken. With the canonical id it returns the 10 registered providers with activation, price and scores. `GET /engine/v1/intents/{id}/miners` lists the same providers without rank or score fields. On 2 Nov no provider had a QA score, so the client's ranking step drops all 10 and the run fails with "none ranked", even after the intent id and request shape are fixed. Selection also has to change before the next paid run.
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

No workflow YAML, fixtures or sample ledger export exist yet; the `examples/` files below are created by hand.

## Run the current slice

Prerequisites: Node 20.x, pnpm 9 or later, macOS or Linux shell, a dedicated testnet wallet holding a few cents of test USDC on the network the devnode quotes (Ethereum Sepolia as of 2 Nov 2026; the 402 challenge is authoritative), and a fine-grained GitHub token limited to a public repository you control (`DEMO_REPO`) with `contents: read/write`, so the run can push its ledger branch. Gas is handled by the x402 facilitator; the wallet needs test USDC only.

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
purchase: { intent: "QUESTION_ANSWERING", minerId: "…", minerName: "…", minerRank: 3,
            amountUsdc: 0.01, txHash: "0x…", receiptHash: "0x…", signalHash: "0x…",
            answer: "…", status: "settled" }
ledger row committed: PR #1 QUESTION_ANSWERING 0x…
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
| `LLM_API_KEY`, `LLM_BASE_URL` | Required by config validation today but unused by the slice. Known defect: they are to be removed from validation until patch generation exists. Until then the template's placeholder values pass; never put a real key here for the slice |

Known stale values in `bot/.env.example`: `CHAIN_ID=84532` and `USDC_ADDRESS=0x036C…` are Base Sepolia. On 2 Nov 2026 the devnode quoted Ethereum Sepolia (`eip155:11155111`, USDC `0xcc194e1a843B658526D0D5C431f670028582Ae17`). Set those two values from the live 402 challenge. Correcting the template is a pending code fix; a reviewer should not have to repair it.

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
- The team's package-release miner is planned, not registered or ranked.
- GitHub Action, draft PR, label approval, patch generation, secretless CI and merge accounting are planned.
- `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY` are conditional on providers passing quality tests.
- The dashboard shows purchase records, not cost per merged PR, and is not deployed publicly.
- Public repositories only. Testnet only; no revenue or adoption claim.

## Disclosure

- The same team controls the agent and the planned package-release miner. Any agent purchase from that miner is related-party testing, not independent demand, adoption or third-party validation.
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
