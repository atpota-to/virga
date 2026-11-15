// The command palette's list, without anything React needs: what there is
// to go to or do right now, and which of it a few typed letters mean.
// CommandPalette.jsx draws it and carries a command out; commands.test.js
// pins it.
//
// The list is built from the app's own registries each time it opens (the
// reports, the tools, the posting pages, the settings sections, the
// account's dashboards), so a page added to one of them is in the palette
// without a change here. A command says what to do as data: `{ go: path }`
// or `{ do: name, arg }`.

/** The groups, in the order an empty palette lists them. */
export const COMMAND_GROUPS = Object.freeze(['Actions', 'Dashboards', 'Reports', 'Posting', 'Tools', 'Settings', 'Period', 'Theme', 'Accounts']);

/** What the palette calls what was used last. */
export const RECENT_GROUP = 'Recent';
export const MAX_RECENT = 8;
const SHOWN_RECENT = 4;

const THEMES = Object.freeze([
  { value: 'light', title: 'Light theme' },
  { value: 'dark', title: 'Dark theme' },
  { value: 'system', title: 'Match the system theme' },
]);

/** "Last 7 days", "Last year", "All time": a period as a command. */
export function periodTitle(period) {
  if (!period?.days) return 'All time';
  return period.key === '1y' ? 'Last year' : `Last ${String(period.label || '').toLowerCase()}`;
}

function accountTitle(account) {
  return account.displayName || (account.handle ? `@${account.handle}` : account.did);
}

/**
 * Every command there is right now, in the order an empty palette lists
 * them. Each is `{ id, group, title, hint?, keywords?, icon?, shortcut?,
 * current?, go? | do?, arg? }`; `id` is stable, so it can be remembered.
 *
 * @param {object} context
 * @param {Array<{ id: string, name: string }>} [context.dashboards]
 * @param {Array<{ key: string, label: string, icon?: any, desc?: string }>} [context.reports]
 * @param {Array<{ key: string, name: string, icon?: any, desc?: string, planned?: boolean }>} [context.tools]
 * @param {Array<{ key: string, path: string, label: string, icon?: any, desc?: string }>} [context.postingPages]
 * @param {Array<{ key: string, label: string }>} [context.settingsSections]
 * @param {Array<{ did: string, handle?: string, displayName?: string, status?: string }>} [context.accounts]
 * @param {string} [context.activeDid]
 * @param {Array<{ key: string, days: number | null, label: string }>} [context.periods]
 * @param {string} [context.period] - the key of the period in use
 * @param {'system'|'light'|'dark'} [context.theme]
 * @param {{ section?: string, dashboard?: string | null }} [context.route]
 * @param {{ built?: boolean, complete?: boolean, syncing?: boolean }} [context.archive]
 */
export function buildCommands(context = {}) {
  const { dashboards = [], reports = [], tools = [], postingPages = [], settingsSections = [], accounts = [], activeDid = null, periods = [], period = null, theme = null, route = {}, archive = {} } = context;
  const out = [];
  const add = (command) => out.push(command);

  add({ id: 'do:new-post', group: 'Actions', title: 'New post', keywords: 'write compose thread', shortcut: 'N', do: 'newPost' });
  if (!archive.syncing) {
    add({
      id: 'do:sync',
      group: 'Actions',
      title: !archive.built ? 'Build your archive' : archive.complete === false ? 'Resume the build' : 'Sync now',
      keywords: 'sync refresh update archive fetch',
      do: 'sync',
    });
  }
  const onDashboard = route.section === 'dashboard' && dashboards.some((d) => d.id === route.dashboard);
  if (onDashboard) {
    add({ id: 'do:customize', group: 'Actions', title: 'Customize this dashboard', keywords: 'edit arrange cards add remove', do: 'customize' });
  }
  add({ id: 'do:new-dashboard', group: 'Actions', title: 'New dashboard', keywords: 'create add', do: 'newDashboard' });

  for (const d of dashboards) {
    add({ id: `go:/dashboard/${d.id}`, group: 'Dashboards', title: d.name, go: `/dashboard/${d.id}`, current: onDashboard && route.dashboard === d.id });
  }

  for (const r of reports) {
    add({ id: `go:/reports/${r.key}`, group: 'Reports', title: r.label, hint: r.desc, icon: r.icon, go: `/reports/${r.key}` });
  }
  if (reports.length) add({ id: 'go:/reports', group: 'Reports', title: 'All reports', go: '/reports' });

  for (const p of postingPages) {
    add({ id: `go:${p.path}`, group: 'Posting', title: p.label, hint: p.desc, icon: p.icon, keywords: p.title, go: p.path });
  }

  const live = tools.filter((t) => !t.planned);
  for (const t of live) {
    add({ id: `go:/tools/${t.key}`, group: 'Tools', title: t.name, hint: t.desc, icon: t.icon, go: `/tools/${t.key}` });
  }
  if (live.length) add({ id: 'go:/tools', group: 'Tools', title: 'All tools', go: '/tools' });

  for (const s of settingsSections) {
    add({ id: `go:/settings/${s.key}`, group: 'Settings', title: s.label, keywords: 'settings preferences', go: `/settings/${s.key}` });
  }

  for (const p of periods) {
    add({ id: `period:${p.key}`, group: 'Period', title: periodTitle(p), keywords: 'period range window charts show', do: 'period', arg: p.key, current: p.key === period });
  }

  for (const t of THEMES) {
    add({ id: `theme:${t.value}`, group: 'Theme', title: t.title, keywords: 'appearance mode colours colors', do: 'theme', arg: t.value, current: t.value === theme });
  }

  for (const a of accounts) {
    if (a.did === activeDid) continue;
    add({
      id: `account:${a.did}`,
      group: 'Accounts',
      title: `Switch to ${accountTitle(a)}`,
      hint: a.status === 'needsSignIn' ? 'Signed out. Opens the sign-in.' : a.handle && a.displayName ? `@${a.handle}` : undefined,
      keywords: `account ${a.handle || ''}`,
      do: 'switchAccount',
      arg: a.did,
    });
  }

  return out;
}

