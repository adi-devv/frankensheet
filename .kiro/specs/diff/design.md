# diff design

## Overview
`diff.ts` compares two Books and produces a `BookDiff` listing all changes. It also provides `apply(diff, a)` to reconstruct `b` from `a + diff`. The textconv format is a stable text dump used by git's diff driver.

## Data structures

```ts
interface RowOp {
  type: 'insert' | 'delete';
  at: number;           // row index (zero-indexed) where the op happens
  count?: number;       // for delete, how many rows to remove (default 1)
  content?: Row;        // for insert, the row data
}

interface CellChange {
  row: number;          // zero-indexed row in the aligned space
  col: number;          // zero-indexed column
  before?: Cell;        // undefined if the cell was added
  after?: Cell;         // undefined if the cell was deleted
  kind: 'value' | 'formula' | 'both';
}

interface SheetDiff {
  rowOps: RowOp[];
  cellChanges: CellChange[];
  sheetAdded?: true;
  sheetRemoved?: true;
}

interface BookDiff {
  sheets: Record<string, SheetDiff>;
}
```

## diff(a: Book, b: Book): BookDiff

1. **Sheet-level:**
   - For each sheet in `a` and `b`:
     - If sheet in `a` but not `b` → `{ sheetRemoved: true, rowOps: [], cellChanges: [] }`
     - If sheet in `b` but not `a` → `{ sheetAdded: true, rowOps: [all inserts], cellChanges: [] }`
     - If sheet in both → compute `SheetDiff` (step 2)

2. **Row alignment (Phase 2 simple version):**
   - `alignRows(a.rows, b.rows)` returns:
     ```ts
     {
       matched: Array<[rowA: Row | null, rowB: Row | null, idxA: number, idxB: number]>;
     }
     ```
   - Phase 2 implementation: pair rows by index. `matched = [(a[i], b[i], i, i) for i in 0..min(len(a), len(b))]`.
   - If `len(b) > len(a)`, append `(null, b[i], -1, i)` for `i >= len(a)` (inserts).
   - If `len(a) > len(b)`, append `(a[i], null, i, -1)` for `i >= len(b)` (deletes).
   - **Phase 3 seam:** replace with call to `align.ts` which returns key-based or LCS-based pairs.

3. **Row ops:**
   - For each pair `(rowA, rowB, idxA, idxB)`:
     - If `rowA === null` → `{ type: 'insert', at: idxB, content: rowB }`
     - If `rowB === null` → `{ type: 'delete', at: idxA }`

4. **Cell changes:**
   - For each matched pair `(rowA, rowB, idxA, idxB)` where both are non-null:
     - For each col `c` in `0..max(rowA.cells.length, rowB.cells.length)`:
       - Let `cellA = rowA.cells[c]`, `cellB = rowB.cells[c]`
       - If `cellA === undefined` and `cellB !== undefined` → `{ row: idxB, col: c, after: cellB, kind: 'value' or 'formula' }`
       - If `cellA !== undefined` and `cellB === undefined` → `{ row: idxB, col: c, before: cellA, kind: 'value' or 'formula' }`
       - If both defined:
         - Compute `frA = toR1C1(cellA.f, {row: idxA, col: c})` if `cellA.f` exists, else `null`
         - Compute `frB = toR1C1(cellB.f, {row: idxB, col: c})` if `cellB.f` exists, else `null`
         - Determine `kind`:
           - If `cellA.v !== cellB.v` and `frA === frB` → `'value'`
           - If `cellA.v === cellB.v` and `frA !== frB` → `'formula'`
           - If `cellA.v !== cellB.v` and `frA !== frB` → `'both'`
           - If both equal → no change, skip
         - Add `{ row: idxB, col: c, before: cellA, after: cellB, kind }`

5. Return `{ sheets: { [sheetName]: sheetDiff } }`

## apply(diff: BookDiff, a: Book): Book

