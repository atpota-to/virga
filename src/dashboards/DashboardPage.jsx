// A dashboard: its cards on a twelve-column grid, answering for the period
// in the header unless a card has been given one of its own. On the page a
// card has no edge: it is a figure under a rule, a chart under its title, or
// a list under a rule in ink.
//
// Customize turns the cards into things to arrange. Each gets a dashed
// outline, with its handle, its title and Remove on one line; the one you
// point at, press or tab into is the chosen one, and its tools float over
// its top edge: a size (a quarter, a third, half, two thirds or the whole
// row), its settings (a title, its own period, one kind of engagement, how
// many rows), and the arrows that move it from the keyboard. Reports come in
// from the library beside the grid, by their plus or by being dragged to
// where they should go; where there's no room beside the grid, the library
// opens in a dialog. On a phone each card is a line to move up or down, and
// opens for its size, its settings and Remove. Changes are saved as they're
// made.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  GripVertical,
  ImageUp,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { MoreMenu } from '../components/Menu.jsx';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { ANALYTICS_PERIODS } from '../lib/analytics.js';
import { fmtInt } from '../lib/locale.js';
import { periodLine, periodWindowWord, presetPeriod } from '../lib/periods.js';
import { Link, navigate } from '../lib/router.jsx';
import { PageHeader, PeriodPicker, useIsNarrow, usePeriod, useToast } from '../shell/bits.jsx';
import ShareDialog from '../share/ShareDialog.jsx';
import { canShare } from '../share/shareSpec.js';
import NewDashboardDialog from './NewDashboardDialog.jsx';
import { CATEGORIES, WIDGETS, WIDGET_LIST } from './catalog.js';
import { useDashboards } from './DashboardsContext.jsx';
import { CARD_KINDS, CARD_ROWS, CARD_TITLE_MAX, SIZES } from './layouts.js';
import { KIND_NOUN, WIDGET_COMPONENTS, WIDGET_HEADS } from './widgets/index.jsx';
import { rowsShown } from './widgets/parts.jsx';
import './dashboards.css';

/** Whether the address asks for the dashboard to open for editing. */
function editFlag() {
  return new URLSearchParams(window.location.search).get('edit') === '1';
}

/** A card's sizes as the keys of a small Segmented. */
function sizeOptions(def) {
  return def.sizes.map((s) => ({ value: s, label: SIZES[s].label, title: SIZES[s].name, ariaLabel: SIZES[s].name }));
}

