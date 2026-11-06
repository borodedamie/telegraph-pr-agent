// Part of every cache key (research R3): bump when extraction rules, prompts, LLM miners or the output schema change.
// p2: breaking-change phrases in major releases (4 Nov 2026).
// p3: the OSV advisory check (4 Nov 2026).
// p4: model replies cut off mid-JSON keep their whole items; the prompt lists breaking changes first (5 Nov 2026).
// p5: an answer whose only read release did not fit the model is found, not not_found (vite 6.0.0, 5 Nov 2026).
export const PROCESSING_VERSION = process.env.PROCESSING_VERSION ?? "p5";
