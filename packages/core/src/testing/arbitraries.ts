// Shared fast-check arbitraries for property tests

import * as fc from 'fast-check';

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
