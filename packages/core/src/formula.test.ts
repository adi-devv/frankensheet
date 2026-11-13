import { describe, it, expect } from 'vitest';
import {
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

describe('colToIndex', () => {
  it('converts single letters', () => {
    expect(colToIndex('A')).toBe(0);
    expect(colToIndex('B')).toBe(1);
    expect(colToIndex('Z')).toBe(25);
  });

  it('converts double letters', () => {
    expect(colToIndex('AA')).toBe(26);
    expect(colToIndex('AB')).toBe(27);
    expect(colToIndex('AZ')).toBe(51);
    expect(colToIndex('BA')).toBe(52);
    expect(colToIndex('ZZ')).toBe(701);
  });
});

describe('indexToCol', () => {
  it('converts single letters', () => {
    expect(indexToCol(0)).toBe('A');
    expect(indexToCol(1)).toBe('B');
    expect(indexToCol(25)).toBe('Z');
  });

  it('converts double letters', () => {
    expect(indexToCol(26)).toBe('AA');
    expect(indexToCol(27)).toBe('AB');
    expect(indexToCol(51)).toBe('AZ');
    expect(indexToCol(52)).toBe('BA');
    expect(indexToCol(701)).toBe('ZZ');
  });

  it('round-trips with colToIndex', () => {
    for (let i = 0; i < 1000; i++) {
      expect(colToIndex(indexToCol(i))).toBe(i);
    }
  });
});

describe('parseRef', () => {
  it('parses simple ref', () => {
    const parsed = parseRef('A1');
    expect(parsed).toEqual({ col: 0, row: 0, colAbs: false, rowAbs: false });
  });

  it('parses absolute ref', () => {
    const parsed = parseRef('$B$2');
    expect(parsed).toEqual({ col: 1, row: 1, colAbs: true, rowAbs: true });
  });

  it('parses mixed absolute ref', () => {
    const parsed1 = parseRef('$C3');
    expect(parsed1).toEqual({ col: 2, row: 2, colAbs: true, rowAbs: false });

    const parsed2 = parseRef('D$4');
    expect(parsed2).toEqual({ col: 3, row: 3, colAbs: false, rowAbs: true });
  });

  it('parses sheet-qualified ref', () => {
    const parsed = parseRef('Sheet1!A1');
    expect(parsed).toEqual({ sheet: 'Sheet1', col: 0, row: 0, colAbs: false, rowAbs: false });
  });

  it('parses quoted sheet name', () => {
    const parsed = parseRef("'My Sheet'!B2");
    expect(parsed).toEqual({ sheet: 'My Sheet', col: 1, row: 1, colAbs: false, rowAbs: false });
  });

  it('parses quoted sheet with escaped quotes', () => {
    const parsed = parseRef("'It''s Sheet'!C3");
    expect(parsed).toEqual({ sheet: "It's Sheet", col: 2, row: 2, colAbs: false, rowAbs: false });
  });
});

describe('refToString', () => {
  it('converts simple ref', () => {
    expect(refToString({ col: 0, row: 0, colAbs: false, rowAbs: false })).toBe('A1');
  });

  it('converts absolute ref', () => {
    expect(refToString({ col: 1, row: 1, colAbs: true, rowAbs: true })).toBe('$B$2');
  });

  it('converts mixed absolute ref', () => {
    expect(refToString({ col: 2, row: 2, colAbs: true, rowAbs: false })).toBe('$C3');
    expect(refToString({ col: 3, row: 3, colAbs: false, rowAbs: true })).toBe('D$4');
  });

  it('converts sheet-qualified ref', () => {
    expect(refToString({ sheet: 'Sheet1', col: 0, row: 0, colAbs: false, rowAbs: false })).toBe(
      'Sheet1!A1',
    );
  });

  it('quotes sheet name with spaces', () => {
    expect(refToString({ sheet: 'My Sheet', col: 1, row: 1, colAbs: false, rowAbs: false })).toBe(
      "'My Sheet'!B2",
    );
  });

  it('escapes quotes in sheet name', () => {
    expect(refToString({ sheet: "It's Sheet", col: 2, row: 2, colAbs: false, rowAbs: false })).toBe(
      "'It''s Sheet'!C3",
    );
  });

  it('round-trips with parseRef', () => {
    const refs = [
      'A1',
      '$A$1',
      '$A1',
      'A$1',
      'Sheet1!A1',
      "'My Sheet'!B2",
      "'It''s Sheet'!C3",
      'ZZ999',
    ];
    for (const ref of refs) {
      expect(refToString(parseRef(ref))).toBe(ref);
    }
  });
});



describe('tokenize', () => {
  it('tokenizes whitespace', () => {
    const tokens = tokenize('  A1  ');
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({ type: 'whitespace', text: '  ' });
    expect(tokens[1]).toEqual({ type: 'ref', text: 'A1' });
    expect(tokens[2]).toEqual({ type: 'whitespace', text: '  ' });
  });

  it('tokenizes strings with escaped quotes', () => {
    const tokens = tokenize('"Hello ""World"""');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ type: 'string', text: '"Hello ""World"""' });
  });

  it('tokenizes error tokens', () => {
    const tokens = tokenize('#REF!+#DIV/0!');
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({ type: 'error', text: '#REF!' });
    expect(tokens[1]).toEqual({ type: 'operator', text: '+' });
    expect(tokens[2]).toEqual({ type: 'error', text: '#DIV/0!' });
  });

  it('tokenizes all error types', () => {
    const errors = ['#REF!', '#DIV/0!', '#VALUE!', '#N/A', '#NAME?', '#NUM!', '#NULL!'];
    for (const err of errors) {
      const tokens = tokenize(err);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toEqual({ type: 'error', text: err });
    }
  });

  it('tokenizes numbers', () => {
    const tokens1 = tokenize('123');
    expect(tokens1).toEqual([{ type: 'number', text: '123' }]);

    const tokens2 = tokenize('1.5');
    expect(tokens2).toEqual([{ type: 'number', text: '1.5' }]);

    const tokens3 = tokenize('1E+10');
    expect(tokens3).toEqual([{ type: 'number', text: '1E+10' }]);

    const tokens4 = tokenize('2.5e-3');
    expect(tokens4).toEqual([{ type: 'number', text: '2.5e-3' }]);
  });

  it('tokenizes simple refs', () => {
    const tokens = tokenize('A1');
    expect(tokens).toEqual([{ type: 'ref', text: 'A1' }]);
  });

  it('tokenizes absolute refs', () => {
    const tokens = tokenize('$A$1');
    expect(tokens).toEqual([{ type: 'ref', text: '$A$1' }]);
  });

  it('tokenizes ranges', () => {
    const tokens = tokenize('A1:B2');
    expect(tokens).toEqual([{ type: 'range', text: 'A1:B2' }]);
  });

  it('tokenizes absolute ranges', () => {
    const tokens = tokenize('$A$1:$B$2');
    expect(tokens).toEqual([{ type: 'range', text: '$A$1:$B$2' }]);
  });

  it('tokenizes sheet-qualified refs', () => {
    const tokens = tokenize('Sheet1!A1');
    expect(tokens).toEqual([{ type: 'ref', text: 'Sheet1!A1' }]);
  });

  it('tokenizes sheet-qualified ranges', () => {
    const tokens = tokenize("'My Sheet'!A1:B2");
    expect(tokens).toEqual([{ type: 'range', text: "'My Sheet'!A1:B2" }]);
  });

  it('tokenizes whole columns', () => {
    const tokens1 = tokenize('A:A');
    expect(tokens1).toEqual([{ type: 'range', text: 'A:A' }]);

    const tokens2 = tokenize('$A:$Z');
    expect(tokens2).toEqual([{ type: 'range', text: '$A:$Z' }]);
  });

  it('tokenizes whole rows', () => {
    const tokens1 = tokenize('1:10');
    expect(tokens1).toEqual([{ type: 'range', text: '1:10' }]);

    const tokens2 = tokenize('$1:$10');
    expect(tokens2).toEqual([{ type: 'range', text: '$1:$10' }]);
  });

  it('tokenizes functions', () => {
    const tokens1 = tokenize('SUM(');
    expect(tokens1).toEqual([{ type: 'function', text: 'SUM(' }]);

    const tokens2 = tokenize('LOG10(');
    expect(tokens2).toEqual([{ type: 'function', text: 'LOG10(' }]);

    const tokens3 = tokenize('_xlfn.IFS(');
    expect(tokens3).toEqual([{ type: 'function', text: '_xlfn.IFS(' }]);

    const tokens4 = tokenize('sum('); // lowercase
    expect(tokens4).toEqual([{ type: 'function', text: 'sum(' }]);
  });

  it('tokenizes booleans', () => {
    const tokens1 = tokenize('TRUE');
    expect(tokens1).toEqual([{ type: 'boolean', text: 'TRUE' }]);

    const tokens2 = tokenize('FALSE');
    expect(tokens2).toEqual([{ type: 'boolean', text: 'FALSE' }]);

    const tokens3 = tokenize('true'); // lowercase
    expect(tokens3).toEqual([{ type: 'boolean', text: 'true' }]);
  });

  it('tokenizes operators', () => {
    const tokens = tokenize('A1+B2-C3*D4/E5^F6');
    expect(tokens).toEqual([
      { type: 'ref', text: 'A1' },
      { type: 'operator', text: '+' },
      { type: 'ref', text: 'B2' },
      { type: 'operator', text: '-' },
      { type: 'ref', text: 'C3' },
      { type: 'operator', text: '*' },
      { type: 'ref', text: 'D4' },
      { type: 'operator', text: '/' },
      { type: 'ref', text: 'E5' },
      { type: 'operator', text: '^' },
      { type: 'ref', text: 'F6' },
    ]);
  });

  it('tokenizes comparison operators', () => {
    const tokens = tokenize('A1=B2');
    expect(tokens).toEqual([
      { type: 'ref', text: 'A1' },
      { type: 'operator', text: '=' },
      { type: 'ref', text: 'B2' },
    ]);

    const tokens2 = tokenize('A1<>B2');
    expect(tokens2).toEqual([
      { type: 'ref', text: 'A1' },
      { type: 'operator', text: '<>' },
      { type: 'ref', text: 'B2' },
    ]);

    const tokens3 = tokenize('A1<=B2');
    expect(tokens3).toEqual([
      { type: 'ref', text: 'A1' },
      { type: 'operator', text: '<=' },
      { type: 'ref', text: 'B2' },
    ]);

    const tokens4 = tokenize('A1>=B2');
    expect(tokens4).toEqual([
      { type: 'ref', text: 'A1' },
      { type: 'operator', text: '>=' },
      { type: 'ref', text: 'B2' },
    ]);
  });

  it('tokenizes parens and commas', () => {
    const tokens = tokenize('(A1,B1)');
    expect(tokens).toEqual([
      { type: 'paren', text: '(' },
      { type: 'ref', text: 'A1' },
      { type: 'comma', text: ',' },
      { type: 'ref', text: 'B1' },
      { type: 'paren', text: ')' },
    ]);
  });

  it('integration test: complex formula', () => {
    const tokens = tokenize("SUM('Sheet 1'!A1:B2,C3)");
    expect(tokens).toEqual([
      { type: 'function', text: 'SUM(' },
      { type: 'range', text: "'Sheet 1'!A1:B2" },
      { type: 'comma', text: ',' },
      { type: 'ref', text: 'C3' },
      { type: 'paren', text: ')' },
    ]);
  });

  it('tokenizes defined names', () => {
    const tokens = tokenize('MyName+A1');
    expect(tokens).toEqual([
      { type: 'name', text: 'MyName' },
      { type: 'operator', text: '+' },
      { type: 'ref', text: 'A1' },
    ]);
  });
});


