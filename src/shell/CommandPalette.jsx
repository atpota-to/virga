// The command palette: one field that goes to any page and does the few
// things done from everywhere (a new post, a sync, the period, the sky,
// another account). ⌘K opens it, or Ctrl K off a Mac; the sidebar's "Search
// or jump to" and the phone's app bar open it too.
//
// The list and the matching are in commands.js. This is the dialog around
// them, as a combobox over a listbox: focus stays in the field, the arrows
// (and Home and End) move the highlighted option, Enter runs it, Escape
// closes, and focus goes back where it was.

import { useEffect, useId, useMemo, useState } from 'react';
import { BarChart3, CalendarRange, Check, Clock, LayoutDashboard, Moon, Plus, RefreshCw, Search, Send, Settings, SlidersHorizontal, SquarePen, Sun, Sunrise, Sunset, Wrench } from 'lucide-react';
import { useAccountActions } from '../accounts/AccountMenu.jsx';
import { isBuilt, useArchive } from '../archive/ArchiveContext.jsx';
import Avatar from '../components/Avatar.jsx';
import Dialog from '../components/Dialog.jsx';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import { ANALYTICS_PERIODS } from '../lib/analytics.js';
import { fmtInt } from '../lib/locale.js';
import { periodPhrase } from '../lib/periods.js';
import { usePreferences } from '../lib/preferences.jsx';
import { navigate } from '../lib/router.jsx';
import { useComposer } from '../posting/composer/ComposerContext.jsx';
import { POSTING_PAGES } from '../posting/routes.js';
import { DEFENSE_ICON, DEFENSE_PAGES } from '../defense/routes.js';
import { REPORTS } from '../reports/registry.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { SECTIONS as SETTINGS_SECTIONS } from '../settings/sections.js';
import { TOOLS } from '../tools/registry.js';
import { usePeriod, useToast } from './bits.jsx';
import { buildCommands, moveActive, paletteGroups, parseRecent, rememberRecent } from './commands.js';
import './commandPalette.css';

export const PALETTE_RECENT_KEY = 'virga:palette-recent';

function readRecent() {
  try {
    return parseRecent(localStorage.getItem(PALETTE_RECENT_KEY));
  } catch {
    return [];
  }
}

function writeRecent(list) {
  try {
    localStorage.setItem(PALETTE_RECENT_KEY, JSON.stringify(list));
  } catch {
    // Remembered for this visit only, then.
  }
}

// A command without an icon of its own (the registries give most) gets its
// kind's.
const ACTION_ICONS = { newPost: SquarePen, sync: RefreshCw, customize: SlidersHorizontal, newDashboard: Plus, period: CalendarRange };
const SKY_ICONS = { clock: Clock, dawn: Sunrise, day: Sun, dusk: Sunset, night: Moon };
const GROUP_ICONS = { Dashboards: LayoutDashboard, Reports: BarChart3, Tools: Wrench, Settings, Posting: Send, Defense: DEFENSE_ICON };

