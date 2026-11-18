// The grammar the moderator reads DMs with. Ported from bluesky-mod's
// command.test.js for the verbs Virga has; the cases that matter most are the
// ones where a message names nobody, or two people, and nothing is acted on.

import { describe, expect, it } from 'vitest';
import { HELP, KINDS, authorOf, extractTargets, facetLinks, facetMentions, isWrite, looksLikeTarget, parseActor, parseCommand, parsePostScan, shortCode } from './command.js';

describe('parseActor', () => {
  it('takes a handle, with or without the @', () => {
    expect(parseActor('@stranger.test')).toBe('stranger.test');
    expect(parseActor('alice.example.com')).toBe('alice.example.com');
    expect(parseActor('A.BSKY.SOCIAL')).toBe('a.bsky.social');
  });

  it('takes a DID, and a DID after an @ as the moderator prints one with no handle', () => {
    expect(parseActor('did:plc:abc123')).toBe('did:plc:abc123');
    expect(parseActor('@did:plc:abc123')).toBe('did:plc:abc123');
    expect(parseCommand('block @did:plc:abc123').actor).toBe('did:plc:abc123');
    expect(parseCommand('approve 1c2d3e4f @did:plc:abc123')).toMatchObject({ actors: ['did:plc:abc123'], refusal: null, needsTarget: false });
  });

  it('takes a profile link from any client', () => {
    expect(parseActor('https://bsky.app/profile/alice.example.com')).toBe('alice.example.com');
    expect(parseActor('https://deer.social/profile/did:plc:xyz/post/3a')).toBe('did:plc:xyz');
    expect(parseActor('https://bsky.app/profile/@alice.example.com')).toBe('alice.example.com');
  });

  it('refuses a bare word, which is how "them" gets rejected', () => {
    expect(parseActor('them')).toBe(null);
    expect(parseActor('that guy')).toBe(null);
    expect(parseActor('')).toBe(null);
    expect(parseActor(null)).toBe(null);
  });

  it('returns null for a profile link with broken percent-encoding, never throwing', () => {
    expect(parseActor('https://example.com/profile/50%off')).toBe(null);
  });
});

describe('parseCommand', () => {
  it('recognises the verbs', () => {
    expect(parseCommand('block @a.bsky.social')).toMatchObject({ action: 'list_add', actor: 'a.bsky.social' });
    expect(parseCommand('unblock @a.bsky.social')).toMatchObject({ action: 'list_remove', actor: 'a.bsky.social' });
    expect(parseCommand('list add @a.bsky.social')).toMatchObject({ action: 'list_add' });
    expect(parseCommand('list remove @a.bsky.social')).toMatchObject({ action: 'list_remove' });
    expect(parseCommand('lists')).toMatchObject({ action: 'lists', needsTarget: false });
    expect(parseCommand('status')).toMatchObject({ action: 'status', needsTarget: false });
  });

  it('is not a command when it is a question', () => {
    expect(parseCommand('should I block @a.bsky.social?')).toBe(null);
    expect(parseCommand('what has @a.bsky.social been posting about')).toBe(null);
    expect(parseCommand('why is that one connected')).toBe(null);
    expect(parseCommand('')).toBe(null);
    expect(parseCommand(undefined)).toBe(null);
  });

  it('refuses to guess who "them" is', () => {
    // The whole design: "block them" after reading a stranger's posts is how a
    // post would get to choose the target.
    expect(parseCommand('block them')).toMatchObject({ action: 'list_add', actor: null, needsTarget: true });
  });

  it('refuses a command naming two accounts', () => {
    expect(parseCommand('block @a.bsky.social @b.bsky.social')).toMatchObject({ actor: null, needsTarget: true });
  });

  it('refuses a verb with trailing prose it cannot resolve', () => {
    expect(parseCommand('block the account I mentioned earlier').needsTarget).toBe(true);
  });

  it('keeps the literal text, for the record', () => {
    expect(parseCommand('block @a.bsky.social').raw).toBe('block @a.bsky.social');
  });

  it('reads past the punctuation a sentence leaves on a handle', () => {
    expect(parseCommand('block @a.bsky.social.')).toMatchObject({ actor: 'a.bsky.social', needsTarget: false });
    expect(parseCommand('history @a.bsky.social?').actor).toBe('a.bsky.social');
  });
});

