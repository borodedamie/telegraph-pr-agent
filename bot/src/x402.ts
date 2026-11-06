import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import type { AttemptState } from "./ledger.js";

export interface Purchase {
  intent: string;
  minerId: string;
  minerName: string;
  /** The miner's leaderboard rank and score for the intent; null when the node gave none (an unranked miner). */
  minerRank: number | null;
  minerScore: number | null;
  amountUsdc: number;
  txHash: string;
  receiptHash: string;
  signalHash: string;
  answer: string;
  status: "settled" | "failed";
  /** Who picked the miner: the leaderboard, or our own PREFERRED_MINER_ID (never reported as the Engine's choice). */
  selectedBy: "rank" | "our_choice";
  /** From the 402 option that was paid (SPEC §4.5), so links never depend on config. */
  network: string;
  chainId: number;
  usdcContract: string;
  /** Empty when the chain is not in EXPLORERS; then no transaction link is shown. */
  explorerBaseUrl: string;
}

// Transaction explorers for the chains the devnode has quoted.
const EXPLORERS: Record<number, string> = {
  11155111: "https://sepolia.etherscan.io",
  84532: "https://sepolia.basescan.org",
};

export interface RankedMiner {
  id: string;
  name: string;
  method: string;
  path: string;
  /** Null for a preferred miner the node has not ranked: never a rank the node did not give. */
  rank: number | null;
  score: number | null;
  selectedBy: "rank" | "our_choice";
}

export class PriceGuardError extends Error {}
export class BudgetCapError extends Error {}
export class AskFailedError extends Error {}
/** The paid request went out but its outcome is unclear; never retry automatically. */
export class PaymentUnknownError extends Error {}

/** One stage of one payment try. `delivered` is recorded by the caller with the purchase. */
export interface AttemptEvent {
  state: Exclude<AttemptState, "delivered">;
  minerId: string;
  quotedAmountUsdc?: number;
  reason?: string;
}
export type OnAttempt = (event: AttemptEvent) => Promise<void>;

export interface IntelligenceClientDeps {
  nodeUrl: string;
  evmPrivateKey: `0x${string}`;
  chainId: number;
  usdcAddress: string;
  maxPricePerCallUsdc: number;
  budgetCapUsdc: number;
  /** Tried before the leaderboard when the node lists it for the intent (SPEC §2.4 manual policy). */
  preferredMinerId?: string | null;
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

interface QuotedAccept {
  amount: string;
  network: string;
  asset: string;
}

// accepts[] also lists `escrow` and non-EVM entries; we only quote the one the
// payment client is allowed to pay: `exact` on our network in our USDC.
function quotedAccept(res: Response, network: string, asset: string): QuotedAccept | null {
  const parsed = decodeB64Json<{ accepts?: unknown }>(res.headers.get("payment-required"));
  if (!Array.isArray(parsed?.accepts)) return null;
  const match = (parsed.accepts as Accept[]).find(
    (a) =>
      a?.scheme === "exact" &&
      a.network === network &&
      typeof a.asset === "string" &&
      a.asset.toLowerCase() === asset.toLowerCase()
  );
  return typeof match?.amount === "string"
    ? { amount: match.amount, network: match.network as string, asset: match.asset as string }
    : null;
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
      selectedBy: "rank",
    });
  }
  return ranked.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
}

/**
 * The miner we chose ourselves, if the node lists it for this intent: it need not be ranked yet. Rank and score
 * are its leaderboard values when it has them, else null (SPEC §2.4: "rank unavailable").
 */
