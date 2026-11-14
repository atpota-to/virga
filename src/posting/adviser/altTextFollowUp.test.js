/*
 * Quick notes for revising a generated alt-text description, and the kind of
 * image chosen before the first one. A quick note goes to the server twice: as a
 * sentence in the note (the request in words) and as an id (so the rules stop
 * arguing with it). The ids are pinned against server/ai/altTextPrompt.js,
 * which drops any it doesn't know.
 */
import { describe, expect, it } from 'vitest';
import {
  ALT_TEXT_FOLLOW_UP_MAX,
  ALT_TEXT_IMAGE_KINDS,
  ALT_TEXT_NOTE_MAX,
  ALT_TEXT_QUICK_NOTES,
  ITS_A,
  appendItsA,
  cardQuickNotes,
  composeFollowUp,
  describeRequest,
  hasFollowUpDraft,
  looksTranscribed,
  normalizeImageKind,
  quickNoteIds,
  rankQuickNotes,
  toggleQuickNote,
} from './altTextFollowUp.js';

describe('the ids the server knows', () => {
  it('quick notes match ALT_TEXT_PRESETS', () => {
    expect(ALT_TEXT_QUICK_NOTES.map((n) => n.id).sort()).toEqual([
      'describe',
      'detail',
      'plain',
      'shorter',
      'transcribe',
    ]);
  });

  it('image kinds match ALT_TEXT_KINDS', () => {
    expect(ALT_TEXT_IMAGE_KINDS.map((k) => k.id)).toEqual([
      'photo',
      'interface',
      'chart',
      'text',
    ]);
    expect(normalizeImageKind('interface')).toBe('interface');
    expect(normalizeImageKind('unset')).toBe(null);
    expect(normalizeImageKind(undefined)).toBe(null);
  });
});

describe('choosing quick notes', () => {
  it('turns one on and off', () => {
    expect(toggleQuickNote([], 'shorter')).toEqual(['shorter']);
    expect(toggleQuickNote(['shorter'], 'shorter')).toEqual([]);
  });

  it('lets go of the opposite when one of a pair is chosen', () => {
    expect(toggleQuickNote(['transcribe'], 'describe')).toEqual(['describe']);
    expect(toggleQuickNote(['describe', 'detail'], 'shorter')).toEqual([
      'describe',
      'shorter',
    ]);
  });

  it('keeps list order, whatever order they were tapped in', () => {
    const picked = ['plain', 'describe'].reduce(toggleQuickNote, []);
    expect(picked).toEqual(['describe', 'plain']);
    expect(quickNoteIds(['plain', 'describe', 'nonsense'])).toEqual([
      'describe',
      'plain',
    ]);
  });

  it('ignores an id it does not know', () => {
    expect(toggleQuickNote(['shorter'], 'summon-help')).toEqual(['shorter']);
  });
});

describe('the note sent to the server', () => {
  it("puts each quick note's sentence before the author's words", () => {
    expect(
      composeFollowUp(['describe'], "  It's the settings page in the app  "),
    ).toBe(
      "Describe what is shown and what is happening instead of transcribing the text. It's the settings page in the app",
    );
  });

  it('is empty when nothing is chosen or written', () => {
    expect(composeFollowUp([], '   ')).toBe('');
    expect(hasFollowUpDraft([], '   ')).toBe(false);
    expect(hasFollowUpDraft(['shorter'], '')).toBe(true);
    expect(hasFollowUpDraft([], 'a heron')).toBe(true);
  });

  it("never runs past the server's cap, so the author's words are never cut", () => {
    // The longest set that can be on together: one of each pair, plus plain.
    const longest = ['describe', 'detail', 'plain'];
    const words = 'm'.repeat(ALT_TEXT_NOTE_MAX);
    const note = composeFollowUp(longest, words);
    expect(note.length).toBeLessThanOrEqual(ALT_TEXT_FOLLOW_UP_MAX);
    expect(note.endsWith(words)).toBe(true);
  });
});

describe('"It\'s a…"', () => {
  it('starts a note, or adds to one', () => {
    expect(appendItsA('')).toBe(ITS_A);
    expect(appendItsA('Not a leaf.  ')).toBe(`Not a leaf. ${ITS_A}`);
  });
});

describe('the "Revising:" line', () => {
  it('names the quick notes and the note', () => {
    expect(describeRequest(['describe'], '')).toBe(
      "describe, don't transcribe",
    );
    expect(describeRequest(['shorter', 'plain'], 'a heron')).toBe(
      'shorter, plainer words, plus your note',
    );
    expect(describeRequest([], 'a heron')).toBe('your note');
  });
});

describe('which quick notes fit a description', () => {
  const TRANSCRIPT =
    'Settings. Account. Display name: Sam. Handle: @sam.example.com. Email: Hidden. Notifications. Push notifications: On. Save changes. Cancel.';
  const PHOTO =
    'Three potted plants on a wooden table. At left, a ribbed green pot holds a plant with narrow, pointed green leaves. At right, a speckled gray pot holds a croton with glossy green leaves edged in bright yellow. Behind them, a blurred living room with a framed print of yellow birds on branches.';
  const ids = (context) => rankQuickNotes(context).map((n) => n.id);

  it('tells a transcript from a description', () => {
    expect(looksTranscribed(TRANSCRIPT)).toBe(true);
    expect(looksTranscribed(PHOTO)).toBe(false);
    expect(looksTranscribed('Name: Sam. Plan: Team. Status: Active.')).toBe(
      false,
    ); // too few to say
    expect(looksTranscribed('')).toBe(false);
  });

  it('offers describing only for a transcript, and transcribing never for one', () => {
    expect(ids({ text: TRANSCRIPT })[0]).toBe('describe');
    expect(ids({ text: TRANSCRIPT })).not.toContain('transcribe');
    expect(ids({ text: PHOTO })).not.toContain('describe');
  });

  it('takes the kind the author chose at its word', () => {
    expect(ids({ text: PHOTO, kind: 'photo' })).not.toContain('transcribe');
    expect(ids({ text: PHOTO, kind: 'chart' })).not.toContain('transcribe');
    expect(ids({ text: PHOTO, kind: 'text' })[0]).toBe('describe'); // mostly text: a transcript by design
    expect(ids({ text: PHOTO, kind: 'interface' })).toContain('transcribe');
  });

  it('remembers what the last revision asked for', () => {
    expect(ids({ text: TRANSCRIPT, lastAsked: ['describe'] })).not.toContain(
      'describe',
    );
    expect(ids({ text: PHOTO, lastAsked: ['transcribe'] })).not.toContain(
      'transcribe',
    );
  });

  it('suits the length: shorter for a long one, more detail for a short one', () => {
    expect(ids({ text: 'A heron on a fence post.' })[0]).toBe('detail');
    expect(ids({ text: 'A heron on a fence post.' })).not.toContain('shorter');
    expect(ids({ text: 'm '.repeat(400) })[0]).toBe('shorter');
    expect(ids({ text: 'm '.repeat(400) })).not.toContain('detail');
  });

  it('puts the best three on the card, and only those worth a place', () => {
    expect(cardQuickNotes(rankQuickNotes({ text: TRANSCRIPT }))).toEqual([
      'describe',
      'detail',
      'plain',
    ]);
    expect(
      cardQuickNotes(rankQuickNotes({ text: PHOTO, kind: 'photo' })),
    ).toEqual(['shorter', 'detail', 'plain']);
    // "Transcribe the text" for an unknown image is sheet-only.
    expect(
      cardQuickNotes(rankQuickNotes({ text: 'A heron on a fence post.' })),
    ).toEqual(['detail', 'plain']);
  });
});
