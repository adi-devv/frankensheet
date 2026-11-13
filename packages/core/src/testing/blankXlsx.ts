// Test helper to build minimal blank .xlsx files with empty sheets
// Used for property test P4 where generated books need a base file

import { zipSync, strToU8 } from 'fflate';

/**
 * Build a minimal valid .xlsx file with empty sheets.
 * Each sheet has an empty <sheetData/> element.
 * 
 * @param sheetNames - Array of sheet names to create
 * @returns Uint8Array containing the .xlsx file
 */
export function blankXlsx(sheetNames: string[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};

  // [Content_Types].xml
  entries['[Content_Types].xml'] = strToU8(buildContentTypes(sheetNames.length));

  // _rels/.rels
  entries['_rels/.rels'] = strToU8(buildRootRels());

  // xl/workbook.xml
  entries['xl/workbook.xml'] = strToU8(buildWorkbook(sheetNames));

  // xl/_rels/workbook.xml.rels
  entries['xl/_rels/workbook.xml.rels'] = strToU8(buildWorkbookRels(sheetNames.length));

  // xl/styles.xml (minimal)
  entries['xl/styles.xml'] = strToU8(buildStyles());

  // Sheet XMLs
  for (let i = 0; i < sheetNames.length; i++) {
    entries[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(buildBlankSheet());
  }

  return zipSync(entries, { level: 6 });
}

function buildContentTypes(sheetCount: number): string {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`;

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

function buildWorkbook(sheetNames: string[]): string {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>`;

  for (let i = 0; i < sheetNames.length; i++) {
    const name = sheetNames[i]!;
    xml += `\n    <sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
  }

  xml += `\n  </sheets>
</workbook>`;
  return xml;
}

function buildWorkbookRels(sheetCount: number): string {
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;

  for (let i = 1; i <= sheetCount; i++) {
    xml += `\n  <Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`;
  }

  xml += `\n  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;

  xml += `\n</Relationships>`;
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

function buildBlankSheet(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
</worksheet>`;
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
