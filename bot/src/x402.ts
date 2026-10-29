import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

export interface Purchase {
  intent: string;
  minerId: string;
  minerName: string;
  amountUsdc: number;
  txHash: string;
  answerPreview: string;
  status: "settled" | "failed";
}

export interface IntentMiner {
  id: string;
  name: string;
  path: string;
}

export class PriceGuardError extends Error {}
export class BudgetCapError extends Error {}
export class AllMinersFailedError extends Error {}

export interface IntelligenceClientDeps {
  nodeUrl: string;
  evmPrivateKey: `0x${string}`;
  maxPricePerCallUsdc: number;
  budgetCapUsdc: number;
  fetchImpl?: typeof fetch;
  paymentFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  discoverMiners?: (intent: string) => Promise<IntentMiner[]>;
}

const USDC_DECIMALS = 1_000_000;

interface DecodedChallenge {
  maxAmountRequired: string;
}

function decodeChallenge(body: unknown): DecodedChallenge | null {
  const accepts = (body as { accepts?: unknown })?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const first = accepts[0] as { maxAmountRequired?: unknown };
  if (typeof first?.maxAmountRequired !== "string") return null;
  return { maxAmountRequired: first.maxAmountRequired };
}

function decodeSettleHeader(res: Response): { success?: boolean; transaction?: string } | null {
  const raw = res.headers.get("x-payment-response");
  if (!raw) return null;
  try {
    return JSON.parse(atob(raw));
  } catch {
    return null;
  }
}

export class IntelligenceClient {
  spentUsdc = 0;

  private readonly nodeUrl: string;
  private readonly evmPrivateKey: `0x${string}`;
  private readonly maxPricePerCallUsdc: number;
  private readonly budgetCapUsdc: number;
  private readonly fetchImpl: typeof fetch;
  private readonly paymentFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private readonly discoverMiners: (intent: string) => Promise<IntentMiner[]>;
  private integrationsCache: Promise<unknown[]> | null = null;

  constructor(deps: IntelligenceClientDeps) {
    this.nodeUrl = deps.nodeUrl.replace(/\/$/, "");
    this.evmPrivateKey = deps.evmPrivateKey;
    this.maxPricePerCallUsdc = deps.maxPricePerCallUsdc;
    this.budgetCapUsdc = deps.budgetCapUsdc;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.paymentFetch = deps.paymentFetch ?? this.buildPaymentFetch();
    this.discoverMiners = deps.discoverMiners ?? ((intent) => this.defaultDiscoverMiners(intent));
  }

  async buy(intent: string, payload: Record<string, string>): Promise<Purchase> {
    const miners = await this.discoverMiners(intent);
    for (const miner of miners) {
      const url = this.minerUrl(miner, payload);

      // Quote: unsigned request → 402 challenge carries the live price.
      const quoteRes = await this.fetchImpl(url);
      if (quoteRes.status !== 402) continue;
      const challenge = decodeChallenge(await quoteRes.json().catch(() => null));
      if (!challenge) continue;
      const amountUsdc = Number(challenge.maxAmountRequired) / USDC_DECIMALS;

      if (amountUsdc > this.maxPricePerCallUsdc) {
        throw new PriceGuardError(
          `quote ${amountUsdc} USDC exceeds maxPricePerCallUsdc ${this.maxPricePerCallUsdc} (miner ${miner.id})`
        );
      }
      if (this.spentUsdc + amountUsdc > this.budgetCapUsdc) {
        throw new BudgetCapError(
          `spend ${this.spentUsdc} + quote ${amountUsdc} USDC exceeds budgetCapUsdc ${this.budgetCapUsdc}`
        );
      }

      const res = await this.paymentFetch(url);
      if (!res.ok) continue;
      const settle = decodeSettleHeader(res);
      if (!settle?.success || typeof settle.transaction !== "string") continue;

      const text = await res.text();
      this.spentUsdc += amountUsdc;
      return {
        intent,
        minerId: miner.id,
        minerName: miner.name,
        amountUsdc,
        txHash: settle.transaction,
        answerPreview: text.slice(0, 200),
        status: "settled",
      };
    }
    throw new AllMinersFailedError(`all miners failed for intent ${intent}`);
  }

  private minerUrl(miner: IntentMiner, payload: Record<string, string>): string {
    const qs = new URLSearchParams(payload).toString();
    return `${this.nodeUrl}/miner-dispatcher/v1/${miner.id}${miner.path}?${qs}`;
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

  private async defaultDiscoverMiners(intent: string): Promise<IntentMiner[]> {
    this.integrationsCache ??= this.fetchImpl(`${this.nodeUrl}/miner-dispatcher/integrations`)
      .then((r) => r.json() as Promise<unknown[]>)
      .catch(() => {
        this.integrationsCache = null;
        return [];
      });
    const integrations = await this.integrationsCache;
    const miners: IntentMiner[] = [];
    for (const entry of integrations as { id?: string; name?: string; endpoints?: { path?: string; description?: string }[] }[]) {
      for (const ep of entry.endpoints ?? []) {
        if ((ep.description ?? "").includes(intent) && ep.path && entry.id && entry.name) {
          miners.push({ id: entry.id, name: entry.name, path: ep.path });
        }
      }
    }
    return miners;
  }
}
