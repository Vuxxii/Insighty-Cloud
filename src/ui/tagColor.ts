/** Candy palette for source tags (Aardvark-style): each tag gets a stable color
 * from its name, so a feed becomes scannable like a shelf of book spines. */
const CANDY = ['#2FA896', '#F25CA2', '#5B7FFF', '#F79A3E', '#86B944'];

export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return CANDY[hash % CANDY.length];
}
