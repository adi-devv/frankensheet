# Frankensheet: end-to-end build plan (v3)

**What it is:** `git merge` for `.xlsx` files. The merge works cell by cell. You resolve conflicts in the browser, and a "possessed cell" scan catches broken formulas the merge can't see. It also ships as a Kiro Crew agent app.
**Hackathon:** Kiroween 2026, Frankenstein category. Bonus targets: Crew App, Best Demo, Blog, Social Blitz.
**Deadline:** Dec 4, 2026, 2:00 PM PT (Dec 5, 3:30 AM IST). **Target:** submit Dec 3. Today is Nov 13.

---

## 0. Ground rules

1. **Kiro is the builder.** Stage 1 is pass/fail on real Kiro use, and Kiro depth is 20% of the score. All product code is written through Kiro specs and tasks, in the Kiro IDE or with `kiro-cli`. Claude's jobs:
   - draft the prompts Kiro gets
   - review each spec before tasks run
   - run the tests and an independent check after each phase
   - debug and write the docs

   The write-up must say exactly this.
2. **Every phase ends at a gate.** A gate is a concrete check that must pass before the next phase starts. If a gate fails, fix it before moving on.
3. **Evidence as we go.** Append to `KIRO_LOG.md` daily: what we asked Kiro, what it produced, and what we changed. Screenshot it whenever:
   - a spec is generated
   - a hook fires
   - a property test (PBT) finds a bug
   - a steering rule changes the output
4. **Commit small and push daily.** The repo is public from day 1, with an MIT licence.
5. **The user does every sign-in, credit form and publish step:** Kiro login, GitHub repo creation, npm publish, Cloudflare, YouTube, blog and social. Claude never types passwords.

## 1. Environment (checked Nov 13)

| Tool | Status | Action |
|---|---|---|
| Node 20.14 / npm 10.8 | ok | npm workspaces (no pnpm needed) |
| git 2.45, gh 2.93 | ok | — |
| Kiro IDE | **missing** | User installs it from kiro.dev and signs in |
| kiro-cli | **missing** | Install. If it doesn't run natively on Windows, use WSL |
| Kiro Crew | **missing** | Install after kiro-cli (Phase 8) |
| wrangler | missing | `npm i -D wrangler` in `apps/web` (Phase 7) |
| Excel / LibreOffice | ? | We need one of them to open the merged files. LibreOffice is free |

**Credits:** submit the Kiro Credit Request Form **today**. It closes Dec 1.

## 2. Architecture

```
frankensheet/                      (public repo, MIT)
├─ .kiro/
│  ├─ steering/   product.md tech.md structure.md spreadsheet-semantics.md testing.md
│  ├─ specs/      <one folder per spec: requirements.md design.md tasks.md>
│  ├─ hooks/      *.kiro.hook
│  └─ agents/     fixture-forge.json
├─ packages/core/                  pure TS engine, no Node or DOM APIs
│  └─ src/ model.ts read.ts write.ts normalize.ts formula.ts align.ts diff.ts merge.ts risks/ index.ts
├─ apps/cli/                       npm package "frankensheet" (bin: fsheet)
│  └─ src/ install.ts textconv.ts mergeDriver.ts resolve.ts server.ts
├─ apps/web/                       Vite + React + TS, static; also bundled inside the CLI for `fsheet resolve`
│  └─ src/ pages/ (Diff, Merge) components/ (SheetGrid, ConflictPanel, RiskPanel, DropZone) theme/
├─ fixtures/                       hand-made + generated .xlsx files, with expected outputs
├─ demo/                           demo repo script + sample data
├─ docs/                           BUILD_PLAN.md, WRITEUP.md, screenshots/
└─ KIRO_LOG.md
frankensheet-crew/                 (separate public repo, needed for the Crew bonus)
```

**Runtime flows**

1. **Diff in git:** `git diff budget.xlsx` → `fsheet textconv <file>` → stable text dump. Git then shows a readable line diff.
2. **Merge in git:** `git merge` → `fsheet merge-driver %O %A %B %P`:
   - The engine merges cell by cell and writes the result to `%A`.
   - **Clean merge:** exit 0.
   - **Conflict:** save base/ours/theirs + `conflicts.json` under `.git/fsheet/<path-hash>/` and exit 1. Git then marks the file as conflicted.