describe('scans and plans', () => {
  const POST = 'https://bsky.app/profile/a.bsky.social/post/3abc';
  const EMBED = 'at://did:plc:abc/app.bsky.feed.post/3abc';

  it('recognises each engagement kind', () => {
    for (const kind of Object.keys(KINDS)) {
      expect(parseCommand(`add ${kind} ${POST}`)).toMatchObject({ action: 'plan', kind, target: POST, needsTarget: false });
    }
  });

  it('reads "scan" as a plan of everyone', () => {
    expect(parseCommand(`scan ${POST}`)).toMatchObject({ action: 'plan', kind: 'everyone', target: POST });
    expect(parseCommand('scan this', { embedUri: EMBED })).toMatchObject({ action: 'plan', target: EMBED });
  });

  it('accepts "list add likers" and "add the likers", and is not adding an account called "likers"', () => {
    expect(parseCommand(`list add likers ${POST}`).action).toBe('plan');
    expect(parseCommand(`add the likers ${POST}`).kind).toBe('likers');
    expect(parseCommand('list add @a.bsky.social').action).toBe('list_add');
  });

  it('takes the post from a shared embed when the text has no link, and asks rather than guessing', () => {
    expect(parseCommand('add likers', { embedUri: EMBED })).toMatchObject({ target: EMBED, needsTarget: false });
    expect(parseCommand('add likers').needsTarget).toBe(true);
  });

  it('never takes a list, a starter pack or a feed for a post', () => {
    for (const uri of ['at://did:plc:abc/app.bsky.graph.list/3abc', 'at://did:plc:abc/app.bsky.feed.generator/hot']) {
      expect(parseCommand(`add likers ${uri}`).needsTarget, uri).toBe(true);
      expect(parseCommand('add likers', { embedUri: uri }).needsTarget, uri).toBe(true);
    }
  });

  it('lets a question through', () => {
    expect(parseCommand('should I add the likers of this post?')).toBe(null);
    expect(parseCommand('who approved that')).toBe(null);
  });
});

describe('approvals', () => {
  it('parses bands in any case or separator', () => {
    const out = parseCommand('approve 3f9a2c1b unknown, notable');
    expect(out).toMatchObject({ action: 'approve', code: '3f9a2c1b', refusal: null, needsTarget: false });
    expect(out.bands).toEqual(['UNKNOWN', 'NOTABLE']);
  });

  it('strips PROTECTED, whatever is typed', () => {
    expect(parseCommand('approve 3f9a2c1b UNKNOWN,PROTECTED').bands).toEqual(['UNKNOWN']);
  });

  it('needs a plan code, in any case, past punctuation', () => {
    expect(parseCommand('approve').needsTarget).toBe(true);
    expect(parseCommand('approve UNKNOWN').code).toBe(null);
    expect(parseCommand('approve 3F9A2C1B UNKNOWN.')).toMatchObject({ code: '3f9a2c1b', bands: ['UNKNOWN'] });
    expect(parseCommand('cancel 3f9a2c1b!')).toMatchObject({ action: 'cancel', code: '3f9a2c1b' });
    expect(parseCommand('review 3f9a2c1b')).toMatchObject({ action: 'review', code: '3f9a2c1b' });
  });

  it('parses an approval naming accounts', () => {
    const out = parseCommand('approve 3f9a2c1b @a.bsky.social @b.bsky.social');
    expect(out.actors).toEqual(['a.bsky.social', 'b.bsky.social']);
    expect(out.bands).toEqual([]);
    expect(out.needsTarget).toBe(false);
  });

  it('carries engagement kinds, but not "everyone", which filters nothing', () => {
    expect(parseCommand('approve 3f9a2c1b UNKNOWN repliers')).toMatchObject({ bands: ['UNKNOWN'], kinds: ['repliers'], refusal: null });
    expect(parseCommand('approve 3f9a2c1b UNKNOWN everyone').kinds).toEqual([]);
  });

  describe('reads one way or not at all', () => {
    // A word with no place may be an exception; dropping it would add the
    // opposite of what was asked.
    const refused = (text) => {
      const out = parseCommand(text);
      expect(out.action, text).toBe('approve');
      expect(out.needsTarget, text).toBe(true);
      expect(out.refusal, text).toMatch(/I haven’t added anyone/);
      return out;
    };

    it('refuses a word it cannot place', () => {
      expect(refused('approve 1c2d3e4f UNKNOWN except @friend.bsky.social').refusal).toContain('“except”');
      refused('approve 1c2d3e4f UNKNOWN, but not @friend.bsky.social');
      refused('approve 1c2d3e4f everyone,ALL');
    });

    it('refuses named accounts mixed with a group', () => {
      refused('approve 3f9a2c1b UNKNOWN @a.bsky.social');
      refused('approve 3f9a2c1b likers @a.bsky.social');
    });

    it('refuses a group narrowed only to PROTECTED rather than widening it', () => {
      // With PROTECTED dropped, "approve x PROTECTED likers" would be every liker.
      for (const text of ['approve abcd1234 PROTECTED', 'approve abcd1234 PROTECTED likers']) {
        refused(text);
      }
    });

    it('refuses a shortened link it cannot read', () => {
      refused('approve 1c2d3e4f bsky.app/profile/jo.e...');
    });

    it('asks which, when it names nothing', () => {
      expect(parseCommand('approve 1c2d3e4f')).toMatchObject({ needsTarget: true, refusal: expect.stringMatching(/^Which of them/) });
    });
  });
});

