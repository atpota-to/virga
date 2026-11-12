import { describe, expect, it } from 'vitest';
import { draftFromTemplate } from '../templates/editorDrafts.js';
import {
  CONTEXT_INSERTS,
  USE_OPTIONS,
  addBlank,
  blanksIn,
  editorHasChanges,
  editorProblems,
  insertAtSelection,
  patchVariable,
} from './templateEditorModel.js';

describe('insertAtSelection', () => {
  it('spaces the token from words either side', () => {
    expect(insertAtSelection('Hi there', '{{x}}', { start: 2, end: 2 })).toEqual({ text: 'Hi {{x}} there', caret: 8 });
    expect(insertAtSelection('Hi ', '{{x}}', { start: 3, end: 3 })).toEqual({ text: 'Hi {{x}}', caret: 8 });
    expect(insertAtSelection('', '{{x}}')).toEqual({ text: '{{x}}', caret: 5 });
  });
  it('leaves punctuation after it alone and replaces a selection', () => {
    expect(insertAtSelection('Hi you!', '{{their.firstName}}', { start: 3, end: 6 }).text).toBe('Hi {{their.firstName}}!');
  });
  it('appends without a selection', () => {
    expect(insertAtSelection('Thanks', '{{today}}').text).toBe('Thanks {{today}}');
  });
});

describe('addBlank', () => {
  it('names the blank from its question and keeps the question', () => {
    const draft = draftFromTemplate({ text: 'Try ' });
    const out = addBlank(draft, 'Which app?', { start: 4, end: 4 });
    expect(out.key).toBe('whichApp');
    expect(out.draft.text).toBe('Try {{whichApp}}');
    expect(out.draft.variables.find((v) => v.key === 'whichApp').label).toBe('Which app?');
  });
  it('numbers a key already used', () => {
    const draft = draftFromTemplate({ text: '{{app}}' });
    expect(addBlank(draft, 'app').key).toBe('app2');
  });
  it('refuses a label with no key in it', () => {
    expect(addBlank(draftFromTemplate({}), '???')).toBeNull();
  });
});

describe('patchVariable and blanksIn', () => {
  it('changes one question and lists the blanks', () => {
    const draft = draftFromTemplate({ text: 'Hi {{their.firstName}}, try {{app}}' });
    const next = patchVariable(draft, 'app', { kind: 'choice', choicesText: 'A\nB' });
    expect(next.variables.find((v) => v.key === 'app')).toMatchObject({ kind: 'choice', choicesText: 'A\nB' });
    const b = blanksIn(next);
    expect(b.asked.map((v) => v.key)).toEqual(['app']);
    expect(b.context).toEqual([{ key: 'their.firstName', label: 'their first name' }]);
  });
});

describe('editorHasChanges', () => {
  it('ignores what saving wouldn’t write', () => {
    const a = draftFromTemplate({ name: 'A', text: 'x' });
    expect(editorHasChanges(a, { ...a, quoteView: { any: 1 } })).toBe(false);
    expect(editorHasChanges(a, { ...a, name: 'B' })).toBe(true);
    expect(editorHasChanges(a, { ...a, keywordsText: 'moth' })).toBe(true);
  });
});

describe('editorProblems', () => {
  it('uses the template’s own messages', () => {
    const p = editorProblems(draftFromTemplate({ name: '', text: '' }));
    expect(p.name).toBe('Give it a name so you can find it later.');
    expect(p.text).toBe('Write some text or choose something to quote.');
  });
  it('catches a shortcut clash and an unread link', () => {
    const p = editorProblems(
      { ...draftFromTemplate({ name: 'B', text: 'x', shortcut: 'hi' }), quoteMode: 'link', quoteUrl: 'https://a.example', embed: null },
      [{ rkey: 'other', name: 'Hello', shortcut: 'hi' }],
    );
    expect(p.shortcut).toBe('/hi already opens “Hello”.');
    expect(p.quote).toMatch(/Read the link/);
  });
});

describe('options', () => {
  it('lists the three uses and the context inserts', () => {
    expect(USE_OPTIONS.map((o) => o.value)).toEqual(['reply', 'post', 'any']);
    expect(CONTEXT_INSERTS.map((c) => c.key)).toContain('their.firstName');
  });
});
