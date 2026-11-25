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

## What is what

- **The bot** is not a chat bot. It's a program that runs as a **GitHub Action**: GitHub's built-in
  automation, which runs scripts on GitHub's own machines when something happens in your
  repository. You add two small config files to your repository and GitHub does the rest. You
  don't host, download or install anything, and you need no server.
- **Telegraph** is a marketplace where programs sell answers to other programs, paid per answer in
  test USDC on the Ethereum Sepolia testnet.
- **Miner 7314** is the service on Telegraph that the bot buys answers from: "what changed in
  package X between version A and B". The team built it and hosts it.
- **Vercel** is just the hosting the team uses for the miner and for the dashboard
  (`telegraph-pr-agent.vercel.app`). You never touch it.
- **The dashboard** is a web page that reads your repository's purchase records and shows what was
  bought and what it cost.

What ends up in your repository: pull requests (one per dependency update) and a `ledger` branch
with the purchase records. Nothing is merged without you.

> Entry in the Telegraph Hackathon Season II (a prize competition). The team runs both the Action
> and the default miner (7314), so the team's own purchases are tests, not demand.

## You need

**Try it on a fork or a throwaway repository first, not on a repository you care about.** The bot
opens PRs and needs a repository-wide permission (step 3). The easy way: fork any small public
JavaScript project with a lockfile and a few outdated dependencies. On the fork, open the
**Actions** tab and click **I understand my workflows, go ahead and enable them**, because GitHub
turns Actions off on new forks.

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
   and approve pull requests** and save. **Why:** the bot's whole output is pull requests, and by
   default GitHub doesn't let automation open them. This setting lets the bot open PRs with the
   temporary token GitHub gives each run. The bot never approves or merges anything; you do. **Note:** this checkbox is repository-wide and also allows approving: any workflow in the repository with `pull-requests: write` can then open and approve PRs. If your branch protection relies on one approval, that matters, which is another reason to try it on a fork first. This
   is the step most often missed: without it, the run buys its answers and then fails with a 403
   when opening PRs. A re-run reuses the saved answers and buys nothing again.
2. Settings → Secrets and variables → Actions. On the **Secrets** tab click **New repository
   secret**:
   - `TELEGRAPH_EVM_PRIVATE_KEY`: the private key `cast wallet new` printed in step 1 (starts
     with `0x`).

   On the **Variables** tab click **New repository variable** three times. These tell the bot
   which releases your coding AI (Claude, ChatGPT, Copilot…) can't know about: it buys answers only
   for releases published after the cutoff date.

   | Variable | What it is | Example |
   | --- | --- | --- |
   | `MODEL_CUTOFF` | The date your AI model's training data ends, `YYYY-MM-DD` | `2026-01-01` |
   | `MODEL_CUTOFF_SOURCE_URL` | An HTTPS page where that date comes from | `https://docs.anthropic.com/en/docs/about-claude/models/overview` |
   | `MODEL_CUTOFF_STATUS` | `team-assumed` if you picked the date yourself; `provider-documented` if it's from the provider's page | `team-assumed` |

   **Where to find the date:** the provider lists it on its models page as "training data
   cutoff" or "knowledge cutoff" (Anthropic:
   https://docs.anthropic.com/en/docs/about-claude/models/overview, OpenAI:
   https://platform.openai.com/docs/models). Copy the date from there and use that page as
   `MODEL_CUTOFF_SOURCE_URL`.

   **Just trying it out?** Use exactly the example column: `2026-01-01`, the Anthropic link and
   `team-assumed`. `provider-documented` also needs the optional `MODEL_PROVIDER` and `MODEL_ID`
   variables below; `team-assumed` doesn't. An earlier date means more updates count as "after
   the cutoff", so more answers are bought.

Optional variables (`MODEL_PROVIDER`, `MODEL_ID`, `MONTHLY_BUDGET_USDC`, `PREFERRED_MINER_ID`,
`MERGE_BRANCHES`) are listed in the [README](../README.md#install-in-your-repository-5-minutes).

## 4. Two workflow files

A workflow file tells GitHub what to run and when. They live in the folder `.github/workflows/` at
the root of your repository (create it if it doesn't exist). You can do it all in the browser:

1. On your repository's main page click **Add file → Create new file**.
2. In the name box type `.github/workflows/telegraph-dependency-updates.yml` (typing the `/`
   creates the folders).
3. Paste the first file below and click **Commit changes**, straight to your default branch.
4. Repeat for `.github/workflows/telegraph-pr-outcomes.yml` with the second file.

**File 1: `.github/workflows/telegraph-dependency-updates.yml`.** Scans your lockfile, buys the
answers and opens the PRs. If your default branch isn't called `main`, change `branches: [main]`.

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

**File 2: `.github/workflows/telegraph-pr-outcomes.yml`.** Records each dependency PR's merge or
close on the ledger, which is what "cost per merged PR" is computed from. It checks out your
default branch, never the PR's code, and has no wallet key.

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
