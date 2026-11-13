# io-fidelity requirements

## User stories (EARS)

**US-1:** WHEN a user runs `fsheet` on any .xlsx file, the system SHALL read the file into the Book model without data loss.

**US-2:** WHEN the system reads a .xlsx file containing shared formulas, the system SHALL expand each shared formula into a per-cell A1 formula.

**US-3:** WHEN the system reads a .xlsx file with a date1904 system, the system SHALL convert all date serials to 1900-based serials.

**US-4:** WHEN the system writes a merged Book back to .xlsx, the system SHALL preserve all parts not modified by the merge (charts, pivots, macros, conditional formats, data validation, comments, images).

**US-5:** WHEN the system writes a merged Book, the system SHALL set `fullCalcOnLoad="1"` and drop cached values of formula cells.

**US-6:** WHEN the system writes a Book, the resulting .xlsx SHALL open in Excel and LibreOffice without a repair prompt.

**US-7:** WHEN a user modifies cells through a merge, the system SHALL keep all formatting and styles from the "ours" file.

**US-8:** WHERE possible, the system SHALL preserve the byte-level structure of unmodified XML parts.

## Acceptance criteria

**AC-1.1:** `read(bytes)` returns a Book with all sheets, rows, cells, and defined names matching the input file's data.

**AC-1.2:** Empty cells, cells with empty strings, and cells with only formatting all map to `v: null`.

**AC-1.3:** Boolean cells map to `v: boolean`. Error cells map to `v: { error: "#REF!" | "#DIV/0!" | ... }`.

**AC-1.4:** Dates stored as Excel serials remain numeric. Rich text is flattened to plain text.

**AC-2.1:** Shared formulas (`<f t="shared" ref="..." si="...">`) produce one `Cell.f` (A1 text) per covered cell.

**AC-2.2:** Slave cells referencing a shared formula by `si` expand to their per-cell A1 equivalent.

**AC-3.1:** If `<workbookPr date1904="1"/>`, parse `xl/styles.xml` cellXfs → numFmtId. A cell is a date if its numFmtId is a built-in date id (14–22, 45–47) or a custom numFmt whose code has d/m/y/h/s outside quotes and brackets. Convert only those date cells from 1904 to 1900 serials on read.

**AC-3.2:** Store `Book.date1904 = true` when detected. The original date system setting is preserved in the written file.

**AC-4.1:** `write(book, originalBytes)` keeps all entries under `xl/charts/`, `xl/pivotTables/`, `xl/drawings/`, `vbaProject.bin` byte-identical to `originalBytes`.

**AC-4.2:** Parts for conditional formatting, data validation, comments, and images remain unchanged if not part of the merge.

**AC-5.1:** `write(book, originalBytes)` sets `<calcPr fullCalcOnLoad="1"/>` in `xl/workbook.xml`.

**AC-5.2:** All `<c>` tags containing `<f>` have their `<v>` child removed.

**AC-5.3:** `xl/calcChain.xml` is removed and its Content-Type and relationship entries are deleted.

**AC-6.1:** The written file passes `checkXmlWellFormed` for all modified XML parts.

**AC-6.2:** Opening the file in Excel (COM test) or LibreOffice (headless convert) exits without error or repair.

**AC-7.1:** All `<c>` tags retain their `s=` attribute from "ours" when cells are updated.

**AC-7.2:** Style parts (`xl/styles.xml`, `xl/theme/`) are copied from "ours" unchanged.

**AC-8.1:** If a sheet is not modified by the merge, its XML part remains byte-identical to "ours".

**AC-8.2:** Shared strings pool may reorder; this is acceptable. Order-independent comparison is used in tests.

## Property P4

**P4:** `normalize(read(write(book, origBytes))) == book`

Where `normalize` accounts for:
- Shared-string pool reordering (compare by set, not sequence)
- Cached value removal (ignore cached `<v>` in comparison)
- Attribute order changes (parse and compare semantically, not as strings)
- Shared formula expansion (compare expanded per-cell formulas)

## Scope

### In scope
- `packages/core/src/model.ts`: Book, Sheet, Row, Cell types with defined names. Add `Book.date1904?: boolean`.
- `packages/core/src/read.ts`: .xlsx bytes → Book via fflate + XML scanner
- `packages/core/src/write.ts`: Book + original bytes → .xlsx bytes via fflate XML patching
- `packages/core/src/normalize.ts`: value normalization per spreadsheet-semantics.md

### Out of scope (Phase 2)
- Formula tokenization (covered in formula-refs spec)
- Diff and merge operations (covered in diff and three-way-merge specs)
- Row alignment (Phase 3)

## Dependencies

- fflate: zip/unzip
- formula.ts (Phase 2): needed by write.ts for formula shifting, but io-fidelity read path is independent
