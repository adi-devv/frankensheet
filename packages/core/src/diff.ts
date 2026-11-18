// Position-based workbook diff and application. Row matching is a Phase 3 seam.

import type { Book, BookDiff, Cell, CellChange, CellValue, Row, Sheet, SheetDiff } from './model.js';
import { toR1C1 } from './formula.js';

export interface AlignedRows {
  matched: Array<[rowA: Row | null, rowB: Row | null, idxA: number, idxB: number]>;
}

function rowExtent(rows: Map<number, Row>): number {
  let extent = 0;
  for (const index of rows.keys()) extent = Math.max(extent, index + 1);
  return extent;
}

/**
 * Match absolute row indices, including gaps inside a sparse sheet's extent.
 * Missing interior rows compare as empty rows; only the tail is inserted/deleted.
 * Walk populated indices rather than allocating an array up to Excel's last row.
 */
export function alignRows(a: Map<number, Row>, b: Map<number, Row>): AlignedRows {
  const matched: AlignedRows['matched'] = [];
  const extentA = rowExtent(a);
  const extentB = rowExtent(b);
  const indices = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);

  for (const index of indices) {
    const rowA = index < extentA ? a.get(index) ?? { cells: new Map<number, Cell>() } : null;
    const rowB = index < extentB ? b.get(index) ?? { cells: new Map<number, Cell>() } : null;
    matched.push([rowA, rowB, rowA === null ? -1 : index, rowB === null ? -1 : index]);
  }
  return { matched };
}

function equalValue(a: CellValue, b: CellValue): boolean {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return a.error === b.error;
  }
  return Object.is(a, b);
}

function relativeFormula(cell: Cell | undefined, row: number, col: number): string | null {
  return cell?.f === undefined ? null : toR1C1(cell.f, { row, col });
}

function changeKind(before: Cell | undefined, after: Cell | undefined, idxA: number, idxB: number, col: number): CellChange['kind'] | undefined {
  if (before === undefined || after === undefined) {
    return (before ?? after)?.f === undefined ? 'value' : 'formula';
  }
  const valueChanged = !equalValue(before.v, after.v);
  const formulaChanged = relativeFormula(before, idxA, col) !== relativeFormula(after, idxB, col);
  if (valueChanged && formulaChanged) return 'both';
  if (valueChanged) return 'value';
  if (formulaChanged) return 'formula';
  return undefined;
}

function cloneCell(cell: Cell): Cell {
  return { ...cell, v: typeof cell.v === 'object' && cell.v !== null ? { ...cell.v } : cell.v };
}

function cloneRow(row: Row): Row {
  return { ...row, cells: new Map([...row.cells].map(([col, cell]) => [col, cloneCell(cell)])) };
}

function cloneSheet(sheet: Sheet): Sheet {
  return { ...sheet, rows: new Map([...sheet.rows].map(([index, row]) => [index, cloneRow(row)])) };
}

function sameIndices(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((index, i) => index === b[i]);
}

function diffSheet(a: Sheet, b: Sheet): SheetDiff {
  const result: SheetDiff = { rowOps: [], cellChanges: [] };
  for (const [rowA, rowB, idxA, idxB] of alignRows(a.rows, b.rows).matched) {
    if (rowA === null && rowB !== null) {
      result.rowOps.push({ type: 'insert', at: idxB, content: cloneRow(rowB) });
    } else if (rowB === null && rowA !== null) {
      // Descending deletes keep each coordinate valid when apply executes them.
      result.rowOps.unshift({ type: 'delete', at: idxA });
    } else if (rowA !== null && rowB !== null) {
      const cols = [...new Set([...rowA.cells.keys(), ...rowB.cells.keys()])].sort((x, y) => x - y);
      for (const col of cols) {
        const before = rowA.cells.get(col);
        const after = rowB.cells.get(col);
        const kind = changeKind(before, after, idxA, idxB, col);
        if (kind === undefined) continue;
        result.cellChanges.push({
          row: idxB,
          col,
          ...(before === undefined ? {} : { before: cloneCell(before) }),
          ...(after === undefined ? {} : { after: cloneCell(after) }),
          kind,
        });
      }
    }
  }
  const indicesA = [...a.rows.keys()].sort((x, y) => x - y);
  const indicesB = [...b.rows.keys()].sort((x, y) => x - y);
  if (!sameIndices(indicesA, indicesB)) result.rowIndices = indicesB;
  if (a.colCount !== b.colCount) result.colCount = b.colCount;
  return result;
}

