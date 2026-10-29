import { describe, expect, it, vi } from "vitest";
import {
  AskFailedError,
  BudgetCapError,
  IntelligenceClient,
  PriceGuardError,
  rankMiners,
} from "../src/x402.js";

const CHAIN = "eip155:84532";

// Real devnode wire format: the 402 challenge rides the `payment-required`
// header as base64 JSON, amount in atomic units, and accepts[] carries both an
// EVM and a Solana entry.
function challengeBody(evmAmountAtomic: string, solAmountAtomic = "999999") {
  return {
    x402Version: 2,
    accepts: [
      { scheme: "exact", network: CHAIN, amount: evmAmountAtomic, asset: "0xUsdc", payTo: "0xPayTo" },
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

  it("throws AskFailedError when settlement reports success=false on every miner", async () => {
    const paymentFetch = vi.fn(async () => engine200({}, { "payment-response": settle(false) }));
    const { client } = makeClient({ paymentFetch });
    await expect(client.buy("QUESTION_ANSWERING", "x")).rejects.toBeInstanceOf(AskFailedError);
    expect(client.spentUsdc).toBe(0);
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
});
