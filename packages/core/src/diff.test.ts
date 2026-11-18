import { describe, expect, it, vi } from 'vitest';
import { alignRows, apply, diff } from './diff.js';
import { toR1C1 } from './formula.js';
import type { Book, BookDiff, Cell, Row, Sheet } from './model.js';
import { normalizeBook } from './testing/bookEquality.js';

function row(...cells: Cell[]): Row {
  return { cells: new Map(cells.map((cell, col) => [col, cell])) };
}

function sheet(rows: Row[], name = 'Sheet1'): Sheet {
  return {
    name,
    rows: new Map(rows.map((value, index) => [index, value])),
    colCount: Math.max(0, ...rows.flatMap((value) => [...value.cells.keys()].map((col) => col + 1))),
  };
}

function book(...rows: Row[]): Book {
  return { sheets: [sheet(rows)], names: {} };
}

function expectRoundtrip(a: Book, b: Book): void {
  expect(normalizeBook(apply(diff(a, b), a))).toEqual(normalizeBook(b));
}

describe('alignRows', () => {
  it('pairs equal-length rows by absolute index', () => {
    const rows = book(row({ v: 1 }), row({ v: 2 })).sheets[0]!.rows;
    expect(alignRows(rows, rows).matched).toEqual([
      [rows.get(0), rows.get(0), 0, 0],
      [rows.get(1), rows.get(1), 1, 1],
    ]);
    expect(alignRows(new Map(), new Map()).matched).toEqual([]);
  });

  it('returns tail inserts and deletes', () => {
    const short = sheet([row({ v: 1 })]).rows;
    const long = sheet([row({ v: 1 }), row({ v: 2 }), row({ v: 3 })]).rows;
    expect(alignRows(short, long).matched.slice(1)).toEqual([
      [null, long.get(1), -1, 1], [null, long.get(2), -1, 2],
    ]);
    expect(alignRows(long, short).matched.slice(1)).toEqual([
      [long.get(1), null, 1, -1], [long.get(2), null, 2, -1],
    ]);
  });

  it('keeps sparse coordinates and does not allocate intervening empty rows', () => {
    const a = new Map([[1_048_575, row({ v: 1 })]]);
    const b = new Map([[0, row({ v: 2 })], [1_048_575, row({ v: 3 })]]);
    const aligned = alignRows(a, b).matched;
    expect(aligned).toHaveLength(2);
    expect(aligned[0]).toEqual([{ cells: new Map() }, b.get(0), 0, 0]);
    expect(aligned[1]?.slice(2)).toEqual([1_048_575, 1_048_575]);
  });
});

