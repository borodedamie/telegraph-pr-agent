// Source manifest, snapshots, answer cache and in-flight lock (research R3).
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import type { Answer, NormalizedRequest } from "./types.js";

export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Increments and sets the expiry in one atomic step, so the counter can never be left without a TTL. */
  incr(key: string, ttlSec: number): Promise<number>;
  ping(): Promise<boolean>;
}

export class MemoryStore implements Store {
  private readonly entries = new Map<string, { value: string; expiresAt: number | null }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: ttlSec === undefined ? null : this.now() + ttlSec * 1000 });
  }

  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    if ((await this.get(key)) !== null) return false;
    await this.set(key, value, ttlSec);
    return true;
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const next = Number((await this.get(key)) ?? "0") + 1;
    await this.set(key, String(next), ttlSec);
    return next;
  }

  async ping(): Promise<boolean> {
    return true;
  }
}

export class RedisStore implements Store {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get<string>(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec === undefined) await this.redis.set(key, value);
    else await this.redis.set(key, value, { ex: ttlSec });
  }

  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    return (await this.redis.set(key, value, { nx: true, ex: ttlSec })) === "OK";
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const [value] = await this.redis.multi().incr(key).expire(key, ttlSec).exec();
    return Number(value);
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === "PONG";
  }
}

// One store per function instance: Redis when configured, otherwise an in-memory fallback for local runs.
// On Vercel a missing Redis is a misconfiguration: limits and the cache would silently become per instance.
let instanceStore: Store | null = null;

export function getStore(env: NodeJS.ProcessEnv = process.env): Store {
  if (instanceStore) return instanceStore;
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (env.VERCEL && !(url && token)) throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required on Vercel");
  // automaticDeserialization off: answers must come back as the exact bytes that were stored.
  instanceStore =
    url && token ? new RedisStore(new Redis({ url, token, automaticDeserialization: false })) : new MemoryStore();
  return instanceStore;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** JSON with object keys sorted at every level, so equal values always hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// --- Source manifest ---

export const MANIFEST_FRESH_MS = 60 * 60 * 1000;

export const ManifestEntry = z.object({
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  fetchedAt: z.string().datetime({ offset: true }),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  snapshotKey: z.string().startsWith("snap:"),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

/** `sourceId` is the request URL, or for OSV the canonical query body. */
function manifestKey(sourceId: string): string {
  return `manifest:${sha256Hex(sourceId)}`;
}

export async function getManifest(store: Store, sourceId: string): Promise<ManifestEntry | null> {
  const raw = await store.get(manifestKey(sourceId));
  return raw === null ? null : ManifestEntry.parse(JSON.parse(raw));
}

export async function putManifest(store: Store, sourceId: string, entry: ManifestEntry): Promise<void> {
  await store.set(manifestKey(sourceId), JSON.stringify(ManifestEntry.parse(entry)));
}

export function isFresh(entry: ManifestEntry, now: number = Date.now()): boolean {
  return now - Date.parse(entry.fetchedAt) < MANIFEST_FRESH_MS;
}

// --- Snapshots (no TTL, FR-019) ---

export async function putSnapshot(store: Store, text: string): Promise<{ contentHash: string; snapshotKey: string }> {
  const contentHash = sha256Hex(text);
  const snapshotKey = `snap:${contentHash}`;
  await store.set(snapshotKey, text);
  return { contentHash, snapshotKey };
}

export async function getSnapshot(store: Store, snapshotKey: string): Promise<string | null> {
  return store.get(snapshotKey);
}

// --- Answer cache ---

export function answerKey(request: NormalizedRequest, contentHashes: string[], processingVersion: string): string {
  const identity = canonicalJson({ request, hashes: [...contentHashes].sort(), processingVersion });
  return `answer:${sha256Hex(identity)}`;
}

/**
 * Outages are never cached, and a found or not_found answer whose security check did not complete is retried
 * next time. Answers that never reach OSV (out_of_scope, needs_clarification, security not_checked) are cacheable;
 * the caller keys them only when it has a NormalizedRequest (answerKey), and skips the cache otherwise.
 */
export function isCacheable(answer: Answer): boolean {
  if (answer.outcome === "temporarily_unavailable") return false;
  if (answer.outcome === "found" || answer.outcome === "not_found") return answer.security.status === "complete";
  return true;
}

export async function getAnswer(store: Store, key: string): Promise<string | null> {
  return store.get(key);
}

/** Stores the exact JSON string the caller will send, so a later hit is byte-identical. */
export async function putAnswer(store: Store, key: string, answer: Answer, json: string): Promise<boolean> {
  if (!isCacheable(answer)) return false;
  await store.set(key, json);
  return true;
}

// --- In-flight lock ---

function lockKey(answerCacheKey: string): string {
  return `lock:${answerCacheKey}`;
}

export function lockTtlSec(maxTimeMs: number): number {
  return Math.ceil((maxTimeMs + 5_000) / 1000);
}

export async function acquireLock(store: Store, answerCacheKey: string, maxTimeMs: number): Promise<boolean> {
  return store.setNx(lockKey(answerCacheKey), "1", lockTtlSec(maxTimeMs));
}

export async function releaseLock(store: Store, answerCacheKey: string): Promise<void> {
  await store.del(lockKey(answerCacheKey));
}

/**
 * Waits up to `waitMs` for another instance's answer. Returns it, or null when the wait ran out
 * or the lock was released without an answer (for example after an outage, which is not cached).
 */
export async function waitForAnswer(
  store: Store,
  answerCacheKey: string,
  waitMs: number,
  pollMs = 250,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<string | null> {
  const deadline = now() + waitMs;
  for (;;) {
    const answer = await getAnswer(store, answerCacheKey);
    if (answer !== null) return answer;
    // The holder stores the answer before releasing the lock, so look once more after the lock is gone.
    if ((await store.get(lockKey(answerCacheKey))) === null) return getAnswer(store, answerCacheKey);
    if (now() >= deadline) return null;
    await sleep(pollMs);
  }
}
