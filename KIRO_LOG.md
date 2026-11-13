# Kiro log

How Kiro was used to build Frankensheet. One entry per working day. This is the evidence behind `docs/WRITEUP.md`.

Format per entry: **Mode** (IDE / CLI / Crew), **What we asked**, **What Kiro produced**, **What we changed and why**, **Screenshots** (`docs/screenshots/...`).

---

## 2026-11-13: Phase 0 setup
- Repo scaffold: npm workspaces, TypeScript strict, vitest + fast-check, eslint, prettier, MIT.
- First drafts of the steering files: `product.md`, `tech.md`, `structure.md`, `spreadsheet-semantics.md`, `testing.md`.

## 2026-11-13: Steering review by Kiro
- **Mode:** CLI (`kiro-cli chat --no-interactive`, model auto).
- **What we asked:** review all 5 steering files against `docs/BUILD_PLAN.md`; fix contradictions; fill OOXML gaps; edit steering only.
- **What Kiro produced (20+/8-):**
  - `spreadsheet-semantics.md`: new "OOXML reading rules" (shared strings, inline strings, shared formulas, date1904, defined names); sheet-rename rule; `fr` needs position `toR1C1(f, at)`.
  - `tech.md`: write rules (`fullCalcOnLoad`, drop cached values, out-of-scope parts from "ours"); full CLI command list; writer choice deferred to the Phase 1 spike.
  - `product.md` / `structure.md`: added `uninstall`, `scan`; non-goals now match the semantics file.
  - `testing.md`: fixed P6 signature to `toA1(toR1C1(f, at), at) == f`; added P8 (shift/unshift identity).
- **What we changed and why:** nothing; reviewed the diff and accepted it. Note for Phase 2: the date1904 rule means the writer must convert serials back when it keeps the 1904 flag.

## 2026-11-13: Phase 1 fidelity spike
- **Mode:** CLI (`kiro-cli chat --no-interactive`). Sonnet 4.5 for spikes and design, Haiku 4.5 for one regex fix. Switched Kiro account mid-phase after the first one was throttled.
- **What we asked:** write two writers (Plan A ExcelJS rewrite, Plan B fflate patch-in-place), run both on 5 fixtures (edit cells, insert 2 rows), then write `.kiro/specs/io-fidelity/design.md`.
- **What Kiro produced:** `spike/plan-a-exceljs.ts`, `spike/plan-b-fflate.ts`, the design doc (decision, results, writer design, risks, properties P1–P4).
- **What we checked:** every output opened in real Excel via COM (`scripts/check-excel.ps1`, repair log = fail), plus raw XML inspection of formulas, names, CF, charts and byte-identical parts.
- **What we changed and why:** 4 fix rounds on Plan B, each prompted with the exact failure we found:
  1. rels parsing assumed attribute order;
  2. Excel refused to open: malformed `calcPr`, a literal `${val.value}` in a string, lost `s=` styles, missing `<row>`s;
  3. double shift on the target sheet and wrong shifts on other sheets;
  4. `Rates!$A$2:$B$6` name not shifted (`$` column and range end not matched).
  Plan A: `insertRows` → `spliceRows`; still crashes on the chart fixture and leaves formulas unshifted. Corrected fixture names and the Plan A / bug notes in Kiro's design doc by hand.
- **Result:** Plan B, 5/5 outputs open clean in Excel, all refs correct, 8/9–12/14 parts byte-identical. Decision: Plan B.

## 2026-11-13: Phase 2 specs and formula-refs
- **Mode:** CLI (`kiro-cli chat --no-interactive --trust-tools=fs_read,fs_write`, Sonnet 4.5). `execute_bash` is denied in non-interactive mode, so Kiro edits files and we run `npm run typecheck` / `vitest` ourselves after each round.
- **What we asked:** write the requirements/design/tasks specs for io-fidelity, formula-refs and diff; review them; then implement formula-refs (`packages/core/src/formula.ts`: A1/R1C1, tokenizer, `shiftFormula`, `rangesIn`) with unit tests and properties P6 and P8.
- **What Kiro produced:** the three specs (our review found 18 issues, all fixed by Kiro), `formula.ts` (~1150 lines), `formula.test.ts` (80 tests), `formula.prop.test.ts` (P6, P8 at 1,000 runs) and shared fast-check arbitraries in `packages/core/src/testing/`.
- **What we changed and why:** 5 fix rounds, each prompted with the exact compiler errors and failing tests: 53 TS errors and 9 failing tests went down to 0. Rounds 3 and 4 kept saying "fixed" while the same errors remained, so round 5 named the exact causes: `formula[i]` typed `string | undefined` under `noUncheckedIndexedAccess`, and an `i === 0` guard that only allowed a quoted sheet name (`'Sheet 1'!A1`) at the start of a formula. We also corrected one test that expected `SUM(A3:A4)` → `#REF!` after deleting rows 3–4; Excel and design.md say `SUM(#REF!)`.
- **Result:** `npm run typecheck` clean, 80/80 core tests green, P6/P8 pass at 1,000 runs. Kiro was throttled twice; we waited and relaunched.
