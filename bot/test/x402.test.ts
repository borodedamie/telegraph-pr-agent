import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AllMinersFailedError,
  BudgetCapError,
  IntelligenceClient,
  PriceGuardError,
  type IntentMiner,
} from "../src/x402.js";

const CHAIN = "eip155:84532";

function challenge(amountAtomic: string) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: CHAIN,
        maxAmountRequired: amountAtomic,
        resource: "x",
        description: "d",
        mimeType: "application/json",
        outputSchema: {},
        payTo: "0xMinerPayTo00000000000000000000000000000001",
        maxTimeoutSeconds: 60,
        asset: "0xUsdcAddress00000000000000000000000000000002",
        extra: {},
      },
    ],
  };
}

function settleHeader(success: boolean, tx = "0xdeadbeef") {
  return btoa(JSON.stringify({ success, transaction: tx, network: CHAIN }));
}

const miners: IntentMiner[] = [
  { id: "302", name: "ChainSight", path: "/qa" },
  { id: "9002", name: "TxLens", path: "/chat-complete" },
];

function makeClient(overrides: Partial<ConstructorParameters<typeof IntelligenceClient>[0]> = {}) {
  const quoteFetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(challenge("10000")), { status: 402 })
  );
  const paymentFetch = vi.fn(async () =>
    new Response(JSON.stringify({ answer: "42" }), {
      status: 200,
      headers: { "x-payment-response": settleHeader(true) },
    })
  );
  const client = new IntelligenceClient({
    nodeUrl: "https://devnode.test",
    evmPrivateKey: `0x${"a".repeat(64)}`,
    maxPricePerCallUsdc: 0.05,
    budgetCapUsdc: 0.5,
    fetchImpl: quoteFetch as unknown as typeof fetch,
    paymentFetch,
    discoverMiners: async () => miners,
    ...overrides,
  });
  return { client, quoteFetch, paymentFetch };
}

describe("IntelligenceClient.buy", () => {
  it("returns a Purchase with amount from the decoded challenge and tx from the settle header", async () => {
    const { client } = makeClient();
    const p = await client.buy("QUESTION_ANSWERING", { query: "what is 21 * 2" });
    expect(p).toMatchObject({
      intent: "QUESTION_ANSWERING",
      minerId: "302",
      minerName: "ChainSight",
      amountUsdc: 0.01,
      txHash: "0xdeadbeef",
      status: "settled",
    });
    expect(p.answerPreview).toContain("42");
    expect(client.spentUsdc).toBeCloseTo(0.01);
  });

  it("aborts with PriceGuardError when the live quote exceeds maxPricePerCallUsdc and never pays", async () => {
    const quoteFetch = vi.fn(
      async () => new Response(JSON.stringify(challenge("60000")), { status: 402 })
    ) as unknown as typeof fetch;
    const paymentFetch = vi.fn();
    const { client } = makeClient({ fetchImpl: quoteFetch, paymentFetch });
    await expect(client.buy("QUESTION_ANSWERING", { query: "x" })).rejects.toBeInstanceOf(PriceGuardError);
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("aborts with BudgetCapError when cumulative spend would breach budgetCapUsdc", async () => {
    const { client, paymentFetch } = makeClient();
    client.spentUsdc = 0.495;
    await expect(client.buy("CODE_GENERATION", { instruction: "x" })).rejects.toBeInstanceOf(BudgetCapError);
    expect(paymentFetch).not.toHaveBeenCalled();
  });

  it("retries the next-ranked miner when the first payment call fails", async () => {
    const paymentFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ answer: "ok" }), {
          status: 200,
          headers: { "x-payment-response": settleHeader(true, "0xsecond") },
        })
      );
    const { client } = makeClient({ paymentFetch });
    const p = await client.buy("CODE_PATCH_VERIFY", { code: "x" });
    expect(p.minerId).toBe("9002");
    expect(p.txHash).toBe("0xsecond");
  });

  it("retries when settlement reports success=false", async () => {
    const paymentFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("no", { status: 200, headers: { "x-payment-response": settleHeader(false) } })
      )
      .mockResolvedValueOnce(
        new Response("{}", { status: 200, headers: { "x-payment-response": settleHeader(true, "0xgood") } })
      );
    const { client } = makeClient({ paymentFetch });
    const p = await client.buy("REGRESSION_VERIFY", { code: "x" });
    expect(p.minerId).toBe("9002");
  });

  it("throws AllMinersFailedError when every miner fails", async () => {
    const paymentFetch = vi.fn(async () => new Response("down", { status: 503 }));
    const { client } = makeClient({ paymentFetch });
    await expect(client.buy("CODE_GENERATION", { instruction: "x" })).rejects.toBeInstanceOf(
      AllMinersFailedError
    );
  });

  it("quotes each miner via its devnode dispatcher URL", async () => {
    const { client, quoteFetch } = makeClient();
    await client.buy("QUESTION_ANSWERING", { query: "hello" });
    expect(quoteFetch.mock.calls[0][0]).toBe(
      "https://devnode.test/miner-dispatcher/v1/302/qa?query=hello"
    );
  });
});
