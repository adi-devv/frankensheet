# formula-refs requirements

## User stories (EARS)

**US-1:** WHEN the system compares two formula cells, the system SHALL compare their R1C1-relative forms to detect whether the formula logic changed or only shifted.

**US-2:** WHEN the system shifts rows during a merge, the system SHALL update all formula references to point to the new row positions.

**US-3:** WHEN the system parses a formula, the system SHALL correctly tokenize relative refs, absolute refs, ranges, sheet-qualified refs, quoted sheet names, whole rows/columns, strings, errors, and function calls.

**US-4:** WHEN the system converts a formula from A1 to R1C1, the system SHALL preserve the relative/absolute semantics of each reference component.

**US-5:** WHEN a risk rule needs to find ranges in a formula, the system SHALL extract all range addresses the formula covers.

## Acceptance criteria

**AC-1.1:** Two formulas `f1` and `f2` at positions `at1` and `at2` are equal if `toR1C1(f1, at1) === toR1C1(f2, at2)`.

**AC-1.2:** A formula that only shifted because rows moved produces the same `fr` (R1C1 relative form) as before.

**AC-2.1:** `shiftFormula(f, rowMap)` updates all refs in `f` according to the row mapping. Relative refs shift with the formula; absolute refs point to their mapped row.

**AC-2.2:** `shiftFormula(f, { sheet, at, count })` shifts refs by `count` rows starting at `at`. Unqualified refs on the target sheet and refs qualified with `sheet` are shifted; refs qualified with other sheets are not.

**AC-3.1:** `tokenize(formula)` returns a list of `Token` with `type` (ref, range, string, function, operator, number, error, whitespace, unknown) and `text`.

**AC-3.2:** The tokenizer handles:
  - Simple refs: `A1`, `$A$1`, `A$1`, `$A1`
  - Ranges: `A1:B2`, `$A$1:$B$2`
  - Sheet-qualified: `Sheet1!A1`, `'Sheet Name'!A1:B2`
  - Whole rows/columns: `A:A`, `1:1`, `$A:$Z`, `1:10`
  - Strings: `"text"` with escaped `""`
  - Errors: `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?`, `#NUM!`, `#NULL!`
  - Functions: `SUM(`, `IF(`

**AC-3.3:** The tokenizer does NOT use regex-only parsing. It uses a state machine or manual cursor walk to handle nested strings and quotes.

**AC-4.1:** `toR1C1(f, at)` converts `f` (A1 formula) to R1C1 relative form. `A1` at `at=(2,1)` becomes `R[1]C` (1 row down, same column). `$A$1` becomes `R1C1` (absolute).

**AC-4.2:** `toA1(fr, at)` converts `fr` (R1C1 formula) back to A1 form. Round-trip property: `toA1(toR1C1(f, at), at) === f` for all valid formulas.

**AC-5.1:** `rangesIn(f)` returns `Array<{ sheet?: string, start: {row, col}, end: {row, col} }>` for all ranges in `f`. Single-cell refs are treated as 1×1 ranges.

**AC-5.2:** `rangesIn` handles sheet-qualified ranges and removes quotes from sheet names. `'My Sheet'!A1:B2` → `{ sheet: "My Sheet", start: {row:0, col:0}, end: {row:1, col:1} }`.

## Properties

**P6:** `toA1(toR1C1(f, at), at) === f` for all generated A1 formulas.

**P8:** `shiftFormula(shiftFormula(f, {sheet, at, count: k}), {sheet, at, count: -k}) === f` (shift-then-unshift identity).

## Scope

### In scope
- `packages/core/src/formula.ts`: tokenize, toR1C1, toA1, shiftFormula, rangesIn
- Token types and helper functions for ref/range parsing
- A1 and R1C1 coordinate conversion utilities

### Out of scope (Phase 2)
- Formula evaluation or calculation (out of scope for the entire project per product.md)
- Formula validation (syntax errors are passed through as-is)
- Array formulas or dynamic arrays (treat as opaque strings)

## Dependencies

None. formula.ts is a pure module with no dependencies on read/write/model.
