// Public API of the Frankensheet engine. Implemented through Kiro specs in .kiro/specs/.
export const VERSION = '0.0.0';

// Model types
export type { Book, Sheet, Row, Cell, CellValue } from './model.js';

// Normalization
export { normalizeValue } from './normalize.js';

// Read
export { read } from './read.js';

// Formula utilities
export {
  colToIndex,
  indexToCol,
  parseRef,
  refToString,
  tokenize,
  toR1C1,
  toA1,
  shiftFormula,
  rangesIn,
} from './formula.js';

export type { ParsedRef, Token, TokenType, Range } from './formula.js';
