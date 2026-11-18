import { readFileSync } from 'node:fs';
import { read, toTextconv } from '../../../packages/core/src/index.js';

/** Read an xlsx file and print its deterministic git representation. */
export function textconv(file: string): void {
  process.stdout.write(toTextconv(read(readFileSync(file))));
}
