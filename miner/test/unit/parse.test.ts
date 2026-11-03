import { describe, expect, it } from "vitest";
import { parse } from "../../src/parse.js";

describe("parse", () => {
  it("reads an exact from/to pair", () => {
    expect(parse("What changed in zod from 3.23.8 to 4.0.0?")).toEqual({
      kind: "ok",
      package: "zod",
      fromRequested: "3.23.8",
      toRequested: "4.0.0",
    });
    expect(parse("zod 3.23.8 → 4.0.0")).toMatchObject({ package: "zod", fromRequested: "3.23.8", toRequested: "4.0.0" });
    expect(parse("zod@3.23.8 to zod@4.0.0")).toMatchObject({ package: "zod", fromRequested: "3.23.8" });
    expect(parse("What changed in the npm package zod between v3.23.8 and v4.0.0")).toMatchObject({
      fromRequested: "3.23.8",
      toRequested: "4.0.0",
    });
  });

  it("reads a scoped name", () => {
    expect(parse("Breaking changes upgrading @tanstack/react-query to 5.0.0")).toEqual({
      kind: "ok",
      package: "@tanstack/react-query",
      fromRequested: null,
      toRequested: "5.0.0",
    });
    expect(parse("@babel/core@7.20.0 -> 7.24.0")).toMatchObject({ package: "@babel/core", toRequested: "7.24.0" });
  });

  it("reads ranges and partial versions", () => {
    expect(parse("react 17 to 18")).toMatchObject({ package: "react", fromRequested: "17", toRequested: "18" });
    expect(parse("upgrade express from ^4.18 to 5.x")).toMatchObject({ fromRequested: "^4.18", toRequested: "5.x" });
  });

  it("reads a target-only question", () => {
    expect(parse("What breaks if I upgrade zod to 4.0.0?")).toEqual({
      kind: "ok",
      package: "zod",
      fromRequested: null,
      toRequested: "4.0.0",
    });
    expect(parse("List the 3 breaking changes in zod 4.0.0")).toMatchObject({ package: "zod", toRequested: "4.0.0" });
  });

  it("asks for clarification instead of guessing", () => {
    expect(parse("What changed in React after 18?")).toMatchObject({ kind: "needs_clarification" });
    expect(parse("What changed in the zod package?")).toMatchObject({ kind: "needs_clarification" });
    expect(parse("zod 1.0.0 to 2.0.0 to 3.0.0")).toMatchObject({ kind: "needs_clarification" });
    expect(parse("zod@3.0.0 to yup@1.0.0")).toMatchObject({ kind: "needs_clarification" });
  });

  it("marks questions about something else out of scope", () => {
    expect(parse("What is the weather in Paris?")).toMatchObject({ kind: "out_of_scope" });
  });
});
