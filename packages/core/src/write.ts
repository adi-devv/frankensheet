// Write Book model back to .xlsx bytes using fflate XML patching
// Preserves all unmodified parts byte-identical per design.md Plan B

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import type { Book, Cell, CellValue } from './model.js';
import { FsheetError, parseWorkbook, parseWorkbookRels, read } from './read.js';
import { normalizeValue } from './normalize.js';
import { parseRef, indexToCol, shiftFormula, tokenize } from './formula.js';

/**
 * Write a Book back to .xlsx bytes.
 * Uses original bytes as a base, patching only modified sheets.
 * Preserves all unmodified parts byte-identical.
 * 
 * @param book - The Book to write
 * @param originalBytes - Original .xlsx bytes to use as base
 * @returns Modified .xlsx as Uint8Array
 */
export function write(book: Book, originalBytes: Uint8Array): Uint8Array {
  // Unzip original file
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(originalBytes);
  } catch (e) {
    throw new FsheetError('write:unzip_failed', `Failed to unzip .xlsx: ${e}`);
  }

  // Parse workbook to get original sheet names and their paths
  const workbookXml = strFromU8(entries['xl/workbook.xml']!);
  const sheetInfos = parseWorkbook(workbookXml);
  const workbookRels = strFromU8(entries['xl/_rels/workbook.xml.rels']!);
  const relationships = parseWorkbookRels(workbookRels);

  // Build map of sheet name -> path
  const sheetPaths = new Map<string, string>();
  for (const info of sheetInfos) {
    const target = relationships.get(info.rId);
    if (target) {
      const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      sheetPaths.set(info.name, sheetPath);
    }
  }

  // The original as read() sees it, used to detect real changes
  const originalBook = read(originalBytes);

  // Track which sheets were modified
  const modifiedParts = new Set<string>();

  // Update each sheet in the book
  for (const sheet of book.sheets) {
    const sheetPath = sheetPaths.get(sheet.name);
    if (!sheetPath || !entries[sheetPath]) {
      // Sheet doesn't exist in original, skip it
      continue;
    }

    let sheetXml = strFromU8(entries[sheetPath]);
    let modified = false;

    // Cells as read() sees them in the original, so unchanged cells
    // (shared strings, shared formulas, styles) are never rewritten.
    const origSheet = originalBook.sheets.find((s) => s.name === sheet.name);
    const origCells = new Map<string, Cell>();
    if (origSheet) {
      for (const [rowIndex, row] of origSheet.rows) {
        for (const [colIndex, cell] of row.cells) {
          origCells.set(`${indexToCol(colIndex)}${rowIndex + 1}`, cell);
        }
      }
    }

    // Build the list of cells whose content differs from the original
    const changes = new Map<string, Cell | null>();
    const seen = new Set<string>();
    for (const [rowIndex, row] of sheet.rows) {
      for (const [colIndex, cell] of row.cells) {
        const ref = `${indexToCol(colIndex)}${rowIndex + 1}`;
        seen.add(ref);
        if (!cellsEqual(origCells.get(ref), cell)) changes.set(ref, cell);
      }
    }

    // Cells in the original but absent from the book are cleared
    for (const [ref, cell] of origCells) {
      if (!seen.has(ref) && !cellsEqual(cell, undefined)) changes.set(ref, null);
    }

    // Apply cell changes
    for (const [ref, cell] of changes) {
      const newXml = setCell(sheetXml, ref, cell);
      if (newXml !== sheetXml) {
        sheetXml = newXml;
        modified = true;
      }
    }

    if (modified) {
      // Drop cached values from formula cells
      sheetXml = dropCachedValues(sheetXml);
      
      // Validate XML
      checkXmlWellFormed(sheetXml, sheetPath);
      
      entries[sheetPath] = strToU8(sheetXml);
      modifiedParts.add(sheetPath);
    }
  }

  // Defined names: rewrite <definedNames> only if they changed
  const namesChanged = !namesEqual(book.names, originalBook.names);

  // Set fullCalcOnLoad if any sheets or names were modified
  if (modifiedParts.size > 0 || namesChanged) {
    let wbXml = strFromU8(entries['xl/workbook.xml']!);
    if (namesChanged) wbXml = setDefinedNames(wbXml, book.names);
    wbXml = setFullCalcOnLoad(wbXml);
    checkXmlWellFormed(wbXml, 'xl/workbook.xml');
    entries['xl/workbook.xml'] = strToU8(wbXml);

    // Remove calc chain
    removeCalcChain(entries);
  }

  // Zip back up
  return zipSync(entries, { level: 6 });
}

