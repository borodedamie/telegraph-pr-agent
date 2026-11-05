import { describe, expect, it, vi } from "vitest";
import {
  AskFailedError,
  type AttemptEvent,
  BudgetCapError,
  IntelligenceClient,
  PaymentUnknownError,
  PriceGuardError,
  paymentConfig,
  rankMiners,
} from "../src/x402.js";

const CHAIN_ID = 11155111;
const CHAIN = `eip155:${CHAIN_ID}`;
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";

// Real devnode wire format: the 402 challenge rides the `payment-required`
// header as base64 JSON, amount in atomic units, and accepts[] carries an EVM
// `exact` entry plus other options (Solana here; `escrow` in other tests).
function challengeBody(evmAmountAtomic: string, solAmountAtomic = "999999") {
  return {
    x402Version: 2,
    accepts: [
      { scheme: "exact", network: CHAIN, amount: evmAmountAtomic, asset: USDC, payTo: "0xPayTo", extra: { name: "USD Coin", version: "2" } },
      { scheme: "exact", network: "solana:EtWTRAB", amount: solAmountAtomic, asset: "4zMM", payTo: "G53E" },
    ],
  };
}

const b64 = (o: unknown) => btoa(JSON.stringify(o));
const settle = (success: boolean, tx = "0xdeadbeef") => b64({ success, transaction: tx, network: CHAIN });
const quote402 = (atomic: string) =>
  new Response("null", { status: 402, headers: { "payment-required": b64(challengeBody(atomic)) } });

// Shape of GET /api/miners?intent=… on the devnode: scores[] holds one entry
// per intent the miner is ranked on.
const API_MINERS = [
  {
    id: "148001",
    name: "OpenAlex QA",
    endpoints: [{ path: "/query", method: "GET", description: "Query for intent QUESTION_ANSWERING" }],
    scores: [{ intent_id: "QUESTION_ANSWERING", rank: 4, score: 0.47 }],
  },
  {
    id: "302",
    name: "ChainSight",
    endpoints: [
      { path: "/price", method: "GET", description: "CRYPTO_PRICE" },
      { path: "/qa", method: "GET", description: "Direct factual question answering (QUESTION_ANSWERING)." },
    ],
    scores: [{ intent_id: "CRYPTO_PRICE", rank: 1, score: 0.9 }], // not ranked for QA
  },
  {
    id: "148002",
    name: "Crossref QA",
    endpoints: [{ path: "/query", method: "GET", description: "Query for intent QUESTION_ANSWERING" }],
    scores: [{ intent_id: "QUESTION_ANSWERING", rank: 3, score: 0.59 }],
  },
];

const LONG_ANSWER = "zod 4.6.7 changes .refine: ".padEnd(800, "x");
function engine200(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({
      miner_id: "148002",
      miner_name: "Crossref QA",
      result: { answer: LONG_ANSWER },
      result_shape: "raw",
      signal_hash: "0xsignal",
      ...overrides,
    }),
    {
      status: 200,
      headers: {
        "payment-response": settle(true),
        "x-telegraph-receipt": b64({ receipt_hash: "0xreceipt", tx_hash: "0xdeadbeef" }),
        ...headers,
      },
    }
  );
}

function makeClient(overrides: Partial<ConstructorParameters<typeof IntelligenceClient>[0]> = {}) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    String(input).includes("/api/miners") ? new Response(JSON.stringify(API_MINERS)) : quote402("10000")
  );
  const paymentFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => engine200());
  const client = new IntelligenceClient({
    nodeUrl: "https://devnode.test/",
    evmPrivateKey: `0x${"a".repeat(64)}`,
    chainId: CHAIN_ID,
    usdcAddress: USDC,
    maxPricePerCallUsdc: 0.05,
    budgetCapUsdc: 0.5,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    paymentFetch,
    ...overrides,
  });
  return { client, fetchImpl, paymentFetch };
}

describe("rankMiners", () => {
  it("orders by the intent's leaderboard rank and drops miners not ranked for it", () => {
    const ranked = rankMiners("QUESTION_ANSWERING", API_MINERS);
    expect(ranked.map((m) => [m.id, m.rank, m.path])).toEqual([
      ["148002", 3, "/query"],
      ["148001", 4, "/query"],
    ]);
  });
});