3. **Resolve:** `fsheet resolve budget.xlsx` starts a localhost server (random port, 127.0.0.1 only) that serves the bundled web app plus the saved conflict files, then opens the browser. The user picks a side per conflict and clicks "Save". The server writes the merged file to the working tree, runs `git add <file>` and exits.
4. **Hosted site** (Cloudflare Pages, static only):
   - Drop in 2 files (diff) or 3 (merge) and everything runs client-side. No upload, no server, no login.
   - Two one-click demo buttons with the built-in sample files.
5. **Crew app:** the MCP server imports `@frankensheet/core` and offers the tools `diff_files`, `merge_files` and `scan_risks`. The agent "Sheet Warden" uses them. A dashboard page shows recent scans.

No R2 and no Worker are needed for the core. A Worker is added only if we build the LLM-summary stretch.

## 3. Core engine design

### 3.1 Cell model (`model.ts`)
```ts
type CellValue = null | number | string | boolean | { error: string }   // "#REF!" etc.
interface Cell { v: CellValue; f?: string /* A1 formula, no "=" */; fr?: string /* R1C1 relative, derived */ }
interface Row  { cells: (Cell | undefined)[]; sig: string /* hash of normalized values+fr */ }
interface Sheet { name: string; rows: Row[]; colCount: number; keyCol?: number }
interface Book  { sheets: Sheet[]; names: Record<string, string> /* defined names */ }
```
- **Normalize:**
  - trim nothing
  - numbers kept as JS numbers
  - dates turned into serial numbers
  - rich text turned into plain text
  - shared formulas expanded per cell
  - an empty string treated as an empty cell
- **Formatting is not part of the model.** Styles are copied from "ours" when writing.

### 3.2 Formulas (`formula.ts`)
- **A1 ↔ R1C1 converter.** Handles absolute and relative refs, ranges, sheet-qualified refs, whole rows and columns, and quoted sheet names. Uses a tokenizer, not regex-only parsing.
- `shiftFormula(f, rowMap)` rewrites references when rows move. This is needed after merging inserted rows.
- `rangesIn(f)` extracts the ranges a formula covers, which the risk rules use.

### 3.3 Row alignment (`align.ts`)
Input: two sheets. Output: matched row pairs plus inserted and deleted rows.
1. **Key mode:**
   - **Choosing the key column:**
     - The user can pick one.
     - Otherwise, auto-pick the leftmost column where the header row is non-empty, ≥95% of body values are unique and non-empty, and the values aren't formulas.
   - Rows are matched by key value.
   - The order of the output follows "ours", and new keys are placed after their nearest preceding matched row.
2. **Fallback (no key column):**
   - Run Myers LCS over row `sig` values to get exact matches.
   - Inside each unmatched gap, pair rows by similarity (share of equal cells ≥ 0.6, greedy best-first) to get "modified" rows.
   - Whatever is left over counts as inserted or deleted.
3. **Columns:** matched by header text if there is a header row, else by position. Inserting columns is out of scope; detect it and show a warning.

### 3.4 Diff (`diff.ts`)
```ts
type SheetDiff = { rowOps: RowOp[]; cellChanges: CellChange[]; sheetAdded?: true; sheetRemoved?: true }
type CellChange = { rowKey: string; col: number; before?: Cell; after?: Cell; kind: 'value'|'formula'|'both' }
```
Formulas are compared by `fr`, so a reference that only shifted because rows moved is not counted as a change.

### 3.5 Three-way merge (`merge.ts`)
1. Align base→ours and base→theirs.
2. **Rows:**
   - kept in both → keep
   - deleted in one side and unchanged in the other → delete
   - deleted in one side and edited in the other → **conflict**
   - inserted → inserted at its anchor
   - inserted on both sides at the same anchor:
     - same content → insert once
     - different content → both are inserted, ordered ours then theirs, and a `rowOrder` conflict is flagged
3. **Cells:** for each matched cell, compare base (b), ours (o) and theirs (t):
   - o == t → o
   - o == b → t
   - t == b → o
   - otherwise → **conflict**
4. After rows are placed, rebuild every formula from its `fr` at its new position. This makes references follow the moved rows.
5. **Output:** `{ book, conflicts: Conflict[] }`. Each conflict holds `{ sheet, rowKey, col | 'row', base, ours, theirs }`. In the merged book each conflicted cell holds "ours" until it is resolved.

