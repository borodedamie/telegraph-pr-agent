// Every source document goes through here: budget, source manifest, conditional GET and snapshot (research R3).
import { getManifest, getSnapshot, isFresh, putManifest, putSnapshot, type Store } from "../cache.js";
import type { Budget } from "../budget.js";
import { Upstream, safeFetch } from "../safeFetch.js";

export class BudgetExhausted extends Error {
  constructor(readonly url: string) {
    super(`source budget exhausted before ${url}`);
    this.name = "BudgetExhausted";
  }
}

export interface Retrieval {
  store: Store;
  budget: Budget;
  fetcher: typeof safeFetch;
  now: () => number;
  upstreamRequests: number;
  conditionalHits: number;
}

export function newRetrieval(store: Store, budget: Budget, fetcher: typeof safeFetch = safeFetch): Retrieval {
  return { store, budget, fetcher, now: Date.now, upstreamRequests: 0, conditionalHits: 0 };
}

export interface SourceDocument {
  url: string;
  text: string;
  contentHash: string;
  snapshotKey: string;
  retrievedAt: string;
}

export interface FetchDocumentOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Manifest identity; defaults to the URL. OSV uses the canonical query body. */
  manifestId?: string;
  /** Turns the response body into the text that is hashed and snapshotted. */
  toText: (body: string) => string;
}

/** Returns the document, or null when the upstream says it does not exist (404 or 410). */
export async function fetchDocument(
  retrieval: Retrieval,
  url: string,
  options: FetchDocumentOptions
): Promise<SourceDocument | null> {
  const manifestId = options.manifestId ?? url;
  const entry = await getManifest(retrieval.store, manifestId);
  const snapshot = entry ? await getSnapshot(retrieval.store, entry.snapshotKey) : null;

  if (entry && snapshot !== null && isFresh(entry, retrieval.now())) {
    return { url, text: snapshot, contentHash: entry.contentHash, snapshotKey: entry.snapshotKey, retrievedAt: entry.fetchedAt };
  }

  if (!retrieval.budget.takeSourceRequest()) throw new BudgetExhausted(url);
  retrieval.upstreamRequests++;
  // A conditional request only makes sense when the snapshot it would reuse is still there.
  const conditional = entry && snapshot !== null;
  const response = await retrieval.fetcher(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: retrieval.budget.signal,
    ifNoneMatch: conditional ? entry.etag : null,
    ifModifiedSince: conditional ? entry.lastModified : null,
  });
  const fetchedAt = new Date(retrieval.now()).toISOString();

  if (response.notModified && entry && snapshot !== null) {
    retrieval.conditionalHits++;
    await putManifest(retrieval.store, manifestId, { ...entry, fetchedAt });
    return { url, text: snapshot, contentHash: entry.contentHash, snapshotKey: entry.snapshotKey, retrievedAt: fetchedAt };
  }
  if (response.status === 404 || response.status === 410) return null;
  if (response.status < 200 || response.status >= 300) throw new Upstream(response.status, url);

  const text = options.toText(response.body);
  const { contentHash, snapshotKey } = await putSnapshot(retrieval.store, text);
  await putManifest(retrieval.store, manifestId, {
    etag: response.headers.etag ?? null,
    lastModified: response.headers["last-modified"] ?? null,
    fetchedAt,
    contentHash,
    snapshotKey,
  });
  return { url, text, contentHash, snapshotKey, retrievedAt: fetchedAt };
}
