/**
 * plan-b-fflate.ts — Phase 1 fidelity spike (Plan B)
 *
 * Reads a fixture .xlsx with fflate, patches XML for the FIRST sheet via
 * string/regex, then writes the result. The goal is to verify that direct
 * XML patching can handle row inserts (shifting references everywhere) without
 * corrupting the workbook.
 *
 * Usage:
 *   npx tsx spike/plan-b-fflate.ts <input.xlsx> [output.xlsx]
 *
 * If no output path is given, writes to fixtures/out/<name>.spike-b.xlsx
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npx tsx spike/plan-b-fflate.ts <input.xlsx> [output.xlsx]');
    process.exit(1);
  }

  const outputPath =
    process.argv[3] ?? `fixtures/out/${parse(inputPath).name}.spike-b.xlsx`;

  // --- Read ---
  const bytes = readFileSync(inputPath);
  const entries = unzipSync(bytes);

  console.log(`Read: ${inputPath}`);
  console.log(`  Zip entries: ${Object.keys(entries).length}`);

  // Resolve first sheet
  const workbookXml = strFromU8(entries['xl/workbook.xml']!);
  const sheetId = workbookXml.match(/<sheet[^>]+sheetId="1"[^>]*>/)?.[0];
  if (!sheetId) {
    console.error('  No sheet with sheetId="1" found.');
    process.exit(1);
  }
  const rIdMatch = sheetId.match(/r:id="([^"]+)"/);
  if (!rIdMatch) {
    console.error('  No r:id on first sheet.');
    process.exit(1);
  }
  const rId = rIdMatch[1];

  const workbookRels = strFromU8(entries['xl/_rels/workbook.xml.rels']!);
  // Parse relationships: <Relationship ... Id="..." Target="..." Type="..." />
  const relationships = new Map<string, string>();
  const relPattern = /<Relationship([^>]+)\/>/g;
  let relMatch;
  while ((relMatch = relPattern.exec(workbookRels)) !== null) {
    const attrs = relMatch[1]!;
    const idMatch = attrs.match(/Id="([^"]+)"/);
    const targetMatch = attrs.match(/Target="([^"]+)"/);
    if (idMatch && targetMatch) {
      relationships.set(idMatch[1]!, targetMatch[1]!);
    }
  }

  const target = relationships.get(rId);
  if (!target) {
    console.error(`  Could not resolve r:id="${rId}".`);
    process.exit(1);
  }
  // Resolve target path: if starts with '/', strip it (absolute); else join relative to xl/
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheetNameMatch = sheetId.match(/name="([^"]+)"/);
  const sheetName = sheetNameMatch?.[1] ?? 'Sheet1';

  console.log(`  First sheet: "${sheetName}" → ${sheetPath}`);

  // --- Edits ---
  let sheetXml = strFromU8(entries[sheetPath]!);

  // Change B2 to inline string 'SPIKE-B-CHANGED'
  sheetXml = setCell(sheetXml, 'B2', {
    type: 'inlineStr',
    value: 'SPIKE-B-CHANGED',
  });
  console.log(`  Changed B2 → "SPIKE-B-CHANGED" (inline string)`);

  // Change C2 to number 42
  sheetXml = setCell(sheetXml, 'C2', { type: 'n', value: '42' });
  console.log(`  Changed C2 → 42`);

  // Change E5 to number 999
  sheetXml = setCell(sheetXml, 'E5', { type: 'n', value: '999' });
  console.log(`  Changed E5 → 999`);

  // Insert 2 rows before row 3 (target sheet only)
  sheetXml = insertRows(sheetXml, sheetName, 3, 2);
  console.log(`  Inserted 2 rows at row 3`);

  // Add data to new rows
  sheetXml = setCell(sheetXml, 'A3', { type: 'inlineStr', value: 'INSERTED-1' });
  sheetXml = setCell(sheetXml, 'A4', { type: 'inlineStr', value: 'INSERTED-2' });
  sheetXml = setCell(sheetXml, 'B3', { type: 'n', value: '100' });
  sheetXml = setCell(sheetXml, 'B4', { type: 'n', value: '200' });

  // Drop formula cached values in this sheet
  sheetXml = dropCachedValues(sheetXml);

  entries[sheetPath] = strToU8(sheetXml);

  // Shift formulas in all other sheets (only qualified refs to target sheet)
  for (const key of Object.keys(entries)) {
    if (key.startsWith('xl/worksheets/') && key !== sheetPath) {
      let otherXml = strFromU8(entries[key]!);
      otherXml = shiftFormulasInOtherSheet(otherXml, sheetName, 3, 2);
      otherXml = dropCachedValues(otherXml);
      entries[key] = strToU8(otherXml);
    }
  }

  // Shift defined names
  let wbXml = workbookXml;
  wbXml = shiftDefinedNames(wbXml, sheetName, 3, 2);
  wbXml = setFullCalcOnLoad(wbXml);
  entries['xl/workbook.xml'] = strToU8(wbXml);

  // Shift charts
  for (const key of Object.keys(entries)) {
    if (key.startsWith('xl/charts/') && key.endsWith('.xml')) {
      let chartXml = strFromU8(entries[key]!);
      chartXml = shiftChartFormulas(chartXml, sheetName, 3, 2);
      entries[key] = strToU8(chartXml);
    }
  }

  // Remove calcChain
  delete entries['xl/calcChain.xml'];
  let contentTypes = strFromU8(entries['[Content_Types].xml']!);
  contentTypes = contentTypes.replace(
    /<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>\s*/g,
    ''
  );
  entries['[Content_Types].xml'] = strToU8(contentTypes);

  if (entries['xl/_rels/workbook.xml.rels']) {
    let wbRels = strFromU8(entries['xl/_rels/workbook.xml.rels']!);
    wbRels = wbRels.replace(
      /<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>\s*/g,
      ''
    );
    entries['xl/_rels/workbook.xml.rels'] = strToU8(wbRels);
  }

  // --- Validate XML well-formedness ---
  const changedXmlPaths = [
    'xl/workbook.xml',
    '[Content_Types].xml',
    'xl/_rels/workbook.xml.rels',
    sheetPath,
    ...Object.keys(entries).filter(
      (k) =>
        (k.startsWith('xl/worksheets/') && k !== sheetPath) ||
        (k.startsWith('xl/charts/') && k.endsWith('.xml'))
    ),
  ];

  for (const path of changedXmlPaths) {
    if (entries[path]) {
      checkXmlWellFormed(strFromU8(entries[path]!), path);
    }
  }

  console.log(`  XML validation passed for ${changedXmlPaths.filter((p) => entries[p]).length} files`);

  // --- Write ---
  const out = zipSync(entries, { level: 6 });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, out);
  console.log(`Wrote: ${outputPath}`);
}

