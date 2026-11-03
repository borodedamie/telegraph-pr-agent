// Source text normalization (data-model.md, ReleaseSource): applied once, before hashing, snapshotting and excerpt checks.

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}
