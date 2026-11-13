// Property tests for write.ts
// Feature: io-fidelity, Property 4: normalize(read(write(book, origBytes))) == book

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { write } from './write.js';
import { read } from './read.js';
import { normalizeValue } from './normalize.js';
import { blankXlsx } from './testing/blankXlsx.js';
import { arbBook } from './testing/arbitraries.js';
import type { Book, Sheet, Cell, CellValue } from './model.js';

const numRuns = Number(process.env.FC_RUNS ?? 1000);

describe('write property tests', () => {
  it('P4: normalize(read(write(book, origBytes))) == book', () => {
    fc.assert(
      fc.property(
        arbBook({ maxRows: 10, maxCols: 6 }),
        (generatedBook) => {
          // Ensure sheets have unique names
          const book = normalizeBookForWrite(generatedBook);
          
          // Generate blank xlsx with the same sheet names
          const sheetNames = book.sheets.map((s) => s.name);
          const originalBytes = blankXlsx(sheetNames);

          // Write the book
          const writtenBytes = write(book, originalBytes);

          // Read it back
          const readBack = read(writtenBytes);

          // Normalize and compare
          const normalized = normalizeBook(readBack);
          const expected = normalizeBook(book);

          // Compare books
          compareBooks(normalized, expected);
        }
      ),
      { numRuns }
    );
  });
});

/**
 * Normalize a book for writing:
 * - Ensure sheet names are unique (Sheet1, Sheet2, ...)
 * - Filter out invalid formulas that would cause parse errors
 */
function normalizeBookForWrite(book: Book): Book {
  const sheets = book.sheets.map((sheet, i) => ({
    ...sheet,
    name: `Sheet${i + 1}`,
  }));

  // Excel cannot store an empty defined name, and the reader trims the
  // XML text, so only non-empty trimmed values can round-trip.
  const names = Object.fromEntries(
    Object.entries(book.names).filter(([, v]) => v !== '' && v.trim() === v),
  );

  // write never changes the base file's date system; blankXlsx uses 1900.
  return {
    ...book,
    sheets,
    names,
    date1904: undefined,
  };
}

/**
 * Normalize a book for comparison:
 * - Normalize all cell values
 * - For formula cells, ignore cached values (write drops them)
 * - Treat missing cells and v:null as equal
 */
function normalizeBook(book: Book): Book {
  return {
    sheets: book.sheets.map(normalizeSheet),
    names: book.names,
    date1904: book.date1904,
  };
}

function normalizeSheet(sheet: Sheet): Sheet {
  const rows = new Map();

  for (const [rowIndex, row] of sheet.rows) {
    const cells = new Map();

    for (const [colIndex, cell] of row.cells) {
      const normalized = normalizeCell(cell);
      // Only keep cells that have content (not null with no formula)
      if (normalized.v !== null || normalized.f !== undefined) {
        cells.set(colIndex, normalized);
      }
    }

    if (cells.size > 0) {
      rows.set(rowIndex, { cells });
    }
  }

  return {
    name: sheet.name,
    rows,
    colCount: sheet.colCount,
  };
}

function normalizeCell(cell: Cell): Cell {
  const normalized: Cell = {
    v: normalizeValue(cell.v),
  };

  if (cell.f !== undefined) {
    normalized.f = cell.f;
    // For formula cells, ignore cached value (write drops it)
    normalized.v = null;
  }

  if (cell.fr !== undefined) {
    normalized.fr = cell.fr;
  }

  return normalized;
}

/**
 * Compare two books, throwing if they differ
 */
function compareBooks(actual: Book, expected: Book): void {
  // Compare sheet count
  if (actual.sheets.length !== expected.sheets.length) {
    throw new Error(
      `Sheet count mismatch: expected ${expected.sheets.length}, got ${actual.sheets.length}`
    );
  }

  // Compare each sheet
  for (let i = 0; i < expected.sheets.length; i++) {
    const actualSheet = actual.sheets[i]!;
    const expectedSheet = expected.sheets[i]!;

    compareSheets(actualSheet, expectedSheet, i);
  }

  // Compare names
  compareNames(actual.names, expected.names);

  // Compare date1904 flag
  if (Boolean(actual.date1904) !== Boolean(expected.date1904)) {
    throw new Error(
      `date1904 mismatch: expected ${expected.date1904}, got ${actual.date1904}`
    );
  }
}

