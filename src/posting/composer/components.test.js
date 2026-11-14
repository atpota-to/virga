// First-render checks for the composer's components. The suite has no DOM,
// so these render to a string: they catch a component that throws, and pin
// the labels and states a reader depends on. Behaviour is checked in the
// harness (see the COMPOSER-UI report).

import * as React from 'react';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';

vi.mock('../../session/useAtprotoSession.jsx', () => {
  const accounts = [
    {
      did: 'did:plc:mira',
      handle: 'mira.example.com',
      displayName: 'Mira Okafor',
      mode: 'backend',
      status: 'ready',
    },
    {
      did: 'did:plc:lab',
      handle: 'lab.example.org',
      displayName: 'Field Lab',
      mode: 'backend',
      status: 'needsSignIn',
    },
  ];
  const value = {
    did: 'did:plc:mira',
    accounts,
    agentFor: async () => {
      throw new Error('no network in tests');
    },
    targetFor: async () => {
      throw new Error('no network in tests');
    },
    backendFor: () => null,
    capabilitiesFor: (did) => ({
      mode: 'backend',
      canPost: did === 'did:plc:mira',
      canSchedule: false,
      canUseAi: false,
      missing: [],
    }),
    checkAccount: async () => 'valid',
  };
  return { useAtprotoSession: () => value };
});

// Without the React plugin, Vitest compiles JSX to React.createElement.
globalThis.React = React;

const { default: PostEditor } = await import('./PostEditor.jsx');
const { default: PublishButton } = await import('./PublishButton.jsx');
const { default: PostAsPicker } = await import('./PostAsPicker.jsx');
const { default: ReplyContext } = await import('./ReplyContext.jsx');
const { ImageGrid, VideoAttachment } = await import('./MediaGrid.jsx');
const { LinkCard, RecordCard } = await import('./EmbedCards.jsx');
const { default: GatesEditor } = await import('../ui/GatesEditor.jsx');
const { default: ComposerDefaults } =
  await import('../ui/ComposerDefaults.jsx');
const { ComposerProvider, useComposer } = await import('./ComposerContext.jsx');
const { default: Composer } = await import('./Composer.jsx');
const { composerActions } = await import('./actions.js');
const { emptyComposerState } = await import('../lib/composerModel.js');

const QUEUE = {
  timezone: 'UTC',
  slots: {
    mon: ['09:00'],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
};

describe('PostEditor', () => {
  it('draws the text twice, the layer hidden from screen readers', () => {
    const html = renderToString(
      h(PostEditor, {
        value: 'hello there',
        label: 'Your post',
        placeholder: 'What’s on your mind?',
      }),
    );
    expect(html).toContain('aria-label="Your post"');
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/hello there/g)).toHaveLength(2);
  });
});

describe('PublishButton', () => {
  it('names the primary action and says why it is off', () => {
    const state = emptyComposerState({ asDid: MIRA });
    const model = composerActions(state, {
      defaultAction: 'post',
      queue: QUEUE,
      caps: { canPost: true, canSchedule: true },
    });
    const html = renderToString(h(PublishButton, { state, model }));
    expect(html).toContain('Post');
    expect(html).toContain('aria-label="More ways to send it"');
    expect(html).toContain('Write something first.');
    expect(html).toMatch(/disabled=""/);
  });
});

describe('PostAsPicker', () => {
  it('names the posting account', () => {
    const accounts = [
      {
        did: MIRA,
        handle: 'mira.example.com',
        displayName: 'Mira Okafor',
        status: 'ready',
      },
      {
        did: LAB,
        handle: 'lab.example.org',
        displayName: 'Field Lab',
        status: 'needsSignIn',
      },
    ];
    const html = renderToString(
      h(PostAsPicker, { asDid: LAB, activeDid: MIRA, accounts }),
    );
    expect(html).toContain('Posting as');
    expect(html).toContain('Field Lab');
    expect(html).toContain('Change the account');
  });
  it('says why a scheduled post can’t change account', () => {
    const accounts = [
      { did: MIRA, handle: 'm.example' },
      { did: LAB, handle: 'l.example' },
    ];
    const html = renderToString(
      h(PostAsPicker, {
        asDid: MIRA,
        activeDid: MIRA,
        accounts,
        locked: true,
        lockedReason: 'Stays with its account.',
      }),
    );
    expect(html).toContain('Stays with its account.');
    expect(html).not.toContain('Change the account');
  });
});

