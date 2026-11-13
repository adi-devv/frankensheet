# diff tasks

Order: types → alignRows stub → diff → apply → textconv → CLI. Formula comparison uses formula.ts (toR1C1).

---

## 1. Types

- [ ] **1.1** Add `RowOp`, `CellChange`, `SheetDiff`, `BookDiff` types to `packages/core/src/model.ts`.
  - Test: `packages/core/src/model.test.ts` — verify type guards if any added.

---

## 2. Row alignment stub (Phase 2 simple version)

- [ ] **2.1** Write `packages/core/src/diff.ts` with internal helper `alignRows(a: Row[], b: Row[]): AlignedRows` per design.md. Pair rows by index. Return matched pairs plus inserts/deletes for tail.
  - Test: `packages/core/src/diff.test.ts` — test with equal-length arrays, `a` shorter, `b` shorter. Verify matched pairs and insert/delete counts.

---

## 3. diff function

- [ ] **3.1** Implement `diff(a: Book, b: Book): BookDiff`. Start with sheet-level: detect added/removed sheets.
  - Test: add to `diff.test.ts` — book with 1 sheet, book with 2 sheets. Verify `sheetAdded` and `sheetRemoved` flags.

- [ ] **3.2** Add row ops: for each sheet, call `alignRows`, generate insert/delete ops.
  - Test: add to `diff.test.ts` — sheet with 3 rows vs 5 rows. Verify 2 insert ops. Sheet with 5 rows vs 3 rows. Verify 2 delete ops.

- [ ] **3.3** Add cell change detection: for matched rows, compare cells. Use `toR1C1` from formula.ts to derive `fr` for formula comparison.
  - Test: add to `diff.test.ts` — change a value in one cell, verify `kind: 'value'`. Change a formula's logic (not just shift), verify `kind: 'formula'`. Change both, verify `kind: 'both'`.

- [ ] **3.4** Handle formula that only shifted: `fr` same → no change. Test with a formula at A3 that becomes A5 after 2 rows inserted before it. Verify no change reported.
  - Test: add to `diff.test.ts`.

- [ ] **3.5** Add cell add/remove: if `cellA` is undefined and `cellB` defined, report add. If `cellA` defined and `cellB` undefined, report remove.
  - Test: add to `diff.test.ts` — add a cell, remove a cell.

---

## 4. apply function

- [ ] **4.1** Implement `apply(diff: BookDiff, a: Book): Book`. Start with sheet add/remove.
  - Test: add to `diff.test.ts` — apply a diff with `sheetAdded`, verify sheet appears in result. Apply a diff with `sheetRemoved`, verify sheet removed.

- [ ] **4.2** Add row ops: apply inserts and deletes in order.
  - Test: add to `diff.test.ts` — apply insert op, verify row count increased. Apply delete op, verify row removed.

- [ ] **4.3** Add cell changes: for each `CellChange`, set the cell in the result book. Recompute `Row.sig` for touched rows.
  - Test: add to `diff.test.ts` — apply a diff with cell changes, verify cells updated and Row.sig correct.

- [ ] **4.4** Handle edge case: applying a diff to a book that doesn't match the expected "before" state. **Design decision:** `apply` assumes the diff is valid for `a`. If a cell change's `before` doesn't match `a`, log a warning but proceed (overwrite with `after`).
  - Test: add to `diff.test.ts` — apply a diff with mismatched `before`, verify no crash, result has `after` value.

- [ ] **4.5** Add property test P3: generate random book `a`, apply random edits to get `b`, compute `diff(a, b)`, apply to `a`, verify result equals `b` using a normalize/equal helper (not reference equality).
  - Test: `packages/core/src/diff.prop.test.ts` — use fast-check to generate books and edit sequences.

---

## 5. Textconv format