describe('toR1C1', () => {
  it('converts simple unqualified ref at (0,0)', () => {
    expect(toR1C1('A1', { row: 0, col: 0 })).toBe('RC');
  });

  it('converts simple unqualified ref with offset', () => {
    expect(toR1C1('A1', { row: 1, col: 0 })).toBe('R[-1]C');
    expect(toR1C1('B3', { row: 0, col: 0 })).toBe('R[2]C[1]');
    expect(toR1C1('C2', { row: 1, col: 1 })).toBe('RC[1]');
  });

  it('converts absolute ref', () => {
    expect(toR1C1('$A$1', { row: 0, col: 0 })).toBe('R1C1');
    expect(toR1C1('$B$2', { row: 5, col: 5 })).toBe('R2C2');
  });

  it('converts mixed absolute ref', () => {
    expect(toR1C1('$A1', { row: 0, col: 0 })).toBe('RC1');
    expect(toR1C1('A$1', { row: 0, col: 0 })).toBe('R1C');
    expect(toR1C1('$B3', { row: 1, col: 1 })).toBe('R[1]C2');
    expect(toR1C1('C$2', { row: 1, col: 1 })).toBe('R2C[1]');
  });

  it('converts range', () => {
    expect(toR1C1('A1:B2', { row: 0, col: 0 })).toBe('RC:R[1]C[1]');
    expect(toR1C1('$A$1:$B$2', { row: 5, col: 5 })).toBe('R1C1:R2C2');
  });

  it('converts sheet-qualified ref', () => {
    expect(toR1C1('Sheet1!A1', { row: 0, col: 0 })).toBe('Sheet1!RC');
    expect(toR1C1('Sheet1!B3', { row: 1, col: 1 })).toBe('Sheet1!R[1]C');
  });

  it('converts sheet-qualified range with quoted name', () => {
    expect(toR1C1("'My Sheet'!A1:B2", { row: 0, col: 0 })).toBe("'My Sheet'!RC:R[1]C[1]");
  });

  it('converts whole column range', () => {
    expect(toR1C1('A:A', { row: 0, col: 0 })).toBe('C:C');
    expect(toR1C1('$A:$A', { row: 0, col: 0 })).toBe('C1:C1');
    expect(toR1C1('B:D', { row: 0, col: 0 })).toBe('C[1]:C[3]');
  });

  it('converts whole row range', () => {
    expect(toR1C1('1:1', { row: 0, col: 0 })).toBe('R:R');
    expect(toR1C1('$1:$1', { row: 0, col: 0 })).toBe('R1:R1');
    expect(toR1C1('3:5', { row: 0, col: 0 })).toBe('R[2]:R[4]');
  });

  it('converts formula with multiple refs', () => {
    expect(toR1C1('A1+B1', { row: 0, col: 0 })).toBe('RC+RC[1]');
    expect(toR1C1('SUM(A1:A10)', { row: 0, col: 0 })).toBe('SUM(RC:R[9]C)');
  });
});

