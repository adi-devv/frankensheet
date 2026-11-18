import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Book, Cell, Row } from './model.js';
import { read } from './read.js';
import { toTextconv } from './textconv.js';
import { buildMinimalXlsx } from './testing/minimalXlsx.js';

function row(...cells: Cell[]): Row {
  return { cells: new Map(cells.map((cell, index) => [index, cell])) };
}

function book(rows: Array<[number, Row]> = []): Book {
  return { sheets: [{ name: 'Sheet1', rows: new Map(rows), colCount: 30 }], names: {} };
}

describe('toTextconv', () => {
  it('sorts defined names and omits a workbook filename header', () => {
    const input = book();
    input.names = { Zebra: 'Sheet1!$B$2', Alpha: '0.15' };
    expect(toTextconv(input)).toBe('# Defined names:\nAlpha: 0.15\nZebra: Sheet1!$B$2\n\n[Sheet1]\n');
    expect(toTextconv({ sheets: [], names: {} })).toBe('');
  });

  it('preserves sheet order and prints cells in row-major numeric order', () => {
    const input = book([[9, row({ v: 'last' })], [1, row({ v: 2 }, { v: 3 })], [0, {
      cells: new Map([[26, { v: 'AA' }], [1, { v: 'B' }], [0, { v: 1 }]]),
    }]]);
    input.sheets[0]!.name = 'Zebra';
    input.sheets.push({ name: 'Alpha', rows: new Map([[0, row({ v: 7, f: 'SUM(A1:A10)' })]]), colCount: 1 });
    expect(toTextconv(input)).toBe('[Zebra]\nA1: 1\nB1: B\nAA1: AA\nA2: 2\nB2: 3\nA10: last\n\n[Alpha]\nA1: =SUM(A1:A10)\n');
  });

  it('escapes backslashes, newlines, and carriage returns without creating extra cell lines', () => {
    const input = book([[0, row({ v: 'a\\b\nc\rd' }, { v: '=literal\\n' }, { v: null, f: '"a\nb\\c\rd"' })]]);
    expect(toTextconv(input)).toBe('[Sheet1]\nA1: a\\\\b\\nc\\rd\nB1: \'=literal\\\\n\nC1: ="a\\nb\\\\c\\rd"\n');
    input.names = { 'N\n': 'A1\r\\B1' };
    input.sheets[0]!.name = 'Sheet\nName';
    expect(toTextconv(input)).toContain('N\\n: A1\\r\\\\B1\n\n[Sheet\\nName]\n');
  });

  it('omits null, empty strings, missing cells, and empty rows but retains formulas', () => {
    const input = book([[0, row({ v: 1 }, { v: null })], [1, row({ v: '' }, { v: 2 })], [2, row({ v: 3 })], [3, row()], [4, row({ v: null, f: 'A1' })]]);
    expect(toTextconv(input)).toBe('[Sheet1]\nA1: 1\nB2: 2\nA3: 3\nA5: =A1\n');
  });

  it('prints booleans, errors, numeric date serials, zero, and untrimmed strings', () => {
    expect(toTextconv(book([[0, row({ v: true }, { v: false }, { v: { error: '#REF!' } }, { v: 45292 }, { v: 0 }, { v: ' text ' })]])))
      .toBe('[Sheet1]\nA1: TRUE\nB1: FALSE\nC1: #REF!\nD1: 45292\nE1: 0\nF1:  text \n');
  });

  it('prints formulas with a leading equals sign and ignores the cached value', () => {
    const input = book([[1, row({ v: 55, f: 'SUM(A1:A10)' })]]);
    expect(toTextconv(input)).toBe('[Sheet1]\nA2: =SUM(A1:A10)\n');
    input.sheets[0]!.rows.get(1)!.cells.get(0)!.v = null;
    expect(toTextconv(input)).toBe('[Sheet1]\nA2: =SUM(A1:A10)\n');
  });

  it('reads byte-distinct workbooks with reordered shared strings and formatting identically', () => {
    const first = buildMinimalXlsx([{ name: 'Sheet1', cells: [
      { ref: 'A1', type: 's', value: 'Alpha' },
      { ref: 'B1', type: 's', value: 'Beta' },
      { ref: 'A2', formula: '1+2', value: 3 },
    ] }]);
    const entries = unzipSync(first);
    entries['xl/sharedStrings.xml'] = strToU8(strFromU8(entries['xl/sharedStrings.xml']!)
      .replace('<si><t>Alpha</t></si>', '<si><t>Beta</t></si>')
      .replace('<si><t>Beta</t></si>\n</sst>', '<si><t>Alpha</t></si>\n</sst>'));
    entries['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(entries['xl/worksheets/sheet1.xml']!)
      .replace('r="A1" t="s"><v>0</v>', 'r="A1" s="0" t="s"><v>1</v>')
      .replace('r="B1" t="s"><v>1</v>', 'r="B1" s="0" t="s"><v>0</v>'));
    const second = zipSync(Object.fromEntries(Object.entries(entries).reverse()), { level: 0 });
    expect(second).not.toEqual(first);
    expect(toTextconv(read(first))).toBe('[Sheet1]\nA1: Alpha\nB1: Beta\nA2: =1+2\n');
    expect(toTextconv(read(second))).toBe(toTextconv(read(first)));
  });

  it('reads the budget fidelity fixture into readable cell lines', () => {
    const bytes = readFileSync(new URL('../../../fixtures/fidelity/01_budget_sums.xlsx', import.meta.url));
    const text = toTextconv(read(bytes));
    expect(text).toMatch(/^\[[^\n]+\]\nA1: /);
    expect(text).toMatch(/: =SUM\(/);
    expect(text).not.toContain('# Workbook:');
  });
});
