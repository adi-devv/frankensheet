import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { normalizeValue } from './normalize.js';
import type { CellValue } from './model.js';

const numRuns = Number(process.env.FC_RUNS ?? 1000);

// Arbitrary for CellValue
function arbCellValue(): fc.Arbitrary<CellValue> {
  return fc.oneof(
    fc.constant(null),
    fc.double({ noNaN: true }),
    fc.string(),
    fc.boolean(),
    fc.record({ error: fc.constantFrom('#REF!', '#DIV/0!', '#VALUE!', '#N/A', '#NAME?', '#NUM!', '#NULL!') }),
  );
}

describe('normalizeValue properties', () => {
  it('should be idempotent', () => {
    fc.assert(
      fc.property(arbCellValue(), (v) => {
        const once = normalizeValue(v);
        const twice = normalizeValue(once);
        return twice === once || (twice === null && once === null) || JSON.stringify(twice) === JSON.stringify(once);
      }),
      { numRuns },
    );
  });

  it('should never return empty string', () => {
    fc.assert(
      fc.property(arbCellValue(), (v) => {
        const result = normalizeValue(v);
        return result !== '';
      }),
      { numRuns },
    );
  });
});