/**
 * Insert rows before the one-based Excel row `at`. Negative count deletes rows.
 * Patch the target worksheet only; use the global shift helpers for other parts.
 * These operations are explicit and are never called implicitly by write().
 */
export function insertRows(sheetXml: string, sheetName: string, at: number, count: number): string {
  return shiftRows(sheetXml, sheetName, at, count);
}

/**
 * Delete `count` rows starting at the one-based Excel row `at`.
 * Supply sheetName to also shift references qualified with the target sheet name.
 */
export function deleteRows(sheetXml: string, at: number, count: number, sheetName = ''): string {
  if (count < 0) throw new FsheetError('write:invalid_rows', 'Delete count must be nonnegative');
  return shiftRows(sheetXml, sheetName, at, -count);
}

function shiftRows(sheetXml: string, sheetName: string, at: number, count: number): string {
  if (!Number.isSafeInteger(at) || at < 1 || !Number.isSafeInteger(count)) {
    throw new FsheetError('write:invalid_rows', 'Row position must be positive and count must be an integer');
  }
  if (count === 0) return sheetXml;
  const opts = { sheet: sheetName, at: at - 1, count };
  const shiftRange = (ref: string): string => shiftFormula(ref, opts);

  // Remove deleted rows before moving the survivors, including empty styled rows.
  sheetXml = sheetXml.replace(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g, (rowXml) => {
    const rowNum = Number(rowXml.match(/^<row\b[^>]*\br="(\d+)"/)?.[1]);
    if (count < 0 && rowNum >= at && rowNum < at - count) return '';
    return rowXml.replace(/<(row|c)\b[^>]*>/g, (tag) =>
      tag.replace(/\br="([A-Z]*)(\d+)"/, (attr, col: string, row: string) =>
        Number(row) >= at ? `r="${col}${Number(row) + count}"` : attr,
      ),
    );
  });

  // Ranges that are entirely deleted must not leave #REF! in XML attributes.
  sheetXml = sheetXml.replace(/<(dimension|mergeCell|hyperlink)\b[^>]*\/?\s*>/g, (tag, kind: string) => {
    const ref = tag.match(/\bref="([^"]*)"/)?.[1];
    if (ref === undefined) return tag;
    const shifted = shiftRange(ref);
    if (shifted === '#REF!') return kind === 'dimension' ? tag.replace(/\bref="[^"]*"/, 'ref="A1"') : '';
    return tag.replace(/\bref="[^"]*"/, () => `ref="${shifted}"`);
  });
  sheetXml = sheetXml.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/g, (block) => {
    const count = (block.match(/<mergeCell\b/g) ?? []).length;
    return count === 0 ? '' : block.replace(/\bcount="\d+"/, `count="${count}"`);
  });

  // Preserve the spike's conditional-formatting, validation and hyperlink shifts.
  sheetXml = sheetXml.replace(
    /<conditionalFormatting\b[^>]*>[\s\S]*?<\/conditionalFormatting>|<dataValidation\b[^>]*\/>|<dataValidation\b[^>]*>[\s\S]*?<\/dataValidation>/g,
    (block) => {
      const sqref = block.match(/\bsqref="([^"]*)"/)?.[1];
      if (sqref === undefined) return block;
      const shifted = sqref.split(/\s+/).map(shiftRange).filter((ref) => ref !== '#REF!').join(' ');
      return shifted ? block.replace(/\bsqref="[^"]*"/, () => `sqref="${shifted}"`) : '';
    },
  );
  sheetXml = sheetXml.replace(/<dataValidations\b[^>]*>[\s\S]*?<\/dataValidations>/g, (block) => {
    const count = (block.match(/<dataValidation\b/g) ?? []).length;
    return count === 0 ? '' : block.replace(/\bcount="\d+"/, `count="${count}"`);
  });

  // Shared/array formula ranges also describe positions on the target sheet.
  sheetXml = sheetXml.replace(/<f\b[^>]*>/g, (tag) =>
    tag.replace(/\bref="([^"]*)"/, (_attr, ref: string) => {
      const shifted = shiftRange(ref);
      return shifted === '#REF!' ? '' : `ref="${shifted}"`;
    }),
  );
  sheetXml = sheetXml.replace(/(<f\b[^>]*>)([^<]*)(<\/f>)/g, (_match, open: string, formula: string, close: string) =>
    open + xmlEscape(shiftFormula(xmlUnescape(formula), opts)) + close,
  );
  return dropCachedValues(sheetXml);
}

