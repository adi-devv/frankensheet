// Expected values were derived from the original fixture XML and make_fixtures.py,
// independently of read()/write(): move original rows >= 3 by two, then apply the
// spike's literal edits. Rows contain values only; formula caches are not trusted.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import type { Book, Cell, CellValue } from './model.js';
import { read, parseWorkbook, parseWorkbookRels } from './read.js';
import {
  write,
  insertRows,
  shiftOtherSheetFormulas,
  shiftDefinedNames,
  shiftChartFormulas,
  setFullCalcOnLoad,
  removeCalcChain,
  checkXmlWellFormed,
} from './write.js';

interface ExpectedBook {
  sheets: Array<{ name: string; rows: Record<string, CellValue[]> }>;
  names: Record<string, string>;
}

function cellValues(book: Book): ExpectedBook {
  return {
    sheets: book.sheets.map((sheet) => {
      const rows: Record<string, CellValue[]> = {};
      for (const [rowIndex, row] of sheet.rows) {
        const values: CellValue[] = [];
        for (const [colIndex, cell] of row.cells) {
          if (cell.v === null) continue;
          while (values.length <= colIndex) values.push(null);
          values[colIndex] = cell.v;
        }
        if (values.length > 0) rows[String(rowIndex + 1)] = values;
      }
      return { name: sheet.name, rows };
    }),
    names: book.names,
  };
}

describe('write fidelity fixtures with the Plan B spike edits', () => {
  const fixtures = [
    '01_budget_sums',
    '02_merged_cells_styles',
    '03_shared_formulas_names',
    '04_chart_condformat',
    '05_large_5k_rows',
  ];

  it.each(fixtures)('%s preserves values and produces well-formed XML', (fixture) => {
    const fixtureUrl = new URL(`../../../fixtures/fidelity/${fixture}`, import.meta.url);
    const original = new Uint8Array(readFileSync(new URL(`${fixtureUrl.href}.xlsx`)));
    const expected = JSON.parse(readFileSync(new URL(`${fixtureUrl.href}.expected.json`), 'utf8')) as ExpectedBook;
    const originalBook = read(original);
    const entries = unzipSync(original);
    const workbookXml = strFromU8(entries['xl/workbook.xml']!);
    const sheets = parseWorkbook(workbookXml);
    const relationships = parseWorkbookRels(strFromU8(entries['xl/_rels/workbook.xml.rels']!));
    const first = sheets[0]!;
    const sheetName = originalBook.sheets[0]!.name;
    const target = relationships.get(first.rId)!;
    const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;

    // Row insertion is an explicit XML operation. Use the result as write()'s
    // structural base so styles, merges, CF and cross-part refs move together.
    entries[sheetPath] = strToU8(insertRows(strFromU8(entries[sheetPath]!), sheetName, 3, 2));
    for (const path of Object.keys(entries)) {
      if (path.startsWith('xl/worksheets/') && path.endsWith('.xml') && path !== sheetPath) {
        entries[path] = strToU8(shiftOtherSheetFormulas(strFromU8(entries[path]!), sheetName, 3, 2));
      }
      if (path.startsWith('xl/charts/') && path.endsWith('.xml')) {
        entries[path] = strToU8(shiftChartFormulas(strFromU8(entries[path]!), sheetName, 3, 2));
      }
    }
    entries['xl/workbook.xml'] = strToU8(setFullCalcOnLoad(shiftDefinedNames(workbookXml, sheetName, 3, 2)));
    removeCalcChain(entries);
    const structuralBase = zipSync(entries);
    const book = read(structuralBase);
    const sheet = book.sheets[0]!;
    const set = (row: number, col: number, cell: Cell): void => {
      if (!sheet.rows.has(row - 1)) sheet.rows.set(row - 1, { cells: new Map() });
      sheet.rows.get(row - 1)!.cells.set(col - 1, cell);
    };
    set(2, 2, { v: 'SPIKE-B-CHANGED' });
    set(2, 3, { v: 42 });
    set(7, 5, { v: 999 }); // Original E5 shifted to E7 by the insertion.
    set(3, 1, { v: 'INSERTED-1' });
    set(4, 1, { v: 'INSERTED-2' });
    set(3, 2, { v: 100 });
    set(4, 2, { v: 200 });

    const output = write(book, structuralBase);
    const outputEntries = unzipSync(output);
    for (const [path, bytes] of Object.entries(outputEntries)) {
      if (path.endsWith('.xml') || path.endsWith('.rels')) {
        checkXmlWellFormed(strFromU8(bytes), path);
      }
    }
    expect(cellValues(read(output))).toEqual(expected);
    expect(strFromU8(outputEntries['xl/workbook.xml']!)).toContain('fullCalcOnLoad="1"');
    expect(outputEntries['xl/calcChain.xml']).toBeUndefined();
    const sheetXml = strFromU8(outputEntries[sheetPath]!);
    for (const cell of sheetXml.matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/g)) {
      if (/<f\b/.test(cell[0])) expect(cell[0]).not.toContain('<v>');
    }

    if (fixture === '01_budget_sums') {
      expect(sheetXml).toContain('<f>SUM(B5:E5)</f>');
      expect(sheetXml).toContain('<f>SUM(F2:F9)</f>');
    } else if (fixture === '02_merged_cells_styles') {
      expect(sheetXml).toContain('<mergeCell ref="A1:G1"/>');
      expect(sheetXml).toContain('<f>(F6-D6)/D6</f>');
    } else if (fixture === '03_shared_formulas_names') {
      // The insertion is on Rates; the shared formula group on Invoices survives.
      expect(strFromU8(outputEntries['xl/worksheets/sheet2.xml']!)).toContain('<f t="shared" ref="E2:E11" si="0">');
      expect(sheetXml).toContain('<f>Invoices!E12</f>');
    } else if (fixture === '04_chart_condformat') {
      expect(sheetXml).toContain('sqref="E2:E15"');
      expect(strFromU8(outputEntries['xl/charts/chart1.xml']!)).toContain('Sales!$B$2:$B$15');
    } else {
      expect(sheetXml).toContain('<f>G2+F5-E5</f>');
      expect(strFromU8(outputEntries['xl/worksheets/sheet2.xml']!)).toContain('<f>Transactions!G5003</f>');
    }
  });
});
