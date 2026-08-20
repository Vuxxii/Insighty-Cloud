import type { Direction } from '../db/types';

// First-strong-character detection (PRD §3.A.1). RTL: Hebrew, Arabic, Syriac,
// Thaana, Arabic Extended + presentation forms. LTR: Latin, Greek, Cyrillic.
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿḀ-῿]/;

/** Resolve the direction to STORE on the insight so rendering is deterministic
 * on retrieval and in PDF export (PRD §3.A.1). */
export function resolveDirection(text: string, override: Direction | 'auto' = 'auto'): Direction {
  if (override === 'ltr' || override === 'rtl') return override;
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (LTR_CHAR.test(ch)) return 'ltr';
  }
  return 'auto';
}

/** Direction attribute for rendering a block container. Mixed content within one
 * insight renders correctly via dir="auto" on the content container (PRD §3.A.1). */
export function dirAttr(direction: Direction): 'ltr' | 'rtl' | 'auto' {
  return direction;
}
