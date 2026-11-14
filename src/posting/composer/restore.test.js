import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAllSessionDrafts,
  countSetAside,
  loadSessionDraft,
  readAutosave,
  saveSessionDraft,
  setAside,
  takeSetAside,
  writeAutosave,
} from '../autosave.js';
import {
  isUntouchedSeed,
  keptPostFor,
  mediaPatches,
  otherKeptAccount,
  restoredTouched,
  setAsideKept,
  setAsideState,
  worthSettingAside,
} from './restore.js';

const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';
const NOW = Date.parse('2026-11-12T12:00:00.000Z');

function memoryStore() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const post = (fields = {}) => ({ id: 'p1', text: '', images: [], video: null, record: null, card: null, ...fields });
const state = (fields = {}) => ({
  posts: [post()],
  reply: null,
  tags: [],
  langs: ['en'],
  labels: [],
  gates: { custom: false, reply: null, quotes: true },
  asDid: MIRA,
  schedule: null,
  lifespan: { enabled: false, lifespanSeconds: 86400 },
  source: null,
  ...fields,
});
const file = (name = 'a.png') => ({ name, size: 10, type: 'image/png' });

afterEach(() => clearAllSessionDrafts());

describe('restoredTouched', () => {
  it('uses the stored choice, else counts a timer that is on as chosen', () => {
    expect(restoredTouched({ lifespanTouched: true, state: state() })).toBe(true);
    // An explicit "No timer" stays off: it doesn't read as untouched.
    expect(restoredTouched({ lifespanTouched: true, state: state({ lifespan: { enabled: false } }) })).toBe(true);
    expect(restoredTouched({ lifespanTouched: false, state: state({ lifespan: { enabled: true } }) })).toBe(false);
    expect(restoredTouched({ state: state({ lifespan: { enabled: true } }) })).toBe(true);
    expect(restoredTouched({ state: state() })).toBe(false);
  });
});

describe('keptPostFor', () => {
  it('prefers this tab’s copy, then the saved one, with the timer choice', () => {
    const store = memoryStore();
    writeAutosave(LAB, state({ asDid: LAB, posts: [post({ text: 'saved' })] }), { store, now: NOW, lifespanTouched: true });
    const saved = keptPostFor(LAB, { store, now: NOW });
    expect(saved).toMatchObject({ from: 'autosave', touched: true });
    expect(saved.state.posts[0].text).toBe('saved');

    saveSessionDraft(LAB, state({ asDid: LAB, posts: [post({ text: 'in tab' })] }), { lifespanTouched: false });
    expect(keptPostFor(LAB, { store, now: NOW })).toMatchObject({ from: 'session', touched: false });
    expect(keptPostFor(MIRA, { store, now: NOW })).toBeNull();
  });
});

describe('setting aside', () => {
  it('moves what was kept for an account aside, so a post carried there can’t write over it', () => {
    const store = memoryStore();
    writeAutosave(LAB, state({ asDid: LAB, posts: [post({ text: 'Lab announcement, carefully worded.' })] }), { store, now: NOW });
    const id = setAsideKept(LAB, { store, now: NOW });
    expect(id).toBeTruthy();
    expect(readAutosave(LAB, { store, now: NOW })).toBeNull();
    expect(loadSessionDraft(LAB)).toBeNull();
    // The carried post is now written for Lab without touching it.
    writeAutosave(LAB, state({ asDid: LAB, posts: [post({ text: 'carried over' })] }), { store, now: NOW });
    clearAllSessionDrafts();
    expect(takeSetAside(LAB, { id, store, now: NOW }).state.posts[0].text).toBe('Lab announcement, carefully worded.');
    expect(readAutosave(LAB, { store, now: NOW }).state.posts[0].text).toBe('carried over');
  });

  it('sets a live post aside with its files, and forgets it as the one being written', () => {
    const store = memoryStore();
    const f = file();
    const s = state({ posts: [post({ text: 'A long essay I am halfway through writing.', images: [{ id: 'i', file: f }] })] });
    saveSessionDraft(MIRA, s);
    writeAutosave(MIRA, s, { store, now: NOW });
    const id = setAsideState(MIRA, s, { touched: true, store, now: NOW });
    expect(id).toBeTruthy();
    expect(loadSessionDraft(MIRA)).toBeNull();
    expect(readAutosave(MIRA, { store, now: NOW })).toBeNull();
    const back = takeSetAside(MIRA, { id, store, now: NOW });
    expect(back.state.posts[0].images[0].file).toBe(f);
    expect(back.lifespanTouched).toBe(true);
  });

  it('has nothing to move for an account with nothing kept', () => {
    expect(setAsideKept(LAB, { store: memoryStore(), now: NOW })).toBeNull();
  });
});

