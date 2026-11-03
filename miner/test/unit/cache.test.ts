import { describe, expect, it } from "vitest";
import {
  MemoryStore,
  acquireLock,
  answerKey,
  canonicalJson,
  getAnswer,
  getManifest,
  getSnapshot,
  isFresh,
  putAnswer,
  putManifest,
  putSnapshot,
  waitForAnswer,
} from "../../src/cache.js";
import { stubAnswer } from "../../src/stub.js";
import type { Answer, NormalizedRequest } from "../../src/types.js";

const explicit: NormalizedRequest = {
  ecosystem: "npm",
  package: "zod",
  fromRequested: "3.23.8",
  toRequested: "4.0.0",
  fromResolved: "3.23.8",
  toResolved: "4.0.0",
  fromAssumed: false,
};
const assumed: NormalizedRequest = { ...explicit, fromRequested: null, fromAssumed: true };
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function foundAnswer(status: Answer["security"]["status"]): Answer {
  return {
    ...stubAnswer(),
    outcome: "found",
    request: explicit,
    coverage: { complete: true, covered: ["4.0.0"], notCovered: [] },
    security: { status, checkedAt: null, advisories: [], documentedFixes: 0 },
  };
}

describe("answerKey", () => {
  it("does not depend on source order", () => {
    expect(answerKey(explicit, [hashA, hashB], "p1")).toBe(answerKey(explicit, [hashB, hashA], "p1"));
  });

  it("changes with any source hash, including the OSV response hash", () => {
    expect(answerKey(explicit, [hashA], "p1")).not.toBe(answerKey(explicit, [hashA, hashB], "p1"));
  });

  it("changes with the processing version", () => {
    expect(answerKey(explicit, [hashA], "p1")).not.toBe(answerKey(explicit, [hashA], "p2"));
  });

  it("separates an explicit from version from an assumed one for the same resolved pair", () => {
    expect(answerKey(explicit, [hashA], "p1")).not.toBe(answerKey(assumed, [hashA], "p1"));
  });

  it("is the same at lookup and at store for the same consulted set", () => {
    const atLookup = answerKey({ ...explicit }, [hashB, hashA], "p1");
    const atStore = answerKey(explicit, [hashA, hashB], "p1");
    expect(atLookup).toBe(atStore);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe("answer cache", () => {
  it("returns the stored JSON byte for byte", async () => {
    const store = new MemoryStore();
    const answer = foundAnswer("complete");
    const json = JSON.stringify(answer);
    expect(await putAnswer(store, "answer:k", answer, json)).toBe(true);
    expect(await getAnswer(store, "answer:k")).toBe(json);
  });

  it("refuses outages and answers with an incomplete security check", async () => {
    const store = new MemoryStore();
    for (const answer of [
      foundAnswer("unavailable"),
      foundAnswer("partial"),
      { ...foundAnswer("complete"), outcome: "temporarily_unavailable" as const },
    ]) {
      expect(await putAnswer(store, "answer:k", answer, JSON.stringify(answer))).toBe(false);
    }
    expect(await getAnswer(store, "answer:k")).toBeNull();
  });

  it("caches out_of_scope answers, which never reach OSV", async () => {
    const store = new MemoryStore();
    const answer = stubAnswer();
    expect(await putAnswer(store, "answer:k", answer, JSON.stringify(answer))).toBe(true);
  });
});

describe("manifest and snapshots", () => {
  it("round-trips a manifest entry and a snapshot", async () => {
    const store = new MemoryStore();
    const text = "## 4.0.0\n- breaking\n\n## 3.25.0\n- feature\n";
    const { contentHash, snapshotKey } = await putSnapshot(store, text);
    await putManifest(store, "https://raw.githubusercontent.com/a/b/main/CHANGELOG.md", {
      etag: '"e1"',
      lastModified: null,
      fetchedAt: new Date().toISOString(),
      contentHash,
      snapshotKey,
    });
    const entry = await getManifest(store, "https://raw.githubusercontent.com/a/b/main/CHANGELOG.md");
    expect(entry?.contentHash).toBe(contentHash);
    // The whole document is kept, so any version's section can be derived after a 304.
    expect(await getSnapshot(store, entry!.snapshotKey)).toBe(text);
  });

  it("treats entries older than an hour as stale", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const entry = { etag: null, lastModified: null, contentHash: hashA, snapshotKey: `snap:${hashA}` };
    expect(isFresh({ ...entry, fetchedAt: "2026-11-03T11:30:00Z" }, now)).toBe(true);
    expect(isFresh({ ...entry, fetchedAt: "2026-11-03T10:59:00Z" }, now)).toBe(false);
  });
});

describe("in-flight lock", () => {
  it("lets one caller in and makes the second wait for its answer", async () => {
    const store = new MemoryStore();
    expect(await acquireLock(store, "answer:k", 20_000)).toBe(true);
    expect(await acquireLock(store, "answer:k", 20_000)).toBe(false);

    let polls = 0;
    const sleep = async () => {
      polls++;
      if (polls === 2) await store.set("answer:k", '{"done":true}');
    };
    expect(await waitForAnswer(store, "answer:k", 5_000, 250, Date.now, sleep)).toBe('{"done":true}');
  });

  it("gives up after the wait time", async () => {
    const store = new MemoryStore();
    await acquireLock(store, "answer:k", 20_000);
    let clock = 0;
    const now = () => clock;
    const sleep = async (ms: number) => {
      clock += ms;
    };
    expect(await waitForAnswer(store, "answer:k", 5_000, 250, now, sleep)).toBeNull();
    expect(clock).toBe(5_000);
  });
});
