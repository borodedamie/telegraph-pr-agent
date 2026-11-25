# Try Telegraph PR Agent on a repository (about 15 minutes)

Testnet only: you use free test tokens, never real money.

> **The bot:** checks a GitHub repository for outdated dependencies and opens a pull request for
> each update: the new version, plus what changed in it and where your code is affected.
>
> **Works with:** JavaScript/TypeScript (npm, pnpm, Yarn, Bun) and Python pins in
> `requirements*.txt`. Not yet: `uv.lock` and `poetry.lock` (workaround:
> `uv export --no-hashes --format requirements-txt -o requirements.txt`). Not C/C++ (Meson, CMake),
> Rust or Go.
>
> **The goal of this test:** set up the bot as a GitHub Action in a repository (a fork is best),
> run it once, and check the pull requests it opens.

<details>
<summary><b>What is Telegraph?</b> (click to expand)</summary>

[Telegraph](https://docs.telegraphprotocol.com) is a marketplace where programs buy answers from
other programs and pay per answer.

- **Miners** are the sellers: web services that each answer one kind of question. Our team runs
  miner **7314**, which answers "what changed in npm package X between version A and B", with a
  quote and a source link for every change.
- **Buyers** are programs like our bot. They send a question to Telegraph, pay for it, and get the
  answer with a receipt.
- **Payment** is in USDC, a dollar stablecoin. During the hackathon everything runs on Ethereum's
  **Sepolia test network** with free test USDC, so no real money is involved.
- **Escrow** is a pre-paid balance with Telegraph. You deposit once; each answer is deducted from
  it, with no blockchain transaction per answer.
- Telegraph keeps 2% of each payment and passes the rest to the miner. Miners are scored on test
  questions and ranked.

</details>

**What it does.** AI coding assistants don't know about package releases that came out after
their training. This tool checks your repository's dependencies. For each update released after
that date, it pays a few cents of *test* money for an answer to "what changed between your
version and the new one" and opens a pull request with that answer: the breaking changes, how to
migrate, a quote and a link for each, and the lines in your code that are affected.

**How it runs.** No server, nothing to install on your machine except one command-line tool for
the test wallet. You add two files to a GitHub repository; GitHub runs them on its own machines
(this is called GitHub Actions). The service that answers the questions is already hosted by our
team.

```
your repository ──▶ GitHub runs the bot ──▶ bot pays 0.02 test USDC ──▶ our answering service
                                       ◀── answer ──────────────────────┘
                    bot opens a pull request in your repository
```

**At the end you'll have:** pull requests in your repository, one per dependency update, and a
web page showing what was bought and what it cost.

> Entry in the Telegraph Hackathon Season II (a prize competition). The team runs both the bot and
> the answering service, so the team's own purchases are tests, not demand.

---

## Part A: the repository (5 min, all in the browser)

**A1. Fork a small JavaScript project.** Use a fork, not a repository you care about: the bot
opens pull requests and needs a permission (A3). Pick any public project that has a
`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or `bun.lock` in its root folder and hasn't
updated its dependencies in a while. Click **Fork** on its GitHub page.

Not supported yet: monorepos (workspaces) and private repositories.

**A2. Turn on Actions in the fork.** In your fork open the **Actions** tab and click **I understand
my workflows, go ahead and enable them**. (GitHub turns Actions off in new forks.)

**A3. Let Actions open pull requests.** In your fork: **Settings → Actions → General**, scroll to
**Workflow permissions**, tick **Allow GitHub Actions to create and approve pull requests**,
click **Save**.

- Why: the bot's whole output is pull requests, and GitHub blocks automation from opening them by
  default.
- Be aware: this checkbox applies to every workflow in the repository and also allows approving
  PRs. Our bot only opens them; it never approves or merges. That's why we use a fork.

## Part B: the test wallet (5–10 min, in a terminal)

The bot pays for each answer from a wallet. You make a new one just for this, with free test
tokens on the Ethereum Sepolia test network.

**B1. Install Foundry** (the `cast` command):

```sh
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

**B2. Create the wallet.**

```sh
cast wallet new
```

It prints an **Address** and a **Private key**. Keep both. Then put them in your terminal session:

```sh
export ADDRESS=<the Address>
export KEY=<the Private key>
```

> This is a throwaway testnet wallet, so passing the key with `--private-key` is fine here. Never do
> this with a real key: use `cast wallet import` (an encrypted keystore) or Foundry's Docker image
> (`ghcr.io/foundry-rs/foundry`) instead.

**B3. Get test ETH (for transaction fees).** Open the
[Google Cloud Sepolia faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia),
paste your Address, request. It's free.

**B4. Get 1 test USDC.** The test token lets anyone mint it:

```sh
cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "mint(address,uint256)" $ADDRESS 1000000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key $KEY
```

**B5. Put 0.20 USDC into Telegraph's payment account** (about 10 answers). Telegraph takes
payment from this pre-paid balance. Run these two, one after the other:

```sh
cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "approve(address,uint256)" \
  0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b 200000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key $KEY
cast send 0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b "depositUSDC(uint256)" 200000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key $KEY
```

If the second one fails with "insufficient allowance", wait 10 seconds and run it again.

Check: open `https://devnode.telegraphprotocol.com/v1/ledger/account/<your Address>`. `available`
should be about `0.2`.

## Part C: connect the bot (5 min, in the browser)

**C1. Give the bot the wallet key.** In your fork: **Settings → Secrets and variables → Actions →
Secrets tab → New repository secret**.

- Name: `TELEGRAPH_EVM_PRIVATE_KEY`
- Secret: the Private key from B2

**C2. Nothing else to set for a test.** The workflow file in C3 already contains defaults: the
bot pays only for releases published after **1 Jan 2026**, a date assumed to be after your AI
model's training cutoff, so it can't know about those releases.

For real use, set your own model's date: **Variables tab → New repository variable**:

| Name | Value |
| --- | --- |
| `MODEL_CUTOFF` | the "training data cutoff" from your model provider's page, e.g. `2025-03-01` |
| `MODEL_CUTOFF_SOURCE_URL` | that page, e.g. [Anthropic's](https://docs.anthropic.com/en/docs/about-claude/models/overview) or [OpenAI's](https://platform.openai.com/docs/models) |
| `MODEL_CUTOFF_STATUS` | `team-assumed`, or `provider-documented` together with `MODEL_PROVIDER` and `MODEL_ID` (see the [README](../README.md#install-in-your-repository-5-minutes)) |

**C3. Add the first workflow file.** On your fork's main page: **Add file → Create new file**.

- In the file name box type exactly `.github/workflows/telegraph-dependency-updates.yml`. Typing
  the `/` creates the folders.
- Paste the text below.
- Click **Commit changes** → **Commit directly to the main branch** → **Commit changes**.

> **Check your branch name.** In the file below, line 5 says `branches: [main]`. Replace `main`
> with your repository's default branch: the name shown on the branch button on its main page
> (often `main`, sometimes `master` or `develop`). Without this, the bot still runs with **Run
> workflow**, but not automatically after a push.

```yaml
name: Telegraph dependency updates

on:
  push:
    branches: [main]
    paths: ['**/package.json', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/bun.lock', '**/requirements*.txt', 'requirements/**']
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
          MODEL_CUTOFF: ${{ vars.MODEL_CUTOFF || '2026-01-01' }}
          MODEL_PROVIDER: ${{ vars.MODEL_PROVIDER }}
          MODEL_ID: ${{ vars.MODEL_ID }}
          MODEL_CUTOFF_SOURCE_URL: ${{ vars.MODEL_CUTOFF_SOURCE_URL || 'https://docs.anthropic.com/en/docs/about-claude/models/overview' }}
          MODEL_CUTOFF_STATUS: ${{ vars.MODEL_CUTOFF_STATUS || 'team-assumed' }}
          PREFERRED_MINER_ID: ${{ vars.PREFERRED_MINER_ID || '7314' }}
```

This one does the work: reads your dependencies, buys the answers, opens the pull requests. The
line `uses: borodedamie/telegraph-pr-agent@v1` is where GitHub downloads the bot from.

<details>
<summary><b>Don't want to commit to the main branch?</b> Use a test branch instead (click to expand)</summary>

The bot opens its pull requests into the branch it ran on, so it can live entirely on a test
branch:

1. Create a branch, e.g. `telegraph-test`, from the branch button on the repository's main page.
2. In C3 and C4, switch to `telegraph-test` before **Add file**, and commit to it.
3. In the C3 file, set `branches: [telegraph-test]` and **delete the `paths:` line**. Then
   committing the workflow file is itself the push that starts the first run.
4. Skip D1: the **Run workflow** button only appears for files on the default branch. Watch the
   run in the **Actions** tab instead; to run it again, push any commit to `telegraph-test`.

The bot's PRs then target `telegraph-test`, and your main branch is never touched. On the spend
page, a PR merged into `telegraph-test` shows as closed, not merged, unless you add the variable
`MERGE_BRANCHES` = `telegraph-test`.

</details>

**C4. Add the second workflow file** the same way, named
`.github/workflows/telegraph-pr-outcomes.yml`:

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

This one only records when you merge or close one of the bot's pull requests. It has no wallet
key and never runs the pull request's code.

## Part D: run it and look (2 min)

**D1. Run.** **Actions tab → Telegraph dependency updates** (left list) **→ Run workflow → Run
workflow**. Wait about a minute until it turns green.

**D2. Look at the result.**

- **Pull requests tab:** one PR per dependency update. Paid ones have **What changed** and
  **Where this repository uses what changed**. Updates released before the cutoff get a free PR
  with links only.
- **Spend page:** `https://telegraph-pr-agent.vercel.app/?repo=<your user>/<your fork>`, every
  purchase with its receipt. The run log and every PR also link it.
- A new branch `ledger` in your fork holds the purchase records. Leave it there.

**D3. Optional:** merge one PR. The spend page then shows "cost per merged PR".

## If something goes wrong

| What you see | Fix |
| --- | --- |
| The run fails with `403` when opening PRs | Step A3 wasn't saved. Tick it and re-run: answers already bought are reused, not paid again |
| No **Run workflow** button | The file from C3 isn't in `.github/workflows/` on the main branch, or Actions is off (A2) |
| Payment refused / nothing bought | Check `available` from B5 is above 0 |
| Doesn't run on its own after a push | `branches: [main]` in the C3 file doesn't match your default branch. Change it |
| Green run but no PRs | No dependency has a newer release. Try another project |

---

## How it decides to spend

- It buys only for releases dated after `MODEL_CUTOFF`. That's a lookup of the release date on the
  package registry, not a model's guess.
- Before paying, it checks that your package manager can actually install the new version. If it
  can't, it skips the update and buys nothing.
- An upgrade already proposed is not proposed again.
- Limits: 0.10 USDC per answer and 2 USDC per run by default, plus an optional monthly budget. A
  payment interrupted halfway can't be paid twice.
- A human merges. The bot never merges, and it uses no AI of its own: everything it knows, it buys.

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
