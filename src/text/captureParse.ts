/** Inline commands for the Capture Zone, so a capture never needs the mouse:
 *  - a line starting with `//` is a link: `// <url> <optional title>` (title is
 *    user-typed and never fetched, PRD §3.E)
 *  - `@word` anywhere sets the source tag and pins it for subsequent captures;
 *    it is unpinned by the manual unlock toggle or by clearing the source field.
 *  Only line-anchored `//` triggers links; URLs inside prose stay plain text.
 *  `@` must follow a line start or whitespace, so emails (a@b.com) are untouched. */

export interface ParsedLink {
  href: string;
  title?: string;
}

export interface ParsedCapture {
  /** Non-command lines with @tokens stripped, original order preserved. */
  text: string;
  /** One entry per `//` line, in the order the lines appeared. */
  links: ParsedLink[];
  /** Source tag from the last `@word` token, if any. */
  source?: string;
}

const LINK_LINE_RE = /^\s*\/\/\s*(\S+)(?:\s+(.+))?$/;
const SOURCE_TOKEN_RE = /(^|\s)@([^\s@]+)/g;
/** Trailing sentence punctuation (Latin + Arabic) is not part of a source name. */
const TRAILING_PUNCT_RE = /[.,;:!?،؛]+$/;

/** `example.com` → `https://example.com`; anything with a scheme is left alone.
 * Render-time safety is unchanged: only http(s) ever linkifies (§3.E). */
function withScheme(raw: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
}

export function parseCaptureText(raw: string): ParsedCapture {
  const textLines: string[] = [];
  const links: ParsedLink[] = [];
  let source: string | undefined;

  for (const line of raw.split('\n')) {
    const linkMatch = LINK_LINE_RE.exec(line);
    if (linkMatch) {
      const title = linkMatch[2]?.trim();
      links.push({ href: withScheme(linkMatch[1]), ...(title ? { title } : {}) });
      continue;
    }
    // Drop the whole match (including the leading space) so "a @X b" → "a b";
    // lines that contained a token get trimmed to absorb any edge whitespace.
    const stripped = line.replace(SOURCE_TOKEN_RE, (_m, _lead: string, token: string) => {
      const cleaned = token.replace(TRAILING_PUNCT_RE, '');
      if (cleaned) source = cleaned; // last token wins
      return '';
    });
    textLines.push(stripped === line ? line : stripped.trim());
  }

  return {
    text: textLines.join('\n').trim(),
    links,
    ...(source !== undefined ? { source } : {}),
  };
}