describe('diff', () => {
  it('handles empty books and sheets', () => {
    expect(diff({ sheets: [], names: {} }, { sheets: [], names: {} })).toEqual({ sheets: {} });
    expect(diff(book(), book()).sheets.Sheet1).toEqual({ rowOps: [], cellChanges: [] });
  });

  it.each([
    [{ v: 1 }, { v: 2 }, 'value'],
    [{ v: 1, f: 'B1' }, { v: 1, f: 'B1*2' }, 'formula'],
    [{ v: 1, f: 'B1' }, { v: 2, f: 'B1*2' }, 'both'],
    [{ v: 1, f: 'B1' }, { v: 2, f: 'B1' }, 'value'],
    [{ v: 1 }, { v: 1, f: 'B1' }, 'formula'],
    [{ v: 1 }, { v: 2, f: 'B1' }, 'both'],
    [{ v: 2, f: 'B1' }, { v: 1 }, 'both'],
  ] as const)('classifies %j to %j as %s', (before, after, kind) => {
    const a = book(row(before));
    const b = book(row(after));
    expect(diff(a, b).sheets.Sheet1?.cellChanges).toEqual([{ row: 0, col: 0, before, after, kind }]);
    expectRoundtrip(a, b);
  });

  it('derives relative formulas from the actual position instead of trusting fr', () => {
    expect(diff(book(row({ v: 1, f: 'B1', fr: 'stale' })), book(row({ v: 1, f: 'B1', fr: 'different' })))
      .sheets.Sheet1?.cellChanges).toEqual([]);
    expect(diff(book(row({ v: 1, f: 'B1', fr: 'same' })), book(row({ v: 1, f: 'B2', fr: 'same' })))
      .sheets.Sheet1?.cellChanges[0]?.kind).toBe('formula');
  });

  it('preserves relative logic when a formula moves from A3 to A5', () => {
    const a = book(row({ v: 1 }), row({ v: 2 }), row({ v: 3, f: 'SUM(B1:B2)' }));
    const b = book(row({ v: 1 }), row({ v: 2 }), row(), row(), row({ v: 3, f: 'SUM(B3:B4)' }));
    expect(toR1C1('SUM(B1:B2)', { row: 2, col: 0 })).toBe(toR1C1('SUM(B3:B4)', { row: 4, col: 0 }));
    // Phase 2 compares positions: the moved formula is carried by a tail insert.
    // It is not reported as a formula logic edit at its destination.
    expect(diff(a, b).sheets.Sheet1?.cellChanges.some((change) => change.row === 4)).toBe(false);
    expectRoundtrip(a, b);
  });

  it('compares errors by code and numbers with Object.is semantics', () => {
    expect(diff(book(row({ v: { error: '#REF!' } }, { v: NaN })), book(row({ v: { error: '#REF!' } }, { v: NaN })))
      .sheets.Sheet1?.cellChanges).toEqual([]);
    const before = book(row({ v: -0 }, { v: { error: '#REF!' } }));
    const after = book(row({ v: 0 }, { v: { error: '#N/A' } }));
    expect(diff(before, after).sheets.Sheet1?.cellChanges).toHaveLength(2);
    expectRoundtrip(before, after);
  });

  it.each([{ v: 3 }, { v: 3, f: 'B1' }])('adds and removes sparse cells: %j', (cell) => {
    const a = book(row());
    const b = book({ cells: new Map([[26, cell]]) });
    const kind = cell.f === undefined ? 'value' : 'formula';
    expect(diff(a, b).sheets.Sheet1?.cellChanges).toEqual([{ row: 0, col: 26, after: cell, kind }]);
    expect(diff(b, a).sheets.Sheet1?.cellChanges).toEqual([{ row: 0, col: 26, before: cell, kind }]);
    expectRoundtrip(a, b);
    expectRoundtrip(b, a);
  });

  it('inserts two tail rows and deletes multiple tail rows without index drift', () => {
    const a = book(...[1, 2, 3].map((v) => row({ v })));
    const b = book(...[1, 2, 3, 4, 5].map((v) => row({ v })));
    expect(diff(a, b).sheets.Sheet1?.rowOps.map((op) => [op.type, op.at])).toEqual([['insert', 3], ['insert', 4]]);
    expect(diff(b, a).sheets.Sheet1?.rowOps).toEqual([{ type: 'delete', at: 4 }, { type: 'delete', at: 3 }]);
    expectRoundtrip(a, b);
    expectRoundtrip(b, a);
  });

  it('detects sheet adds, removes, and renames with complete added content', () => {
    const a = book(row({ v: 1 }));
    const b: Book = { ...a, sheets: [sheet([row({ v: 2 })], 'New'), ...a.sheets] };
    expect(diff(a, b).sheets.New).toMatchObject({ sheetAdded: true, addedSheet: b.sheets[0] });
    expect(diff(b, a).sheets.New).toEqual({ sheetRemoved: true, rowOps: [], cellChanges: [] });
    expectRoundtrip(a, b);
    expectRoundtrip(b, a);
    const renamed: Book = { ...a, sheets: [{ ...a.sheets[0]!, name: 'Renamed' }] };
    expect(diff(a, renamed).sheets.Sheet1?.sheetRemoved).toBe(true);
    expect(diff(a, renamed).sheets.Renamed?.sheetAdded).toBe(true);
    expectRoundtrip(a, renamed);
  });

  it('preserves workbook order, names, date system, column counts, and special sheet names', () => {
    const a: Book = { sheets: [sheet([], '10'), sheet([], '__proto__'), sheet([], '2')], names: { Old: 'A1' }, date1904: true };
    const b: Book = { sheets: [sheet([], '2'), sheet([row({ v: 1 })], '__proto__'), { ...sheet([], '10'), colCount: 20 }], names: { New: 'B1' } };
    const changes = diff(a, b);
    expect(Object.hasOwn(changes.sheets, '__proto__')).toBe(true);
    expectRoundtrip(a, b);
    expectRoundtrip(b, a);
  });

  it('reconstructs missing interior rows, explicit empty rows, and sparse tail gaps', () => {
    const a = book(row({ v: 1 }), row({ v: 2 }), row({ v: 3 }));
    const b = book();
    b.sheets[0]!.rows = new Map([[1, row()], [8, row({ v: 5 })]]);
    b.sheets[0]!.colCount = 1;
    expectRoundtrip(a, b);
    expectRoundtrip(b, a);
    expectRoundtrip(b, book());
  });
});

