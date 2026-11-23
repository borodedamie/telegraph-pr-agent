# ADR 0002: Build `telegraph:fix` on Telegraph's ranked miners

Status: **Proposed, for the team to decide** (drafted 23 Nov 2026)
Supersedes, if accepted: the 19 Nov gate rule in SPEC §2.9 ("build only if a pinned miner passes 2–3 test patches")

## Context

- The mission is that the agent buys what it doesn't know *and continues*. Today the bot buys the "what changed" answer and opens a PR with the changes and the call sites, but a person still edits the code.
- The 19 Nov rule tied the fix stage to one miner passing a test in advance. The gate failed:
  - run 1 (22 Nov): CodeWire's patch failed typecheck on one line, because our own answer didn't name `z.record` (fixed in #62);
  - run 2 (23 Nov): CodeWire returned "model unavailable" twice, and both replies were charged.
  
  Evidence: [run 1](../telegraph/codegen-gate-2026-11-22/README.md), [run 2](../telegraph/codegen-gate-2026-11-23/README.md).
- Telegraph already ranks miners per intent on its leaderboard. Buying from the best-ranked miner for the job is how Telegraph is meant to be used, and it's what we say "before production" in the commercial summary.
- Leaderboard on 23 Nov (epoch 37, active miners only, `GET /api/miners?intent=CODE_GENERATION_GENERAL`):

  | Rank | Miner | Score | Writes code? |
  | --- | --- | --- | --- |
  | 2 | CodeWire `1900999002` | 0.93 | yes (MiniMax model) |
  | 4–13 | ten data feeds (GitHub commits, npm metadata, OSV, …) | 0 | no |

  Ranks 1 and 3 are not active. For checking a patch there is more supply: `CODE_PATCH_VERIFY_GENERAL` has 25 miners and `REGRESSION_VERIFY_GENERAL` has 21.

## Proposal

Build the stage, and let it check itself on every run instead of requiring a one-off gate. The bot buys from whichever miner Telegraph ranks highest at that moment, and a patch is only ever pushed if the repository's own tests pass.

1. **Trigger.** A maintainer adds the `telegraph:fix` label to a bot PR. Only users with write access can add labels. Closing the PR stops everything.
2. **Buy (job with the wallet; never runs repository code).** For each file in the PR's call-site report (at most 3):
   - **Request:** the file plus the paid "what changed" answer.
   - **Routing:** Telegraph's leaderboard for `CODE_GENERATION_GENERAL` in rank order, **skipping miners with score 0 or no score**, at most 2 miners. Each purchase is recorded on the ledger with `selectedBy: "rank"`, the miner's rank and score, and the epoch.
   - **Usable answer:** exactly one code block for exactly that file. An error reply or anything else is unusable: it is recorded, and the bot does not try that miner again for that file.
3. **Test (job with no secrets, read-only token).** Apply the files, then run the repository's install, typecheck and tests. The test command comes from a new input `fix-test-command` (default `npm test`).
4. **Publish (job with write access, no wallet).**
   - **Everything passes:** commit the files to the PR branch and comment with the miner, its rank, the cost, the receipts and the test result.
   - **Anything fails:** push nothing, and comment with the diff and what failed.
   - Never merge.
5. **Spend controls.**
   - A separate `fix-budget-usdc` cap per PR (proposed default 0.10), on top of the existing per-call price cap and monthly budget.
   - Error replies are charged (seen on 23 Nov), so a miner that fails once isn't asked again in that run.
   - Fix purchases count in cost per merged PR, like the Q&A purchase.
6. **Later, optional:** check the patch by buying `CODE_PATCH_VERIFY_GENERAL` from its top-ranked miner as well. Local tests stay mandatory either way, and a failed or unavailable verifier never blocks the stage (SPEC §2.9).

## Consequences

- **Positive:**
  - The first purchase drives code that passes tests: the mission's "continues".
  - Uses Telegraph as designed (ranked selection) and shows it in the ledger and the README.
  - No miner is hard-coded, so the stage improves as better code miners join.
- **Negative:**
  - Today ranked routing resolves to CodeWire alone, which was unavailable twice on 23 Nov. The stage may often end with "no usable patch" and a charged error reply. The PR then still has the call-site report, so nothing is lost but up to 0.02 USDC per file.
  - About 4–5 days of work: a new workflow file for installers, three jobs, new inputs, and ledger rows. It competes with the demo, the tutorial and the third public update before 1 Dec. A cut-off date is needed (below).
  - Running untrusted code from a miner needs the same isolation as the gate check, in a job with no secrets.
- **Unchanged:** the bot still uses no LLM of its own or the installer's (19 Nov decision). Patches only come from Telegraph miners.

## Questions for the team

1. Accept ranked routing and the per-run self-check, replacing the 19 Nov gate rule?
2. Skip miners with score 0, and try at most 2 miners per file?
3. Defaults: `fix-budget-usdc` 0.10 per PR, at most 3 files per PR, `fix-test-command` `npm test`?
4. Cut-off: if the stage isn't merged and run live on the fixture by **28 Nov**, ship the documentation below only, and keep the call-site report as what PRs offer?
5. Should the Q&A purchase also default to ranked routing instead of `PREFERRED_MINER_ID` 7314, for consistency? It's our own miner, so ranked routing would also help the related-party question.

## Proposed README text for judges (added once the team decides)

> **How the bot chooses a miner.** The bot buys from Telegraph's leaderboard: for each intent it asks
> the node for the active miners ranked for that intent and tries them in rank order, skipping any
> with no score or a score of 0, at most two per request. Each purchase on the ledger records the
> miner, its rank and score, and the epoch the ranking came from, so a reviewer can check the choice
> against Telegraph's own data. For `telegraph:fix`, a returned patch is pushed only if the
> repository's install, typecheck and tests pass in a job with no secrets; otherwise the PR gets a
> comment with the diff and the failure, and nothing is pushed. On 23 Nov 2026 the only ranked
> code-writing miner was CodeWire (rank 2, score 0.93); our gate tests with it are linked in SPEC §2.9.
