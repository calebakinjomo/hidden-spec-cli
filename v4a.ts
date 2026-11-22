// v4a.ts — V4A patches, SPEC.md section 8.
//
// Between *** Begin Patch and *** End Patch, sections add, delete or update files. An
// Update File section may move the file, then applies its chunks in order with a cursor
// that starts at line 0: a chunk's anchor, when it has one, is found first and the cursor
// moves past it; the chunk then takes the first occurrence of its old lines at or after
// the cursor, at the first tier with one; an end-of-file chunk takes only an occurrence
// that ends at the file's last line. Blank lines at the end of a section are not part of it.

import { blank, Exit2, Fail, joinFile, safe, splitFile } from './tree.ts';
import type { Edit, Tree } from './tree.ts';
import { findTier, replaceAt } from './match.ts';
import type { NLine } from './match.ts';

/** One body line of a chunk: its kind, its text after the marker, and its raw patch line. */
interface BodyLine {
  kind: ' ' | '-' | '+';
  text: string;
  raw: string;
}

/** One chunk: its anchor (null: none), whether *** End of File anchored it to the end of
 *  the file, and its body lines. */
interface Chunk {
  anchor: string | null;
  eof: boolean;
  body: BodyLine[];
}

type Section =
  | { kind: 'add'; path: string; lines: string[] }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo: string | null; chunks: Chunk[] };

const ADD = '*** Add File: ';
const DELETE = '*** Delete File: ';
const UPDATE = '*** Update File: ';
const MOVE_TO = '*** Move to: ';

/** The first line at or after `from` equal to the anchor at the first tier where one is;
 *  null when no line is equal at any tier. */
function findAnchor(lines: string[], anchor: string, from: number, strict: boolean): number | null {
  const found = findTier(lines, [anchor], from, strict);
  return found === null ? null : (found.positions[0] as number);
}

/** Apply an Update File section's chunks in order to a file's text, with the cursor. */
function applyChunks(text: string, chunks: Chunk[], strict: boolean, path: string): string {
  const f = splitFile(text);
  let cursor = 0;
  for (const c of chunks) {
    if (c.anchor !== null) {
      const at = findAnchor(f.lines, c.anchor, cursor, strict);
      if (at === null) throw new Fail('no-match', path);
      cursor = at + 1;
    }
    const o: string[] = [];
    const n: NLine[] = [];
    for (const bl of c.body) {
      if (bl.kind === ' ') {
        o.push(bl.text);
        n.push({ text: bl.text, ctx: true, oIndex: o.length - 1 });
      } else if (bl.kind === '-') {
        o.push(bl.text);
      } else if (bl.kind === '+') {
        n.push({ text: bl.text, ctx: false, oIndex: -1 });
      }
    }
    if (o.length === 0) {
      const at = c.eof ? f.lines.length : cursor;
      f.lines.splice(at, 0, ...n.map((nl) => nl.text));
      cursor = at + n.length;
      continue;
    }
    const found = findTier(f.lines, o, cursor, strict);
    if (found === null) throw new Fail('no-match', path);
    let pos: number | null = null;
    for (const p of found.positions) {
      if (c.eof && p + o.length !== f.lines.length) continue;
      pos = p;
      break;
    }
    if (pos === null) throw new Fail('no-match', path);
    f.lines = replaceAt(f.lines, pos, o, n, found.tier);
    cursor = pos + n.length;
  }
  return joinFile(f);
}

/** One section as one edit. */
function sectionEdit(s: Section, strict: boolean): Edit {
  if (s.kind === 'add') {
    return (tree: Tree) => {
      if (!safe(s.path)) throw new Fail('unsafe', s.path);
      if (tree.get(s.path) !== null) throw new Fail('exists', s.path);
      tree.now.set(s.path, s.lines.length === 0 ? '' : s.lines.join('\n') + '\n');
    };
  }
  if (s.kind === 'delete') {
    return (tree: Tree) => {
      if (!safe(s.path)) throw new Fail('unsafe', s.path);
      if (tree.get(s.path) === null) throw new Fail('missing', s.path);
      tree.now.set(s.path, null);
    };
  }
  return (tree: Tree) => {
    if (!safe(s.path)) throw new Fail('unsafe', s.path);
    const before = tree.get(s.path);
    if (before === null) throw new Fail('missing', s.path);
    if (s.moveTo !== null) {
      if (!safe(s.moveTo)) throw new Fail('unsafe', s.moveTo);
      if (tree.get(s.moveTo) !== null) throw new Fail('exists', s.moveTo);
    }
    const out = applyChunks(before, s.chunks, strict, s.path);
    if (s.moveTo !== null) {
      tree.now.set(s.path, null);
      tree.now.set(s.moveTo, out);
      tree.moves.push([s.path, s.moveTo]);
    } else {
      tree.now.set(s.path, out);
    }
  };
}