/** Compute cell and tail-row changes without shifting formula references. */
export function diff(a: Book, b: Book): BookDiff {
  const sheetsA = new Map(a.sheets.map((sheet) => [sheet.name, sheet]));
  const sheetsB = new Map(b.sheets.map((sheet) => [sheet.name, sheet]));
  const entries: Array<[string, SheetDiff]> = [];
  for (const [name, sheetA] of sheetsA) {
    const sheetB = sheetsB.get(name);
    entries.push([name, sheetB === undefined
      ? { sheetRemoved: true, rowOps: [], cellChanges: [] }
      : diffSheet(sheetA, sheetB)]);
  }
  for (const [name, sheetB] of sheetsB) {
    if (sheetsA.has(name)) continue;
    entries.push([name, {
      sheetAdded: true,
      addedSheet: cloneSheet(sheetB),
      rowOps: [...sheetB.rows].sort(([x], [y]) => x - y)
        .map(([at, row]) => ({ type: 'insert', at, content: cloneRow(row) })),
      cellChanges: [],
    }]);
  }
  const result: BookDiff = { sheets: Object.fromEntries(entries) };
  const orderA = a.sheets.map((sheet) => sheet.name);
  const orderB = b.sheets.map((sheet) => sheet.name);
  if (orderA.length !== orderB.length || orderA.some((name, i) => name !== orderB[i])) {
    result.sheetOrder = orderB;
  }
  const namesA = Object.keys(a.names).sort();
  const namesB = Object.keys(b.names).sort();
  if (namesA.length !== namesB.length || namesA.some((name, i) => name !== namesB[i] || a.names[name] !== b.names[name])) {
    result.names = { ...b.names };
  }
  if (a.date1904 !== b.date1904) result.date1904 = b.date1904;
  return result;
}

function rowSignature(row: Row, index: number): string {
  return JSON.stringify([...row.cells].sort(([x], [y]) => x - y).map(([col, cell]) => {
    const value = typeof cell.v === 'number'
      ? ['number', Object.is(cell.v, -0) ? '-0' : String(cell.v)]
      : cell.v;
    return [col, value, relativeFormula(cell, index, col)];
  }));
}

/** Apply a valid diff to a copy of a book; mismatched before cells warn and overwrite. */
export function apply(delta: BookDiff, a: Book): Book {
  const result: Book = { ...a, names: { ...a.names }, sheets: a.sheets.map(cloneSheet) };
  for (const [name, changes] of Object.entries(delta.sheets)) {
    if (changes.sheetRemoved) {
      result.sheets = result.sheets.filter((sheet) => sheet.name !== name);
      continue;
    }
    if (changes.sheetAdded) {
      if (changes.addedSheet !== undefined) {
        const sheet = cloneSheet(changes.addedSheet);
        for (const [index, row] of sheet.rows) row.sig = rowSignature(row, index);
        result.sheets.push(sheet);
        continue; // addedSheet already contains rowOps' content.
      }
      result.sheets.push({ name, rows: new Map(), colCount: 0 });
    }
    const sheet = result.sheets.find((candidate) => candidate.name === name);
    if (sheet === undefined) continue;
    const touched = new Set<Row>();
    for (const op of changes.rowOps) {
      const count = op.count ?? 1;
      const rows = new Map<number, Row>();
      for (const [index, row] of sheet.rows) {
        if (op.type === 'delete' && index >= op.at && index < op.at + count) continue;
        const next = index < op.at ? index : index + (op.type === 'insert' ? count : -count);
        rows.set(next, row);
        if (next !== index) touched.add(row);
      }
      if (op.type === 'insert') {
        const row = op.content === undefined ? { cells: new Map<number, Cell>() } : cloneRow(op.content);
        rows.set(op.at, row);
        touched.add(row);
      }
      sheet.rows = rows;
    }
    for (const change of changes.cellChanges) {
      let row = sheet.rows.get(change.row);
      const current = row?.cells.get(change.col);
      if ((current === undefined) !== (change.before === undefined)
        || (current !== undefined && change.before !== undefined
          && (!equalValue(current.v, change.before.v)
            || relativeFormula(current, change.row, change.col) !== relativeFormula(change.before, change.row, change.col)))) {
        console.warn(`apply: before mismatch at ${name}!row ${change.row}, col ${change.col}`);
      }
      if (row === undefined) {
        row = { cells: new Map() };
        sheet.rows.set(change.row, row);
      }
      if (change.after === undefined) row.cells.delete(change.col);
      else row.cells.set(change.col, cloneCell(change.after));
      touched.add(row);
    }
    if (changes.rowIndices !== undefined) {
      const indices = new Set(changes.rowIndices);
      for (const index of sheet.rows.keys()) if (!indices.has(index)) sheet.rows.delete(index);
      for (const index of indices) {
        if (!sheet.rows.has(index)) {
          const row: Row = { cells: new Map() };
          sheet.rows.set(index, row);
          touched.add(row);
        }
      }
    }
    for (const [index, row] of sheet.rows) if (touched.has(row)) row.sig = rowSignature(row, index);
    if (changes.colCount !== undefined) sheet.colCount = changes.colCount;
    else {
      let colCount = 0;
      for (const row of sheet.rows.values()) {
        for (const col of row.cells.keys()) colCount = Math.max(colCount, col + 1);
      }
      sheet.colCount = Math.max(sheet.colCount, colCount);
    }
  }
  if (delta.sheetOrder !== undefined) {
    const sheets = new Map(result.sheets.map((sheet) => [sheet.name, sheet]));
    result.sheets = delta.sheetOrder.map((name) => sheets.get(name)!).filter((sheet) => sheet !== undefined);
  }
  if (delta.names !== undefined) result.names = { ...delta.names };
  if (Object.hasOwn(delta, 'date1904')) result.date1904 = delta.date1904;
  return result;
}
