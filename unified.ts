// unified.ts — unified diffs, SPEC.md section 6.
//
// A section starts at a `diff --git a/<X> b/<Y>` line, or at a `--- ` line followed by a
// `+++ ` line. Its header names the old and new path, whether it creates, deletes or moves
// the file; its hunks apply in order, each to the result of the ones before it. The line
// numbers in a hunk cannot be trusted: a hunk takes the occurrence of its old lines nearest
// to where the numbers say, at the first tier where they occur at all.

import { Exit2, Fail, joinFile, safe, splitFile } from './tree.ts';
import type { Edit, FileParts, Tree } from './tree.ts';
import { findTier, replaceAt } from './match.ts';
import type { NLine } from './match.ts';

/** One body line of a hunk: its kind, its text after the marker, and its raw patch line
 *  (kept so trailing empty lines can be told from trailing context lines). */
interface BodyLine {
  kind: ' ' | '-' | '+' | '\\';
  text: string;
  raw: string;
}

/** One hunk: its old start line A, and its body lines. */
interface Hunk {
  a: number;
  body: BodyLine[];
}

/** One section: every way its header can name a path, whether it creates or deletes, and
 *  its hunks. Paths resolve in order: the ---/+++ pair, then rename from/to, then the
 *  diff --git paths. */
interface Section {
  diffOld: string | null;
  diffNew: string | null;
  headOld: string | null;
  headNew: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  create: boolean;
  del: boolean;
  hunks: Hunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: |$)/;
const DIFF_GIT_RE = /^diff --git a\/(.+) b\/(.+)$/;

/** The path a --- or +++ line names: the text after the four characters, up to the first
 *  tab, with surrounding spaces removed. */
function headerPath(line: string): string {
  const rest = line.slice(4);
  const tab = rest.indexOf('\t');
  return (tab >= 0 ? rest.slice(0, tab) : rest).trim();
}

/** A leading a/ or b/ is removed from a path; /dev/null means no file and stays as it is. */
function stripPrefix(p: string): string {
  if (p === '/dev/null') return p;
  if (p.startsWith('a/') || p.startsWith('b/')) return p.slice(2);
  return p;
}

/** Whether a `\` line follows the hunk's last context or + line: then the result, when the
 *  hunk's matched lines run to the end of the file, ends without a line break. */
function noNewlineAfterLast(h: Hunk): boolean {
  for (let i = h.body.length - 1; i >= 0; i--) {
    const bl = h.body[i] as BodyLine;
    if (bl.kind === ' ' || bl.kind === '+') {
      return (h.body[i + 1] as BodyLine | undefined)?.kind === '\\';
    }
  }
  return false;
}

/** Apply a section's hunks in order to a file's text, each to the result of the ones before
 *  it. Throws Fail('no-match', path) when a hunk's old lines occur at no tier. */
