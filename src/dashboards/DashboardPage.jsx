// A dashboard: its cards on a twelve-column grid, answering for the period
// in the header unless a card has been given one of its own. On the page a
// card has no edge: it is a figure under a rule, a chart under its title, or
// a list under a rule in ink.
//
// Customize turns the cards into things to arrange. Each gets a dashed
// outline and a handle; the one you point at, press or tab into is the
// chosen one, and shows its tools: a size (a quarter, a third, half, two
// thirds or the whole row), its settings (a title, its own period, one kind
// of engagement, how many rows), the arrows that move it from the keyboard
// or a phone, and Remove. Reports come in from the library beside the grid,
// by their plus or by being dragged to where they should go. Changes are
// saved as they're made.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  GripVertical,
  ImageUp,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import Menu from '../components/Menu.jsx';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { ANALYTICS_PERIODS } from '../lib/analytics.js';
import { periodLine, periodWindowWord, presetPeriod } from '../lib/periods.js';
import { Link, navigate } from '../lib/router.jsx';
import { PageHeader, PeriodPicker, useIsNarrow, usePeriod, useToast } from '../shell/bits.jsx';
import ShareDialog from '../share/ShareDialog.jsx';
import { canShare } from '../share/shareSpec.js';
import NewDashboardDialog from './NewDashboardDialog.jsx';
import { CATEGORIES, WIDGETS, WIDGET_LIST } from './catalog.js';
import { useDashboards } from './DashboardsContext.jsx';
import { CARD_KINDS, CARD_ROWS, CARD_TITLE_MAX, SIZES } from './layouts.js';
import { KIND_NOUN, WIDGET_COMPONENTS } from './widgets/index.jsx';
import './dashboards.css';

