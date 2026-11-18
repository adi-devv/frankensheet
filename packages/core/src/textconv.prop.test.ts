import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { toTextconv } from './textconv.js';
import { arbBook } from './testing/arbitraries.js';
import { normalizeBook } from './testing/bookEquality.js';

const numRuns = Number(process.env.FC_RUNS ?? 1000);

describe('textconv properties', () => {
  it('is deterministic for cloned books and books equal under normalization', () => {
    fc.assert(
      fc.property(arbBook({ maxRows: 10, maxCols: 6 }), (book) => {
        const original = structuredClone(book);
        const text = toTextconv(book);
        expect(toTextconv(book)).toBe(text);
        expect(toTextconv(structuredClone(book))).toBe(text);
        expect(toTextconv(normalizeBook(book))).toBe(text);
        const reordered = structuredClone(book);
        reordered.names = Object.fromEntries(Object.entries(reordered.names).reverse());
        for (const sheet of reordered.sheets) {
          sheet.rows = new Map([...sheet.rows].reverse());
          for (const row of sheet.rows.values()) row.cells = new Map([...row.cells].reverse());
        }
        expect(normalizeBook(reordered)).toEqual(normalizeBook(book));
        expect(toTextconv(reordered)).toBe(text);
        expect(book).toEqual(original);
      }),
      { numRuns },
    );
  });
});