describe('toA1', () => {
  it('converts simple R1C1 ref', () => {
    expect(toA1('RC', { row: 0, col: 0 })).toBe('A1');
    expect(toA1('R[-1]C', { row: 1, col: 0 })).toBe('A1');
    expect(toA1('R[2]C[1]', { row: 0, col: 0 })).toBe('B3');
  });

  it('converts absolute R1C1 ref', () => {
    expect(toA1('R1C1', { row: 0, col: 0 })).toBe('$A$1');
    expect(toA1('R2C2', { row: 5, col: 5 })).toBe('$B$2');
  });

  it('converts mixed absolute R1C1 ref', () => {
    expect(toA1('RC1', { row: 0, col: 0 })).toBe('$A1');
    expect(toA1('R1C', { row: 0, col: 0 })).toBe('A$1');
    expect(toA1('R[1]C2', { row: 1, col: 1 })).toBe('$B3');
    expect(toA1('R2C[1]', { row: 1, col: 1 })).toBe('C$2');
  });

  it('converts R1C1 range', () => {
    expect(toA1('RC:R[1]C[1]', { row: 0, col: 0 })).toBe('A1:B2');
    expect(toA1('R1C1:R2C2', { row: 5, col: 5 })).toBe('$A$1:$B$2');
  });

  it('converts sheet-qualified R1C1 ref', () => {
    expect(toA1('Sheet1!RC', { row: 0, col: 0 })).toBe('Sheet1!A1');
    expect(toA1('Sheet1!R[1]C', { row: 1, col: 1 })).toBe('Sheet1!B3');
  });

  it('converts sheet-qualified R1C1 range', () => {
    expect(toA1("'My Sheet'!RC:R[1]C[1]", { row: 0, col: 0 })).toBe("'My Sheet'!A1:B2");
  });

  it('converts formula with multiple R1C1 refs', () => {
    expect(toA1('RC+RC[1]', { row: 0, col: 0 })).toBe('A1+B1');
    expect(toA1('SUM(RC:R[9]C)', { row: 0, col: 0 })).toBe('SUM(A1:A10)');
  });

  it('round-trips with toR1C1', () => {
    const formulas = [
      'A1',
      '$A$1',
      '$A1',
      'A$1',
      'A1+B1',
      'SUM(A1:A10)',
      'Sheet1!A1',
      "'My Sheet'!B2",
      'A1:B2',
      'C3*D4',
    ];
    const positions = [
      { row: 0, col: 0 },
      { row: 5, col: 5 },
      { row: 10, col: 2 },
    ];

    for (const formula of formulas) {
      for (const pos of positions) {
        const r1c1 = toR1C1(formula, pos);
        const a1 = toA1(r1c1, pos);
        expect(a1).toBe(formula);
      }
    }
  });
});


