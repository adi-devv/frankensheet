// Formula utilities: A1↔R1C1 conversion, tokenization, shifting, range extraction.
// All coordinates are zero-indexed internally (row 0 = Excel row 1, col 0 = Excel col A).

/**
 * Convert column letter(s) to zero-indexed column number.
 * A=0, B=1, ..., Z=25, AA=26, ..., ZZ=701
 */
export function colToIndex(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    const char = col.charCodeAt(i) - 65; // A=0, B=1, ...
    result = result * 26 + char + 1;
  }
  return result - 1;
}

/**
 * Convert zero-indexed column number to column letter(s).
 * 0=A, 1=B, ..., 25=Z, 26=AA, ..., 701=ZZ
 */
export function indexToCol(index: number): string {
  let result = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export interface ParsedRef {
  sheet?: string;
  col: number;
  row: number;
  colAbs: boolean;
  rowAbs: boolean;
}

/**
 * Parse a cell reference into components.
 * Examples: "A1", "$A$1", "Sheet1!A1", "'My Sheet'!$A$1"
 * Returns zero-indexed row and col.
 */
export function parseRef(ref: string): ParsedRef {
  let remaining = ref;
  let sheet: string | undefined;

  // Parse sheet qualifier if present
  const bangIndex = remaining.lastIndexOf('!');
  if (bangIndex !== -1) {
    const sheetPart = remaining.substring(0, bangIndex);
    remaining = remaining.substring(bangIndex + 1);

    // Remove quotes if present
    if (sheetPart.startsWith("'") && sheetPart.endsWith("'")) {
      sheet = sheetPart.substring(1, sheetPart.length - 1).replace(/''/g, "'");
    } else {
      sheet = sheetPart;
    }
  }

  // Parse column (letters with optional $)
  let colAbs = false;
  let colStart = 0;
  if (remaining[0] === '$') {
    colAbs = true;
    colStart = 1;
  }

  let colEnd = colStart;
  while (colEnd < remaining.length && /[A-Z]/i.test(remaining[colEnd] ?? '')) {
    colEnd++;
  }

  const colStr = remaining.substring(colStart, colEnd).toUpperCase();
  const col = colToIndex(colStr);

  // Parse row (digits with optional $)
  let rowAbs = false;
  let rowStart = colEnd;
  if (remaining[rowStart] === '$') {
    rowAbs = true;
    rowStart++;
  }

  const rowStr = remaining.substring(rowStart);
  const row = parseInt(rowStr, 10) - 1; // Convert to zero-indexed

  return { sheet, col, row, colAbs, rowAbs };
}

/**
 * Convert parsed ref back to string.
 * Quotes sheet name if it contains spaces or special chars.
 */
export function refToString(parsed: ParsedRef): string {
  let result = '';

  // Add sheet qualifier if present
  if (parsed.sheet !== undefined) {
    if (needsQuoting(parsed.sheet)) {
      result += "'" + parsed.sheet.replace(/'/g, "''") + "'!";
    } else {
      result += parsed.sheet + '!';
    }
  }

  // Add column
  if (parsed.colAbs) {
    result += '$';
  }
  result += indexToCol(parsed.col);

  // Add row
  if (parsed.rowAbs) {
    result += '$';
  }
  result += (parsed.row + 1).toString(); // Convert to one-indexed

  return result;
}

/**
 * Check if a sheet name needs quoting (contains spaces or special chars).
 */
function needsQuoting(sheet: string): boolean {
  return /[ !'"]/.test(sheet);
}

// Token types for formula parsing
export type TokenType =
  | 'ref' // A1, $A$1, Sheet1!A1, 'My Sheet'!$A1
  | 'range' // A1:B2, A:A, 1:1, Sheet1!A1:B2
  | 'string' // "text"
  | 'function' // SUM(, IF(
  | 'operator' // +, -, *, /, ^, &, =, <>, <, >, <=, >=
  | 'number' // 123, 1.5, 1E+10
  | 'error' // #REF!, #DIV/0!, etc.
  | 'whitespace' // space, tab
  | 'paren' // ( )
  | 'comma' // ,
  | 'boolean' // TRUE, FALSE
  | 'name' // defined name
  | 'unknown'; // anything else

export interface Token {
  type: TokenType;
  text: string;
}

/**
 * Tokenize a formula string into tokens.
 * Formula should be in A1 notation without the leading '='.
 */
export function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < formula.length) {
    const char = formula.charAt(i);

    // Whitespace
    if (char === ' ' || char === '\t') {
      const start = i;
      while (i < formula.length && (formula[i] === ' ' || formula[i] === '\t')) {
        i++;
      }
      tokens.push({ type: 'whitespace', text: formula.substring(start, i) });
      continue;
    }

    // String
    if (char === '"') {
      const start = i;
      i++; // Skip opening "
      while (i < formula.length) {
        if (formula[i] === '"') {
          i++;
          // Check for escaped quote ""
          if (i < formula.length && formula[i] === '"') {
            i++; // Skip second "
          } else {
            break; // End of string
          }
        } else {
          i++;
        }
      }
      tokens.push({ type: 'string', text: formula.substring(start, i) });
      continue;
    }

    // Error tokens
    if (char === '#') {
      const errors = ['#REF!', '#DIV/0!', '#VALUE!', '#N/A', '#NAME?', '#NUM!', '#NULL!'];
      let matched = false;
      for (const err of errors) {
        if (formula.substring(i, i + err.length) === err) {
          tokens.push({ type: 'error', text: err });
          i += err.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      // If not a known error, treat as unknown
      tokens.push({ type: 'unknown', text: char });
      i++;
      continue;
    }

    // Number (but check for whole-row range first)
    if (/[0-9]/.test(char)) {
      // Look ahead to see if this is a whole-row range (e.g., 1:10 or $1:$10)
      let lookahead = i;
      if (char === '$') {
        lookahead++; // Skip $
      }
      // Scan digits
      while (lookahead < formula.length && /[0-9]/.test(formula[lookahead] ?? '')) {
        lookahead++;
      }
      // Check for :
      if (lookahead > i && lookahead < formula.length && formula[lookahead] === ':') {
        // This might be a whole-row range - scan the end part
        const rangeEnd = scanRangeEnd(formula, lookahead + 1);
        if (rangeEnd !== null) {
          const rangeText = formula.substring(i, rangeEnd);
          // Verify it's a valid whole-row pattern
          if (/^(\$?[0-9]+):(\$?[0-9]+)$/.test(rangeText)) {
            tokens.push({ type: 'range', text: rangeText });
            i = rangeEnd;
            continue;
          }
        }
      }
      
      // Not a range, just a regular number
      const start = i;
      while (i < formula.length && /[0-9]/.test(formula[i] ?? '')) {
        i++;
      }
      // Check for decimal part
      const dot = formula[i];
      if (i < formula.length && dot === '.') {
        i++;
        while (i < formula.length && /[0-9]/.test(formula[i] ?? '')) {
          i++;
        }
      }
      // Check for exponent
      const exp = formula[i];
      if (i < formula.length && (exp === 'E' || exp === 'e')) {
        i++;
        const sign = formula[i];
        if (i < formula.length && (sign === '+' || sign === '-')) {
          i++;
        }
        while (i < formula.length && /[0-9]/.test(formula[i] ?? '')) {
          i++;
        }
      }
      tokens.push({ type: 'number', text: formula.substring(start, i) });
      continue;
    }

    // Operators (multi-char first)
    if (i + 1 < formula.length) {
      const twoChar = formula.substring(i, i + 2);
      if (twoChar === '<>' || twoChar === '<=' || twoChar === '>=') {
        tokens.push({ type: 'operator', text: twoChar });
        i += 2;
        continue;
      }
    }
    if ('+-*/^&=<>'.includes(char)) {
      tokens.push({ type: 'operator', text: char });
      i++;
      continue;
    }

    // Parens
    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', text: char });
      i++;
      continue;
    }

    // Comma
    if (char === ',') {
      tokens.push({ type: 'comma', text: char });
      i++;
      continue;
    }

    // Identifier run (refs, ranges, functions, booleans, names)
    // Also check for $ prefix (could be $A1, $1:$10, etc.)
    if (/[A-Za-z_.$]/.test(char) || char === "'" || char === '$') {
      // Special case: $<digit> might be a whole-row range
      if (char === '$' && i + 1 < formula.length && /[0-9]/.test(formula[i + 1] ?? '')) {
        // Look ahead for whole-row range pattern
        let lookahead = i + 1; // Skip $
        while (lookahead < formula.length && /[0-9]/.test(formula[lookahead] ?? '')) {
          lookahead++;
        }
        if (lookahead < formula.length && formula[lookahead] === ':') {
          // This is likely a whole-row range - scan the end part
          const rangeEnd = scanRangeEnd(formula, lookahead + 1);
          if (rangeEnd !== null) {
            const rangeText = formula.substring(i, rangeEnd);
            if (/^(\$?[0-9]+):(\$?[0-9]+)$/.test(rangeText)) {
              tokens.push({ type: 'range', text: rangeText });
              i = rangeEnd;
              continue;
            }
          }
        }
      }
      
      const token = scanIdentifierRun(formula, i);
      tokens.push(token);
      i += token.text.length;
      continue;
    }

    // Unknown
    tokens.push({ type: 'unknown', text: char });
    i++;
  }

  return tokens;
}

/**
 * Scan an identifier run: ref, range, function, boolean, or name.
 * After scanning a ref/digit, check for ':' to form a range token.
 */
function scanIdentifierRun(formula: string, start: number): Token {
  let i = start;
  let sheet: string | undefined;
  const char = formula.charAt(i);
  if (char === undefined) {
    return { type: 'unknown', text: '' };
  }

  // Check for quoted sheet name
  if (char === "'") {
    const sheetStart = i;
    i++; // Skip opening '
    while (i < formula.length) {
      const c = formula[i];
      if (c === "'") {
        i++;
        // Check for escaped quote ''
        const next = formula[i];
        if (i < formula.length && next === "'") {
          i++; // Skip second '
        } else {
          break; // End of quoted name
        }
      } else {
        i++;
      }
    }
    // Check for !
    if (i < formula.length && formula[i] === '!') {
      sheet = formula.substring(sheetStart, i);
      i++; // Skip !
      
      // Now scan the ref/range part - the whole thing becomes one token
      const refStart = i;
      
      // Scan for cell ref or range with potential colon
      while (i < formula.length && /[A-Za-z0-9_.$:]/.test(formula[i] ?? '')) {
        i++;
      }
      
      const fullText = formula.substring(start, i);
      const refPart = formula.substring(refStart, i);
      
      // Determine if it's a range or ref by checking for colon
      if (refPart.includes(':')) {
        return { type: 'range', text: fullText };
      } else {
        return { type: 'ref', text: fullText };
      }
    } else {
      // Not a sheet qualifier, just a quoted string (shouldn't happen in A1)
      return { type: 'unknown', text: formula.substring(start, i) };
    }
  }

  // Scan identifier characters (letters, digits, $, _, .)
  const identStart = i;
  while (i < formula.length && /[A-Za-z0-9_.$]/.test(formula[i] ?? '')) {
    i++;
  }

  // Check for unquoted sheet name with !
  if (sheet === undefined && i < formula.length && formula[i] === '!') {
    // The identifier so far is a sheet name
    sheet = formula.substring(start, i);
    i++; // Skip !
    // Scan the ref/range part (which might itself contain a range)
    const refStart = i;
    while (i < formula.length && /[A-Za-z0-9_.$]/.test(formula[i] ?? '')) {
      i++;
    }
    const refPart = formula.substring(refStart, i);
    
    // Check for range continuation (:)
    if (i < formula.length && formula[i] === ':') {
      const rangeEnd = scanRangeEnd(formula, i + 1);
      if (rangeEnd !== null) {
        const fullText = formula.substring(start, rangeEnd);
        return { type: 'range', text: fullText };
      }
    }
    
    const fullText = formula.substring(start, i);
    return classifyRef(refPart, fullText, sheet, formula, i);
  }

  const ident = formula.substring(identStart, i);
  const fullText = formula.substring(start, i);

  // Check for range continuation (:) before classifying
  if (i < formula.length && formula[i] === ':') {
    const rangeEnd = scanRangeEnd(formula, i + 1);
    if (rangeEnd !== null) {
      const fullText = formula.substring(start, rangeEnd);
      return { type: 'range', text: fullText };
    }
  }

  return classifyRef(ident, fullText, sheet, formula, i);
}

/**
 * Scan the end part of a range starting after ':'.
 * Returns the end position if valid, null otherwise.
 */
function scanRangeEnd(formula: string, start: number): number | null {
  let i = start;
  
  // Scan optional $ and letters/digits for the range end
  while (i < formula.length && /[A-Za-z0-9$]/.test(formula[i] ?? '')) {
    i++;
  }
  
  if (i === start) {
    return null; // No valid range end
  }
  
  const endPart = formula.substring(start, i);
  
  // Check if endPart is a valid ref component (cell ref, whole col, or whole row)
  // $?[A-Z]+$?[0-9]+ or $?[A-Z]+ or $?[0-9]+
  if (/^(\$?[A-Z]+\$?[0-9]+|\$?[A-Z]+|\$?[0-9]+)$/i.test(endPart)) {
    return i;
  }
  
  return null;
}

/**
 * Classify an identifier as ref, range, function, boolean, or name.
 */
function classifyRef(
  ident: string,
  fullText: string,
  sheet: string | undefined,
  formula: string,
  endPos: number,
): Token {
  // Check if followed by (
  const next = formula[endPos];
  if (endPos < formula.length && next === '(') {
    return { type: 'function', text: fullText + '(' };
  }

  // Check for boolean
  const upper = ident.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') {
    return { type: 'boolean', text: fullText };
  }

  // Check for ref or range pattern
  // Single ref: $?[A-Z]+$?[0-9]+
  // Range: ref:ref or whole-col A:A or whole-row 1:1
  const refPattern = /^(\$?[A-Z]+\$?[0-9]+)$/i;
  const rangePattern = /^(\$?[A-Z]+\$?[0-9]+):(\$?[A-Z]+\$?[0-9]+)$/i;
  const wholeColPattern = /^(\$?[A-Z]+):(\$?[A-Z]+)$/i;
  const wholeRowPattern = /^(\$?[0-9]+):(\$?[0-9]+)$/i;

  if (rangePattern.test(ident) || wholeColPattern.test(ident) || wholeRowPattern.test(ident)) {
    return { type: 'range', text: fullText };
  }

  if (refPattern.test(ident)) {
    // Make sure it's not followed by more letters/digits
    const next = formula[endPos];
    if (endPos < formula.length && next !== undefined && /[A-Za-z0-9]/.test(next)) {
      return { type: 'name', text: fullText };
    }
    return { type: 'ref', text: fullText };
  }

  // Otherwise it's a name
  return { type: 'name', text: fullText };
}



/**
 * Convert a formula from A1 to R1C1 notation.
 * @param f Formula in A1 notation (without leading =)
 * @param at Position of the formula cell (zero-indexed)
 */
export function toR1C1(f: string, at: { row: number; col: number }): string {
  const tokens = tokenize(f);
  let result = '';

  for (const token of tokens) {
    if (token.type === 'ref') {
      result += convertRefToR1C1(token.text, at);
    } else if (token.type === 'range') {
      result += convertRangeToR1C1(token.text, at);
    } else {
      result += token.text;
    }
  }

  return result;
}

/**
 * Convert a single ref token from A1 to R1C1.
 */
function convertRefToR1C1(ref: string, at: { row: number; col: number }): string {
  const parsed = parseRef(ref);
  let result = '';

  // Add sheet qualifier if present
  if (parsed.sheet !== undefined) {
    if (needsQuoting(parsed.sheet)) {
      result += "'" + parsed.sheet.replace(/'/g, "''") + "'!";
    } else {
      result += parsed.sheet + '!';
    }
  }

  // Convert row
  if (parsed.rowAbs) {
    result += 'R' + (parsed.row + 1); // 1-indexed
  } else {
    const rowOffset = parsed.row - at.row;
    if (rowOffset === 0) {
      result += 'R';
    } else {
      result += 'R[' + rowOffset + ']';
    }
  }

  // Convert col
  if (parsed.colAbs) {
    result += 'C' + (parsed.col + 1); // 1-indexed
  } else {
    const colOffset = parsed.col - at.col;
    if (colOffset === 0) {
      result += 'C';
    } else {
      result += 'C[' + colOffset + ']';
    }
  }

  return result;
}

/**
 * Convert a range token from A1 to R1C1.
 * Handles both cell ranges (A1:B2) and whole row/col ranges (A:A, 1:1).
 */
function convertRangeToR1C1(range: string, at: { row: number; col: number }): string {
  let remaining = range;
  let sheet: string | undefined;

  // Parse sheet qualifier if present
  const bangIndex = remaining.lastIndexOf('!');
  if (bangIndex !== -1) {
    const sheetPart = remaining.substring(0, bangIndex);
    remaining = remaining.substring(bangIndex + 1);

    // Remove quotes if present
    if (sheetPart.startsWith("'") && sheetPart.endsWith("'")) {
      sheet = sheetPart.substring(1, sheetPart.length - 1).replace(/''/g, "'");
    } else {
      sheet = sheetPart;
    }
  }

  // Split on :
  const parts = remaining.split(':');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return range; // Invalid range, return as-is
  }

  const start = parts[0];
  const end = parts[1];

  // Check for whole column (A:A)
  if (/^\$?[A-Z]+$/i.test(start) && /^\$?[A-Z]+$/i.test(end)) {
    const startAbs = start.startsWith('$');
    const endAbs = end.startsWith('$');
    const startCol = colToIndex(start.replace('$', '').toUpperCase());
    const endCol = colToIndex(end.replace('$', '').toUpperCase());

    let result = '';
    if (sheet !== undefined) {
      if (needsQuoting(sheet)) {
        result += "'" + sheet.replace(/'/g, "''") + "'!";
      } else {
        result += sheet + '!';
      }
    }

    // Whole column range
    if (startAbs) {
      result += 'C' + (startCol + 1);
    } else {
      const offset = startCol - at.col;
      result += offset === 0 ? 'C' : 'C[' + offset + ']';
    }
    result += ':';
    if (endAbs) {
      result += 'C' + (endCol + 1);
    } else {
      const offset = endCol - at.col;
      result += offset === 0 ? 'C' : 'C[' + offset + ']';
    }
    return result;
  }

  // Check for whole row (1:1)
  if (/^\$?[0-9]+$/.test(start) && /^\$?[0-9]+$/.test(end)) {
    const startAbs = start.startsWith('$');
    const endAbs = end.startsWith('$');
    const startRow = parseInt(start.replace('$', ''), 10) - 1; // zero-indexed
    const endRow = parseInt(end.replace('$', ''), 10) - 1;

    let result = '';
    if (sheet !== undefined) {
      if (needsQuoting(sheet)) {
        result += "'" + sheet.replace(/'/g, "''") + "'!";
      } else {
        result += sheet + '!';
      }
    }

    // Whole row range - output R:R format (no column)
    if (startAbs) {
      result += 'R' + (startRow + 1);
    } else {
      const offset = startRow - at.row;
      result += offset === 0 ? 'R' : 'R[' + offset + ']';
    }
    result += ':';
    if (endAbs) {
      result += 'R' + (endRow + 1);
    } else {
      const offset = endRow - at.row;
      result += offset === 0 ? 'R' : 'R[' + offset + ']';
    }
    return result;
  }

  // Regular cell range
  let result = '';
  if (sheet !== undefined) {
    if (needsQuoting(sheet)) {
      result += "'" + sheet.replace(/'/g, "''") + "'!";
    } else {
      result += sheet + '!';
    }
  }

  // Convert start and end refs
  const startParsed = parseRef(start);
  const endParsed = parseRef(end);

  // Start
  if (startParsed.rowAbs) {
    result += 'R' + (startParsed.row + 1);
  } else {
    const offset = startParsed.row - at.row;
    result += offset === 0 ? 'R' : 'R[' + offset + ']';
  }
  if (startParsed.colAbs) {
    result += 'C' + (startParsed.col + 1);
  } else {
    const offset = startParsed.col - at.col;
    result += offset === 0 ? 'C' : 'C[' + offset + ']';
  }

  result += ':';

  // End
  if (endParsed.rowAbs) {
    result += 'R' + (endParsed.row + 1);
  } else {
    const offset = endParsed.row - at.row;
    result += offset === 0 ? 'R' : 'R[' + offset + ']';
  }
  if (endParsed.colAbs) {
    result += 'C' + (endParsed.col + 1);
  } else {
    const offset = endParsed.col - at.col;
    result += offset === 0 ? 'C' : 'C[' + offset + ']';
  }

  return result;
}

/**
 * Convert a formula from R1C1 to A1 notation.
 * @param fr Formula in R1C1 notation
 * @param at Position of the formula cell (zero-indexed)
 */
export function toA1(fr: string, at: { row: number; col: number }): string {
  // Tokenize R1C1 formula
  // R1C1 tokens are different from A1 tokens, so we need a custom parser
  let result = '';
  let i = 0;

  while (i < fr.length) {
    const char = fr[i];
    if (char === undefined) {
      break;
    }
    
    // Check for sheet qualifier (quoted or unquoted)
    if (char === "'") {
      // Quoted sheet name
      const start = i;
      i++; // Skip opening '
      while (i < fr.length) {
        const c = fr[i];
        if (c === "'") {
          i++;
          const next = fr[i];
          if (i < fr.length && next === "'") {
            i++; // Escaped quote
          } else {
            break;
          }
        } else {
          i++;
        }
      }
      // Check for !
      const bang = fr[i];
      if (i < fr.length && bang === '!') {
        result += fr.substring(start, i + 1);
        i++;
      } else {
        result += fr.substring(start, i);
      }
      continue;
    }

    // Check for R1C1 ref pattern
    if (char === 'R' || char === 'r') {
      // But first check if this might be part of an unquoted sheet name
      // Look ahead for pattern: identifier followed by !
      let lookahead = i;
      while (lookahead < fr.length && /[A-Za-z0-9_]/.test(fr[lookahead] ?? '')) {
        lookahead++;
      }
      const nextAfterIdent = fr[lookahead];
      if (lookahead > i && nextAfterIdent === '!') {
        // This is an unquoted sheet name, not a R1C1 ref
        result += fr.substring(i, lookahead + 1); // Include the !
        i = lookahead + 1;
        continue;
      }
      
      const match = parseR1C1Ref(fr, i);
      if (match) {
        result += convertR1C1RefToA1(match, at);
        i = match.end;
        continue;
      }
    }

    // Otherwise, just copy the character
    result += char;
    i++;
  }

  return result;
}

interface R1C1RefMatch {
  row: number | null; // null means relative with offset 0
  rowOffset: number;
  rowAbs: boolean;
  col: number | null;
  colOffset: number;
  colAbs: boolean;
  end: number;
}

/**
 * Parse a R1C1 ref starting at position i.
 * Returns null if not a valid R1C1 ref.
 */
function parseR1C1Ref(fr: string, i: number): R1C1RefMatch | null {
  let pos = i;
  const firstChar = fr[pos];

  // Parse R part
  if (firstChar !== 'R' && firstChar !== 'r') {
    return null;
  }
  pos++;

  let row: number | null = null;
  let rowOffset = 0;
  let rowAbs = false;

  const afterR = fr[pos];
  if (pos < fr.length && afterR === '[') {
    // Relative with offset
    pos++;
    const numStart = pos;
    const sign = fr[pos];
    if (pos < fr.length && (sign === '-' || sign === '+')) {
      pos++;
    }
    while (pos < fr.length && /[0-9]/.test(fr[pos] ?? '')) {
      pos++;
    }
    const closeBracket = fr[pos];
    if (pos < fr.length && closeBracket === ']') {
      rowOffset = parseInt(fr.substring(numStart, pos), 10);
      pos++;
    } else {
      return null; // Invalid syntax
    }
  } else if (pos < fr.length && /[0-9]/.test(afterR ?? '')) {
    // Absolute
    const numStart = pos;
    while (pos < fr.length && /[0-9]/.test(fr[pos] ?? '')) {
      pos++;
    }
    row = parseInt(fr.substring(numStart, pos), 10);
    rowAbs = true;
  }
  // else: R with no offset or number means offset 0

  // Parse C part
  const cChar = fr[pos];
  if (pos >= fr.length || (cChar !== 'C' && cChar !== 'c')) {
    return null;
  }
  pos++;

  let col: number | null = null;
  let colOffset = 0;
  let colAbs = false;

  const afterC = fr[pos];
  if (pos < fr.length && afterC === '[') {
    // Relative with offset
    pos++;
    const numStart = pos;
    const sign = fr[pos];
    if (pos < fr.length && (sign === '-' || sign === '+')) {
      pos++;
    }
    while (pos < fr.length && /[0-9]/.test(fr[pos] ?? '')) {
      pos++;
    }
    const closeBracket = fr[pos];
    if (pos < fr.length && closeBracket === ']') {
      colOffset = parseInt(fr.substring(numStart, pos), 10);
      pos++;
    } else {
      return null; // Invalid syntax
    }
  } else if (pos < fr.length && /[0-9]/.test(afterC ?? '')) {
    // Absolute
    const numStart = pos;
    while (pos < fr.length && /[0-9]/.test(fr[pos] ?? '')) {
      pos++;
    }
    col = parseInt(fr.substring(numStart, pos), 10);
    colAbs = true;
  }
  // else: C with no offset or number means offset 0

  return { row, rowOffset, rowAbs, col, colOffset, colAbs, end: pos };
}

/**
 * Convert a R1C1 ref match to A1 notation.
 */
function convertR1C1RefToA1(match: R1C1RefMatch, at: { row: number; col: number }): string {
  let result = '';

  // Handle column
  let colIndex: number;
  if (match.colAbs && match.col !== null) {
    colIndex = match.col - 1; // Convert to zero-indexed
    result += '$' + indexToCol(colIndex);
  } else {
    colIndex = at.col + match.colOffset;
    result += indexToCol(colIndex);
  }

  // Handle row
  let rowIndex: number;
  if (match.rowAbs && match.row !== null) {
    rowIndex = match.row - 1; // Convert to zero-indexed
    result += '$' + (rowIndex + 1); // Back to one-indexed for display
  } else {
    rowIndex = at.row + match.rowOffset;
    result += rowIndex + 1; // One-indexed for display
  }

  return result;
}



/**
 * Shift formula references by inserting or deleting rows.
 * @param f Formula in A1 notation
 * @param opts Sheet name, row index to start shift, and count of rows to insert (positive) or delete (negative)
 */
export function shiftFormula(
  f: string,
  opts: { sheet: string; at: number; count: number },
): string {
  const tokens = tokenize(f);
  let result = '';

  for (const token of tokens) {
    if (token.type === 'ref') {
      result += shiftRef(token.text, opts);
    } else if (token.type === 'range') {
      result += shiftRange(token.text, opts);
    } else {
      result += token.text;
    }
  }

  return result;
}

/**
 * Shift a single ref token.
 */
function shiftRef(ref: string, opts: { sheet: string; at: number; count: number }): string {
  const parsed = parseRef(ref);

  // Check if sheet matches (or is unqualified)
  if (parsed.sheet !== undefined && parsed.sheet !== opts.sheet) {
    return ref; // Different sheet, no shift
  }

  // Handle row shifting
  let newRow = parsed.row;
  let isRefError = false;

  if (opts.count > 0) {
    // Inserting rows
    if (parsed.row >= opts.at) {
      newRow = parsed.row + opts.count;
    }
  } else if (opts.count < 0) {
    // Deleting rows
    const deleteStart = opts.at;
    const deleteEnd = opts.at + Math.abs(opts.count);

    if (parsed.row >= deleteStart && parsed.row < deleteEnd) {
      // Ref is in deleted range
      isRefError = true;
    } else if (parsed.row >= deleteEnd) {
      // Ref is below deleted range, shift up
      newRow = parsed.row + opts.count;
    }
  }

  if (isRefError) {
    return '#REF!';
  }

  // Rebuild ref
  return refToString({
    sheet: parsed.sheet,
    col: parsed.col,
    row: newRow,
    colAbs: parsed.colAbs,
    rowAbs: parsed.rowAbs,
  });
}

/**
 * Shift a range token.
 */
function shiftRange(range: string, opts: { sheet: string; at: number; count: number }): string {
  let remaining = range;
  let sheet: string | undefined;

  // Parse sheet qualifier if present
  const bangIndex = remaining.lastIndexOf('!');
  if (bangIndex !== -1) {
    const sheetPart = remaining.substring(0, bangIndex);
    remaining = remaining.substring(bangIndex + 1);

    // Remove quotes if present
    if (sheetPart.startsWith("'") && sheetPart.endsWith("'")) {
      sheet = sheetPart.substring(1, sheetPart.length - 1).replace(/''/g, "'");
    } else {
      sheet = sheetPart;
    }

    // Check if sheet matches
    if (sheet !== opts.sheet) {
      return range; // Different sheet, no shift
    }
  }

  // Split on :
  const parts = remaining.split(':');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return range; // Invalid range
  }

  const start = parts[0];
  const end = parts[1];

  // Check for whole column range (don't shift on row insert/delete)
  if (/^\$?[A-Z]+$/i.test(start) && /^\$?[A-Z]+$/i.test(end)) {
    return range; // Whole column range, no shift
  }

  // Check for whole row range
  if (/^\$?[0-9]+$/.test(start) && /^\$?[0-9]+$/.test(end)) {
    const startRow = parseInt(start.replace('$', ''), 10) - 1; // zero-indexed
    const endRow = parseInt(end.replace('$', ''), 10) - 1;
    const startAbs = start.startsWith('$');
    const endAbs = end.startsWith('$');

    const { newStart, newEnd, isError } = shiftRowRange(
      startRow,
      endRow,
      opts.at,
      opts.count,
    );

    if (isError) {
      return '#REF!';
    }

    // Rebuild whole row range
    let result = '';
    if (sheet !== undefined) {
      if (needsQuoting(sheet)) {
        result += "'" + sheet.replace(/'/g, "''") + "'!";
      } else {
        result += sheet + '!';
      }
    }
    result += (startAbs ? '$' : '') + (newStart + 1);
    result += ':';
    result += (endAbs ? '$' : '') + (newEnd + 1);
    return result;
  }

  // Regular cell range
  const startParsed = parseRef(start);
  const endParsed = parseRef(end);

  const { newStart: newStartRow, newEnd: newEndRow, isError } = shiftRowRange(
    startParsed.row,
    endParsed.row,
    opts.at,
    opts.count,
  );

  if (isError) {
    return '#REF!';
  }

  // Rebuild cell range
  let result = '';
  if (sheet !== undefined) {
    if (needsQuoting(sheet)) {
      result += "'" + sheet.replace(/'/g, "''") + "'!";
    } else {
      result += sheet + '!';
    }
  }

  // Start ref
  result += refToString({
    col: startParsed.col,
    row: newStartRow,
    colAbs: startParsed.colAbs,
    rowAbs: startParsed.rowAbs,
  });

  result += ':';

  // End ref
  result += refToString({
    col: endParsed.col,
    row: newEndRow,
    colAbs: endParsed.colAbs,
    rowAbs: endParsed.rowAbs,
  });

  return result;
}

/**
 * Shift a row range (start and end row indices).
 * Returns new start and end, or isError if the range is deleted.
 */
function shiftRowRange(
  startRow: number,
  endRow: number,
  at: number,
  count: number,
): { newStart: number; newEnd: number; isError: boolean } {
  if (count > 0) {
    // Inserting rows
    let newStart = startRow;
    let newEnd = endRow;

    if (startRow >= at) {
      newStart = startRow + count;
    }
    if (endRow >= at) {
      newEnd = endRow + count;
    }

    return { newStart, newEnd, isError: false };
  } else if (count < 0) {
    // Deleting rows
    const deleteStart = at;
    const deleteEnd = at + Math.abs(count);

    // Check if range is entirely within deleted range
    if (startRow >= deleteStart && endRow < deleteEnd) {
      return { newStart: startRow, newEnd: endRow, isError: true };
    }

    // Clip range to deleted band
    let newStart = startRow;
    let newEnd = endRow;

    if (startRow >= deleteStart && startRow < deleteEnd) {
      // Start is in deleted range, clip to deleteEnd
      newStart = deleteEnd;
    }
    if (endRow >= deleteStart && endRow < deleteEnd) {
      // End is in deleted range, clip to deleteStart - 1
      newEnd = deleteStart - 1;
    }

    // Shift rows below deleted range
    if (newStart >= deleteEnd) {
      newStart = newStart + count;
    }
    if (newEnd >= deleteEnd) {
      newEnd = newEnd + count;
    }

    // Check if range is still valid after clipping
    if (newStart > newEnd) {
      return { newStart, newEnd, isError: true };
    }

    return { newStart, newEnd, isError: false };
  }

  // count === 0, no shift
  return { newStart: startRow, newEnd: endRow, isError: false };
}



export interface Range {
  sheet?: string;
  start: { row: number; col: number };
  end: { row: number; col: number };
}

/**
 * Extract all ranges (including single-cell refs) from a formula.
 * Single refs are treated as 1×1 ranges.
 * Ranges are normalized so start.row ≤ end.row and start.col ≤ end.col.
 */
export function rangesIn(f: string): Range[] {
  const tokens = tokenize(f);
  const ranges: Range[] = [];

  for (const token of tokens) {
    if (token.type === 'ref') {
      const parsed = parseRef(token.text);
      const range: Range = {
        start: { row: parsed.row, col: parsed.col },
        end: { row: parsed.row, col: parsed.col },
      };
      if (parsed.sheet !== undefined) {
        range.sheet = parsed.sheet;
      }
      ranges.push(range);
    } else if (token.type === 'range') {
      const range = parseRange(token.text);
      if (range) {
        ranges.push(range);
      }
    }
  }

  return ranges;
}

/**
 * Parse a range token into a Range object.
 */
function parseRange(rangeText: string): Range | null {
  let remaining = rangeText;
  let sheet: string | undefined;

  // Parse sheet qualifier if present
  const bangIndex = remaining.lastIndexOf('!');
  if (bangIndex !== -1) {
    const sheetPart = remaining.substring(0, bangIndex);
    remaining = remaining.substring(bangIndex + 1);

    // Remove quotes if present
    if (sheetPart.startsWith("'") && sheetPart.endsWith("'")) {
      sheet = sheetPart.substring(1, sheetPart.length - 1).replace(/''/g, "'");
    } else {
      sheet = sheetPart;
    }
  }

  // Split on :
  const parts = remaining.split(':');
  if (parts.length !== 2) {
    return null; // Invalid range
  }
  const start = parts[0];
  const end = parts[1];
  if (start === undefined || end === undefined) {
    return null;
  }

  // Check for whole column (A:A)
  if (/^\$?[A-Z]+$/i.test(start) && /^\$?[A-Z]+$/i.test(end)) {
    const startCol = colToIndex(start.replace('$', '').toUpperCase());
    const endCol = colToIndex(end.replace('$', '').toUpperCase());

    // Normalize
    const [normStart, normEnd] = startCol <= endCol ? [startCol, endCol] : [endCol, startCol];

    const range: Range = {
      start: { row: 0, col: normStart },
      end: { row: Number.MAX_SAFE_INTEGER, col: normEnd }, // Whole column
    };
    if (sheet !== undefined) {
      range.sheet = sheet;
    }
    return range;
  }

  // Check for whole row (1:1)
  if (/^\$?[0-9]+$/.test(start) && /^\$?[0-9]+$/.test(end)) {
    const startRow = parseInt(start.replace('$', ''), 10) - 1; // zero-indexed
    const endRow = parseInt(end.replace('$', ''), 10) - 1;

    // Normalize
    const [normStart, normEnd] = startRow <= endRow ? [startRow, endRow] : [endRow, startRow];

    const range: Range = {
      start: { row: normStart, col: 0 },
      end: { row: normEnd, col: Number.MAX_SAFE_INTEGER }, // Whole row
    };
    if (sheet !== undefined) {
      range.sheet = sheet;
    }
    return range;
  }

  // Regular cell range
  const startParsed = parseRef(start);
  const endParsed = parseRef(end);

  // Normalize
  const startRow = Math.min(startParsed.row, endParsed.row);
  const endRow = Math.max(startParsed.row, endParsed.row);
  const startCol = Math.min(startParsed.col, endParsed.col);
  const endCol = Math.max(startParsed.col, endParsed.col);

  const range: Range = {
    start: { row: startRow, col: startCol },
    end: { row: endRow, col: endCol },
  };
  if (sheet !== undefined) {
    range.sheet = sheet;
  }
  return range;
}