describe('apply', () => {
  it('applies sequential inserts and counted deletes without shifting formulas', () => {
    const a = book(...[1, 2, 3, 4].map((v) => row({ v })));
    const delta: BookDiff = { sheets: { Sheet1: { rowOps: [
      { type: 'delete', at: 1, count: 2 },
      { type: 'insert', at: 1, content: row({ v: 10, f: 'B2' }) },
    ], cellChanges: [] } } };
    const actual = apply(delta, a);
    expect([...actual.sheets[0]!.rows].map(([index, value]) => [index, value.cells.get(0)?.v])).toEqual([[0, 1], [2, 4], [1, 10]]);
    expect(actual.sheets[0]!.rows.get(1)?.cells.get(0)?.f).toBe('B2');
    expect(a.sheets[0]!.rows.size).toBe(4);
  });

  it('recomputes signatures for changed rows deterministically', () => {
    const a = book({ ...row({ v: 1 }), sig: 'stale' }, row({ v: 2 }));
    const b = book(row({ v: 3 }), row({ v: 2 }));
    const result = apply(diff(a, b), a);
    expect(result.sheets[0]!.rows.get(0)?.sig).toBe(JSON.stringify([[0, ['number', '3'], null]]));
    expect(result.sheets[0]!.rows.get(1)?.sig).toBeUndefined();
    expect(a.sheets[0]!.rows.get(0)?.sig).toBe('stale');
  });

  it('warns about mismatched before content and overwrites with after', () => {
    const delta = diff(book(row({ v: 1 })), book(row({ v: 2 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(apply(delta, book(row({ v: 9 }))).sheets[0]!.rows.get(0)?.cells.get(0)?.v).toBe(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('before mismatch'));
    } finally {
      warn.mockRestore();
    }
  });

  it('isolates the diff, source, target, and result from subsequent mutations', () => {
    const a = book(row({ v: { error: '#REF!' } }));
    const b = book(row({ v: { error: '#N/A' } }), row({ v: 2 }));
    const originalA = structuredClone(a);
    const originalB = structuredClone(b);
    const delta = diff(a, b);
    expect(a).toEqual(originalA);
    expect(b).toEqual(originalB);
    const result = apply(delta, a);
    const value = result.sheets[0]!.rows.get(0)!.cells.get(0)!.v as { error: string };
    value.error = '#VALUE!';
    result.sheets[0]!.rows.get(1)!.cells.set(0, { v: 999 });
    expect(a).toEqual(originalA);
    expect(b).toEqual(originalB);
    expect(normalizeBook(apply(delta, a))).toEqual(normalizeBook(originalB));
  });
});
