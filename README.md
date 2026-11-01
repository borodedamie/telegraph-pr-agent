# Telegraph PR Agent

A coding agent that buys what it does not know. When a repo's dependency is newer than the AI model's training cutoff, the agent does not guess: it buys a verified answer about what changed on [Telegraph](https://anjoman.ai/docs/introduction), opens a draft PR explaining the upgrade and, once a maintainer approves, fixes the code, tests it and reports the **cost per merged pull request**.

Built for the Telegraph Hackathon Season II, mission [Model Economy](https://hackathon.telegraphprotocol.com/missions/model-economy) ("The coding agent that buys what it does not know"). Plan: [docs/HACKATHON-PLAN.md](docs/HACKATHON-PLAN.md). Who does what: [docs/TEAM.md](docs/TEAM.md).

> **Testnet build.** Routing, miners, verification and settlement are real; USDC is testnet-denominated. No revenue claim is made.

## Status (1 Nov 2026)

| Part | State |
| --- | --- |
| Detect a post-cutoff npm dependency | Works (`bot/src/trigger.ts`) |
| Buy an answer on Telegraph with x402, record receipt, signal hash and tx | Works (`bot/src/x402.ts`), one real purchase verified on the devnode |
| Append-only spend ledger on a `ledger` git branch | Works (`bot/src/ledger.ts`) |
| Public spend dashboard | Works, shows purchases only (`web/`) |
| GitHub Action, draft PR, `telegraph:fix` label, fix job, cost per merged PR | Planned, see the plan |
| Package-release `QUESTION_ANSWERING` miner | Planned, see the plan |

What runs today is a command-line vertical slice: give it two `package.json` files, a PR number and a commit, and it makes one `QUESTION_ANSWERING` purchase and writes a ledger row.

## How it will work

1. **Scan** (free): read `package.json` and the lockfile; list outdated direct dependencies and known vulnerabilities.
2. **Learn** (paid, about 0.01 USDC): for versions released after the model's cutoff only, buy "what changed from installed A to proposed B" on Telegraph.
3. **Report** (free): open a draft PR with why to upgrade, which functions changed, which files use them, what to change, and the spend so far.
4. **Fix** (after a maintainer adds the `telegraph:fix` label, about 0.03 USDC): buy `CODE_GENERATION`, `CODE_PATCH_VERIFY` and `REGRESSION_VERIFY`; run the repo's tests in a job with no secrets; push only if everything passes.
5. **Merge**: a human reviews and merges.
6. **Account**: the dashboard shows cost per merged PR.

## Repository layout

```
bot/            TypeScript agent (Node 20, vitest)
  src/config.ts   env validation
  src/trigger.ts  post-cutoff dependency detection (npm registry release dates)
  src/x402.ts     Telegraph client: leaderboard lookup, x402 payment, receipts
  src/ledger.ts   ledger.jsonl on the `ledger` branch, idempotency, push retry
  src/memo.ts     the PR comment
  src/slice.ts    CLI runner for the vertical slice
  test/           unit tests (no network, no payments)
web/            static spend dashboard (Vite), reads ledger.jsonl from GitHub raw
docs/           plan, team split, ADRs
CONTEXT.md      glossary
```

## Run the current slice

Prerequisites: Node 20+, pnpm, a testnet wallet funded with a few cents of test USDC on the network the devnode quotes (see **Network** below), and a GitHub fine-grained token with push access to the ledger branch of the demo repo.

```bash
pnpm install
cp bot/.env.example bot/.env   # fill in the secrets
cd bot && pnpm test             # 43 unit tests, no network
```

Make one purchase:

```bash
cd bot
npx tsx --env-file=.env src/slice.ts <base-package.json> <head-package.json> <prNumber> <headSha>
```

Expected result when a dependency in `head` is newer than `MODEL_CUTOFF`: the console prints the trigger, the purchase (miner, rank, amount, tx hash, receipt hash, signal hash, answer), and a ledger row is pushed to the `ledger` branch. The dashboard picks it up on reload.

Expected result when nothing is newer than the cutoff: `no past-cutoff trigger → zero spend`, and nothing is bought. Running the same PR and commit twice buys nothing the second time.

Verify a purchase without trusting us: open `https://devnode.telegraphprotocol.com/engine/v1/signal/<signalHash>` for the recorded answer, and the tx hash on the chain explorer for the payment.

## Configuration

| Variable | Meaning |
| --- | --- |
| `NODE_URL` | Telegraph node, `https://devnode.telegraphprotocol.com` on testnet |
| `CHAIN_ID`, `USDC_ADDRESS` | Payment network and token the node quotes (see **Network**) |
| `MODEL_CUTOFF` | Training cutoff of the model used for patches; versions released after it trigger a purchase |
| `MAX_PRICE_PER_CALL_USDC` | Refuse any single quote above this |
| `BUDGET_CAP_USDC` | Refuse once a run's total would pass this |
| `TELEGRAPH_EVM_PRIVATE_KEY` | The paying wallet. Use a dedicated low-balance testnet wallet |
| `GH_PAT`, `DEMO_REPO` | Where the ledger branch is pushed (replaced by the Action's own token later) |
| `LLM_API_KEY`, `LLM_BASE_URL` | Model used to write patches in step 4 (not used by the slice yet) |

## Network and spending limits

The node names the payment network and price in each HTTP 402 quote; the client reads it from there, never from config. On 1 Nov 2026 the devnode quoted Ethereum Sepolia (`eip155:11155111`) at 0.01 USDC per call; `.env.example` still carries the older Base Sepolia values and needs updating when you set up. 0.01 is a floor and can rise with demand.

Every purchase is guarded by the per-call maximum and the run budget. A refused quote is logged and nothing is paid. Telegraph only settles on a delivered answer, so a failed call costs nothing.

## Limitations

- npm only; PyPI is planned.
- Reads version ranges from `package.json`; lockfile support is planned.
- One purchase per run today; the four-intent fix flow is planned.
- The devnode's current `QUESTION_ANSWERING` miners are general data feeds and do not know package releases; the team is building a miner that does.
- Public repos only; the ledger and dashboard are public.

## Disclosure

The team runs both this agent and the package-release miner it may buy from. The agent buys from whichever miner Telegraph ranks highest for the intent, ours or not. The agent's wallet and the miner's wallet are different; both addresses will be listed here before submission. Code written before 1 Nov 2026: the vertical slice above. Reused open source: `@x402/fetch`, `@x402/evm`, `viem`, `zod`, `vitest`, `vite`.