/** Shift only qualified references to sheetName; at is one-based, count is signed. */
function shiftQualifiedFormula(formula: string, sheetName: string, at: number, count: number): string {
  return tokenize(formula).map((token) => {
    if ((token.type === 'ref' || token.type === 'range') && token.text.includes('!')) {
      return shiftFormula(token.text, { sheet: sheetName, at: at - 1, count });
    }
    return token.text;
  }).join('');
}

/** Shift qualified references in another worksheet, leaving its local refs alone. */
export function shiftOtherSheetFormulas(sheetXml: string, sheetName: string, at: number, count: number): string {
  const shifted = sheetXml.replace(/(<f\b[^>]*>)([^<]*)(<\/f>)/g, (_match, open: string, formula: string, close: string) =>
    open + xmlEscape(shiftQualifiedFormula(xmlUnescape(formula), sheetName, at, count)) + close,
  );
  return shifted === sheetXml ? sheetXml : dropCachedValues(shifted);
}

/** Shift workbook names qualified with the target sheet, preserving name attributes. */
export function shiftDefinedNames(wbXml: string, sheetName: string, at: number, count: number): string {
  return wbXml.replace(/(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g, (_match, open: string, formula: string, close: string) =>
    open + xmlEscape(shiftQualifiedFormula(xmlUnescape(formula), sheetName, at, count)) + close,
  );
}

/** Shift chart source formulas, including charts using a default XML namespace. */
export function shiftChartFormulas(chartXml: string, sheetName: string, at: number, count: number): string {
  return chartXml.replace(/(<((?:[\w.-]+:)?f)\b[^>]*>)([^<]*)(<\/\2>)/g, (_match, open: string, _tag: string, formula: string, close: string) =>
    open + xmlEscape(shiftQualifiedFormula(xmlUnescape(formula), sheetName, at, count)) + close,
  );
}

/**
 * True when two cells hold the same content as read() reports it.
 * A missing cell equals an empty one. Formula cells compare by formula
 * only, because write drops their cached values.
 */
function cellsEqual(a: Cell | undefined, b: Cell | undefined): boolean {
  const fa = a?.f;
  const fb = b?.f;
  if (fa !== fb) return false;
  if (fa !== undefined) return true;
  return valuesEqual(normalizeValue(a?.v ?? null), normalizeValue(b?.v ?? null));
}

function valuesEqual(a: CellValue, b: CellValue): boolean {
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return a.error === b.error;
  }
  return Object.is(a, b) || (a === 0 && b === 0);
}

function namesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] === a[k]);
}

/**
 * Replace the workbook's <definedNames> block with `names`.
 * Original <definedName> elements whose name and value are unchanged are
 * kept as-is (with attributes such as localSheetId). An empty map removes
 * the block. A new block goes in schema order, before <calcPr>.
 */
export function setDefinedNames(wbXml: string, names: Record<string, string>): string {
  const blockPattern = /<definedNames\b[^>]*\/>|<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/;
  const existing = wbXml.match(blockPattern)?.[0] ?? '';

  // Keep unchanged original elements, keyed by decoded name
  const kept = new Map<string, string>();
  const elemPattern = /<definedName\s+([^>]*)>([\s\S]*?)<\/definedName>/g;
  let m;
  while ((m = elemPattern.exec(existing)) !== null) {
    const nameAttr = m[1]!.match(/name="([^"]*)"/)?.[1];
    if (nameAttr === undefined) continue;
    const name = xmlUnescape(nameAttr);
    if (
      Object.prototype.hasOwnProperty.call(names, name) &&
      names[name] === xmlUnescape(m[2]!.trim()) &&
      !kept.has(name)
    ) {
      kept.set(name, m[0]);
    }
  }

  const elems = Object.entries(names).map(
    ([name, value]) =>
      kept.get(name) ?? `<definedName name="${xmlEscape(name)}">${xmlEscape(value)}</definedName>`,
  );
  const block = elems.length > 0 ? `<definedNames>${elems.join('')}</definedNames>` : '';

  if (existing) return wbXml.replace(blockPattern, () => block);
  if (!block) return wbXml;

  for (const tag of ['</externalReferences>', '</functionGroups>', '<functionGroups/>', '</sheets>']) {
    const i = wbXml.indexOf(tag);
    if (i >= 0) return wbXml.slice(0, i + tag.length) + block + wbXml.slice(i + tag.length);
  }
  throw new FsheetError('write:no_sheets', 'xl/workbook.xml has no <sheets> element');
}

