// Read .xlsx files into the Book model
// Uses fflate for zip extraction and hand-written XML scanners (no DOM/SAX dependencies)

import { unzipSync } from 'fflate';
import type { Book, Sheet, Row, Cell, CellValue } from './model.js';
import { normalizeValue } from './normalize.js';
import { toR1C1, colToIndex, indexToCol, parseRef } from './formula.js';

/**
 * Error thrown by read operations
 */
export class FsheetError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FsheetError';
  }
}

/**
 * Read a .xlsx file from bytes into a Book model.
 * @param bytes - Uint8Array containing the .xlsx file
 * @returns Parsed Book with all sheets, cells, and defined names
 */
export function read(bytes: Uint8Array): Book {
  // Unzip the .xlsx file
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new FsheetError('read:unzip_failed', `Failed to unzip .xlsx: ${e}`);
  }

  // Parse workbook.xml to get sheet names and rIds
  const workbookXml = getTextEntry(entries, 'xl/workbook.xml');
  const sheetInfos = parseWorkbook(workbookXml);
  const date1904 = workbookXml.includes('date1904="1"') || workbookXml.includes("date1904='1'");

  // Parse workbook relationships
  const workbookRels = getTextEntry(entries, 'xl/_rels/workbook.xml.rels');
  const relationships = parseWorkbookRels(workbookRels);

  // Parse shared strings if present
  let sharedStrings: string[] = [];
  if (entries['xl/sharedStrings.xml']) {
    const sharedStringsXml = getTextEntry(entries, 'xl/sharedStrings.xml');
    sharedStrings = parseSharedStrings(sharedStringsXml);
  }

  // Parse styles to detect date-formatted cells (for date1904 conversion)
  let dateFormatIds: Set<number> = new Set();
  if (date1904 && entries['xl/styles.xml']) {
    const stylesXml = getTextEntry(entries, 'xl/styles.xml');
    dateFormatIds = parseDateFormats(stylesXml);
  }

  // Parse each sheet
  const sheets: Sheet[] = [];
  for (const info of sheetInfos) {
    const target = relationships.get(info.rId);
    if (!target) {
      throw new FsheetError('read:missing_relationship', `No relationship found for rId="${info.rId}"`);
    }

    // Resolve target path: if starts with '/', strip it; else join relative to xl/
    const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const sheetEntry = entries[sheetPath];
    if (!sheetEntry) {
      throw new FsheetError('read:missing_sheet', `Sheet file not found: ${sheetPath}`);
    }

    const sheetXml = new TextDecoder('utf-8').decode(sheetEntry);
    const sheet = parseSheet(sheetXml, info.name, sharedStrings, date1904, dateFormatIds);
    sheets.push(sheet);
  }

  // Parse defined names
  const names = parseDefinedNames(workbookXml);

  return {
    sheets,
    names,
    date1904: date1904 || undefined,
  };
}

/**
 * Get a text entry from the zip, throwing if missing
 */
function getTextEntry(entries: Record<string, Uint8Array>, path: string): string {
  const entry = entries[path];
  if (!entry) {
    throw new FsheetError('read:missing_entry', `Required entry not found: ${path}`);
  }
  return new TextDecoder('utf-8').decode(entry);
}

/**
 * Parse xl/workbook.xml to extract sheet names and rIds
 */
export function parseWorkbook(xml: string): Array<{ name: string; rId: string }> {
  const sheets: Array<{ name: string; rId: string }> = [];

  // Match <sheet name="..." sheetId="..." r:id="..."/> or <sheet ... />
  const sheetPattern = /<sheet\s+([^>]+)\/?>|<sheet\s+([^>]+)>/g;
  let match;

  while ((match = sheetPattern.exec(xml)) !== null) {
    const attrs = match[1] || match[2];
    if (!attrs) continue;

    const nameMatch = attrs.match(/name="([^"]+)"/);
    const rIdMatch = attrs.match(/r:id="([^"]+)"/);

    if (nameMatch && rIdMatch) {
      sheets.push({
        name: nameMatch[1]!,
        rId: rIdMatch[1]!,
      });
    }
  }

  return sheets;
}

