// Part of every cache key (research R3): bump when extraction rules, prompts, LLM miners or the output schema change.
// p2: breaking-change phrases in major releases (4 Nov 2026).
// p3: the OSV advisory check (4 Nov 2026).
// p4: model replies cut off mid-JSON keep their whole items; the prompt lists breaking changes first (5 Nov 2026).
// p5: an answer whose only read release did not fit the model is found, not not_found (vite 6.0.0, 5 Nov 2026).
// p8: found answers lead with a "Key changes" line, inside the 512 tokens the QA judge reads (9 Nov 2026).
// Production sets PROCESSING_VERSION on Vercel (p7 since 6 Nov), so a deploy of this change sets it to p8 there too.
// p9: the coverage line groups adjacent releases not covered for the same reason (10 Nov 2026).
export const PROCESSING_VERSION = process.env.PROCESSING_VERSION ?? "p9";
