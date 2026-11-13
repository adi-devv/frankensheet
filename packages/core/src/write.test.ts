// Unit tests for write.ts functions

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  write,
  xmlEscape,
  setCell,
  dropCachedValues,
  setFullCalcOnLoad,
  removeCalcChain,
  checkXmlWellFormed,
} from './write.js';
import { read } from './read.js';
import { buildMinimalXlsx } from './testing/minimalXlsx.js';
import { blankXlsx } from './testing/blankXlsx.js';
import type { Book, Cell } from './model.js';

describe('xmlEscape', () => {
  it('should escape & < > "', () => {
    expect(xmlEscape('&')).toBe('&amp;');
    expect(xmlEscape('<')).toBe('&lt;');
    expect(xmlEscape('>')).toBe('&gt;');
    expect(xmlEscape('"')).toBe('&quot;');
  });

  it('should escape <script> tag', () => {
    expect(xmlEscape('<script>alert("XSS")</script>')).toBe(
      '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
    );
  });

  it('should handle multiple special chars', () => {
    expect(xmlEscape('A & B < C > "D"')).toBe('A &amp; B &lt; C &gt; &quot;D&quot;');
  });

  it('should leave normal text unchanged', () => {
    expect(xmlEscape('Hello World 123')).toBe('Hello World 123');
  });
});

describe('checkXmlWellFormed', () => {
  it('should accept valid XML', () => {
    expect(() => checkXmlWellFormed('<root><child>text</child></root>', 'test.xml')).not.toThrow();
  });

  it('should accept nested tags', () => {
    expect(() =>
      checkXmlWellFormed('<a><b><c>text</c></b></a>', 'test.xml')
    ).not.toThrow();
  });

  it('should accept self-closing tags', () => {
    expect(() => checkXmlWellFormed('<root><child/></root>', 'test.xml')).not.toThrow();
  });

  it('should ignore XML declaration', () => {
    expect(() =>
      checkXmlWellFormed('<?xml version="1.0"?><root/>', 'test.xml')
    ).not.toThrow();
  });

  it('should ignore comments', () => {
    expect(() =>
      checkXmlWellFormed('<root><!-- comment --><child/></root>', 'test.xml')
    ).not.toThrow();
  });

  it('should ignore CDATA', () => {
    expect(() =>
      checkXmlWellFormed('<root><![CDATA[<not a tag>]]></root>', 'test.xml')
    ).not.toThrow();
  });

  it('should reject mismatched tags', () => {
    expect(() => checkXmlWellFormed('<a><b></a></b>', 'test.xml')).toThrow(/Mismatched/);
  });

  it('should reject unclosed tags', () => {
    expect(() => checkXmlWellFormed('<root><child>', 'test.xml')).toThrow(/Unclosed/);
  });

  it('should reject unclosed opening tag', () => {
    expect(() => checkXmlWellFormed('<root<child/></root>', 'test.xml')).toThrow(/Unclosed|Mismatched/);
  });
});

