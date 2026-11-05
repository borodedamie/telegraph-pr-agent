// The only way the miner reaches the network (research R8, FR-020 to FR-022).
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

export class BlockedHost extends Error {
  constructor(readonly reason: string) {
    super(`blocked: ${reason}`);
    this.name = "BlockedHost";
  }
}

export class TooLarge extends Error {
  constructor(readonly url: string, readonly maxBytes: number) {
    super(`response from ${url} exceeds ${maxBytes} bytes`);
    this.name = "TooLarge";
  }
}

export class Timeout extends Error {
  constructor(readonly url: string) {
    super(`timed out or aborted: ${url}`);
    this.name = "Timeout";
  }
}

// status 0 means the connection itself failed.
export class Upstream extends Error {
  constructor(readonly status: number, readonly url: string, options?: { cause?: unknown }) {
    super(`upstream ${status || "connection failure"}: ${url}`, options);
    this.name = "Upstream";
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface TransportRequest {
  url: URL;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  address: string;
  family: 4 | 6;
  signal: AbortSignal;
  maxBytes: number;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  ifNoneMatch?: string | null;
  ifModifiedSince?: string | null;
  resolver?: Resolver;
  transport?: Transport;
  /** One package website this call may also GET, beside the allowlist: the host of the package's npm homepage. */
  siteHost?: string;
}

export interface SafeResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
  notModified: boolean;
}

const MB = 1024 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const USER_AGENT = "telegraph-pr-agent-miner";
const OWNER_REPO = "[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+";

interface HostRule {
  methods: readonly ("GET" | "POST")[];
  path: RegExp;
  maxBytes: number;
}

// A Map, not an object: inherited names like "constructor" must not match a rule.
const HOST_RULES = new Map<string, HostRule>([
  ["registry.npmjs.org", { methods: ["GET"], path: /^\/.+/, maxBytes: 64 * MB }],
  ["api.github.com", {
    methods: ["GET"],
    // A renamed or transferred repo redirects to /repositories/<id>/...
    path: new RegExp(`^/(rate_limit$|repos/${OWNER_REPO}(/.*)?$|repositories/\\d+(/.*)?$)`),
    maxBytes: 2 * MB,
  }],
  ["github.com", { methods: ["GET"], path: new RegExp(`^/${OWNER_REPO}(/.*)?$`), maxBytes: 2 * MB }],
  ["raw.githubusercontent.com", { methods: ["GET"], path: new RegExp(`^/${OWNER_REPO}/.+`), maxBytes: 2 * MB }],
  ["api.osv.dev", { methods: ["POST"], path: /^\/v1\/query$/, maxBytes: 2 * MB }],
]);

// Two lists: BlockList also checks IPv4 addresses against IPv6 rules through ::ffff:0:0/96,
// so one shared list would block every IPv4 address.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_V4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_V6.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return family === 4 ? BLOCKED_V4.check(address, "ipv4") : BLOCKED_V6.check(address, "ipv6");
}

export function maxBytesFor(url: URL): number {
  return HOST_RULES.get(url.hostname)?.maxBytes ?? 0;
}

const SITE_RULE: HostRule = { methods: ["GET"], path: /^\//, maxBytes: 2 * MB };

function checkUrl(url: URL, method: "GET" | "POST", siteHost?: string): HostRule {
  if (url.protocol !== "https:") throw new BlockedHost(`protocol ${url.protocol}`);
  if (url.port !== "") throw new BlockedHost(`port ${url.port}`);
  if (url.username || url.password) throw new BlockedHost("credentials in URL");
  const rule = HOST_RULES.get(url.hostname) ?? (siteHost !== undefined && url.hostname === siteHost ? SITE_RULE : undefined);
  if (!rule) throw new BlockedHost(`host ${url.hostname}`);
  if (!rule.methods.includes(method)) throw new BlockedHost(`${method} to ${url.hostname}`);
  if (!rule.path.test(url.pathname)) throw new BlockedHost(`path ${url.pathname} on ${url.hostname}`);
  return rule;
}

// getaddrinfo takes no signal, so the deadline is enforced around it.
function untilAborted<T>(work: Promise<T>, signal: AbortSignal, url: URL): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Timeout(url.toString()));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const systemResolver: Resolver = async (hostname) => {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

// Makes the socket connect to the address that was already validated, so a second DNS answer cannot rebind it.
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      (callback as (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void)(null, [
        { address, family },
      ]);
    } else {
      callback(null, address, family);
    }
  };
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) flat[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flat;
}

