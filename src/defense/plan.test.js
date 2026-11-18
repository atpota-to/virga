import { describe, expect, it } from 'vitest';
import { BATCH, NOTE_MAX, PLAN_MAX, bandCounts, cleanNote, estimateWords, estimateWrites, planRows } from './plan.js';

const summary = {
  rows: [
    { did: 'did:plc:p', band: 'PROTECTED', trust: 100, youFollow: true },
    { did: 'did:plc:c', band: 'CONNECTED', trust: 70 },
    { did: 'did:plc:r', band: 'PERIPHERAL', trust: 40 },
    { did: 'did:plc:n', band: 'NOTABLE', trust: 30 },
    { did: 'did:plc:u1', band: 'UNKNOWN', trust: 3 },
    { did: 'did:plc:u2', band: 'UNKNOWN', trust: 2 },
    // A follow made after the bands were drawn still counts.
    { did: 'did:plc:u3', band: 'UNKNOWN', trust: 1, youFollow: true },
  ],
};

describe('a plan from a scan', () => {
  it('takes the ticked bands and never PROTECTED, nor anyone followed', () => {
    expect(planRows(summary, ['UNKNOWN']).map((r) => r.did)).toEqual(['did:plc:u1', 'did:plc:u2']);
    expect(planRows(summary, ['PROTECTED', 'CONNECTED']).map((r) => r.did)).toEqual(['did:plc:c']);
    expect(planRows(summary, ['UNKNOWN', 'NOTABLE', 'PERIPHERAL', 'CONNECTED'])).toHaveLength(5);
    expect(planRows(summary, ['nonsense'])).toEqual([]);
    expect(planRows(null, ['UNKNOWN'])).toEqual([]);
  });

  it('keeps only the DID, the band and the trust key', () => {
    expect(planRows(summary, ['CONNECTED'])).toEqual([{ did: 'did:plc:c', band: 'CONNECTED', trust: 70 }]);
  });

  it('leaves out who is on the list already, and counts each band without them', () => {
    const listed = new Set(['did:plc:u1']);
    expect(planRows(summary, ['UNKNOWN'], { listed }).map((r) => r.did)).toEqual(['did:plc:u2']);
    expect(bandCounts(summary, { listed })).toEqual({ UNKNOWN: 1, NOTABLE: 1, PERIPHERAL: 1, CONNECTED: 1 });
  });
});

describe('how long it takes', () => {
  it('is the pace or the write limit, whichever is slower', () => {
    expect(estimateWrites(0)).toEqual({ writes: 0, points: 0, minutes: 0 });
    expect(estimateWrites(BATCH).minutes).toBe(2);
    expect(estimateWrites(1500).minutes).toBeGreaterThanOrEqual(58);
    expect(estimateWrites(1500).points).toBe(4500);
    expect(estimateWrites(PLAN_MAX).minutes).toBeGreaterThan(6 * 60);
  });

  it('says so in words', () => {
    expect(estimateWords(0)).toBe('nothing to write');
    expect(estimateWords(10)).toBe('a minute or two');
    expect(estimateWords(600)).toMatch(/^about \d+ minutes$/);
    expect(estimateWords(5000)).toMatch(/^about \d+\.\d hours$/);
  });
});

describe('the owner’s words', () => {
  it('are trimmed, kept on one line and capped', () => {
    expect(cleanNote('  pile-on \n\n from the quote  ')).toBe('pile-on from the quote');
    expect(cleanNote('')).toBeNull();
    expect(cleanNote(null)).toBeNull();
    expect(cleanNote('x'.repeat(NOTE_MAX + 50))).toHaveLength(NOTE_MAX);
  });
});
