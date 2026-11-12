// Dashboards: each a named, ordered set of report cards, each card a widget
// type at a size. Pure functions over a plain object, so every change is a
// new value that can be saved, compared and undone; the provider in
// DashboardsContext.jsx keeps the current one per account and writes it to
// localStorage.
//
//   layout     { version, dashboards: [dashboard] }
//   dashboard  { id, name, widgets: [card] }
//   card       { id, type, size }      size: 'xs' | 's' | 'm' | 'l' | 'xl'
//
// The sizes are spans of a twelve-column grid: xs 3, s 4, m 6, l 8, xl 12.
// On a phone every card is full width; the order is the same everywhere.

export const LAYOUT_VERSION = 1;

export const SIZES = Object.freeze({
  xs: { cols: 3, label: 'XS', name: 'A quarter of the row' },
  s: { cols: 4, label: 'S', name: 'A third of the row' },
  m: { cols: 6, label: 'M', name: 'Half the row' },
  l: { cols: 8, label: 'L', name: 'Two thirds of the row' },
  xl: { cols: 12, label: 'XL', name: 'The full row' },
});

/** The dashboards a new account starts with. Types are WIDGETS keys. */
export const TEMPLATES = Object.freeze({
  overview: {
    name: 'Overview',
    widgets: [
      ['stat-followers', 'xs'],
      ['stat-new-followers', 'xs'],
      ['stat-engagement', 'xs'],
      ['stat-posts', 'xs'],
      ['follower-growth', 'l'],
      ['engagement-by-type', 's'],
      ['top-posts', 'm'],
      ['top-engagers', 'm'],
      ['best-time', 'm'],
      ['repo-collections', 'm'],
    ],
  },
  growth: {
    name: 'Growth',
    widgets: [
      ['stat-followers', 'xs'],
      ['stat-new-followers', 'xs'],
      ['stat-unfollows', 'xs'],
      ['stat-blocks', 'xs'],
      ['new-followers', 'l'],
      ['unfollows', 's'],
      ['newest-followers', 'm'],
      ['follow-back', 'm'],
      ['blocks-over-time', 'm'],
      ['lists-on', 'm'],
    ],
  },
  content: {
    name: 'Content',
    widgets: [
      ['stat-posts', 'xs'],
      ['stat-engagement', 'xs'],
      ['stat-per-post', 'xs'],
      ['stat-given', 'xs'],
      ['posting-cadence', 'm'],
      ['engagement-over-time', 'm'],
      ['engagement-rate', 'm'],
      ['best-time', 'm'],
      ['top-posts', 'xl'],
    ],
  },
});

let counter = 0;

/** A short id, unique enough within one browser's layouts. */
export function newId(prefix = 'w') {
  counter = (counter + 1) % 1296;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function cardsFrom(pairs) {
  return pairs.map(([type, size]) => ({ id: newId('w'), type, size }));
}

export function dashboardFromTemplate(key, { id = null, name = null } = {}) {
  const t = TEMPLATES[key] || TEMPLATES.overview;
  return { id: id || key, name: name || t.name, template: key, widgets: cardsFrom(t.widgets) };
}

export function defaultLayout() {
  return {
    version: LAYOUT_VERSION,
    dashboards: Object.keys(TEMPLATES).map((key) => dashboardFromTemplate(key)),
  };
}

/**
 * A stored layout, checked: cards of unknown types (from a newer version, or
 * one since retired) are dropped, sizes outside a type's range are put back
 * in it, and an empty or unreadable layout becomes the default. `widgets`
 * is the registry, `{ [type]: { sizes, defaultSize } }`.
 */
export function sanitizeLayout(raw, widgets) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.dashboards)) return defaultLayout();
  const seen = new Set();
  const dashboards = raw.dashboards
    .filter((d) => d && typeof d.id === 'string' && !seen.has(d.id) && seen.add(d.id))
    .map((d) => ({
      id: d.id,
      name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 60) : 'Untitled',
      template: TEMPLATES[d.template] ? d.template : null,
      widgets: (Array.isArray(d.widgets) ? d.widgets : [])
        .filter((w) => w && typeof w.id === 'string' && widgets[w.type])
        .map((w) => ({ id: w.id, type: w.type, size: fitSize(w.size, widgets[w.type]) })),
    }));
  if (!dashboards.length) return defaultLayout();
  return { version: LAYOUT_VERSION, dashboards };
}

