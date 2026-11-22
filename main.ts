// main.ts — mend, the command-line tool SPEC.md specifies. Node 22, the standard library
// alone; run as `node main.ts [options] [PATCH]` with the working directory as the root of
// a tree of text files. It reads a patch in one of four formats — unified diff,
// SEARCH/REPLACE blocks, V4A patches, JSON edits — finds the lines each edit names at the
// first of three matching tiers, and writes every change or none, printing what it changed
// or why it failed.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and this file
// hands over to runner.ts (the last lines below): keep that hand-over and runner.ts as
// they are.

import { readFileSync, writeSync } from 'node:fs';
import { blank, changeRows, Exit2, Fail, patchLines, Tree, writeChanges } from './tree.ts';
import type { Edit } from './tree.ts';
import { parseUnified } from './unified.ts';
import { parseSearchReplace } from './searchreplace.ts';
import { parseV4a } from './v4a.ts';
import { parseJson } from './json.ts';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

/** Detect the patch's format with --format=auto, the first of these that holds: the first
 *  non-blank line is *** Begin Patch (v4a); the first non-whitespace character of the
 *  first non-blank line is [ or { (json); some line is <<<<<<< SEARCH (search-replace);
 *  some line starts with diff --git, or some line starts with --- and the line after it
 *  starts with +++ (unified). Null when none holds. */
function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if ((lines[first] as string).trim() === '*** Begin Patch') return 'v4a';
  const c = (lines[first] as string).trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** Run the CLI on its arguments: the exit code and the lines for standard output. */
function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : (pos[0] as string);
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = parseJson(text, lines);
    else if (kind === 'unified') edits = parseUnified(lines, strict);
    else if (kind === 'search-replace') edits = parseSearchReplace(lines, strict);
    else edits = parseV4a(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const beforeMoves = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.length = beforeMoves;
      fails.push(e);
    }
  }
  if (fails.length > 0) {
    return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  }
  const changes = changeRows(tree);
  if (!check) writeChanges(tree, changes);
  const rows = changes.map((c) => c.line);
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