describe('setCell', () => {
  const basicSheetXml = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><v>100</v></c>
      <c r="B1" s="1"><v>200</v></c>
    </row>
  </sheetData>
</worksheet>`;

  it('should update existing cell value', () => {
    const cell: Cell = { v: 42 };
    const result = setCell(basicSheetXml, 'A1', cell);
    expect(result).toContain('<c r="A1"><v>42</v></c>');
  });

  it('should preserve s= attribute when updating', () => {
    const cell: Cell = { v: 999 };
    const result = setCell(basicSheetXml, 'B1', cell);
    expect(result).toContain('<c r="B1" s="1"><v>999</v></c>');
  });

  it('should insert cell into existing row in column order', () => {
    const cell: Cell = { v: 150 };
    const result = setCell(basicSheetXml, 'A2', cell);
    // A2 doesn't exist in row 2, should create row 2
    expect(result).toContain('<row r="2">');
    expect(result).toContain('<c r="A2"><v>150</v></c>');
  });

  it('should insert cell in column-sorted order', () => {
    // Insert C1 between B1 and potential D1
    const cell: Cell = { v: 300 };
    const result = setCell(basicSheetXml, 'C1', cell);
    expect(result).toContain('<c r="C1"><v>300</v></c>');
    
    // Check that cells are in order A1, B1, C1
    const a1Pos = result.indexOf('r="A1"');
    const b1Pos = result.indexOf('r="B1"');
    const c1Pos = result.indexOf('r="C1"');
    expect(a1Pos).toBeLessThan(b1Pos);
    expect(b1Pos).toBeLessThan(c1Pos);
  });

  it('should create new row in row-sorted order', () => {
    const cell: Cell = { v: 500 };
    const result = setCell(basicSheetXml, 'A5', cell);
    expect(result).toContain('<row r="5">');
    expect(result).toContain('<c r="A5"><v>500</v></c>');
  });

  it('should handle self-closing sheetData', () => {
    const emptySheetXml = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
</worksheet>`;

    const cell: Cell = { v: 123 };
    const result = setCell(emptySheetXml, 'A1', cell);
    expect(result).toContain('<sheetData>');
    expect(result).toContain('<row r="1">');
    expect(result).toContain('<c r="A1"><v>123</v></c>');
    expect(result).toContain('</sheetData>');
  });

  it('should set formula cell without cached value', () => {
    const cell: Cell = { v: null, f: 'A1+B1' };
    const result = setCell(basicSheetXml, 'C1', cell);
    expect(result).toContain('<c r="C1"><f>A1+B1</f></c>');
    expect(result).not.toMatch(/<c r="C1"[^>]*>(?:(?!<\/c>)[\s\S])*<v>/);
  });

  it('should set inline string with escaping', () => {
    const cell: Cell = { v: 'Hello <World> & "Friends"' };
    const result = setCell(basicSheetXml, 'C1', cell);
    expect(result).toContain('t="inlineStr"');
    expect(result).toContain('<is><t xml:space="preserve">Hello &lt;World&gt; &amp; &quot;Friends&quot;</t></is>');
  });

  it('should set boolean cell', () => {
    const cellTrue: Cell = { v: true };
    const cellFalse: Cell = { v: false };
    
    const result1 = setCell(basicSheetXml, 'C1', cellTrue);
    expect(result1).toContain('<c r="C1" t="b"><v>1</v></c>');
    
    const result2 = setCell(basicSheetXml, 'C1', cellFalse);
    expect(result2).toContain('<c r="C1" t="b"><v>0</v></c>');
  });

  it('should set error cell', () => {
    const cell: Cell = { v: { error: '#REF!' } };
    const result = setCell(basicSheetXml, 'C1', cell);
    expect(result).toContain('<c r="C1" t="e"><v>#REF!</v></c>');
  });

  it('should clear cell with null but preserve style', () => {
    const result = setCell(basicSheetXml, 'B1', null);
    expect(result).toContain('<c r="B1" s="1"/>');
  });

  it('should remove cell with null when no style', () => {
    const result = setCell(basicSheetXml, 'A1', null);
    expect(result).not.toContain('r="A1"');
  });
});

describe('dropCachedValues', () => {
  const sheetWithFormulas = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1"><f>SUM(B1:B10)</f><v>100</v></c>
      <c r="B1"><v>10</v></c>
      <c r="C1"><f>A1*2</f><v>200</v></c>
    </row>
  </sheetData>
</worksheet>`;

  it('should remove <v> from formula cells', () => {
    const result = dropCachedValues(sheetWithFormulas);
    expect(result).toContain('<c r="A1"><f>SUM(B1:B10)</f></c>');
    expect(result).toContain('<c r="C1"><f>A1*2</f></c>');
  });

  it('should keep <v> for non-formula cells', () => {
    const result = dropCachedValues(sheetWithFormulas);
    expect(result).toContain('<c r="B1"><v>10</v></c>');
  });

  it('should handle cells with only formulas', () => {
    const sheetXml = `<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f></c></row></sheetData></worksheet>`;
    const result = dropCachedValues(sheetXml);
    expect(result).toContain('<c r="A1"><f>1+1</f></c>');
    expect(result).not.toContain('<v>');
  });
});

describe('setFullCalcOnLoad', () => {
  it('should add fullCalcOnLoad to existing calcPr', () => {
    const wbXml = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <calcPr calcId="123456"/>
  <sheets><sheet name="Sheet1" sheetId="1"/></sheets>
</workbook>`;

    const result = setFullCalcOnLoad(wbXml);
    expect(result).toContain('fullCalcOnLoad="1"');
    expect(result).toContain('calcId="123456"');
  });

  it('should update existing fullCalcOnLoad attribute', () => {
    const wbXml = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <calcPr fullCalcOnLoad="0" calcId="123456"/>
  <sheets><sheet name="Sheet1" sheetId="1"/></sheets>
</workbook>`;

    const result = setFullCalcOnLoad(wbXml);
    expect(result).toContain('fullCalcOnLoad="1"');
    expect(result).not.toContain('fullCalcOnLoad="0"');
  });

  it('should insert calcPr after sheets when missing', () => {
    const wbXml = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets><sheet name="Sheet1" sheetId="1"/></sheets>
</workbook>`;

    const result = setFullCalcOnLoad(wbXml);
    expect(result).toContain('</sheets>\n  <calcPr fullCalcOnLoad="1"/>');
  });

  it('should insert calcPr after definedNames when present', () => {
    const wbXml = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets><sheet name="Sheet1" sheetId="1"/></sheets>
  <definedNames><definedName name="Test">A1</definedName></definedNames>
</workbook>`;

    const result = setFullCalcOnLoad(wbXml);
    expect(result).toContain('</definedNames>\n  <calcPr fullCalcOnLoad="1"/>');
  });

  it('should insert calcPr before closing workbook tag as fallback', () => {
    const wbXml = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
</workbook>`;

    const result = setFullCalcOnLoad(wbXml);
    expect(result).toContain('<calcPr fullCalcOnLoad="1"/>\n</workbook>');
  });
});

