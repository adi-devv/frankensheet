---
inclusion: always
---
# Tech stack and conventions

- **Language:** TypeScript, `strict` + `noUncheckedIndexedAccess`, ESM only, Node >= 20.
- **Monorepo:** npm workspaces (`packages/*`, `apps/*`). No pnpm/yarn.
- **Tests:** vitest + fast-check. Run with `npm test`; full check with `npm run check`.
- **Libraries (keep this list short; ask before adding new deps):**
  - `exceljs`: read/write .xlsx (Plan A writer)
  - `fflate`: zip access for direct XML patching (Plan B writer)
  - Writer strategy (A or B) is decided by the Phase 1 fidelity spike; see `io-fidelity/design.md`.
  - React 18 + Vite for `apps/web`
  - `fast-check` for property tests
- **`packages/core` rules:**
  - No Node built-ins (`fs`, `path`, `Buffer`) and no DOM APIs. Input and output are `Uint8Array`.
  - Pure functions; no global state; deterministic output (stable ordering everywhere).
  - Export everything public from `src/index.ts`.
- **Write rules:** set `<calcPr fullCalcOnLoad="1"/>`, drop cached values of formula cells, keep styles from "ours". Charts, pivots, macros, conditional formats, data validation, comments and images come from "ours" untouched.
- **CLI:** Node only, may use `fs`/`child_process`. Must work on Windows, macOS and Linux (quote paths; no bash-only syntax). Commands: `install`, `uninstall` (reverses install), `textconv`, `merge-driver` (prints a `--risks` summary), `resolve`, `scan <file> [--base <file>]`.
- **Web:** static build, deployable to Cloudflare Pages. Bundles `@frankensheet/core`. The built app is also bundled into the CLI for `fsheet resolve`.
- **Errors:** throw typed errors (`class FsheetError extends Error { code }`); never `console.log` from core.
- **Style:** prettier (single quotes, width 100), eslint recommended + typescript-eslint. Small files, one concept per file.
