# Code-generation gate, 22 Nov 2026

The fix-stage gate from SPEC §2.9 (team decision 19 Nov 2026): can a Telegraph
`CODE_GENERATION_GENERAL` miner migrate a real file so the repository's own typecheck and tests
pass, using our paid "what changed" answer as input?

**Result: not passed.** 0 of 3 patches passed. The three paid answers were byte-identical (same
`as_of`), so in practice this was one attempt.

## Setup

- Fixture: [`borodedamie/telegraph-fix-fixture`](https://github.com/borodedamie/telegraph-fix-fixture),
  zod 3.25.76 with four APIs zod 4 removed, and 6 behaviour tests. On zod 4.6.7 the unchanged
  code has 5 type errors; a correct hand migration passes typecheck and all 6 tests.
- Paid "what changed" answer: the Action's purchase on that repository, PR
  [#1](https://github.com/borodedamie/telegraph-fix-fixture/pull/1) (zod 3.25.76 → 4.6.7, miner
  7314, 0.02 USDC, escrow), receipt `0xac670c43efc3c07ea7059854290c3bc5510f6ba03a5393d937098bda0bf07ba9`.
- Code miner: CodeWire `1900999002`, the only live `CODE_GENERATION_GENERAL` miner that writes
  code (the other 12 are data feeds). Unscored, registered 18 Nov 2026, MiniMax-M2.5-highspeed.
- Request ([request.txt](request.txt), 6,176 characters): the file plus the paid answer's
  documented changes, those naming identifiers used in the file first.
- Script: `bot/scripts/codegen-gate.ts`. `buy` held the wallet key and never ran miner code.
  On 22 Nov, `check` ran install, typecheck and tests on the host, on a copy with an empty
  environment, after the returned file had been read: it imports only zod and has no file,
  network or process access. Review (#64) found that the host check could still read local files,
  so `check` now runs typecheck and tests in a Docker container with no network, no capabilities
  and only the copy mounted. Re-checked that way on 23 Nov: same result.

## Purchases (approved test spend, team wallet `0x85Bb…35C8`, escrow)

| Attempt | Amount | Receipt | Signal |
| --- | --- | --- | --- |
| 1 | 0.01 USDC | `0x3b774bfc160c8059b148e1aae35541297f1af7c76b799c913720f9c99613e367` | `0xafe4021187df4fdf716eca13249277c9c5fb599224423e196a77e2dac764ba7e` |
| 2 | 0.01 USDC | `0xc2b13fee76bb1975ce0f2e25d50cfd23dc4c8111618b2c83addabda4fb09a735` | `0x92fc0412a1335103a2346fe447de13d16a93884a5200728b29e863cf00a4fb07` |
| 3 | 0.01 USDC | `0xbc350a68b71fa06f41bdfc28efde2f5ff12fdb1858369de5247f88457eff5d51` | `0xb15daf347582c14f795d9f557cbbb3e9e7f10c65812591fb478b7d9f6f5b0a0e` |

Self-run test purchases by the team; not adoption. The answer is in [answer.json](answer.json).

## What failed and why

All three failed typecheck on one line: `z.record(z.string())`, the one-argument form zod 4
removed (`TS2554: Expected 2-3 arguments, but got 1`). The other three breaking uses were migrated
correctly (`required_error` / `invalid_type_error` to `error`, `.ip()` to a v4 IP check, `.errors`
to `.issues`), with the exact error messages kept. With that one line corrected by hand, the
patch passes typecheck and all 6 tests; that correction is ours, so it is not counted as a pass.

The paid answer is the likely cause: the request listed miner 7314's item as
"4.0.0: drops single argument usage", without naming `z.record`, so the code miner had no way to
know which call to change.

## Observations for the fix stage

- Identical requests are answered from a cache and still charged. Retries need a different
  request, or should not be made.
- The code miner answers in JSON, with the code in a single fenced block inside `summary`.
- The call-site report on PR #1 also missed `.errors` and `.ip()`: names written as
  `` `.errors` `` or `` `z.string().ip()` `` are not extracted yet.
