import { describe, it, expect, afterEach } from 'vitest';
import {
  ALLOWANCES,
  allowanceFor,
  burstPerMin,
  dailyLimit,
  monthlyLimitFor,
} from './allowances.js';

describe('AI allowances', () => {
  it('defaults to 30 adviser reads, 3 style readings and 15 descriptions a month', () => {
    expect(monthlyLimitFor('adviser', {})).toBe(30);
    expect(monthlyLimitFor('style', {})).toBe(3);
    expect(monthlyLimitFor('altText', {})).toBe(15);
  });

  it('defaults to 200 a day and 40 a minute', () => {
    expect(dailyLimit({})).toBe(200);
    expect(burstPerMin({})).toBe(40);
  });

  it('reads a number from the environment', () => {
    expect(
      monthlyLimitFor('adviser', { AI_ADVISER_MONTHLY_LIMIT: '100' }),
    ).toBe(100);
    expect(monthlyLimitFor('style', { AI_STYLE_MONTHLY_LIMIT: ' 7 ' })).toBe(7);
    expect(
      monthlyLimitFor('altText', { AI_ALT_TEXT_MONTHLY_LIMIT: '50' }),
    ).toBe(50);
    expect(dailyLimit({ AI_DAILY_LIMIT: '1000' })).toBe(1000);
    expect(burstPerMin({ AI_BURST_PER_MIN: '5' })).toBe(5);
  });

  it("reads 'unlimited' and 'none' as no limit", () => {
    for (const value of ['unlimited', 'UNLIMITED', ' none ']) {
      expect(
        monthlyLimitFor('adviser', { AI_ADVISER_MONTHLY_LIMIT: value }),
      ).toBeNull();
    }
  });

  it('reads 0 as none allowed', () => {
    expect(monthlyLimitFor('altText', { AI_ALT_TEXT_MONTHLY_LIMIT: '0' })).toBe(
      0,
    );
  });

  it('falls back to the default for anything it cannot read, never to unlimited', () => {
    for (const value of ['', 'lots', '-5', '1.5', '12abc']) {
      expect(
        monthlyLimitFor('adviser', { AI_ADVISER_MONTHLY_LIMIT: value }),
      ).toBe(30);
    }
    // The daily ceiling and the burst have no "unlimited": 0 or junk is the default.
    expect(dailyLimit({ AI_DAILY_LIMIT: '0' })).toBe(200);
    expect(dailyLimit({ AI_DAILY_LIMIT: 'unlimited' })).toBe(200);
    expect(burstPerMin({ AI_BURST_PER_MIN: 'x' })).toBe(40);
  });

  describe('read when called', () => {
    const saved = process.env.AI_STYLE_MONTHLY_LIMIT;
    afterEach(() => {
      if (saved === undefined) delete process.env.AI_STYLE_MONTHLY_LIMIT;
      else process.env.AI_STYLE_MONTHLY_LIMIT = saved;
    });

    it('sees a change to process.env made after import', () => {
      delete process.env.AI_STYLE_MONTHLY_LIMIT;
      expect(monthlyLimitFor('style')).toBe(3);
      process.env.AI_STYLE_MONTHLY_LIMIT = '9';
      expect(monthlyLimitFor('style')).toBe(9);
    });
  });

  it('keeps the ids the client uses, each with its own column', () => {
    expect(Object.keys(ALLOWANCES).sort()).toEqual([
      'adviser',
      'altText',
      'style',
    ]);
    expect(allowanceFor('adviser')).toMatchObject({
      table: 'posting_adviser_usage',
      column: 'count',
    });
    expect(allowanceFor('style')).toMatchObject({
      table: 'posting_adviser_usage',
      column: 'style_count',
    });
    expect(allowanceFor('altText')).toMatchObject({
      table: 'alt_text_usage',
      column: 'count',
    });
    expect(() => allowanceFor('reflection')).toThrow(/Unknown AI allowance/);
    expect(() => monthlyLimitFor('constructor', {})).toThrow(
      /Unknown AI allowance/,
    );
  });
});