/* ---- matching ----------------------------------------------------------- */

/** Lower case, accents and apostrophes flattened, so "cafe" finds "Café". */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[‘’']/g, '')
    .toLowerCase();
}

const wordsOf = (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The letters of `needle` in order somewhere in `hay`, the closer together
// the better: 0 when they aren't all there.
function scattered(needle, hay) {
  let at = -1;
  let gaps = 0;
  for (const ch of needle) {
    const next = hay.indexOf(ch, at + 1);
    if (next === -1) return 0;
    if (at !== -1) gaps += next - at - 1;
    at = next;
  }
  // Spread right across the title, they are letters, not the word.
  return gaps > needle.length * 2 ? 0 : Math.max(1, 20 - gaps);
}

/**
 * How well one typed word fits a command, 0 for not at all: the start of
 * its title, then the start of a word in it, then anywhere in it, then its
 * group, keywords and hint, then (for three letters or more) the letters in
 * order with others between, which forgives a missed or swapped-out key.
 */
function wordScore(word, command) {
  const title = fold(command.title);
  if (title.startsWith(word)) return 100;
  const titleWords = wordsOf(command.title);
  if (titleWords.some((w) => w.startsWith(word))) return 80;
  if (title.includes(word)) return 60;
  if (wordsOf(command.group).some((w) => w.startsWith(word))) return 50;
  if (wordsOf(command.keywords).some((w) => w.startsWith(word))) return 45;
  if (wordsOf(command.hint).some((w) => w.startsWith(word))) return 25;
  if (word.length >= 3) return scattered(word, titleWords.join(''));
  return 0;
}

/**
 * The commands a query means, best first. Every typed word has to fit;
 * among equals, what was used most recently comes first, then the list's
 * own order. An empty query gives the whole list as it is.
 *
 * @param {object[]} commands - from buildCommands
 * @param {string} query
 * @param {{ recent?: string[] }} [options] - ids, most recent first
 */
export function rankCommands(commands, query, { recent = [] } = {}) {
  const list = Array.isArray(commands) ? commands : [];
  const typed = wordsOf(query);
  if (typed.length === 0) return list.slice();
  const recency = (id) => {
    const at = recent.indexOf(id);
    return at === -1 ? Infinity : at;
  };
  return list
    .map((command, order) => {
      let score = 0;
      for (const word of typed) {
        const s = wordScore(word, command);
        if (!s) return null;
        score += s;
      }
      return { command, score, order };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || recency(a.command.id) - recency(b.command.id) || a.order - b.order)
    .map((entry) => entry.command);
}

/**
 * What the palette lists, as `[{ group, items }]`. With nothing typed: what
 * was used most recently under "Recent", then every other command under its
 * group. With a query: the matches, the group of the best match first and
 * each group's own matches best first.
 */
export function paletteGroups(commands, query, { recent = [] } = {}) {
  const ranked = rankCommands(commands, query, { recent });
  const groups = [];
  const into = (name, command) => {
    let group = groups.find((g) => g.group === name);
    if (!group) groups.push((group = { group: name, items: [] }));
    group.items.push(command);
  };
  const searching = wordsOf(query).length > 0;
  const shown = new Set();
  if (!searching) {
    for (const id of recent) {
      const command = ranked.find((c) => c.id === id);
      if (!command || shown.size >= SHOWN_RECENT) continue;
      shown.add(id);
      into(RECENT_GROUP, command);
    }
  }
  for (const command of ranked) if (!shown.has(command.id)) into(command.group, command);
  return groups;
}

/* ---- what was used last ------------------------------------------------- */

/** `recent` with `id` at its front, once, and no longer than it is useful. */
export function rememberRecent(recent, id) {
  const list = (Array.isArray(recent) ? recent : []).filter((x) => typeof x === 'string' && x !== id);
  return id ? [id, ...list].slice(0, MAX_RECENT) : list.slice(0, MAX_RECENT);
}

/** The stored list of recent command ids, or none if it can't be read. */
export function parseRecent(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/* ---- moving through the list -------------------------------------------- */

/**
 * The option a key moves to, as an index into the flat list of `count`
 * options, or null when the key isn't one that moves: the arrows wrap, Home
 * and End go to the ends.
 */
export function moveActive(key, index, count) {
  if (count <= 0) return null;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index <= 0 ? count - 1 : index - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