describe('truncated links', () => {
  const link = (uri) => ({ index: { byteStart: 0, byteEnd: 24 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] });
  const mention = (did) => ({ index: { byteStart: 0, byteEnd: 10 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] });

  it('pulls the full URL and the mentioned DID out of the facets', () => {
    expect(facetLinks({ facets: [link('https://bsky.app/profile/stranger.test')] })).toEqual(['https://bsky.app/profile/stranger.test']);
    expect(facetMentions({ facets: [mention('did:plc:abc')] })).toEqual(['did:plc:abc']);
    expect(facetLinks({ facets: [{ features: [{ $type: 'other' }] }] })).toEqual([]);
    expect(facetMentions({})).toEqual([]);
  });

  it('resolves an account the truncated text could not', () => {
    expect(parseCommand('block bsky.app/profile/stra...', { links: ['https://bsky.app/profile/stranger.test'] })).toMatchObject({ actor: 'stranger.test', needsTarget: false });
    expect(parseCommand('block @stranger...', { mentions: ['did:plc:strangertestaccount23457'] }).actor).toBe('did:plc:strangertestaccount23457');
  });

  it('refuses when the facets name two accounts, and prefers what was typed', () => {
    expect(parseCommand('block them', { mentions: ['did:plc:aaa', 'did:plc:bbb'] })).toMatchObject({ actor: null, needsTarget: true });
    expect(parseCommand('block @typed.example', { mentions: ['did:plc:somethingelse'] }).actor).toBe('typed.example');
  });

  it('does not read what is left of a shortened link as a handle', () => {
    const links = ['https://bsky.app/profile/jo.example.com/post/3lxyz'];
    for (const shown of ['bsky.app/profile/jo.e...', 'bsky.app/profile/jo.e…']) {
      expect(parseCommand(`block ${shown}`, { links }).actor).toBe('jo.example.com');
      expect(parseCommand(`history ${shown}`, { links }).actor).toBe('jo.example.com');
      expect(parseCommand(`keep ${shown}`, { links }).actor).toBe('jo.example.com');
    }
    expect(parseCommand('block https://bsky.app/profile/jo.example.com').actor).toBe('jo.example.com');
    expect(parseCommand('block @jo.example.com...').actor).toBe('jo.example.com');
  });

  it('finds a post link in a facet for a plan', () => {
    const post = 'https://bsky.app/profile/a.bsky.social/post/3abc';
    expect(parseCommand('add likers bsky.app/profile/a.bsk...', { links: [post] }).target).toBe(post);
  });
});