// --- Helpers ---

interface CellValue {
  type: 'n' | 'inlineStr' | 's';
  value: string;
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setCell(xml: string, ref: string, val: CellValue): string {
  const cellPattern = new RegExp(`<c r="${ref}"[^>]*>.*?</c>`, 's');
  const cellMatch = xml.match(cellPattern);

  let newCell = `<c r="${ref}"`;
  
  // If cell exists, extract and preserve attributes (except t and r)
  if (cellMatch) {
    const existingAttrs = cellMatch[0]!.match(/<c ([^>]+)>/)?.[1] ?? '';
    const attrs = existingAttrs.split(/\s+/).filter((attr) => {
      const attrName = attr.split('=')[0];
      return attrName && attrName !== 'r' && attrName !== 't';
    });
    if (attrs.length > 0) {
      newCell += ' ' + attrs.join(' ');
    }
  }

  if (val.type === 'inlineStr') {
    newCell += ` t="inlineStr"><is><t>${xmlEscape(val.value)}</t></is></c>`;
  } else if (val.type === 's') {
    newCell += ` t="s"><v>${xmlEscape(val.value)}</v></c>`;
  } else {
    // Number: no t attribute
    newCell += `><v>${xmlEscape(val.value)}</v></c>`;
  }

  if (cellPattern.test(xml)) {
    return xml.replace(cellPattern, newCell);
  }

  // Cell doesn't exist; insert it into the correct row
  const [, colPart, rowStr] = ref.match(/^([A-Z]+)(\d+)$/)!;
  const rowNum = parseInt(rowStr, 10);
  const rowPattern = new RegExp(`(<row[^>]+r="${rowNum}"[^>]*>)(.*?)(</row>)`, 's');
  const rowMatch = xml.match(rowPattern);

  if (rowMatch) {
    const [fullMatch, open, cells, close] = rowMatch;
    // Find all cell tags to determine insertion point
    const cellTags: Array<{ fullTag: string; ref: string; startIdx: number }> = [];
    const cellRegex = /<c [^>]*r="([^"]+)"[^>]*>.*?<\/c>/gs;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(cells)) !== null) {
      cellTags.push({
        fullTag: cellMatch[0],
        ref: cellMatch[1]!,
        startIdx: cellMatch.index,
      });
    }

    const insertIdx = cellTags.findIndex((c) => colOrder(c.ref) > colOrder(ref));
    
    if (insertIdx === -1) {
      // Append at end
      return xml.replace(rowPattern, `${open}${cells}${newCell}${close}`);
    } else {
      // Insert before the found cell
      const insertPos = cellTags[insertIdx]!.startIdx;
      const before = cells.slice(0, insertPos);
      const after = cells.slice(insertPos);
      return xml.replace(rowPattern, `${open}${before}${newCell}${after}${close}`);
    }
  } else {
    // Row doesn't exist; create it in correct sorted position
    const newRow = `<row r="${rowNum}">${newCell}</row>`;
    const sheetDataPattern = /(<sheetData[^>]*>)(.*?)(<\/sheetData>)/s;
    return xml.replace(sheetDataPattern, (fullMatch, open, rows, close) => {
      // Find all row tags
      const rowTags: Array<{ fullTag: string; rowNum: number; startIdx: number }> = [];
      const rowRegex = /<row [^>]*r="(\d+)"[^>]*>.*?<\/row>/gs;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = rowRegex.exec(rows)) !== null) {
        rowTags.push({
          fullTag: rMatch[0],
          rowNum: parseInt(rMatch[1]!, 10),
          startIdx: rMatch.index,
        });
      }

      const insertIdx = rowTags.findIndex((r) => r.rowNum > rowNum);
      
      if (insertIdx === -1) {
        // Append at end
        return `${open}${rows}${newRow}${close}`;
      } else {
        // Insert before the found row
        const insertPos = rowTags[insertIdx]!.startIdx;
        const before = rows.slice(0, insertPos);
        const after = rows.slice(insertPos);
        return `${open}${before}${newRow}${after}${close}`;
      }
    });
  }
}

