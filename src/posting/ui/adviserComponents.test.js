/*
 * First renders of the adviser's surfaces through react-dom/server (the
 * suite has no DOM, so effects and clicks don't run): the busy line, the
 * sheet in each state, the alt-text dialog with and without a requester, the
 * style dialog and the settings card. Each draws what it's given, with its
 * labels, and nothing throws. The hook gets a first render too.
 */
import React, { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let caps = { canPost: true, canSchedule: true, canUseAi: true, missing: [] };
const requester = { did: 'did:plc:self', request: vi.fn() };

vi.mock('../../session/useAtprotoSession.jsx', () => ({
  useAtprotoSession: () => ({
    accounts: [{ did: 'did:plc:self', handle: 'me.example', mode: 'backend', status: 'ready' }],
    authMode: 'backend',
    backendFor: () => (caps.canUseAi ? requester : null),
    capabilitiesFor: () => caps,
  }),
}));

// The suite runs without the React plugin, so JSX compiles to
// React.createElement and needs React in scope.
globalThis.React = React;

const { default: AdviserBusy } = await import('./AdviserBusy.jsx');
const { default: AdviserSheet } = await import('./AdviserSheet.jsx');
const { default: AltTextDialog } = await import('./AltTextDialog.jsx');
const { default: StyleDialog } = await import('./StyleDialog.jsx');
const { default: AdviserSettings } = await import('./AdviserSettings.jsx');
const { useAdviserGate } = await import('../adviser/useAdviserGate.js');
const { DEFAULT_ADVISER_SETTINGS, nextPostingAdviserState } = await import('../adviser/setup.js');

const html = (el) => renderToString(el);
const text = (el) =>
  html(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const sheet = (read, extra = {}) =>
  createElement(AdviserSheet, {
    open: true,
    onClose: () => {},
    read,
    state: null,
    onApplyFix: () => {},
    onPublishAnyway: () => {},
    onKeepEditing: () => {},
    onSaveDraft: () => {},
    busy: false,
    ...extra,
  });

const READ = {
  mode: 'gate',
  status: 'ready',
  scenario: 'thread',
  posts: ['I hate the the rain', 'about politics today'],
  taken: [],
  context: null,
  contextKind: null,
  readTheRoom: true,
  usageLine: '18 of 30 free checks left this month. Shared with Anisota.',
  result: {
    sentiment: { label: 'negative', score: -0.6 },
    checks: [
      { id: 'reduceNegativity', label: 'Reduce negativity', status: 'caution', excerpt: 'I hate' },
      { id: 'limitTopic', label: 'Limit topics', status: 'conflict', excerpt: null },
      { id: 'lessConfrontational', label: 'Less confrontational', status: 'ok' },
    ],
    overallStatus: 'conflict',
    writing: { issues: [{ type: 'typo', found: 'the the', replacement: 'the', note: 'The same word twice.' }] },
  },
};

describe('AdviserBusy', () => {
  it('says what it’s reading for, with both ways out for the pre-publish check', () => {
    const out = text(
      createElement(AdviserBusy, {
        goals: [
          { key: 'reduceNegativity', label: 'Reduce negativity', detail: null },
          { key: 'writing', label: 'Writing check', detail: 'typos, grammar' },
        ],
        startedAt: Date.now(),
        onPublishAnyway: () => {},
        onKeepEditing: () => {},
      }),
    );
    expect(out).toContain('Reading your draft');
    expect(out).toContain('Usually a few seconds');
    expect(out).toContain('Reduce negativity');
    expect(out).toContain('typos, grammar');
    expect(out).toContain('Keep editing');
    expect(out).toContain('Publish anyway');
  });

  it('offers only Keep editing for the button’s read, and says when it’s slow', () => {
    const out = text(
      createElement(AdviserBusy, {
        goals: [],
        startedAt: Date.now() - 9000,
        onPublishAnyway: null,
        onKeepEditing: () => {},
      }),
    );
    expect(out).not.toContain('Publish anyway');
    expect(out).toContain('Taking a little longer than usual');
  });
});

describe('AdviserSheet', () => {
  it('lays out a read: verdict, marked post, fixes, notes and goals met', () => {
    const out = text(sheet(READ));
    expect(out).toContain('Before this goes out');
    expect(out).toContain('Goes against a goal you set');
    expect(out).toContain('Your thread');
    expect(out).toContain('Tone: negative');
    expect(out).toContain('1/2');
    expect(out).toContain('1 typo');
    expect(out).toContain('Fix it');
    expect(out).toContain('Limit topics');
    expect(out).toContain('goes against it');
    expect(out).toContain('worth a look');
    expect(out).toContain('Fine against');
    expect(out).toContain('Less confrontational');
    expect(out).toContain('18 of 30 free checks left');
    expect(out).toContain('Keep editing');
    expect(out).toContain('Save as draft');
    expect(out).toContain('Publish anyway');
    const markup = html(sheet(READ));
    expect(markup).toContain('<del>the the</del>');
    expect(markup).toContain('<ins>the</ins>');
    expect(markup).toContain('data-keys="check:0"');
  });

  it('shows a taken fix as fixed', () => {
    const out = html(sheet({ ...READ, taken: ['fix:0'] }));
    expect(out).toContain('Fixed: ');
    expect(out).not.toContain('<del>the the</del>');
    expect(text(sheet({ ...READ, taken: ['fix:0'] }))).toContain('1 fixed');
  });

  it('leaves out Publish where the sheet doesn’t offer it', () => {
    const out = text(sheet({ ...READ, mode: 'manual' }, { onPublishAnyway: undefined }));
    expect(out).toContain('Post adviser');
    expect(out).not.toContain('Publish');
  });

  it('draws the states with nothing read', () => {
    expect(text(sheet({ status: 'needsText', mode: 'manual' }))).toContain('Write something first');
    expect(text(sheet({ status: 'empty', mode: 'manual' }))).toContain('Settings › Posting');
    expect(
      text(sheet({ status: 'limit', mode: 'manual', usageLine: 'No free checks left this month. They start again on December 1.' })),
    ).toContain('They start again on December 1.');
    const failed = text(sheet({ status: 'error', mode: 'manual', error: 'AI help isn’t available right now.' }));
    expect(failed).toContain('AI help isn’t available right now.');
    expect(failed).toContain('Publish anyway');
    expect(text(sheet({ status: 'empty', mode: 'manual' }))).toContain('Close');
  });

  it('has a skeleton while busy', () => {
    expect(html(sheet(READ, { busy: true }))).toContain('adviser-skeleton');
  });
});

describe('AltTextDialog', () => {
  const image = { previewUrl: 'blob:x', alt: '' };
  it('always lets the writer write it, with the limit', () => {
    const out = text(
      createElement(AltTextDialog, { open: true, onClose: () => {}, image, onSave: () => {}, did: 'did:plc:self', requester: null }),
    );
    expect(out).toContain('Description');
    expect(out).toContain('0 of 2,000');
    expect(out).toContain('Save');
    expect(out).not.toContain('Describe it for me');
    expect(out).not.toContain('Virga’s server');
  });

  it('offers to describe the image with a requester', () => {
    const out = text(
      createElement(AltTextDialog, { open: true, onClose: () => {}, image, onSave: () => {}, did: 'did:plc:self', requester }),
    );
    expect(out).toContain('Describe it for me');
    expect(out).toContain('What kind of image is it?');
    expect(out).toContain('Chart or graph');
    expect(out).toContain('Virga’s server');
  });

  it('offers revising when there’s a description already', () => {
    const out = text(
      createElement(AltTextDialog, {
        open: true,
        onClose: () => {},
        image: { ...image, alt: 'A cat asleep on a windowsill in the sun.' },
        onSave: () => {},
        did: 'did:plc:self',
        requester,
      }),
    );
    expect(out).toContain('Revise it');
    expect(out).toContain('It’s a…');
    expect(out).not.toContain('Describe it for me');
  });
});

describe('StyleDialog and AdviserSettings', () => {
  it('the style dialog shows the NeedsBackend card without a requester', () => {
    caps = { canPost: true, canSchedule: false, canUseAi: false, missing: [] };
    const out = text(createElement(StyleDialog, { open: true, onClose: () => {}, did: 'did:plc:self' }));
    expect(out).toContain('Your writing style');
    caps = { canPost: true, canSchedule: true, canUseAi: true, missing: [] };
  });

  it('the settings card is off by default and says what is sent', () => {
    const out = text(createElement(AdviserSettings, { did: 'did:plc:self' }));
    expect(out).toContain('Post adviser');
    expect(out).toContain('Use the post adviser');
    expect(out).toContain('What’s sent, and to whom');
    expect(out).toContain('other people’s public posts');
    expect(out).not.toContain('Check before posting');
  });

  it('the settings card needs a long session (D16)', () => {
    caps = { canPost: true, canSchedule: false, canUseAi: false, missing: [] };
    const out = text(createElement(AdviserSettings, { did: 'did:plc:self' }));
    expect(out).toContain('Post adviser');
    expect(out).not.toContain('Use the post adviser');
    caps = { canPost: true, canSchedule: true, canUseAi: true, missing: [] };
  });
});

describe('useAdviserGate', () => {
  function Probe({ settings, requester: req, canUseAi }) {
    const adviser = useAdviserGate({ did: 'did:plc:self', settings, requester: req, canUseAi, onApplyFixes: () => {} });
    return createElement(
      'pre',
      null,
      JSON.stringify({
        enabled: adviser.enabled,
        busy: adviser.busyProps,
        open: adviser.sheetProps.open,
        usageLine: adviser.usageLine,
        check: typeof adviser.check,
      }),
    );
  }
  const read = (props) => JSON.parse(text(createElement(Probe, props)).trim());

  it('is enabled only with the switch, a requester and AI access', () => {
    const seeded = nextPostingAdviserState(DEFAULT_ADVISER_SETTINGS);
    expect(read({ settings: seeded, requester, canUseAi: true })).toEqual({
      enabled: true,
      busy: null,
      open: false,
      usageLine: '',
      check: 'function',
    });
    expect(read({ settings: seeded, requester: null, canUseAi: false }).enabled).toBe(false);
    expect(read({ settings: DEFAULT_ADVISER_SETTINGS, requester, canUseAi: true }).enabled).toBe(false);
  });
});