/**
 * Parse xl/_rels/workbook.xml.rels to build rId → target mapping
 */
export function parseWorkbookRels(xml: string): Map<string, string> {
  const relationships = new Map<string, string>();

  // Match <Relationship Id="..." Target="..." ... />
  const relPattern = /<Relationship\s+([^>]+)\/>/g;
  let match;

  while ((match = relPattern.exec(xml)) !== null) {
    const attrs = match[1];
    if (!attrs) continue;

    const idMatch = attrs.match(/Id="([^"]+)"/);
    const targetMatch = attrs.match(/Target="([^"]+)"/);

    if (idMatch && targetMatch) {
      relationships.set(idMatch[1]!, targetMatch[1]!);
    }
  }

  return relationships;
}

/**
 * Parse xl/sharedStrings.xml to extract string table
 * Handles rich text by flattening <r><t> runs into plain text
 */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];

  // Match <si>...</si> entries
  const siPattern = /<si[^>]*>(.*?)<\/si>/gs;
  let match;

  while ((match = siPattern.exec(xml)) !== null) {
    const content = match[1];
    if (!content) {
      strings.push('');
      continue;
    }

    // Check for rich text <r> runs vs simple <t>
    if (content.includes('<r>') || content.includes('<r ')) {
      // Rich text: concatenate all <t> tags
      strings.push(extractAllText(content));
    } else {
      // Simple text: extract from <t>...</t>
      const tMatch = content.match(/<t[^>]*>(.*?)<\/t>/s);
      strings.push(tMatch ? decodeXmlEntities(tMatch[1]!) : '');
    }
  }

  return strings;
}

/**
 * Extract and concatenate all <t> text nodes (for rich text)
 */
function extractAllText(xml: string): string {
  const texts: string[] = [];
  const tPattern = /<t[^>]*>(.*?)<\/t>/gs;
  let match;

  while ((match = tPattern.exec(xml)) !== null) {
    texts.push(decodeXmlEntities(match[1]!));
  }

  return texts.join('');
}

/**
 * Decode XML entities (&lt; &gt; &amp; &quot; &apos;)
 */
function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // Must be last
}

/**
 * Parse xl/styles.xml to extract numFmtIds that are date formats
 * Returns a Set of styleIds (s attribute values) that correspond to date formats
 */
function parseDateFormats(stylesXml: string): Set<number> {
  const dateFormatIds = new Set<number>();

  // Built-in date format IDs
  const builtInDateIds = [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47];
  for (const id of builtInDateIds) {
    dateFormatIds.add(id);
  }

  // Parse custom numFmts: <numFmt numFmtId="..." formatCode="..."/>
  const numFmtPattern = /<numFmt\s+([^>]+)\/>/g;
  let match;
  const customDateFormats = new Map<number, boolean>();

  while ((match = numFmtPattern.exec(stylesXml)) !== null) {
    const attrs = match[1];
    if (!attrs) continue;

    const idMatch = attrs.match(/numFmtId="(\d+)"/);
    const codeMatch = attrs.match(/formatCode="([^"]+)"/);

    if (idMatch && codeMatch) {
      const id = parseInt(idMatch[1]!, 10);
      const code = codeMatch[1]!;

      // A format is a date if it contains d/m/y/h/s outside quotes and brackets
      const isDate = /[dmyhHsS]/.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));
      if (isDate) {
        customDateFormats.set(id, true);
        dateFormatIds.add(id);
      }
    }
  }

  // Parse cellXfs to map style index to numFmtId
  const styleToNumFmtId = new Map<number, number>();
  const cellXfsMatch = stylesXml.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s);
  if (cellXfsMatch) {
    const xfPattern = /<xf\s+([^>]+)\/?>|<xf\s+([^>]+)>/g;
    let xfMatch;
    let styleIndex = 0;

    while ((xfMatch = xfPattern.exec(cellXfsMatch[1]!)) !== null) {
      const attrs = xfMatch[1] || xfMatch[2];
      if (!attrs) {
        styleIndex++;
        continue;
      }

      const numFmtIdMatch = attrs.match(/numFmtId="(\d+)"/);
      if (numFmtIdMatch) {
        const numFmtId = parseInt(numFmtIdMatch[1]!, 10);
        styleToNumFmtId.set(styleIndex, numFmtId);
      }
      styleIndex++;
    }
  }

  // Build final set of style indices that map to date formats
  const dateStyleIds = new Set<number>();
  for (const [styleId, numFmtId] of styleToNumFmtId) {
    if (dateFormatIds.has(numFmtId)) {
      dateStyleIds.add(styleId);
    }
  }

  return dateStyleIds;
}

