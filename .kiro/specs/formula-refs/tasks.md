# formula-refs tasks

Order: helpers → tokenizer → toR1C1/toA1 → shiftFormula → rangesIn. Each function is tested before moving to the next.

---

## 1. Coordinate helpers

- [x] **1.1** Write `packages/core/src/formula.ts` with `colToIndex(col: string): number` and `indexToCol(index: number): string`. Zero-indexed: A=0, Z=25, AA=26.
  - Test: `packages/core/src/formula.test.ts` — verify A, Z, AA, AZ, BA.

- [x] **1.2** Add `parseRef(ref: string): {sheet?: string, col: number, row: number, colAbs: boolean, rowAbs: boolean}` and `refToString(parsed): string`. Handle `'Sheet Name'!$A$1`, strip quotes from sheet, add quotes back if space/special chars.
  - Test: add to `formula.test.ts` — simple ref, absolute ref, sheet-qualified, quoted sheet name.

---

## 2. Tokenizer

- [x] **2.1** Define `TokenType` and `Token` types in `formula.ts`.
  - Test: no dedicated test; used by tokenize tests.

- [x] **2.2** Write `tokenize(formula: string): Token[]` with state machine per design.md. Start with whitespace and unknown token cases.
  - Test: add to `formula.test.ts` — tokenize `"  A1  "` → 3 tokens (ws, ref, ws).

- [x] **2.3** Add string token scanning: `"text"` with `""` escaping. Manual cursor loop, not regex.
  - Test: add to `formula.test.ts` — tokenize `"Hello ""World"""` → `{type: 'string', text: '"Hello ""World"""'}`.

- [x] **2.4** Add error token matching: `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?`, `#NUM!`, `#NULL!`.
  - Test: add to `formula.test.ts` — tokenize `#REF!+#DIV/0!` → error, operator, error.

- [x] **2.5** Add number token: `[0-9]+(\.[0-9]*)?([Ee][+-]?[0-9]+)?`.
  - Test: add to `formula.test.ts` — tokenize `123`, `1.5`, `1E+10`.

