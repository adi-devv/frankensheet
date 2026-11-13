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