export default function DashboardPage({ dashboard }) {
  const archive = useArchive();
  const actions = useDashboards();
  const [period] = usePeriod();
  const toast = useToast();
  // A phone arranges its cards as a list of lines rather than on the grid.
  const phone = useIsNarrow('(max-width: 560px)');
  const [editing, setEditing] = useState(editFlag);
  const [dialog, setDialog] = useState(null); // 'rename' | 'delete' | 'new' | 'library'
  const [dragId, setDragId] = useState(null);
  const [dragType, setDragType] = useState(null); // a report being dragged in from the library
  const [dropIndex, setDropIndex] = useState(null);
  const [chosen, setChosen] = useState(null); // the card whose tools are out, while customizing
  const [justAdded, setJustAdded] = useState(null);
  const [settingsFor, setSettingsFor] = useState(null); // the id of the card whose settings are open
  const [share, setShare] = useState(null); // the card being made into a picture: { type, options, period }
  const pageRef = useRef(null);

  // Arriving with ?edit=1 (a dashboard just made empty) opens it for editing;
  // the flag then leaves the address so a reload doesn't reopen it. Another
  // dashboard is another arrangement: editing the last one stops, unless the
  // new one arrives with the flag (made from this one's ⋯).
  const lastId = useRef(dashboard.id);
  useEffect(() => {
    if (lastId.current !== dashboard.id) {
      lastId.current = dashboard.id;
      setEditing(editFlag());
      setChosen(null);
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1') {
      params.delete('edit');
      const q = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
    }
  }, [dashboard.id]);

  // Customize and Done take each other's place, so the press that swaps
  // them hands focus to the one that is now there, not to the page.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    pageRef.current?.querySelector('.page-actions > button')?.focus();
  }, [editing]);

  const widgets = dashboard.widgets;
  const id = dashboard.id;
  const nowMs = archive.nowMs;

  function addReport(type, index = null) {
    actions.addWidget(id, type, index);
    setJustAdded(type);
    toast?.(`${WIDGETS[type].name} added to ${dashboard.name}.`);
  }

  // A card taken away leaves focus with nothing to hold it: it goes to the
  // card that took its place (its handle, or its line on a phone), else the
  // one before it, else the way to the library.
  function removeCard(card, index) {
    actions.removeWidget(id, card.id);
    setChosen(null);
    toast?.(`${WIDGETS[card.type].name} removed.`);
    requestAnimationFrame(() => {
      const shown = (selector) => [...(pageRef.current?.querySelectorAll(selector) || [])].filter((el) => el.offsetParent !== null);
      const handles = shown('.widget-grip, .arrange-name');
      (handles[Math.min(index, handles.length - 1)] || shown('.library-open .btn, .library .input')[0])?.focus();
    });
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

  const empty = widgets.length === 0 && (
    <div className="dash-empty empty-block" data-drop={dragType != null || undefined}>
      <p className="empty">
        This dashboard is empty.{' '}
        {editing ? 'Bring in the reports you want to see each time you open it, from the library.' : 'Add the reports you want to see each time you open it.'}
      </p>
      {!editing && (
        <Button onClick={() => setEditing(true)}>
          <Plus size={15} aria-hidden="true" />
          Add reports
        </Button>
      )}
    </div>
  );

  return (
    // A wrapper only so the header and the grid share one width: while
    // customizing, the page takes more of the screen for the library.
    <div ref={pageRef} className="dash-page" data-editing={editing || undefined}>
      <PageHeader
        crumbs={[{ label: 'Dashboards' }]}
        title={dashboard.name}
        titleTools={
          editing ? (
            <Button variant="ghost" icon aria-label="Rename this dashboard" title="Rename" onClick={() => setDialog('rename')}>
              <Pencil size={16} aria-hidden="true" />
            </Button>
          ) : (
            <MoreMenu
              size="md"
              align="start"
              label="Dashboard options"
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
            />
          )
        }
        sub={editing ? 'Press a card to move, resize or remove it. Changes save as you go.' : periodLine(period, nowMs)}
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
              <button type="button" className="link-action" aria-pressed="false" onClick={() => setEditing(true)}>
                <SlidersHorizontal size={14} aria-hidden="true" />
                Customize
              </button>
              <PeriodPicker />
            </>
          )
        }
      />

      <div className="dash-wrap" data-editing={editing || undefined}>
        {editing && phone ? (
          <div className="dash-arrange">
            {empty || (
              <ArrangeList
                dashboard={dashboard}
                archive={archive}
                period={period}
                nowMs={nowMs}
                chosen={chosen}
                onChoose={setChosen}
                onMove={(card, to) => actions.moveWidget(id, card.id, to)}
                onResize={(card, size) => actions.resizeWidget(id, card.id, size)}
                onSettings={(card) => setSettingsFor(card.id)}
                onRemove={removeCard}
              />
            )}
          </div>
        ) : (
          // The grid's own box is a container: how many cards sit side by
          // side goes by the room the grid has, not by the screen.
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
              {empty}
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
                  onRemove={() => removeCard(w, index)}
                />
              ))}
              {editing && dragging && dropIndex === widgets.length && widgets.length > 0 && (
                <div className="drop-end" aria-hidden="true">
                  {dragType != null ? `Let go to add ${WIDGETS[dragType].name} here` : 'Let go to move it to the end'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Beside the grid where the page has the room (dashboards.css
            shows one or the other by the width of the page); a button that
            opens it in a dialog where it hasn't. */}
        {editing && <Library dashboard={dashboard} onAdd={addReport} onDragStart={setDragType} onDragEnd={endDrag} />}
        {editing && (
          <div className="library-open">
            <Button onClick={() => setDialog('library')}>
              <Plus size={15} aria-hidden="true" />
              Add a report from the library
            </Button>
          </div>
        )}
      </div>

      <Dialog open={dialog === 'library'} onClose={() => setDialog(null)} title="Report library" className="library-dialog">
        <Library dashboard={dashboard} onAdd={addReport} inDialog />
      </Dialog>
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

/**
 * The words under a card's title when it has settings of its own: "Last 90
 * days · Likes only". Nothing when it answers for the dashboard's period
 * and counts every kind.
 */
function OwnLine({ ownPeriod, kind }) {
  if (!ownPeriod && !kind) return null;
  return (
    <p className="card-sub meta">
      {ownPeriod && <span title="This card keeps its own period">{periodWindowWord(ownPeriod)}</span>}
      {kind && <span title="This card counts one kind of engagement">{KIND_NOUN[kind]} only</span>}
    </p>
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
  const [view, setView] = useState(null);
  const toolsRef = useRef(null);
  // A narrow card's tools are wider than it is, and reach past it on both
  // sides (dashboards.css); at the grid's edge they are moved in, so they
  // never run off the page.
  useLayoutEffect(() => {
    const el = toolsRef.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.removeProperty('--tools-shift');
      const grid = el.closest('.dash-grid')?.getBoundingClientRect();
      if (!grid) return;
      const r = el.getBoundingClientRect();
      const shift = Math.max(0, grid.left - r.left) - Math.max(0, r.right - grid.right);
      if (shift) el.style.setProperty('--tools-shift', `${Math.round(shift)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [chosen, editing, card.size, index]);
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
  const cardPeriod = ownPeriod || period;
  const name = options.title || def.name;
  // What the card adds to its heading: a count phrase, or its chart's modes.
  const head = !isStat ? WIDGET_HEADS[card.type]?.({ archive, period: cardPeriod, nowMs }) || null : null;
  const views = head?.views || null;
  const shownView = views ? (views.some((v) => v.value === view) ? view : views[0].value) : null;

  const grip = editing && (
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
  );
  // The chosen card's tools float over its top edge, so choosing a card
  // never moves what is in it. They come after the handle, so tabbing onto
  // the handle (which chooses the card) brings them in as the next stops.
  const tools = editing && chosen && (
    <div ref={toolsRef} className="widget-edit-tools" role="group" aria-label={`Arrange ${name}`}>
      {def.sizes.length > 1 && <Segmented size="sm" label={`Size of ${def.name}`} value={card.size} onChange={onResize} options={sizeOptions(def)} />}
      <span className="widget-edit-actions">
        {def.options?.length > 0 && (
          <Button variant="ghost" size="sm" icon aria-label={`Settings for ${name}`} title="Card settings" onClick={onSettings}>
            <Settings2 size={16} aria-hidden="true" />
          </Button>
        )}
        <Button variant="ghost" size="sm" icon aria-label={`Move ${def.name} earlier`} title="Move earlier" disabled={index === 0} onClick={() => onMove(index - 1)}>
          <ChevronLeft size={16} aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="sm" icon aria-label={`Move ${def.name} later`} title="Move later" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
          <ChevronRight size={16} aria-hidden="true" />
        </Button>
      </span>
    </div>
  );
  const remove = editing && (
    <Button variant="ghost" size="sm" icon className="widget-remove" aria-label={`Remove ${def.name}`} title="Remove" onClick={onRemove}>
      <X size={16} aria-hidden="true" />
    </Button>
  );

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
      {/* A figure has no heading of its own (its label is part of it), so
          while customizing its handle and Remove get a line over it. */}
      {editing && isStat && (
        <div className="widget-edit">
          {grip}
          {tools}
          {remove}
        </div>
      )}
      {!isStat && (
        <header className="widget-head card-head">
          {grip}
          <div className="widget-titles">
            <h2 id={headingId} className="card-title">
              {name}
            </h2>
            <OwnLine ownPeriod={ownPeriod} kind={options.kind} />
            {head?.sub && <p className="card-sub num">{head.sub}</p>}
          </div>
          {tools}
          {remove}
          {!editing && views && <Segmented size="sm" label={head.label || 'Chart'} value={shownView} onChange={setView} options={views} />}
          {!editing && (canShare(card.type) || def.href) && (
            <div className="head-tools widget-open">
              {canShare(card.type) && (
                <Button variant="ghost" size="sm" icon aria-label={`Post ${name} as a picture`} title="Post this chart" onClick={() => onShare(cardPeriod)}>
                  <ImageUp size={16} aria-hidden="true" />
                </Button>
              )}
              {def.href && (
                <Link to={def.href} className="btn btn--ghost btn--sm btn--icon" aria-label={`Open the full ${def.name} report`} title="Open the full report">
                  <ArrowUpRight size={16} aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        </header>
      )}
      <div className="widget-body">
        <Body
          archive={archive}
          period={cardPeriod}
          nowMs={nowMs}
          size={card.size}
          def={def}
          title={options.title || null}
          kind={options.kind || 'all'}
          rows={options.rows || null}
          view={shownView}
        />
      </div>
    </section>
  );
}

/**
 * Customize on a phone: each card is one line, in the order the grid has
 * them, to move up or down. Pressing a line opens it to its size on a wide
 * screen, its settings and Remove. A figure's line shows its number and a
 * list's how many rows it shows, so the lines can be told apart at a look.
 */
function ArrangeList({ dashboard, archive, period, nowMs, chosen, onChoose, onMove, onResize, onSettings, onRemove }) {
  const widgets = dashboard.widgets;
  return (
    <ol className="arrange-list" aria-label={`The reports on ${dashboard.name}, in order`}>
      {widgets.map((card, index) => {
        const def = WIDGETS[card.type];
        const Body = WIDGET_COMPONENTS[card.type];
        if (!def || !Body) return null;
        const options = card.options || {};
        const name = options.title || def.name;
        const open = chosen === card.id;
        const detailId = `arrange-${card.id}`;
        const isStat = def.kind === 'stat';
        const ownPeriod = options.period ? presetPeriod(options.period) : null;
        return (
          <li key={card.id} className="arrange-row" data-open={open || undefined} data-widget-type={card.type}>
            <div className="arrange-line">
              <Button variant="ghost" icon aria-label={`Move ${name} up`} title="Move up" disabled={index === 0} onClick={() => onMove(card, index - 1)}>
                <ArrowUp size={16} aria-hidden="true" />
              </Button>
              <Button variant="ghost" icon aria-label={`Move ${name} down`} title="Move down" disabled={index === widgets.length - 1} onClick={() => onMove(card, index + 1)}>
                <ArrowDown size={16} aria-hidden="true" />
              </Button>
              {/* The name opens the line; its reach runs to the line's end
                  (dashboards.css), over the number and the chevron, which
                  sit outside it because a figure's card holds a link. */}
              <button type="button" className="arrange-name" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => onChoose(open ? null : card.id)}>
                {name}
              </button>
              <span className="arrange-value num">
                {isStat ? (
                  // The figure's own card, drawn down to its number
                  // (dashboards.css), so the line shows what the grid would.
                  <Body archive={archive} period={ownPeriod || period} nowMs={nowMs} size={card.size} def={def} title={null} kind={options.kind || 'all'} rows={null} />
                ) : def.options?.includes('rows') ? (
                  `${fmtInt(rowsShown(card.type, card.size, options.rows))} rows`
                ) : null}
              </span>
              <ChevronDown className="arrange-chevron" size={16} aria-hidden="true" />
            </div>
            {open && (
              <div className="arrange-detail" id={detailId}>
                {def.sizes.length > 1 && (
                  <div className="arrange-size">
                    <p className="arrange-caption" id={`${detailId}-size`}>
                      Size on a wide screen. On a phone every card is full width.
                    </p>
                    <Segmented size="sm" label={`Size of ${name} on a wide screen`} value={card.size} onChange={(s) => onResize(card, s)} options={sizeOptions(def)} />
                  </div>
                )}
                <div className="arrange-tools">
                  {def.options?.length > 0 && (
                    <button type="button" className="link-action" aria-label={`Settings for ${name}`} onClick={() => onSettings(card)}>
                      <Settings2 size={14} aria-hidden="true" />
                      Settings
                    </button>
                  )}
                  <button type="button" className="link-action" aria-label={`Remove ${name}`} onClick={() => onRemove(card, index)}>
                    <X size={14} aria-hidden="true" />
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Every report a dashboard can hold, as a ruled list: search it, narrow it
 * to a kind, and bring a report in by its plus (it lands at the end) or, from
 * beside the grid, by dragging it to where it should go. In a dialog (where
 * the page has no room beside the grid) the dialog's title stands for its
 * heading, and a report can only come in by its plus.
 */
function Library({ dashboard, onAdd, onDragStart = null, onDragEnd = null, inDialog = false }) {
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
  const count = `${WIDGET_LIST.length} reports, ${dashboard.widgets.length} of them on this dashboard.`;
  const Tag = inDialog ? 'div' : 'aside';
  return (
    <Tag className={`library${inDialog ? ' library--dialog' : ''}`} aria-labelledby={inDialog ? undefined : 'library-title'}>
      {inDialog ? (
        <p className="library-sub num">{count} Press a report’s plus to add it.</p>
      ) : (
        <div className="library-head">
          <h2 id="library-title" className="card-title">
            Report library
          </h2>
          <p className="card-sub num">{count} Drag one onto the grid, or press its plus.</p>
        </div>
      )}
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
              draggable={!inDialog}
              onDragStart={
                inDialog
                  ? undefined
                  : (e) => {
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData('text/plain', w.type);
                      onDragStart?.(w.type);
                    }
              }
              onDragEnd={inDialog ? undefined : onDragEnd}
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
                    <Check size={13} aria-hidden="true" />
                    On this dashboard{n > 1 ? ` ×${n}` : ''}
                  </span>
                )}
              </span>
              <Button size="sm" icon className="library-add" onClick={() => onAdd(w.type)} aria-label={`Add ${w.name}`} title={`Add ${w.name}`}>
                <Plus size={16} aria-hidden="true" />
              </Button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="empty">No report matches “{query}”.</li>}
      </ul>
    </Tag>
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
          <input className="input" value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} data-autofocus />
        </label>
      </form>
    </Dialog>
  );
}