- [x] **2.6** Add identifier run scanning: scan `[A-Za-z_\.0-9$]+` as one unit, then classify: followed by `(` → function (so LOG10( and ATAN2( are functions); TRUE/FALSE → boolean; matches a full cell ref/range pattern → ref (must not be followed by more letters/digits); else → name (defined name, passed through). Unquoted sheet names have no spaces; quoted sheet names may contain anything, with `''` as escaped quote. Allow lowercase function names and `_xlfn.` prefixes.
  - Test: add to `formula.test.ts` — tokenize `A1`, `$A$1`, `A1:B2`, `Sheet1!A1`, `'My Sheet'!A1:B2`, `A:A`, `1:10`, `LOG10(`, `_xlfn.IFS(`, `TRUE`.

- [x] **2.7** Add operator, paren, comma tokens.
  - Test: add to `formula.test.ts` — tokenize `A1+B2`, `(A1)`, `A1,B1`.

- [x] **2.8** Integration test: tokenize `SUM('Sheet 1'!A1:B2,C3)` → function, range, comma, ref, paren.
  - Test: add to `formula.test.ts`.

---

## 3. A1 ↔ R1C1 conversion

- [x] **3.1** Write `toR1C1(f: string, at: {row: number, col: number}): string`. Convert each ref/range token from A1 to R1C1 relative form. Start with simple unqualified refs.
  - Test: add to `formula.test.ts` — `toR1C1("A1", {row: 0, col: 0})` → `"RC"`. `toR1C1("A1", {row: 1, col: 0})` → `"R[-1]C"`. `toR1C1("B3", {row: 0, col: 0})` → `"R[2]C[1]"`.

- [x] **3.2** Add absolute ref handling: `$A$1` → `R1C1`. Mixed: `$A1` → `R[offset]C1`.
  - Test: add to `formula.test.ts` — verify absolute and mixed cases.

- [x] **3.3** Add range conversion: `A1:B2` at (0,0) → `R[1]C[1]:R[2]C[2]`.
  - Test: add to `formula.test.ts`.

- [x] **3.4** Add sheet-qualified conversion: keep sheet prefix, convert ref part only.
  - Test: add to `formula.test.ts` — `Sheet1!A1` at (0,0) → `Sheet1!R[1]C[1]`.

- [x] **3.5** Add whole-row/col conversion: preserve relative vs absolute. `A:A` at col 0 → `"C:C"`, `$A:$A` → `"C1:C1"`, `3:3` at row 0 → `"R[2]:R[2]"`, `$3:$3` → `"R3:R3"`.
  - Test: add to `formula.test.ts`.

- [x] **3.6** Write `toA1(fr: string, at: {row: number, col: number}): string`. Inverse of toR1C1. Convert R1C1 tokens back to A1.
  - Test: add to `formula.test.ts` — verify inverse for simple ref, absolute, range, sheet-qualified.

- [x] **3.7** Add property test P6: `toA1(toR1C1(f, at), at) === f` for generated formulas. Use fast-check to generate A1 formulas with mix of refs, ranges, absolute/relative, at random positions.
  - Test: `packages/core/src/formula.prop.test.ts`

---

## 4. Formula shifting

- [x] **4.1** Write `shiftFormula(f: string, opts: {sheet: string, at: number, count: number}): string`. Start with unqualified refs: if row >= at, add count.
  - Test: add to `formula.test.ts` — `shiftFormula("A3", {sheet: "Sheet1", at: 2, count: 2})` → `A5`. `shiftFormula("A1", {sheet: "Sheet1", at: 2, count: 2})` → `A1` (unchanged).

- [x] **4.2** Add range shifting: shift both start and end.
  - Test: add to `formula.test.ts` — `shiftFormula("SUM(A3:A5)", {sheet: "Sheet1", at: 2, count: 2})` → `SUM(A5:A7)`.

- [x] **4.3** Add sheet-qualified ref filtering: shift only if sheet matches opts.sheet or ref is unqualified.
  - Test: add to `formula.test.ts` — `shiftFormula("Sheet1!A3+Sheet2!A3", {sheet: "Sheet1", at: 2, count: 2})` → `Sheet1!A5+Sheet2!A3`.

- [x] **4.4** Add absolute ref handling: `$A$3` shifts the same as `A3` (absolute row is still shifted if >= at).
  - Test: add to `formula.test.ts` — verify `$A$3` becomes `$A$5` when at=2, count=2.

- [x] **4.5** Add negative count (row delete): deleting rows [at, at+|count|) turns a single ref inside the deleted band into `#REF!`; a range is clipped (whole range inside → `#REF!`); refs below shift up by |count|.
  - Test: add to `formula.test.ts` — `shiftFormula("A3+A6", {sheet: "Sheet1", at: 2, count: -2})` → `"#REF!+A4"` (zero-indexed at:2 = Excel row 3). `shiftFormula("SUM(A2:A6)", {sheet: "Sheet1", at: 2, count: -2})` → `"SUM(A2:A4)"`.

- [x] **4.6** Add property test P8: `shiftFormula(shiftFormula(f, {sheet, at, count: k}), {sheet, at, count: -k}) === f` for generated formulas.
  - Test: add to `formula.prop.test.ts`.

---

## 5. Range extraction

- [x] **5.1** Write `rangesIn(f: string): Range[]` where `Range = {sheet?: string, start: {row, col}, end: {row, col}}`. Extract all ref/range tokens, parse to Range objects. Single refs become 1×1 ranges.
  - Test: add to `formula.test.ts` — `rangesIn("SUM(A1:B2)")` → one range `{start: {row:0, col:0}, end: {row:1, col:1}}`.

- [x] **5.2** Add sheet-qualified range extraction: strip quotes from sheet name.
  - Test: add to `formula.test.ts` — `rangesIn("'My Sheet'!A1:B2")` → `{sheet: "My Sheet", ...}`.

- [x] **5.3** Add normalization: ensure start.row ≤ end.row and start.col ≤ end.col (swap if needed).
  - Test: add to `formula.test.ts` — `rangesIn("B2:A1")` → normalized to A1:B2.

- [x] **5.4** Integration test: `rangesIn("SUM(A1:B2)+AVERAGE(C3:C5,Sheet2!D1)")` → 3 ranges.
  - Test: add to `formula.test.ts`.

---

## 6. Shared arbitraries

- [x] **6.1** Add `arbFormula()` to `packages/core/src/testing/arbitraries.ts`. Generate simple A1 formulas: `SUM(A1:A10)`, `A1+B1`, `Sheet1!A1*2`, mix of ref types.
  - Test: no dedicated test; used by formula.prop.test.ts.

---

## Gate check (run after all tasks)

- `npm run typecheck` passes.
- `npm test` green for `packages/core/src/formula.test.ts`.
- Property tests `formula.prop.test.ts` pass with `FC_RUNS=1000`:
  - P6: round-trip A1↔R1C1 for 1000 generated formulas
  - P8: shift-then-unshift identity for 1000 generated formulas
- Integration: Phase 1 fixture formulas are correctly parsed and shifted (verified in io-fidelity write tests).