const httpsTransport: Transport = (request) =>
  new Promise((resolve, reject) => {
    const outgoing = https.request(
      {
        hostname: request.url.hostname,
        servername: request.url.hostname,
        port: 443,
        path: request.url.pathname + request.url.search,
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        lookup: pinnedLookup(request.address, request.family),
      },
      (incoming) => {
        const declared = Number(incoming.headers["content-length"] ?? "0");
        if (declared > request.maxBytes) {
          outgoing.destroy(new TooLarge(request.url.toString(), request.maxBytes));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        incoming.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > request.maxBytes) {
            outgoing.destroy(new TooLarge(request.url.toString(), request.maxBytes));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: flattenHeaders(incoming.headers),
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
        incoming.on("error", reject);
      }
    );
    outgoing.on("error", reject);
    if (request.body !== undefined) outgoing.write(request.body);
    outgoing.end();
  });

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Fetches an allowlisted URL. Returns 2xx, 3xx-not-redirect and 4xx responses (404 is meaningful to callers);
 * throws Upstream for 5xx, 429 and connection failures, Timeout on timeout or abort, TooLarge over the host's cap,
 * BlockedHost for anything outside the allowlist or resolving to a non-public address.
 */
export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const resolver = options.resolver ?? systemResolver;
  const transport = options.transport ?? httpsTransport;
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  const originalHost = new URL(input).host;
  let url = new URL(input);
  let method = options.method ?? "GET";
  let body = options.body;

  for (let hop = 0; ; hop++) {
    const rule = checkUrl(url, method, options.siteHost);
    if (signal.aborted) throw new Timeout(url.toString());

    const addresses = await untilAborted(resolver(url.hostname), signal, url);
    if (addresses.length === 0) throw new BlockedHost(`no address for ${url.hostname}`);
    const blocked = addresses.find((a) => isBlockedAddress(a.address));
    if (blocked) throw new BlockedHost(`${url.hostname} resolves to ${blocked.address}`);

    const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "*/*" };
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      // Credentials never follow a redirect to another host.
      if (name.toLowerCase() === "authorization" && url.host !== originalHost) continue;
      headers[name.toLowerCase()] = value;
    }
    if (hop === 0 && options.ifNoneMatch) headers["if-none-match"] = options.ifNoneMatch;
    if (hop === 0 && options.ifModifiedSince) headers["if-modified-since"] = options.ifModifiedSince;

    let response: TransportResponse;
    try {
      response = await transport({
        url,
        method,
        headers,
        body,
        address: addresses[0].address,
        family: addresses[0].family,
        signal,
        maxBytes: rule.maxBytes,
      });
    } catch (err) {
      if (err instanceof TooLarge) throw err;
      if (signal.aborted) throw new Timeout(url.toString());
      throw new Upstream(0, url.toString(), { cause: err });
    }

    if (Buffer.byteLength(response.body, "utf8") > rule.maxBytes) throw new TooLarge(url.toString(), rule.maxBytes);

    if (REDIRECTS.has(response.status)) {
      if (hop >= MAX_REDIRECTS) throw new BlockedHost(`more than ${MAX_REDIRECTS} redirects from ${input}`);
      const location = response.headers["location"];
      if (!location) throw new Upstream(response.status, url.toString());
      url = new URL(location, url);
      if (response.status === 303 || (method === "POST" && response.status !== 307 && response.status !== 308)) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    if (response.status >= 500 || response.status === 429) throw new Upstream(response.status, url.toString());

    return {
      status: response.status,
      url: url.toString(),
      headers: response.headers,
      body: response.body,
      notModified: response.status === 304,
    };
  }
}
