---
inclusion: always
---
# Product: Frankensheet

**One line:** `git merge` for `.xlsx` files. Merges cell by cell, resolves conflicts in a browser, and flags "possessed cells" (formula risks) that a merge can't see.

## Users
- People who keep spreadsheets in git repos: finance-as-code teams, data teams, researchers, NGOs, students.
- People who email `.xlsx` copies around and lose edits when versions collide.

## Core features (must ship)
1. **Engine** (`packages/core`): read .xlsx → cell model, diff, 3-way merge, risk rules. Pure TypeScript; runs in Node and the browser.
2. **Git integration** (`apps/cli`, bin `fsheet`):
   - `fsheet install` registers a textconv diff driver and a merge driver for `*.xlsx`.
   - `git diff` shows cell changes; `git merge` merges cell by cell.
   - On a real conflict, the driver saves a sidecar and exits non-zero. `fsheet resolve` opens a local browser view to pick sides.
3. **Web app** (`apps/web`):
   - drop in 2 files (diff) or 3 (merge)
   - colored diff grid, conflict picker, risk panel
   - download the merged file
   - all client-side: no upload, no login
4. **Possessed-cell rules:**
   - formula overwritten by a constant
   - SUM range that misses inserted rows
   - new error values (#REF!, #DIV/0!, ...)
   - ×10/×100/×1000 jumps
   - deleted rows that are still referenced
   - inconsistent formula column
5. **Kiro Crew app** (separate repo `frankensheet-crew`): MCP tools + "Sheet Warden" agent that reviews spreadsheet changes.

## Non-goals
- Merging charts, pivots, macros or conditional formats. These are kept from the "ours" file untouched.
- Column-insert detection. Detect it and warn only.
- Real-time co-editing, accounts, servers that store user files.

## Principles
- Never corrupt a workbook. A merged file must open without a "repair" prompt.
- Never lose data silently. Anything we can't merge becomes a visible conflict or warning.
- User files stay on the user's machine.

## Theme (Kiroween, Frankenstein category)
Stitching branches into one sheet. Merged cells show stitch seams colored by branch; risky cells "glow" as possessed. The theme is visual only. Clarity always wins over spookiness.
