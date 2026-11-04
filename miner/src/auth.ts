// Origin authentication and abuse limits (research R10).
import { createHash, timingSafeEqual } from "node:crypto";
import type { Store } from "./cache.js";

export type AuthResult = { ok: true } | { ok: false; status: 401 | 503; reason: string };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Fails closed: without MINER_API_KEY configured nothing is served. */
export function checkKey(provided: string | undefined, env: NodeJS.ProcessEnv = process.env): AuthResult {
  const expected = env.MINER_API_KEY;
  if (!expected) return { ok: false, status: 503, reason: "miner is not configured" };
  if (!provided) return { ok: false, status: 401, reason: "missing X-Telegraph-Key" };
  // Comparing fixed-length digests keeps the comparison constant-time regardless of input length.
  if (!timingSafeEqual(digest(provided), digest(expected))) {
    return { ok: false, status: 401, reason: "invalid X-Telegraph-Key" };
  }
  return { ok: true };
}

export interface AdmitLimits {
  ratePerMinute: number;
  maxConcurrentCompute: number;
}

export function admitLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): AdmitLimits {
  // An empty value means the default, as in budget.ts.
  const rate = Number(env.ORIGIN_RATE_PER_MIN || "120");
  const concurrent = Number(env.MAX_CONCURRENT_COMPUTE || "4");
  if (!Number.isInteger(rate) || rate < 1) throw new Error(`ORIGIN_RATE_PER_MIN must be a positive integer`);
  if (!Number.isInteger(concurrent) || concurrent < 1) {
    throw new Error(`MAX_CONCURRENT_COMPUTE must be a positive integer`);
  }
  return { ratePerMinute: rate, maxConcurrentCompute: concurrent };
}

export type Admission = { ok: true } | { ok: false; reason: string };

/** Per-minute request counter shared by all instances. */
export async function admit(store: Store, limits: AdmitLimits, now: number = Date.now()): Promise<Admission> {
  const minute = Math.floor(now / 60_000);
  const count = await store.incr(`rate:${minute}`, 120);
  if (count > limits.ratePerMinute) return { ok: false, reason: "origin rate limit exceeded" };
  return { ok: true };
}

function computeSlotKey(slot: number): string {
  return `compute:slot:${slot}`;
}

export type ComputeSlot = { ok: true; slot: number } | { ok: false; reason: string };

/**
 * Reserves one of maxConcurrentCompute slots for a first-time computation; call leaveCompute when done.
 * Each slot is its own key with a TTL (pass lockTtlSec), so a slot left by a killed instance frees itself.
 */
export async function enterCompute(store: Store, limits: AdmitLimits, ttlSec: number): Promise<ComputeSlot> {
  for (let slot = 0; slot < limits.maxConcurrentCompute; slot++) {
    if (await store.setNx(computeSlotKey(slot), "1", ttlSec)) return { ok: true, slot };
  }
  return { ok: false, reason: "too many concurrent first-time requests" };
}

export async function leaveCompute(store: Store, slot: number): Promise<void> {
  await store.del(computeSlotKey(slot));
}
