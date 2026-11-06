// OSV advisories for both ends of an upgrade (research R6, FR-016): one query for A and one for B.
import { z } from "zod";
import { canonicalJson } from "../cache.js";
import { Timeout, TooLarge, Upstream } from "../safeFetch.js";
import { BudgetExhausted, fetchDocument, type Retrieval, type SourceDocument } from "./fetch.js";

export const OSV_QUERY_URL = "https://api.osv.dev/v1/query";
/** Pages per query; an advisory list longer than this is reported as partial. */
const MAX_PAGES = 3;

const OsvEvent = z.object({
  introduced: z.string().optional(),
  fixed: z.string().optional(),
  last_affected: z.string().optional(),
  limit: z.string().optional(),
});

const OsvVuln = z.object({
  id: z.string(),
  summary: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  modified: z.string().optional(),
  severity: z.array(z.object({ type: z.string(), score: z.string() })).default([]),
  database_specific: z.object({ severity: z.unknown().optional() }).passthrough().optional(),
  affected: z
    .array(
      z.object({
        package: z.object({ name: z.string(), ecosystem: z.string() }).partial().optional(),
        ranges: z.array(z.object({ type: z.string(), events: z.array(OsvEvent) })).default([]),
        versions: z.array(z.string()).default([]),
      })
    )
    .default([]),
});

const OsvResponse = z.object({ vulns: z.array(OsvVuln).default([]), next_page_token: z.string().optional() });

/** What the miner keeps of one OSV record: only the npm entries for the asked package. */
export const ReducedVuln = z.object({
  id: z.string(),
  summary: z.string().nullable(),
  aliases: z.array(z.string()),
  modified: z.string().nullable(),
  severity: z.array(z.object({ type: z.string(), score: z.string() })),
  databaseSeverity: z.string().nullable(),
  versions: z.array(z.string()),
  ranges: z.array(
    z.object({
      type: z.string(),
      events: z.array(
        z.object({
          introduced: z.string().optional(),
          fixed: z.string().optional(),
          lastAffected: z.string().optional(),
          limit: z.string().optional(),
        })
      ),
    })
  ),
});
export type ReducedVuln = z.infer<typeof ReducedVuln>;

const ReducedPage = z.object({ vulns: z.array(ReducedVuln), nextPageToken: z.string().nullable() });

/** Keeps the fields the affected check and the answer use, sorted, so an unchanged record hashes the same. */
export function reduceOsv(body: string, packageName: string): string {
  const response = OsvResponse.parse(JSON.parse(body));
  const vulns = response.vulns.map((vuln): ReducedVuln => {
    const entries = vuln.affected.filter((a) => a.package?.ecosystem === "npm" && a.package?.name === packageName);
    const severity = vuln.database_specific?.severity;
    return {
      id: vuln.id,
      summary: vuln.summary ?? null,
      aliases: vuln.aliases,
      modified: vuln.modified ?? null,
      severity: vuln.severity,
      databaseSeverity: typeof severity === "string" ? severity : null,
      versions: entries.flatMap((a) => a.versions),
      ranges: entries.flatMap((a) =>
        a.ranges.map((range) => ({
          type: range.type,
          events: range.events.map(({ introduced, fixed, last_affected, limit }) => ({ introduced, fixed, lastAffected: last_affected, limit })),
        }))
      ),
    };
  });
  vulns.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return canonicalJson({ vulns, nextPageToken: response.next_page_token ?? null });
}

export interface OsvResult {
  status: "complete" | "partial" | "unavailable";
  checkedAt: string | null;
  /** Union of both queries, each record once, with the document it was first read from. */
  vulns: { vuln: ReducedVuln; document: SourceDocument }[];
  /** Every page read, A's first: each becomes an `advisory` source. */
  documents: SourceDocument[];
}

/**
 * Queries OSV for A and for B. A query that fails or is cut makes the check partial (both failed: unavailable);
 * the migration answer goes on either way.
 */
export async function advisoriesFor(retrieval: Retrieval, packageName: string, versions: string[]): Promise<OsvResult> {
  const documents: SourceDocument[] = [];
  const byId = new Map<string, { vuln: ReducedVuln; document: SourceDocument }>();
  let failed = 0;
  let truncated = false;
  for (const version of versions) {
    let pageToken: string | null = null;
    try {
      for (let page = 1; ; page++) {
        const query = canonicalJson({ package: { ecosystem: "npm", name: packageName }, version, ...(pageToken ? { page_token: pageToken } : {}) });
        const document = await fetchDocument(retrieval, OSV_QUERY_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: query,
          manifestId: query,
          toText: (body) => reduceOsv(body, packageName),
        });
        // The query endpoint never answers 404 for a valid query: treat it as the check failing.
        if (document === null) throw new Upstream(404, OSV_QUERY_URL);
        documents.push(document);
        const reduced = ReducedPage.parse(JSON.parse(document.text));
        for (const vuln of reduced.vulns) if (!byId.has(vuln.id)) byId.set(vuln.id, { vuln, document });
        pageToken = reduced.nextPageToken;
        if (pageToken === null) break;
        if (page === MAX_PAGES) {
          truncated = true;
          break;
        }
      }
    } catch (err) {
      if (!isOsvFailure(err)) throw err;
      console.warn(JSON.stringify({ kind: "osv_unavailable", version, error: String(err) }));
      failed++;
    }
  }
  const status = failed === versions.length ? "unavailable" : failed > 0 || truncated ? "partial" : "complete";
  return {
    status,
    checkedAt: status === "unavailable" ? null : new Date(retrieval.now()).toISOString(),
    vulns: [...byId.values()],
    documents,
  };
}

/** An outage, a cut, an oversized or malformed response: the advisory check could not finish. */
function isOsvFailure(err: unknown): boolean {
  return err instanceof Upstream || err instanceof Timeout || err instanceof TooLarge || err instanceof BudgetExhausted || err instanceof z.ZodError || err instanceof SyntaxError;
}
