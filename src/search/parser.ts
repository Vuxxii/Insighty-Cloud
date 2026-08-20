/** ID-query parser for the Command Bar (PRD §3.B). */

export interface IdRange {
  lo: number;
  hi: number;
}

export type IdQuery =
  | { kind: 'ranges'; ranges: IdRange[] }
  /** Syntactically an ID query but not yet complete (`1-`, `-5`): run nothing. */
  | { kind: 'incomplete' }
  /** Valid syntax that can never match anything (`0`, negatives): empty result, no crash. */
  | { kind: 'empty' };

const ID_QUERY_RE = /^[\d,\-\s]+$/;
const PREFIXED_RE = /^([A-Za-z0-9]{1,6})-([\d,\-\s]+)$/;

export function isIdQuerySyntax(raw: string): boolean {
  return ID_QUERY_RE.test(raw.trim());
}

export function parseIdQuery(raw: string): IdQuery {
  const trimmed = raw.trim();
  if (!ID_QUERY_RE.test(trimmed)) return { kind: 'incomplete' };
  const segments = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0); // `1,,3` and trailing commas: ignore empty segments
  if (segments.length === 0) return { kind: 'incomplete' };

  const ranges: IdRange[] = [];
  for (const seg of segments) {
    if (/^\d+$/.test(seg)) {
      const n = parseInt(seg, 10);
      if (n >= 1) ranges.push({ lo: n, hi: n }); // 0: valid syntax, matches nothing
      continue;
    }
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(seg);
    if (rangeMatch) {
      let lo = parseInt(rangeMatch[1], 10);
      let hi = parseInt(rangeMatch[2], 10);
      if (lo > hi) [lo, hi] = [hi, lo]; // `7-1` → normalise to `1-7`, no error
      if (hi < 1) continue;
      ranges.push({ lo: Math.max(1, lo), hi });
      continue;
    }
    // `1-`, `-5`, `1-2-3` … incomplete input: do not run a query until valid.
    return { kind: 'incomplete' };
  }
  return ranges.length === 0 ? { kind: 'empty' } : { kind: 'ranges', ranges };
}

export type CommandRoute =
  | { type: 'blank' }
  | { type: 'prefixed'; prefix: string; idQuery: IdQuery }
  | { type: 'ids'; idQuery: IdQuery }
  | { type: 'text'; text: string };

/**
 * Routing (PRD §3.B): prefixed-ID pattern (against a known project prefix) → that
 * project; bare ID syntax → active project; otherwise text search.
 * `knownPrefixes` is checked case-insensitively.
 */
export function routeQuery(raw: string, knownPrefixes: string[]): CommandRoute {
  const trimmed = raw.trim();
  if (trimmed === '') return { type: 'blank' };
  const prefixed = PREFIXED_RE.exec(trimmed);
  if (prefixed) {
    const prefix = prefixed[1];
    // Spec order (PRD §3.B): a prefixed match against a KNOWN project wins; otherwise
    // the same characters fall through to plain ID-query parsing (e.g. `1-7` as a range).
    const known = knownPrefixes.some((p) => p.toUpperCase() === prefix.toUpperCase());
    if (known) {
      return { type: 'prefixed', prefix, idQuery: parseIdQuery(prefixed[2]) };
    }
  }
  if (ID_QUERY_RE.test(trimmed)) return { type: 'ids', idQuery: parseIdQuery(trimmed) };
  return { type: 'text', text: trimmed };
}

export interface ClampNote {
  from: number;
  to: number;
}

export interface NormalisedQuery {
  /** Ranges clamped to [1, currentSeq], deduplicated and merged, ascending. */
  ranges: IdRange[];
  /** Portion above currentSeq that was clamped away — "IDs 21–100 not found". */
  clamped: ClampNote | null;
}

/**
 * Clamp the upper bound to the project's current_seq BEFORE resolving (PRD §3.B
 * huge-range row) — a stray keystroke must not lock the tab. Overlapping ranges are
 * merged so each maps to exactly one IDBKeyRange query.
 */
export function normaliseRanges(query: IdQuery, currentSeq: number): NormalisedQuery {
  if (query.kind !== 'ranges') return { ranges: [], clamped: null };
  let maxRequested = 0;
  const clampedRanges: IdRange[] = [];
  for (const r of query.ranges) {
    maxRequested = Math.max(maxRequested, r.hi);
    const lo = Math.max(1, r.lo);
    const hi = Math.min(r.hi, currentSeq);
    if (lo <= hi) clampedRanges.push({ lo, hi });
  }
  clampedRanges.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const merged: IdRange[] = [];
  for (const r of clampedRanges) {
    const last = merged[merged.length - 1];
    if (last && r.lo <= last.hi + 1) last.hi = Math.max(last.hi, r.hi);
    else merged.push({ ...r });
  }
  const clamped: ClampNote | null =
    maxRequested > currentSeq ? { from: currentSeq + 1, to: maxRequested } : null;
  return { ranges: merged, clamped };
}

/** Compress sorted numbers into human-readable ranges: [2,3,4,9] → "2–4, 9". */
export function describeRefList(refs: number[]): string {
  if (refs.length === 0) return '';
  const parts: string[] = [];
  let start = refs[0];
  let prev = refs[0];
  for (let i = 1; i <= refs.length; i++) {
    const n = refs[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    if (n !== undefined) {
      start = n;
      prev = n;
    }
  }
  return parts.join(', ');
}