- [ ] **5.1** Write `packages/core/src/textconv.ts` with `toTextconv(book: Book): string` per design.md format. Start with defined names header (no workbook filename line).
  - Test: `packages/core/src/textconv.test.ts` — book with 2 defined names, verify names printed in sorted order.

- [ ] **5.2** Add sheet and cell output: for each sheet in workbook order (not sorted), print `[SheetName]` and cells in row-major order (A1, B1, C1, A2, B2, ...). Escape `\` → `\\`, newline → `\n`, CR → `\r`. String values starting with `"="` get a leading `'`.
  - Test: add to `textconv.test.ts` — book with 2 sheets, each with mixed cells (number, string, formula). Verify output format matches spec and row-major order.

- [ ] **5.3** Handle empty cells: omit from output.
  - Test: add to `textconv.test.ts` — sheet with sparse cells (A1, A3, B2), verify A2 not printed.

- [ ] **5.4** Handle special values: booleans as `TRUE`/`FALSE`, errors as `#REF!` etc., numbers as numeric strings.
  - Test: add to `textconv.test.ts` — cell with boolean, cell with error, cell with date serial. Verify output.

- [ ] **5.5** Handle formulas: print with leading `=`.
  - Test: add to `textconv.test.ts` — cell with formula `SUM(A1:A10)`, verify output `A2: =SUM(A1:A10)`.

- [ ] **5.6** Integration test: read 2 fixtures that have the same data but different byte representations (different shared string order, different formatting). Verify textconv output is identical.
  - Test: add to `textconv.test.ts` — create or reuse fixtures, verify textconv outputs match.

- [ ] **5.7** Add property test: toTextconv is deterministic and two books equal under normalize give identical text.
  - Test: add to `textconv.prop.test.ts` — generate random books, normalize, verify textconv output is stable.

---

## 6. CLI textconv command

- [ ] **6.1** Write `apps/cli/src/textconv.ts` with main function that reads file bytes, calls `read()` from core, calls `toTextconv()`, and prints to stdout.
  - Test: `apps/cli/src/textconv.test.ts` — integration test: run via `npm run fsheet -- textconv <file>`, capture stdout, verify format.

- [ ] **6.2** Add root script `"fsheet": "tsx apps/cli/src/cli.ts"` to package.json. Create `apps/cli/src/cli.ts` as the main entry that dispatches commands (`textconv`, later `install`, `merge-driver`, etc.). Run via tsx in Phase 2; no dist build or bin bundling until Phase 7.
  - Test: no dedicated test; manual verification. Run `npm run fsheet -- textconv fixtures/fidelity/01_budget_sums.xlsx`.

- [ ] **6.3** Handle CLI errors: if file not found, print error and exit 1. If file is not a valid .xlsx, print error and exit 1.
  - Test: add to `textconv.test.ts` — mock fs errors, verify exit codes.

---

## 7. Shared arbitraries (extend from io-fidelity)

- [ ] **7.1** Add `arbEdit()` to `packages/core/src/testing/arbitraries.ts`: random edit operation (editCell, insertRow, deleteRow). Add `arbEditSequence()` to generate a list of edits.
  - Test: no dedicated test; used by diff.prop.test.ts.

---

## Gate check (run after all tasks)

- `npm run typecheck` passes.
- `npm test` green for `packages/core/src/diff.test.ts` and `packages/core/src/textconv.test.ts`.
- Property test `diff.prop.test.ts` passes with `FC_RUNS=1000`: P3 verified (apply(diff(a, b), a) == b).
- Property test `textconv.prop.test.ts` passes: textconv determinism verified.
- `npm run fsheet -- textconv fixtures/fidelity/01_budget_sums.xlsx` prints readable output with correct format.
- Git integration smoke test: add `.gitattributes` line `*.xlsx diff=fsheet`, config `git config diff.fsheet.textconv "npm run fsheet -- textconv"`, run `git diff` on a changed fixture. Verify readable diff (manual for Phase 2; automated in Phase 4).
