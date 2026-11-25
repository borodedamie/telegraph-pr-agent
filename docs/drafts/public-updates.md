# Public updates: drafts

Drafts for more posts on X or LinkedIn. The three required public updates are already done (team
posts on 14, 22 and 24 Nov, linked in the README), so these are extra. Numbers are as of 22–24 Nov;
re-check them on the dashboard before posting. Update 3 is now [docs/TUTORIAL.md](../TUTORIAL.md).

Every post must say it's a hackathon entry (the rules require disclosing participation and the prize
incentive), tag @Telegraphprotoc on X, and link a Telegraph doc or repo. Add this line to each:
"Entry in the Telegraph Hackathon Season II (prize competition) · docs: https://docs.telegraphprotocol.com"
Also invite people to try it ("try it on your repo, open an issue with what happened"): that
earns the activation points.

Links used:
- Repo: https://github.com/borodedamie/telegraph-pr-agent
- Dashboard: https://telegraph-pr-agent.vercel.app
- Miner: https://telegraph-pr-miner-n30sk.vercel.app

---

## Update 1: build announcement (25 Nov)

**Short version (X, one post):**

> Your AI coding assistant has a training cutoff. Your dependencies don't.
>
> We built Telegraph PR Agent: a GitHub Action that notices when an upgrade is past your model's
> cutoff and **buys** a sourced answer ("what changed from A to B?") from a miner on
> @Telegraphprotoc, then opens a PR with the breaking changes and where your code uses them.
>
> ~0.02 test USDC per upgrade, every purchase on a public ledger.
> https://github.com/borodedamie/telegraph-pr-agent

**Long version (LinkedIn or an X thread):**

1/ Dependabot and Renovate bump your dependencies but don't tell you what breaks. An AI assistant
can't know either: any release after its training cutoff is invisible to it. So someone still reads
release notes by hand.

2/ For the Telegraph Hackathon (Model Economy) we built an agent that knows when it doesn't know,
and buys the missing knowledge:
- it reads your lockfile and finds upgrades released after your model's cutoff;
- for each one it pays a Telegraph miner for "what changed between your version and the new one";
- it opens one PR per upgrade: breaking changes first, each with its migration step and a verbatim
  quote from the release notes, plus links to the lines in your repo that use the changed APIs.

3/ We also built the seller: miner 7314, Package Release Intelligence. It only answers one
question, what changed in an npm package between two versions. Versions, dates and links never come
from a model, and every quote is checked against its source. If it can't find the answer, it says
so.

4/ Every purchase, PR, merge and close is written to a public ledger in your own repo. The dashboard
turns that into one number: **cost per merged PR**.

Testnet only (Ethereum Sepolia test USDC). We run both the bot and the miner, so our own purchases
are tests, not demand.
Repo: https://github.com/borodedamie/telegraph-pr-agent

---

## Update 2: a real purchase and what it did (27 Nov)

> One real run, start to finish.
>
> On 21 Nov our GitHub Action ran on a real repo (`lemind/onewallet-radar`):
> - it saw two updates past the model's cutoff;
> - `@types/node`: an earlier answer had been unusable, so it skipped it and **paid nothing**;
> - `undici` 8.11.2 → 8.13.1: it paid **0.02 test USDC** to Telegraph miner 7314, received a sourced
>   change list with a receipt and a signal hash, and opened PR #12;
> - the maintainer read it and merged it. A second workflow recorded the merge on the repo's public
>   ledger, and the dashboard showed the cost per merged PR: **0.17 USDC** for that repo, all
>   attempts included.
>
> Across 12 repos by 24 Nov, including two run by outside developers who tried it: 134 paid answers
> and 21 paid PRs merged, among them `next` 14 → 16, `react` 18 → 19 and `tailwindcss` 3 → 4.
> (Testnet. Team wallets paid, and the miner is ours, so this is testing, not revenue.)
>
> Each purchase links its receipt: https://telegraph-pr-agent.vercel.app

