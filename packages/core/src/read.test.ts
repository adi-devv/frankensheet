import { describe, it, expect } from 'vitest';
import { read, parseWorkbook, parseWorkbookRels, parseSharedStrings, parseDefinedNames } from './read.js';
import { buildMinimalXlsx } from './testing/minimalXlsx.js';

describe('read', () => {
  it('should read a minimal 1-cell workbook (smoke test)', () => {
    const xlsx = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [{ ref: 'A1', value: 42, type: 'n' }],
      },
    ]);

    const book = read(xlsx);

    expect(book.sheets).toHaveLength(1);
    expect(book.sheets[0]?.name).toBe('Sheet1');
    expect(book.sheets[0]?.rows.get(0)?.cells.get(0)?.v).toBe(42);
  });

  it('should extract sheet names and rIds from workbook.xml', () => {
    const xlsx = buildMinimalXlsx([
      { name: 'Sales', cells: [] },
      { name: 'Expenses', cells: [] },
    ]);

    const book = read(xlsx);

    expect(book.sheets).toHaveLength(2);
    expect(book.sheets[0]?.name).toBe('Sales');
    expect(book.sheets[1]?.name).toBe('Expenses');
  });

  it('should handle shared strings', () => {
    const xlsx = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [
          { ref: 'A1', value: 'hello', type: 's' },
          { ref: 'A2', value: 'world', type: 's' },
          { ref: 'A3', value: 'hello', type: 's' }, // Reuse first string
        ],
      },
    ]);

    const book = read(xlsx);
    const sheet = book.sheets[0]!;

    expect(sheet.rows.get(0)?.cells.get(0)?.v).toBe('hello');
    expect(sheet.rows.get(1)?.cells.get(0)?.v).toBe('world');
    expect(sheet.rows.get(2)?.cells.get(0)?.v).toBe('hello');
  });

  it('should handle XML entities in shared strings', () => {
    const xml = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>&lt;tag&gt;</t></si>
  <si><t>A &amp; B</t></si>
  <si><t>&quot;quoted&quot;</t></si>
</sst>`;

    const strings = parseSharedStrings(xml);

    expect(strings).toEqual(['<tag>', 'A & B', '"quoted"']);
  });

  it('should read mixed cell types', () => {
    const xlsx = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [
          { ref: 'A1', value: 42, type: 'n' },
          { ref: 'B1', value: 'text', type: 's' },
          { ref: 'C1', value: true, type: 'b' },
          { ref: 'D1', value: '#REF!', type: 'e' },
          { ref: 'E1', value: 'inline', type: 'inlineStr' },
        ],
      },
    ]);

    const book = read(xlsx);
    const row = book.sheets[0]!.rows.get(0)!;

    expect(row.cells.get(0)?.v).toBe(42);
    expect(row.cells.get(1)?.v).toBe('text');
    expect(row.cells.get(2)?.v).toBe(true);
    expect(row.cells.get(3)?.v).toEqual({ error: '#REF!' });
    expect(row.cells.get(4)?.v).toBe('inline');
  });

  it('should normalize empty strings to null', () => {
    const xlsx = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [{ ref: 'A1', value: '', type: 's' }],
      },
    ]);

    const book = read(xlsx);
    const cell = book.sheets[0]!.rows.get(0)?.cells.get(0);

    expect(cell?.v).toBeNull();
  });

  it('should read formulas with A1 and R1C1 forms', () => {
    const xlsx = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [
          { ref: 'A1', value: 10, type: 'n' },
          { ref: 'A2', value: 20, type: 'n' },
          { ref: 'A3', formula: 'A1+A2', value: 30, type: 'n' },
        ],
      },
    ]);

    const book = read(xlsx);
    const cell = book.sheets[0]!.rows.get(2)?.cells.get(0);

    expect(cell?.f).toBe('A1+A2');
    expect(cell?.fr).toBe('R[-2]C+R[-1]C'); // R1C1 relative
    expect(cell?.v).toBe(30);
  });

  it('should flatten rich text to plain text', () => {
    const xml = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si>
    <r><t>Bold</t></r>
    <r><t> and </t></r>
    <r><t>Italic</t></r>
  </si>
</sst>`;

    const strings = parseSharedStrings(xml);

    expect(strings).toEqual(['Bold and Italic']);
  });

  it('should parse defined names', () => {
    const xml = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <definedNames>
    <definedName name="TaxRate">0.15</definedName>
    <definedName name="DataRange">Sheet1!$A$1:$C$10</definedName>
  </definedNames>
</workbook>`;

    const names = parseDefinedNames(xml);

    expect(names).toEqual({
      TaxRate: '0.15',
      DataRange: 'Sheet1!$A$1:$C$10',
    });
  });

  it('should handle sparse rows and cells', () => {
    const xlsx = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [
          { ref: 'A1', value: 1, type: 'n' },
          { ref: 'C1', value: 3, type: 'n' },
          { ref: 'A5', value: 5, type: 'n' },
        ],
      },
    ]);

    const book = read(xlsx);
    const sheet = book.sheets[0]!;

    expect(sheet.rows.size).toBe(2); // Rows 0 and 4
    expect(sheet.rows.get(0)?.cells.size).toBe(2); // Cols 0 and 2
    expect(sheet.rows.get(0)?.cells.get(0)?.v).toBe(1);
    expect(sheet.rows.get(0)?.cells.get(1)).toBeUndefined();
    expect(sheet.rows.get(0)?.cells.get(2)?.v).toBe(3);
    expect(sheet.rows.get(4)?.cells.get(0)?.v).toBe(5);
  });

  it('should calculate colCount correctly', () => {
    const xlsx = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [
          { ref: 'A1', value: 1, type: 'n' },
          { ref: 'E2', value: 5, type: 'n' },
        ],
      },
    ]);

    const book = read(xlsx);
    const sheet = book.sheets[0]!;

    expect(sheet.colCount).toBe(5); // Cols A-E = 0-4, so count is 5
  });
});

describe('parseWorkbook', () => {
  it('should extract sheet names and rIds', () => {
    const xml = `<?xml version="1.0"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
    <sheet name="Data" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

    const sheets = parseWorkbook(xml);

    expect(sheets).toEqual([
      { name: 'Sheet1', rId: 'rId1' },
      { name: 'Data', rId: 'rId2' },
    ]);
  });
});

describe('parseWorkbookRels', () => {
  it('should build rId to target mapping', () => {
    const xml = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://..." Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://..." Target="worksheets/sheet2.xml"/>
</Relationships>`;

    const rels = parseWorkbookRels(xml);

    expect(rels.get('rId1')).toBe('worksheets/sheet1.xml');
    expect(rels.get('rId2')).toBe('worksheets/sheet2.xml');
  });
});

describe('parseSharedStrings', () => {
  it('should extract simple strings', () => {
    const xml = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>one</t></si>
  <si><t>two</t></si>
  <si><t>three</t></si>
</sst>`;

    const strings = parseSharedStrings(xml);

    expect(strings).toEqual(['one', 'two', 'three']);
  });

  it('should handle empty strings', () => {
    const xml = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t></t></si>
  <si><t>text</t></si>
</sst>`;

    const strings = parseSharedStrings(xml);

    expect(strings).toEqual(['', 'text']);
  });
});
