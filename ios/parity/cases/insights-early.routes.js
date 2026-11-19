// Which page an address names: the shell's sections, the posting pages and
// Defense's, with the tables the sidebar, the tab bar and the palette list
// them from (word for word, every page). Swift:
// VirgaInsights/Shell/ShellRoutes.swift, Posting/PostingRoutes.swift and
// Defense/DefenseRoutes.swift.

import {
  SECTION_TITLE,
  needsArchive,
  opensBeforeArchive,
  parentOf,
  parseRoute,
  postingTitle,
} from '../../../src/shell/routes.js';
import {
  POSTING_BASE,
  POSTING_PAGES,
  POSTING_PAGE_BY_KEY,
  parsePostingRoute,
  postingPath,
} from '../../../src/posting/routes.js';
import {
  DEFENSE_BASE,
  DEFENSE_ICON,
  DEFENSE_PAGES,
  DEFENSE_PAGE_BY_KEY,
  parseDefenseRoute,
} from '../../../src/defense/routes.js';
import { each, value } from './_helpers.js';
import { iconName, withIconNames } from './_insights.js';

export const sources = [
  'src/shell/routes.js',
  'src/posting/routes.js',
  'src/defense/routes.js',
];

// Every address the web's tests use, and more: each section with and
// without a page, too many parts, case, empty parts, percent-encoding that
// decodes to a known page (or to a slash), malformed escapes (which throw,
// as pathParts does), and text that isn't ASCII.
const PATHS = [
  '/',
  '',
  null,
  '//',
  '/dashboard',
  '/dashboard/',
  '/dashboard/abc',
  '/dashboard/abc/extra',
  '/dashboard/my%20board',
  '/dashboard/%F0%9F%91%8D',
  '/dashboard/%2F',
  '/dashboard/overview?x=1',
  '/reports',
  '/reports/followers',
  '/reports/followers/',
  '/reports/followers/more',
  '//reports//followers//',
  '/reports/%66ollowers',
  '/tools',
  '/tools/best-time',
  '/tools/archive',
  '/settings',
  '/settings/posting',
  '/settings/appearance',
  '/posting',
  '/posting/',
  '/posting/hub',
  '/posting/drafts',
  '/posting/drafts/',
  '/posting/drafts/xyz',
  '/posting/drafts/3lbx2',
  '/posting/drafts/a/b',
  '/posting/drafts/a%2Fb',
  '/posting/%64rafts',
  '/posting/scheduled',
  '/posting/scheduled/abc',
  '/posting/schedule',
  '/posting/timers',
  '/posting/posted',
  '/posting/templates',
  '/posting/library',
  '/posting/compose',
  '/posting/compose/',
  '/posting/compose/extra',
  '/posting/nothing',
  '/posting/Drafts',
  '/posting/drafts/caf%C3%A9',
  '/POSTING',
  '/intent',
  '/intent/compose',
  '/intent/compose/',
  '/intent/compose/x',
  '/intent/other',
  '/intent/Compose',
  '/defense',
  '/defense/',
  '/defense/scan',
  '/defense/lists',
  '/defense/history',
  '/defense/lists/x',
  '/defense/shield',
  '/defense/%6Cists',
  '/nowhere',
  '/nowhere/at/all',
  'reports',
  'reports/followers',
  'posting/drafts',
  '/%',
  '/bad/%',
  '/reports/%zz',
  '/posting/%C3%28',
  '/dashboard/%E0%A4%A',
  '/emoji/👍🏽',
  '/dashboard/日本',
  '/settings/́',
  '/a/́b',
];

const ROUTES_BY_HAND = [
  { section: 'tools', page: '' },
  { section: 'tools', page: 'unknown-tool' },
  { section: 'reports' },
  { section: 'posting' },
  { section: 'posting', page: 'schedule', id: 'x' },
  { section: 'posting', page: 'hub', id: null },
  { section: 'posting', page: 'nothing', id: null },
  { section: 'posting', page: 'compose', id: null },
  { section: 'defense', page: 'shield' },
  { section: 'intent', page: 'other' },
  { section: 'settings', page: '' },
  { section: 'missing', page: 'x' },
  { section: 'dashboard', dashboard: 'abc', page: 'x' },
];

function parsedRoutes() {
  const seen = new Map();
  for (const path of PATHS) {
    let route;
    try {
      route = parseRoute(path);
    } catch {
      continue;
    }
    const key = JSON.stringify(route);
    if (!seen.has(key)) seen.set(key, route);
  }
  return [...seen.values(), ...ROUTES_BY_HAND];
}

const POSTING_KEYS = [
  'hub',
  'drafts',
  'scheduled',
  'schedule',
  'timers',
  'posted',
  'templates',
  'library',
  'compose',
  'nothing',
  '',
  null,
  'Drafts',
];

const POSTING_ROUTE_INPUTS = [
  ...PATHS.filter((p) => p === null || typeof p === 'string'),
  '/tools',
  ['posting'],
  ['posting', 'scheduled', 'abc'],
  ['posting', 'drafts'],
  ['posting', 'drafts', 'a', 'b'],
  ['posting', 'compose'],
  ['posting', 'compose', 'x'],
  ['posting', ''],
  ['posting', '', 'x'],
  ['posting', 'hub'],
  ['posting', 'timers', ''],
  ['tools', 'drafts'],
  [],
];

const DEFENSE_PARTS = [
  ['defense'],
  ['defense', 'lists'],
  ['defense', 'history'],
  ['defense', 'scan'],
  ['defense', 'shield'],
  ['defense', 'lists', 'x'],
  ['defense', 'Lists'],
  ['defense', ''],
  ['posting'],
  ['Defense'],
  [],
];

export default async function cases() {
  const routes = parsedRoutes();
  return [
    value('SECTION_TITLE', SECTION_TITLE),
    value('POSTING_BASE', POSTING_BASE),
    value('POSTING_PAGES', withIconNames(POSTING_PAGES)),
    value('POSTING_PAGE_BY_KEY', withIconNames(POSTING_PAGE_BY_KEY)),
    value('DEFENSE_BASE', DEFENSE_BASE),
    value('DEFENSE_ICON', iconName(DEFENSE_ICON)),
    value('DEFENSE_PAGES', withIconNames(DEFENSE_PAGES)),
    value('DEFENSE_PAGE_BY_KEY', withIconNames(DEFENSE_PAGE_BY_KEY)),

    ...(await each(
      'parseRoute',
      PATHS.map((path) => ({ path })),
      ({ path }) => parseRoute(path),
    )),
    ...(await each(
      'needsArchive',
      routes.map((route) => ({ route })),
      ({ route }) => needsArchive(route),
    )),
    ...(await each(
      'opensBeforeArchive',
      routes.map((route) => ({ route })),
      ({ route }) => opensBeforeArchive(route),
    )),
    ...(await each(
      'parentOf',
      [...routes, null].map((route) => ({ route })),
      ({ route }) => parentOf(route),
    )),
    ...(await each(
      'postingTitle',
      routes.map((route) => ({ route })),
      ({ route }) => postingTitle(route),
    )),

    ...(await each(
      'postingPath',
      POSTING_KEYS.map((key) => ({ key })),
      ({ key }) => postingPath(key),
    )),
    ...(await each(
      'parsePostingRoute',
      POSTING_ROUTE_INPUTS.map((path) => ({ path })),
      ({ path }) => parsePostingRoute(path),
    )),
    ...(await each(
      'parseDefenseRoute',
      DEFENSE_PARTS.map((parts) => ({ parts })),
      ({ parts }) => parseDefenseRoute(parts),
    )),
  ];
}
