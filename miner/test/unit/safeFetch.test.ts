import { describe, expect, it } from "vitest";
import {
  BlockedHost,
  Timeout,
  TooLarge,
  Upstream,
  isBlockedAddress,
  pinnedLookup,
  safeFetch,
  type Resolver,
  type Transport,
  type TransportRequest,
} from "../../src/safeFetch.js";

const PUBLIC_V4 = "140.82.112.5";

function publicResolver(): Resolver & { calls: string[] } {
  const calls: string[] = [];
  const resolver = (async (hostname: string) => {
    calls.push(hostname);
    return [{ address: PUBLIC_V4, family: 4 as const }];
  }) as Resolver & { calls: string[] };
  resolver.calls = calls;
  return resolver;
}

function transportReplying(
  replies: Array<{ status: number; headers?: Record<string, string>; body?: string }>
): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const transport = (async (request: TransportRequest) => {
    requests.push(request);
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    return { status: reply.status, headers: reply.headers ?? {}, body: reply.body ?? "" };
  }) as Transport & { requests: TransportRequest[] };
  transport.requests = requests;
  return transport;
}

describe("safeFetch", () => {
  it("fetches an allowed host and connects to the validated address", async () => {
    const resolver = publicResolver();
    const transport = transportReplying([{ status: 200, body: "ok" }]);
    const response = await safeFetch("https://registry.npmjs.org/zod", { resolver, transport });
    expect(response.status).toBe(200);
    expect(response.body).toBe("ok");
    expect(transport.requests[0].address).toBe(PUBLIC_V4);
  });

  it("refuses hosts outside the allowlist", async () => {
    await expect(
      safeFetch("https://example.com/", { resolver: publicResolver(), transport: transportReplying([]) })
    ).rejects.toBeInstanceOf(BlockedHost);
  });

  it("refuses http and non-default ports", async () => {
    const options = { resolver: publicResolver(), transport: transportReplying([]) };
    await expect(safeFetch("http://registry.npmjs.org/zod", options)).rejects.toBeInstanceOf(BlockedHost);
    await expect(safeFetch("https://registry.npmjs.org:8443/zod", options)).rejects.toBeInstanceOf(BlockedHost);
  });

  it("allows only POST /v1/query on OSV", async () => {
    const options = { resolver: publicResolver(), transport: transportReplying([{ status: 200 }]) };
    await expect(safeFetch("https://api.osv.dev/v1/vulns/GHSA-x", { ...options, method: "POST" })).rejects.toBeInstanceOf(
      BlockedHost
    );
    await expect(safeFetch("https://api.osv.dev/v1/query", options)).rejects.toBeInstanceOf(BlockedHost);
    const ok = await safeFetch("https://api.osv.dev/v1/query", { ...options, method: "POST", body: "{}" });
    expect(ok.status).toBe(200);
  });

  it("refuses redirects to private and metadata addresses", async () => {
    for (const location of ["https://127.0.0.1/", "https://169.254.169.254/latest/meta-data"]) {
      const transport = transportReplying([{ status: 302, headers: { location } }]);
      await expect(
        safeFetch("https://api.github.com/repos/colinhacks/zod/releases", { resolver: publicResolver(), transport })
      ).rejects.toBeInstanceOf(BlockedHost);
    }
  });

  it("refuses hostnames that resolve to private or loopback addresses", async () => {
    for (const address of ["10.0.0.1", "::1", "fd00:ec2::254", "::ffff:10.0.0.1"]) {
      const resolver: Resolver = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
      await expect(
        safeFetch("https://registry.npmjs.org/zod", { resolver, transport: transportReplying([{ status: 200 }]) })
      ).rejects.toBeInstanceOf(BlockedHost);
    }
  });

  it("resolves once per hop, so a second DNS answer cannot rebind the connection", async () => {
    const answers = [PUBLIC_V4, "10.0.0.1"];
    let calls = 0;
    const resolver: Resolver = async () => [{ address: answers[calls++], family: 4 }];
    const transport = transportReplying([{ status: 200 }]);
    await safeFetch("https://registry.npmjs.org/zod", { resolver, transport });
    expect(calls).toBe(1);
    expect(transport.requests[0].address).toBe(PUBLIC_V4);
  });

  it("pins the socket lookup to the validated address", () => {
    const lookup = pinnedLookup(PUBLIC_V4, 4);
    let single: unknown;
    let all: unknown;
    lookup("registry.npmjs.org", {}, (_err, address) => (single = address));
    lookup("registry.npmjs.org", { all: true }, (_err, addresses) => (all = addresses));
    expect(single).toBe(PUBLIC_V4);
    expect(all).toEqual([{ address: PUBLIC_V4, family: 4 }]);
  });

  it("stops after three redirects", async () => {
    const transport = transportReplying([
      { status: 301, headers: { location: "https://api.github.com/repos/a/b/releases?page=2" } },
    ]);
    await expect(
      safeFetch("https://api.github.com/repos/a/b/releases", { resolver: publicResolver(), transport })
    ).rejects.toBeInstanceOf(BlockedHost);
    expect(transport.requests).toHaveLength(4);
  });

  it("drops the authorization header on a redirect to another host", async () => {
    const transport = transportReplying([
      { status: 302, headers: { location: "https://raw.githubusercontent.com/a/b/main/CHANGELOG.md" } },
      { status: 200, body: "# Changelog" },
    ]);
    await safeFetch("https://api.github.com/repos/a/b/contents/CHANGELOG.md", {
      resolver: publicResolver(),
      transport,
      headers: { Authorization: "Bearer secret" },
    });
    expect(transport.requests[0].headers.authorization).toBe("Bearer secret");
    expect(transport.requests[1].headers.authorization).toBeUndefined();
  });

  it("applies per-host size caps", async () => {
    const threeMb = "x".repeat(3 * 1024 * 1024);
    const transport = transportReplying([{ status: 200, body: threeMb }]);
    await expect(
      safeFetch("https://api.github.com/repos/a/b/releases", { resolver: publicResolver(), transport })
    ).rejects.toBeInstanceOf(TooLarge);
    const registry = await safeFetch("https://registry.npmjs.org/typescript", { resolver: publicResolver(), transport });
    expect(registry.body.length).toBe(threeMb.length);
  });

  it("returns 304 as not modified and sends conditional headers", async () => {
    const transport = transportReplying([{ status: 304 }]);
    const response = await safeFetch("https://api.github.com/repos/a/b/releases", {
      resolver: publicResolver(),
      transport,
      ifNoneMatch: '"abc"',
      ifModifiedSince: "Mon, 03 Nov 2026 00:00:00 GMT",
    });
    expect(response.notModified).toBe(true);
    expect(transport.requests[0].headers["if-none-match"]).toBe('"abc"');
    expect(transport.requests[0].headers["if-modified-since"]).toBe("Mon, 03 Nov 2026 00:00:00 GMT");
  });

  it("throws Upstream for 5xx and 429, and returns 404", async () => {
    const options = (status: number) => ({ resolver: publicResolver(), transport: transportReplying([{ status }]) });
    await expect(safeFetch("https://registry.npmjs.org/zod", options(503))).rejects.toBeInstanceOf(Upstream);
    await expect(safeFetch("https://registry.npmjs.org/zod", options(429))).rejects.toBeInstanceOf(Upstream);
    expect((await safeFetch("https://registry.npmjs.org/nope", options(404))).status).toBe(404);
  });

  it("maps connection failures to Upstream(0)", async () => {
    const transport: Transport = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(safeFetch("https://registry.npmjs.org/zod", { resolver: publicResolver(), transport })).rejects.toMatchObject(
      { name: "Upstream", status: 0 }
    );
  });

  it("maps an abort to Timeout", async () => {
    const controller = new AbortController();
    const transport: Transport = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("aborted")));
        controller.abort();
      });
    await expect(
      safeFetch("https://registry.npmjs.org/zod", { resolver: publicResolver(), transport, signal: controller.signal })
    ).rejects.toBeInstanceOf(Timeout);
  });
});

describe("isBlockedAddress", () => {
  it("blocks private, loopback, link-local, CGNAT and metadata ranges", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "169.254.169.254", "::1", "fe80::1", "fc00::1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses and rejects non-addresses", () => {
    expect(isBlockedAddress(PUBLIC_V4)).toBe(false);
    expect(isBlockedAddress("2606:4700::6810:84e5")).toBe(false);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});
