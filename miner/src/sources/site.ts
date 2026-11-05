// A migration guide on the package's own website (research R5, step 4): found only through a link in the
// package's official notes, and only on the host of its npm `homepage`. Website HTML is untrusted: every pattern
// here is bounded, and the page is read tag by tag in one pass.

/** The website host of a package, or null when its homepage is the repository or the registry. */
export function siteHostOf(homepage: string | null | undefined): string | null {
  if (!homepage) return null;
  let url: URL;
  try {
    url = new URL(homepage);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "github.com" || host.endsWith(".github.com") || host.endsWith("npmjs.com") || host.endsWith("npmjs.org")) return null;
  return host;
}

const LINK = /\[([^\]]{0,200})\]\((https:\/\/[^)\s]{1,400})\)|(https:\/\/[^\s)\]<>"']{1,400})/g;
const GUIDE_WORDS = /migrat|upgrad|guide|blog|announc|what-?s-new|release-notes/i;

// A migration or upgrade guide lists every change; an announcement or a blog post often only the main ones.
const rank = (words: string) => (/migrat|upgrad/i.test(words) ? 0 : /guide/i.test(words) ? 1 : 2);

/** The best guide link in these notes on the website host (`www.` or not), or null: a migration guide first. */
export function siteGuideLink(texts: string[], site: string): string | null {
  const bare = site.replace(/^www\./, "");
  let best: { url: string; rank: number } | null = null;
  for (const text of texts) {
    for (const match of text.matchAll(LINK)) {
      const href = match[2] ?? match[3];
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        continue;
      }
      const words = `${match[1] ?? ""} ${url.pathname}`;
      if (url.hostname.replace(/^www\./, "") !== bare || !GUIDE_WORDS.test(words)) continue;
      url.hash = "";
      if (best === null || rank(words) < best.rank) best = { url: url.toString(), rank: rank(words) };
    }
  }
  return best?.url ?? null;
}

/**
 * The guide's source in its repository, from the page's "Edit this page" link
 * (`https://github.com/expressjs/expressjs.com/edit/main/src/.../migrating-5.mdx`), as a raw URL; or null.
 */
export function editSource(html: string): string | null {
  const match = /https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/edit\/([^\s"'<>]{1,300}?\.mdx?)["'\s<>]/.exec(html);
  if (!match) return null;
  // "docs/./src/use/x.md" and "docs/../docs/x.md" (babel) are normal paths once resolved.
  const path = new URL(match[3], "https://raw.githubusercontent.com/").pathname;
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}${path}`;
}

const SKIPPED = new Set(["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "template", "button", "form"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "br", "tr", "table", "ul", "ol", "dl", "dt", "dd", "blockquote", "hr"]);
// A tag never holds a "<", so a page of unclosed tags is still read in one pass.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]{0,20})\b[^<>]{0,2000}>/g;

function withoutComments(html: string): string {
  const parts: string[] = [];
  let at = 0;
  for (let open = html.indexOf("<!--"); open !== -1; open = html.indexOf("<!--", at)) {
    parts.push(html.slice(at, open));
    const close = html.indexOf("-->", open + 4);
    if (close === -1) return parts.join("");
    at = close + 3;
  }
  parts.push(html.slice(at));
  return parts.join("");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8}|#39);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/**
 * A guide page as Markdown-like text: headings as `#`, list items as `- `, code blocks fenced, navigation and
 * scripts left out. Only the `<main>` or `<article>` part is read when the page has one.
 */
export function htmlToText(html: string): string {
  const clean = withoutComments(html);
  const start = /<(main|article)\b[^<>]{0,2000}>/i.exec(clean);
  const page = start ? clean.slice(start.index) : clean;
  const out: string[] = [];
  let skip = 0;
  let pre = false;
  let last = 0;
  const emit = (text: string) => {
    if (skip === 0) out.push(pre ? text : text.replace(/\s+/g, " "));
  };
  for (const match of page.matchAll(TAG)) {
    emit(decode(page.slice(last, match.index)));
    last = match.index + match[0].length;
    const name = match[2].toLowerCase();
    const closing = match[1] === "/";
    if (SKIPPED.has(name)) {
      skip = Math.max(0, skip + (closing ? -1 : 1));
      continue;
    }
    if (skip > 0) continue;
    if (name === "pre") {
      pre = !closing;
      out.push(closing ? "\n```\n" : "\n```\n");
    } else if (/^h[1-4]$/.test(name)) {
      out.push(closing ? "\n" : `\n${"#".repeat(Number(name[1]))} `);
    } else if (name === "li") {
      if (!closing) out.push("\n- ");
    } else if (BLOCK.has(name)) {
      out.push("\n");
    }
  }
  emit(decode(page.slice(last)));
  return out
    .join("")
    .split("\n")
    .map((line) => (line.startsWith("```") ? line : line.replace(/[ \t]+/g, " ").trimEnd()))
    .map((line) => line.replace(/^(#{1,4}|-) +/, "$1 ").replace(/^ +(?=\S)/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
