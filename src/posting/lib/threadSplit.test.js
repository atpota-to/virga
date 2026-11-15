/*
 * Splitting an over-long post into a thread: every post fits as the composer
 * counts it, nothing is lost, no link, mention, hashtag or cluster is cut,
 * the best breaks are taken, and splitting the joined result gives the same
 * posts.
 */

import { describe, expect, it } from 'vitest';
import {
  joinThread,
  readCounter,
  renumberThread,
  splitIntoThread,
  stripCounter,
  threadNumbering,
  THREAD_NUMBERING,
} from './threadSplit.js';
import {
  collapseInlineLinks,
  composerCountText,
  countComposerGraphemes,
  findInlineLinks,
} from './inlineLinks.js';
import { findUrlsAndMentions, isValidDomain } from './urlMatching.js';
import { findHashtags } from './hashtags.js';
import { countGraphemes } from './graphemes.js';
import { utf8Length } from './richText.js';
import { MAX_POST_BYTES } from './composerModel.js';

const squash = (text) => text.replace(/\s+/g, '');
const words = (text) => text.split(/\s+/).filter(Boolean);

/**
 * What a reader would be linked to, mentioned by or tagged with. As in the
 * composer, anything found inside an inline link belongs to the link.
 */
function marks(text) {
  const links = findInlineLinks(text);
  const free = (start, end) => !links.some((l) => start < l.end && l.start < end);
  const { urls, mentions } = findUrlsAndMentions(text);
  return {
    links: links.map((l) => `${l.label} -> ${l.uri}`),
    urls: urls
      .filter((u) => free(u.charStart, u.charEnd) && isValidDomain(u.matchText))
      .map((u) => u.matchText),
    mentions: mentions
      .filter((m) => free(m.start, m.end))
      .map((m) => `${m.email ? 'email' : '@'}${m.handle}`),
    tags: findHashtags(text)
      .filter((h) => free(h.start, h.end))
      .map((h) => h.tag),
  };
}

function marksOfAll(posts) {
  const all = { links: [], urls: [], mentions: [], tags: [] };
  for (const post of posts) {
    const own = marks(post);
    for (const key of Object.keys(all)) all[key].push(...own[key]);
  }
  return all;
}

/** Everything a split must hold to, whatever the text. */
function expectSound(text, posts, { limit = 300 } = {}) {
  // Nothing lost, nothing added, nothing reordered: only whitespace at the
  // cuts is gone.
  expect(squash(posts.join(' '))).toBe(squash(text));
  // No cluster cut in two.
  expect(posts.reduce((n, p) => n + countGraphemes(squash(p)), 0)).toBe(
    countGraphemes(squash(text)),
  );
  // No link, mention or hashtag cut, lost or invented.
  expect(marksOfAll(posts)).toEqual(marks(text));
  for (const post of posts) {
    expect(post).toBe(post.trim());
    expect(post).not.toBe('');
    // Only one thing may stay over: a link, alone, longer than a post.
    const oneLink = !/\s/.test(post) && marks(post).urls.length === 1;
    if (!oneLink) expect(countComposerGraphemes(post)).toBeLessThanOrEqual(limit);
    expect(utf8Length(composerCountText(post))).toBeLessThanOrEqual(
      MAX_POST_BYTES,
    );
  }
}

const sentence = 'The river ran high after the storm and the herons came back. ';

describe('splitIntoThread: what it leaves alone', () => {
  it('returns a post that fits as it is', () => {
    expect(splitIntoThread('short')).toEqual(['short']);
    expect(splitIntoThread('')).toEqual(['']);
    expect(splitIntoThread(null)).toEqual(['']);
    expect(splitIntoThread('  padded  ')).toEqual(['padded']);
    expect(splitIntoThread('a'.repeat(300))).toHaveLength(1);
  });

  it('never numbers a post it didn’t split', () => {
    expect(splitIntoThread('short', { numbering: 'counter' })).toEqual([
      'short',
    ]);
    expect(
      splitIntoThread('a'.repeat(298), { numbering: 'counter' }),
    ).toHaveLength(1);
  });

  it('counts links as they will be written, so a long address costs little', () => {
    const url = `https://example.org/${'a'.repeat(400)}`;
    const text = `${url} ${'w '.repeat(100).trim()}`;
    expect(countComposerGraphemes(text)).toBeLessThanOrEqual(300);
    expect(splitIntoThread(text)).toEqual([text]);
  });

  it('counts an inline link as its label', () => {
    const link = `[the report](https://example.org/${'r'.repeat(300)})`;
    const text = `${'word '.repeat(50)}${link}`;
    expect(splitIntoThread(text)).toEqual([text.trim()]);
  });
});

