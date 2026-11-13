import { describe, it, expect } from 'vitest';
import { envInt, envList, isProduction } from './env.js';

describe('envInt', () => {
  it('reads a positive integer', () => {
    expect(envInt({ N: '42' }, 'N', 7)).toBe(42);
    expect(envInt({ N: ' 3 ' }, 'N', 7)).toBe(3);
  });

  it('falls back for anything that is not a positive integer', () => {
    for (const value of [undefined, '', '0', '-1', '1.5', '12abc', 'abc', '1e3', String(2 ** 60)]) {
      expect(envInt({ N: value }, 'N', 7)).toBe(7);
    }
    expect(envInt({}, 'N', null)).toBeNull();
  });

  it('reads process.env at call time by default', () => {
    const before = process.env.VIRGA_TEST_INT;
    try {
      process.env.VIRGA_TEST_INT = '5';
      expect(envInt(undefined, 'VIRGA_TEST_INT', 1)).toBe(5);
      process.env.VIRGA_TEST_INT = '9';
      expect(envInt(undefined, 'VIRGA_TEST_INT', 1)).toBe(9);
    } finally {
      if (before === undefined) delete process.env.VIRGA_TEST_INT;
      else process.env.VIRGA_TEST_INT = before;
    }
  });
});

describe('envList', () => {
  it('splits on commas, trims and drops empties', () => {
    expect(envList({ L: ' a, b ,,c , ' }, 'L')).toEqual(['a', 'b', 'c']);
  });

  it('is empty when unset', () => {
    expect(envList({}, 'L')).toEqual([]);
    expect(envList({ L: '' }, 'L')).toEqual([]);
  });
});

describe('isProduction', () => {
  it('is true on the production deployment or a production process', () => {
    expect(isProduction({ VERCEL_ENV: 'production' })).toBe(true);
    expect(isProduction({ NODE_ENV: 'production' })).toBe(true);
  });

  it('is false on previews, in development and in tests', () => {
    expect(isProduction({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(isProduction({ VERCEL_ENV: 'development', NODE_ENV: 'development' })).toBe(false);
    expect(isProduction({})).toBe(false);
  });
});
