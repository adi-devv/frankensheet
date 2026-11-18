// Stable, line-per-cell workbook representation for git's textconv driver.

import type { Book, Cell } from './model.js';
import { indexToCol } from './formula.js';
import { normalizeValue } from './normalize.js';

function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function cellText(cell: Cell): string | undefined {
  if (cell.f !== undefined) return `=${escape(cell.f)}`;
  const value = normalizeValue(cell.v);
  if (value === null) return undefined;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') return escape(value.error);
  if (typeof value === 'string') return `${value.startsWith('=') ? "'" : ''}${escape(value)}`;
  return String(value);
}

/** Sheets retain workbook order; names and sparse cell coordinates are sorted. */
export function toTextconv(book: Book): string {
  const sections: string[] = [];
  const names = Object.keys(book.names).sort();
  if (names.length > 0) {
    sections.push(['# Defined names:', ...names.map((name) => `${escape(name)}: ${escape(book.names[name]!)}`)].join('\n'));
  }
  for (const sheet of book.sheets) {
    const lines = [`[${escape(sheet.name)}]`];
    for (const [index, row] of [...sheet.rows].sort(([a], [b]) => a - b)) {
      for (const [col, cell] of [...row.cells].sort(([a], [b]) => a - b)) {
        const text = cellText(cell);
        if (text !== undefined) lines.push(`${indexToCol(col)}${index + 1}: ${text}`);
      }
    }
    sections.push(lines.join('\n'));
  }
  return sections.length === 0 ? '' : `${sections.join('\n\n')}\n`;
}
