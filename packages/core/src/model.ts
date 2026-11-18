// Core data model for Excel workbooks: Book, Sheet, Row, Cell
// All coordinates are zero-indexed (row 0 = Excel row 1, col 0 = Excel col A)

/**
 * Cell value types following spreadsheet-semantics.md:
 * - null: empty cell (no value, empty string, or formatting only)
 * - number: numeric value (including Excel date serials in 1900 system)
 * - string: text value (rich text is flattened to plain text)
 * - boolean: TRUE or FALSE
 * - error: Excel error value like #REF!, #DIV/0!, etc.
 */
export type CellValue =
  | null
  | number
  | string
  | boolean
  | { error: string };

/**
 * A single cell with optional formula and derived R1C1 form.
 * - v: normalized cell value
 * - f: formula in A1 notation (no leading "="), if present
 * - fr: formula in R1C1-relative notation (derived from f + position)
 */
export interface Cell {
  v: CellValue;
  f?: string;  // A1 formula (no leading =)
  fr?: string; // R1C1 formula (for comparison)
}

/**
 * A row of cells indexed by zero-based column number.
 * Sparse map: only populated cells are stored.
 */
export interface Row {
  cells: Map<number, Cell>;
  /** Derived signature of the row's values and relative formulas. */
  sig?: string;
}

/**
 * A worksheet with rows and metadata.
 * - name: sheet name
 * - rows: sparse map of rows by zero-based row number
 * - colCount: maximum column index + 1 (for consistency checks)
 */
export interface Sheet {
  name: string;
  rows: Map<number, Row>;
  colCount: number;
}

/**
 * A workbook with sheets and defined names.
 * - sheets: ordered array of sheets
 * - names: defined names (workbook-level named ranges/formulas)
 * - date1904: true if the workbook uses the 1904 date system (Mac legacy)
 */
export interface Book {
  sheets: Sheet[];
  names: Record<string, string>;
  date1904?: boolean;
}

/** Row coordinates refer to the sheet state at the time the op is applied. */
export interface RowOp {
  type: 'insert' | 'delete';
  at: number;
  count?: number;
  content?: Row;
}

export interface CellChange {
  row: number;
  col: number;
  before?: Cell;
  after?: Cell;
  kind: 'value' | 'formula' | 'both';
}

export interface SheetDiff {
  rowOps: RowOp[];
  cellChanges: CellChange[];
  sheetAdded?: true;
  sheetRemoved?: true;
  addedSheet?: Sheet;
  /** Target metadata and sparse row shape, when changed. */
  colCount?: number;
  rowIndices?: number[];
}

export interface BookDiff {
  sheets: Record<string, SheetDiff>;
  /** Target workbook metadata, when changed. */
  sheetOrder?: string[];
  names?: Record<string, string>;
  date1904?: boolean;
}
