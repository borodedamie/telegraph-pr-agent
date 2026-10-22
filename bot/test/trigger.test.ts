import { describe, expect, it, vi } from "vitest";
import { detectCutoffTriggers } from "../src/trigger.js";

const CUTOFF = new Date("2025-01-01T00:00:00Z");

function pkg(deps: Record<string, string>): string {
  return JSON.stringify({ name: "demo", dependencies: deps });
}

function registryFetch(times: Record<string, string | undefined>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const body = { name: "x", time: { created: "2020-01-01T00:00:00Z", ...times } };
    for (const v of Object.keys(times)) if (times[v] === undefined) delete (body.time as Record<string, string>)[v];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("detectCutoffTriggers", () => {
  it("fires for a bump to a version released after the cutoff", async () => {
    const triggers = await detectCutoffTriggers(
      { basePackageJson: pkg({ zod: "3.24.0" }), headPackageJson: pkg({ zod: "4.0.0" }) },
      CUTOFF,
      registryFetch({ "4.0.0": "2025-05-01T00:00:00Z" })
    );
    expect(triggers).toEqual([
      { package: "zod", version: "4.0.0", releaseDate: "2025-05-01T00:00:00Z", status: "past-cutoff" },
    ]);
  });

  it("returns no triggers for a bump released before the cutoff (AC-2)", async () => {
    const triggers = await detectCutoffTriggers(
      { basePackageJson: pkg({ zod: "3.23.0" }), headPackageJson: pkg({ zod: "3.24.0" }) },
      CUTOFF,
      registryFetch({ "3.24.0": "2024-11-01T00:00:00Z" })
    );
    expect(triggers).toEqual([]);
  });

  it("marks a version missing from the registry as unverifiable", async () => {
    const triggers = await detectCutoffTriggers(
      { basePackageJson: pkg({ zod: "3.24.0" }), headPackageJson: pkg({ zod: "9.9.9" }) },
      CUTOFF,
      registryFetch({ "9.9.9": undefined })
    );
    expect(triggers).toEqual([
      { package: "zod", version: "9.9.9", releaseDate: null, status: "unverifiable" },
    ]);
  });

  it("ignores unchanged dependencies", async () => {
    const fetchMock = registryFetch({ "3.24.0": "2025-05-01T00:00:00Z" });
    const triggers = await detectCutoffTriggers(
      { basePackageJson: pkg({ zod: "3.24.0", vite: "6.0.0" }), headPackageJson: pkg({ zod: "3.24.0", vite: "6.1.0" }) },
      CUTOFF,
      fetchMock
    );
    expect(triggers.map((t) => t.package)).toEqual(["vite"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("makes zero registry calls when no dependency changed (AC-2)", async () => {
    const fetchMock = registryFetch({});
    const triggers = await detectCutoffTriggers(
      { basePackageJson: pkg({ zod: "3.24.0" }), headPackageJson: pkg({ zod: "3.24.0" }) },
      CUTOFF,
      fetchMock
    );
    expect(triggers).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detects newly added dependencies", async () => {
    const triggers = await detectCutoffTriggers(
      { basePackageJson: pkg({}), headPackageJson: pkg({ tsx: "4.20.0" }) },
      CUTOFF,
      registryFetch({ "4.20.0": "2025-06-01T00:00:00Z" })
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].status).toBe("past-cutoff");
  });

  it("resolves a caret range to the bare version when looking up its release date", async () => {
    const triggers = await detectCutoffTriggers(
      { basePackageJson: pkg({ zod: "^3.24.0" }), headPackageJson: pkg({ zod: "^4.6.7" }) },
      CUTOFF,
      registryFetch({ "4.6.7": "2025-05-01T00:00:00Z" })
    );
    expect(triggers).toEqual([
      { package: "zod", version: "^4.6.7", releaseDate: "2025-05-01T00:00:00Z", status: "past-cutoff" },
    ]);
  });

  it("resolves a tilde range to the bare version when looking up its release date", async () => {
    const triggers = await detectCutoffTriggers(
      { basePackageJson: pkg({ zod: "~3.24.0" }), headPackageJson: pkg({ zod: "~4.6.7" }) },
      CUTOFF,
      registryFetch({ "4.6.7": "2025-05-01T00:00:00Z" })
    );
    expect(triggers[0].status).toBe("past-cutoff");
    expect(triggers[0].releaseDate).toBe("2025-05-01T00:00:00Z");
  });
});