describe("IntelligenceClient.buy", () => {
  it("pays the top-ranked miner and records receipt, signal, rank and the FULL answer", async () => {
    const { client } = makeClient();
    const p = await client.buy("QUESTION_ANSWERING", "what changed in zod 4.6.7?");
    expect(p).toEqual({
      intent: "QUESTION_ANSWERING",
      minerId: "148002",
      minerName: "Crossref QA",
      minerRank: 3,
      minerScore: 0.59,
      amountUsdc: 0.01,
      txHash: "0xdeadbeef",
      receiptHash: "0xreceipt",
      signalHash: "0xsignal",
      answer: LONG_ANSWER,
      status: "settled",
      network: CHAIN,
      chainId: CHAIN_ID,
      usdcContract: USDC,
      explorerBaseUrl: "https://sepolia.etherscan.io",
    });
    expect(client.spentUsdc).toBeCloseTo(0.01);
  });

  it("sends the miner's native request through the direct Engine endpoint", async () => {
    const { client, fetchImpl, paymentFetch } = makeClient();
    await client.buy("QUESTION_ANSWERING", "hello");
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://devnode.test/api/miners?intent=QUESTION_ANSWERING&status=active&limit=100"
    );
    const [url, init] = paymentFetch.mock.calls[0];
    expect(url).toBe("https://devnode.test/engine/v1/ask/148002");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ method: "GET", endpoint: "/query", payload: { query: "hello" } });
  });

  it("steps down to the next rank when the top miner's call fails (failed calls are free)", async () => {
    const paymentFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"upstream error 404"}', { status: 500 }))
      .mockResolvedValueOnce(engine200({ miner_id: "148001", miner_name: "OpenAlex QA" }));
    const { client } = makeClient({ paymentFetch });
    const p = await client.buy("QUESTION_ANSWERING", "x");
    expect([p.minerId, p.minerRank]).toEqual(["148001", 4]);
    expect(client.spentUsdc).toBeCloseTo(0.01);
  });

  it("throws AskFailedError naming each miner's failure when none answers", async () => {
    const paymentFetch = vi.fn(async () => new Response('{"error":"down"}', { status: 503 }));
    const { client } = makeClient({ paymentFetch });
    await expect(client.buy("QUESTION_ANSWERING", "x")).rejects.toThrow(/#3 148002: HTTP 503.*#4 148001: HTTP 503/);
    expect(client.spentUsdc).toBe(0);
  });

  it("treats settlement success: false as not charged and tries the next miner", async () => {
    const paymentFetch = vi.fn(async () => engine200({}, { "payment-response": settle(false) }));
    const { client } = makeClient({ paymentFetch });
    await expect(client.buy("QUESTION_ANSWERING", "x")).rejects.toBeInstanceOf(AskFailedError);
    expect(paymentFetch).toHaveBeenCalledTimes(2);
    expect(client.spentUsdc).toBe(0);
  });

  it("stops at the first miner when an answer has no settlement header (we can't tell if we paid)", async () => {
    const paymentFetch = vi.fn(async () => engine200({}, { "payment-response": "" }));
    const { client } = makeClient({ paymentFetch });
    await expect(client.buy("QUESTION_ANSWERING", "x")).rejects.toBeInstanceOf(PaymentUnknownError);
    expect(paymentFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a non-`answer` result whole rather than dropping it", async () => {
    const paymentFetch = vi.fn(async () => engine200({ result: { exit_status: 0, stdout: "ok" } }));
    const { client } = makeClient({ paymentFetch });
    expect((await client.buy("QUESTION_ANSWERING", "x")).answer).toBe('{"exit_status":0,"stdout":"ok"}');
  });

  it("pays the EVM accept even when the Solana accept is listed first", async () => {
    const body = challengeBody("10000");
    body.accepts.reverse();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/miners")
        ? new Response(JSON.stringify(API_MINERS))
        : new Response("null", { status: 402, headers: { "payment-required": b64(body) } })
    ) as unknown as typeof fetch;
    const { client } = makeClient({ fetchImpl });
    expect((await client.buy("QUESTION_ANSWERING", "x")).amountUsdc).toBeCloseTo(0.01);
  });

  it("quotes the `exact` accept when the `escrow` accept is listed first", async () => {
    const body = challengeBody("10000");
    body.accepts.unshift({ scheme: "escrow", network: CHAIN, amount: "99999999", asset: USDC, payTo: "0xDiamond" });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/miners")
        ? new Response(JSON.stringify(API_MINERS))
        : new Response("null", { status: 402, headers: { "payment-required": b64(body) } })
    ) as unknown as typeof fetch;
    const { client } = makeClient({ fetchImpl });
    expect((await client.buy("QUESTION_ANSWERING", "x")).amountUsdc).toBeCloseTo(0.01);
  });

  it("refuses and never pays when the challenge only offers another chain's USDC", async () => {
    const body = challengeBody("10000");
    body.accepts[0] = { ...body.accepts[0], network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/miners")
        ? new Response(JSON.stringify(API_MINERS))
        : new Response("null", { status: 402, headers: { "payment-required": b64(body) } })
    ) as unknown as typeof fetch;
    const { client, paymentFetch } = makeClient({ fetchImpl });
    await expect(client.buy("QUESTION_ANSWERING", "x")).rejects.toThrow(/no exact payment on eip155:11155111/);
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("honours the x-payment-response spelling too (x402 spec variant)", async () => {
    const paymentFetch = vi.fn(async () =>
      engine200({}, { "payment-response": "", "x-payment-response": settle(true, "0xspec") })
    );
    const { client } = makeClient({ paymentFetch });
    expect((await client.buy("QUESTION_ANSWERING", "x")).txHash).toBe("0xspec");
  });

  it("aborts with PriceGuardError when the live quote exceeds maxPricePerCallUsdc and never pays", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/miners") ? new Response(JSON.stringify(API_MINERS)) : quote402("60000")
    ) as unknown as typeof fetch;
    const { client, paymentFetch } = makeClient({ fetchImpl });
    await expect(client.buy("QUESTION_ANSWERING", "x")).rejects.toBeInstanceOf(PriceGuardError);
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("aborts with BudgetCapError when cumulative spend would breach budgetCapUsdc", async () => {
    const { client, paymentFetch } = makeClient();
    client.spentUsdc = 0.495;
    await expect(client.buy("QUESTION_ANSWERING", "x")).rejects.toBeInstanceOf(BudgetCapError);
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("reserves maxPricePerCallUsdc, not the quote, since a repriced call can settle up to it", async () => {
    const { client, paymentFetch } = makeClient(); // quote 0.01, max 0.05, cap 0.5
    client.spentUsdc = 0.46; // 0.46 + 0.01 fits; 0.46 + 0.05 does not
    await expect(client.buy("QUESTION_ANSWERING", "x")).rejects.toBeInstanceOf(BudgetCapError);
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("records the settled amount from the receipt, not the quote (dynamic pricing)", async () => {
    // The quote says 0.01 but the node repriced the paid call to 0.0125; the
    // receipt's amount_uusdc is what was actually charged and must win.
    const paymentFetch = vi.fn(async () =>
      engine200({}, { "x-telegraph-receipt": b64({ receipt_hash: "0xreceipt", amount_uusdc: "12500" }) })
    );
    const { client } = makeClient({ paymentFetch });
    const p = await client.buy("QUESTION_ANSWERING", "x");
    expect(p.amountUsdc).toBe(0.0125);
    expect(client.spentUsdc).toBe(0.0125);
  });

  it("routes the quote AND the paid request through an injected fetch (real wrap path)", async () => {
    // No paymentFetch injected: the constructor's wrapFetchWithPaymentFromConfig
    // must wrap the injected fetch, so both legs stay on it and global fetch —
    // the only transport a harness cannot observe — is never touched.
    const body = challengeBody("10000");
    body.accepts[0] = { ...body.accepts[0], payTo: `0x${"11".repeat(20)}` };
    let askCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/miners")) return new Response(JSON.stringify(API_MINERS));
      askCalls += 1;
      return askCalls === 1
        ? new Response("null", { status: 402, headers: { "payment-required": b64(body) } })
        : engine200();
    }) as unknown as typeof fetch;
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    try {
      const client = new IntelligenceClient({
        nodeUrl: "https://devnode.test/",
        evmPrivateKey: `0x${"a".repeat(64)}`,
        chainId: CHAIN_ID,
        usdcAddress: USDC,
        maxPricePerCallUsdc: 0.05,
        budgetCapUsdc: 0.5,
        fetchImpl,
        paymentFetch: undefined,
      });
      const p = await client.buy("QUESTION_ANSWERING", "x");
      expect(p.status).toBe("settled");
      expect(p.txHash).toBe("0xdeadbeef");
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("paymentConfig", () => {
  it("allow-lists only our USDC on our chain, capped at maxPricePerCallUsdc in atomic units", () => {
    const cfg = paymentConfig({
      evmPrivateKey: `0x${"a".repeat(64)}`,
      chainId: CHAIN_ID,
      usdcAddress: USDC,
      maxPricePerCallUsdc: 0.1,
    });
    expect(cfg.schemes.map((s) => s.network)).toEqual([CHAIN]);
    expect(cfg.spendControls).toEqual({
      allowedAssets: [{ network: CHAIN, asset: USDC, maxAmountPerPayment: "100000" }],
    });
  });
});

describe("IntelligenceClient.buy attempt stages", () => {
  function recorder() {
    const events: AttemptEvent[] = [];
    return { events, onAttempt: async (e: AttemptEvent) => void events.push(e), states: () => events.map((e) => e.state) };
  }

  it("records reserved then request_sent (with the quote) before paying", async () => {
    const rec = recorder();
    const paymentFetch = vi.fn(async () => {
      expect(rec.states()).toEqual(["reserved", "request_sent"]); // both recorded before money moves
      return engine200();
    });
    const { client } = makeClient({ paymentFetch });
    await client.buy("QUESTION_ANSWERING", "x", rec.onAttempt);
    expect(rec.events[1]).toEqual({ state: "request_sent", minerId: "148002", quotedAmountUsdc: 0.01 });
  });

  it("never pays when request_sent can't be recorded", async () => {
    const { client, paymentFetch } = makeClient();
    const onAttempt = async (e: AttemptEvent) => {
      if (e.state === "request_sent") throw new Error("ledger push failed");
    };
    await expect(client.buy("QUESTION_ANSWERING", "x", onAttempt)).rejects.toThrow("ledger push failed");
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("records failed_and_credited on an error reply, then tries the next miner as a new attempt", async () => {
    const rec = recorder();
    const paymentFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 500 }))
      .mockResolvedValueOnce(engine200({ miner_id: "148001" }));
    const { client } = makeClient({ paymentFetch });
    await client.buy("QUESTION_ANSWERING", "x", rec.onAttempt);
    expect(rec.states()).toEqual(["reserved", "request_sent", "failed_and_credited", "reserved", "request_sent"]);
    expect(rec.events[2].reason).toMatch(/HTTP 500/);
  });

  it("records unknown_needs_reconciliation and stops when the paid request gets no response", async () => {
    const rec = recorder();
    const paymentFetch = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const { client } = makeClient({ paymentFetch });
    await expect(client.buy("QUESTION_ANSWERING", "x", rec.onAttempt)).rejects.toBeInstanceOf(PaymentUnknownError);
    expect(rec.states()).toEqual(["reserved", "request_sent", "unknown_needs_reconciliation"]);
    expect(paymentFetch).toHaveBeenCalledTimes(1); // no second miner
  });

  it("records quote_refused with the quote and reason when the price limit refuses it", async () => {
    const rec = recorder();
    const { client, paymentFetch } = makeClient({ maxPricePerCallUsdc: 0.001 });
    await expect(client.buy("QUESTION_ANSWERING", "x", rec.onAttempt)).rejects.toBeInstanceOf(PriceGuardError);
    expect(rec.states()).toEqual(["reserved", "quote_refused"]);
    expect(rec.events[1]).toMatchObject({ quotedAmountUsdc: 0.01, reason: expect.stringMatching(/exceeds maxPricePerCallUsdc/) });
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("records quote_refused when the budget limit refuses it", async () => {
    const rec = recorder();
    const { client } = makeClient();
    client.spentUsdc = 0.49;
    await expect(client.buy("QUESTION_ANSWERING", "x", rec.onAttempt)).rejects.toBeInstanceOf(BudgetCapError);
    expect(rec.states()).toEqual(["reserved", "quote_refused"]);
    expect(rec.events[1].reason).toMatch(/exceeds budgetCapUsdc/);
  });

  it("records failed_not_charged when the node rejects the signed payment (402 or 400 Invalid payment)", async () => {
    for (const reply of [new Response("", { status: 402 }), new Response('{"error":"Invalid payment"}', { status: 400 })]) {
      const rec = recorder();
      const paymentFetch = vi.fn().mockResolvedValueOnce(reply).mockResolvedValueOnce(engine200());
      const { client } = makeClient({ paymentFetch });
      await client.buy("QUESTION_ANSWERING", "x", rec.onAttempt);
      expect(rec.states().slice(0, 3)).toEqual(["reserved", "request_sent", "failed_not_charged"]);
    }
  });

  it("records failed_not_charged on settlement success: false", async () => {
    const rec = recorder();
    const paymentFetch = vi
      .fn()
      .mockResolvedValueOnce(engine200({}, { "payment-response": settle(false) }))
      .mockResolvedValueOnce(engine200());
    const { client } = makeClient({ paymentFetch });
    await client.buy("QUESTION_ANSWERING", "x", rec.onAttempt);
    expect(rec.states().slice(0, 3)).toEqual(["reserved", "request_sent", "failed_not_charged"]);
  });
});