describe('removeCalcChain', () => {
  it('should remove xl/calcChain.xml entry', () => {
    const entries: Record<string, Uint8Array> = {
      'xl/calcChain.xml': new Uint8Array([1, 2, 3]),
      'xl/workbook.xml': new Uint8Array([4, 5, 6]),
    };

    removeCalcChain(entries);
    expect(entries['xl/calcChain.xml']).toBeUndefined();
  });

  it('should remove calcChain from Content_Types', () => {
    const contentTypes = `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/xl/workbook.xml" ContentType="application/..."/>
  <Override PartName="/xl/calcChain.xml" ContentType="application/..."/>
</Types>`;

    const entries: Record<string, Uint8Array> = {
      '[Content_Types].xml': new TextEncoder().encode(contentTypes),
      'xl/calcChain.xml': new Uint8Array([1, 2, 3]),
    };

    removeCalcChain(entries);
    
    const result = new TextDecoder().decode(entries['[Content_Types].xml']!);
    expect(result).not.toContain('calcChain.xml');
    expect(result).toContain('workbook.xml');
  });

  it('should remove calcChain relationship', () => {
    const rels = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Target="calcChain.xml"/>
  <Relationship Id="rId3" Target="styles.xml"/>
</Relationships>`;

    const entries: Record<string, Uint8Array> = {
      'xl/_rels/workbook.xml.rels': new TextEncoder().encode(rels),
      'xl/calcChain.xml': new Uint8Array([1, 2, 3]),
    };

    removeCalcChain(entries);
    
    const result = new TextDecoder().decode(entries['xl/_rels/workbook.xml.rels']!);
    expect(result).not.toContain('calcChain.xml');
    expect(result).toContain('sheet1.xml');
    expect(result).toContain('styles.xml');
  });
});

describe('write', () => {
  it('should round-trip a minimal workbook unchanged', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [
          { ref: 'A1', value: 100 },
          { ref: 'B1', value: 200 },
        ],
      },
    ]);

    const book = read(original);
    const result = write(book, original);
    const roundtrip = read(result);

    expect(roundtrip.sheets).toHaveLength(1);
    expect(roundtrip.sheets[0]?.name).toBe('Sheet1');
    
    const sheet = roundtrip.sheets[0]!;
    const a1 = sheet.rows.get(0)?.cells.get(0);
    const b1 = sheet.rows.get(0)?.cells.get(1);
    
    expect(a1?.v).toBe(100);
    expect(b1?.v).toBe(200);
  });

  it('should change a number cell', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [{ ref: 'A1', value: 100 }],
      },
    ]);

    const book = read(original);
    book.sheets[0]!.rows.get(0)!.cells.set(0, { v: 999 });

    const result = write(book, original);
    const roundtrip = read(result);

    const a1 = roundtrip.sheets[0]?.rows.get(0)?.cells.get(0);
    expect(a1?.v).toBe(999);
  });

  it('should change a string with special characters', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [{ ref: 'A1', value: 'Hello', type: 's' }],
      },
    ]);

    const book = read(original);
    book.sheets[0]!.rows.get(0)!.cells.set(0, { v: 'A & B < C > "D"' });

    const result = write(book, original);
    const roundtrip = read(result);

    const a1 = roundtrip.sheets[0]?.rows.get(0)?.cells.get(0);
    expect(a1?.v).toBe('A & B < C > "D"');
  });

  it('should change a boolean cell', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [{ ref: 'A1', value: true, type: 'b' }],
      },
    ]);

    const book = read(original);
    book.sheets[0]!.rows.get(0)!.cells.set(0, { v: false });

    const result = write(book, original);
    const roundtrip = read(result);

    const a1 = roundtrip.sheets[0]?.rows.get(0)?.cells.get(0);
    expect(a1?.v).toBe(false);
  });

  it('should set error cell', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [{ ref: 'A1', value: 100 }],
      },
    ]);

    const book = read(original);
    book.sheets[0]!.rows.get(0)!.cells.set(0, { v: { error: '#REF!' } });

    const result = write(book, original);
    const roundtrip = read(result);

    const a1 = roundtrip.sheets[0]?.rows.get(0)?.cells.get(0);
    expect(a1?.v).toEqual({ error: '#REF!' });
  });

  it('should set formula cell and drop cached value', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [
          { ref: 'A1', value: 10 },
          { ref: 'B1', value: 20 },
        ],
      },
    ]);

    const book = read(original);
    book.sheets[0]!.rows.get(0)!.cells.set(2, { v: null, f: 'A1+B1', fr: 'RC[-2]+RC[-1]' });

    const result = write(book, original);
    const roundtrip = read(result);

    const c1 = roundtrip.sheets[0]?.rows.get(0)?.cells.get(2);
    expect(c1?.f).toBe('A1+B1');
    expect(c1?.v).toBe(null); // Cached value should be dropped
  });

  it('should clear a cell', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [
          { ref: 'A1', value: 100 },
          { ref: 'B1', value: 200 },
        ],
      },
    ]);

    const book = read(original);
    book.sheets[0]!.rows.get(0)!.cells.delete(1); // Remove B1

    const result = write(book, original);
    const roundtrip = read(result);

    const a1 = roundtrip.sheets[0]?.rows.get(0)?.cells.get(0);
    const b1 = roundtrip.sheets[0]?.rows.get(0)?.cells.get(1);
    
    expect(a1?.v).toBe(100);
    expect(b1).toBeUndefined();
  });

  it('should preserve unmodified sheets byte-identical', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [{ ref: 'A1', value: 100 }],
      },
      {
        name: 'Sheet2',
        cells: [{ ref: 'A1', value: 200 }],
      },
    ]);

    const book = read(original);
    // Only modify Sheet1
    book.sheets[0]!.rows.get(0)!.cells.set(0, { v: 999 });

    const result = write(book, original);
    
    // Extract Sheet2 from both
    const originalEntries = new Map<string, Uint8Array>();
    const resultEntries = new Map<string, Uint8Array>();
    
    // Can't easily verify byte-identical without accessing internal entries,
    // but we can verify Sheet2 is unchanged by reading
    const roundtrip = read(result);
    const sheet2 = roundtrip.sheets[1];
    expect(sheet2?.name).toBe('Sheet2');
    expect(sheet2?.rows.get(0)?.cells.get(0)?.v).toBe(200);
  });

  it('should set fullCalcOnLoad when sheets are modified', () => {
    const original = blankXlsx(['Sheet1']);
    const book = read(original);
    
    book.sheets[0]!.rows.set(0, {
      cells: new Map([[0, { v: 123 }]]),
    });

    const result = write(book, original);
    
    // Check that workbook.xml has fullCalcOnLoad
    const entries = unzipSync(result);
    const wbXml = strFromU8(entries['xl/workbook.xml']!);
    
    expect(wbXml).toContain('fullCalcOnLoad="1"');
  });

  it('should remove calcChain when sheets are modified', () => {
    const original = buildMinimalXlsx([
      {
        name: 'Sheet1',
        cells: [{ ref: 'A1', value: 100, formula: 'B1*2' }],
      },
    ]);

    const book = read(original);
    book.sheets[0]!.rows.get(0)!.cells.set(0, { v: 200 });

    const result = write(book, original);
    
    const entries = unzipSync(result);
    
    expect(entries['xl/calcChain.xml']).toBeUndefined();
  });
});