export function preferredMiner(intent: string, miners: ApiMiner[], id: string): RankedMiner | null {
  const m = miners.find((x) => String(x.id) === id);
  const eps = m?.endpoints ?? [];
  const ep = eps.find((e) => (e.description ?? "").includes(intent)) ?? (eps.length === 1 ? eps[0] : undefined);
  if (!m || !ep?.path) return null;
  const s = m.scores?.find((x) => x.intent_id === intent);
  return {
    id,
    name: m.name ?? id,
    method: ep.method ?? "GET",
    path: ep.path,
    rank: typeof s?.rank === "number" ? s.rank : null,
    score: typeof s?.rank === "number" ? s.score ?? null : null,
    selectedBy: "our_choice",
  };
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
  private readonly preferredMinerId: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly paymentFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  constructor(deps: IntelligenceClientDeps) {
    this.nodeUrl = deps.nodeUrl.replace(/\/$/, "");
    this.network = `eip155:${deps.chainId}`;
    this.usdcAddress = deps.usdcAddress;
    this.maxPricePerCallUsdc = deps.maxPricePerCallUsdc;
    this.budgetCapUsdc = deps.budgetCapUsdc;
    this.preferredMinerId = deps.preferredMinerId ?? null;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.paymentFetch = deps.paymentFetch ?? wrapFetchWithPaymentFromConfig(this.fetchImpl, paymentConfig(deps));
  }

  async rankedMiners(intent: string): Promise<RankedMiner[]> {
    const res = await this.fetchImpl(
      `${this.nodeUrl}/api/miners?intent=${encodeURIComponent(intent)}&status=active&limit=100`
    );
    if (!res.ok) throw new AskFailedError(`${intent}: miner list HTTP ${res.status}`);
    const body = (await res.json()) as ApiMiner[] | { miners?: ApiMiner[] };
    const miners = Array.isArray(body) ? body : body.miners ?? [];
    const ranked = rankMiners(intent, miners);
    const preferred = this.preferredMinerId ? preferredMiner(intent, miners, this.preferredMinerId) : null;
    return preferred ? [preferred, ...ranked.filter((m) => m.id !== preferred.id)] : ranked;
  }

  // The routed /engine/v1/ask re-classifies a free-form query and can ignore
  // the intent we name (seen live: QA routed to SECURITY_REVIEW). So we read
  // Telegraph's leaderboard ourselves and pay the top-ranked miner directly,
  // stepping down a rank only when a call fails (failed calls are credited to escrow).
  // onAttempt is awaited at each stage, so a stage that can't be recorded stops
  // the purchase before the next one starts.
  async buy(intent: string, query: string, onAttempt: OnAttempt = async () => {}): Promise<Purchase> {
    const miners = (await this.rankedMiners(intent)).slice(0, MAX_MINERS_TRIED);
    const failures: string[] = [];
    for (const miner of miners) {
      try {
        return await this.buyFrom(intent, query, miner, onAttempt);
      } catch (err) {
        if (!(err instanceof AskFailedError)) throw err;
        failures.push(`#${miner.rank ?? "unranked"} ${miner.id}: ${err.message}`);
      }
    }
    throw new AskFailedError(`${intent}: no ranked miner answered — ${failures.join(" | ") || "none ranked"}`);
  }

  private async buyFrom(intent: string, query: string, miner: RankedMiner, onAttempt: OnAttempt): Promise<Purchase> {
    await onAttempt({ state: "reserved", minerId: miner.id });
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
    const accept = quotedAccept(quoteRes, this.network, this.usdcAddress);
    if (accept === null) {
      throw new AskFailedError(`402 offers no exact payment on ${this.network} in ${this.usdcAddress}`);
    }
    const amountUsdc = Number(accept.amount) / USDC_DECIMALS;

    if (amountUsdc > this.maxPricePerCallUsdc) {
      const reason = `quote ${amountUsdc} USDC exceeds maxPricePerCallUsdc ${this.maxPricePerCallUsdc} (${intent}, miner ${miner.id})`;
      await onAttempt({ state: "quote_refused", minerId: miner.id, quotedAmountUsdc: amountUsdc, reason });
      throw new PriceGuardError(reason);
    }
    // The signer may settle anything up to maxPricePerCallUsdc (a repriced call),
    // so reserve that worst case against the budget, not the quote.
    const worstCaseUsdc = Math.max(amountUsdc, this.maxPricePerCallUsdc);
    if (this.spentUsdc + worstCaseUsdc > this.budgetCapUsdc) {
      const reason = `spend ${this.spentUsdc} + worst-case ${worstCaseUsdc} USDC (quote ${amountUsdc}) exceeds budgetCapUsdc ${this.budgetCapUsdc}`;
      await onAttempt({ state: "quote_refused", minerId: miner.id, quotedAmountUsdc: amountUsdc, reason });
      throw new BudgetCapError(reason);
    }

    await onAttempt({ state: "request_sent", minerId: miner.id, quotedAmountUsdc: amountUsdc });
    let res: Response;
    try {
      res = await this.paymentFetch(url, init);
    } catch (err) {
      // No response: the payment may or may not have settled.
      const reason = `no response: ${String(err)}`.slice(0, 300);
      await onAttempt({ state: "unknown_needs_reconciliation", minerId: miner.id, reason });
      throw new PaymentUnknownError(`${miner.id}: ${reason}`);
    }
    // https://anjoman.ai/docs/using/x402-inference (Step 3): a payload that does not
    // verify gets a bare 402 and an invalid one gets 400 "Invalid payment", so nothing
    // was paid. A valid payment settles before the miner is called; if the call then
    // fails, the amount is credited to our escrow balance and never charged.
    if (!res.ok) {
      const reason = `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`.trim();
      const notPaid = res.status === 402 || (res.status === 400 && /invalid payment/i.test(reason));
      await onAttempt({ state: notPaid ? "failed_not_charged" : "failed_and_credited", minerId: miner.id, reason });
      throw new AskFailedError(reason);
    }
    const settle = settleHeader(res);
    if (settle?.success === false) {
      // An explicit "not settled": nothing was charged, so the next miner may be tried.
      const reason = "settlement reported success: false";
      await onAttempt({ state: "failed_not_charged", minerId: miner.id, reason });
      throw new AskFailedError(reason);
    }
    if (settle?.success !== true || typeof settle.transaction !== "string") {
      // No readable settlement proof: we can't tell whether we paid.
      const reason = "answered without a readable settlement proof";
      await onAttempt({ state: "unknown_needs_reconciliation", minerId: miner.id, reason });
      throw new PaymentUnknownError(`${miner.id}: ${reason}`);
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
      selectedBy: miner.selectedBy,
      amountUsdc: settledUsdc,
      txHash: settle.transaction,
      receiptHash: receipt?.receipt_hash ?? "",
      signalHash: body.signal_hash ?? "",
      answer: answerText(body.result),
      status: "settled",
      network: accept.network,
      chainId: Number(accept.network.split(":")[1]),
      usdcContract: accept.asset,
      explorerBaseUrl: EXPLORERS[Number(accept.network.split(":")[1])] ?? "",
    };
  }
}
