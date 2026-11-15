import { describe, expect, it } from 'vitest';
import { buildCommands, COMMAND_GROUPS, fold, moveActive, paletteGroups, parseRecent, periodTitle, rankCommands, rememberRecent, RECENT_GROUP, MAX_RECENT } from './commands.js';
import { REPORTS } from '../reports/registry.js';
import { TOOLS } from '../tools/registry.js';
import { POSTING_PAGES } from '../posting/routes.js';
import { ANALYTICS_PERIODS } from '../lib/analytics.js';
import { parseRoute } from './routes.js';

const SECTIONS = [
  { key: 'account', label: 'Account' },
  { key: 'data', label: 'Data and sync' },
  { key: 'appearance', label: 'Appearance' },
];
const MIRA = { did: 'did:plc:mira', handle: 'mira.example.com', displayName: 'Mira Okafor', status: 'ready' };
const LAB = { did: 'did:plc:lab', handle: 'lab.example.org', displayName: 'Field Lab', status: 'ready' };

const context = (overrides = {}) => ({
  dashboards: [
    { id: 'd1', name: 'Overview' },
    { id: 'd2', name: 'Growth' },
  ],
  reports: REPORTS,
  tools: TOOLS,
  postingPages: POSTING_PAGES,
  settingsSections: SECTIONS,
  accounts: [MIRA, LAB],
  activeDid: MIRA.did,
  periods: ANALYTICS_PERIODS,
  period: '30d',
  theme: 'system',
  route: { section: 'dashboard', dashboard: 'd1' },
  archive: { built: true, complete: true, syncing: false },
  ...overrides,
});
const titles = (list) => list.map((c) => c.title);
const byId = (list, id) => list.find((c) => c.id === id);