function xmlUnescape(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Escape XML special characters: & < > "
 */
export function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Set or update a cell in sheet XML.
 * - null cell: clear value but keep <c> if it has s= attribute, else remove entire <c>
 * - formula cell: <c><f>formula</f></c> (no <v>)
 * - string: <c t="inlineStr"><is><t xml:space="preserve">escaped</t></is></c>
 * - number: <c><v>number</v></c>
 * - boolean: <c t="b"><v>1|0</v></c>
 * - error: <c t="e"><v>#REF!</v></c>
 * 
 * Preserves s= attribute. Inserts cells in column-sorted order within <row>.
 * Creates <row r="N"> in row-sorted order if missing.
 */
export function setCell(sheetXml: string, ref: string, cell: Cell | null): string {
  const { row, col } = parseRef(ref);
  const rowNum = row + 1; // 1-indexed for XML

  // Find existing cell
  const cellPattern = new RegExp(`<c\\s+([^>]*r="${ref}"[^>]*)>.*?</c>`, 's');
  const cellMatch = sheetXml.match(cellPattern);

  // Extract existing s= attribute if present
  let styleAttr = '';
  if (cellMatch) {
    const attrs = cellMatch[1];
    const sMatch = attrs?.match(/s="(\d+)"/);
    if (sMatch) {
      styleAttr = ` s="${sMatch[1]}"`;
    }
  }

  // Build new cell XML
  let newCellXml = '';
  if (cell === null) {
    // Clear cell
    if (styleAttr) {
      // Keep empty <c> with style
      newCellXml = `<c r="${ref}"${styleAttr}/>`;
    } else {
      // Remove cell entirely
      if (cellMatch) {
        return sheetXml.replace(cellPattern, '');
      }
      return sheetXml; // Cell doesn't exist, nothing to do
    }
  } else if (cell.f !== undefined) {
    // Formula cell (no cached value)
    newCellXml = `<c r="${ref}"${styleAttr}><f>${xmlEscape(cell.f)}</f></c>`;
  } else if (typeof cell.v === 'string') {
    // Inline string
    newCellXml = `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell.v)}</t></is></c>`;
  } else if (typeof cell.v === 'number') {
    // Number
    newCellXml = `<c r="${ref}"${styleAttr}><v>${cell.v}</v></c>`;
  } else if (typeof cell.v === 'boolean') {
    // Boolean
    newCellXml = `<c r="${ref}"${styleAttr} t="b"><v>${cell.v ? '1' : '0'}</v></c>`;
  } else if (cell.v !== null && typeof cell.v === 'object' && 'error' in cell.v) {
    // Error
    newCellXml = `<c r="${ref}"${styleAttr} t="e"><v>${xmlEscape(cell.v.error)}</v></c>`;
  } else {
    // null value with no formula
    if (styleAttr) {
      newCellXml = `<c r="${ref}"${styleAttr}/>`;
    } else {
      if (cellMatch) {
        return sheetXml.replace(cellPattern, '');
      }
      return sheetXml;
    }
  }

  // Replace existing cell or insert new one
  if (cellMatch) {
    return sheetXml.replace(cellPattern, () => newCellXml);
  }

  // Cell doesn't exist, need to insert it
  // Find or create the row
  const rowPattern = new RegExp(`<row\\s+([^>]*r="${rowNum}"[^>]*)>(.*?)</row>`, 's');
  const rowMatch = sheetXml.match(rowPattern);

  if (rowMatch) {
    // Row exists, insert cell in column-sorted order
    const rowContent = rowMatch[2]!;
    const cells = extractCellsFromRow(rowContent);
    cells.push({ ref, col, xml: newCellXml });
    cells.sort((a, b) => a.col - b.col);

    const newRowContent = cells.map((c) => `\n      ${c.xml}`).join('');
    const newRowXml = `<row r="${rowNum}"${rowMatch[1]!.replace(/r="\d+"/, '').trim() ? ' ' + rowMatch[1]!.replace(/r="\d+"/, '').trim() : ''}>${newRowContent}\n    </row>`;
    
    return sheetXml.replace(rowPattern, () => newRowXml);
  } else {
    // Row doesn't exist, create it in row-sorted order
    const newRowXml = `<row r="${rowNum}">\n      ${newCellXml}\n    </row>`;
    
    // Find <sheetData> and insert row in sorted order
    const sheetDataPattern = /<sheetData([^>]*)>(.*?)<\/sheetData>/s;
    const sheetDataMatch = sheetXml.match(sheetDataPattern);
    
    if (sheetDataMatch) {
      const sheetDataContent = sheetDataMatch[2]!;
      const rows = extractRows(sheetDataContent);
      rows.push({ rowNum, xml: newRowXml });
      rows.sort((a, b) => a.rowNum - b.rowNum);

      const newSheetDataContent = rows.map((r) => `\n    ${r.xml}`).join('');
      const newSheetDataXml = `<sheetData${sheetDataMatch[1]!}>${newSheetDataContent}\n  </sheetData>`;
      
      return sheetXml.replace(sheetDataPattern, () => newSheetDataXml);
    } else {
      // Handle self-closing <sheetData/>
      const selfClosingPattern = /<sheetData([^>]*)\/>/;
      if (selfClosingPattern.test(sheetXml)) {
        const newSheetDataXml = `<sheetData>\n    ${newRowXml}\n  </sheetData>`;
        return sheetXml.replace(selfClosingPattern, () => newSheetDataXml);
      }
    }
  }

  return sheetXml;
}

/**
 * Extract cells from row content
 */
function extractCellsFromRow(rowContent: string): Array<{ ref: string; col: number; xml: string }> {
  const cells: Array<{ ref: string; col: number; xml: string }> = [];
  const cellPattern = /<c\s+[^>]*>.*?<\/c>/gs;
  let match;

  while ((match = cellPattern.exec(rowContent)) !== null) {
    const cellXml = match[0];
    const refMatch = cellXml.match(/r="([^"]+)"/);
    if (refMatch) {
      const ref = refMatch[1]!;
      const { col } = parseRef(ref);
      cells.push({ ref, col, xml: cellXml });
    }
  }

  return cells;
}