function applyHunks(text: string, hunks: Hunk[], strict: boolean, path: string): string {
  const f: FileParts = splitFile(text);
  let d = 0;
  for (const h of hunks) {
    const o: string[] = [];
    const n: NLine[] = [];
    for (const bl of h.body) {
      if (bl.kind === ' ') {
        o.push(bl.text);
        n.push({ text: bl.text, ctx: true, oIndex: o.length - 1 });
      } else if (bl.kind === '-') {
        o.push(bl.text);
      } else if (bl.kind === '+') {
        n.push({ text: bl.text, ctx: false, oIndex: -1 });
      }
    }
    const noNl = noNewlineAfterLast(h);
    if (o.length === 0) {
      const at = Math.min(Math.max(h.a + d, 0), f.lines.length);
      const atEnd = at === f.lines.length;
      f.lines.splice(at, 0, ...n.map((nl) => nl.text));
      if (atEnd) f.final = !noNl;
      d += n.length;
      continue;
    }
    const found = findTier(f.lines, o, 0, strict);
    if (found === null) throw new Fail('no-match', path);
    const target = h.a - 1 + d;
    let best = found.positions[0] as number;
    let bestDist = Math.abs(best - target);
    for (const p of found.positions) {
      const dist = Math.abs(p - target);
      if (dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    const atEnd = best + o.length === f.lines.length;
    f.lines = replaceAt(f.lines, best, o, n, found.tier);
    if (atEnd) f.final = !noNl;
    d += n.length - o.length;
  }
  return joinFile(f);
}

/** One section as one edit. */
function sectionEdit(s: Section, strict: boolean): Edit {
  const oldPath = s.headOld ?? s.renameFrom ?? s.diffOld ?? '';
  const newPath = s.headNew ?? s.renameTo ?? s.diffNew ?? '';
  const isCreate = s.create || oldPath === '/dev/null';
  const isDelete = !isCreate && (s.del || newPath === '/dev/null');
  const isMove = !isCreate && !isDelete && oldPath !== newPath;

  if (isCreate) {
    return (tree: Tree) => {
      if (!safe(newPath)) throw new Fail('unsafe', newPath);
      if (tree.get(newPath) !== null) throw new Fail('exists', newPath);
      const plus: string[] = [];
      let lastH = -1;
      let lastB = -1;
      s.hunks.forEach((h, hi) => {
        h.body.forEach((bl, bi) => {
          if (bl.kind === '+') {
            plus.push(bl.text);
            lastH = hi;
            lastB = bi;
          }
        });
      });
      let noNl = false;
      if (lastH >= 0) {
        const hb = (s.hunks[lastH] as Hunk).body;
        noNl = (hb[lastB + 1] as BodyLine | undefined)?.kind === '\\';
      }
      tree.now.set(newPath, plus.length === 0 ? '' : plus.join('\n') + (noNl ? '' : '\n'));
    };
  }
  if (isDelete) {
    return (tree: Tree) => {
      if (!safe(oldPath)) throw new Fail('unsafe', oldPath);
      if (tree.get(oldPath) === null) throw new Fail('missing', oldPath);
      tree.now.set(oldPath, null);
    };
  }
  if (isMove) {
    return (tree: Tree) => {
      if (!safe(oldPath)) throw new Fail('unsafe', oldPath);
      if (!safe(newPath)) throw new Fail('unsafe', newPath);
      const before = tree.get(oldPath);
      if (before === null) throw new Fail('missing', oldPath);
      if (tree.get(newPath) !== null) throw new Fail('exists', newPath);
      const out = applyHunks(before, s.hunks, strict, oldPath);
      tree.now.set(oldPath, null);
      tree.now.set(newPath, out);
      tree.moves.push([oldPath, newPath]);
    };
  }
  return (tree: Tree) => {
    if (!safe(oldPath)) throw new Fail('unsafe', oldPath);
    const before = tree.get(oldPath);
    if (before === null) throw new Fail('missing', oldPath);
    tree.now.set(oldPath, applyHunks(before, s.hunks, strict, oldPath));
  };
}

/** Read a patch as unified diffs: every section as one edit, in the patch's order. */
export function parseUnified(lines: string[], strict: boolean): Edit[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let inHunks = false;

  const startSection = (diffOld: string | null, diffNew: string | null, headOld: string | null, headNew: string | null): void => {
    cur = { diffOld, diffNew, headOld, headNew, renameFrom: null, renameTo: null, create: false, del: false, hunks: [] };
    sections.push(cur);
    inHunks = false;
  };

  const diffGit = (line: string, i: number): RegExpExecArray => {
    const m = DIFF_GIT_RE.exec(line);
    if (m === null) throw new Exit2(`error: parse ${i + 1}`);
    return m;
  };

  const hunkAt = (i: number): { hunk: Hunk; next: number } => {
    const m = HUNK_RE.exec(lines[i] as string);
    if (m === null) throw new Exit2(`error: parse ${i + 1}`);
    const body: BodyLine[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j] as string;
      if (l.startsWith('diff --git ')) break;
      if (l.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
      if (l.startsWith(' ')) {
        body.push({ kind: ' ', text: l.slice(1), raw: l });
        j++;
        continue;
      }
      if (l.startsWith('-')) {
        body.push({ kind: '-', text: l.slice(1), raw: l });
        j++;
        continue;
      }
      if (l.startsWith('+')) {
        body.push({ kind: '+', text: l.slice(1), raw: l });
        j++;
        continue;
      }
      if (l.startsWith('\\')) {
        body.push({ kind: '\\', text: l, raw: l });
        j++;
        continue;
      }
      if (l === '') {
        body.push({ kind: ' ', text: '', raw: l });
        j++;
        continue;
      }
      break;
    }
    while (body.length > 0 && (body[body.length - 1] as BodyLine).raw === '') body.pop();
    return { hunk: { a: Number(m[1]), body }, next: j };
  };

  let i = 0;
  while (i < lines.length) {
    const l = lines[i] as string;
    if (cur === null) {
      if (l.startsWith('diff --git ')) {
        const m = diffGit(l, i);
        startSection(stripPrefix(m[1] as string), stripPrefix(m[2] as string), null, null);
        i++;
        continue;
      }
      if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
        startSection(null, null, stripPrefix(headerPath(l)), stripPrefix(headerPath(lines[i + 1] as string)));
        i += 2;
        continue;
      }
      if (l.startsWith('@@')) throw new Exit2(`error: parse ${i + 1}`);
      i++;
      continue;
    }
    if (!inHunks) {
      if (l.startsWith('diff --git ')) {
        const m = diffGit(l, i);
        startSection(stripPrefix(m[1] as string), stripPrefix(m[2] as string), null, null);
        i++;
        continue;
      }
      if (l.startsWith('--- ')) {
        if (!(lines[i + 1] ?? '').startsWith('+++ ')) throw new Exit2(`error: parse ${i + 2}`);
        cur.headOld = stripPrefix(headerPath(l));
        cur.headNew = stripPrefix(headerPath(lines[i + 1] as string));
        i += 2;
        continue;
      }
      if (l.startsWith('+++ ')) {
        cur.headNew = stripPrefix(headerPath(l));
        i++;
        continue;
      }
      if (l.startsWith('rename from ')) {
        cur.renameFrom = l.slice(12).trim();
        i++;
        continue;
      }
      if (l.startsWith('rename to ')) {
        cur.renameTo = l.slice(10).trim();
        i++;
        continue;
      }
      if (l === 'new file mode' || l.startsWith('new file mode ')) {
        cur.create = true;
        i++;
        continue;
      }
      if (l === 'deleted file mode' || l.startsWith('deleted file mode ')) {
        cur.del = true;
        i++;
        continue;
      }
      if (l.startsWith('@@')) {
        const { hunk, next } = hunkAt(i);
        cur.hunks.push(hunk);
        inHunks = true;
        i = next;
        continue;
      }
      i++;
      continue;
    }
    if (l.startsWith('diff --git ')) {
      const m = diffGit(l, i);
      startSection(stripPrefix(m[1] as string), stripPrefix(m[2] as string), null, null);
      i++;
      continue;
    }
    if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      startSection(null, null, stripPrefix(headerPath(l)), stripPrefix(headerPath(lines[i + 1] as string)));
      i += 2;
      continue;
    }
    if (l.startsWith('@@')) {
      const { hunk, next } = hunkAt(i);
      cur.hunks.push(hunk);
      i = next;
      continue;
    }
    i++;
  }
  return sections.map((s) => sectionEdit(s, strict));
}
