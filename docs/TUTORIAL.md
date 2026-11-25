# Tutorial: give your repo an agent that buys what its AI doesn't know

About 10 minutes, testnet only. Nothing here spends real money.

Your AI coding assistant has a training cutoff; your dependencies don't. Every week packages ship
majors, deprecations and security fixes the model has never seen. Telegraph PR Agent notices when
a dependency update was released after your model's cutoff and **buys** a sourced answer to "what
changed between my version and the new one?" from a miner on [Telegraph](https://docs.telegraphprotocol.com).
It then opens one PR per update.

**What you get:** for each update past the cutoff, a PR that lists the documented breaking changes,
deprecations and security fixes, breaking changes first. Each one comes with its migration step, a
verbatim quote and the source link. The PR also links the lines in your repository that use the
changed APIs (a text search, not a type check). Each answer costs about 0.02 test USDC and is
recorded, with its receipt, in your own repository.

> Entry in the Telegraph Hackathon Season II (a prize competition). The team runs both the Action
> and the default miner (7314), so the team's own purchases are tests, not demand.

## You need

- A **public** GitHub repository (private ones fail closed before any purchase).
- A standalone project with one of: npm `package-lock.json` v2/v3, pnpm `pnpm-lock.yaml` v6/v9,
  `yarn.lock`, Bun `bun.lock`, or exact Python pins (`name==1.2.3`) in `requirements*.txt`.
  Workspaces aren't supported yet.
- Foundry's `cast` ([install](https://getfoundry.sh/)) for three testnet transactions.

## 1. A fresh testnet wallet

Never reuse a wallet that holds anything real.

```sh
cast wallet new
export TELEGRAPH_EVM_PRIVATE_KEY=<the new private key>
```

- **Gas:** about 0.001 Sepolia ETH, free from the
  [Google Cloud Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia).
- **Test USDC:** the Sepolia test token has an open `mint`. Mint 1 USDC (6 decimals):

```sh
cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "mint(address,uint256)" <wallet address> 1000000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$TELEGRAPH_EVM_PRIVATE_KEY"
```

## 2. Deposit into Telegraph escrow (one time)

Telegraph takes payment on Sepolia only from a pre-funded escrow balance. Approve the escrow
contract, then deposit. 0.20 USDC is about 10 answers:

```sh
cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "approve(address,uint256)" \
  0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b 200000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$TELEGRAPH_EVM_PRIVATE_KEY"
cast send 0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b "depositUSDC(uint256)" 200000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$TELEGRAPH_EVM_PRIVATE_KEY"
```

If the deposit reverts with "insufficient allowance", the RPC hasn't caught up with the approve
yet: wait a few seconds and run it again. Check `available` at
`https://devnode.telegraphprotocol.com/v1/ledger/account/<wallet address>`.

## 3. Repository settings

1. Settings → Actions → General → Workflow permissions: tick **Allow GitHub Actions to create
   and approve pull requests** and save. This is the step most often missed. Without it, the run
   buys its answers and then fails with a 403 when opening PRs. A re-run reuses the saved answers
   and buys nothing again.
2. Settings → Secrets and variables → Actions:
   - secret `TELEGRAPH_EVM_PRIVATE_KEY`: the new key;
   - variable `MODEL_CUTOFF`: your coding model's training cutoff, e.g. `2026-01-01`;
   - variable `MODEL_CUTOFF_SOURCE_URL`: an HTTPS page that documents or explains the cutoff;
   - variable `MODEL_CUTOFF_STATUS`: `provider-documented` or `team-assumed`.

Optional variables (`MODEL_PROVIDER`, `MODEL_ID`, `MONTHLY_BUDGET_USDC`, `PREFERRED_MINER_ID`,
`MERGE_BRANCHES`) are listed in the [README](../README.md#install-in-your-repository-5-minutes).

## 4. Two workflow files

Copy both files from [the README, step 5](../README.md#install-in-your-repository-5-minutes):

- `telegraph-dependency-updates.yml` scans the lockfile, buys the answers and opens the PRs.
- `telegraph-pr-outcomes.yml` records each dependency PR's merge or close on the ledger, which is
  what "cost per merged PR" is computed from. It checks out your default branch, never the PR's
  code, and has no wallet key.

## 5. Run it

Actions → **Telegraph dependency updates** → **Run workflow**. Then open
`https://telegraph-pr-agent.vercel.app/?repo=<owner>/<repo>`. Every run that buys something prints
that link, and every dependency PR ends with it.

## How it decides to spend

- It buys only for releases dated after `MODEL_CUTOFF`. That's a deterministic registry check, not
  a model's guess. Newer releases before the cutoff get a free PR with links to the release notes
  (up to 5 per run).
- Before paying, it checks that your package manager can actually install the target. If it can't,
  the update is skipped with the package manager's reason and nothing is bought.
- An upgrade already proposed is not proposed again.
- Limits: 0.10 USDC per call and 2 USDC per run by default, plus an optional monthly budget. A
  payment interrupted mid-flight blocks a repeat purchase until it is reconciled, so it can't be
  paid twice.
- A human merges. The bot never merges and its own code uses no LLM: all of its knowledge comes
  from Telegraph miners.

## What we learned building on Telegraph

- **Escrow is fast.** In our 5 Nov tests a paid call took a median 2.0 s with escrow, against
  13.3 s with one on-chain payment per call.
- **Ask a specialised miner by id.** Engine routing classified package questions as web search and
  sent them to another intent, so the Action asks miner 7314 first and falls back to ranked miners.
- **A cached answer is still charged.** Retries must be different requests.
- **Miner answers are untrusted input.** Miner 7314 checks that every quote is an exact substring
  of the source it fetched, and never takes versions, dates or links from a model.

## Feedback

Tried it? Open an [issue](https://github.com/borodedamie/telegraph-pr-agent/issues) with what you
ran and whether the answer was useful. That's the most useful thing you can send us.