export default function DashboardPage({ dashboard }) {
  const archive = useArchive();
  const actions = useDashboards();
  const [period] = usePeriod();
  const toast = useToast();
  const narrow = useIsNarrow();
  const [editing, setEditing] = useState(() => new URLSearchParams(window.location.search).get('edit') === '1');
  const [dialog, setDialog] = useState(null); // 'rename' | 'delete' | 'new'
  const [dragId, setDragId] = useState(null);
  const [dragType, setDragType] = useState(null); // a report being dragged in from the library
  const [dropIndex, setDropIndex] = useState(null);
  const [chosen, setChosen] = useState(null); // the card whose tools are out, while customizing
  const [justAdded, setJustAdded] = useState(null);
  const [settingsFor, setSettingsFor] = useState(null); // the id of the card whose settings are open
  const [share, setShare] = useState(null); // the card being made into a picture: { type, options, period }

  // Arriving with ?edit=1 (a dashboard just made empty) opens it for editing;
  // the flag then leaves the address so a reload doesn't reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1') {
      params.delete('edit');
      const q = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
    }
  }, []);

  // Another dashboard, another arrangement: stop editing the last one.
  const lastId = useRef(dashboard.id);
  useEffect(() => {
    if (lastId.current !== dashboard.id) {
      lastId.current = dashboard.id;
      setEditing(false);
      setChosen(null);
    }
  }, [dashboard.id]);

  const widgets = dashboard.widgets;
  const id = dashboard.id;
  const nowMs = archive.nowMs;

  function addReport(type, index = null) {
    actions.addWidget(id, type, index);
    setJustAdded(type);
    toast?.(`${WIDGETS[type].name} added to ${dashboard.name}.`);
  }

  // The newest card scrolls into view once it is drawn.
  useEffect(() => {
    if (!justAdded) return;
    const cards = document.querySelectorAll(`[data-widget-type="${justAdded}"]`);
    cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setJustAdded(null);
  }, [justAdded, widgets.length]);

  const dragging = dragId != null || dragType != null;
  const endDrag = () => {
    setDragId(null);
    setDragType(null);
    setDropIndex(null);
  };
  // A card let go of moves to where the mark is; a report from the library
  // is added there (or at the end, let go of anywhere else on the grid).
  const onDrop = () => {
    if (dragId != null && dropIndex != null) {
      const from = widgets.findIndex((w) => w.id === dragId);
      actions.moveWidget(id, dragId, dropIndex > from ? dropIndex - 1 : dropIndex);
    } else if (dragType != null) {
      addReport(dragType, dropIndex);
    }
    endDrag();
  };

  return (
    // A wrapper only so the header and the grid share one width: while
    // customizing, the page takes more of the screen for the library.
    <div className="dash-page" data-editing={editing || undefined}>
      <PageHeader
        crumbs={[{ label: 'Dashboards' }]}
        title={
          editing ? (
            <span className="dash-title">
              {dashboard.name}
              <Button variant="ghost" size="sm" icon aria-label="Rename this dashboard" title="Rename" onClick={() => setDialog('rename')}>
                <Pencil size={15} aria-hidden="true" />
              </Button>
            </span>
          ) : (
            dashboard.name
          )
        }
        sub={
          editing
            ? `Customizing. ${
                narrow
                  ? 'Press a card to move it with its arrows, give it a size or remove it, and add reports from the library below.'
                  : 'Drag a card by its handle, give it a size, or bring one in from the library.'
              } Changes save as you go.`
            : periodLine(period, nowMs)
        }
        actions={
          editing ? (
            <Button
              variant="primary"
              aria-pressed="true"
              onClick={() => {
                setEditing(false);
                setChosen(null);
              }}
            >
              <Check size={15} aria-hidden="true" />
              Done
            </Button>
          ) : (
            <>
              <PeriodPicker />
              <Button variant="text" className="dash-customize" aria-pressed="false" onClick={() => setEditing(true)}>
                Customize
              </Button>
              <Menu
                label="Dashboard options"
                icon
                size="md"
                variant="ghost"
                items={[
                  { icon: Pencil, label: 'Rename', onSelect: () => setDialog('rename') },
                  {
                    icon: Copy,
                    label: 'Duplicate',
                    onSelect: () => {
                      const copy = actions.duplicateDashboard(id);
                      if (copy) navigate(`/dashboard/${copy}`);
                    },
                  },
                  { icon: Plus, label: 'New dashboard', onSelect: () => setDialog('new') },
                  { separator: true },
                  {
                    icon: RotateCcw,
                    label: dashboard.template ? 'Reset to the original reports' : 'Clear every report',
                    onSelect: () => {
                      actions.resetDashboard(id);
                      toast?.(`${dashboard.name} is back to how it started.`);
                    },
                  },
                  actions.dashboards.length > 1 && { icon: Trash2, label: 'Delete dashboard', tone: 'danger', onSelect: () => setDialog('delete') },
                ]}
              >
                <Ellipsis size={18} aria-hidden="true" />
              </Menu>
            </>
          )
        }
      />

      <div className="dash-wrap" data-editing={editing || undefined}>
        {/* The grid's own box is a container: how many cards sit side by
            side goes by the room the grid has, not by the screen. */}
        <div className="dash-grid-box">
          <div
            className="dash-grid"
            data-dragging={dragging || undefined}
            onDragOver={(e) => {
              if (dragging) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop();
            }}
          >
            {widgets.length === 0 && (
              <div className="dash-empty" data-drop={dragType != null || undefined}>
                <h2 className="card-title">This dashboard is empty</h2>
                <p className="card-sub">
                  {editing ? 'Bring in the reports you want to see each time you open it, from the library.' : 'Add the reports you want to see each time you open it.'}
                </p>
                {!editing && (
                  <div>
                    <Button variant="primary" onClick={() => setEditing(true)}>
                      <Plus size={15} aria-hidden="true" />
                      Add reports
                    </Button>
                  </div>
                )}
              </div>
            )}
            {widgets.map((w, index) => (
              <WidgetFrame
                key={w.id}
                card={w}
                index={index}
                count={widgets.length}
                editing={editing}
                chosen={editing && chosen === w.id}
                onChoose={() => setChosen(w.id)}
                archive={archive}
                period={period}
                nowMs={nowMs}
                dragging={dragId === w.id}
                dropBefore={dragging && dropIndex === index && dragId !== w.id}
                onDragStart={() => setDragId(w.id)}
                onDragEnd={endDrag}
                onDragOverCard={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientX > rect.left + rect.width / 2 || e.clientY > rect.top + rect.height * 0.75;
                  setDropIndex(after ? index + 1 : index);
                }}
                onMove={(to) => actions.moveWidget(id, w.id, to)}
                onResize={(size) => actions.resizeWidget(id, w.id, size)}
                onSettings={() => setSettingsFor(w.id)}
                onShare={(cardPeriod) => setShare({ type: w.type, options: w.options || {}, period: cardPeriod })}
                onRemove={() => {
                  actions.removeWidget(id, w.id);
                  toast?.(`${WIDGETS[w.type].name} removed.`);
                }}
              />
            ))}
            {editing && dragging && dropIndex === widgets.length && widgets.length > 0 && (
              <div className="drop-end" aria-hidden="true">
                {dragType != null ? `Let go to add ${WIDGETS[dragType].name} here` : 'Let go to move it to the end'}
              </div>
            )}
          </div>
        </div>

        {editing && <Library dashboard={dashboard} onAdd={addReport} onDragStart={setDragType} onDragEnd={endDrag} />}
      </div>

      <ShareDialog share={share} archive={archive} period={share?.period || period} nowMs={nowMs} onClose={() => setShare(null)} />
      <CardSettingsDialog
        card={widgets.find((w) => w.id === settingsFor) || null}
        onClose={() => setSettingsFor(null)}
        onSave={(card, options) => {
          actions.setWidgetOptions(id, card.id, card.type, options);
          setSettingsFor(null);
        }}
      />
      <RenameDialog
        open={dialog === 'rename'}
        name={dashboard.name}
        onClose={() => setDialog(null)}
        onSave={(name) => {
          actions.renameDashboard(id, name);
          setDialog(null);
        }}
      />
      <Dialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={`Delete ${dashboard.name}?`}
        actions={
          <>
            <Button onClick={() => setDialog(null)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={() => {
                const next = actions.dashboards.find((d) => d.id !== id);
                actions.deleteDashboard(id);
                setDialog(null);
                if (next) navigate(`/dashboard/${next.id}`, { replace: true });
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p>The dashboard and its arrangement go. The reports themselves, and your archive, stay.</p>
      </Dialog>
      <NewDashboardDialog
        open={dialog === 'new'}
        onClose={() => setDialog(null)}
        onCreate={(name, template) => {
          const newId = actions.addDashboard({ name, template });
          setDialog(null);
          if (newId) navigate(`/dashboard/${newId}${template ? '' : '?edit=1'}`);
        }}
      />
    </div>
  );
}

function WidgetFrame({
  card,
  index,
  count,
  editing,
  chosen,
  onChoose,
  archive,
  period,
  nowMs,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onMove,
  onResize,
  onSettings,
  onShare,
  onRemove,
}) {
  const def = WIDGETS[card.type];
  const Body = WIDGET_COMPONENTS[card.type];
  const [handleDown, setHandleDown] = useState(false);
  if (!def || !Body) return null;
  const isStat = def.kind === 'stat';
  // A card that takes a number of rows is a list: its heading gets the rule
  // in ink that is the top of its first row.
  const isList = !isStat && Boolean(def.options?.includes('rows'));
  const headingId = `w-${card.id}`;
  // The card's own settings: its title, a period that isn't the header's,
  // one kind of engagement, a number of rows.
  const options = card.options || {};
  const ownPeriod = options.period ? presetPeriod(options.period) : null;
  const name = options.title || def.name;
  return (
    <section
      className={`widget${isStat ? ' widget--stat' : ''}${isList ? ' widget--list' : ''}`}
      data-size={card.size}
      data-widget-type={card.type}
      data-editing={editing || undefined}
      data-chosen={chosen || undefined}
      data-dragging={dragging || undefined}
      data-drop-before={dropBefore || undefined}
      aria-labelledby={isStat ? undefined : headingId}
      aria-label={isStat ? name : undefined}
      draggable={editing && handleDown}
      // Pressing a card, or tabbing into it, chooses it: its tools come out.
      onPointerDown={editing ? onChoose : undefined}
      onFocus={editing ? onChoose : undefined}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.id);
        onDragStart();
      }}
      onDragEnd={() => {
        setHandleDown(false);
        onDragEnd();
      }}
      onDragOver={onDragOverCard}
    >
      {editing && (
        <div className="widget-edit">
          <button
            type="button"
            className="widget-grip"
            aria-label={`Drag to move ${def.name}`}
            title="Drag to move"
            onPointerDown={() => setHandleDown(true)}
            onPointerUp={() => setHandleDown(false)}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
          {/* The chosen card's tools. Pressing a card or tabbing onto its
              handle chooses it, so they are there by the next Tab. */}
          {chosen && (
            <div className="widget-edit-tools">
              {def.sizes.length > 1 && (
                <div className="size-keys" role="group" aria-label={`Size of ${def.name}`}>
                  {def.sizes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="size-key"
                      aria-pressed={card.size === s}
                      title={SIZES[s].name}
                      aria-label={SIZES[s].name}
                      onClick={() => onResize(s)}
                    >
                      {SIZES[s].label}
                    </button>
                  ))}
                </div>
              )}
              <span className="widget-edit-actions">
                {def.options?.length > 0 && (
                  <Button variant="ghost" size="sm" icon aria-label={`Settings for ${name}`} title="Card settings" onClick={onSettings}>
                    <Settings2 size={15} aria-hidden="true" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" icon aria-label={`Move ${def.name} earlier`} title="Move earlier" disabled={index === 0} onClick={() => onMove(index - 1)}>
                  <ChevronLeft size={15} aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" icon aria-label={`Move ${def.name} later`} title="Move later" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
                  <ChevronRight size={15} aria-hidden="true" />
                </Button>
              </span>
            </div>
          )}
          <Button variant="ghost" size="sm" icon className="widget-remove" aria-label={`Remove ${def.name}`} title="Remove" onClick={onRemove}>
            <X size={15} aria-hidden="true" />
          </Button>
        </div>
      )}
      {!isStat && (
        <header className="widget-head">
          <div className="widget-titles">
            <h2 id={headingId} className="widget-title">
              {name}
            </h2>
            <p className="widget-desc">{def.desc}</p>
            {(ownPeriod || options.kind) && (
              <p className="widget-own">
                {ownPeriod && (
                  <span className="badge badge--outline" title="This card keeps its own period">
                    {periodWindowWord(ownPeriod)}
                  </span>
                )}
                {options.kind && (
                  <span className="badge badge--outline" title="This card counts one kind of engagement">
                    {KIND_NOUN[options.kind]} only
                  </span>
                )}
              </p>
            )}
          </div>
          {!editing && (
            <span className="widget-open">
              {canShare(card.type) && (
                <Button variant="ghost" size="sm" icon aria-label={`Post ${name} as a picture`} title="Post this chart" onClick={() => onShare(ownPeriod || period)}>
                  <ImageUp size={15} aria-hidden="true" />
                </Button>
              )}
              {def.href && (
                <Link to={def.href} className="btn btn--ghost btn--sm btn--icon" aria-label={`Open the full ${def.name} report`} title="Open the full report">
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              )}
            </span>
          )}
        </header>
      )}
      <div className="widget-body">
        <Body
          archive={archive}
          period={ownPeriod || period}
          nowMs={nowMs}
          size={card.size}
          def={def}
          title={options.title || null}
          kind={options.kind || 'all'}
          rows={options.rows || null}
        />
      </div>
    </section>
  );
}