Attach: a screenshot of PR #12's "What changed" section and of the dashboard row.

Optional second post, the honest negative result (good engagement):

> We tried the next step: give our paid "what changed" answer to a code-writing miner and let it
> migrate the code. zod 3 → 4 on a test repo: it got 3 of 4 breaking uses right and failed
> typecheck on `z.record(z.string())`. The cause was **our** answer, which said "drops single
> argument usage" without naming `z.record`. We fixed the miner (p10). The lesson: an agent's work
> is only as precise as the knowledge it bought.

---

## Update 3: technical tutorial (29 Nov)

Post as a GitHub Discussion, a dev.to article or a long LinkedIn post, then share the link on X.
It's also the "technical tutorial" item for the submission.

### Title: Give your repo an agent that buys what its AI doesn't know (10-minute setup, testnet)

**What you get:** for every dependency update released after your coding model's training cutoff,
a PR that lists the documented breaking changes, deprecations and security fixes, each with a quote
and a source link, plus the lines in your repo that use them. Each answer costs about 0.02 test
USDC, paid to a miner on Telegraph and recorded in your repo.

**You need:** a public GitHub repo with an npm, pnpm, Yarn or Bun lockfile (or exact Python pins),
and Foundry's `cast` (https://getfoundry.sh).

**1. A fresh testnet wallet.** Never reuse a real one.
```sh
cast wallet new
```
- Get Sepolia ETH for gas from the Google Cloud faucet:
  https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- Mint 1 test USDC. The Sepolia test token has an open `mint`:
```sh
export KEY=<your new private key>
cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "mint(address,uint256)" <your address> 1000000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$KEY"
```

**2. Deposit into Telegraph escrow (one time).** Telegraph takes payment from a pre-funded balance:
```sh
cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "approve(address,uint256)" \
  0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b 200000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$KEY"
cast send 0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b "depositUSDC(uint256)" 200000 \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$KEY"
```
0.20 USDC is about 10 answers. Check `available` at
`https://devnode.telegraphprotocol.com/v1/ledger/account/<your address>`.

**3. Repo settings.**
- Settings → Actions → General → tick **Allow GitHub Actions to create and approve pull
  requests**.
- Add the secret `TELEGRAPH_EVM_PRIVATE_KEY` (the new key).
- Add the variables `MODEL_CUTOFF` (e.g. `2026-01-01`), `MODEL_CUTOFF_SOURCE_URL` and
  `MODEL_CUTOFF_STATUS` (`team-assumed` or `provider-documented`).

**4. Two workflow files.** Copy them from the README:
https://github.com/borodedamie/telegraph-pr-agent#install-in-your-repository-5-minutes. One scans and
opens PRs. The other records merges and closes, which is what "cost per merged PR" is computed from.

**5. Run it.** Actions → Telegraph dependency updates → Run workflow. Then open
`https://telegraph-pr-agent.vercel.app/?repo=<owner>/<repo>`.

**How it decides to spend (worth knowing):**
- It buys only for releases dated after `MODEL_CUTOFF`. That's a deterministic registry check,
  not a guess by a model. Older updates get a free PR with links.
- Before paying, it checks that your package manager can actually install the target; if not, it
  skips the update with npm's reason.
- There's a per-call cap (0.10), a per-run cap (2 USDC) and an optional monthly budget. An
  interrupted payment can't be paid twice: it waits for reconciliation.

**What we learned building on Telegraph:**
- Escrow payments are about 6× faster than per-call on-chain payments in our tests (median 2.0 s vs
  13.3 s).
- Ask a specialised miner by id. Engine routing sent package questions to a web-search intent.
- A cached answer is still charged, so make retries different requests.
- Treat miner answers as untrusted input: we verify every quote against its source, and generated
  code only runs in a job without secrets.

Feedback welcome: open an issue with what you ran and whether the answer was useful.
https://github.com/borodedamie/telegraph-pr-agent/issues