describe('parsePostScan', () => {
  const POST = 'https://bsky.app/profile/a.bsky.social/post/3abc';
  const AT = 'at://did:plc:abc/app.bsky.feed.post/3abc';

  it('treats a bare post as a scan', () => {
    expect(parsePostScan(POST)).toBe(POST);
    expect(parsePostScan('this post', { embedUri: AT })).toBe(AT);
    expect(parsePostScan('', { embedUri: AT })).toBe(AT);
    expect(parsePostScan('bsky.app/profile/a.bsk...', { links: [POST] })).toBe(POST);
  });

  it('is not a scan when the message carries words of its own', () => {
    expect(parsePostScan(`what is the sentiment of the replies to ${POST}`)).toBe(null);
    expect(parsePostScan(`should I act on ${POST}`)).toBe(null);
    expect(parsePostScan('hello')).toBe(null);
    expect(parsePostScan('')).toBe(null);
  });

  it('is not a scan of a list, a starter pack or a feed', () => {
    for (const uri of ['at://did:plc:abc/app.bsky.graph.list/3abc', 'at://did:plc:abc/app.bsky.graph.starterpack/3abc', 'at://did:plc:abc/app.bsky.feed.generator/hot']) {
      expect(parsePostScan(uri), uri).toBe(null);
      expect(parsePostScan('', { embedUri: uri }), uri).toBe(null);
      expect(parsePostScan(`${uri} ${POST}`), uri).toBe(POST);
    }
  });
});

