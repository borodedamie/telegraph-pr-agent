// Per-request budget tracker (research R9). One Budget per answer computation.

export interface BudgetLimits {
  maxSourceRequests: number;
  maxTimeMs: number;
  maxReleases: number;
  maxModelCalls: number;
  maxModelInputChars: number;
  maxModelCostMicroUsdc: number;
  llmTimeoutMs: number;
  maxModelReleases: number;
}

export type BudgetKind =
  | "source_requests"
  | "time"
  | "releases"
  | "model_calls"
  | "model_input"
  | "model_cost"
  | "model_time"
  | "model_releases";

function envNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return value;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  return {
    maxSourceRequests: envNumber(env, "MAX_SOURCE_REQUESTS", 25),
    maxTimeMs: envNumber(env, "MAX_TIME_MS", 20_000),
    maxReleases: envNumber(env, "MAX_RELEASES", 50),
    maxModelCalls: envNumber(env, "MAX_MODEL_CALLS", 1),
    maxModelInputChars: envNumber(env, "MAX_MODEL_INPUT_CHARS", 24_000),
    maxModelCostMicroUsdc: Math.round(envNumber(env, "MAX_MODEL_COST_USDC", 0.01) * 1_000_000),
    llmTimeoutMs: envNumber(env, "LLM_TIMEOUT_MS", 12_000),
    maxModelReleases: envNumber(env, "MAX_MODEL_RELEASES", 20),
  };
}

export class Budget {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;
  private readonly startedAt: number;
  private readonly exhaustedKinds: BudgetKind[] = [];

  sourceRequests = 0;
  bytes = 0;
  releases = 0;
  modelCalls = 0;
  modelInputChars = 0;
  modelCostMicroUsdc = 0;
  modelReleases = 0;

  constructor(readonly limits: BudgetLimits, private readonly now: () => number = Date.now) {
    this.startedAt = now();
    this.signal = this.controller.signal;
    // Hard deadline: in-flight fetches and model calls are aborted, so a lock never outlives the work (R3).
    this.timer = setTimeout(() => {
      this.mark("time");
      this.controller.abort(new Error("time budget exhausted"));
    }, limits.maxTimeMs);
    this.timer.unref();
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  remainingMs(): number {
    return Math.max(0, this.limits.maxTimeMs - this.elapsedMs());
  }

  takeSourceRequest(): boolean {
    if (this.remainingMs() === 0) return this.refuse("time");
    if (this.sourceRequests >= this.limits.maxSourceRequests) return this.refuse("source_requests");
    this.sourceRequests++;
    return true;
  }

  addBytes(count: number): void {
    this.bytes += count;
  }

  takeRelease(): boolean {
    if (this.releases >= this.limits.maxReleases) return this.refuse("releases");
    this.releases++;
    return true;
  }

  canCallModel(inputChars: number, costMicroUsdc: number, releaseCount: number): boolean {
    if (this.modelCalls >= this.limits.maxModelCalls) return this.refuse("model_calls");
    if (inputChars > this.limits.maxModelInputChars) return this.refuse("model_input");
    if (this.modelCostMicroUsdc + costMicroUsdc > this.limits.maxModelCostMicroUsdc) return this.refuse("model_cost");
    if (this.modelReleases + releaseCount > this.limits.maxModelReleases) return this.refuse("model_releases");
    if (this.remainingMs() < this.limits.llmTimeoutMs) return this.refuse("model_time");
    return true;
  }

  recordModelCall(inputChars: number, costMicroUsdc: number, releaseCount: number): void {
    this.modelCalls++;
    this.modelInputChars += inputChars;
    this.modelCostMicroUsdc += costMicroUsdc;
    this.modelReleases += releaseCount;
  }

  /** Whether this limit stopped some work. */
  hit(kind: BudgetKind): boolean {
    return this.exhaustedKinds.includes(kind);
  }

  /** The first limit that stopped work, or null. */
  exhausted(): BudgetKind | null {
    return this.exhaustedKinds[0] ?? null;
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private mark(kind: BudgetKind): void {
    if (!this.exhaustedKinds.includes(kind)) this.exhaustedKinds.push(kind);
  }

  private refuse(kind: BudgetKind): false {
    this.mark(kind);
    return false;
  }
}
