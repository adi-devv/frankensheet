import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'fsheet-cli-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function run(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'apps/cli/src/cli.ts', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('fsheet textconv CLI', () => {
  it('runs the root npm script against the budget fixture', () => {
    // Invoke npm's JS entry directly so paths with spaces work on Windows too.
    const npm = process.env.npm_execpath;
    expect(npm).toBeDefined();
    const result = spawnSync(process.execPath, [npm!, 'run', 'fsheet', '--', 'textconv', 'fixtures/fidelity/01_budget_sums.xlsx'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[[^\n]+\]\r?\nA1: /);
    expect(result.stdout).toMatch(/: =SUM\(/);
    expect(result.stdout).not.toContain('# Workbook:');
  });

  it('prints only workbook text when invoked directly', () => {
    const result = run('textconv', 'fixtures/fidelity/01_budget_sums.xlsx');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^\[[^\n]+\]\nA1: /);
  });

  it('reports missing files with exit code 1', () => {
    const result = run('textconv', join(temp, 'missing.xlsx'));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/fsheet: .*ENOENT/);
  });

  it('reports invalid xlsx data with exit code 1', () => {
    const file = join(temp, 'invalid.xlsx');
    writeFileSync(file, 'not a zip');
    const result = run('textconv', file);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('fsheet: Failed to unzip .xlsx');
  });

  it.each([[], ['unknown'], ['textconv'], ['textconv', 'a.xlsx', 'extra']])('rejects invalid arguments: %j', (...args) => {
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Usage: fsheet textconv <file>\n');
  });
});
