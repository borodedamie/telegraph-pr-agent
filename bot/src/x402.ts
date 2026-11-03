import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

export interface Purchase {
  intent: string;
  minerId: string;
  minerName: string;
  minerRank: number;
  minerScore: number;
  amountUsdc: number;
  txHash: string;
  receiptHash: string;
  signalHash: string;
  answer: string;
  status: "settled" | "failed";
}

export interface RankedMiner {
  id: string;
  name: string;
  method: string;
  path: string;
  rank: number;
  score: number;
}

export class PriceGuardError extends Error {}
export class BudgetCapError extends Error {}
export class AskFailedError extends Error {}

export interface IntelligenceClientDeps {
  nodeUrl: string;
  evmPrivateKey: `0x${string}`;
  chainId: number;
  usdcAddress: string;
  maxPricePerCallUsdc: number;
  budgetCapUsdc: number;
  fetchImpl?: typeof fetch;
  paymentFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface ApiMiner {
  id?: string | number;
  name?: string;
  endpoints?: { path?: string; method?: string; description?: string }[];
  scores?: { intent_id?: string; rank?: number; score?: number }[];
}

interface EngineAnswer {
  miner_id?: string | number;
  miner_name?: string;
  result?: unknown;
  signal_hash?: string;
}

const USDC_DECIMALS = 1_000_000;
const MAX_MINERS_TRIED = 3;

function decodeB64Json<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(atob(raw)) as T;
  } catch {
    return null;
  }
}

interface Accept {
  scheme?: unknown;
  network?: unknown;
  asset?: unknown;
  amount?: unknown;
}

// accepts[] also lists `escrow` and non-EVM entries; we only quote the one the
// payment client is allowed to pay: `exact` on our network in our USDC.
function quotedAmountAtomic(res: Response, network: string, asset: string): string | null {
  const parsed = decodeB64Json<{ accepts?: unknown }>(res.headers.get("payment-required"));
  if (!Array.isArray(parsed?.accepts)) return null;
  const match = (parsed.accepts as Accept[]).find(
    (a) =>
      a?.scheme === "exact" &&
      a.network === network &&
      typeof a.asset === "string" &&
      a.asset.toLowerCase() === asset.toLowerCase()
  );
  return typeof match?.amount === "string" ? match.amount : null;
}

function settleHeader(res: Response): { success?: boolean; transaction?: string } | null {
  return decodeB64Json(res.headers.get("payment-response") || res.headers.get("x-payment-response"));
}

function answerText(result: unknown): string {
  if (typeof result === "string") return result;
  const a = (result as { answer?: unknown } | null)?.answer;
  return typeof a === "string" ? a : JSON.stringify(result);
}

export function rankMiners(intent: string, miners: ApiMiner[]): RankedMiner[] {
  const ranked: RankedMiner[] = [];
  for (const m of miners) {
    const s = m.scores?.find((x) => x.intent_id === intent);
    const eps = m.endpoints ?? [];
    const ep = eps.find((e) => (e.description ?? "").includes(intent)) ?? (eps.length === 1 ? eps[0] : undefined);
    if (!s || typeof s.rank !== "number" || !ep?.path || m.id === undefined) continue;
    ranked.push({
      id: String(m.id),
      name: m.name ?? String(m.id),
      method: ep.method ?? "GET",
      path: ep.path,
      rank: s.rank,
      score: s.score ?? 0,
    });
  }
  return ranked.sort((a, b) => a.rank - b.rank);
}

// The testnet USDC isn't one of @x402's built-in assets, so it must be allow-listed
// or the client refuses to sign. The per-payment cap re-checks MAX_PRICE inside the
// signer, covering a price change between our quote request and the paid one.
export function paymentConfig(deps: Pick<IntelligenceClientDeps, "evmPrivateKey" | "chainId" | "usdcAddress" | "maxPricePerCallUsdc">) {
  const network = `eip155:${deps.chainId}` as const;
  return {
    schemes: [{ network, client: new ExactEvmScheme(toClientEvmSigner(privateKeyToAccount(deps.evmPrivateKey))) }],
    spendControls: {
      allowedAssets: [
        {
          network,
          asset: deps.usdcAddress,
          maxAmountPerPayment: String(Math.round(deps.maxPricePerCallUsdc * USDC_DECIMALS)),
        },
      ],
    },
  };
}

export class IntelligenceClient {
  spentUsdc = 0;

  private readonly nodeUrl: string;
  private readonly network: string;
  private readonly usdcAddress: string;
  private readonly maxPricePerCallUsdc: number;
  private readonly budgetCapUsdc: number;
  private readonly fetchImpl: typeof fetch;
  private readonly paymentFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  constructor(deps: IntelligenceClientDeps) {
    this.nodeUrl = deps.nodeUrl.replace(/\/$/, "");
    this.network = `eip155:${deps.chainId}`;
    this.usdcAddress = deps.usdcAddress;
    this.maxPricePerCallUsdc = deps.maxPricePerCallUsdc;
    this.budgetCapUsdc = deps.budgetCapUsdc;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.paymentFetch = deps.paymentFetch ?? wrapFetchWithPaymentFromConfig(this.fetchImpl, paymentConfig(deps));
  }