function compareSheets(actual: Sheet, expected: Sheet, index: number): void {
  // Compare names
  if (actual.name !== expected.name) {
    throw new Error(
      `Sheet ${index} name mismatch: expected "${expected.name}", got "${actual.name}"`
    );
  }

  // Compare row count
  if (actual.rows.size !== expected.rows.size) {
    throw new Error(
      `Sheet ${index} row count mismatch: expected ${expected.rows.size}, got ${actual.rows.size}`
    );
  }

  // Compare each row
  for (const [rowIndex, expectedRow] of expected.rows) {
    const actualRow = actual.rows.get(rowIndex);

    if (!actualRow) {
      throw new Error(
        `Sheet ${index} row ${rowIndex} missing in actual`
      );
    }

    compareCells(actualRow.cells, expectedRow.cells, index, rowIndex);
  }

  // Check for extra rows in actual
  for (const rowIndex of actual.rows.keys()) {
    if (!expected.rows.has(rowIndex)) {
      throw new Error(
        `Sheet ${index} has unexpected row ${rowIndex}`
      );
    }
  }
}

function compareCells(
  actual: Map<number, Cell>,
  expected: Map<number, Cell>,
  sheetIndex: number,
  rowIndex: number
): void {
  // Compare cell count
  if (actual.size !== expected.size) {
    throw new Error(
      `Sheet ${sheetIndex} row ${rowIndex} cell count mismatch: expected ${expected.size}, got ${actual.size}`
    );
  }

  // Compare each cell
  for (const [colIndex, expectedCell] of expected) {
    const actualCell = actual.get(colIndex);

    if (!actualCell) {
      throw new Error(
        `Sheet ${sheetIndex} row ${rowIndex} col ${colIndex} missing in actual`
      );
    }

    compareCell(actualCell, expectedCell, sheetIndex, rowIndex, colIndex);
  }

  // Check for extra cells in actual
  for (const colIndex of actual.keys()) {
    if (!expected.has(colIndex)) {
      throw new Error(
        `Sheet ${sheetIndex} row ${rowIndex} has unexpected col ${colIndex}`
      );
    }
  }
}

function compareCell(
  actual: Cell,
  expected: Cell,
  sheetIndex: number,
  rowIndex: number,
  colIndex: number
): void {
  const loc = `Sheet ${sheetIndex} row ${rowIndex} col ${colIndex}`;

  // Compare formula
  if (actual.f !== expected.f) {
    throw new Error(
      `${loc} formula mismatch: expected "${expected.f}", got "${actual.f}"`
    );
  }

  // For formula cells, don't compare values (write drops cached values)
  if (expected.f !== undefined) {
    return;
  }

  // Compare value
  if (!compareValues(actual.v, expected.v)) {
    throw new Error(
      `${loc} value mismatch: expected ${JSON.stringify(expected.v)}, got ${JSON.stringify(actual.v)}`
    );
  }
}

function compareValues(actual: CellValue, expected: CellValue): boolean {
  // null and undefined are equivalent for missing cells
  if ((actual === null || actual === undefined) && (expected === null || expected === undefined)) {
    return true;
  }

  // Direct equality for primitives
  if (typeof actual !== 'object' || typeof expected !== 'object') {
    return actual === expected;
  }

  // Both null
  if (actual === null && expected === null) {
    return true;
  }

  // One is null, other isn't
  if (actual === null || expected === null) {
    return false;
  }

  // Both are error objects
  if ('error' in actual && 'error' in expected) {
    return actual.error === expected.error;
  }

  return false;
}

function compareNames(actual: Record<string, string>, expected: Record<string, string>): void {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();

  if (actualKeys.length !== expectedKeys.length) {
    throw new Error(
      `Defined names count mismatch: expected ${expectedKeys.length}, got ${actualKeys.length}`
    );
  }

  for (let i = 0; i < expectedKeys.length; i++) {
    const key = expectedKeys[i]!;
    
    if (actual[key] !== expected[key]) {
      throw new Error(
        `Defined name "${key}" mismatch: expected "${expected[key]}", got "${actual[key]}"`
      );
    }
  }
}
