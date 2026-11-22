// tree.ts — the tree of files an edit works on, safe paths, and file/patch line handling.
//
// mend applies every edit to an in-memory view of the tree and only writes the tree out
// once every edit has succeeded, so a failed edit never leaves a half-written tree behind.
// A path in `now` holds its text after the edits, or null when an edit deleted it.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** An exit-2 outcome: the single error line to print. */
export class Exit2 {
  line: string;
  constructor(line: string) {
    this.line = line;
  }
}

/** One failed edit: its code and the path the failure concerns. */
export class Fail {
  code: string;
  path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

/** A line is blank when it is empty or only whitespace. */
export function blank(s: string): boolean {
  return s.trim() === '';
}

/** A patch's lines: split at \n, one trailing \r removed, no empty piece after a final \n. */
export function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** A path is safe when it is not empty, does not start with /, holds no \, and none of its
 *  /-separated segments is empty, . or .. . */
export function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The leading spaces and tabs of a line. */
export function leadingWs(s: string): string {
  const m = /^[ \t]*/.exec(s);
  return m === null ? '' : m[0];
}

/** A line with its trailing spaces and tabs removed. */
export function trimEndWs(s: string): string {
  return s.replace(/[ \t]+$/, '');
}

/** A line with its leading and trailing spaces and tabs removed. */
export function trimWs(s: string): string {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

/** A file's text broken into its lines, its line break, and whether it ends with one. */
export interface FileParts {
  lines: string[];
  br: '\r\n' | '\n';
  final: boolean;
}

/** Split a file's text at its own line break: CRLF when its first line feed follows a
 *  carriage return, LF otherwise. An empty file has no lines and no final break. */
export function splitFile(text: string): FileParts {
  if (text === '') return { lines: [], br: '\n', final: false };
  const nl = text.indexOf('\n');
  const br: '\r\n' | '\n' = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const final = text.endsWith(br);
  const parts = text.split(br);
  if (final) parts.pop();
  return { lines: parts, br, final };
}

/** Join a file's lines back with its own break, and a final one exactly when it had one. */
export function joinFile(f: FileParts): string {
  if (f.lines.length === 0) return '';
  return f.lines.join(f.br) + (f.final ? f.br : '');
}

/** Compare two paths in byte order of their UTF-8 bytes. */
export function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** The tree as the edits leave it. `now` holds every path an edit touched (null: deleted);
 *  anything else is read from disk on demand and cached in `orig`. `moves` records every
 *  move edit that succeeded, as (old path, new path) pairs, for the output lines. */
export class Tree {
  orig = new Map<string, string | null>();
  now = new Map<string, string | null>();
  moves: Array<[string, string]> = [];

  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p) as string | null;
  }

  get(p: string): string | null {
    return this.now.has(p) ? (this.now.get(p) as string | null) : this.original(p);
  }
}

/** One edit: a function that reads and writes the tree, throwing Fail when it cannot apply. */
export type Edit = (tree: Tree) => void;

/** One changed path, as the output reports it. `key` is the sort key: the path, or the new
 *  path for a move. `oldPath` is the old path of a move, else null. */
export interface Change {
  key: string;
  line: string;
  kind: 'A' | 'D' | 'M' | 'R';
  path: string;
  oldPath: string | null;
}

/** The output rows for the tree's changes, in byte order of their sort keys. A move whose
 *  old path existed before the patch and is gone after it, and whose new path did not exist
 *  before it and does after it, is one R line in place of that pair's D and A lines. */
export function changeRows(tree: Tree): Change[] {
  const covered = new Set<string>();
  const rows: Change[] = [];
  for (const [oldP, newP] of tree.moves) {
    const wasOld = tree.original(oldP);
    const nowOld = tree.now.get(oldP);
    const wasNew = tree.original(newP);
    const nowNew = tree.now.get(newP);
    if (wasOld !== null && nowOld === null && wasNew === null && nowNew !== null && !covered.has(oldP) && !covered.has(newP)) {
      rows.push({ key: newP, line: `R ${oldP} -> ${newP}`, kind: 'R', path: newP, oldPath: oldP });
      covered.add(oldP);
      covered.add(newP);
    }
  }
  const paths = [...tree.now.keys()].sort(byteCompare);
  for (const p of paths) {
    if (covered.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p) as string | null;
    if (was === now) continue;
    const kind = was === null ? 'A' : now === null ? 'D' : 'M';
    rows.push({ key: p, line: `${kind} ${p}`, kind, path: p, oldPath: null });
  }
  rows.sort((a, b) => byteCompare(a.key, b.key));
  return rows;
}

/** Write the tree's changes to disk, creating directories as files need them. */
export function writeChanges(tree: Tree, changes: Change[]): void {
  for (const c of changes) {
    if (c.kind === 'R' && c.oldPath !== null) rmSync(c.oldPath, { force: true });
    if (c.kind === 'D') {
      rmSync(c.path, { force: true });
      continue;
    }
    const text = tree.now.get(c.path) as string;
    mkdirSync(dirname(c.path), { recursive: true });
    writeFileSync(c.path, text);
  }
}
