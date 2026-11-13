import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { read } from './read.js';
import { buildMinimalXlsx, type MinimalSheetData } from './testing/minimalXlsx.js';

const numRuns = Number(process.env.FC_RUNS ?? 1000);

// Arbitrary for cell references (A1 to Z30)
function arbCellRef(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.integer({ min: 0, max: 25 }), // col A-Z
      fc.integer({ min: 1, max: 30 }), // row 1-30
    )
    .map(([col, row]) => {
      const colStr = String.fromCharCode(65 + col);
      return `${colStr}${row}`;
    });
}

// Arbitrary for cell values
function arbCellValue(): fc.Arbitrary<{ value: string | number | boolean; type: 's' | 'n' | 'b' | 'e' | 'inlineStr' }> {
  return fc.oneof(
    fc.record({ value: fc.double({ noNaN: true, min: -1e6, max: 1e6 }), type: fc.constant('n' as const) }),
    fc.record({ value: fc.string({ maxLength: 50 }), type: fc.constant('s' as const) }),
    fc.record({ value: fc.boolean(), type: fc.constant('b' as const) }),
    fc.record({ value: fc.constantFrom('#REF!', '#DIV/0!', '#VALUE!'), type: fc.constant('e' as const) }),
    fc.record({ value: fc.string({ maxLength: 20 }), type: fc.constant('inlineStr' as const) }),
  );
}

// Arbitrary for minimal cells
function arbCell(): fc.Arbitrary<{ ref: string; value: string | number | boolean; type: 's' | 'n' | 'b' | 'e' | 'inlineStr' }> {
  return fc.record({
    ref: arbCellRef(),
    value: arbCellValue().map((cv) => cv.value),
    type: arbCellValue().map((cv) => cv.type),
  });
}

// Arbitrary for sheets
function arbSheet(): fc.Arbitrary<MinimalSheetData> {
  return fc.record({
    name: fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,10}$/),
    cells: fc.array(arbCell(), { maxLength: 20 }),
  });
}

// Arbitrary for small books
function arbBook(): fc.Arbitrary<MinimalSheetData[]> {
  return fc.array(arbSheet(), { minLength: 1, maxLength: 3 });
}

describe('read properties', () => {
  it('should return a valid Book structure for any generated workbook', () => {
    fc.assert(
      fc.property(arbBook(), (sheets) => {
        const xlsx = buildMinimalXlsx(sheets);
        const book = read(xlsx);

        // Structure checks
        if (book.sheets.length !== sheets.length) return false;

        for (const sheet of book.sheets) {
          // No undefined holes in rows map
          for (const [rowIdx, row] of sheet.rows) {
            if (rowIdx < 0) return false;
            if (row.cells === undefined) return false;

            // No undefined holes in cells map
            for (const [colIdx, cell] of row.cells) {
              if (colIdx < 0) return false;
              if (cell === undefined) return false;
              if (colIdx >= sheet.colCount) return false; // Cell col must be within colCount
            }
          }

          // colCount should match or exceed max cell index
          let maxCol = -1;
          for (const row of sheet.rows.values()) {
            for (const colIdx of row.cells.keys()) {
              maxCol = Math.max(maxCol, colIdx);
            }
          }
          if (maxCol >= 0 && sheet.colCount <= maxCol) return false;
        }

        return true;
      }),
      { numRuns },
    );
  });

  it('should never have empty rows (all rows must have at least one cell)', () => {
    fc.assert(
      fc.property(arbBook(), (sheets) => {
        const xlsx = buildMinimalXlsx(sheets);
        const book = read(xlsx);

        for (const sheet of book.sheets) {
          for (const row of sheet.rows.values()) {
            if (row.cells.size === 0) return false;
          }
        }

        return true;
      }),
      { numRuns },
    );
  });

  it('should preserve sheet names', () => {
    fc.assert(
      fc.property(arbBook(), (sheets) => {
        const xlsx = buildMinimalXlsx(sheets);
        const book = read(xlsx);

        for (let i = 0; i < sheets.length; i++) {
          if (book.sheets[i]?.name !== sheets[i]?.name) return false;
        }

        return true;
      }),
      { numRuns },
    );
  });
});
