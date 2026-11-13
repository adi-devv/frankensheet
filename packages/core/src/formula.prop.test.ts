// Property tests for formula conversion and shifting

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { toA1, toR1C1, shiftFormula } from './formula.js';
import { arbFormula, arbPosition } from './testing/arbitraries.js';

const numRuns = Number(process.env.FC_RUNS ?? 1000);

describe('formula property tests', () => {
  it('P6: toA1(toR1C1(f, at), at) === f (round-trip)', () => {
    fc.assert(
      fc.property(arbFormula(), arbPosition(), (formula, at) => {
        const r1c1 = toR1C1(formula, at);
        const a1 = toA1(r1c1, at);
        return a1 === formula;
      }),
      { numRuns },
    );
  });

  it('P8: shift-then-unshift is identity', () => {
    fc.assert(
      fc.property(
        arbFormula(),
        fc.constantFrom('Sheet1', 'Sheet2', 'Data'),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        (formula, sheet, at, count) => {
          const shifted = shiftFormula(formula, { sheet, at, count });
          const unshifted = shiftFormula(shifted, { sheet, at, count: -count });
          return unshifted === formula;
        },
      ),
      { numRuns },
    );
  });
});
