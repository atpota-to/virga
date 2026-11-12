// The signed-in account's dashboards: read from localStorage once, checked
// against the report library, and written back on every change. Per account,
// like the archive, so two people on one browser each keep their own.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { WIDGETS } from './catalog.js';
import * as L from './layouts.js';

const Ctx = createContext(null);

export function layoutKey(did) {
  return `virga:dashboards:${did}`;
}

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(did) {
  try {
    const raw = JSON.parse(storage()?.getItem(layoutKey(did)) || 'null');
    return L.sanitizeLayout(raw, WIDGETS);
  } catch {
    return L.defaultLayout();
  }
}

export function DashboardsProvider({ did, children }) {
  const [layout, setLayout] = useState(() => load(did));
  const first = useRef(true);

  useEffect(() => {
    // The first render is what was just read; nothing to write back yet.
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      storage()?.setItem(layoutKey(did), JSON.stringify(layout));
    } catch {
      // A full or refused localStorage costs the layout on reload, nothing else.
    }
  }, [did, layout]);

  const apply = useCallback((op) => setLayout((prev) => op(prev)), []);

  const actions = useMemo(
    () => ({
      addDashboard(options) {
        let id = null;
        setLayout((prev) => {
          const out = L.addDashboard(prev, { ...options, id: options?.id || L.newId('d') });
          id = out.id;
          return out.layout;
        });
        return id;
      },
      duplicateDashboard(sourceId) {
        const id = L.newId('d');
        setLayout((prev) => L.duplicateDashboard(prev, sourceId, id).layout);
        return id;
      },
      renameDashboard: (id, name) => apply((prev) => L.renameDashboard(prev, id, name)),
      deleteDashboard: (id) => apply((prev) => L.deleteDashboard(prev, id)),
      moveDashboard: (id, to) => apply((prev) => L.moveDashboard(prev, id, to)),
      resetDashboard: (id) => apply((prev) => L.resetDashboard(prev, id)),
      resetAll: () => setLayout(L.defaultLayout()),
      addWidget: (dashboardId, type, index = null) =>
        apply((prev) => L.addWidget(prev, dashboardId, type, WIDGETS[type], { index })),
      removeWidget: (dashboardId, widgetId) => apply((prev) => L.removeWidget(prev, dashboardId, widgetId)),
      resizeWidget: (dashboardId, widgetId, size) => apply((prev) => L.resizeWidget(prev, dashboardId, widgetId, size)),
      moveWidget: (dashboardId, widgetId, to) => apply((prev) => L.moveWidget(prev, dashboardId, widgetId, to)),
      replaceDashboard: (dashboardId, widgets) =>
        apply((prev) => ({ ...prev, dashboards: prev.dashboards.map((d) => (d.id === dashboardId ? { ...d, widgets } : d)) })),
    }),
    [apply],
  );

  const value = useMemo(() => ({ layout, dashboards: layout.dashboards, ...actions }), [layout, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboards() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useDashboards must be used inside <DashboardsProvider>');
  return value;
}