1. Clone `a` to `result: Book`.
2. For each sheet in `diff.sheets`:
   - If `sheetAdded`, add the sheet from `b` (caller must provide `b` or the full content in the diff). **Design decision:** store full sheet content in `SheetDiff.addedSheet?: Sheet` for added sheets.
   - If `sheetRemoved`, remove the sheet from `result`.
   - Apply row ops (inserts/deletes) in order.
   - Apply cell changes: for each `CellChange`, set `result.sheets[sheet].rows[change.row].cells[change.col] = change.after`.
   - Recompute `Row.sig` for all touched rows.

3. Return `result`.

**Note:** `apply` does not shift formula references. That's part of the merge rebuild phase. `apply` only sets the cell values as given in the diff.

## Textconv format

**Purpose:** stable, line-per-cell text dump for git diff.

**Format:**
```
# Defined names:
NAME1: formula1
NAME2: formula2

[Sheet1]
A1: value
A2: =SUM(B1:B10)
B1: 42
B2: text

[Sheet2]
A1: another value
```

**Rules:**
1. List defined names (if any) in sorted order: `NAME: formula`.
2. For each sheet in workbook order (not sorted):
   - Print `[SheetName]`.
   - For each non-empty cell in row-major order (A1, B1, C1, A2, B2, ...):
     - If formula: `A1: =formula` (include the `=`)
     - Else: `A1: value`
3. Empty cells are omitted.
4. Values are escaped so each cell stays on one line: `\` → `\\`, newline → `\n`, CR → `\r`. A string value that starts with `"="` is printed with a leading `'` so it can't be confused with a formula.
5. Values are printed as-is (numbers as numbers, strings as strings, booleans as `TRUE`/`FALSE`, errors as `#REF!` etc.).
6. Cell equality uses deep equality (error values are objects); compare `v` with Object.is-like semantics plus `{error}` by code.

**Implementation:** `textconv.ts` exports `toTextconv(book: Book): string`.

**CLI:** `fsheet textconv <file>` calls `read(fs.readFileSync(file))` then `toTextconv(book)` and prints to stdout.

## Phase 3 integration seam

**Row alignment stub in Phase 2:**
```ts
function alignRows(a: Row[], b: Row[]): AlignedRows {
  const matched: Array<[Row | null, Row | null, number, number]> = [];
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    matched.push([a[i], b[i], i, i]);
  }
  for (let i = minLen; i < a.length; i++) {
    matched.push([a[i], null, i, -1]);
  }
  for (let i = minLen; i < b.length; i++) {
    matched.push([null, b[i], -1, i]);
  }
  return { matched };
}
```

**Phase 3:** replace `alignRows` with a call to `align.ts` which returns key-based or LCS+similarity pairs. The rest of `diff` stays the same.

## Edge cases

- **Empty sheet:** if both `a` and `b` have 0 rows, `SheetDiff` is empty (no ops, no changes).
- **Sheet rename:** not detected in Phase 2. Both the old and new names appear as remove + add. Phase 3 may add heuristic detection.
- **Formatting-only change:** not a change. Formatting is not part of the model.
- **Formula that only shifted:** `fr` is the same → no change.

## Testing strategy

**Unit tests** (`diff.test.ts`):
- Empty books: diff returns empty
- Single cell change: value, formula, both
- Row insert: one insert op
- Row delete: one delete op
- Sheet add/remove
- Formula that shifted but logic didn't change: no change reported

**Property test** (`diff.prop.test.ts`):
- **P3:** generate random book `a`, apply random edits to get `b`, compute `diff(a, b)`, apply to `a`, verify result equals `b`.
- Use fast-check to generate edit sequences: `{ type: 'editCell', row, col, newValue }`, `{ type: 'insertRow', at }`, `{ type: 'deleteRow', at }`.

**Integration tests** (`textconv.test.ts`):
- Read a fixture, convert to textconv, verify format.
- Two fixtures with same data but different byte order → same textconv output.
