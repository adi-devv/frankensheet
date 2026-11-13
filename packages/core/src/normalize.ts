// Value normalization per spreadsheet-semantics.md

import type { CellValue } from './model.js';

/**
 * Normalize a cell value according to Frankensheet semantics:
 * - Empty string → null
 * - Numbers, booleans, errors: unchanged
 * - Non-empty strings: unchanged (no trimming)
 * - Already null: unchanged
 * 
 * Idempotent: normalize(normalize(v)) === normalize(v)
 */
export function normalizeValue(v: CellValue): CellValue {
  // Empty string becomes null
  if (v === '') {
    return null;
  }

  // Everything else is unchanged
  return v;
}
