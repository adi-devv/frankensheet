# Frankensheet

`git merge` for `.xlsx` spreadsheets. It merges cell by cell, lets you resolve conflicts in the browser, and runs a "possessed cell" scan that catches broken formulas a merge can't see.

> Work in progress for Kiroween 2026. Built with [Kiro](https://kiro.dev). See `.kiro/` for the steering, specs and hooks used to build it.

## Layout
- `packages/core`: pure TypeScript engine (read, normalize, diff, 3-way merge, risk rules)
- `apps/cli`: the `fsheet` CLI (git diff/merge driver, `fsheet resolve`)
- `apps/web`: static web app (diff view, conflict picker, risk panel)

## Develop
```bash
npm install
npm run check
```

## License
MIT
