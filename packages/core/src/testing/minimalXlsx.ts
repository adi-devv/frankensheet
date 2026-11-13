// Test helper to build minimal valid .xlsx files with fflate
// Used for testing read functionality without needing external fixtures

import { zipSync, strToU8 } from 'fflate';

export interface MinimalCellData {
  ref: string;
  value?: string | number | boolean;
  type?: 's' | 'n' | 'b' | 'e' | 'inlineStr';
  formula?: string;
  style?: number;
}

export interface MinimalSheetData {
  name: string;
  cells: MinimalCellData[];
}

/**
 * Build a minimal valid .xlsx file from sheet data
 */
export function buildMinimalXlsx(sheets: MinimalSheetData[]): Uint8Array {
  const sharedStrings: string[] = [];
  const sharedStringMap = new Map<string, number>();

  // Collect shared strings
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (cell.type === 's' && typeof cell.value === 'string') {
        if (!sharedStringMap.has(cell.value)) {
          sharedStringMap.set(cell.value, sharedStrings.length);
          sharedStrings.push(cell.value);
        }
      }
    }
  }

  const entries: Record<string, Uint8Array> = {};

  // [Content_Types].xml
  entries['[Content_Types].xml'] = strToU8(buildContentTypes(sheets.length));

  // _rels/.rels
  entries['_rels/.rels'] = strToU8(buildRootRels());

  // xl/workbook.xml
  entries['xl/workbook.xml'] = strToU8(buildWorkbook(sheets));

  // xl/_rels/workbook.xml.rels
  entries['xl/_rels/workbook.xml.rels'] = strToU8(buildWorkbookRels(sheets.length, sharedStrings.length > 0));

  // xl/sharedStrings.xml (if needed)
  if (sharedStrings.length > 0) {
    entries['xl/sharedStrings.xml'] = strToU8(buildSharedStrings(sharedStrings));
  }

  // xl/styles.xml (minimal)
  entries['xl/styles.xml'] = strToU8(buildStyles());

  // Sheet XMLs
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]!;
    entries[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(buildSheet(sheet, sharedStringMap));
  }

  return zipSync(entries, { level: 6 });
}

function buildContentTypes(sheetCount: number): string {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`;

  for (let i = 1; i <= sheetCount; i++) {
    xml += `\n  <Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }

  xml += `\n</Types>`;
  return xml;
}

function buildRootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildWorkbook(sheets: MinimalSheetData[]): string {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>`;

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]!;
    xml += `\n    <sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
  }

  xml += `\n  </sheets>
</workbook>`;
  return xml;
}

function buildWorkbookRels(sheetCount: number, hasSharedStrings: boolean): string {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;

  for (let i = 1; i <= sheetCount; i++) {
    xml += `\n  <Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`;
  }

  if (hasSharedStrings) {
    xml += `\n  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`;
  }

  xml += `\n  <Relationship Id="rId${sheetCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;

  xml += `\n</Relationships>`;
  return xml;
}

function buildSharedStrings(strings: string[]): string {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">`;

  for (const str of strings) {
    xml += `\n  <si><t>${xmlEscape(str)}</t></si>`;
  }

  xml += `\n</sst>`;
  return xml;
}

function buildStyles(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="0"/>
  <fonts count="1">
    <font><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellXfs>
</styleSheet>`;
}

function buildSheet(sheet: MinimalSheetData, sharedStringMap: Map<string, number>): string {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>`;

  // Group cells by row
  const rowMap = new Map<number, MinimalCellData[]>();
  for (const cell of sheet.cells) {
    const rowMatch = cell.ref.match(/\d+$/);
    if (!rowMatch) continue;
    const row = parseInt(rowMatch[0]!, 10);
    if (!rowMap.has(row)) {
      rowMap.set(row, []);
    }
    rowMap.get(row)!.push(cell);
  }

  // Sort rows
  const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);

  for (const rowNum of sortedRows) {
    const cells = rowMap.get(rowNum)!;
    xml += `\n    <row r="${rowNum}">`;

    for (const cell of cells) {
      const { ref, value, type, formula, style } = cell;
      let cellXml = `\n      <c r="${ref}"`;

      if (style !== undefined) {
        cellXml += ` s="${style}"`;
      }

      if (type === 's') {
        // Shared string
        const index = sharedStringMap.get(value as string);
        cellXml += ` t="s"><v>${index}</v></c>`;
      } else if (type === 'inlineStr') {
        cellXml += ` t="inlineStr"><is><t>${xmlEscape(String(value))}</t></is></c>`;
      } else if (type === 'b') {
        cellXml += ` t="b"><v>${value ? '1' : '0'}</v></c>`;
      } else if (type === 'e') {
        cellXml += ` t="e"><v>${xmlEscape(String(value))}</v></c>`;
      } else if (formula) {
        cellXml += `><f>${xmlEscape(formula)}</f>`;
        if (value !== undefined) {
          cellXml += `<v>${value}</v>`;
        }
        cellXml += `</c>`;
      } else {
        // Number
        cellXml += `><v>${value}</v></c>`;
      }

      xml += cellXml;
    }

    xml += `\n    </row>`;
  }

  xml += `\n  </sheetData>
</worksheet>`;
  return xml;
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
