import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
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

function quotedAmountAtomic(res: Response): string | null {
  const parsed = decodeB64Json<{ accepts?: unknown }>(res.headers.get("payment-required"));
  if (!Array.isArray(parsed?.accepts)) return null;
  const evm = parsed.accepts.find(
    (a) =>
      typeof (a as { network?: unknown })?.network === "string" &&
      (a as { network: string }).network.startsWith("eip155:")
  ) as { amount?: unknown } | undefined;
  return typeof evm?.amount === "string" ? evm.amount : null;
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

export class IntelligenceClient {
  spentUsdc = 0;

  private readonly nodeUrl: string;
  private readonly evmPrivateKey: `0x${string}`;
  private readonly maxPricePerCallUsdc: number;
  private readonly budgetCapUsdc: number;
  private readonly fetchImpl: typeof fetch;
  private readonly paymentFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  constructor(deps: IntelligenceClientDeps) {
    this.nodeUrl = deps.nodeUrl.replace(/\/$/, "");
    this.evmPrivateKey = deps.evmPrivateKey;
    this.maxPricePerCallUsdc = deps.maxPricePerCallUsdc;
    this.budgetCapUsdc = deps.budgetCapUsdc;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.paymentFetch = deps.paymentFetch ?? this.buildPaymentFetch();
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
    const atomic = quoteRes.status === 402 ? quotedAmountAtomic(quoteRes) : null;
    if (atomic === null) {
      throw new AskFailedError(`expected a 402 quote, got HTTP ${quoteRes.status}`);
    }
    const amountUsdc = Number(atomic) / USDC_DECIMALS;

    if (amountUsdc > this.maxPricePerCallUsdc) {
      throw new PriceGuardError(
        `quote ${amountUsdc} USDC exceeds maxPricePerCallUsdc ${this.maxPricePerCallUsdc} (${intent}, miner ${miner.id})`
      );
    }
    if (this.spentUsdc + amountUsdc > this.budgetCapUsdc) {
      throw new BudgetCapError(
        `spend ${this.spentUsdc} + quote ${amountUsdc} USDC exceeds budgetCapUsdc ${this.budgetCapUsdc}`
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
    this.spentUsdc += amountUsdc;

    const receipt = decodeB64Json<{ receipt_hash?: string }>(res.headers.get("x-telegraph-receipt"));
    const body = (await res.json().catch(() => ({}))) as EngineAnswer;
    return {
      intent,
      minerId: String(body.miner_id ?? miner.id),
      minerName: body.miner_name ?? miner.name,
      minerRank: miner.rank,
      minerScore: miner.score,
      amountUsdc,
      txHash: settle.transaction,
      receiptHash: receipt?.receipt_hash ?? "",
      signalHash: body.signal_hash ?? "",
      answer: answerText(body.result),
      status: "settled",
    };
  }

  private buildPaymentFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
    const account = privateKeyToAccount(this.evmPrivateKey);
    const client = x402Client.fromConfig({
      schemes: [
        {
          network: "eip155:*",
          client: new ExactEvmScheme(toClientEvmSigner(account)),
        },
      ],
    });
    return wrapFetchWithPayment(fetch, client);
  }
}
