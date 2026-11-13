// Shared fast-check arbitraries for property tests

import * as fc from 'fast-check';
import type { CellValue, Cell, Row, Sheet, Book } from '../model.js';
import { toR1C1 } from '../formula.js';

/**
 * Generate a valid cell reference (A1 notation).
 * Includes relative, absolute, and mixed references.
 */
export function arbCellRef(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.boolean(), // col absolute
      fc.integer({ min: 0, max: 25 }), // col (A-Z)
      fc.boolean(), // row absolute
      fc.integer({ min: 1, max: 100 }), // row (1-100)
    )
    .map(([colAbs, col, rowAbs, row]) => {
      const colStr = String.fromCharCode(65 + col); // A-Z
      const colPart = colAbs ? `$${colStr}` : colStr;
      const rowPart = rowAbs ? `$${row}` : `${row}`;
      return `${colPart}${rowPart}`;
    });
}

/**
 * Generate a valid range reference (A1:B2 notation).
 * Ensures start <= end (Excel never stores reversed ranges).
 */
export function arbRange(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.boolean(), // startColAbs
      fc.integer({ min: 0, max: 25 }), // startCol
      fc.boolean(), // startRowAbs
      fc.integer({ min: 1, max: 100 }), // startRow
      fc.boolean(), // endColAbs
      fc.integer({ min: 0, max: 25 }), // endCol
      fc.boolean(), // endRowAbs
      fc.integer({ min: 1, max: 100 }), // endRow
    )
    .map(([startColAbs, startCol, startRowAbs, startRow, endColAbs, endCol, endRowAbs, endRow]) => {
      // Ensure start <= end
      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);
      const minCol = Math.min(startCol, endCol);
      const maxCol = Math.max(startCol, endCol);

      const startColStr = String.fromCharCode(65 + minCol);
      const startColPart = startColAbs ? `$${startColStr}` : startColStr;
      const startRowPart = startRowAbs ? `$${minRow}` : `${minRow}`;
      const startRef = `${startColPart}${startRowPart}`;

      const endColStr = String.fromCharCode(65 + maxCol);
      const endColPart = endColAbs ? `$${endColStr}` : endColStr;
      const endRowPart = endRowAbs ? `$${maxRow}` : `${maxRow}`;
      const endRef = `${endColPart}${endRowPart}`;

      return `${startRef}:${endRef}`;
    });
}

/**
 * Generate a sheet name (simple, no spaces).
 */
export function arbSheetName(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,10}$/);
}

/**
 * Generate a sheet-qualified ref (Sheet1!A1).
 */
export function arbSheetRef(): fc.Arbitrary<string> {
  return fc.tuple(arbSheetName(), arbCellRef()).map(([sheet, ref]) => `${sheet}!${ref}`);
}

/**
 * Generate a simple A1 formula with refs and ranges.
 * Examples: "A1", "A1+B1", "SUM(A1:A10)", "Sheet1!A1*2"
 */
export function arbFormula(): fc.Arbitrary<string> {
  const arbSimpleRef = fc.oneof(arbCellRef(), arbRange(), arbSheetRef());

  const arbBinaryOp = fc.constantFrom('+', '-', '*', '/', '^', '&');

  const arbSimpleExpr = fc.oneof(
    arbSimpleRef,
    fc
      .tuple(arbSimpleRef, arbBinaryOp, arbSimpleRef)
      .map(([a, op, b]) => `${a}${op}${b}`),
  );

  const arbFunctionCall = fc
    .tuple(fc.constantFrom('SUM', 'AVERAGE', 'COUNT', 'IF'), arbSimpleRef)
    .map(([fn, arg]) => `${fn}(${arg})`);

  return fc.oneof(arbSimpleExpr, arbFunctionCall);
}

/**
 * Generate a position (row, col) for formula conversion.
 */
export function arbPosition(): fc.Arbitrary<{ row: number; col: number }> {
  return fc.record({
    row: fc.integer({ min: 0, max: 99 }),
    col: fc.integer({ min: 0, max: 25 }),
  });
}

/**
 * Generate a cell value: null, number, string, boolean, or error.
 */
export function arbCellValue(): fc.Arbitrary<CellValue> {
  return fc.oneof(
    fc.constant(null),
    fc.double({ min: -1e6, max: 1e6, noNaN: true }),
    fc.string({ maxLength: 50 }),
    fc.boolean(),
    fc.record({
      error: fc.constantFrom('#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NULL!'),
    }),
  );
}

/**
 * Generate a cell with optional formula.
 * Small probability of having a formula.
 */
export function arbCell(): fc.Arbitrary<Cell> {
  return fc.oneof(
    // 70% chance: cell with value only
    fc.record({
      v: arbCellValue(),
    }),
    // 30% chance: cell with formula (and derived R1C1 form)
    fc
      .tuple(arbFormula(), arbPosition(), arbCellValue())
      .map(([formula, pos, value]) => ({
        v: value,
        f: formula,
        fr: toR1C1(formula, pos),
      })),
  );
}

/**
 * Generate a row with sparse cells.
 * @param maxCols Maximum number of columns (default 8)
 */
export function arbRow(maxCols = 8): fc.Arbitrary<Row> {
  return fc
    .array(
      fc.tuple(fc.integer({ min: 0, max: maxCols - 1 }), arbCell()),
      { maxLength: maxCols },
    )
    .map((entries) => {
      const cells = new Map<number, Cell>();
      for (const [col, cell] of entries) {
        cells.set(col, cell);
      }
      return { cells };
    });
}

/**
 * Generate a sheet with sparse rows and cells.
 * @param options.maxRows Maximum number of rows (default 30)
 * @param options.maxCols Maximum number of columns (default 8)
 */
export function arbSheet(options?: { maxRows?: number; maxCols?: number }): fc.Arbitrary<Sheet> {
  const maxRows = options?.maxRows ?? 30;
  const maxCols = options?.maxCols ?? 8;

  return fc
    .tuple(
      arbSheetName(),
      fc.array(
        fc.tuple(fc.integer({ min: 0, max: maxRows - 1 }), arbRow(maxCols)),
        { maxLength: maxRows },
      ),
    )
    .map(([name, rowEntries]) => {
      const rows = new Map<number, Row>();
      let maxCol = 0;

      for (const [rowIndex, row] of rowEntries) {
        rows.set(rowIndex, row);
        for (const colIndex of row.cells.keys()) {
          maxCol = Math.max(maxCol, colIndex);
        }
      }

      return {
        name,
        rows,
        colCount: maxCol + 1,
      };
    });
}

/**
 * Generate a book with 1-3 sheets and optional defined names.
 * @param options.maxRows Maximum rows per sheet (default 30)
 * @param options.maxCols Maximum columns per sheet (default 8)
 */
export function arbBook(options?: { maxRows?: number; maxCols?: number }): fc.Arbitrary<Book> {
  return fc
    .tuple(
      fc.array(arbSheet(options), { minLength: 1, maxLength: 3 }),
      fc.option(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[A-Za-z_]/.test(s)),
          fc.oneof(fc.string({ maxLength: 50 }), arbCellRef(), arbRange()),
        ),
        { nil: undefined },
      ),
      fc.option(fc.boolean(), { nil: undefined }),
    )
    .map(([sheets, names, date1904]) => ({
      sheets,
      names: names ?? {},
      date1904,
    }));
}
