# Code-generation gate, run 2, 23 Nov 2026

The re-run agreed after [run 1](../codegen-gate-2026-11-22/README.md) (SPEC §2.9). Run 1 failed
on `z.record(z.string())` because our paid answer described that change without naming the API.
That input was fixed: miner 7314 now says "`z.record()`: drops single argument usage" (#62,
deployed as `p10`), and the call-site report finds `.errors` and `.ip()` (#63).

**Result: not passed. The code miner was unavailable both times and returned no code.**
Under the 22 Nov decision the fix stage is skipped for the submission; PRs keep the call-site
report.

## Setup

- Fixture: [`borodedamie/telegraph-fix-fixture`](https://github.com/borodedamie/telegraph-fix-fixture),
  moved to zod 3.25.75 so the bot bought a fresh answer from the updated miner instead of reusing
  the saved one. PR [#2](https://github.com/borodedamie/telegraph-fix-fixture/pull/2) (3.25.75 →
  4.6.7, miner 7314, 0.02 USDC, escrow, `p10`), receipt
  `0x93be55cb580d9f02d7eebb7ac8e2fe4f6b50c54ff398456f87e8cc722cc2466b`.
- Request ([request.txt](request.txt), 6,136 characters): the file and the paid answer's changes,
  now including "`z.record()`: drops single argument usage". The retry added one line,
  "Retry after a model outage.", so it could not be answered from a cache.
- Code miner: CodeWire `1900999002`, still the only live `CODE_GENERATION_GENERAL` miner that
  writes code.

## Purchases (approved test spend, team wallet `0x85Bb…35C8`, escrow)

| Request | Time (UTC) | Amount | Receipt | Signal | Answer |
| --- | --- | --- | --- | --- | --- |
| 1 | 10:51 | 0.01 USDC | `0xc1ea9d39c9800ec73b65a66876938a01fe129d58c6c73ac36719a0cb6ca2696f` | `0xcc5c0ac54097cf38db85b799969cb7948494e72cf08c541dc513c2b44f2efbc3` | [answer-1.json](answer-1.json) |
| 2 (retry) | 11:00 | 0.01 USDC | `0xa7188e2b787a3d7c47470e8cf78380e9b975b5b55a53140d3fea34e33d546f9e` | `0x7d63a2491c6aed13cb621142d2d7cfbfbac25670658ba7579f67e6915451120e` | [answer-2.json](answer-2.json) |

Both answers are the miner's error reply, `{"error": "model unavailable", "detail": "Error:
minimax returned no answer text", "confidence": 0.2}`, with different `as_of` times, so the retry
was not a cached copy. Both were delivered as normal answers and charged. No code was returned, so
`check` had nothing to run.

## What this means

- Across both runs the only code-writing miner produced one patch (run 1, failed on input we have
  since fixed) and two outages.
- A paid error reply is charged like an answer. A fix stage built on this miner would need its own
  handling for that, besides the spend cap.
- The gate can be re-run later with `bot/scripts/codegen-gate.ts` if a code miner becomes
  reliable; nothing in the Action depends on it.
