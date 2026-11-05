// Matching of answer items to the benchmark's answer key (SC-002), shared by run.ts and judge.ts.
import type { Answer, ChangeItem } from "../src/types.js";

export interface ExpectedEntry {
  version: string;
  change: string;
  quote: string;
}

const STOP_WORDS = new Set("the and for are was were has have been with from that this now not its into when".split(" "));

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Comparable text: HTML and Markdown markup removed, quotes unified, whitespace collapsed, lower case. */
export function comparable(text: string, isPage: boolean): string {
  let out = text;
  if (isPage) {
    out = out.replace(/<\/?(code|a|em|strong|span|b|i|kbd)\b[^>]*>/gi, ""); // inline tags join their text
    out = decodeEntities(out.replace(/<[^>]+>/g, " "));
  }
  out = out
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/ ([.,:;)])/g, "$1");
  return out.trim().toLowerCase();
}

export function words(text: string): Set<string> {
  return new Set(
    comparable(text, false)
      .split(/[^a-z0-9.@/-]+/)
      .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
  );
}

/** An expected entry is found when an answer item of the same version quotes it, or says most of what it says. */
export function matches(expected: ExpectedEntry, item: ChangeItem): boolean {
  if (item.version !== expected.version) return false;
  const quote = comparable(expected.quote, false);
  const excerpt = comparable(item.excerpt ?? "", false);
  if (excerpt !== "" && (excerpt.includes(quote) || (excerpt.length >= 20 && quote.includes(excerpt)))) return true;
  const wanted = words(`${expected.change} ${expected.quote}`);
  const said = words(`${item.change} ${item.excerpt ?? ""}`);
  const shared = [...wanted].filter((w) => said.has(w)).length;
  if (wanted.size > 0 && shared / wanted.size >= 0.5) return true;
  // An item that quotes a guide's heading ("drops `errorMap`") while the key quotes the sentence under it:
  // it matches when it says at least three quarters of the key's own description of the change.
  const described = stems(expected.change);
  const stated = stems(`${item.change} ${item.excerpt ?? ""}`);
  const common = [...described].filter((w) => stated.has(w)).length;
  return common >= 2 && common / described.size >= 0.75;
}

/** Words cut to five letters, with dotted names split ("express.static.mime"), so "changed" meets "changes". */
function stems(text: string): Set<string> {
  return new Set(
    [...words(text)]
      .flatMap((w) => w.split("."))
      .filter((w) => w.length >= 3)
      .map((w) => w.slice(0, 5))
  );
}

export function recallOf(expected: ExpectedEntry[], answer: Answer) {
  const unused = answer.changes.filter((c) => c.kind === "breaking");
  const unmatched: ExpectedEntry[] = [];
  for (const entry of expected) {
    const index = unused.findIndex((item) => matches(entry, item));
    if (index === -1) unmatched.push(entry);
    else unused.splice(index, 1);
  }
  // `unused`: the answer's breaking items no entry took, for the judge to compare with `unmatched`.
  return { expected: expected.length, matched: expected.length - unmatched.length, unmatched, unused };
}
