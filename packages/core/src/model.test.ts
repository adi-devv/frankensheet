import { describe, it, expect } from 'vitest';
import type { CellValue, Cell, Row, Sheet, Book } from './model.js';

describe('model types', () => {
  it('should allow null cell value', () => {
    const value: CellValue = null;
    expect(value).toBeNull();
  });

  it('should allow number cell value', () => {
    const value: CellValue = 42;
    expect(value).toBe(42);
  });

  it('should allow string cell value', () => {
    const value: CellValue = 'hello';
    expect(value).toBe('hello');
  });

  it('should allow boolean cell value', () => {
    const value: CellValue = true;
    expect(value).toBe(true);
  });

  it('should allow error cell value', () => {
    const value: CellValue = { error: '#REF!' };
    expect(value).toEqual({ error: '#REF!' });
  });

  it('should create a cell with value only', () => {
    const cell: Cell = { v: 123 };
    expect(cell.v).toBe(123);
    expect(cell.f).toBeUndefined();
  });

  it('should create a cell with formula', () => {
    const cell: Cell = { v: 10, f: 'A1+B1', fr: 'RC[-2]+RC[-1]' };
    expect(cell.v).toBe(10);
    expect(cell.f).toBe('A1+B1');
    expect(cell.fr).toBe('RC[-2]+RC[-1]');
  });

  it('should create a row with sparse cells', () => {
    const row: Row = {
      cells: new Map([
        [0, { v: 'A' }],
        [2, { v: 'C' }],
      ]),
    };
    expect(row.cells.size).toBe(2);
    expect(row.cells.get(0)?.v).toBe('A');
    expect(row.cells.get(1)).toBeUndefined();
    expect(row.cells.get(2)?.v).toBe('C');
  });

  it('should create a sheet with metadata', () => {
    const sheet: Sheet = {
      name: 'Sheet1',
      rows: new Map([[0, { cells: new Map([[0, { v: 1 }]]) }]]),
      colCount: 5,
    };
    expect(sheet.name).toBe('Sheet1');
    expect(sheet.rows.size).toBe(1);
    expect(sheet.colCount).toBe(5);
  });

  it('should create a book with sheets and names', () => {
    const book: Book = {
      sheets: [
        {
          name: 'Sheet1',
          rows: new Map(),
          colCount: 0,
        },
      ],
      names: {
        TaxRate: '0.15',
        DataRange: 'Sheet1!$A$1:$C$10',
      },
      date1904: false,
    };
    expect(book.sheets.length).toBe(1);
    expect(book.names.TaxRate).toBe('0.15');
    expect(book.date1904).toBe(false);
  });
});
