// A dashboard: its cards on a twelve-column grid, all answering for one
// period. Customize turns the cards into things to arrange: drag a card by
// its handle (or move it with the arrows, from the keyboard), pick a size,
// take it off, or add reports from the library beside the grid. Changes are
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
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import Menu from '../components/Menu.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { PageHeader, PeriodPicker, useIsNarrow, usePeriod, useToast } from '../shell/bits.jsx';
import NewDashboardDialog from './NewDashboardDialog.jsx';
import { CATEGORIES, WIDGETS, WIDGET_LIST } from './catalog.js';
import { useDashboards } from './DashboardsContext.jsx';
import { SIZES } from './layouts.js';
import { WIDGET_COMPONENTS } from './widgets/index.jsx';
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
  const [dropIndex, setDropIndex] = useState(null);
  const [justAdded, setJustAdded] = useState(null);

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
    }
  }, [dashboard.id]);

  const widgets = dashboard.widgets;
  const id = dashboard.id;
  const nowMs = archive.nowMs;

  function addReport(type) {
    actions.addWidget(id, type);
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

  const onDrop = () => {
    if (dragId != null && dropIndex != null) {
      const from = widgets.findIndex((w) => w.id === dragId);
      actions.moveWidget(id, dragId, dropIndex > from ? dropIndex - 1 : dropIndex);
    }
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Dashboards' }]}
        title={dashboard.name}
        sub={editing ? null : `${widgets.length} ${widgets.length === 1 ? 'report' : 'reports'} · saved in this browser`}
        actions={
          <>
            <PeriodPicker />
            <Button
              variant={editing ? 'primary' : 'quiet'}
              aria-pressed={editing}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? <Check size={15} aria-hidden="true" /> : <SlidersHorizontal size={15} aria-hidden="true" />}
              {editing ? 'Done' : 'Customize'}
            </Button>
            <Menu
              label="Dashboard options"
              icon
              size="md"
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
        }
      >
        {editing && (
          <div className="edit-banner" role="status">
            <span>
              Editing <strong>{dashboard.name}</strong>.{' '}
              {narrow
                ? 'Move cards with the arrows, pick a size, or add reports below.'
                : 'Drag a card by its handle (or use the arrows), pick a size, remove it, or add reports from the library.'}{' '}
              Changes save as you go.
            </span>
          </div>
        )}
      </PageHeader>

      <div className="dash-wrap" data-editing={editing || undefined}>
        <div
          className="dash-grid"
          onDragOver={(e) => {
            if (dragId) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDrop();
          }}
        >
          {widgets.length === 0 && (
            <div className="dash-empty card">
              <h2 className="card-title">This dashboard is empty</h2>
              <p className="card-sub">Add the reports you want to see each time you open it.</p>
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
              archive={archive}
              period={period}
              nowMs={nowMs}
              dragging={dragId === w.id}
              dropBefore={dropIndex === index && dragId !== w.id}
              onDragStart={() => setDragId(w.id)}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
              onDragOverCard={(e) => {
                if (!dragId) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientX > rect.left + rect.width / 2 || e.clientY > rect.top + rect.height * 0.75;
                setDropIndex(after ? index + 1 : index);
              }}
              onMove={(to) => actions.moveWidget(id, w.id, to)}
              onResize={(size) => actions.resizeWidget(id, w.id, size)}
              onRemove={() => {
                actions.removeWidget(id, w.id);
                toast?.(`${WIDGETS[w.type].name} removed.`);
              }}
            />
          ))}
          {editing && dropIndex === widgets.length && <div className="drop-end" aria-hidden="true" />}
        </div>

        {editing && <Library dashboard={dashboard} onAdd={addReport} />}
      </div>

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
    </>
  );
}

function WidgetFrame({
  card,
  index,
  count,
  editing,
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
  onRemove,
}) {
  const def = WIDGETS[card.type];
  const Body = WIDGET_COMPONENTS[card.type];
  const [handleDown, setHandleDown] = useState(false);
  if (!def || !Body) return null;
  const isStat = def.kind === 'stat';
  const headingId = `w-${card.id}`;
  return (
    <section
      className={`widget${isStat ? ' widget--stat' : ''}`}
      data-size={card.size}
      data-widget-type={card.type}
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      data-drop-before={dropBefore || undefined}
      aria-labelledby={isStat ? undefined : headingId}
      aria-label={isStat ? def.name : undefined}
      draggable={editing && handleDown}
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
          <div className="widget-edit-tools">
            {def.sizes.length > 1 && (
              <div className="segmented segmented--sm" role="group" aria-label={`Size of ${def.name}`}>
                {def.sizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`segmented-key${card.size === s ? ' is-on' : ''}`}
                    aria-pressed={card.size === s}
                    title={SIZES[s].name}
                    aria-label={`${SIZES[s].label}: ${SIZES[s].name}`}
                    onClick={() => onResize(s)}
                  >
                    {SIZES[s].label}
                  </button>
                ))}
              </div>
            )}
            <span className="widget-edit-actions">
            <Button variant="ghost" size="sm" icon aria-label={`Move ${def.name} earlier`} title="Move earlier" disabled={index === 0} onClick={() => onMove(index - 1)}>
              <ChevronLeft size={15} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" icon aria-label={`Move ${def.name} later`} title="Move later" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
              <ChevronRight size={15} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" icon className="widget-remove" aria-label={`Remove ${def.name}`} title="Remove" onClick={onRemove}>
              <X size={15} aria-hidden="true" />
            </Button>
            </span>
          </div>
        </div>
      )}
      {!isStat && (
        <header className="widget-head">
          <div className="widget-titles">
            <h2 id={headingId} className="widget-title">
              {def.name}
            </h2>
            <p className="widget-desc">{def.desc}</p>
          </div>
          {!editing && def.href && (
            <Link to={def.href} className="btn btn--ghost btn--sm btn--icon widget-open" aria-label={`Open the full ${def.name} report`} title="Open the full report">
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          )}
        </header>
      )}
      <div className="widget-body">
        <Body archive={archive} period={period} nowMs={nowMs} size={card.size} def={def} />
      </div>
    </section>
  );
}

function Library({ dashboard, onAdd }) {
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
    <aside className="library card" aria-labelledby="library-title">
      <div className="library-head">
        <h2 id="library-title" className="card-title">
          Report library
        </h2>
        <span className="muted num">{dashboard.widgets.length} on this dashboard</span>
      </div>
      <label className="search">
        <Search aria-hidden="true" />
        <span className="visually-hidden">Search reports</span>
        <input className="input" type="search" placeholder="Search reports" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="library-cats" role="group" aria-label="Category">
        {[{ key: 'all', label: 'All' }, ...CATEGORIES].map((c) => (
          <button key={c.key} type="button" className="chip" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <ul className="library-list">
        {shown.map((w) => {
          const Icon = w.icon;
          const n = onBoard.get(w.type) || 0;
          return (
            <li key={w.type} className="library-item">
              <span className="library-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="library-text">
                <span className="library-name">
                  {w.name}
                  {w.kind === 'stat' && <span className="badge">Figure</span>}
                </span>
                <span className="library-desc">{w.desc}</span>
                {n > 0 && <span className="library-on">On this dashboard{n > 1 ? ` ×${n}` : ''}</span>}
              </span>
              <Button size="sm" variant={n ? 'quiet' : 'primary'} onClick={() => onAdd(w.type)} aria-label={`Add ${w.name}`}>
                <Plus size={14} aria-hidden="true" />
                Add
              </Button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="empty">No report matches “{query}”.</li>}
      </ul>
    </aside>
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