describe('isUntouchedSeed and worthSettingAside', () => {
  it('tells a post the writer wrote in from one an intent only seeded', () => {
    const seed = { texts: ['hello world'] };
    expect(isUntouchedSeed(state({ posts: [post({ text: 'hello world' })] }), seed)).toBe(true);
    expect(isUntouchedSeed(state({ posts: [post({ text: 'hello world, more' })] }), seed)).toBe(false);
    expect(isUntouchedSeed(state({ posts: [post({ text: 'hello world', images: [{ id: 'i' }] })] }), seed)).toBe(false);
    expect(isUntouchedSeed(state({ posts: [post({ text: 'hello world' })] }), null)).toBe(false);
    // A reply intent brings no text: the empty reply is still only the seed.
    const reply = { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' };
    expect(worthSettingAside(state({ reply }), { texts: [] })).toBe(false);
    expect(worthSettingAside(state({ reply, posts: [post({ text: 'Quick reply.' })] }), { texts: [] })).toBe(true);
    expect(worthSettingAside(state(), null)).toBe(false);
  });
});

describe('mediaPatches', () => {
  it('fills only media that are still there and still have no file', () => {
    const f = file();
    const v = { name: 'v.mp4', size: 99, type: 'video/mp4' };
    const current = state({
      posts: [
        post({
          id: 'p1',
          images: [
            { id: 'a', localRef: 'virga-media:a', alt: 'kept alt' },
            { id: 'b', localRef: 'virga-media:b', file: file('b.png') },
          ],
          video: { localRef: 'virga-media:v', status: 'idle', alt: '' },
        }),
        post({ id: 'p2', images: [{ id: 'c', localRef: 'virga-media:c' }] }),
      ],
    });
    const filled = state({
      posts: [
        post({
          id: 'p1',
          images: [
            { id: 'a', localRef: 'virga-media:a', file: f, mime: 'image/png', size: 10, previewUrl: 'blob:a' },
            { id: 'b', localRef: 'virga-media:b', file: file('other.png') },
          ],
          video: { localRef: 'virga-media:v', file: v, mime: 'video/mp4', size: 99 },
        }),
      ],
    });
    const out = mediaPatches(current, filled);
    expect(out).toEqual([
      { type: 'updateImage', index: 0, id: 'a', patch: { file: f, mime: 'image/png', size: 10, previewUrl: 'blob:a' } },
      { type: 'setVideo', index: 0, video: { localRef: 'virga-media:v', status: 'idle', alt: '', file: v, mime: 'video/mp4', size: 99 } },
    ]);
  });
});

describe('otherKeptAccount', () => {
  it('finds another account with a post kept or set aside', () => {
    const store = memoryStore();
    const accounts = [{ did: MIRA }, { did: LAB, handle: 'lab.example.org' }];
    expect(otherKeptAccount(accounts, MIRA, { store, now: NOW })).toBeNull();
    writeAutosave(LAB, state({ asDid: LAB, posts: [post({ text: 'Lab notes, long and unsent.' })] }), { store, now: NOW });
    expect(otherKeptAccount(accounts, MIRA, { store, now: NOW })).toEqual({ did: LAB, account: accounts[1] });
    expect(otherKeptAccount(accounts, LAB, { store, now: NOW })).toBeNull();

    const store2 = memoryStore();
    setAside(LAB, state({ asDid: LAB, posts: [post({ text: 'aside' })] }), { store: store2, now: NOW });
    clearAllSessionDrafts();
    expect(countSetAside(LAB, { store: store2, now: NOW })).toBe(1);
    expect(otherKeptAccount(accounts, MIRA, { store: store2, now: NOW })?.did).toBe(LAB);
  });
});
