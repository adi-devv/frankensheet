# Phase 1 fidelity spike: writer strategy decision

**Decision:** Plan B (fflate patch-in-place). Verified on 5 fixtures with real Excel 16.

## Overview
Two writer strategies were spiked:
- **Plan A:** ExcelJS read → modify → write (full rewrite)
- **Plan B:** fflate unzip → patch XML → zip (targeted patching)

Test edits per fixture: change B2 (value), C2 (formula→constant), E5 (value), insert 2 rows at row 3, set A3:B4 to mark the insert. Outputs validated by COM-opening in Excel 16 (repair dialog = fail) and XML diff inspection (shifting correctness).

## Spike method
1. Read fixture with both plans
2. Apply identical edits
3. Open in Excel 16 (Windows COM automation)
4. Inspect raw XML for formula/ref shifts, byte preservation
5. Document bugs found during the spike and fixes applied

## Results

| Fixture                   | Plan A opens clean | Plan A data correct | Plan A bytes preserved | Plan B opens clean | Plan B data correct | Plan B bytes preserved |
|---------------------------|---------------------|----------------------|-------------------------|---------------------|----------------------|-------------------------|
| 01_budget_sums            | ✅                  | ❌ (formulas)        | ❌ (full rewrite)       | ✅                  | ✅                   | ✅ (8/9 parts)          |
| 02_merged_cells_styles    | ✅                  | ❌ (formulas)        | ❌ (full rewrite)       | ✅                  | ✅                   | ✅ (similar)            |
| 03_shared_formulas_names  | ✅                  | ❌ (formulas)        | ❌ (full rewrite)       | ✅                  | ✅                   | ✅ (names shifted)      |
| 04_chart_condformat       | ❌ (crash)          | —                    | —                       | ✅                  | ✅                   | ✅ (12/14 parts)        |
| 05_large_5k_rows          | ✅                  | ❌ (formulas)        | ❌ (full rewrite)       | ✅                  | ✅                   | ✅ (formulas shifted)   |

**Plan A failures:**
- Crash reading 04 (charts not supported by ExcelJS)
- Silent data corruption: neither `insertRows` nor `spliceRows` shifts formulas below the insert (F5 kept `SUM(B3:E3)`, expected `SUM(B5:E5)`)
- Defined name came out empty on 03
- Full rewrite prevents byte-level preservation of charts, pivots, macros, CF

**Plan B bugs found & fixed during spike:**
- `_rels/workbook.xml.rels` attribute order assumption
- Malformed `<calcPr>` (fixed regex)
- Template literal injection in `<is><t>` (now uses `xmlEscape`)
- Lost `s=` style attribute on cell update
- Missing `<row>` tag for newly inserted rows
- Double-shift of formula refs (single-pass replace fixed)
- Shifting refs in other sheets when it should only shift qualified refs to target sheet
- Qualified refs with a `$` column and a range end were not matched (`Rates!$A$2:$B$6` stayed put; now becomes `Rates!$A$2:$B$8`)

## Decision + rationale
**Plan B** for `packages/core` write path.

1. **Correctness:** Plan A silently corrupts formula refs on row insert (even with `spliceRows`). Plan B correctly shifts refs in same-sheet formulas (unqualified + qualified), other sheets (only qualified), defined names, charts, conditional formats, data validation, hyperlinks, dimension, and merges.
2. **Fidelity:** Plan A crashes on charts. Plan B preserves charts, pivots, macros, and all binary parts untouched (only changed XML parts rewritten).
3. **Excel compatibility:** All 5 Plan B outputs open clean with no repair prompt.
4. **Principle alignment:** "Never corrupt a workbook" (product.md). Plan A violates this; Plan B upholds it.

Reading may also use fflate + lightweight SAX/regex parser for speed and control.

## Writer design
Pure functions per XML part, composed into a single `write(book, originalBytes)` pipeline:

- **Reference shifting:** `shiftRef(ref, at, count)`, `shiftRange(range, at, count)`, `shiftFormula(formula, sheetName, at, count, mode: 'same-sheet' | 'other-sheet')`
- **Cell operations:** `setCell(sheetXml, ref, value)`, `deleteCell(sheetXml, ref)`
- **Row operations:** `insertRows(sheetXml, sheetName, at, count)`, `deleteRows(sheetXml, at, count)`
- **Global shifts:** `shiftDefinedNames(wbXml, sheetName, at, count)`, `shiftChartFormulas(chartXml, sheetName, at, count)`, `shiftOtherSheetFormulas(sheetXml, sheetName, at, count)`
- **Post-merge housekeeping:** `dropCachedValues(sheetXml)`, `setFullCalcOnLoad(wbXml)`, `removeCalcChain(entries)`
- **Well-formedness:** `checkXmlWellFormed(xml, path)` called on every modified part before zipping

All functions are pure string→string transforms. The writer zips the modified `entries` map with fflate level 6.

## Risks & open items

**Shared formulas spanning the insert point:**  
Not handled yet. Plan: expand all shared formulas to per-cell on read (see spreadsheet-semantics.md "Shared formulas are expanded into per-cell formulas on read"). Write path never writes shared formulas.

**Tables & pivots:**  
Out of scope for merge (kept from "ours" untouched per product.md). Shifting table/pivot ranges on insert is not implemented. Add to risks scan.

**Column insert:**  
Not implemented. Detect and warn only (product.md non-goals).

**R1C1 not needed for writing:**  
Formulas are stored as A1. R1C1-relative form `fr` is derived on read for diff comparison only (spreadsheet-semantics.md "Formulas"). Write path operates on A1 strings with regex-based ref shifting.

**Whole-column refs (A:A, $A:$Z):**  
Not shifted on row insert. This is correct per Excel semantics (column refs don't have row components).

**Cross-sheet refs to other sheets:**  
Correctly left alone (only refs qualified with the target sheet are shifted in other sheets and defined names).

## Correctness properties
Linked to `.kiro/steering/testing.md`:

**P1: shift-then-unshift identity**  
`insertRows(insertRows(xml, name, at, k), name, at, -k) == xml` (within formula/ref normalization). Verifies no spurious edits.

**P2: write→read roundtrip**  
`normalize(read(write(book, origBytes))) == book`. Verifies no data loss. "normalize" accounts for shared-string pool reordering, cached value removal, and attribute order changes.

**P3: ref-shift correctness**  
For all refs in formulas, dimension, merges, CF, DV, hyperlinks: `rowOf(shiftRef(r, at, k)) == rowOf(r) + k` when `rowOf(r) >= at`, else `rowOf(r)` unchanged. Verifies arithmetic correctness of shifts.

**P4: XML well-formedness**  
`checkXmlWellFormed(xml, path)` passes for all modified parts. Verifies no malformed XML that would trigger repair prompts.
