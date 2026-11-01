# Telegraph PR Agent — Plan

1 Nov 2026 · Mission: [Model Economy](https://hackathon.telegraphprotocol.com/missions/model-economy), "The coding agent that buys what it does not know". Who does what: [TEAM.md](TEAM.md).

## What it is

A GitHub Action, installed with one YAML file. It finds dependencies newer than the AI model's training cutoff, buys what the model does not know on Telegraph, opens a draft PR explaining the upgrade, and, once a maintainer approves with a label, fixes the code, tests it and reports the cost per merged PR.

## The flow (daily schedule or manual run)

1. **Scan (free).** Read `package.json` and the lockfile. List outdated direct npm dependencies and known vulnerabilities in the installed versions (OSV).
2. **Learn (paid, automatic, about 0.01 USDC).** Only for versions released after the model's cutoff: buy `QUESTION_ANSWERING` on Telegraph: "what changed from installed A to proposed B: breaking changes, renamed or removed functions, migration steps, sources".
3. **Report (free).** Open a draft PR with the version bump and: why upgrade, vulnerabilities in the current version, which functions changed, which files in this repo use them, what to change so the code does not break, and "spent X so far, fix about Y; add the label `telegraph:fix` to continue". Closing the PR stops all spend.
4. **Fix (after the label, about 0.03 USDC).** Buy `CODE_GENERATION` for the affected code, using the answer from step 2. Buy `CODE_PATCH_VERIFY` (builds and runs) and `REGRESSION_VERIFY` (old behaviour still holds). Then run the repo's own tests in a job with no secrets. All pass: push and mark the PR ready for review. Otherwise no push; comment with the diff and what failed. No usable `CODE_GENERATION` answer: our own LLM writes the patch; the two verifications still run.
5. **Merge.** A human reviews and merges.
6. **Account.** Merge → ledger row → dashboard. Cost per merged PR = all spend (Telegraph, our LLM, declined proposals) ÷ merged bot PRs, shown with the count, the merge rate and a testnet label.

## Rules we keep

- Buy only what the model does not know: nothing for versions older than the cutoff.
- Two spend caps, one for step 2 and one for step 4. Re-quote before paying; 0.01 is a floor.
- The installer's own low-balance wallet in repo secrets pays; jobs that run repo code never see any key.
- One ledger row per paid call, keyed by receipt hash; merge rows separate.
- One draft PR per package and version, updated, never duplicated.
- Miner answers are untrusted text: PR body and LLM prompt only.
- All cited evidence is dated 1 Nov to 1 Dec; both wallets and our own miner are disclosed.

## Scope for 14 Nov

npm only, direct dependencies, one package per PR, one full cycle on a fixture repo, plus one failure case: a patch that fails typecheck is not pushed. Cut for now: PyPI, multi-package PRs, cross-repo dashboard, auto-merge.

## Devnode facts, 1 Nov

Payments on Ethereum Sepolia (`eip155:11155111`), 0.01 USDC per call. Intent ids end in `_GENERAL`. Miners per intent: `GET /engine/v1/intents/{intent}/miners`. No current `QUESTION_ANSWERING` miner knows package releases; ours fills that gap.