/**
 * Every report a dashboard can hold, as a ruled list beside the grid: search
 * it, narrow it to a kind, and bring a report in by its plus (it lands at the
 * end) or by dragging it to where it should go.
 */
function Library({ dashboard, onAdd, onDragStart, onDragEnd }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const onBoard = useMemo(() => {
    const m = new Map();
    for (const w of dashboard.widgets) m.set(w.type, (m.get(w.type) || 0) + 1);
    return m;
  }, [dashboard.widgets]);
  const q = query.trim().toLowerCase();
  const shown = WIDGET_LIST.filter(
    (w) => (category === 'all' || w.category === category) && (!q || w.name.toLowerCase().includes(q) || w.desc.toLowerCase().includes(q)),
  );
  return (
    <aside className="library" aria-labelledby="library-title">
      <div className="library-head">
        <h2 id="library-title" className="card-title">
          Report library
        </h2>
        <p className="card-sub num">
          {WIDGET_LIST.length} reports, {dashboard.widgets.length} of them on this dashboard. Drag one onto the grid, or press its plus.
        </p>
      </div>
      <label className="search">
        <Search aria-hidden="true" />
        <span className="visually-hidden">Search reports</span>
        <input className="input" type="search" placeholder="Search reports" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <Segmented
        className="library-cats"
        size="sm"
        label="Kind of report"
        value={category}
        onChange={setCategory}
        options={[{ value: 'all', label: 'All' }, ...CATEGORIES.map((c) => ({ value: c.key, label: c.label }))]}
      />
      <ul className="library-list">
        {shown.map((w) => {
          const Icon = w.icon;
          const n = onBoard.get(w.type) || 0;
          return (
            <li
              key={w.type}
              className="library-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', w.type);
                onDragStart(w.type);
              }}
              onDragEnd={onDragEnd}
            >
              <span className="library-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="library-text">
                <span className="library-name">
                  {w.name}
                  {w.kind === 'stat' && <span className="library-kind">Figure</span>}
                </span>
                <span className="library-desc">{w.desc}</span>
                {n > 0 && (
                  <span className="library-on">
                    <Check size={12} aria-hidden="true" />
                    On this dashboard{n > 1 ? ` ×${n}` : ''}
                  </span>
                )}
              </span>
              <Button size="sm" icon className="library-add" onClick={() => onAdd(w.type)} aria-label={`Add ${w.name}`} title={`Add ${w.name}`}>
                <Plus size={15} aria-hidden="true" />
              </Button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="empty">No report matches “{query}”.</li>}
      </ul>
    </aside>
  );
}

/**
 * A card's own settings, for the options its type takes. Nothing is saved
 * until Save; "Use the defaults" clears every one.
 */
function CardSettingsDialog({ card, onClose, onSave }) {
  const def = card ? WIDGETS[card.type] : null;
  const takes = def?.options || [];
  const [draft, setDraft] = useState({});
  useEffect(() => {
    if (card) setDraft({ title: '', period: '', kind: '', rows: '', ...card.options });
    // A different card, a different draft; edits in between are the draft's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id]);
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const hasAny = Boolean(card?.options && Object.keys(card.options).length);
  return (
    <Dialog
      open={Boolean(card)}
      onClose={onClose}
      title={def ? `${def.name} settings` : 'Card settings'}
      actions={
        <>
          {hasAny && (
            <Button variant="ghost" className="dialog-action-start" onClick={() => onSave(card, {})}>
              Use the defaults
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="card-settings-form">
            Save
          </Button>
        </>
      }
    >
      {def && (
        <form
          id="card-settings-form"
          className="dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(card, { ...draft, rows: draft.rows ? Number(draft.rows) : undefined });
          }}
        >
          {takes.includes('title') && (
            <label className="field">
              <span className="field-label">Title</span>
              <input className="input" value={draft.title || ''} maxLength={CARD_TITLE_MAX} placeholder={def.name} onChange={set('title')} data-autofocus />
              <span className="field-hint">Leave it empty to keep “{def.name}”.</span>
            </label>
          )}
          {takes.includes('period') && (
            <label className="field">
              <span className="field-label">Period</span>
              <select className="input" value={draft.period || ''} onChange={set('period')}>
                <option value="">The dashboard’s period</option>
                {ANALYTICS_PERIODS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {periodWindowWord(p)}
                  </option>
                ))}
              </select>
              <span className="field-hint">A card with its own period stays put when the period at the top changes, and says which it is.</span>
            </label>
          )}
          {takes.includes('kind') && (
            <label className="field">
              <span className="field-label">Engagement counted</span>
              <select className="input" value={draft.kind || ''} onChange={set('kind')}>
                <option value="">Likes, reposts, replies and quotes</option>
                {CARD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_NOUN[k]} only
                  </option>
                ))}
              </select>
            </label>
          )}
          {takes.includes('rows') && (
            <label className="field">
              <span className="field-label">Rows</span>
              <select className="input" value={draft.rows || ''} onChange={set('rows')}>
                <option value="">What fits the card’s size</option>
                {CARD_ROWS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </form>
      )}
    </Dialog>
  );
}

function RenameDialog({ open, name, onClose, onSave }) {
  const [value, setValue] = useState(name);
  useEffect(() => {
    if (open) setValue(name);
  }, [open, name]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename dashboard"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="rename-form">
            Save
          </Button>
        </>
      }
    >
      <form
        id="rename-form"
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSave(value);
        }}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
      </form>
    </Dialog>
  );
}
