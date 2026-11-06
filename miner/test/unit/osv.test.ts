import { describe, expect, it } from "vitest";
import { Budget, limitsFromEnv } from "../../src/budget.js";
import { MemoryStore } from "../../src/cache.js";
import type { SafeResponse } from "../../src/safeFetch.js";
import { newRetrieval } from "../../src/sources/fetch.js";
import { OSV_QUERY_URL, advisoriesFor } from "../../src/sources/osv.js";

const vuln = (id: string) => ({ id, affected: [{ package: { name: "pkg", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }] }] });

/** Answers each query page from `pages`, keyed by version and page token. */
function pagedOsv(pages: Record<string, { vulns: object[]; next_page_token?: string }>) {
  const bodies: string[] = [];
  const fetcher = async (url: string, options: { body?: string } = {}): Promise<SafeResponse> => {
    bodies.push(options.body ?? "");
    const query = JSON.parse(options.body ?? "{}") as { version: string; page_token?: string };
    const page = pages[`${query.version}:${query.page_token ?? ""}`];
    return page === undefined
      ? { status: 503, url, headers: {}, body: "", notModified: false }
      : { status: 200, url, headers: {}, body: JSON.stringify(page), notModified: false };
  };
  return { fetcher, bodies };
}

function retrieval(fetcher: ReturnType<typeof pagedOsv>["fetcher"]) {
  return newRetrieval(new MemoryStore(), new Budget(limitsFromEnv({})), fetcher);
}

describe("advisoriesFor", () => {
  it("follows page tokens and keeps each record once across both queries", async () => {
    const { fetcher, bodies } = pagedOsv({
      "1.0.0:": { vulns: [vuln("GHSA-b"), vuln("GHSA-a")], next_page_token: "t1" },
      "1.0.0:t1": { vulns: [vuln("GHSA-c")] },
      "2.0.0:": { vulns: [vuln("GHSA-a")] },
    });
    const result = await advisoriesFor(retrieval(fetcher), "pkg", ["1.0.0", "2.0.0"]);
    expect(result.status).toBe("complete");
    expect(result.vulns.map((v) => v.vuln.id)).toEqual(["GHSA-a", "GHSA-b", "GHSA-c"]);
    expect(result.documents).toHaveLength(3);
    expect(JSON.parse(bodies[1])).toMatchObject({ page_token: "t1", version: "1.0.0" });
  });

  it("is partial when a query has more pages than it reads", async () => {
    const { fetcher } = pagedOsv({
      "1.0.0:": { vulns: [vuln("GHSA-a")], next_page_token: "t1" },
      "1.0.0:t1": { vulns: [vuln("GHSA-b")], next_page_token: "t2" },
      "1.0.0:t2": { vulns: [vuln("GHSA-c")], next_page_token: "t3" },
      "2.0.0:": { vulns: [] },
    });
    expect((await advisoriesFor(retrieval(fetcher), "pkg", ["1.0.0", "2.0.0"])).status).toBe("partial");
  });

  it("is unavailable when both queries fail, with no check time", async () => {
    const { fetcher } = pagedOsv({});
    expect(await advisoriesFor(retrieval(fetcher), "pkg", ["1.0.0", "2.0.0"])).toMatchObject({ status: "unavailable", checkedAt: null, vulns: [] });
  });

  it("asks OSV for the npm package by name, on the query path only", async () => {
    const { fetcher, bodies } = pagedOsv({ "1.0.0:": { vulns: [] }, "2.0.0:": { vulns: [] } });
    const r = retrieval(fetcher);
    await advisoriesFor(r, "pkg", ["1.0.0", "2.0.0"]);
    expect(JSON.parse(bodies[0])).toEqual({ package: { ecosystem: "npm", name: "pkg" }, version: "1.0.0" });
    expect(r.documents.every((d) => d.url === OSV_QUERY_URL)).toBe(true);
  });
});
