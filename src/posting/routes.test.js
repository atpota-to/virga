import { describe, expect, it } from 'vitest';
import { POSTING_PAGES, POSTING_PAGE_BY_KEY, parsePostingRoute, postingPath } from './routes.js';

describe('posting pages', () => {
  it('each have a key, an address under /posting, a label, an icon and say what they touch', () => {
    const keys = new Set();
    for (const page of POSTING_PAGES) {
      expect(keys.has(page.key)).toBe(false);
      keys.add(page.key);
      expect(page.path === '/posting' || page.path === `/posting/${page.key}`).toBe(true);
      expect(page.label).toMatch(/^[A-Z]/);
      expect(page.icon).toBeTruthy();
      expect(typeof page.needsBackend).toBe('boolean');
      expect(page.access.length).toBeGreaterThan(0);
      for (const kind of page.access) expect(['read', 'follow', 'post', 'server']).toContain(kind);
    }
  });

  it('never say both read only and can post', () => {
    // AccessBadge draws 'read' as "Read only", which a page that writes
    // contradicts.
    for (const page of POSTING_PAGES) {
      if (page.access.includes('read')) expect(page.access).not.toContain('post');
    }
    expect(POSTING_PAGE_BY_KEY.library.access).toEqual(['post']);
  });

  it('send the ones that run on Virga’s server through the long-session check', () => {
    expect(POSTING_PAGES.filter((p) => p.needsBackend).map((p) => p.key)).toEqual(['scheduled', 'schedule', 'timers']);
    for (const page of POSTING_PAGES.filter((p) => p.needsBackend)) expect(page.access).toContain('server');
  });

  it('are the eight the design names', () => {
    expect(Object.keys(POSTING_PAGE_BY_KEY).sort()).toEqual(
      ['drafts', 'hub', 'library', 'posted', 'schedule', 'scheduled', 'templates', 'timers'].sort(),
    );
    expect(postingPath('hub')).toBe('/posting');
    expect(postingPath('timers')).toBe('/posting/timers');
    expect(postingPath('nothing')).toBe('/posting');
  });
});

describe('a posting address', () => {
  it('names the overview, a page, or a page and an id', () => {
    expect(parsePostingRoute('/posting')).toEqual({ key: 'hub', id: null });
    expect(parsePostingRoute('/posting/')).toEqual({ key: 'hub', id: null });
    expect(parsePostingRoute('/posting/drafts')).toEqual({ key: 'drafts', id: null });
    expect(parsePostingRoute('/posting/drafts/3lbx2')).toEqual({ key: 'drafts', id: '3lbx2' });
    expect(parsePostingRoute(['posting', 'scheduled', 'abc'])).toEqual({ key: 'scheduled', id: 'abc' });
  });

  it('names the composer at /posting/compose', () => {
    expect(parsePostingRoute('/posting/compose')).toEqual({ key: 'compose', id: null });
    expect(parsePostingRoute('/posting/compose/extra')).toBeNull();
  });

  it('names nothing outside the section, for an unknown page, or with too many parts', () => {
    expect(parsePostingRoute('/tools')).toBeNull();
    expect(parsePostingRoute('/posting/nothing')).toBeNull();
    expect(parsePostingRoute('/posting/hub')).toBeNull();
    expect(parsePostingRoute('/posting/drafts/a/b')).toBeNull();
  });
});