function colOrder(ref: string): number {
  const col = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let val = 0;
  for (let i = 0; i < col.length; i++) {
    val = val * 26 + (col.charCodeAt(i) - 64);
  }
  return val;
}

function insertRows(xml: string, targetSheetName: string, at: number, count: number): string {
  // Shift <row r> (target sheet only)
  xml = xml.replace(/<row ([^>]*)r="(\d+)"([^>]*)>/g, (m, pre, r, post) => {
    const rowNum = parseInt(r, 10);
    if (rowNum >= at) {
      return `<row ${pre}r="${rowNum + count}"${post}>`;
    }
    return m;
  });

  // Shift <c r> (target sheet only)
  xml = xml.replace(/<c ([^>]*)r="([A-Z]+)(\d+)"([^>]*)>/g, (m, pre, col, row, post) => {
    const rowNum = parseInt(row, 10);
    if (rowNum >= at) {
      return `<c ${pre}r="${col}${rowNum + count}"${post}>`;
    }
    return m;
  });

  // Shift <dimension ref>
  xml = xml.replace(/<dimension ref="([^"]+)"\/>/g, (m, ref) => {
    return `<dimension ref="${shiftRange(ref, at, count)}"/>`;
  });

  // Shift <mergeCell ref>
  xml = xml.replace(/<mergeCell ref="([^"]+)"\/>/g, (m, ref) => {
    return `<mergeCell ref="${shiftRange(ref, at, count)}"/>`;
  });

  // Shift conditionalFormatting sqref
  xml = xml.replace(/(<conditionalFormatting [^>]*)sqref="([^"]+)"([^>]*>)/g, (m, pre, sq, post) => {
    return `${pre}sqref="${shiftSqref(sq, at, count)}"${post}`;
  });

  // Shift dataValidation sqref
  xml = xml.replace(/(<dataValidation [^>]*)sqref="([^"]+)"([^>]*>)/g, (m, pre, sq, post) => {
    return `${pre}sqref="${shiftSqref(sq, at, count)}"${post}`;
  });

  // Shift hyperlink ref
  xml = xml.replace(/<hyperlink ([^>]*)ref="([^"]+)"([^>]*)\/>/g, (m, pre, ref, post) => {
    return `<hyperlink ${pre}ref="${shiftRef(ref, at, count)}"${post}/>`;
  });

  // Shift formulas on target sheet (unqualified + qualified with target name)
  // Use single replace with callback to prevent double-shifting
  xml = xml.replace(/<f([^>]*)>(.*?)<\/f>/gs, (m, attrs, formula) => {
    const shifted = shiftFormulaOnTargetSheet(formula, targetSheetName, at, count);
    return `<f${attrs}>${shifted}</f>`;
  });

  // Shift shared formula ref= ranges
  xml = xml.replace(/<f ([^>]*)ref="([^"]+)"([^>]*)>/g, (m, pre, ref, post) => {
    return `<f ${pre}ref="${shiftRange(ref, at, count)}"${post}>`;
  });

  return xml;
}