describe('splitIntoThread: where it cuts', () => {
  it('cuts at sentence ends, each post within the limit', () => {
    const text = sentence.repeat(12).trim();
    const posts = splitIntoThread(text);
    expect(posts.length).toBeGreaterThan(1);
    expectSound(text, posts);
    for (const post of posts) expect(post.endsWith('.')).toBe(true);
    expect(posts.join(' ')).toBe(text);
  });

  it('fills the earlier posts first', () => {
    const text = sentence.repeat(9).trim();
    const posts = splitIntoThread(text);
    expect(posts.map((p) => p.split('. ').length)).toEqual([4, 4, 1]);
  });

  it('prefers a paragraph break to a sentence end', () => {
    const a = sentence.repeat(3).trim();
    const b = sentence.repeat(4).trim();
    const posts = splitIntoThread(`${a}\n\n${b}`);
    expect(posts).toEqual([a, b]);
  });

  it('keeps paragraphs whole rather than saving a post', () => {
    const para = sentence.repeat(3).trim(); // 182
    const text = [para, para, para].join('\n\n');
    // Two posts would hold it, with the middle paragraph cut in half.
    expect(countComposerGraphemes(text)).toBeLessThan(600);
    expect(splitIntoThread(text)).toEqual([para, para, para]);
  });

  it('packs short paragraphs together', () => {
    const para = sentence.repeat(2).trim(); // 121
    const text = [para, para, para, para].join('\n\n');
    expect(splitIntoThread(text)).toEqual([
      `${para}\n\n${para}`,
      `${para}\n\n${para}`,
    ]);
  });

  it('prefers a line break to a sentence end', () => {
    const list = Array.from(
      { length: 9 },
      (_, i) => `- item ${i + 1}: something to do. And why it matters`,
    );
    const posts = splitIntoThread(list.join('\n'));
    expectSound(list.join('\n'), posts);
    for (const post of posts) expect(post.startsWith('- item')).toBe(true);
  });

  it('cuts mid-sentence only when a sentence is longer than a post', () => {
    const long = 'word '.repeat(90).trim(); // one sentence, 449
    const posts = splitIntoThread(`${long}.`);
    expectSound(`${long}.`, posts);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toBe('word '.repeat(60).trim());
    // Sentences of 160 go one to a post, though two posts in three would
    // hold them cut anywhere.
    const s160 = `Then ${'word '.repeat(30)}here.`;
    const text = Array(6).fill(s160).join(' ');
    expect(splitIntoThread(text)).toEqual(Array(6).fill(s160));
    // And an opening line isn't left alone when no sentence end follows it.
    const open = `Hi all. ${'word '.repeat(100).trim()}`;
    expect(splitIntoThread(open)).toHaveLength(2);
    expect(splitIntoThread(open)[0].startsWith('Hi all. word')).toBe(true);
  });

  it('doesn’t take an abbreviation, an initial or a list number for a sentence end', () => {
    const lead = 'x'.repeat(250);
    for (const [tail, expected] of [
      ['Meet Dr. Okafor at the lab tomorrow to go over all of it again please', 'Meet Dr.'],
      ['Written by J. Okafor at the lab tomorrow to go over all of it again', 'by J.'],
      ['Three things: 1. Okafor at the lab tomorrow to go over all of it now', '1.'],
      ['It works, e.g. at the lab tomorrow we go over all of it again and again', 'e.g.'],
    ]) {
      const posts = splitIntoThread(`${lead} ${tail}`);
      expect(posts[0].endsWith(expected)).toBe(false);
    }
  });

  it('cuts a run with no spaces between clusters, where it must', () => {
    const posts = splitIntoThread('z'.repeat(650));
    expect(posts.map((p) => p.length)).toEqual([300, 300, 50]);
  });

  it('cuts text written without spaces after its sentence ends', () => {
    const text = 'これは日本語の文章です。'.repeat(40); // 480, no spaces
    const posts = splitIntoThread(text);
    expectSound(text, posts);
    expect(posts).toHaveLength(2);
    for (const post of posts) expect(post.endsWith('。')).toBe(true);
  });

  it('never cuts a grapheme cluster', () => {
    const family = '👨‍👩‍👧‍👦';
    const flag = '🇯🇵';
    const text = (family + flag + 'é').repeat(120); // 360 clusters, no spaces
    const posts = splitIntoThread(text, { limit: 100 });
    expectSound(text, posts, { limit: 100 });
    for (const post of posts) {
      expect(countGraphemes(post)).toBeLessThanOrEqual(100);
      // Whole families, whole flags, accents with their letters.
      expect(post.replaceAll(family, '').replaceAll(flag, '').replaceAll('é', '')).toBe('');
    }
  });

  it('keeps inside the byte cap as well as the count', () => {
    const family = '👨‍👩‍👧‍👦'; // one cluster, 25 bytes
    const text = family.repeat(290);
    expect(countComposerGraphemes(text)).toBeLessThanOrEqual(300);
    const posts = splitIntoThread(text);
    expect(posts.length).toBeGreaterThan(1);
    expectSound(text, posts);
  });
});