### 3.6 Writing (`write.ts`)
The strategy is decided by the Phase 1 spike.
- **Plan A:** ExcelJS loads "ours", we set the cell values and formulas and insert or delete rows, then save.
- **Plan B (if A corrupts files):** unzip with `fflate` and patch `xl/worksheets/sheetN.xml` directly:
  - changed cells are written as inline strings or numbers with `<f>`
  - rows are renumbered
  - every other part is left as is
- **Always:**
  - set `<calcPr fullCalcOnLoad="1"/>`
  - drop cached values of formula cells
  - keep styles from "ours"
  - charts, pivots, macros and conditional formats come from "ours" untouched, and the README says so

### 3.7 Possessed-cell rules (`risks/`)
Each rule: `(before: Book | null, after: Book, diff) => Risk[]`, where `Risk = { rule, sheet, cell, severity, message }`.

| id | Detects | Severity |
|---|---|---|
| `formula-overwritten` | Cell had a formula before, now holds a constant | high |
| `range-misses-inserts` | SUM/AVERAGE/COUNT range ends right before newly inserted rows that sit in the same contiguous block | high |
| `new-error` | Cell value became `#REF!`, `#DIV/0!`, `#VALUE!` or `#N/A` (or its formula now contains `#REF!`) | high |
| `magnitude-jump` | A numeric value changed by a factor of ≈10, 100 or 1000 (±2%) | medium |
| `deleted-referenced-row` | A deleted row was referenced by a formula that still exists | high |
| `mixed-column` | A column that was all formulas now has one constant (inconsistent column) | medium |

## 4. Kiro setup (`.kiro/`)

### 4.1 Steering (written in Phase 0; Kiro uses these on every task)
- `product.md`: users, pitch, non-goals, demo story.
- `tech.md`:
  - TS strict, ESM, Node 20
  - npm workspaces
  - vitest + fast-check
  - core has no Node or DOM imports
  - libraries: ExcelJS, fflate, React 18, Vite
- `structure.md`: the folder layout above and naming rules.
- `spreadsheet-semantics.md`:
  - what cell identity means
  - empty vs `""`
  - how dates normalize
  - how formulas are compared (R1C1)
  - what counts as a change
  - how conflicts are represented
- `testing.md`:
  - every exported core function gets unit tests and at least one property test
  - fixtures live in `/fixtures`
  - no snapshot-only tests

### 4.2 Specs
Each spec is generated by Kiro from a prompt, reviewed, then executed.

| # | Spec | Covers |
|---|---|---|
| 1 | `io-fidelity` | read → model, write strategy, round trip, fullCalcOnLoad |
| 2 | `formula-refs` | A1↔R1C1, shiftFormula, rangesIn |
| 3 | `row-alignment` | key mode, LCS + similarity fallback, column headers |
| 4 | `diff` | SheetDiff, textconv text format |
| 5 | `three-way-merge` | row and cell merge, conflicts, formula rebuild |
| 6 | `git-driver` | install, textconv, merge-driver, resolve server |
| 7 | `web-app` | grid, diff view, conflict picker, risk panel, demo buttons |
| 8 | `possessed-rules` | the 6 rules + fixtures |
| 9 | `crew-app` | MCP server, Warden agent, skill, dashboard page |

### 4.3 Property tests (fast-check), the showcase for judges
Generators: random small sheets (≤30×8; mixed numbers, strings, blanks, simple formulas), plus random edits (cell edit, row insert, row delete).

| Property | Statement |
|---|---|
| P1 | `merge(b, x, x) == x` |
| P2 | `merge(b, b, x) == x` and `merge(b, x, b) == x` |
| P3 | `apply(diff(a, b), a) == b` |
| P4 | `normalize(read(write(s))) == s` |
| P5 | Inserting k rows at random (key mode) → diff reports exactly k inserts and 0 cell changes |
| P6 | `toA1(toR1C1(f, at), at) == f` for generated formulas |
| P7 | Edits made on non-overlapping cells never cause conflicts |
| P8 | Shifting a formula and then un-shifting it is the identity |

### 4.4 Hooks
- `core-pbt-on-save`: when a file in `packages/core/src/**` is saved, run vitest for the matching test file.
- `rule-fixture`: when a new file is created in `packages/core/src/risks/`, ask Kiro to generate a fixture `.xlsx` and a failing test for it.
- `spec-sync`: when `merge.ts` or `align.ts` is saved, ask Kiro to check that the spec's design.md still matches and to list any drift.
- `precommit-check`: when asked manually, run typecheck + lint + tests and summarize the result.

