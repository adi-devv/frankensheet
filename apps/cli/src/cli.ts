import { textconv } from './textconv.js';

const [command, file, ...extra] = process.argv.slice(2);
if (command !== 'textconv' || file === undefined || extra.length > 0) {
  process.stderr.write('Usage: fsheet textconv <file>\n');
  process.exitCode = 1;
} else {
  try {
    textconv(file);
  } catch (error) {
    process.stderr.write(`fsheet: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
