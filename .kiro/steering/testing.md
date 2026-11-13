---
inclusion: always
---
# Testing rules

- Every exported function in `packages/core` needs unit tests **and** at least one fast-check property test.
- **File naming:**
  - Unit tests: `foo.test.ts`.
  - Property tests: `foo.prop.test.ts`.
  - Both sit next to the code.
- **Property runs:**
  - `numRuns: 1000` by default.
  - CI/final check uses `FC_RUNS=10000`. Read it via `Number(process.env.FC_RUNS ?? 1000)`.
- **Shared generators** live in `packages/core/src/testing/arbitraries.ts`:
  - small sheets (≤30 rows × 8 cols)
  - mixed values and simple formulas
  - random edits: cell edit, row insert, row delete
- **Core properties to keep green:**
  - `merge(b, x, x) == x`; `merge(b, b, x) == x`; `merge(b, x, b) == x`
  - `apply(diff(a, b), a) == b`
  - `normalize(read(write(s))) == s`
  - inserting k rows (key mode) → exactly k inserts, 0 cell changes
  - `toA1(toR1C1(f)) == f`
  - non-overlapping edits never conflict
- **Fixtures:**
  - Real `.xlsx` files go in `/fixtures`, with expected JSON.
  - Tests may write only to `fixtures/out/`.
- No snapshot-only tests. Assert on structure.
- When a property test finds a bug, add the shrunk counterexample as a named unit test before fixing it.
