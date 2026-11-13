---
inclusion: always
---
# Repo structure

```
.kiro/           steering, specs, hooks, agents (always committed)
packages/core/   engine
  src/model.ts        Book/Sheet/Row/Cell types
  src/read.ts         .xlsx bytes -> Book
  src/write.ts        Book (+ original bytes) -> .xlsx bytes
  src/normalize.ts    value normalization
  src/formula.ts      A1<->R1C1, shiftFormula, rangesIn
  src/align.ts        row/column alignment
  src/diff.ts         SheetDiff / BookDiff
  src/merge.ts        3-way merge
  src/risks/          one file per rule + index.ts
  src/testing/        shared fast-check arbitraries
  src/**/*.test.ts    unit tests next to code; *.prop.test.ts for property tests
apps/cli/        `fsheet` CLI (install, textconv, merge-driver, resolve, scan)
apps/web/        Vite + React app (pages/, components/, theme/)
fixtures/        .xlsx test workbooks + expected JSON (fixtures/out/ is gitignored)
demo/            scripts and sample data for the demo video
docs/            BUILD_PLAN.md, WRITEUP.md, screenshots/
KIRO_LOG.md      daily log of how Kiro was used (evidence for judges)
```

## Naming
- Files: `camelCase.ts`; React components: `PascalCase.tsx`.
- Risk rule ids: kebab-case (`formula-overwritten`), file name matches the id.
- Test fixtures: `fixtures/<topic>/<case>.xlsx` with `<case>.expected.json` beside it.