describe('buildCommands', () => {
  const commands = buildCommands(context());

  it('lists everything in the registries, and each address is one the app knows', () => {
    for (const r of REPORTS) expect(byId(commands, `go:/reports/${r.key}`)).toMatchObject({ group: 'Reports', title: r.label, go: `/reports/${r.key}` });
    for (const p of POSTING_PAGES) expect(byId(commands, `go:${p.path}`)).toMatchObject({ group: 'Posting', title: p.label });
    for (const s of SECTIONS) expect(byId(commands, `go:/settings/${s.key}`)).toMatchObject({ group: 'Settings', title: s.label });
    expect(byId(commands, 'go:/dashboard/d2')).toMatchObject({ group: 'Dashboards', title: 'Growth' });
    for (const c of commands.filter((x) => x.go)) expect(parseRoute(c.go).section, c.go).not.toBe('missing');
  });

  it('leaves out tools that aren’t built', () => {
    for (const t of TOOLS) {
      const found = byId(commands, `go:/tools/${t.key}`);
      if (t.planned) expect(found).toBeUndefined();
      else expect(found).toMatchObject({ group: 'Tools', title: t.name });
    }
    const made = buildCommands(context({ tools: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B', planned: true }] }));
    expect(titles(made.filter((c) => c.group === 'Tools'))).toEqual(['A', 'All tools']);
  });

  it('picks up a page added to a registry without being told', () => {
    const more = buildCommands(context({ reports: [...REPORTS, { key: 'new-one', label: 'Something new' }], settingsSections: [...SECTIONS, { key: 'labs', label: 'Labs' }] }));
    expect(byId(more, 'go:/reports/new-one')).toMatchObject({ title: 'Something new' });
    expect(byId(more, 'go:/settings/labs')).toMatchObject({ title: 'Labs' });
  });

  it('has an id for every command, each once, in groups it knows', () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of commands) {
      expect(COMMAND_GROUPS).toContain(c.group);
      expect(Boolean(c.go) !== Boolean(c.do), c.id).toBe(true);
    }
  });

  it('offers New post with its shortcut, and the other signed-in accounts', () => {
    expect(byId(commands, 'do:new-post')).toMatchObject({ title: 'New post', shortcut: 'N', do: 'newPost' });
    expect(byId(commands, `account:${LAB.did}`)).toMatchObject({ title: 'Switch to Field Lab', hint: '@lab.example.org', do: 'switchAccount', arg: LAB.did });
    expect(byId(commands, `account:${MIRA.did}`)).toBeUndefined();
    const out = buildCommands(context({ accounts: [MIRA, { ...LAB, displayName: '', status: 'needsSignIn' }] }));
    expect(byId(out, `account:${LAB.did}`)).toMatchObject({ title: 'Switch to @lab.example.org', hint: 'Signed out. Opens the sign-in.' });
  });

  it('sets the period and the theme, marking the one in use', () => {
    expect(titles(commands.filter((c) => c.group === 'Period'))).toEqual(['Last 7 days', 'Last 30 days', 'Last 90 days', 'Last year', 'All time']);
    expect(byId(commands, 'period:30d')).toMatchObject({ do: 'period', arg: '30d', current: true });
    expect(byId(commands, 'period:7d').current).toBe(false);
    expect(titles(commands.filter((c) => c.group === 'Theme'))).toEqual(['Light theme', 'Dark theme', 'Match the system theme']);
    expect(byId(commands, 'theme:system').current).toBe(true);
    // A custom range is none of them.
    expect(buildCommands(context({ period: 'custom' })).filter((c) => c.group === 'Period' && c.current)).toEqual([]);
    expect(periodTitle({ key: '1y', days: 365, label: 'Year' })).toBe('Last year');
  });

  it('customizes a dashboard only when on one', () => {
    expect(byId(commands, 'do:customize')).toBeTruthy();
    expect(byId(commands, 'go:/dashboard/d1').current).toBe(true);
    expect(byId(buildCommands(context({ route: { section: 'reports', page: 'followers' } })), 'do:customize')).toBeUndefined();
    expect(byId(buildCommands(context({ route: { section: 'dashboard', dashboard: 'gone' } })), 'do:customize')).toBeUndefined();
  });

  it('says what a sync would do, and offers none while one runs', () => {
    expect(byId(commands, 'do:sync').title).toBe('Sync now');
    expect(byId(buildCommands(context({ archive: { built: false } })), 'do:sync').title).toBe('Build your archive');
    expect(byId(buildCommands(context({ archive: { built: true, complete: false } })), 'do:sync').title).toBe('Resume the build');
    expect(byId(buildCommands(context({ archive: { built: true, syncing: true } })), 'do:sync')).toBeUndefined();
  });

  it('builds from nothing without falling over', () => {
    expect(titles(buildCommands())).toEqual(['New post', 'Build your archive', 'New dashboard', 'Light theme', 'Dark theme', 'Match the system theme']);
  });
});

describe('rankCommands', () => {
  const commands = buildCommands(context());
  const first = (query, options) => rankCommands(commands, query, options)[0]?.title;

  it('gives the whole list for an empty query', () => {
    expect(rankCommands(commands, '')).toEqual(commands);
    expect(rankCommands(commands, '   ')).toEqual(commands);
  });

  it('puts the start of a title first, then the start of a word, then anywhere', () => {
    expect(first('fol')).toBe('Followers');
    expect(first('sync')).toBe('Sync now');
    expect(titles(rankCommands(commands, 'post')).slice(0, 2)).toEqual(['Posts', 'Posted']);
    expect(titles(rankCommands(commands, 'time'))).toContain('Best time to post');
    expect(titles(rankCommands(commands, 'leanup'))).toEqual(['Follow cleanup']);
  });

  it('needs every typed word, in any order, across title, group and keywords', () => {
    expect(first('settings data')).toBe('Data and sync');
    expect(first('data settings')).toBe('Data and sync');
    expect(first('dark')).toBe('Dark theme');
    expect(first('appearance dark')).toBe('Dark theme');
    expect(first('compose')).toBe('New post');
    expect(first('lab')).toBe('Switch to Field Lab');
    expect(rankCommands(commands, 'followers zebra')).toEqual([]);
  });

  it('forgives case, accents, apostrophes and a missed letter', () => {
    expect(first('FOLLOWERS')).toBe('Followers');
    expect(first('folowers')).toBe('Followers');
    expect(first('youre')).toBe('Lists you’re on');
    expect(first('enggement')).toBe('Engagement');
    expect(fold('Café d’Été')).toBe('cafe dete');
    const cafe = [{ id: 'x', group: 'Dashboards', title: 'Café numbers' }];
    expect(rankCommands(cafe, 'cafe')).toHaveLength(1);
  });

  it('doesn’t take letters scattered across a title for a word', () => {
    expect(titles(rankCommands(commands, 'xyz'))).toEqual([]);
    expect(titles(rankCommands(commands, 'fts'))).not.toContain('Follow cleanup');
  });

  it('breaks a tie with what was used most recently', () => {
    const tied = [
      { id: 'a', group: 'Tools', title: 'Alpha one' },
      { id: 'b', group: 'Tools', title: 'Alpha two' },
    ];
    expect(titles(rankCommands(tied, 'alpha'))).toEqual(['Alpha one', 'Alpha two']);
    expect(titles(rankCommands(tied, 'alpha', { recent: ['b'] }))).toEqual(['Alpha two', 'Alpha one']);
  });
});

describe('paletteGroups', () => {
  const commands = buildCommands(context());

  it('lists every group in order when nothing is typed', () => {
    const groups = paletteGroups(commands, '');
    expect(groups.map((g) => g.group)).toEqual(COMMAND_GROUPS);
    expect(groups.flatMap((g) => g.items)).toHaveLength(commands.length);
  });

  it('puts what was used recently first, once', () => {
    const groups = paletteGroups(commands, '', { recent: ['theme:dark', 'go:/reports/followers', 'gone:command'] });
    expect(groups[0].group).toBe(RECENT_GROUP);
    expect(titles(groups[0].items)).toEqual(['Dark theme', 'Followers']);
    const all = groups.flatMap((g) => g.items.map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(commands.length);
    const many = paletteGroups(commands, '', { recent: commands.slice(0, 8).map((c) => c.id) });
    expect(many[0].items).toHaveLength(4);
  });

  it('groups the matches of a query, the best match’s group first', () => {
    const groups = paletteGroups(commands, 'follow', { recent: ['theme:dark'] });
    expect(groups.map((g) => g.group)).toEqual(['Reports', 'Tools']);
    expect(titles(groups[0].items)).toEqual(['Followers']);
    // Titles first; a tool that only mentions follows in its description comes after.
    expect(titles(groups[1].items).slice(0, 3)).toEqual(['Follow cleanup', 'Follow-back queue', 'Unfollow tracker']);
    expect(paletteGroups(commands, 'zzzz')).toEqual([]);
  });
});

describe('recent commands', () => {
  it('keeps the newest first, each once, and only so many', () => {
    expect(rememberRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(rememberRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(rememberRecent(null, 'a')).toEqual(['a']);
    const long = Array.from({ length: 20 }, (_, i) => `c${i}`);
    expect(rememberRecent(long, 'new')).toHaveLength(MAX_RECENT);
    expect(rememberRecent(long, 'new')[0]).toBe('new');
  });

  it('reads back what it stored, and nothing from a broken entry', () => {
    expect(parseRecent(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseRecent(JSON.stringify(['a', 3, null]))).toEqual(['a']);
    expect(parseRecent(null)).toEqual([]);
  });
});

describe('moving through the list', () => {
  it('wraps with the arrows and jumps with Home and End', () => {
    expect(moveActive('ArrowDown', 0, 3)).toBe(1);
    expect(moveActive('ArrowDown', 2, 3)).toBe(0);
    expect(moveActive('ArrowUp', 0, 3)).toBe(2);
    expect(moveActive('ArrowUp', 2, 3)).toBe(1);
    expect(moveActive('Home', 2, 3)).toBe(0);
    expect(moveActive('End', 0, 3)).toBe(2);
    expect(moveActive('ArrowDown', -1, 3)).toBe(0);
  });

  it('leaves other keys, and an empty list, alone', () => {
    expect(moveActive('a', 0, 3)).toBe(null);
    expect(moveActive('Enter', 0, 3)).toBe(null);
    expect(moveActive('ArrowDown', 0, 0)).toBe(null);
  });
});