describe('undo and history', () => {
  it('parses undo by code, and a bare undo as the last', () => {
    expect(parseCommand('undo 3f9a2c1b')).toMatchObject({ action: 'undo', code: '3f9a2c1b', last: false, needsTarget: false });
    expect(parseCommand('undo 3F9A2C1B').code).toBe('3f9a2c1b');
    for (const text of ['undo', 'undo last', 'undo it', 'undo that', 'undo those', 'undo that.']) {
      expect(parseCommand(text), text).toMatchObject({ action: 'undo', last: true, needsTarget: false });
    }
  });

  it('will not default a mistyped code to the last', () => {
    expect(parseCommand('undo 3f9az')).toMatchObject({ needsTarget: true, last: false, code: null });
  });

  it('parses history with and without an account', () => {
    expect(parseCommand('history')).toMatchObject({ action: 'history', actor: null, needsTarget: false });
    expect(parseCommand('history?')).toMatchObject({ actor: null, needsTarget: false });
    expect(parseCommand('history @a.bsky.social').actor).toBe('a.bsky.social');
    expect(parseCommand('history @did:plc:abc123').actor).toBe('did:plc:abc123');
  });

  it('asks back a name it cannot read rather than showing everything', () => {
    for (const text of ['history alice', 'history of @a.bsky.social']) {
      const out = parseCommand(text);
      expect(out, text).toMatchObject({ actor: null, needsTarget: true });
      expect(out.refusal).toMatch(/^I couldn’t read “/);
    }
    expect(parseCommand('history of @a.bsky.social', { mentions: ['did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'] })).toMatchObject({ actor: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', needsTarget: false });
  });

  it('does not swallow prose that mentions undoing', () => {
    expect(parseCommand('can I undo that?')).toBe(null);
    expect(parseCommand('what is the history here')).toBe(null);
  });
});

describe('an attached post names its author', () => {
  const embedUri = 'at://did:plc:author/app.bsky.feed.post/3xyz';

  it('acts on the author when the message says nothing else', () => {
    for (const text of ['block', 'block this', 'block them', 'list add', 'block em', 'block this guy', 'block them please']) {
      expect(parseCommand(text, { embedUri }), text).toMatchObject({ actor: 'did:plc:author', fromPost: true, confirm: false, needsTarget: false });
    }
  });

  it('asks rather than acting when the words might mean someone else', () => {
    for (const text of ['block whoever is in the replies', 'block the person they are quoting']) {
      expect(parseCommand(text, { embedUri }), text).toMatchObject({ needsTarget: false, confirm: true });
    }
  });

  it('prefers a typed handle, and ignores what is not a record', () => {
    expect(parseCommand('block @someone.bsky.social', { embedUri })).toMatchObject({ actor: 'someone.bsky.social', fromPost: false });
    expect(parseCommand('block', { embedUri: 'https://example.com' }).needsTarget).toBe(true);
    expect(parseCommand('block').needsTarget).toBe(true);
  });
});

describe("Virga's verbs", () => {
  it('links with the code Settings shows, dash or not, in any case', () => {
    expect(parseCommand('link ABCD-EFGH')).toMatchObject({ action: 'link', code: 'ABCDEFGH', needsTarget: false });
    expect(parseCommand('link abcdefgh.')).toMatchObject({ code: 'ABCDEFGH' });
    // 0, 1, I and O are never in a code: they read as each other.
    expect(parseCommand('link ABCD-EFG0')).toMatchObject({ code: null, needsTarget: true });
    expect(parseCommand('link')).toMatchObject({ code: null, needsTarget: true });
  });

  it('keeps someone by hand, with the owner’s words for why', () => {
    expect(parseCommand('keep @friend.example.com')).toMatchObject({ action: 'keep', actor: 'friend.example.com', reason: null, needsTarget: false });
    expect(parseCommand('keep @friend.example.com because she’s my sister')).toMatchObject({ actor: 'friend.example.com', reason: 'she’s my sister' });
    expect(parseCommand('unkeep @friend.example.com')).toMatchObject({ action: 'unkeep', actor: 'friend.example.com', reason: null });
    expect(parseCommand('keep them').needsTarget).toBe(true);
    expect(parseCommand('keep @jo...', { mentions: ['did:plc:jojojojojojo'] })).toMatchObject({ actor: 'did:plc:jojojojojojo', reason: null });
  });

  it('makes a list by name', () => {
    expect(parseCommand('new list called Pile-on, March')).toMatchObject({ action: 'new_list', name: 'Pile-on, March', needsTarget: false });
    expect(parseCommand('make a list')).toMatchObject({ action: 'new_list', needsTarget: true });
  });

  it('answers help only when it is the whole message', () => {
    for (const yes of ['help', 'Help!', 'commands', 'what can you do?']) expect(parseCommand(yes)?.action, yes).toBe('help');
    for (const no of ['help me understand why they are connected', 'can you help me with this post']) expect(parseCommand(no), no).toBe(null);
    expect(HELP).toMatch(/approve <code> UNKNOWN/);
  });
});

describe('which verbs change something', () => {
  it('names the writes', () => {
    for (const text of ['block @a.b.c', 'unblock @a.b.c', 'approve 3f9a2c1b UNKNOWN', 'undo', 'keep @a.b.c', 'unkeep @a.b.c', 'new list x', 'scan at://did:plc:a/app.bsky.feed.post/3x']) {
      expect(isWrite(parseCommand(text)), text).toBe(true);
    }
    for (const text of ['history', 'lists', 'help', 'review 3f9a2c1b', 'cancel 3f9a2c1b', 'status', 'link ABCDEFGH']) {
      expect(isWrite(parseCommand(text)), text).toBe(false);
    }
    expect(isWrite(null)).toBe(false);
  });
});

describe('targets', () => {
  it('finds post links and at:// URIs in prose, unbracketed and once each', () => {
    const a = 'https://bsky.app/profile/a.bsky.social/post/3abc';
    expect(extractTargets(`look (${a}), and <${a}> and at://did:plc:x/app.bsky.feed.post/3y.`)).toEqual([a, 'at://did:plc:x/app.bsky.feed.post/3y']);
    expect(looksLikeTarget('https://bsky.app/profile/a.bsky.social')).toBe(false);
  });

  it('reads the author of an at:// URI', () => {
    expect(authorOf('at://did:plc:abc/app.bsky.feed.post/3x')).toBe('did:plc:abc');
    expect(authorOf('https://bsky.app')).toBe(null);
    expect(authorOf(null)).toBe(null);
  });

  it('names a plan by the start of its id', () => {
    expect(shortCode('3F9A2C1B-0000-4000-8000-000000000000')).toBe('3f9a2c1b');
    expect(shortCode(null)).toBe('');
  });
});