describe('splitIntoThread: what it never cuts', () => {
  const filler = (n) => 'word '.repeat(n);

  it('a URL', () => {
    for (const url of [
      'https://example.org/a/long/path?with=a&query=string#and-a-fragment',
      'example.org/a/bare/domain/with/a/path',
      'https://en.wikipedia.org/wiki/Bee_(disambiguation)',
    ]) {
      for (let n = 50; n <= 60; n++) {
        const text = `${filler(n)}${url} ${filler(20)}`.trim();
        const posts = splitIntoThread(text);
        expectSound(text, posts);
        expect(posts.filter((p) => p.includes(url))).toHaveLength(1);
      }
    }
  });

  it('a mention or an email address', () => {
    for (const mention of ['@alice.example.com', 'reader@example.org']) {
      for (let n = 54; n <= 60; n++) {
        const text = `${filler(n)}${mention} ${filler(20)}`.trim();
        const posts = splitIntoThread(text);
        expectSound(text, posts);
        expect(posts.filter((p) => words(p).includes(mention))).toHaveLength(1);
      }
    }
  });

  it('a hashtag', () => {
    for (let n = 54; n <= 60; n++) {
      const text = `${filler(n)}#ThingsThatAreLongToSay ${filler(20)}`.trim();
      const posts = splitIntoThread(text);
      expectSound(text, posts);
    }
  });

  it('an inline link, even at a space in its label', () => {
    const link = '[a label of several words](https://example.org/a/b/c)';
    for (let n = 50; n <= 60; n++) {
      const text = `${filler(n)}${link} ${filler(20)}`.trim();
      const posts = splitIntoThread(text);
      expectSound(text, posts);
      expect(posts.filter((p) => p.includes(link))).toHaveLength(1);
    }
  });

  it('an inline link that will post as typed', () => {
    const link = '[bsky.app is here](https://elsewhere.example/x)';
    const text = `${filler(56)}${link} ${filler(20)}`.trim();
    const posts = splitIntoThread(text);
    expect(posts.filter((p) => p.includes(link))).toHaveLength(1);
  });

  it('any of them inside a run with no spaces', () => {
    const run = 'あ'.repeat(280);
    for (const mark of [
      'https://example.org/path/to/a/thing',
      '[ラベル](https://example.org/x)',
    ]) {
      const text = `${run}${mark}${run}`;
      const posts = splitIntoThread(text);
      expectSound(text, posts);
      expect(posts.filter((p) => p.includes(mark))).toHaveLength(1);
    }
  });

  it('text that runs on from an inline link, which is still cut', () => {
    const link = '[a few words](https://example.org/somewhere/else)';
    const text = `${link}${'q'.repeat(400)}`;
    const posts = splitIntoThread(text);
    expectSound(text, posts);
    expect(posts).toHaveLength(2);
    expect(posts[0].startsWith(link)).toBe(true);
  });

  it('and never makes a hashtag, a mention or a link by cutting', () => {
    // A cut before the # or the @ would start a post with a tag or a mention.
    const tag = `${'あ'.repeat(299)}#日本${'い'.repeat(100)}`;
    expect(marks(tag).tags).toEqual([]);
    expectSound(tag, splitIntoThread(tag));
    const at = `${'あ'.repeat(299)}@alice.example.com${'い'.repeat(100)}`;
    expectSound(at, splitIntoThread(at));
    // A cut after "example.com" would end a post with a bare domain.
    const domain = `${'あ'.repeat(289)}example.comあ${'い'.repeat(100)}`;
    expect(marks(domain).urls).toEqual([]);
    expectSound(domain, splitIntoThread(domain));
    // An address straight after a quotation mark isn't linked (or shortened)
    // until something parts the two.
    const quoted = `${'あ'.repeat(299)}"https://example.org/a/path/long/enough/to/shorten"`;
    const posts = splitIntoThread(quoted);
    expectSound(quoted, posts);
    expect(posts.some((p) => p.startsWith('https://'))).toBe(false);
  });

  it('leaves what can’t be cut and can’t fit whole, in a post of its own', () => {
    const label = 'word '.repeat(70).trim(); // 349 in one label
    const link = `[${label}](https://example.org/x)`;
    const text = `Before it. ${link} After it.`;
    const posts = splitIntoThread(text);
    expect(posts).toEqual(['Before it.', link, 'After it.']);
    expect(countComposerGraphemes(posts[1])).toBeGreaterThan(300);
  });
});

