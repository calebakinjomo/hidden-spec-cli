// searchreplace.ts — SEARCH/REPLACE blocks, SPEC.md section 7.
//
// A block is a path line, a <<<<<<< SEARCH line, old lines, a ======= line, new lines and
// a >>>>>>> REPLACE line. The path is the nearest line before the SEARCH line, after the
// previous block's REPLACE line, that is not blank and does not start with three backticks;
// a block with no such line takes the previous block's path. Lines outside blocks are
// otherwise ignored.

import { blank, Exit2, Fail, joinFile, safe, splitFile } from './tree.ts';
import type { Edit, Tree } from './tree.ts';
import { findTier, replaceAt } from './match.ts';

const SEARCH = '<<<<<<< SEARCH';
const SEP = '=======';
const REPLACE = '>>>>>>> REPLACE';

/** One block as one edit. Empty old lines create the file; otherwise the old lines must
 *  occur at their tier exactly once. */
function blockEdit(path: string, oldLines: string[], newLines: string[], strict: boolean): Edit {
  if (oldLines.length === 0) {
    return (tree: Tree) => {
      if (!safe(path)) throw new Fail('unsafe', path);
      if (tree.get(path) !== null) throw new Fail('exists', path);
      tree.now.set(path, newLines.length === 0 ? '' : newLines.join('\n') + '\n');
    };
  }
  return (tree: Tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    const before = tree.get(path);
    if (before === null) throw new Fail('missing', path);
    const f = splitFile(before);
    const found = findTier(f.lines, oldLines, 0, strict);
    if (found === null) throw new Fail('no-match', path);
    if (found.positions.length > 1) throw new Fail('ambiguous', path);
    const pos = found.positions[0] as number;
    const n = newLines.map((t) => ({ text: t, ctx: false, oIndex: -1 }));
    tree.now.set(path, joinFile({ lines: replaceAt(f.lines, pos, oldLines, n, found.tier), br: f.br, final: f.final }));
  };
}

/** Read a patch as SEARCH/REPLACE blocks: every block as one edit, in the patch's order. */
export function parseSearchReplace(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevReplace = -1;
  let prevPath: string | null = null;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i] as string;
    if (l.trimEnd() !== SEARCH) {
      i++;
      continue;
    }
    const searchLine = i;
    let path: string | null = null;
    for (let j = i - 1; j > prevReplace; j--) {
      const cand = lines[j] as string;
      if (blank(cand)) continue;
      if (cand.trim().startsWith('```')) continue;
      path = cand.trim();
      break;
    }
    if (path === null) {
      if (prevPath !== null) path = prevPath;
      else throw new Exit2(`error: parse ${searchLine + 1}`);
    }
    let sep = -1;
    for (let k = i + 1; k < lines.length; k++) {
      const kl = lines[k] as string;
      if (kl.trimEnd() === SEP) {
        sep = k;
        break;
      }
      if (kl.trimEnd() === REPLACE) throw new Exit2(`error: parse ${searchLine + 1}`);
    }
    if (sep < 0) throw new Exit2(`error: parse ${searchLine + 1}`);
    let rep = -1;
    for (let m = sep + 1; m < lines.length; m++) {
      if ((lines[m] as string).trimEnd() === REPLACE) {
        rep = m;
        break;
      }
    }
    if (rep < 0) throw new Exit2(`error: parse ${searchLine + 1}`);
    edits.push(blockEdit(path, lines.slice(i + 1, sep), lines.slice(sep + 1, rep), strict));
    prevReplace = rep;
    prevPath = path;
    i = rep + 1;
  }
  return edits;
}
