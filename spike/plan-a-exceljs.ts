/**
 * plan-a-exceljs.ts — Phase 1 fidelity spike (Plan A)
 *
 * Reads a fixture .xlsx with ExcelJS, changes 3 cells, inserts 2 rows,
 * then writes the result. The goal is to verify that ExcelJS can round-trip
 * a workbook (formulas, merged cells, styles, charts, defined names) without
 * corrupting it or triggering a "repair" prompt.
 *
 * Usage:
 *   npx tsx spike/plan-a-exceljs.ts <input.xlsx> [output.xlsx]
 *
 * If no output path is given, writes to fixtures/out/<name>.spike-a.xlsx
 */

import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npx tsx spike/plan-a-exceljs.ts <input.xlsx> [output.xlsx]');
    process.exit(1);
  }

  const outputPath =
    process.argv[3] ?? `fixtures/out/${parse(inputPath).name}.spike-a.xlsx`;

  // --- Read ---
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  console.log(`Read: ${inputPath}`);
  console.log(`  Sheets: ${wb.worksheets.map((s) => s.name).join(', ')}`);
  console.log(`  Defined names: ${Object.keys(wb.definedNames).join(', ') || '(none)'}`);

  const ws = wb.worksheets[0];
  if (!ws) {
    console.error('  No worksheets found — nothing to do.');
    process.exit(1);
  }
  console.log(
    `  First sheet "${ws.name}": ${ws.rowCount} rows × ${ws.columnCount} cols`,
  );

  // --- Change 3 cells ---
  // 1. Overwrite a value cell (B2)
  const cellB2 = ws.getCell('B2');
  const oldB2 = cellB2.value;
  cellB2.value = 'SPIKE-A-CHANGED';
  console.log(`  Changed B2: ${JSON.stringify(oldB2)} → "SPIKE-A-CHANGED"`);

  // 2. Overwrite a formula cell (C2) with a constant
  const cellC2 = ws.getCell('C2');
  const oldC2 = cellC2.value;
  cellC2.value = 42;
  console.log(`  Changed C2: ${JSON.stringify(oldC2)} → 42`);

  // 3. Change a value deeper in the sheet (E5)
  const cellE5 = ws.getCell('E5');
  const oldE5 = cellE5.value;
  cellE5.value = 999;
  console.log(`  Changed E5: ${JSON.stringify(oldE5)} → 999`);

  // --- Insert 2 rows at row 3 ---
  ws.spliceRows(3, 0, [], []);
  // Put some data in the new rows so we can verify they survived
  ws.getCell('A3').value = 'INSERTED-1';
  ws.getCell('A4').value = 'INSERTED-2';
  ws.getCell('B3').value = 100;
  ws.getCell('B4').value = 200;
  console.log(`  Inserted 2 rows at row 3`);

  console.log(`  After edits: ${ws.rowCount} rows × ${ws.columnCount} cols`);

  // --- Write ---
  mkdirSync(dirname(outputPath), { recursive: true });
  await wb.xlsx.writeFile(outputPath);
  console.log(`Wrote: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
