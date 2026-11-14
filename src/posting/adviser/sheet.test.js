/*
 * The posting adviser sheet's layout of a read: where each finding is marked
 * in the draft, how the notes are numbered, and the proofread's count line.
 * A mark placed somewhere the composer wouldn't apply the fix, or a number
 * that doesn't match its row, would show the writer something untrue.
 */

import { describe, it, expect } from 'vitest';
import {
  adviserVerdict,
  placeAdviserMarks,
  adviserSheetModel,
  adviserWritingTally,
  adviserDraftLabel,
} from './sheet.js';

describe('placeAdviserMarks', () => {
  it('places a fix at its first occurrence, in the first post that holds it', () => {
    const { posts, placed } = placeAdviserMarks(
      ['no slip here', 'teh cat and teh dog'],
      {
        fixes: [{ key: 'fix:0', found: 'teh' }],
      },
    );
    expect(placed.has('fix:0')).toBe(true);
    expect(posts[0].segments).toEqual([{ type: 'text', text: 'no slip here' }]);
    expect(posts[1].segments).toEqual([
      { type: 'fix', key: 'fix:0', text: 'teh' },
      { type: 'text', text: ' cat and teh dog' },
    ]);
  });

  it('nests a fix inside a span that contains it', () => {
    const { posts, placed } = placeAdviserMarks(
      ['you clearly havent read it. ok'],
      {
        spans: [{ key: 'check:0', excerpt: 'you clearly havent read it.' }],
        fixes: [{ key: 'fix:0', found: 'havent' }],
      },
    );
    expect([...placed]).toEqual(['check:0', 'fix:0']);
    expect(posts[0].segments).toEqual([
      {
        type: 'span',
        keys: ['check:0'],
        children: [
          { type: 'text', text: 'you clearly ' },
          { type: 'fix', key: 'fix:0', text: 'havent' },
          { type: 'text', text: ' read it.' },
        ],
      },
      { type: 'text', text: ' ok' },
    ]);
  });

  it('merges passages that overlap into one, carrying every key', () => {
    const { posts, placed } = placeAdviserMarks(
      ['AI sucks, anti people suck, the end'],
      {
        spans: [
          { key: 'a', excerpt: 'AI sucks' },
          { key: 'b', excerpt: 'anti people suck' },
          { key: 'c', excerpt: 'AI sucks, anti people suck' },
        ],
      },
    );
    expect([...placed].sort()).toEqual(['a', 'b', 'c']);
    expect(posts[0].segments).toEqual([
      {
        type: 'span',
        keys: ['a', 'c', 'b'],
        children: [{ type: 'text', text: 'AI sucks, anti people suck' }],
      },
      { type: 'text', text: ', the end' },
    ]);
  });

  it('keeps passages that only touch apart', () => {
    const { posts } = placeAdviserMarks(['one two'], {
      spans: [
        { key: 'a', excerpt: 'one' },
        { key: 'b', excerpt: ' two' },
      ],
    });
    expect(posts[0].segments.map((s) => s.keys)).toEqual([['a'], ['b']]);
  });

  it('leaves unplaced a fix that crosses a passage edge, or overlaps an earlier fix', () => {
    const { placed } = placeAdviserMarks(['alpha beta gamma delta'], {
      spans: [{ key: 'a', excerpt: 'beta gamma' }],
      fixes: [
        { key: 'f', found: 'alpha beta' },
        { key: 'g', found: 'delta' },
        { key: 'h', found: 'elt' },
      ],
    });
    expect(placed.has('a')).toBe(true);
    expect(placed.has('f')).toBe(false);
    expect(placed.has('g')).toBe(true);
    expect(placed.has('h')).toBe(false);
  });

  it('leaves unplaced an excerpt no post holds, such as one spanning two posts', () => {
    const { placed, posts } = placeAdviserMarks(
      ['end of one', 'start of two'],
      {
        spans: [{ key: 's', excerpt: 'one\n\nstart' }],
        fixes: [{ key: 'f', found: '' }],
      },
    );
    expect(placed.size).toBe(0);
    expect(posts[1].segments).toEqual([{ type: 'text', text: 'start of two' }]);
  });
});

const CONFLICT_READ = {
  sentiment: { label: 'negative', score: -0.6 },
  overallStatus: 'conflict',
  suggestion: 'Lead with the numbers.',
  checks: [
    {
      id: 'reduceNegativity',
      label: 'Reduce negativity',
      status: 'caution',
      note: 'Weary.',
      excerpt: 'Honestly exhausted.',
    },
    {
      id: 'lessConfrontational',
      label: 'Less confrontational',
      status: 'conflict',
      note: 'Aimed at people.',
      excerpt: 'has not read past the headline',
    },
    {
      id: 'limitTopic',
      label: 'Limit AI topic',
      status: 'ok',
      note: 'Fine.',
      excerpt: null,
    },
    {
      id: 'custom',
      label: 'Custom goals',
      status: 'caution',
      note: 'Hmm.',
      excerpt: 'not in the draft',
    },
  ],
  writing: {
    issues: [
      {
        type: 'typo',
        found: 'teh',
        replacement: 'the',
        note: 'Swapped letters.',
      },
      {
        type: 'clarity',
        found: 'The sample was small',
        replacement: null,
        note: 'Small compared to what?',
      },
    ],
  },
};
const CONFLICT_POSTS = [
  'Honestly exhausted. Anyone who disagrees has not read past the headline. The sample was small, teh end.',
];