/** Read a patch as a V4A patch: every section as one edit, in the patch's order. */
export function parseV4a(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if ((lines[first] as string).trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!blank(lines[i] as string)) {
      last = i;
      break;
    }
  }
  if ((lines[last] as string).trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const sections: Section[] = [];
  let i = first + 1;
  while (i < last) {
    const l = lines[i] as string;
    if (blank(l)) {
      i++;
      continue;
    }
    if (l.startsWith(ADD)) {
      const path = l.slice(ADD.length).trim();
      i++;
      const fl: Array<{ text: string; isBlank: boolean }> = [];
      while (i < last) {
        const m = lines[i] as string;
        if (m.startsWith('*** ')) break;
        if (m.startsWith('+')) {
          fl.push({ text: m.slice(1), isBlank: false });
          i++;
          continue;
        }
        if (m === '') {
          fl.push({ text: '', isBlank: true });
          i++;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
      while (fl.length > 0 && (fl[fl.length - 1] as { isBlank: boolean }).isBlank) fl.pop();
      sections.push({ kind: 'add', path, lines: fl.map((x) => x.text) });
      continue;
    }
    if (l.startsWith(DELETE)) {
      const path = l.slice(DELETE.length).trim();
      i++;
      while (i < last) {
        const m = lines[i] as string;
        if (m.startsWith('*** ')) break;
        if (blank(m)) {
          i++;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
      sections.push({ kind: 'delete', path });
      continue;
    }
    if (l.startsWith(UPDATE)) {
      const updateLine = i;
      const path = l.slice(UPDATE.length).trim();
      i++;
      let moveTo: string | null = null;
      if (i < last && (lines[i] as string).startsWith(MOVE_TO)) {
        moveTo = (lines[i] as string).slice(MOVE_TO.length).trim();
        i++;
      }
      const chunks: Chunk[] = [];
      let cur: Chunk | null = null;
      const close = (): void => {
        if (cur !== null) {
          chunks.push(cur);
          cur = null;
        }
      };
      while (i < last) {
        const m = lines[i] as string;
        if (m.startsWith(ADD) || m.startsWith(DELETE) || m.startsWith(UPDATE)) break;
        if (m === '*** End of File') {
          if (cur === null) cur = { anchor: null, eof: false, body: [] };
          cur.eof = true;
          close();
          i++;
          continue;
        }
        if (m.startsWith('@@')) {
          close();
          const anchor = m.slice(2).trim();
          cur = { anchor: anchor === '' ? null : anchor, eof: false, body: [] };
          i++;
          continue;
        }
        if (m.startsWith(' ') || m.startsWith('-') || m.startsWith('+') || m === '') {
          if (cur === null) {
            if (chunks.length > 0) throw new Exit2(`error: parse ${i + 1}`);
            cur = { anchor: null, eof: false, body: [] };
          }
          const kind = m === '' ? ' ' : (m[0] as ' ' | '-' | '+');
          cur.body.push({ kind, text: m === '' ? '' : m.slice(1), raw: m });
          i++;
          continue;
        }
        throw new Exit2(`error: parse ${i + 1}`);
      }
      close();
      if (chunks.length > 0) {
        const lc = chunks[chunks.length - 1] as Chunk;
        while (lc.body.length > 0 && (lc.body[lc.body.length - 1] as BodyLine).raw.trim() === '') lc.body.pop();
      }
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${updateLine + 1}`);
      sections.push({ kind: 'update', path, moveTo, chunks });
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  return sections.map((s) => sectionEdit(s, strict));
}