/** A size the widget type allows: the one asked for, else its default. */
export function fitSize(size, def) {
  const allowed = def?.sizes || Object.keys(SIZES);
  return allowed.includes(size) ? size : def?.defaultSize || allowed[0];
}

function mapDashboard(layout, id, fn) {
  return { ...layout, dashboards: layout.dashboards.map((d) => (d.id === id ? fn(d) : d)) };
}

export function addDashboard(layout, { name = 'New dashboard', template = null, id = newId('d') } = {}) {
  const dashboard = template ? dashboardFromTemplate(template, { id, name }) : { id, name, template: null, widgets: [] };
  return { layout: { ...layout, dashboards: [...layout.dashboards, dashboard] }, id };
}

export function duplicateDashboard(layout, sourceId, id = newId('d')) {
  const source = layout.dashboards.find((d) => d.id === sourceId);
  if (!source) return { layout, id: null };
  const copy = {
    id,
    name: `${source.name} copy`.slice(0, 60),
    template: null,
    widgets: source.widgets.map((w) => ({ ...w, id: newId('w') })),
  };
  const at = layout.dashboards.indexOf(source) + 1;
  const dashboards = [...layout.dashboards.slice(0, at), copy, ...layout.dashboards.slice(at)];
  return { layout: { ...layout, dashboards }, id };
}

export function renameDashboard(layout, id, name) {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) return layout;
  return mapDashboard(layout, id, (d) => ({ ...d, name: clean }));
}

/** Remove a dashboard. The last one can't go: there is always somewhere to land. */
export function deleteDashboard(layout, id) {
  if (layout.dashboards.length <= 1) return layout;
  return { ...layout, dashboards: layout.dashboards.filter((d) => d.id !== id) };
}

export function moveDashboard(layout, id, toIndex) {
  const list = layout.dashboards.filter((d) => d.id !== id);
  const item = layout.dashboards.find((d) => d.id === id);
  if (!item) return layout;
  const at = Math.max(0, Math.min(list.length, toIndex));
  return { ...layout, dashboards: [...list.slice(0, at), item, ...list.slice(at)] };
}

/** Put a dashboard back to the cards it started with (or empty, if it had none). */
export function resetDashboard(layout, id) {
  return mapDashboard(layout, id, (d) => ({
    ...d,
    widgets: d.template ? cardsFrom(TEMPLATES[d.template].widgets) : [],
  }));
}

export function addWidget(layout, dashboardId, type, def, { id = newId('w'), index = null } = {}) {
  return mapDashboard(layout, dashboardId, (d) => {
    const card = { id, type, size: def?.defaultSize || 'm' };
    const widgets = [...d.widgets];
    widgets.splice(index == null ? widgets.length : Math.max(0, Math.min(widgets.length, index)), 0, card);
    return { ...d, widgets };
  });
}

export function removeWidget(layout, dashboardId, widgetId) {
  return mapDashboard(layout, dashboardId, (d) => ({ ...d, widgets: d.widgets.filter((w) => w.id !== widgetId) }));
}

export function resizeWidget(layout, dashboardId, widgetId, size) {
  return mapDashboard(layout, dashboardId, (d) => ({
    ...d,
    widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, size } : w)),
  }));
}

/** Move a card to `toIndex` in its dashboard's order (clamped). */
export function moveWidget(layout, dashboardId, widgetId, toIndex) {
  return mapDashboard(layout, dashboardId, (d) => {
    const from = d.widgets.findIndex((w) => w.id === widgetId);
    if (from < 0) return d;
    const widgets = [...d.widgets];
    const [card] = widgets.splice(from, 1);
    widgets.splice(Math.max(0, Math.min(widgets.length, toIndex)), 0, card);
    return { ...d, widgets };
  });
}
