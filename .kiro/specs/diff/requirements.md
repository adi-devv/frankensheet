# diff requirements

## User stories (EARS)

**US-1:** WHEN a user runs `git diff` on a .xlsx file, the system SHALL show a readable text diff with cell changes, not binary gibberish.

**US-2:** WHEN the system computes a diff between two Books, the system SHALL produce a SheetDiff for each sheet listing cell changes, row inserts, and row deletes.

**US-3:** WHEN a cell's formula logic changed (not just shifted), the system SHALL classify it as a `formula` change.

**US-4:** WHEN a cell changed from a constant to a formula (or vice versa), the system SHALL classify it as a `both` change.

**US-5:** WHEN a user runs `fsheet textconv <file>`, the system SHALL print a stable, deterministic text representation of the workbook.

**US-6:** WHEN the system applies a diff to a Book, the result SHALL match the target Book exactly.

## Acceptance criteria

**AC-1.1:** `fsheet textconv <file>` outputs line-per-cell text: one line per cell in the format `A1: value` or `A1: =formula`.

**AC-1.2:** The textconv format includes sheet headers `[Sheet1]` and defined names `NAME: formula`. No `# Workbook: <filename>` line (git provides temp paths that would cause spurious diffs).

**AC-1.3:** The textconv format is deterministic: cells appear in row-major order (A1, B1, C1, A2, B2, ...). Sheets in workbook order (not sorted). Defined names sorted by name. Escaping: `\` → `\\`, newline → `\n`, CR → `\r`. A string value starting with `"="` is printed with a leading `'`.

**AC-2.1:** `diff(a: Book, b: Book): BookDiff` returns a map `{ [sheetName: string]: SheetDiff }`.

**AC-2.2:** `SheetDiff` contains:
  - `rowOps: RowOp[]` where `RowOp = { type: 'insert' | 'delete', at: number, count?: number, content?: Row }`
  - `cellChanges: CellChange[]` where `CellChange = { row: number, col: number, before?: Cell, after?: Cell, kind: 'value' | 'formula' | 'both' }`
  - `sheetAdded?: true` if the sheet is new in `b`
  - `sheetRemoved?: true` if the sheet was in `a` but not in `b`

**AC-3.1:** Two formula cells are compared by `fr` (R1C1 relative form, derived from `f` and the cell's position). If `fr` differs, it's a `formula` change. If `fr` is the same, it's not a change (even if `f` differs).

**AC-3.2:** If a cell's `v` (value) differs but `fr` is the same, it's a `value` change.

**AC-4.1:** If a cell has `f` in one version but not the other, and `v` also differs, it's a `both` change.

**AC-5.1:** The textconv format is reversible: two workbooks with the same data but different byte representations (e.g., different shared string order) produce identical textconv output.

**AC-5.2:** Git can diff the textconv output line by line. Empty cells are omitted from the output.

**AC-6.1:** `apply(diff: BookDiff, a: Book): Book` returns a new Book equal to `b` (the target of the diff).

**AC-6.2:** `apply` applies row inserts/deletes, then cell changes, then recomputes `Row.sig` for touched rows. Formula references are not shifted by `apply` (row shifting is handled separately in the merge phase). P3 compares books via a normalize/equal helper, not reference equality.

## Property P3

**P3:** `apply(diff(a, b), a) == b` for all pairs of small Books.

Generate random pairs of Books where `b` is derived from `a` by random edits (cell edit, row insert, row delete). Compute `diff(a, b)`, apply it to `a`, and verify the result equals `b`.

## Scope

### In scope (Phase 2)
- `packages/core/src/diff.ts`: `diff(a, b)`, `apply(diff, a)`
- `BookDiff` and `SheetDiff` types in `model.ts`
- Row alignment **by position only** (row i aligns with row i). True row alignment (by key or similarity) is Phase 3.
- Textconv text format: stable, line-per-cell, deterministic ordering
- `apps/cli/src/textconv.ts`: `fsheet textconv <file>` command

### Phase 3 (row alignment seam)
- Row alignment by key column or LCS+similarity will be integrated in Phase 3.
- In Phase 2, `diff` compares rows by index. If row i exists in both, it's a potential match. If row i exists in only one, it's an insert or delete.
- **Design seam:** `diff` will call `alignRows(a.rows, b.rows)` to get matched pairs. In Phase 2, `alignRows` returns `[(a[i], b[i]) for i in 0..min(len(a), len(b))]` plus inserts and deletes for the tail. In Phase 3, `alignRows` is replaced with the full key/LCS algorithm from `align.ts`.

## Dependencies

- `model.ts`: Book, Sheet, Row, Cell types
- `formula.ts`: `toR1C1(f, at)` to derive `fr` for formula comparison
- `read.ts`: used by textconv to read the input file

## Out of scope (Phase 2)

- Column alignment (columns are always matched by index in Phase 2; header-based matching is Phase 3)
- Conflict detection (that's part of merge.ts, not diff.ts)
- Web UI for diff view (that's Phase 5)
