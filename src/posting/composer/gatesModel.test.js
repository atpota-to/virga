import { describe, expect, it } from 'vitest';
import { replyMode, hasRule, toggleRule, rulesNote, gatesForAccount, unlistedRules, isForeignListRule } from './gatesModel.js';

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

describe('gatesForAccount', () => {
  const MIRA_LIST = 'at://did:plc:mira/app.bsky.graph.list/neighbourhood';
  const LAB_LIST = 'at://did:plc:lab/app.bsky.graph.list/staff';

  it('takes another account’s lists out of the rules', () => {
    const gates = { custom: true, quotes: true, reply: [{ type: 'mention' }, { type: 'list', list: MIRA_LIST }, { type: 'list', list: LAB_LIST }] };
    const r = gatesForAccount(gates, 'did:plc:lab');
    expect(r.dropped).toBe(1);
    expect(r.reset).toBe(false);
    expect(r.gates.reply).toEqual([{ type: 'mention' }, { type: 'list', list: LAB_LIST }]);
    expect(r.gates.custom).toBe(true);
  });

  it('goes back to the account’s default rather than read as nobody', () => {
    const r = gatesForAccount({ custom: true, quotes: false, reply: [{ type: 'list', list: MIRA_LIST }] }, 'did:plc:lab');
    expect(r).toMatchObject({ dropped: 1, reset: true });
    expect(r.gates).toEqual({ custom: false, quotes: false, reply: null });
  });

  it('leaves gates with nothing foreign alone', () => {
    const gates = { custom: true, quotes: true, reply: [] };
    expect(gatesForAccount(gates, 'did:plc:lab')).toEqual({ gates, dropped: 0 });
    expect(gatesForAccount({ custom: true, reply: null }, 'did:plc:lab').dropped).toBe(0);
  });

  it('finds the list rules the account’s own lists don’t account for', () => {
    const reply = [{ type: 'follower' }, { type: 'list', list: MIRA_LIST }, { type: 'list', list: LAB_LIST }];
    expect(unlistedRules(reply, [LAB_LIST])).toEqual([{ type: 'list', list: MIRA_LIST }]);
    expect(isForeignListRule({ type: 'list', list: MIRA_LIST }, 'did:plc:lab')).toBe(true);
    expect(isForeignListRule({ type: 'list', list: LAB_LIST }, 'did:plc:lab')).toBe(false);
    expect(unlistedRules(null, [])).toEqual([]);
  });
});