function shiftRef(ref: string, at: number, count: number): string {
  return ref.replace(/([A-Z]+)(\$?)(\d+)/g, (m, col, anchor, row) => {
    const rowNum = parseInt(row, 10);
    if (rowNum >= at) {
      return `${col}${anchor}${rowNum + count}`;
    }
    return m;
  });
}

function shiftRange(range: string, at: number, count: number): string {
  if (range.includes(':')) {
    const [start, end] = range.split(':');
    return `${shiftRef(start!, at, count)}:${shiftRef(end!, at, count)}`;
  }
  return shiftRef(range, at, count);
}

function shiftSqref(sqref: string, at: number, count: number): string {
  return sqref
    .split(/\s+/)
    .map((r) => shiftRange(r, at, count))
    .join(' ');
}

/**
 * Shift formula on the target sheet: shift unqualified refs + refs qualified with targetSheetName.
 * Do NOT shift refs qualified with other sheet names.
 */
function shiftFormulaOnTargetSheet(formula: string, targetSheetName: string, at: number, count: number): string {
  // Helper to shift a single ref
  const shiftSingleRef = (col: string, colAnchor: string, row: string, rowAnchor: string): string => {
    const rowNum = parseInt(row, 10);
    if (rowNum >= at) {
      return `${colAnchor}${col}${rowAnchor}${rowNum + count}`;
    }
    return `${colAnchor}${col}${rowAnchor}${row}`;
  };

  // Escape sheet name for regex
  const escapedName = targetSheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Pattern to match ranges including both ends
  // Matches: SheetName!$?A$?1 or SheetName!$?A$?1:$?B$?2 or 'SheetName'!$?A$?1 etc.
  // Also matches unqualified refs
  const refPattern = /(?:([A-Za-z0-9_]+|'[^']+')\!)?(\$?)([A-Z]+)(\$?)(\d+)(?::(\$?)([A-Z]+)(\$?)(\d+))?/g;
  
  return formula.replace(refPattern, (match, sheetPrefix, col1Anchor, col1, row1Anchor, row1, col2Anchor, col2, row2Anchor, row2) => {
    // Check if this is a whole-column ref like A:A or $A:$A (skip those)
    if (!row1 || !row2 && match.includes(':')) {
      return match;
    }

    if (!sheetPrefix) {
      // Unqualified ref or range: shift both ends
      let result = shiftSingleRef(col1, col1Anchor, row1, row1Anchor);
      if (row2) {
        result += ':' + shiftSingleRef(col2, col2Anchor, row2, row2Anchor);
      }
      return result;
    }
    
    // Qualified ref: check if it matches target sheet name
    const normalizedPrefix = sheetPrefix.replace(/^'|'$/g, ''); // Remove quotes
    if (normalizedPrefix === targetSheetName) {
      // Qualified with target sheet: shift both ends
      let result = sheetPrefix + '!' + shiftSingleRef(col1, col1Anchor, row1, row1Anchor);
      if (row2) {
        result += ':' + shiftSingleRef(col2, col2Anchor, row2, row2Anchor);
      }
      return result;
    }
    
    // Qualified with another sheet: don't shift
    return match;
  });
}

/**
 * Shift formula on another sheet (not target): shift ONLY refs qualified with targetSheetName.
 * Leave unqualified refs and refs qualified with other sheets alone.
 */
function shiftFormulaOnOtherSheet(formula: string, targetSheetName: string, at: number, count: number): string {
  // Helper to shift a single ref
  const shiftSingleRef = (col: string, colAnchor: string, row: string, rowAnchor: string): string => {
    const rowNum = parseInt(row, 10);
    if (rowNum >= at) {
      return `${colAnchor}${col}${rowAnchor}${rowNum + count}`;
    }
    return `${colAnchor}${col}${rowAnchor}${row}`;
  };

  const escapedName = targetSheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Pattern to match qualified refs with ranges: SheetName!$?A$?1 or SheetName!$?A$?1:$?B$?2 or 'SheetName'!...
  const qualifiedRefPattern = /([A-Za-z0-9_]+|'[^']+')\!(\$?)([A-Z]+)(\$?)(\d+)(?::(\$?)([A-Z]+)(\$?)(\d+))?/g;
  
  return formula.replace(qualifiedRefPattern, (match, sheetPrefix, col1Anchor, col1, row1Anchor, row1, col2Anchor, col2, row2Anchor, row2) => {
    // Check if this is a whole-column ref like A:A or $A:$A (skip those)
    if (!row1 || !row2 && match.includes(':')) {
      return match;
    }

    // Remove quotes for comparison
    const normalizedPrefix = sheetPrefix.replace(/^'|'$/g, '');
    if (normalizedPrefix === targetSheetName) {
      // Qualified with target sheet: shift both ends
      let result = sheetPrefix + '!' + shiftSingleRef(col1, col1Anchor, row1, row1Anchor);
      if (row2) {
        result += ':' + shiftSingleRef(col2, col2Anchor, row2, row2Anchor);
      }
      return result;
    }
    
    // Qualified with another sheet: don't shift
    return match;
  });
}

function shiftFormulasInOtherSheet(xml: string, targetSheetName: string, at: number, count: number): string {
  return xml.replace(/<f([^>]*)>(.*?)<\/f>/gs, (m, attrs, formula) => {
    const shifted = shiftFormulaOnOtherSheet(formula, targetSheetName, at, count);
    return `<f${attrs}>${shifted}</f>`;
  });
}

function shiftDefinedNames(wbXml: string, targetSheetName: string, at: number, count: number): string {
  return wbXml.replace(/<definedName([^>]*)>(.*?)<\/definedName>/gs, (m, attrs, content) => {
    // Defined names: shift only refs qualified with target sheet
    const shifted = shiftFormulaOnOtherSheet(content, targetSheetName, at, count);
    return `<definedName${attrs}>${shifted}</definedName>`;
  });
}

function shiftChartFormulas(chartXml: string, targetSheetName: string, at: number, count: number): string {
  return chartXml.replace(/<c:f>(.*?)<\/c:f>/gs, (m, formula) => {
    // Chart formulas: shift only refs qualified with target sheet
    const shifted = shiftFormulaOnOtherSheet(formula, targetSheetName, at, count);
    return `<c:f>${shifted}</c:f>`;
  });
}

function dropCachedValues(xml: string): string {
  return xml.replace(/<c ([^>]*)>(<f[^>]*>.*?<\/f>)<v>.*?<\/v><\/c>/gs, '<c $1>$2</c>');
}

function setFullCalcOnLoad(wbXml: string): string {
  if (/<calcPr[^>]*\/?>/.test(wbXml)) {
    return wbXml.replace(/<calcPr([^>]*?)(\/?>)/g, (match, attrs, closing) => {
      // Check if fullCalcOnLoad already exists
      if (/fullCalcOnLoad=/.test(attrs)) {
        // Replace existing value
        const updated = attrs.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="1"');
        return `<calcPr${updated}${closing}`;
      } else {
        // Add new attribute
        return `<calcPr${attrs} fullCalcOnLoad="1"${closing}`;
      }
    });
  } else {
    return wbXml.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
  }
}

function checkXmlWellFormed(xml: string, filePath: string): void {
  const stack: string[] = [];
  const tagRegex = /<\/?([a-zA-Z_:][\w:.-]*)[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const fullTag = match[0];
    const tagName = match[1]!;

    if (fullTag.startsWith('</')) {
      // Closing tag
      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        throw new Error(`XML malformed in ${filePath}: unexpected closing tag </${tagName}>`);
      }
      stack.pop();
    } else if (fullTag.endsWith('/>')) {
      // Self-closing tag
      continue;
    } else {
      // Opening tag
      stack.push(tagName);
    }
  }

  if (stack.length > 0) {
    throw new Error(`XML malformed in ${filePath}: unclosed tags: ${stack.join(', ')}`);
  }
}

main();
