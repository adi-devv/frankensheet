# formula-refs design

## Overview
`formula.ts` provides A1↔R1C1 conversion, formula shifting, and range extraction. All functions are pure and stateless.

## Coordinate system
- Rows and columns are **zero-indexed** internally: row 0 = Excel row 1, col 0 = Excel column A.
- A1 addresses in strings are 1-indexed (Excel convention).
- `at: {row: number, col: number}` is always zero-indexed.

## Token types
```ts
type TokenType =
  | 'ref'         // A1, $A$1, Sheet1!A1, 'My Sheet'!$A1
  | 'range'       // A1:B2, A:A, 1:1, Sheet1!A1:B2
  | 'string'      // "text"
  | 'function'    // SUM(, IF(
  | 'operator'    // +, -, *, /, ^, &, =, <>, <, >, <=, >=
  | 'number'      // 123, 1.5, 1E+10
  | 'error'       // #REF!, #DIV/0!, etc.
  | 'whitespace'  // space, tab
  | 'paren'       // ( )
  | 'comma'       // ,
  | 'unknown';    // anything else

interface Token {
  type: TokenType;
  text: string;
}
```

## Tokenizer algorithm
**Input:** formula string (A1, no leading `=`)  
**Output:** `Token[]`

State machine with cursor `i`:
1. **Whitespace:** `[ \t]+` → `{type: 'whitespace', text}`
2. **String:** `"..."` with escaped `""` → `{type: 'string', text}`. Scan until closing `"`, skipping `""`.
3. **Error:** `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?`, `#NUM!`, `#NULL!` → `{type: 'error', text}`. Match longest.
4. **Number:** `[0-9]+(\.[0-9]*)?([Ee][+-]?[0-9]+)?` → `{type: 'number', text}`
5. **Identifier run:** `[A-Za-z_\.0-9$]+` scanned as one unit, then classified:
   - Followed by `(` → `{type: 'function', text}` (includes the `(`)
   - Exactly `TRUE` or `FALSE` (case-insensitive) → `{type: 'boolean', text}`
   - Matches a full cell ref/range pattern → `{type: 'ref' | 'range', text}` (must not be followed by more letters/digits)
   - Else → `{type: 'name', text}` (defined name, passed through)
   - Ref/range patterns: `\$?[A-Z]+\$?[0-9]+` or whole-row/col `\$?[A-Z]+:\$?[A-Z]+` or `\$?[0-9]+:\$?[0-9]+`
   - Sheet-qualified: unquoted sheet names have no spaces; quoted sheet names `'...'!` may contain anything, with `''` as escaped quote
   - Allow lowercase function names and `_xlfn.` prefixes
6. **Operator:** `<>`, `<=`, `>=`, or single char from `+-*/^&=<>` → `{type: 'operator', text}`
7. **Paren:** `(` or `)` → `{type: 'paren', text}`
8. **Comma:** `,` → `{type: 'comma', text}`
9. **Unknown:** any other char → `{type: 'unknown', text}`

Repeat until end. Return token list.

**No regex-only shortcut:** string scanning uses manual cursor advancement to handle `""` escaping correctly.

## A1 ↔ R1C1 conversion

### toR1C1(f: string, at: {row, col}): string
For each ref/range token:
1. Parse sheet qualifier (if any): `'Sheet Name'!` or `SheetName!`. Keep it unchanged.
2. Parse cell ref: `$?[A-Z]+$?[0-9]+`
3. For each component (col and row):
   - If absolute (`$`): output `R{row}` or `C{col}` (1-indexed)
   - If relative: output `R[offset]` or `C[offset]`, where offset = refRow - at.row or refCol - at.col
4. Rebuild token text with R1C1 form.
5. Ranges: convert both ends separately, join with `:`.
6. Whole rows/columns: preserve relative vs absolute: `A:A` at col 0 → `C:C`, `$A:$A` → `C1:C1`, `3:3` at row 0 → `R[2]:R[2]`, `$3:$3` → `R3:R3`.

Return the formula string with all refs converted.

### toA1(fr: string, at: {row, col}): string
Inverse of toR1C1. For each R1C1 ref/range token:
1. Parse sheet qualifier.
2. Parse `R[offset]C[offset]` or `R{abs}C{abs}`.
3. For each component:
   - If bracketed: compute `at.row + offset` or `at.col + offset`, output relative A1 (no `$`)
   - If absolute: output with `$` prefix
4. Rebuild token text with A1 form.

Requires a mode parameter to distinguish R1C1 vs A1 input: `tokenize(f, {r1c1: true})`. Note "R1C1" is also a valid A1 ref.