describe('attachments', () => {
  it('draws images with their alt text buttons and the count', () => {
    const html = renderToString(
      h(ImageGrid, {
        images: [{ id: 'a', previewUrl: 'blob:x', alt: '' }],
        processing: 1,
      }),
    );
    expect(html).toContain('Add alt text to image 1');
    expect(html).toContain('Preparing an image');
  });
  it('says alt text is required when it is', () => {
    const html = renderToString(
      h(ImageGrid, {
        images: [{ id: 'a', previewUrl: 'blob:x', alt: '' }],
        requireAltText: true,
      }),
    );
    expect(html).toContain('1 still to describe');
  });
  it('shows a video’s upload state', () => {
    const html = renderToString(
      h(VideoAttachment, {
        video: { status: 'processing', progress: 40, alt: '' },
        onCancel() {},
      }),
    );
    expect(html).toContain('Processing');
    expect(html).toContain('Cancel upload');
  });
  it('draws a link card and a quoted feed', () => {
    expect(
      renderToString(
        h(LinkCard, {
          card: {
            url: 'https://www.example.org/a',
            title: 'A page',
            description: 'About it',
            thumb: null,
          },
          onEdit() {},
          onRemove() {},
        }),
      ),
    ).toContain('Edit the link card');
    const feed = renderToString(
      h(RecordCard, {
        record: {
          kind: 'feed',
          uri: 'at://a/app.bsky.feed.generator/f',
          cid: 'c',
          view: { displayName: 'Cats', creator: { handle: 'a.example' } },
        },
        onRemove() {},
      }),
    );
    expect(feed).toContain('Cats');
    expect(feed.replace(/<!-- -->/g, '')).toContain('Feed by @a.example');
  });
});

describe('ReplyContext', () => {
  it('names who is being replied to, and has a placeholder while loading', () => {
    const reply = {
      uri: 'at://w/app.bsky.feed.post/1',
      cid: 'c',
      author: { did: 'did:plc:w', handle: 'wren.example.com' },
      text: 'hello',
    };
    expect(renderToString(h(ReplyContext, { reply, selfDid: MIRA }))).toContain(
      'Replying to @wren.example.com',
    );
    expect(renderToString(h(ReplyContext, { loading: true }))).toContain(
      'aria-busy="true"',
    );
  });
});

describe('GatesEditor', () => {
  it('shows the rules chosen and the quote switch', () => {
    const html = renderToString(
      h(GatesEditor, {
        did: MIRA,
        value: { reply: [{ type: 'mention' }], quotes: false },
        onChange() {},
      }),
    );
    expect(html).toContain('Who can reply');
    expect(html).toMatch(
      /aria-pressed="true"[^>]*><span class="segmented-label">Some people/,
    );
    expect(html).toContain('People you mention');
    expect(html).toContain('Allow quote posts');
  });
});

describe('ComposerDefaults', () => {
  it('renders the account’s defaults', () => {
    const html = renderToString(h(ComposerDefaults, { did: MIRA }));
    expect(html).toContain('New posts');
    expect(html).toContain('Main button');
    expect(html).toContain('Require alt text');
    expect(html).toContain('My Bluesky setting');
  });
});

describe('ComposerProvider', () => {
  it('renders its children and nothing more until opened', () => {
    function Probe() {
      const c = useComposer();
      return h('span', null, c.isOpen ? 'open' : 'closed');
    }
    expect(renderToString(h(ComposerProvider, null, h(Probe)))).toBe(
      '<span>closed</span>',
    );
  });
  it('useComposer needs the provider', () => {
    function Lonely() {
      useComposer();
      return null;
    }
    expect(() => renderToString(h(Lonely))).toThrow(/ComposerProvider/);
  });
});

describe('Composer', () => {
  it('renders open, for the active account', () => {
    const html = renderToString(
      h(Composer, { open: true, intent: {}, onClose() {} }),
    );
    expect(html).toContain('New post');
    expect(html).toContain('Posting as');
    expect(html).toContain('Mira Okafor');
    expect(html).toContain('0 of 300');
    expect(html).toContain('Add a post to the thread');
  });
});