/**
 * Extract rows from sheetData content
 */
function extractRows(sheetDataContent: string): Array<{ rowNum: number; xml: string }> {
  const rows: Array<{ rowNum: number; xml: string }> = [];
  const rowPattern = /<row\s+[^>]*>.*?<\/row>/gs;
  let match;

  while ((match = rowPattern.exec(sheetDataContent)) !== null) {
    const rowXml = match[0];
    const rMatch = rowXml.match(/r="(\d+)"/);
    if (rMatch) {
      const rowNum = parseInt(rMatch[1]!, 10);
      rows.push({ rowNum, xml: rowXml });
    }
  }

  return rows;
}

/**
 * Drop cached values from formula cells.
 * Removes <v>...</v> inside <c> elements that contain <f>.
 */
export function dropCachedValues(sheetXml: string): string {
  // Match <c> tags that contain both <f> and <v>
  return sheetXml.replace(
    /<c\s+([^>]*)>(.*?)<\/c>/gs,
    (match, attrs, content) => {
      // Check if this cell has a formula
      if (content.includes('<f')) {
        // Remove <v> tag
        const newContent = content.replace(/<v>.*?<\/v>/s, '');
        return `<c ${attrs}>${newContent}</c>`;
      }
      return match;
    }
  );
}

/**
 * Set fullCalcOnLoad="1" in workbook XML.
 * Adds or updates <calcPr fullCalcOnLoad="1"/> in proper schema order.
 */
export function setFullCalcOnLoad(wbXml: string): string {
  // Check if <calcPr> already exists
  const calcPrPattern = /<calcPr\s+([^>]*)\/?>|<calcPr\s+([^>]*)>/;
  const calcPrMatch = wbXml.match(calcPrPattern);

  if (calcPrMatch) {
    // Update existing <calcPr>
    if (calcPrMatch[0].includes('fullCalcOnLoad')) {
      // Already has the attribute, update it
      return wbXml.replace(
        calcPrPattern,
        (match) => match.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"')
      );
    } else {
      // Add the attribute
      return wbXml.replace(
        calcPrPattern,
        (match) => match.replace(/(<calcPr\s+[^>]*)/, '$1 fullCalcOnLoad="1"')
      );
    }
  } else {
    // Insert new <calcPr> before </workbook>
    // Schema order: <calcPr> goes after <definedNames>/<sheets>, before <oleSize>/<customWorkbookViews>/<pivotCaches>/<extLst>
    const insertAfter = [
      '</definedNames>',
      '</sheets>',
    ];

    for (const tag of insertAfter) {
      if (wbXml.includes(tag)) {
        return wbXml.replace(
          tag,
          `${tag}\n  <calcPr fullCalcOnLoad="1"/>`
        );
      }
    }

    // Fallback: insert before </workbook>
    return wbXml.replace(
      '</workbook>',
      '  <calcPr fullCalcOnLoad="1"/>\n</workbook>'
    );
  }
}

