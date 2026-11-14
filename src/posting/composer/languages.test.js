import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_CODES,
  languageName,
  searchLanguages,
  langsSummary,
  labelsSummary,
} from './languages.js';

describe('languages', () => {
  it('lists two-letter codes once each', () => {
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length);
    expect(LANGUAGE_CODES.every((c) => /^[a-z]{2}$/.test(c))).toBe(true);
    expect(LANGUAGE_CODES.length).toBeGreaterThan(180);
  });

  it('names a language, or gives its code back', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('')).toBe('');
  });

  it('finds languages by name or code, the chosen left out', () => {
    expect(searchLanguages('span').map((l) => l.code)).toContain('es');
    expect(searchLanguages('fr')[0].code).toBe('fr');
    expect(
      searchLanguages('english', { chosen: ['en'] }).map((l) => l.code),
    ).not.toContain('en');
  });

  it('puts the browser’s languages first with no query', () => {
    const first = searchLanguages('', { preferred: ['de-DE', 'en'] });
    expect(first.slice(0, 2).map((l) => l.code)).toEqual(['de', 'en']);
  });

  it('summarises', () => {
    expect(langsSummary(['en', 'es'])).toBe('English, Spanish');
    expect(langsSummary([])).toBe('No language set');
    expect(labelsSummary(['nudity', 'graphic-media'])).toBe(
      'Nudity, Graphic media',
    );
  });
});
