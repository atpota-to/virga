import { describe, expect, it } from 'vitest';
import { decisionPhrase, planOutcome } from './historyModel.js';

const d = (over) => ({ id: 1, planId: 'p', action: 'add', state: 'done', undoneAt: null, reason: null, ...over });

describe('a decision, in words', () => {
  it('says what an add came to', () => {
    expect(decisionPhrase(d({}))).toBe('Added');
    expect(decisionPhrase(d({ state: 'queued' }))).toBe('Waiting to be added');
    expect(decisionPhrase(d({ state: 'vetoed', reason: 'you follow them' }))).toBe('Kept off: you follow them');
    expect(decisionPhrase(d({ state: 'failed', reason: 'Invalid subject' }))).toBe('Couldn’t add: Invalid subject');
    expect(decisionPhrase(d({ state: 'done', undoneAt: 'x' }))).toBe('Added, then taken off');
    expect(decisionPhrase(d({ state: 'cancelled', undoneAt: 'x' }))).toBe('Undone before it was written');
    expect(decisionPhrase(d({ state: 'already' }))).toBe('Was on the list already');
  });

  it('says what a removal came to', () => {
    expect(decisionPhrase(d({ action: 'remove' }))).toBe('Taken off');
    expect(decisionPhrase(d({ action: 'remove', state: 'already' }))).toBe('Taken off (already gone)');
    expect(decisionPhrase(d({ action: 'remove', state: 'queued' }))).toBe('Waiting to be taken off');
  });
});

describe('an approval, in all', () => {
  it('says what its adds came to, from the server’s counts', () => {
    expect(planOutcome({ counts: { added: 100, waiting: 394, kept: 2, failed: 0, undone: 0, live: 494 } })).toMatchObject({
      live: 494,
      line: '100 added · 394 waiting · 2 kept off by the veto',
    });
    expect(planOutcome({ counts: { undone: 3 } }).line).toBe('3 undone');
    expect(planOutcome({}).line).toBe('Nothing to add');
  });
});
