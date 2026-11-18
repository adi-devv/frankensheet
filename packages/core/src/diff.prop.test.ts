import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { apply, diff } from './diff.js';
import type { Book, Cell, Row } from './model.js';
import { arbBook, arbEditSequence, type Edit } from './testing/arbitraries.js';
import { normalizeBook } from './testing/bookEquality.js';

const numRuns = Number(process.env.FC_RUNS ?? 1000);
const options = { maxRows: 8, maxCols: 5 };

// Derive b independently of diff/apply; row edits move coordinates but not formulas.
function editBook(a: Book, edits: Edit[]): Book {
  const b = structuredClone(a);
  for (const edit of edits) {
    const sheet = b.sheets[edit.sheet % b.sheets.length]!;
    if (edit.type === 'editCell') {
      let row = sheet.rows.get(edit.row);
      if (row === undefined) {
        row = { cells: new Map<number, Cell>() };
        sheet.rows.set(edit.row, row);
      }
      if (edit.remove) row.cells.delete(edit.col);
      else row.cells.set(edit.col, { v: edit.newValue, ...(edit.formula === undefined ? {} : { f: edit.formula }) });
    } else {
      const moved: Array<[number, Row]> = [];
      for (const [index, row] of sheet.rows) {
        if (edit.type === 'insertRow') moved.push([index >= edit.at ? index + 1 : index, row]);
        else if (index < edit.at) moved.push([index, row]);
        else if (index >= edit.at + edit.count) moved.push([index - edit.count, row]);
      }
      sheet.rows = new Map(moved);
      if (edit.type === 'insertRow') sheet.rows.set(edit.at, structuredClone(edit.content));
    }
    sheet.colCount = 0;
    for (const row of sheet.rows.values()) {
      for (const col of row.cells.keys()) sheet.colCount = Math.max(sheet.colCount, col + 1);
    }
  }
  return b;
}

describe('diff/apply properties', () => {
  it('P3: apply(diff(a, b), a) equals b after random cell edits, inserts, and deletes', () => {
    fc.assert(
      fc.property(arbBook(options), arbEditSequence(options), (a, edits) => {
        const original = structuredClone(a);
        const b = editBook(a, edits);
        const target = structuredClone(b);
        const delta = diff(a, b);
        const actual = apply(delta, a);
        expect(normalizeBook(actual)).toEqual(normalizeBook(b));
        expect(a).toEqual(original);
        expect(b).toEqual(target);
        expect(apply(delta, a)).toEqual(actual);
      }),
      { numRuns },
    );
  });

  it('P3: also reconstructs independent books with sheet and workbook metadata changes', () => {
    fc.assert(
      fc.property(arbBook(options), arbBook(options), (a, b) => {
        expect(normalizeBook(apply(diff(a, b), a))).toEqual(normalizeBook(b));
      }),
      { numRuns },
    );
  });
});
