import { describe, it, expect } from 'vitest';
import { normalizeValue } from './normalize.js';

describe('normalizeValue', () => {
  it('should convert empty string to null', () => {
    expect(normalizeValue('')).toBeNull();
  });

  it('should preserve null', () => {
    expect(normalizeValue(null)).toBeNull();
  });

  it('should preserve numbers', () => {
    expect(normalizeValue(0)).toBe(0);
    expect(normalizeValue(42)).toBe(42);
    expect(normalizeValue(-3.14)).toBe(-3.14);
    expect(normalizeValue(1e10)).toBe(1e10);
  });

  it('should preserve booleans', () => {
    expect(normalizeValue(true)).toBe(true);
    expect(normalizeValue(false)).toBe(false);
  });

  it('should preserve error objects', () => {
    const error = { error: '#REF!' };
    expect(normalizeValue(error)).toEqual(error);
    expect(normalizeValue({ error: '#DIV/0!' })).toEqual({ error: '#DIV/0!' });
  });

  it('should preserve non-empty strings without trimming', () => {
    expect(normalizeValue('hello')).toBe('hello');
    expect(normalizeValue(' ')).toBe(' ');
    expect(normalizeValue('  spaces  ')).toBe('  spaces  ');
    expect(normalizeValue('\t')).toBe('\t');
    expect(normalizeValue('  ')).toBe('  ');
  });

  it('should be idempotent', () => {
    const testValues: Array<Parameters<typeof normalizeValue>[0]> = [
      null,
      '',
      0,
      42,
      -1.5,
      true,
      false,
      'hello',
      ' ',
      '  ',
      { error: '#REF!' },
    ];

    for (const v of testValues) {
      const once = normalizeValue(v);
      const twice = normalizeValue(once);
      expect(twice).toEqual(once);
    }
  });
});