describe('splitIntoThread: numbering', () => {
  const text = sentence.repeat(14).trim();

  it('is off unless asked for', () => {
    expect(THREAD_NUMBERING).toEqual(['off', 'counter']);
    for (const post of splitIntoThread(text)) expect(readCounter(post)).toBe(null);
    for (const post of splitIntoThread(text, { numbering: 'off' }))
      expect(readCounter(post)).toBe(null);
  });

  it('ends every post with its place and the total, on a line of its own', () => {
    const posts = splitIntoThread(text, { numbering: 'counter' });
    expect(posts.length).toBeGreaterThan(2);
    posts.forEach((post, i) => {
      expect(post.endsWith(`.\n\n${i + 1}/${posts.length}`)).toBe(true);
      expect(countComposerGraphemes(post)).toBeLessThanOrEqual(300);
    });
    expect(posts.map(stripCounter).join(' ')).toBe(text);
  });

  it('leaves room for the counter', () => {
    // 294 fits a post, but not a post with "\n\n1/2" after it.
    const a = 'a'.repeat(294);
    const posts = splitIntoThread(`${a} ${a}`, { numbering: 'counter' });
    for (const post of posts)
      expect(countComposerGraphemes(post)).toBeLessThanOrEqual(300);
    expect(posts.length).toBeGreaterThan(2);
    // The room is the same for nine posts as for ten, so adding one later
    // and renumbering never pushes a post over.
    const nine = splitIntoThread('b'.repeat(293 * 9), { numbering: 'counter' });
    expect(nine).toHaveLength(9);
    expect(nine.map((p) => stripCounter(p).length)).toEqual(Array(9).fill(293));
  });

  it('counts the whole thread when the post is one of several', () => {
    const posts = splitIntoThread(text, {
      numbering: 'counter',
      before: 2,
      after: 1,
    });
    const n = posts.length;
    expect(posts.map((p) => readCounter(p).number)).toEqual(
      posts.map((_, i) => i + 3),
    );
    for (const post of posts) expect(readCounter(post).total).toBe(n + 3);
  });

  it('takes nothing off the text, even a last line that looks like a counter', () => {
    const posts = splitIntoThread(`${text}\n\n11/14`, { numbering: 'counter' });
    expect(stripCounter(posts.at(-1)).endsWith('came back.\n\n11/14')).toBe(true);
  });

  it('widens the counter past 99 posts, and still fits', () => {
    const posts = splitIntoThread('c'.repeat(293 * 101), {
      numbering: 'counter',
    });
    expect(posts.length).toBeGreaterThan(101);
    expect(posts.at(-1).endsWith(`\n\n${posts.length}/${posts.length}`)).toBe(true);
    for (const post of posts)
      expect(countComposerGraphemes(post)).toBeLessThanOrEqual(300);
  });
});