  async rankedMiners(intent: string): Promise<RankedMiner[]> {
    const res = await this.fetchImpl(
      `${this.nodeUrl}/api/miners?intent=${encodeURIComponent(intent)}&status=active&limit=100`
    );
    if (!res.ok) throw new AskFailedError(`${intent}: miner list HTTP ${res.status}`);
    const body = (await res.json()) as ApiMiner[] | { miners?: ApiMiner[] };
    return rankMiners(intent, Array.isArray(body) ? body : body.miners ?? []);
  }

  // The routed /engine/v1/ask re-classifies a free-form query and can ignore
  // the intent we name (seen live: QA routed to SECURITY_REVIEW). So we read
  // Telegraph's leaderboard ourselves and pay the top-ranked miner directly,
  // stepping down a rank only when a call fails (failed calls are not charged).
  async buy(intent: string, query: string): Promise<Purchase> {
    const miners = (await this.rankedMiners(intent)).slice(0, MAX_MINERS_TRIED);
    const failures: string[] = [];
    for (const miner of miners) {
      try {
        return await this.buyFrom(intent, query, miner);
      } catch (err) {
        if (!(err instanceof AskFailedError)) throw err;
        failures.push(`#${miner.rank} ${miner.id}: ${err.message}`);
      }
    }
    throw new AskFailedError(`${intent}: no ranked miner answered — ${failures.join(" | ") || "none ranked"}`);
  }

  private async buyFrom(intent: string, query: string, miner: RankedMiner): Promise<Purchase> {
    const url = `${this.nodeUrl}/engine/v1/ask/${encodeURIComponent(miner.id)}`;
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: miner.method, endpoint: miner.path, payload: { query } }),
    };

    // Quote: unsigned request → 402 challenge carries the live price.
    const quoteRes = await this.fetchImpl(url, init);
    if (quoteRes.status !== 402) {
      throw new AskFailedError(`expected a 402 quote, got HTTP ${quoteRes.status}`);
    }
    const atomic = quotedAmountAtomic(quoteRes, this.network, this.usdcAddress);
    if (atomic === null) {
      throw new AskFailedError(`402 offers no exact payment on ${this.network} in ${this.usdcAddress}`);
    }
    const amountUsdc = Number(atomic) / USDC_DECIMALS;

    if (amountUsdc > this.maxPricePerCallUsdc) {
      throw new PriceGuardError(
        `quote ${amountUsdc} USDC exceeds maxPricePerCallUsdc ${this.maxPricePerCallUsdc} (${intent}, miner ${miner.id})`
      );
    }
    // The signer may settle anything up to maxPricePerCallUsdc (a repriced call),
    // so reserve that worst case against the budget, not the quote.
    const worstCaseUsdc = Math.max(amountUsdc, this.maxPricePerCallUsdc);
    if (this.spentUsdc + worstCaseUsdc > this.budgetCapUsdc) {
      throw new BudgetCapError(
        `spend ${this.spentUsdc} + worst-case ${worstCaseUsdc} USDC (quote ${amountUsdc}) exceeds budgetCapUsdc ${this.budgetCapUsdc}`
      );
    }

    // The node settles only on a delivered answer, so a non-2xx here cost nothing.
    const res = await this.paymentFetch(url, init);
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new AskFailedError(`HTTP ${res.status} ${detail}`.trim());
    }
    const settle = settleHeader(res);
    if (!settle?.success || typeof settle.transaction !== "string") {
      throw new AskFailedError("answered without a settlement proof");
    }
    // Dynamic pricing can make the settled amount differ from the quote; the
    // receipt carries what was actually charged, so the record must use it.
    const receipt = decodeB64Json<{ receipt_hash?: string; amount_uusdc?: string | number }>(
      res.headers.get("x-telegraph-receipt")
    );
    const rawSettled = receipt?.amount_uusdc;
    const settledAtomic =
      typeof rawSettled === "number"
        ? rawSettled
        : typeof rawSettled === "string" && rawSettled !== ""
          ? Number(rawSettled)
          : NaN;
    const settledUsdc = Number.isFinite(settledAtomic) ? settledAtomic / USDC_DECIMALS : amountUsdc;
    this.spentUsdc += settledUsdc;

    const body = (await res.json().catch(() => ({}))) as EngineAnswer;
    return {
      intent,
      minerId: String(body.miner_id ?? miner.id),
      minerName: body.miner_name ?? miner.name,
      minerRank: miner.rank,
      minerScore: miner.score,
      amountUsdc: settledUsdc,
      txHash: settle.transaction,
      receiptHash: receipt?.receipt_hash ?? "",
      signalHash: body.signal_hash ?? "",
      answer: answerText(body.result),
      status: "settled",
    };
  }
}
