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
  - React 18 + Vite for `apps/web`
  - `fast-check` for property tests
- **`packages/core` rules:**
  - No Node built-ins (`fs`, `path`, `Buffer`) and no DOM APIs. Input and output are `Uint8Array`.
  - Pure functions; no global state; deterministic output (stable ordering everywhere).
  - Export everything public from `src/index.ts`.
- **CLI:** Node only, may use `fs`/`child_process`. Must work on Windows, macOS and Linux (quote paths; no bash-only syntax).
- **Web:** static build, deployable to Cloudflare Pages. Bundles `@frankensheet/core`.
- **Errors:** throw typed errors (`class FsheetError extends Error { code }`); never `console.log` from core.
- **Style:** prettier (single quotes, width 100), eslint recommended + typescript-eslint. Small files, one concept per file.