### 4.5 Custom agent
- **`fixture-forge`:** generates nasty workbooks for tests:
  - merged cells
  - shared formulas
  - defined names
  - cross-sheet refs
  - dates
  - `#REF!`
  - a 5,000-row sheet

  Each file is written to `/fixtures` together with an `expected.json`.

### 4.6 MCP
Use only what is actually used, for example a docs MCP while building the Crew app. In the write-up, list each one with what it did.

## 5. Phases

Each phase follows the same loop:
1. Claude drafts the Kiro prompt.
2. Kiro generates the spec.
3. Review.
4. Kiro runs the tasks.
5. Claude verifies the gate.
6. Commit and log.

### Phase 0: Setup (Nov 13)
**User:**
- install the Kiro IDE and sign in
- submit the credit form
- create the GitHub repo `frankensheet` (public, MIT)

**Claude:**
- scaffold the npm workspaces, tsconfig, vitest, eslint and prettier
- `.gitignore` (must **not** ignore `.kiro`)
- `KIRO_LOG.md`
- draft the 5 steering files; Kiro then refines them

**Gate:** `npm test` runs (0 tests), `.kiro/steering` is committed, and the repo is pushed.

### Phase 1: Fidelity spike (Nov 13–14)
- Build 5 fixture files:
  - a budget with SUMs
  - merged cells + styles
  - shared formulas + defined names
  - a chart + conditional formatting
  - a 5k-row data sheet
- Spike script: read with ExcelJS → change 3 cells, insert 2 rows → write. Then do the same with fflate XML patching.
- Open every output in LibreOffice (headless convert, to check it opens without a repair prompt) and, if you have it, Excel.

**Gate:** Plan A or B is chosen and the reason is written in `io-fidelity/design.md`. No output opens as "repaired".

### Phase 2: Engine part 1 (Nov 15–16)
Specs 1, 2 and 4: read/write, formulas, diff, plus the textconv text format.

**Gate:**
- P3, P4, P6 and P8 pass with 1,000 runs each
- `fsheet textconv fixtures/budget.xlsx` prints a stable dump

### Phase 3: Row alignment + merge (Nov 17–19)
Specs 3 and 5.

**Gate:**
- P1, P2, P5 and P7 pass
- Hand fixtures pass:
  - both sides insert rows
  - one edits while the other deletes (conflict)
  - same cell edited on both sides (conflict)
  - SUM range expands correctly after the merge
- The merged fixture opens cleanly

### Phase 4: Git driver (Nov 20–21)
Spec 6.
- `fsheet install` writes `.gitattributes` lines and local git config:
  - `diff.fsheet.textconv`
  - `merge.fsheet.driver "fsheet merge-driver %O %A %B %P"`
  - `merge.fsheet.name`
- The `fsheet uninstall` command reverses this.

**Gate:** `demo/make-demo-repo.sh` builds a temp repo with two branches editing `budget.xlsx`. Then:
- `git diff` shows the cell changes
- `git merge` auto-merges the clean case and exits 1 on the conflict case, with the sidecar saved

### Phase 5: Web app (Nov 21–24)
Spec 7.
- **SheetGrid:** virtualized HTML table, sticky headers, sheet tabs.
- **Diff view:** added, removed and changed cells get colours; hovering a cell shows before→after.
- **Merge view:** conflict list + a picker per conflict (ours / theirs / base / edit); "Save merged".
- **`fsheet resolve`:** the server serves the built app and the conflict files. Saving writes the file and runs `git add`.
- **Hosted mode:**
  - drop zone
  - 2 demo buttons
  - everything client-side (the core is bundled)
  - a "download merged .xlsx" button

**Gate:**
- the full demo flow works end to end on localhost
- Lighthouse accessibility ≥ 90
- works at phone width (read-only is fine)

### Phase 6: Possessed rules (Nov 24–25)
Spec 8. Six rules, each with a fixture generated through the `rule-fixture` hook, plus RiskPanel in the web app and `fsheet scan <file> [--base <file>]`. Also a `--risks` summary line in the merge-driver output.

**Gate:** each rule has a positive and a negative fixture. The demo merge produces exactly the 2 intended risks.

### Phase 7: Deploy + real-user test (Nov 26)
- **User:**
  - create the Cloudflare account and project
  - `npm publish` (check the name `frankensheet` is free; if not, use `@<scope>/frankensheet`)
- **Claude:**
  - `wrangler pages deploy`
  - smoke-test the live URL in the browser
