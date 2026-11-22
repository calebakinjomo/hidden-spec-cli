// match.ts — the three matching tiers of SPEC.md section 5, and the way a replacement is
// written over the lines it matched.
//
// O, the old lines an edit names, is found in the file's current lines at the first tier at
// which it occurs at least once: tier 0, every line equal; tier 1, every line equal once
// trailing spaces and tabs are removed from both; tier 2, every line equal once leading and
// trailing spaces and tabs are removed from both. With --strict only tier 0 is tried.

import { leadingWs, trimEndWs, trimWs } from './tree.ts';

/** One line of N, the new lines: its text, whether it is a context line, and, for a context
 *  line, its index in O (so it can be written as the file's own matched line). */
export interface NLine {
  text: string;
  ctx: boolean;
  oIndex: number;
}

/** Whether two lines are equal at one tier. */
export function lineEq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) return trimEndWs(a) === trimEndWs(b);
  return trimWs(a) === trimWs(b);
}

/** The positions, from `from` on, where O occurs in the file's lines at one tier.
 *  Occurrences may overlap. */
export function occurrencesAt(lines: string[], o: string[], tier: number, from: number): number[] {
  const out: number[] = [];
  if (o.length === 0) return out;
  for (let i = from; i + o.length <= lines.length; i++) {
    let ok = true;
    for (let k = 0; k < o.length; k++) {
      if (!lineEq(lines[i + k] as string, o[k] as string, tier)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** The first tier at which O occurs in the file's lines from `from` on, with every
 *  occurrence at that tier; null when it occurs at no tier. */
export function findTier(lines: string[], o: string[], from: number, strict: boolean): { tier: number; positions: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const positions = occurrencesAt(lines, o, tier, from);
    if (positions.length > 0) return { tier, positions };
  }
  return null;
}

/** Write N over the k matched lines at `pos`. A context line is written as the file's own
 *  matched line, never the patch's. At tier 2 every other line of N is re-indented: let F
 *  be the leading spaces and tabs of the file's first matched line and P those of O's first
 *  line; a line of N that is not empty and not only whitespace, and starts with P, has that
 *  P replaced by F; any other line is written as it is. At tiers 0 and 1 the lines of N
 *  are written as they are. */
export function replaceAt(lines: string[], pos: number, o: string[], n: NLine[], tier: number): string[] {
  const out = lines.slice(0, pos);
  if (tier === 2 && o.length > 0) {
    const f = leadingWs(lines[pos] as string);
    const p = leadingWs(o[0] as string);
    for (const nl of n) {
      if (nl.ctx) {
        out.push(lines[pos + nl.oIndex] as string);
        continue;
      }
      const t = nl.text;
      if (t === '' || t.trim() === '') {
        out.push(t);
        continue;
      }
      out.push(t.startsWith(p) ? f + t.slice(p.length) : t);
    }
  } else {
    for (const nl of n) out.push(nl.ctx ? (lines[pos + nl.oIndex] as string) : nl.text);
  }
  for (let i = pos + o.length; i < lines.length; i++) out.push(lines[i] as string);
  return out;
}