/**
 * Remove calc chain from entries.
 * Deletes xl/calcChain.xml and removes its references from [Content_Types].xml
 * and xl/_rels/workbook.xml.rels.
 * 
 * @param entries - Mutable entries map
 */
export function removeCalcChain(entries: Record<string, Uint8Array>): void {
  // Delete xl/calcChain.xml
  delete entries['xl/calcChain.xml'];

  // Remove from [Content_Types].xml
  if (entries['[Content_Types].xml']) {
    let contentTypes = strFromU8(entries['[Content_Types].xml']);
    contentTypes = contentTypes.replace(
      /\s*<Override\s+PartName="\/xl\/calcChain\.xml"[^>]*\/>/g,
      ''
    );
    entries['[Content_Types].xml'] = strToU8(contentTypes);
  }

  // Remove from xl/_rels/workbook.xml.rels
  if (entries['xl/_rels/workbook.xml.rels']) {
    let rels = strFromU8(entries['xl/_rels/workbook.xml.rels']);
    rels = rels.replace(
      /\s*<Relationship\s+[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/g,
      ''
    );
    entries['xl/_rels/workbook.xml.rels'] = strToU8(rels);
  }
}

/**
 * Check if XML is well-formed.
 * Validates tag matching and proper nesting.
 * Skips <?...?>, <!--...--> and CDATA sections.
 * 
 * @param xml - XML string to check
 * @param path - File path for error reporting
 * @throws FsheetError with code 'XML_MALFORMED' if not well-formed
 */
export function checkXmlWellFormed(xml: string, path: string): void {
  const tagStack: string[] = [];
  let i = 0;

  while (i < xml.length) {
    const char = xml[i];

    if (char === '<') {
      const nextChar = xml[i + 1];

      // Skip XML declaration <?...?>
      if (nextChar === '?') {
        const endIndex = xml.indexOf('?>', i);
        if (endIndex === -1) {
          throw new FsheetError('XML_MALFORMED', `${path}: Unclosed XML declaration`);
        }
        i = endIndex + 2;
        continue;
      }

      // Skip comments <!--...-->
      if (xml.substring(i, i + 4) === '<!--') {
        const endIndex = xml.indexOf('-->', i);
        if (endIndex === -1) {
          throw new FsheetError('XML_MALFORMED', `${path}: Unclosed comment`);
        }
        i = endIndex + 3;
        continue;
      }

      // Skip CDATA <![CDATA[...]]>
      if (xml.substring(i, i + 9) === '<![CDATA[') {
        const endIndex = xml.indexOf(']]>', i);
        if (endIndex === -1) {
          throw new FsheetError('XML_MALFORMED', `${path}: Unclosed CDATA section`);
        }
        i = endIndex + 3;
        continue;
      }

      // Closing tag
      if (nextChar === '/') {
        const endIndex = xml.indexOf('>', i);
        if (endIndex === -1) {
          throw new FsheetError('XML_MALFORMED', `${path}: Unclosed closing tag`);
        }

        const tagName = xml.substring(i + 2, endIndex).trim();
        const lastOpen = tagStack.pop();

        if (lastOpen !== tagName) {
          throw new FsheetError(
            'XML_MALFORMED',
            `${path}: Mismatched closing tag </${tagName}>, expected </${lastOpen ?? 'none'}>`
          );
        }

        i = endIndex + 1;
        continue;
      }

      // Opening or self-closing tag
      const endIndex = xml.indexOf('>', i);
      if (endIndex === -1) {
        throw new FsheetError('XML_MALFORMED', `${path}: Unclosed tag`);
      }

      const tagContent = xml.substring(i + 1, endIndex);
      const selfClosing = tagContent.endsWith('/');

      // Extract tag name (first word before space or /)
      const tagNameMatch = tagContent.match(/^([^\s/>]+)/);
      if (tagNameMatch) {
        const tagName = tagNameMatch[1]!;

        if (!selfClosing) {
          tagStack.push(tagName);
        }
      }

      i = endIndex + 1;
      continue;
    }

    i++;
  }

  // Check for unclosed tags
  if (tagStack.length > 0) {
    throw new FsheetError(
      'XML_MALFORMED',
      `${path}: Unclosed tags: ${tagStack.join(', ')}`
    );
  }
}
