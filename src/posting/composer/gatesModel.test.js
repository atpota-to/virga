import { describe, expect, it } from 'vitest';
import { replyMode, hasRule, toggleRule, rulesNote } from './gatesModel.js';

describe('gatesModel', () => {
  it('reads the mode', () => {
    expect(replyMode(null)).toBe('everyone');
    expect(replyMode([])).toBe('nobody');
    expect(replyMode([{ type: 'mention' }])).toBe('some');
  });

  it('adds and takes out rules, lists by URI', () => {
    let r = toggleRule([{ type: 'mention' }], {
      type: 'list',
      list: 'at://a/app.bsky.graph.list/1',
    });
    expect(
      hasRule(r, { type: 'list', list: 'at://a/app.bsky.graph.list/1' }),
    ).toBe(true);
    expect(
      hasRule(r, { type: 'list', list: 'at://a/app.bsky.graph.list/2' }),
    ).toBe(false);
    r = toggleRule(r, { type: 'mention' });
    expect(r).toEqual([{ type: 'list', list: 'at://a/app.bsky.graph.list/1' }]);
  });

  it('never empties the list, which would mean nobody', () => {
    expect(toggleRule([{ type: 'mention' }], { type: 'mention' })).toEqual([
      { type: 'mention' },
    ]);
  });

  it('stops at five', () => {
    const five = [1, 2, 3, 4, 5].map((n) => ({
      type: 'list',
      list: `at://a/app.bsky.graph.list/${n}`,
    }));
    expect(toggleRule(five, { type: 'mention' })).toBe(five);
    expect(rulesNote(five)).toMatch(/5 groups/);
    expect(rulesNote([{ type: 'mention' }])).toMatch(/at least one/);
    expect(rulesNote(null)).toBe('');
  });
});
