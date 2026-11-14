// The editor's drafts round-trip in library/model.test.js (they are
// re-exported there); this file holds what the composer side adds.
import { describe, expect, it } from 'vitest';
import {
  BLANK_TEMPLATE,
  draftFromReply,
  templateEmbedKind,
  templateFromDraft,
} from './editorDrafts.js';

const POST = 'at://did:plc:me/app.bsky.feed.post/3kq';

describe('templateEmbedKind', () => {
  it('names what a stored embed attaches', () => {
    expect(templateEmbedKind(null)).toBeNull();
    expect(
      templateEmbedKind({
        $type: 'app.bsky.embed.record',
        record: { uri: POST },
      }),
    ).toBe('post');
    expect(
      templateEmbedKind({
        $type: 'app.bsky.embed.record',
        record: { uri: 'at://x/app.bsky.feed.generator/f' },
      }),
    ).toBe('feed');
    expect(
      templateEmbedKind({
        $type: 'app.bsky.embed.record',
        record: { uri: 'at://x/app.bsky.graph.list/l' },
      }),
    ).toBe('list');
    expect(
      templateEmbedKind({
        $type: 'app.bsky.embed.record',
        record: { uri: 'at://x/app.bsky.graph.starterpack/s' },
      }),
    ).toBe('unsupported');
    expect(
      templateEmbedKind({
        $type: 'app.bsky.embed.external',
        external: { uri: 'https://a.example' },
      }),
    ).toBe('link');
    expect(
      templateEmbedKind({ $type: 'app.bsky.embed.images', images: [] }),
    ).toBe('unsupported');
  });
});

describe('draftFromReply with the composer’s shapes', () => {
  const reply = {
    uri: 'at://did:plc:wren/app.bsky.feed.post/1',
    cid: 'c1',
    root: { uri: 'at://did:plc:wren/app.bsky.feed.post/1', cid: 'c1' },
    author: {
      did: 'did:plc:wren',
      handle: 'wren.example',
      displayName: 'Wren Okafor',
    },
    text: 'Is there an app?',
  };

  it('reads the reply, the post’s record and its card', () => {
    const { draft, note } = draftFromReply({
      text: 'Not yet, Wren!',
      reply,
      record: { kind: 'post', uri: POST, cid: 'cq' },
    });
    expect(draft.text).toBe('Not yet, {{their.firstName}}!');
    expect(note).toContain('“Wren”');
    expect(draft.embed).toEqual({
      $type: 'app.bsky.embed.record',
      record: { uri: POST, cid: 'cq' },
    });
    expect(draft.use).toBe('reply');

    const carded = draftFromReply({
      text: 'Here',
      reply,
      card: { url: 'https://docs.example/a', title: 'Docs' },
    });
    expect(carded.draft).toMatchObject({
      quoteMode: 'link',
      quoteUrl: 'https://docs.example/a',
    });
  });

  it('prefers the record over the card, and saves as a template as written', () => {
    const { draft } = draftFromReply({
      text: 'x',
      reply,
      record: { uri: POST, cid: 'cq' },
      card: { url: 'https://a.example' },
    });
    expect(draft.embed.$type).toBe('app.bsky.embed.record');
    expect(templateFromDraft(draft)).toMatchObject({
      ...BLANK_TEMPLATE,
      text: 'x',
      use: 'reply',
      embed: draft.embed,
    });
  });
});
