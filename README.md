# hidden-spec-cli

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/calebakinjomo/hidden-spec-cli/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/calebakinjomo/hidden-spec-cli/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend applies AI-written edits — unified diffs, SEARCH/REPLACE blocks, V4A patches and JSON tool calls — to a tree of text files. It matches the lines an edit names by content across three tiers (exact, trailing-whitespace, indentation), so wrong line numbers and drifted whitespace do not stop it, and it writes every change or none: if any edit fails, no file is written.

## Run it

```sh
node main.ts [options] [PATCH]
```

`PATCH` is the patch file, or `-` (or nothing) to read it from standard input. Options: `--format=unified|search-replace|v4a|json|auto` (default `auto`, which detects the format), `--check` (everything but write), `--strict` (exact matching only). Exit 0 prints what changed (`A`, `D`, `M`, `R` lines, then `ok: <n> files`); exit 1 lists each failed edit and `failed: <k> of <n> edits`; exit 2 is a usage, missing-patch, format or parse error.

## The files

- `main.ts`: the CLI — arguments, format detection, output and exit codes, and the hand-over to `runner.ts` in a trial.
- `tree.ts`: the tree of files the edits work on, safe paths, file and patch line handling, and the all-or-nothing write.
- `match.ts`: the three matching tiers and the way a replacement is written (context lines kept as the file's own, re-indentation at tier 2).
- `unified.ts`: unified diffs — sections, hunks, nearest-occurrence matching, creations, deletions and moves.
- `searchreplace.ts`: SEARCH/REPLACE blocks.
- `v4a.ts`: V4A patches — add, delete and update sections, anchors, the cursor, end-of-file chunks.
- `json.ts`: JSON edits — create, str_replace and insert.
- `runner.ts`: the kit's runner, kept as it is; in a trial it runs `main.ts` on each check.
- `check.ts`: the practice set on your own machine: `node check.ts <practice.json>`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hdavhdvz&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