describe('shiftFormula', () => {
  it('shifts unqualified ref when row >= at', () => {
    expect(shiftFormula('A3', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('A5');
    expect(shiftFormula('B5', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('B7');
  });

  it('does not shift unqualified ref when row < at', () => {
    expect(shiftFormula('A1', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('A1');
    expect(shiftFormula('B2', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('B2');
  });

  it('shifts range', () => {
    expect(shiftFormula('SUM(A3:A5)', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('SUM(A5:A7)');
    expect(shiftFormula('A1:A5', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('A1:A7');
  });

  it('shifts sheet-qualified ref matching sheet', () => {
    expect(shiftFormula('Sheet1!A3', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('Sheet1!A5');
  });

  it('does not shift sheet-qualified ref for different sheet', () => {
    expect(shiftFormula('Sheet1!A3+Sheet2!A3', { sheet: 'Sheet1', at: 2, count: 2 })).toBe(
      'Sheet1!A5+Sheet2!A3',
    );
  });

  it('shifts absolute ref', () => {
    expect(shiftFormula('$A$3', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('$A$5');
    expect(shiftFormula('$B$5', { sheet: 'Sheet1', at: 3, count: 1 })).toBe('$B$6');
  });

  it('deletes single ref in deleted range', () => {
    expect(shiftFormula('A3', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('#REF!');
    expect(shiftFormula('A4', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('#REF!');
  });

  it('shifts ref below deleted range', () => {
    expect(shiftFormula('A6', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('A4');
    expect(shiftFormula('A5', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('A3');
  });

  it('does not shift ref above deleted range', () => {
    expect(shiftFormula('A1', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('A1');
    expect(shiftFormula('A2', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('A2');
  });

  it('clips range partially in deleted range', () => {
    expect(shiftFormula('SUM(A2:A6)', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('SUM(A2:A4)');
    expect(shiftFormula('A1:A5', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('A1:A3');
  });

  it('deletes range entirely in deleted range', () => {
    expect(shiftFormula('SUM(A3:A4)', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('SUM(#REF!)');
    expect(shiftFormula('A3:A3', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('#REF!');
  });

  it('does not shift whole column range', () => {
    expect(shiftFormula('SUM(A:A)', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('SUM(A:A)');
    expect(shiftFormula('$A:$Z', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('$A:$Z');
  });

  it('shifts whole row range', () => {
    expect(shiftFormula('3:5', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('5:7');
    expect(shiftFormula('$1:$2', { sheet: 'Sheet1', at: 0, count: 1 })).toBe('$2:$3');
  });

  it('handles complex formula with multiple refs', () => {
    expect(shiftFormula('A3+A6', { sheet: 'Sheet1', at: 2, count: -2 })).toBe('#REF!+A4');
    expect(shiftFormula('A1+A5', { sheet: 'Sheet1', at: 2, count: 2 })).toBe('A1+A7');
  });
});


describe('rangesIn', () => {
  it('extracts single ref as 1x1 range', () => {
    const ranges = rangesIn('A1');
    expect(ranges).toEqual([
      {
        start: { row: 0, col: 0 },
        end: { row: 0, col: 0 },
      },
    ]);
  });

  it('extracts cell range', () => {
    const ranges = rangesIn('SUM(A1:B2)');
    expect(ranges).toEqual([
      {
        start: { row: 0, col: 0 },
        end: { row: 1, col: 1 },
      },
    ]);
  });

  it('extracts sheet-qualified range', () => {
    const ranges = rangesIn("'My Sheet'!A1:B2");
    expect(ranges).toEqual([
      {
        sheet: 'My Sheet',
        start: { row: 0, col: 0 },
        end: { row: 1, col: 1 },
      },
    ]);
  });

  it('normalizes reversed range', () => {
    const ranges = rangesIn('B2:A1');
    expect(ranges).toEqual([
      {
        start: { row: 0, col: 0 },
        end: { row: 1, col: 1 },
      },
    ]);
  });

  it('extracts multiple ranges', () => {
    const ranges = rangesIn('SUM(A1:B2)+AVERAGE(C3:C5,Sheet2!D1)');
    expect(ranges).toEqual([
      {
        start: { row: 0, col: 0 },
        end: { row: 1, col: 1 },
      },
      {
        start: { row: 2, col: 2 },
        end: { row: 4, col: 2 },
      },
      {
        sheet: 'Sheet2',
        start: { row: 0, col: 3 },
        end: { row: 0, col: 3 },
      },
    ]);
  });

  it('extracts whole column range', () => {
    const ranges = rangesIn('SUM(A:A)');
    expect(ranges).toEqual([
      {
        start: { row: 0, col: 0 },
        end: { row: Number.MAX_SAFE_INTEGER, col: 0 },
      },
    ]);
  });

  it('extracts whole row range', () => {
    const ranges = rangesIn('SUM(1:1)');
    expect(ranges).toEqual([
      {
        start: { row: 0, col: 0 },
        end: { row: 0, col: Number.MAX_SAFE_INTEGER },
      },
    ]);
  });

  it('integration test: multiple ranges with different qualifiers', () => {
    const ranges = rangesIn("SUM(A1:B2)+AVERAGE(C3:C5,Sheet2!D1)+'Sheet 3'!E1:E10");
    expect(ranges).toEqual([
      {
        start: { row: 0, col: 0 },
        end: { row: 1, col: 1 },
      },
      {
        start: { row: 2, col: 2 },
        end: { row: 4, col: 2 },
      },
      {
        sheet: 'Sheet2',
        start: { row: 0, col: 3 },
        end: { row: 0, col: 3 },
      },
      {
        sheet: 'Sheet 3',
        start: { row: 0, col: 4 },
        end: { row: 9, col: 4 },
      },
    ]);
  });
});
