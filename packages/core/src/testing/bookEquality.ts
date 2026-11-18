// Canonical semantic model for diff/textconv assertions. Derived caches are ignored.

import type { Book } from '../model.js';
import { normalizeValue } from '../normalize.js';

export function normalizeBook(book: Book): Book {
  return {
    sheets: book.sheets.map((sheet) => ({
      name: sheet.name,
      colCount: sheet.colCount,
      rows: new Map([...sheet.rows].sort(([a], [b]) => a - b).map(([index, row]) => [index, {
        cells: new Map([...row.cells].sort(([a], [b]) => a - b).map(([col, cell]) => [col, {
          v: normalizeValue(cell.v),
          ...(cell.f === undefined ? {} : { f: cell.f }),
        }])),
      }])),
    })),
    names: Object.fromEntries(Object.entries(book.names).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    date1904: book.date1904,
  };
}