describe('adviserSheetModel', () => {
  it('lists rubs before worth-a-look, then writing notes, numbering only what it could mark', () => {
    const model = adviserSheetModel(CONFLICT_READ, CONFLICT_POSTS);
    expect(model.notes.map((n) => [n.key, n.tone, n.number])).toEqual([
      ['check:1', 'conflict', 1],
      ['check:0', 'caution', 2],
      ['check:3', 'caution', null],
      ['note:1', 'note', 3],
    ]);
    expect(model.marks).toEqual({
      'check:1': { number: 1, tone: 'conflict' },
      'check:0': { number: 2, tone: 'caution' },
      'note:1': { number: 3, tone: 'note' },
    });
  });

  it("carries facts only: labels, statuses, tone, and a writing note's reason", () => {
    const model = adviserSheetModel(CONFLICT_READ, CONFLICT_POSTS);
    expect(model.verdict).toBe('conflict');
    expect(model.tone).toBe('negative');
    expect(model.met).toEqual(['Limit AI topic']);
    expect(model.notes[0]).toMatchObject({
      kind: 'goal',
      label: 'Less confrontational',
    });
    expect(model.notes[0]).not.toHaveProperty('detail');
    expect(model.notes[3]).toMatchObject({
      kind: 'writing',
      type: 'clarity',
      detail: 'Small compared to what?',
    });
    expect(JSON.stringify(model)).not.toContain('Lead with the numbers.');
    expect(JSON.stringify(model)).not.toContain('Aimed at people.');
  });

  it('offers fixes only for slips with a real correction', () => {
    const model = adviserSheetModel(CONFLICT_READ, CONFLICT_POSTS);
    expect(model.fixes.map((f) => f.key)).toEqual(['fix:0']);
    expect(model.writingNoteCount).toBe(1);
  });

  it('has no verdict for a read with no goal checks', () => {
    const model = adviserSheetModel(
      { checks: [], overallStatus: 'ok', writing: { issues: [] } },
      ['hi'],
    );
    expect(model.verdict).toBeNull();
    expect(model.notes).toEqual([]);
  });

  it('tolerates a missing result and missing posts', () => {
    const model = adviserSheetModel(null, undefined);
    expect(model.posts).toEqual([]);
    expect(model.writingRequested).toBe(false);
  });
});

describe('adviserVerdict', () => {
  it('trusts a known overall status and derives one otherwise', () => {
    expect(
      adviserVerdict({ overallStatus: 'caution', checks: [{ status: 'ok' }] }),
    ).toBe('caution');
    expect(
      adviserVerdict({
        overallStatus: 'odd',
        checks: [{ status: 'ok' }, { status: 'conflict' }],
      }),
    ).toBe('conflict');
    expect(adviserVerdict({ checks: [{ status: 'caution' }] })).toBe('caution');
    expect(adviserVerdict({ checks: [{ status: 'ok' }] })).toBe('ok');
  });
});

describe('adviserWritingTally', () => {
  const read = (issues) =>
    adviserSheetModel({ checks: [], writing: { issues } }, [
      'teh cat sat on teh mat and then their was more',
    ]);

  it('counts typos, slips and notes, less what has been fixed', () => {
    const typos = read([
      { type: 'typo', found: 'teh cat', replacement: 'the cat' },
      { type: 'typo', found: 'teh mat', replacement: 'the mat' },
    ]);
    expect(adviserWritingTally(typos)).toBe('2 typos');
    expect(adviserWritingTally(typos, new Set(['fix:0']))).toBe(
      '1 typo · 1 fixed',
    );
    expect(adviserWritingTally(typos, new Set(['fix:0', 'fix:1']))).toBe(
      '2 fixed',
    );

    const mixed = read([
      { type: 'typo', found: 'teh cat', replacement: 'the cat' },
      { type: 'grammar', found: 'their was', replacement: 'there was' },
      {
        type: 'clarity',
        found: 'and then',
        replacement: null,
        note: 'Then what?',
      },
    ]);
    expect(adviserWritingTally(mixed)).toBe('2 slips · 1 note');
  });

  it('says "no slips" for a clean proofread and nothing when none was asked for', () => {
    expect(adviserWritingTally(read([]))).toBe('no slips');
    expect(
      adviserWritingTally(adviserSheetModel({ checks: [] }, ['hi'])),
    ).toBeNull();
  });
});

describe('adviserDraftLabel', () => {
  it('names what was read and what it was read with', () => {
    expect(adviserDraftLabel('post')).toBe('your post');
    expect(adviserDraftLabel('thread')).toBe('your thread');
    expect(adviserDraftLabel('reply', true)).toBe(
      'your reply · read with its thread',
    );
    expect(adviserDraftLabel('reply', false)).toBe('your reply');
    expect(adviserDraftLabel('quote', true)).toBe(
      'your quote post · read with the quoted post',
    );
    expect(adviserDraftLabel('thread', true)).toBe('your thread');
    expect(adviserDraftLabel('unknown')).toBe('your post');
  });
});
