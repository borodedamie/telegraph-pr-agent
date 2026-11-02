# Telegraph PR Agent — Plan

Revised 2 Nov 2026 · Mission: [Model Economy](https://hackathon.telegraphprotocol.com/missions/model-economy), "The coding agent that buys what it does not know". Requirements: [SPEC.md](SPEC.md) (source of truth; this plan only summarises milestones). Who does what: [TEAM.md](TEAM.md).

## What it is

A GitHub Action, installed with one workflow file. It finds dependencies with a new stable release published after the AI model's cutoff, buys release intelligence on Telegraph, opens a draft PR explaining the upgrade, and, once a maintainer approves with a label, writes the fix with the installer's LLM, tests it and reports the cost per merged PR.

## The flow (developer-configured schedule, default weekly, or manual run)

1. **Scan (free).** Read the installed version A from `package-lock.json` and the latest stable version B from npm. Eligible when B > A and B was released after `MODEL_CUTOFF` (SPEC §2.3). Known vulnerabilities in A come from OSV.
2. **Learn (paid, automatic).** One Q&A purchase through Telegraph Engine routing on the live canonical intent (`QUESTION_ANSWERING_GENERAL` on 2 Nov): "what changed from A to B: breaking changes, renamed or removed functions, migration steps, sources". This is the one mandatory paid operation.
3. **Report (free).** Open or update one draft PR per package and target: why upgrade, vulnerabilities in A, which symbols changed, which files in this repo use them (local search), what to change, spend so far, estimated fix cost, and "add the label `telegraph:fix` to continue". Closing the PR stops all spend.
4. **Fix (after the label).** The installer's LLM writes the patch with the purchased answer as a material input. The repository's install, typecheck and tests run in a job with no secrets. All pass: push and mark ready for review. Otherwise nothing is pushed; comment with the diff and what failed. Telegraph `CODE_GENERATION` and paid verification are optional experiments until a provider passes our tests (SPEC §2.9).
5. **Merge.** A human reviews and merges.
6. **Account.** Merge → ledger → dashboard. Cost per merged PR = all net spend (Telegraph, LLM, declined proposals) ÷ merged bot PRs, shown with counts, merge rate and a testnet label; also cost per useful answer.

## Rules we keep

- Buy only for post-cutoff releases; nothing for versions released before the cutoff.
- Two spend caps, one for step 2 and one for step 4. Every payment is re-quoted; the 402 challenge sets the price. Any cost figure here is an illustrative estimate, not a price.
- The installer's own low-balance wallet in repo secrets pays; jobs that run repo code never see any key.
- Durable attempt records before each paid call; an ambiguous attempt blocks automatic retry until reconciled (SPEC §2.6).
- One draft PR per package and version, updated, never duplicated.
- Miner answers are untrusted text: PR body and LLM prompt input only.
- Hackathon purchases, transactions, usage, demos and adoption evidence claimed for Season II fall in 1 Nov–1 Dec 2026. Package release notes and registry records keep their original dates, including dates before the event.
- Both wallets, our own miner and any self-purchases are disclosed; self-purchases never count as adoption.

## Two tracks, two gates

- **Apps & Agents (primary).** Never waits on our miner. It may buy from any suitable provider.
- **Miner (secondary).** Go/no-go on **9 Nov** (proposed; owner in TEAM.md). Go only if the chosen canonical QA intent can score a package-release answer: scoring module present, evaluation pool eligible (≥ 5 distinct submitters), truth-source path defined, response contract compatible. On 2 Nov none of these held for `QUESTION_ANSWERING_GENERAL` ([contract snapshot](telegraph/qa-intent-contract-2026-11-02.md)). No-go: stop the miner build; A moves to App work.

## 14 Nov internal milestone — acceptance

On one public fixture repository:

- [ ] One npm package with a documented installed version A, target B and the release-note sources for A→B.
- [ ] One delivered paid Q&A answer through Engine routing, with receipt, signal and tx recorded.
- [ ] The answer is checked against its sources and visibly changes the generated patch.
- [ ] One draft PR, one human `telegraph:fix` label, one generated migration.
- [ ] Install, typecheck and tests pass in the secretless job; the validated patch is pushed.
- [ ] Failure case: a patch that fails typecheck is not pushed.
- [ ] No-spend case: no post-cutoff dependency, no purchase, no PR.
- [ ] Ledger has attempt and receipt records for the run.

A complete reviewable cycle is enough for 14 Nov; the merge and its accounting row may follow.

Cut for now: PyPI in the Action, multi-package PRs, workspaces, cross-repo dashboard, auto-merge.

## 1 Dec final

Public summary, 2–5 minute demo, reproducible run instructions, evidence pack, five-question commercial summary, showcase permissions, at least three public updates on separate dates. Details: SPEC §5.
