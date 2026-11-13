---
inclusion: always
---
# Spreadsheet semantics (source of truth for "what changed")

## Cell identity
- A cell is identified by **(sheet name, aligned row key, column key)**, never by raw A1 address. Rows and columns move; identity must not.
- **Row key:**
  - In key mode: the key column's value.
  - Otherwise: the alignment pairing produced by `align.ts`.
- **Column key:** the header text if the sheet has a header row, else the column index.
- **Sheet rename:** if a sheet is renamed on one side but unchanged on the other, keep the new name. If renamed on both sides to different names, flag a conflict. Alignment matches sheets by their base name when available.

## Values
- Model types: `null | number | string | boolean | { error: string }`.
- An empty string, a missing cell and a cell with only formatting are all **empty** (`null`).
- Dates are stored as Excel serial numbers (1900 system). The date format lives in styles, not in the value.
- Rich text is flattened to plain text.
- Numbers are compared exactly (no rounding), except in the `magnitude-jump` rule.

## OOXML reading rules
- **Shared strings:** resolve indices from `xl/sharedStrings.xml` to actual strings.
- **Inline strings:** `<is><t>…</t></is>` cells are treated the same as shared-string cells.
- **Shared formulas:** `<f t="shared" ref="…" si="…">` stores one master formula; slave cells reference it by `si`. Expand all to per-cell A1 formulas on read.
- **date1904:** `<workbookPr date1904="1"/>` switches to the 1904 date system. On read, convert 1904 serials to 1900 serials. On write, preserve the original setting.
- **Defined names:** workbook-level `<definedNames>` are read into `Book.names: Record<string, string>`. They are preserved from "ours" on write and are never merged.

## Formulas
- Stored as A1 text without the leading `=`, plus a derived **R1C1-relative** form `fr`. Deriving `fr` requires the cell's `(row, col)` position: `toR1C1(f, at)`.
- Two formula cells are "the same" when their `fr` strings are equal. A reference that only shifted because rows moved is **not** a change.
- Shared formulas are expanded into per-cell formulas on read.
- Cached values of formula cells are not trusted after a merge. Writers drop them and set `fullCalcOnLoad="1"`.

## What counts as a change
| before | after | kind |
|---|---|---|
| value | different value | `value` |
| formula | different formula (`fr` differs) | `formula` |
| formula | constant (or reverse) | `both` |
| formatting only | — | **not a change** |

## 3-way merge per cell (b = base, o = ours, t = theirs)
- o == t → o
- o == b → t
- t == b → o
- otherwise → **conflict** (the merged book keeps o until resolved)

## Rows
- Deleted in one side, unchanged in the other → deleted.
- Deleted in one side, edited in the other → conflict.
- Inserted on both sides at the same anchor:
  - same content → insert once
  - different → both, ours first, flagged `rowOrder` conflict

## Out of scope (keep from "ours", never merge)
Charts, pivots, macros, conditional formats, data validation, comments, images.