describe('splitIntoThread: with no room for every post', () => {
  const text = sentence.repeat(12).trim();

  it('keeps what doesn’t fit in the last post instead of dropping it', () => {
    const all = splitIntoThread(text);
    expect(all.length).toBeGreaterThan(2);
    const two = splitIntoThread(text, { maxPosts: 2 });
    expect(two).toHaveLength(2);
    expect(two[0]).toBe(all[0]);
    expect(countComposerGraphemes(two[1])).toBeGreaterThan(300);
    expect(words(two.join(' '))).toEqual(words(text));
  });

  it('splits nothing off when there is no room at all', () => {
    expect(splitIntoThread(text, { maxPosts: 1 })).toEqual([text]);
    expect(splitIntoThread(text, { maxPosts: 0 })).toEqual([text]);
  });

  it('numbers the posts it did make', () => {
    const two = splitIntoThread(text, { maxPosts: 2, numbering: 'counter' });
    expect(two.map((p) => readCounter(p)?.number)).toEqual([1, 2]);
    expect(two.map((p) => readCounter(p)?.total)).toEqual([2, 2]);
  });
});

describe('counters', () => {
  it('are read only from a line of their own at the end', () => {
    expect(readCounter('Words.\n\n2/5')).toEqual({ number: 2, total: 5, body: 'Words.' });
    expect(readCounter('Words.\n2/5  ')).toEqual({ number: 2, total: 5, body: 'Words.' });
    expect(readCounter('12/25')).toEqual({ number: 12, total: 25, body: '' });
    expect(readCounter('I’d give it 4/5')).toBe(null);
    expect(readCounter('2/5\n\nWords.')).toBe(null);
    expect(readCounter('Words.\n\n2 of 5')).toBe(null);
    expect(readCounter('')).toBe(null);
    expect(readCounter(null)).toBe(null);
  });

  it('come off cleanly', () => {
    expect(stripCounter('Words.\n\n2/5')).toBe('Words.');
    expect(stripCounter('Words, rated 4/5')).toBe('Words, rated 4/5');
    expect(joinThread(['One.\n\n1/2', 'Two.\n\n2/2'], { numbering: 'counter' })).toBe('One.\n\nTwo.');
    // Without numbering a last line of digits is the writer's.
    expect(joinThread(['One.\n\n1/2', 'Two.'])).toBe('One.\n\n1/2\n\nTwo.');
    expect(joinThread(['One.', '', 'Two.'])).toBe('One.\n\nTwo.');
    expect(joinThread(null)).toBe('');
  });

  it('threadNumbering says whether a thread is numbered, and still right', () => {
    expect(threadNumbering(['One.', 'Two.'])).toBe('none');
    expect(threadNumbering(['One.\n\n1/2', 'Two.\n\n2/2'])).toBe('current');
    // One post taken out of three.
    expect(threadNumbering(['One.\n\n1/3', 'Three.\n\n3/3'])).toBe('stale');
    // One added by hand.
    expect(threadNumbering(['One.\n\n1/2', 'Two.\n\n2/2', 'New.'])).toBe('stale');
    // Moved.
    expect(threadNumbering(['Two.\n\n2/2', 'One.\n\n1/2'])).toBe('stale');
    // A single line that looks like a counter isn't a numbered thread.
    expect(threadNumbering(['Scores so far:\n3/5', 'More.'])).toBe('none');
    expect(threadNumbering(['Only.\n\n1/3'])).toBe('none');
    expect(threadNumbering(null)).toBe('none');
  });

  it('renumberThread changes the counters and nothing else', () => {
    expect(renumberThread(['One.\n\n1/3', 'New, by hand.', 'Three.\n\n3/3'])).toEqual([
      'One.\n\n1/3',
      'New, by hand.\n\n2/3',
      'Three.\n\n3/3',
    ]);
    expect(renumberThread(['B.\n\n2/2', 'A.\n\n1/2'])).toEqual(['B.\n\n1/2', 'A.\n\n2/2']);
    // A post with no words (a picture on its own) is just its number.
    expect(renumberThread(['One.\n\n1/2', ''])).toEqual(['One.\n\n1/2', '2/2']);
    // A thread of one needs no number.
    expect(renumberThread(['Only.\n\n1/3'])).toEqual(['Only.']);
    expect(threadNumbering(renumberThread(['a\n\n4/9', 'b', 'c\n\n1/9']))).toBe('current');
  });
});