/**
 * Parse a sheet XML to extract rows and cells
 */
export function parseSheet(
  xml: string,
  sheetName: string,
  sharedStrings: string[],
  date1904: boolean,
  dateFormatIds: Set<number>,
): Sheet {
  const rows = new Map<number, Row>();
  let maxCol = 0;

  // Track shared formulas: si → { ref: range, formula: master formula }
  const sharedFormulas = new Map<number, { ref: string; formula: string; masterRow: number; masterCol: number }>();

  // Match <row> tags
  const rowPattern = /<row\s+([^>]*)>(.*?)<\/row>/gs;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    const rowAttrs = rowMatch[1];
    const rowContent = rowMatch[2];
    if (!rowAttrs || !rowContent) continue;

    const rMatch = rowAttrs.match(/r="(\d+)"/);
    if (!rMatch) continue;

    const rowIndex = parseInt(rMatch[1]!, 10) - 1; // Zero-indexed

    const rowCells = new Map<number, Cell>();

    // Match <c> tags within the row
    const cellPattern = /<c\s+([^>]*)>(.*?)<\/c>/gs;
    let cellMatch;

    while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
      const cellAttrs = cellMatch[1];
      const cellContent = cellMatch[2];
      if (!cellAttrs) continue;

      const refMatch = cellAttrs.match(/r="([^"]+)"/);
      if (!refMatch) continue;

      const cellRef = refMatch[1]!;
      const { col } = parseRef(cellRef);
      maxCol = Math.max(maxCol, col);

      const tMatch = cellAttrs.match(/t="([^"]+)"/);
      const sMatch = cellAttrs.match(/s="(\d+)"/);
      const cellType = tMatch ? tMatch[1] : undefined;
      const styleId = sMatch ? parseInt(sMatch[1]!, 10) : undefined;

      let value: CellValue = null;
      let formula: string | undefined;

      // Parse formula if present
      const fMatch = cellContent?.match(/<f([^>]*)>(.*?)<\/f>/s);
      if (fMatch) {
        const fAttrs = fMatch[1];
        const fContent = fMatch[2];

        // Check for shared formula
        const tShared = fAttrs?.match(/t="shared"/);
        const siMatch = fAttrs?.match(/si="(\d+)"/);
        const refAttr = fAttrs?.match(/ref="([^"]+)"/);

        if (tShared && siMatch) {
          const si = parseInt(siMatch[1]!, 10);

          if (refAttr && fContent) {
            // Master shared formula
            sharedFormulas.set(si, {
              ref: refAttr[1]!,
              formula: fContent.trim(),
              masterRow: rowIndex,
              masterCol: col,
            });
            formula = fContent.trim();
          } else {
            // Slave shared formula: expand from master
            const master = sharedFormulas.get(si);
            if (master) {
              formula = expandSharedFormula(master.formula, master.masterRow, master.masterCol, rowIndex, col);
            }
          }
        } else if (fContent) {
          // Regular formula
          formula = fContent.trim();
        }
      }

      // Parse value based on type
      if (cellType === 's') {
        // Shared string index
        const vMatch = cellContent?.match(/<v>(.*?)<\/v>/s);
        if (vMatch) {
          const index = parseInt(vMatch[1]!, 10);
          value = sharedStrings[index] ?? '';
        }
      } else if (cellType === 'inlineStr') {
        // Inline string: extract text (may be rich text)
        const isMatch = cellContent?.match(/<is[^>]*>(.*?)<\/is>/s);
        if (isMatch) {
          value = extractAllText(isMatch[1]!);
        }
      } else if (cellType === 'b') {
        // Boolean
        const vMatch = cellContent?.match(/<v>(.*?)<\/v>/s);
        value = vMatch && vMatch[1] === '1' ? true : false;
      } else if (cellType === 'e') {
        // Error
        const vMatch = cellContent?.match(/<v>(.*?)<\/v>/s);
        if (vMatch) {
          value = { error: vMatch[1]! };
        }
      } else {
        // Number (or date serial)
        const vMatch = cellContent?.match(/<v>(.*?)<\/v>/s);
        if (vMatch && vMatch[1]) {
          let numValue = parseFloat(vMatch[1]);

          // Convert 1904 dates to 1900 system
          if (date1904 && styleId !== undefined && dateFormatIds.has(styleId)) {
            numValue = convert1904To1900(numValue);
          }

          value = numValue;
        }
      }

      // Normalize and store
      value = normalizeValue(value);

      // Store all cells that appeared in the XML (they may have style/formula info)
      // A cell exists if: it had a value (even if now null after normalization) OR has a formula
      const cellExists = cellContent !== undefined || formula !== undefined;
      
      if (cellExists) {
        const cell: Cell = { v: value };
        if (formula !== undefined) {
          cell.f = formula;
          cell.fr = toR1C1(formula, { row: rowIndex, col });
        }
        rowCells.set(col, cell);
      }
    }

    if (rowCells.size > 0) {
      rows.set(rowIndex, { cells: rowCells });
    }
  }

  return {
    name: sheetName,
    rows,
    colCount: maxCol + 1,
  };
}