- Run 1–2 real people's files through it and collect a quote or screenshot.

**Gate:**
- the live URL works in a private window with no login
- `npx frankensheet install` works in a fresh repo

### Phase 8: Crew app (Nov 27–28)
Spec 9, in the separate repo `frankensheet-crew`.
- Read the Crew Apps docs first: the `app.json` manifest, how agents, skills and MCP are declared, and the `ui/dist` rule.
- **MCP server** (stdio, depends on `frankensheet`): tools `diff_files`, `merge_files`, `scan_risks`.
- **Agent "Sheet Warden"** + skill `review-spreadsheet-change`: run diff + scan, then write a review note.
- **Dashboard page:** reads the last scans from a local JSON file. Commit the built `ui/dist`.

**Gate:** a clean install in Crew works, and "Warden, review demo/budget.xlsx changes" returns a correct note.

### Phase 9: Theme + polish (Nov 29)
- Dark "lab" theme.
- Merged cells get a stitch-seam border coloured by branch (green ours / violet theirs).
- Possessed cells glow with a ghost tag.
- Empty and error states.
- README with a GIF, install steps, limits and a FAQ.

### Phase 10: Story + submit (Nov 30 – Dec 3)
- **Nov 30:** write `docs/WRITEUP.md`. It covers Kiro modes, specs vs vibe coding, steering, hooks, PBT, the agent, MCP and the IDE vs CLI vs Crew comparison, with screenshots.
- **Dec 1:** record the video using the script below. Draft the blog (dev.to/Medium, mentions Kiroween 2026) and the social post.
- **Dec 2:** buffer and bug fixes. The user publishes the blog and the social post (starts with `#KiroweenHackathon26`, own words).
- **Dec 3:** the user submits on Devpost after we walk through the checklist together.

## 6. Demo video (≤ 2:50)

| Time | Shot |
|---|---|
| 0:00 | Terminal: `git merge feature/q4` → "binary file conflict". Voice: "Spreadsheets break git." |
| 0:15 | `npx frankensheet install` and run the merge again → "merged 41 cells, 1 conflict". `git diff` shows readable cell changes |
| 0:40 | `fsheet resolve` → the stitched grid in the browser, pick the conflict, save. Git now shows the file as resolved |
| 1:10 | Risk panel: the Total SUM skips the 3 inserted rows, and a formula was typed over with a number. Click a risk → jump to the cell |
| 1:40 | Kiro Crew: ask Warden to review the merge → a live note appears |
| 2:05 | How Kiro built it: a spec → a PBT failure → the spec is fixed, and a hook fires (2 quick visuals) |
| 2:35 | Who it's for + live URL + repo |

No Excel UI or logos on screen; say ".xlsx files". Use our own sample data plus a public open-data budget sheet. Royalty-free or no music.

## 7. Verification (Claude runs these at each gate)
- `npm run typecheck && npm test` must be green, with PBT at 1,000 runs (10,000 before submit).
- Run the merged fixtures through LibreOffice headless conversion. A non-zero exit or a "repair" warning fails the gate.
- Re-run the demo repo script from scratch.
- Browser check of the web app at desktop and phone width; read the console for errors.
- A Codex or Sonnet review of the diff before the Phase 5 and Phase 8 gates (one reviewer, not both).

## 8. Cut order if time runs short
1. Crew dashboard page (keep the agent + MCP)
2. `mixed-column` and `magnitude-jump` rules
3. Fuzzy row fallback (key mode only, documented)
4. Phone layout
5. Theme extras

Never cut: the git driver, the browser resolve, the 3 high-severity rules, the PBT, the video and the write-up.

## 9. Stretch (only if Phase 9 finishes early)
1. `fsheet blame <file> <cell>`: walk the git log to find who last changed the cell.
2. An LLM summary of a diff through a Cloudflare Worker (cached, rate-limited).
3. A recalculation check with HyperFormula: recompute after the merge and flag cells whose values changed.

## 10. Submission checklist
- [ ] Public repo, MIT shown in About, `.kiro/` committed
- [ ] Live URL works with no login
- [ ] YouTube video <3 min, public, no trademarks or copyrighted music
- [ ] Description + Kiro write-up with evidence
- [ ] Crew repo URL + description
- [ ] Blog URL; social post URL
- [ ] Libraries we didn't write listed (ExcelJS, fflate, fast-check, React, Vite)
- [ ] Site stays up through Jan 29, 2027
