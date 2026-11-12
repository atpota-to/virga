/*
 * First renders of the library's components through react-dom/server (the
 * suite has no DOM, so effects and clicks don't run here): that each draws
 * what it's given, with its labels, and nothing throws.
 */
import React, { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../session/useAtprotoSession.jsx', () => ({
  useAtprotoSession: () => ({
    agentFor: async () => null,
    accounts: [{ did: 'did:plc:self', handle: 'me.example' }],
    capabilitiesFor: () => ({ canPost: true, canSchedule: true, missing: [] }),
  }),
}));

// The suite runs without the React plugin, so JSX compiles to
// React.createElement and needs React in scope.
globalThis.React = React;

const { default: TemplateQuestions } = await import('./TemplateQuestions.jsx');
const { default: LibraryPanel } = await import('./LibraryPanel.jsx');
const { default: TemplateEditor } = await import('./TemplateEditor.jsx');
const { itemFromTemplate, libraryContext } = await import('./model.js');

const TEMPLATE = {
  rkey: 't1',
  name: 'Event reminder',
  text: 'Reminder: {{event}} is on {{day}}, {{their.firstName}}.',
  variables: [
    { key: 'event', label: 'What is on', hint: 'A few words' },
    { key: 'day', label: 'Which day', kind: 'choice', choices: ['Saturday', 'Sunday'] },
  ],
  use: 'any',
  shortcut: 'remind',
  keywords: [],
};

describe('TemplateQuestions', () => {
  it('asks each blank, notes the missing context and previews the post', () => {
    const html = renderToString(
      createElement(TemplateQuestions, { template: TEMPLATE, context: { state: null }, onDone: () => {}, onCancel: () => {}, submitLabel: 'Put in post' }),
    );
    expect(html).toContain('What is on');
    expect(html).toContain('A few words');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('Saturday');
    expect(html).toContain('There&#x27;s no post being replied to, so this is asked.');
    expect(html).toContain('Your post will read');
    expect(html).toContain('Put in post');
  });

  it('fills context from the post being replied to', () => {
    const html = renderToString(
      createElement(TemplateQuestions, {
        template: TEMPLATE,
        context: { state: { reply: { uri: 'at://x/app.bsky.feed.post/1', author: { handle: 'wren.example', displayName: 'Wren Okafor' }, text: 'hi' } } },
        onDone: () => {},
      }),
    );
    expect(html).not.toContain('Their first name');
    expect(html).toContain('Wren');
    expect(html).toContain('Your reply will read');
  });
});

function fakeLib(overrides = {}) {
  const context = libraryContext({ selfHandle: 'me.example' });
  const item = itemFromTemplate(TEMPLATE, context);
  return {
    did: 'did:plc:self',
    replying: false,
    context,
    quoteSlotLocked: false,
    shelves: [
      { id: 'templates', label: 'Templates', count: 1, status: 'ready' },
      { id: 'posts', label: 'Your posts', count: null, status: 'idle' },
      { id: 'search', label: 'Search', count: null, status: 'idle' },
    ],
    items: (id) => (id === 'templates' ? [item] : []),
    templateSections: () => [{ id: 'ungrouped', heading: null, muted: false, items: [item] }],
    ensure: () => {},
    retry: () => {},
    hasMore: () => false,
    loadMore: () => {},
    sort: 'date',
    setSort: () => {},
    search: {
      query: '',
      setQuery: () => {},
      local: [],
      localStatus: 'ready',
      remote: { status: 'idle', posts: [], hasMore: false, loadingMore: false, loadMore: () => {}, retry: () => {} },
      mine: false,
      setMine: () => {},
    },
    hydrate: async (i) => i,
    resolveLink: async () => null,
    planFor: async () => ({}),
    recordUse: () => null,
    ...overrides,
  };
}

describe('LibraryPanel', () => {
  it('draws the shelves, the search box and the shelf’s items', () => {
    const html = renderToString(createElement(LibraryPanel, { lib: fakeLib(), onUse: () => {}, initialShelf: 'templates' }));
    expect(html).toContain('aria-label="Shelves"');
    expect(html).toContain('Search, or paste a link');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('Event reminder');
    expect(html).toContain('/remind');
  });

  it('shows bones while a shelf loads, and says what an empty one is for', () => {
    const loading = renderToString(createElement(LibraryPanel, { lib: fakeLib(), onUse: () => {}, initialShelf: 'posts' }));
    expect(loading).toContain('lib-skeleton');
    const lib = fakeLib({
      shelves: [{ id: 'posts', label: 'Your posts', count: 0, status: 'ready' }],
      items: () => [],
    });
    const empty = renderToString(createElement(LibraryPanel, { lib, onUse: () => {}, initialShelf: 'posts' }));
    expect(empty).toContain('No posts of yours yet');
  });
});

describe('TemplateEditor', () => {
  it('draws the form with the public-record note when open', () => {
    const html = renderToString(createElement(TemplateEditor, { open: true, onClose: () => {}, did: 'did:plc:self', template: TEMPLATE }));
    expect(html).toContain('Edit the template');
    expect(html).toContain('where anyone can read them');
    expect(html).toContain('What is on');
    expect(html).toContain('Offer it when');
    expect(html).toContain('Save template');
    expect(html).toContain('Delete');
  });

  it('starts from a seed', () => {
    const html = renderToString(
      createElement(TemplateEditor, { open: true, onClose: () => {}, did: 'did:plc:self', seed: { text: 'Seeded words', embed: null } }),
    );
    expect(html).toContain('New template');
    expect(html).toContain('Seeded words');
  });

  it('draws nothing of the form while closed', () => {
    const html = renderToString(createElement(TemplateEditor, { open: false, onClose: () => {}, did: 'did:plc:self' }));
    expect(html).not.toContain('Save template');
  });
});