/**
 * Expand a shared formula from master position to slave position
 * Offsets all relative references by the position delta
 */
function expandSharedFormula(
  masterFormula: string,
  masterRow: number,
  masterCol: number,
  slaveRow: number,
  slaveCol: number,
): string {
  const rowOffset = slaveRow - masterRow;
  const colOffset = slaveCol - masterCol;

  if (rowOffset === 0 && colOffset === 0) {
    return masterFormula;
  }

  // Replace cell references, adjusting relative refs
  return masterFormula.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/g,
    (match, colAbs, colStr, rowAbs, rowStr) => {
      let newCol = colStr;
      let newRow = rowStr;

      if (!colAbs) {
        const col = colToIndex(colStr);
        newCol = indexToCol(col + colOffset);
      }

      if (!rowAbs) {
        const row = parseInt(rowStr, 10);
        newRow = (row + rowOffset).toString();
      }

      return `${colAbs}${newCol}${rowAbs}${newRow}`;
    },
  );
}

/**
 * Convert a 1904 date serial to 1900 system
 * Offset is 1462 days (4 years + 1 day for the Excel bug)
 */
function convert1904To1900(serial: number): number {
  return serial + 1462;
}

/**
 * Parse defined names from xl/workbook.xml
 */
export function parseDefinedNames(xml: string): Record<string, string> {
  const names: Record<string, string> = {};

  // Match <definedName name="...">formula</definedName>
  const namePattern = /<definedName\s+([^>]*)>(.*?)<\/definedName>/gs;
  let match;

  while ((match = namePattern.exec(xml)) !== null) {
    const attrs = match[1];
    const content = match[2];
    if (!attrs || !content) continue;

    const nameMatch = attrs.match(/name="([^"]+)"/);
    if (nameMatch) {
      names[nameMatch[1]!] = content.trim();
    }
  }

  return names;
}
