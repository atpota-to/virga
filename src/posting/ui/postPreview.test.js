import { describe, expect, it } from 'vitest';
import { embedSummary, postPreviewModel } from './postPreview.js';

const URI = 'at://did:plc:abc/app.bsky.feed.post/3kq';

describe('an embed, in a line', () => {
  it('counts images, names a video, a link and a quote', () => {
    expect(embedSummary({ $type: 'app.bsky.embed.images', images: [{}, {}] })).toBe('2 images');
    expect(embedSummary({ $type: 'app.bsky.embed.images#view', images: [{}] })).toBe('1 image');
    expect(embedSummary({ $type: 'app.bsky.embed.video' })).toBe('A video');
    expect(embedSummary({ $type: 'app.bsky.embed.external', external: { uri: 'https://www.example.com/a', title: '' } })).toBe('Link: example.com');
    expect(embedSummary({ $type: 'app.bsky.embed.external', external: { uri: 'https://example.com', title: 'A page' } })).toBe('Link: A page');
    expect(embedSummary({ $type: 'app.bsky.embed.record', record: { uri: URI } })).toBe('Quotes a post');
    expect(embedSummary({ $type: 'app.bsky.embed.record', record: { uri: 'at://did:plc:abc/app.bsky.feed.generator/cats' } })).toBe('Shares a feed');
  });

  it('joins media and a quote', () => {
    expect(
      embedSummary({
        $type: 'app.bsky.embed.recordWithMedia',
        media: { $type: 'app.bsky.embed.images', images: [{}] },
        record: { record: { uri: URI } },
      }),
    ).toBe('1 image · Quotes a post');
  });

  it('says nothing about what it doesn’t know', () => {
    expect(embedSummary(null)).toBeNull();
    expect(embedSummary({ $type: 'app.example.thing' })).toBeNull();
  });
});

describe('a post preview', () => {
  const view = {
    uri: URI,
    author: { did: 'did:plc:abc', handle: 'mira.example.com', displayName: ' Mira ', avatar: 'https://cdn.example/a.jpg' },
    record: { text: 'hello there', createdAt: '2026-11-12T09:00:00.000Z' },
    likeCount: 3,
    replyCount: 1,
    indexedAt: '2026-11-12T09:00:05.000Z',
  };

  it('reads a post view: author, text, date, counts and its Bluesky link', () => {
    const m = postPreviewModel({ view });
    expect(m.author).toEqual({ did: 'did:plc:abc', handle: 'mira.example.com', displayName: 'Mira', avatar: 'https://cdn.example/a.jpg' });
    expect(m.text).toBe('hello there');
    expect(m.at).toBe('2026-11-12T09:00:00.000Z');
    expect(m.counts).toEqual({ replies: 1, reposts: 0, likes: 3, quotes: 0 });
    expect(m.url).toBe('https://bsky.app/profile/mira.example.com/post/3kq');
  });

  it('reads a bare record with only its URI, without an author or counts', () => {
    const m = postPreviewModel({ record: { text: 'just text', createdAt: '2026-01-01T00:00:00Z', reply: { parent: { uri: URI } } }, uri: URI });
    expect(m.author).toBeNull();
    expect(m.counts).toBeNull();
    expect(m.isReply).toBe(true);
    expect(m.url).toBe('https://bsky.app/profile/did%3Aplc%3Aabc/post/3kq');
  });

  it('trims long text, more when compact', () => {
    const long = 'word '.repeat(100);
    expect([...postPreviewModel({ record: { text: long } }).text].length).toBe(280);
    expect([...postPreviewModel({ record: { text: long } }, { compact: true }).text].length).toBe(140);
    expect(postPreviewModel({ record: { text: long } }, { compact: true }).text.endsWith('…')).toBe(true);
  });

  it('drops an invalid handle', () => {
    expect(postPreviewModel({ view: { ...view, author: { did: 'did:plc:abc', handle: 'handle.invalid' } } }).author.handle).toBeNull();
  });
});