Return the formula string with all refs converted.

**Property P6:** `toA1(toR1C1(f, at), at) === f`. Test with generated formulas at random positions.

## shiftFormula

Two overloads:

### shiftFormula(f: string, rowMap: Map<number, number>): string
Used after row alignment. `rowMap` maps old row → new row (zero-indexed).
- For each ref/range token (A1 form):
  - If absolute row: look up in `rowMap`, update. If not in map, keep as-is.
  - If relative row: convert to absolute (relative to formula's position), map, convert back.
- Requires the formula's original position to be known. **Design decision:** this overload is Phase 3 only (row alignment). Phase 2 uses the simpler offset-based overload.

### shiftFormula(f: string, opts: {sheet: string, at: number, count: number}): string
Used for row insert/delete. Shifts refs by `count` rows starting at row `at` (zero-indexed).
- For each ref/range token (A1 form):
  - Parse sheet qualifier. If unqualified or qualified with `opts.sheet`, shift. Else skip.
  - Parse row component.
  - **Insert (count > 0):** If row >= opts.at, add opts.count. If row becomes < 0, replace with `#REF!`.
  - **Delete (count < 0):** Deleting rows [at, at+|count|) turns a single ref inside the deleted band into `#REF!`; a range is clipped (whole range inside → `#REF!`); refs below shift up by |count|.
- Ranges: shift both start and end.
- Whole-row refs shift like row refs; whole-column refs never shift on row insert/delete.

Return the formula string with shifted refs.

**Property P8:** `shiftFormula(shiftFormula(f, {sheet, at, count: k}), {sheet, at, count: -k}) === f` for insert-then-delete of the same band. Test with k ∈ [1..5], at ∈ [0..10].

## rangesIn(f: string): Range[]
```ts
interface Range {
  sheet?: string;       // undefined if unqualified
  start: {row: number, col: number};  // zero-indexed
  end: {row: number, col: number};
}
```
1. Tokenize `f`.
2. For each ref/range token:
   - Parse sheet qualifier → `sheet`
   - Parse start ref → `{row, col}`
   - If range, parse end ref → `{row, col}`. Else end = start.
   - Normalize: `start.row ≤ end.row`, `start.col ≤ end.col` (swap if needed).
   - Add `{ sheet, start, end }` to result.
3. Return list.

**Usage:** risk rules call `rangesIn(cell.f)` to check if a formula covers inserted/deleted rows.

## Helpers

### colToIndex(col: string): number
`A` → 0, `Z` → 25, `AA` → 26. Sum of base-26 digits.

### indexToCol(n: number): string
Inverse. `0` → `A`, `25` → `Z`, `26` → `AA`.

### parseRef(ref: string): {sheet?: string, col: number, row: number, colAbs: boolean, rowAbs: boolean}
Parses `'Sheet1'!$A$1` → `{sheet: "Sheet1", col: 0, row: 0, colAbs: true, rowAbs: true}`.
Strips quotes from sheet name.

### refToString(parsed): string
Inverse of parseRef. Quotes sheet name if it contains spaces or special chars.

## Edge cases

- **Whole-column refs (`A:A`)**: never shift on row insert/delete. Shifted only if column insert is implemented (Phase 3+). In Phase 2, left as-is.
- **Whole-row refs (`1:1`)**: shift like normal row refs if row >= at.
- **Invalid refs**: passed through unchanged. No validation. If Excel would show `#NAME?`, we keep the text as-is.
- **Circular refs**: not detected. Out of scope.
- **Structured references (`Table1[Column]`)**: treated as unknown tokens, passed through unchanged.

## Testing strategy

**Unit tests** (`formula.test.ts`):
- tokenize: one test per token type
- toR1C1 / toA1: simple refs, absolute/relative combos, ranges, sheet-qualified, whole rows/cols
- shiftFormula: insert rows, delete rows, shift within range vs outside range
- rangesIn: single ref, multi-range formula, nested functions

**Property tests** (`formula.prop.test.ts`):
- **P6**: generate A1 formulas (mix of refs, ranges, sheet-qualified, absolute/relative), pick random `at`, verify round-trip.
- **P8**: generate formulas, random sheet name, random at, random count, verify shift-then-unshift identity.
- **Idempotence**: `toR1C1(toR1C1(f, at), at) !== f` (second call gets R1C1 input, not A1). Test detects if input form is misdetected.

**Fixture integration**: Phase 1 fixtures with formulas are read, formulas are shifted by write.ts (which calls shiftFormula), then verified to match expected refs.
