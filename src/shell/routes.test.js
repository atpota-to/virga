import { describe, expect, it } from 'vitest';
import { hrefFor, pathParts } from '../lib/router.jsx';
import { historyEvents } from '../tools/Identity.jsx';
import { needsArchive, opensBeforeArchive, parseRoute, postingTitle, SECTION_TITLE } from './routes.js';

describe('addresses', () => {
  it('split into their parts, decoded, without empties', () => {
    expect(pathParts('/')).toEqual([]);
    expect(pathParts('/reports/followers/')).toEqual(['reports', 'followers']);
    expect(pathParts('/dashboard/my%20board')).toEqual(['dashboard', 'my board']);
  });

  it('carry the query string along unless the move has its own or drops it', () => {
    expect(hrefFor('/reports', '?latency=0')).toBe('/reports?latency=0');
    expect(hrefFor('/reports?x=1', '?latency=0')).toBe('/reports?x=1');
    expect(hrefFor('/posting', '?text=hello', { keepQuery: false })).toBe('/posting');
    expect(hrefFor('/posting', '')).toBe('/posting');
  });
});

describe('routes', () => {
  it('name the sections that were there before posting', () => {
    expect(parseRoute('/')).toEqual({ section: 'dashboard', dashboard: null });
    expect(parseRoute('/dashboard/abc')).toEqual({ section: 'dashboard', dashboard: 'abc' });
    expect(parseRoute('/reports/followers')).toEqual({ section: 'reports', page: 'followers' });
    expect(parseRoute('/tools')).toEqual({ section: 'tools', page: null });
    expect(parseRoute('/settings/posting')).toEqual({ section: 'settings', page: 'posting' });
    expect(parseRoute('/nowhere')).toEqual({ section: 'missing' });
  });

  it('name the posting pages, the composer and compose links', () => {
    expect(parseRoute('/posting')).toEqual({ section: 'posting', page: 'hub', id: null });
    expect(parseRoute('/posting/drafts/xyz')).toEqual({ section: 'posting', page: 'drafts', id: 'xyz' });
    expect(parseRoute('/posting/compose')).toEqual({ section: 'posting', page: 'compose', id: null });
    expect(parseRoute('/posting/nothing')).toEqual({ section: 'missing' });
    expect(parseRoute('/intent/compose')).toEqual({ section: 'intent', page: 'compose' });
    expect(parseRoute('/intent/other')).toEqual({ section: 'missing' });
  });

  it('let posting open before the archive has, and never ask for a built one', () => {
    for (const path of ['/posting', '/posting/posted', '/posting/compose', '/intent/compose']) {
      const route = parseRoute(path);
      expect(opensBeforeArchive(route)).toBe(true);
      expect(needsArchive(route)).toBe(false);
    }
    expect(needsArchive(parseRoute('/'))).toBe(true);
    expect(needsArchive(parseRoute('/reports'))).toBe(true);
    expect(needsArchive(parseRoute('/tools'))).toBe(false);
    expect(needsArchive(parseRoute('/tools/best-time'))).toBe(true);
    expect(opensBeforeArchive(parseRoute('/settings'))).toBe(false);
  });

  it('give every section a title, and each posting page its own', () => {
    for (const section of ['dashboard', 'reports', 'tools', 'settings', 'posting', 'intent', 'missing']) {
      expect(SECTION_TITLE[section]).toBeTruthy();
    }
    expect(postingTitle(parseRoute('/posting'))).toBe('Posting');
    expect(postingTitle(parseRoute('/posting/timers'))).toBe('Post timers');
    expect(postingTitle(parseRoute('/settings'))).toBeNull();
  });
});

describe('a DID’s history', () => {
  it('says what each operation changed, newest first, skipping nullified ones', () => {
    const log = [
      { at: '2024-01-01', handles: ['a.bsky.social'], pds: 'https://bsky.social', nullified: false },
      { at: '2024-06-01', handles: ['a.bsky.social'], pds: 'https://bsky.social', nullified: true },
      { at: '2025-01-01', handles: ['a.example.com'], pds: 'https://bsky.social', nullified: false },
      { at: '2026-01-01', handles: ['a.example.com'], pds: 'https://pds.example.com', nullified: false },
    ];
    expect(historyEvents(log).map((e) => e.text)).toEqual([
      'Moved to pds.example.com',
      'Handle changed to @a.example.com',
      'Created as @a.bsky.social on bsky.social',
    ]);
  });
});