/* ---- every text, not just these ---------------------------------------- */

// A small seeded generator (mulberry32), so a failure can be run again.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAIN = ['the', 'river', 'ran', 'high', 'after', 'a', 'storm', 'and', 'herons', 'came', 'back', 'to', 'it', 'café', 'naïve', 'Zoë', 'über'];
const SPECIAL = [
  'https://example.org/a/long/path/that/keeps/going?x=1&y=2',
  'https://en.wikipedia.org/wiki/Bee_(disambiguation)',
  'example.com',
  'bsky.app/profile/someone.example',
  '@alice.example.com',
  '@lab.example.org',
  'reader@example.org',
  '#weather',
  '#日本',
  '[a few words](https://example.org/somewhere/else)',
  '[one](example.org)',
  '👨‍👩‍👧‍👦',
  '🇯🇵',
  '"quoted"',
  '(aside)',
  'v1.2.3',
  '3/5',
  'これは文です。次の文です。',
  '"https://example.org/quoted/path/long/enough/to/shorten"',
  'x@https://a.example/long/path/here/and/more',
  'end.Next',
  'abc.de§§§',
];
const ENDS = ['.', '.', '.', '!', '?', '…', ','];
const GAPS = [' ', ' ', ' ', ' ', ' ', '\n', '\n\n', '  '];

function randomText(next, length, { run = 0 } = {}) {
  let out = '';
  while (out.length < length) {
    const special = next() < 0.12;
    const list = special ? SPECIAL : PLAIN;
    out += list[Math.floor(next() * list.length)];
    if (next() < 0.18) out += ENDS[Math.floor(next() * ENDS.length)];
    // With runs, words sometimes run into each other too.
    if (!run || next() < 0.9) out += GAPS[Math.floor(next() * GAPS.length)];
    // Now and then, a run longer than a post with nothing to cut at.
    if (run && next() < 0.01) out += `${'q'.repeat(run + Math.floor(next() * run))} `;
  }
  return out.trim();
}

describe('splitIntoThread: any text', () => {
  it('fits, loses nothing, cuts nothing it shouldn’t, and is stable', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const next = rng(seed);
      // The shorter limit also gets runs too long for a post.
      const limit = seed % 2 ? 300 : 120;
      const text = randomText(next, 200 + Math.floor(next() * 3000), { run: limit === 120 ? 130 : 0 });
      const posts = splitIntoThread(text, { limit });
      expectSound(text, posts, { limit });
      expect(splitIntoThread(joinThread(posts), { limit }), `seed ${seed}`).toEqual(posts);
      // Splitting again is the same split.
      expect(splitIntoThread(text, { limit })).toEqual(posts);
    }
  });

  it('is sound and stable with numbering too', () => {
    const numbering = 'counter';
    for (let seed = 500; seed <= 560; seed++) {
      const next = rng(seed);
      const text = randomText(next, 400 + Math.floor(next() * 3000));
      const posts = splitIntoThread(text, { numbering });
      if (posts.length === 1) continue;
      expect(threadNumbering(posts)).toBe('current');
      expectSound(text, posts.map(stripCounter));
      for (const post of posts)
        expect(countComposerGraphemes(post)).toBeLessThanOrEqual(300);
      expect(splitIntoThread(joinThread(posts, { numbering }), { numbering }), `seed ${seed}`).toEqual(posts);
    }
  });

  it('adds a post’s count up from its words exactly as the composer counts it', () => {
    // A post is one post at its own count and more than one at one less. If
    // the sum drifted from the composer's count, one of these would be wrong.
    for (let seed = 900; seed <= 940; seed++) {
      const next = rng(seed);
      const text = randomText(next, 2000);
      for (const post of splitIntoThread(text, { limit: 200 })) {
        const count = countComposerGraphemes(post);
        expect(splitIntoThread(post, { limit: count })).toEqual([post]);
        if (words(post).length > 1 && !collapseInlineLinks(post).links.length)
          expect(splitIntoThread(post, { limit: count - 1 }).length).toBeGreaterThan(1);
      }
    }
  });
});
