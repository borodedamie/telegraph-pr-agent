// What an extractor proposes, before verification turns it into a ChangeItem (research R7).
import type { ChangeItem } from "../types.js";

export interface Candidate {
  /** Extractor-local reference, used by inferredFrom and migrationInferredFrom before ids are assigned. */
  ref: string;
  /** Index into the sections the extractor was given. */
  section: number;
  kind: ChangeItem["kind"];
  /** Only "inferred" is taken from the extractor; documented versus repository evidence follows the source. */
  inferred: boolean;
  change: string;
  excerpt: string | null;
  inferredFrom: string[];
  migration: string | null;
  migrationExcerpt: string | null;
  /** Candidate refs, or section references written as `section:<index>`. */
  migrationInferredFrom: string[];
}