function CommandIcon({ command, accounts }) {
  if (command.do === 'switchAccount') {
    const account = accounts.find((a) => a.did === command.arg);
    return (
      <span className="palette-option-icon" aria-hidden="true">
        <Avatar src={account?.avatar} name={account?.displayName || account?.handle || ''} size="sm" />
      </span>
    );
  }
  const Icon = command.icon || (command.do === 'sky' ? SKY_ICONS[command.arg] : ACTION_ICONS[command.do]) || GROUP_ICONS[command.group] || Search;
  return (
    <span className="palette-option-icon" aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

/**
 * `route` is the page the shell is on (with the dashboard it resolved),
 * `onNewDashboard` and `onCustomize` are the shell's own.
 */
export default function CommandPalette({ open, onClose, route, onNewDashboard, onCustomize }) {
  const archive = useArchive();
  const composer = useComposer();
  const { dashboards } = useDashboards();
  const { sky, setPref } = usePreferences();
  const [period, setPeriod] = usePeriod();
  const { did, accounts } = useAtprotoSession();
  const accountActions = useAccountActions();
  const toast = useToast();
  const listId = useId();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState([]);

  // Each opening starts empty, with what was used last read afresh (another
  // tab may have used the palette since).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setRecent(readRecent());
  }, [open]);

  const pm = archive.meta?.posts;
  const syncing = Boolean(archive.sync);
  const built = isBuilt(archive);
  const commands = useMemo(
    () =>
      open
        ? buildCommands({
            dashboards,
            reports: REPORTS,
            tools: TOOLS,
            postingPages: POSTING_PAGES,
            defensePages: DEFENSE_PAGES,
            settingsSections: SETTINGS_SECTIONS,
            accounts,
            activeDid: did,
            periods: ANALYTICS_PERIODS,
            period: period.key,
            sky,
            route,
            archive: { built: Boolean(pm), complete: pm ? Boolean(pm.complete) : undefined, syncing },
          })
        : [],
    // The route is a fresh object each render; its two parts are what count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, dashboards, accounts, did, period.key, sky, route.section, route.dashboard, pm, syncing],
  );
  const groups = useMemo(() => paletteGroups(commands, query, { recent }), [commands, query, recent]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = Math.min(active, flat.length - 1);
  const optionId = (index) => `${listId}-o${index}`;

  useEffect(() => {
    if (open && current >= 0) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current, groups]);

  function run(command) {
    if (!command) return;
    const next = rememberRecent(recent, command.id);
    setRecent(next);
    writeRecent(next);
    // Closed first, so focus is back where it was before anything else opens.
    onClose?.();
    if (command.go) {
      navigate(command.go);
      return;
    }
    switch (command.do) {
      case 'newPost':
        composer.open({});
        break;
      case 'sync':
        if (!syncing) archive.runSync(!pm ? 'full' : pm.complete ? 'incremental' : 'resume');
        break;
      case 'customize':
        onCustomize?.();
        break;
      case 'newDashboard':
        onNewDashboard?.();
        break;
      case 'period': {
        setPeriod(command.arg);
        const chosen = ANALYTICS_PERIODS.find((p) => p.key === command.arg);
        // Off the dashboards nothing on screen changes, so it says so.
        if (chosen) toast?.(built ? `Charts now show ${periodPhrase(chosen)}.` : `Charts will show ${periodPhrase(chosen)}.`);
        break;
      }
      case 'sky':
        setPref('sky', command.arg);
        break;
      case 'switchAccount': {
        const account = accounts.find((a) => a.did === command.arg);
        if (account) accountActions.open(account);
        break;
      }
      default:
        break;
    }
  }

  function onKeyDown(e) {
    if (e.nativeEvent?.isComposing) return;
    const to = moveActive(e.key, current, flat.length);
    if (to != null) {
      e.preventDefault();
      setActive(to);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      run(flat[current]);
    }
  }

  const searching = query.trim().length > 0;
  let index = -1;

  return (
    <Dialog open={open} onClose={onClose} title="Search or jump to" className="palette-dialog">
      <div className="palette" data-query={query ? 'some' : 'none'}>
        <div className="search palette-search">
          <Search aria-hidden="true" />
          <input
            className="input input--lg"
            type="text"
            role="combobox"
            aria-label="Search pages and commands"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            placeholder="A page, a report, a tool, a setting…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            data-autofocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <span className="visually-hidden" role="status">
          {searching ? (flat.length === 1 ? '1 result' : `${fmtInt(flat.length)} results`) : ''}
        </span>

        <div id={listId} className="palette-list" role="listbox" aria-label="Pages and commands" tabIndex={-1}>
          {groups.map((group) => {
            const headId = `${listId}-g-${group.group}`;
            return (
              <div key={group.group} className="palette-group" role="group" aria-labelledby={headId}>
                <div id={headId} className="palette-group-head" role="presentation">
                  {group.group}
                </div>
                {group.items.map((command) => {
                  index += 1;
                  const at = index;
                  return (
                    <div
                      key={command.id}
                      id={optionId(at)}
                      className="palette-option"
                      role="option"
                      aria-selected={at === current}
                      onMouseMove={() => at !== current && setActive(at)}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => run(command)}
                    >
                      <CommandIcon command={command} accounts={accounts} />
                      <span className="palette-option-text">
                        <span className="palette-option-title">{command.title}</span>
                        {command.hint && <span className="palette-option-hint">{command.hint}</span>}
                      </span>
                      {command.current && (
                        <span className="palette-option-mark">
                          <Check size={15} aria-hidden="true" />
                          <span className="visually-hidden">, in use</span>
                        </span>
                      )}
                      {command.shortcut && <kbd className="kbd">{command.shortcut}</kbd>}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {flat.length === 0 && <p className="palette-empty">Nothing matches “{query.trim()}”.</p>}
        </div>

        <p className="palette-foot" aria-hidden="true">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to go
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> to close
          </span>
        </p>
      </div>
    </Dialog>
  );
}
