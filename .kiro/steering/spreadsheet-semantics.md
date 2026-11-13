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

## Values
- Model types: `null | number | string | boolean | { error: string }`.
- An empty string, a missing cell and a cell with only formatting are all **empty** (`null`).
- Dates are stored as Excel serial numbers (1900 system). The date format lives in styles, not in the value.
- Rich text is flattened to plain text.
- Numbers are compared exactly (no rounding), except in the `magnitude-jump` rule.

## Formulas
- Stored as A1 text without the leading `=`, plus a derived **R1C1-relative** form `fr`.
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
