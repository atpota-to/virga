import { describe, expect, it } from 'vitest';
import { WIDGETS } from './catalog.js';
import * as L from './layouts.js';

describe('dashboard layouts', () => {
  it('starts with three dashboards whose every card is in the library', () => {
    const layout = L.defaultLayout();
    expect(layout.dashboards.map((d) => d.id)).toEqual(['overview', 'growth', 'content']);
    for (const d of layout.dashboards) {
      for (const w of d.widgets) {
        expect(WIDGETS[w.type]).toBeTruthy();
        expect(WIDGETS[w.type].sizes).toContain(w.size);
      }
    }
  });

  it('drops unknown cards and fixes sizes a card can’t take, keeping the rest', () => {
    const raw = {
      dashboards: [
        {
          id: 'mine',
          name: '  Mine  ',
          widgets: [
            { id: 'a', type: 'stat-followers', size: 'xl' },
            { id: 'b', type: 'from-the-future', size: 'm' },
            { id: 'c', type: 'top-posts', size: 'l' },
          ],
        },
        { id: 'mine', name: 'duplicate id' },
        null,
      ],
    };
    const out = L.sanitizeLayout(raw, WIDGETS);
    expect(out.dashboards).toHaveLength(1);
    expect(out.dashboards[0].name).toBe('Mine');
    expect(out.dashboards[0].widgets).toEqual([
      { id: 'a', type: 'stat-followers', size: 'xs' },
      { id: 'c', type: 'top-posts', size: 'l' },
    ]);
  });

  it('falls back to the default for anything unreadable', () => {
    expect(L.sanitizeLayout(null, WIDGETS).dashboards).toHaveLength(3);
    expect(L.sanitizeLayout({ dashboards: [] }, WIDGETS).dashboards).toHaveLength(3);
    expect(L.sanitizeLayout('nonsense', WIDGETS).dashboards).toHaveLength(3);
  });

  it('adds, moves, resizes and removes cards without touching other dashboards', () => {
    let layout = L.defaultLayout();
    const before = layout.dashboards[1];
    layout = L.addWidget(layout, 'overview', 'unfollows', WIDGETS.unfollows, { id: 'new' });
    let overview = layout.dashboards[0];
    expect(overview.widgets.at(-1)).toEqual({ id: 'new', type: 'unfollows', size: 's' });
    layout = L.moveWidget(layout, 'overview', 'new', 0);
    expect(layout.dashboards[0].widgets[0].id).toBe('new');
    layout = L.resizeWidget(layout, 'overview', 'new', 'xl');
    expect(layout.dashboards[0].widgets[0].size).toBe('xl');
    layout = L.moveWidget(layout, 'overview', 'new', 99);
    overview = layout.dashboards[0];
    expect(overview.widgets.at(-1).id).toBe('new');
    layout = L.removeWidget(layout, 'overview', 'new');
    expect(layout.dashboards[0].widgets.some((w) => w.id === 'new')).toBe(false);
    expect(layout.dashboards[1]).toBe(before);
  });

  it('keeps at least one dashboard, and resets one to how it started', () => {
    let layout = L.defaultLayout();
    const { layout: withEmpty, id } = L.addDashboard(layout, { name: 'Empty' });
    layout = withEmpty;
    expect(layout.dashboards.find((d) => d.id === id).widgets).toEqual([]);
    layout = L.removeWidget(layout, 'growth', layout.dashboards[1].widgets[0].id);
    layout = L.resetDashboard(layout, 'growth');
    expect(layout.dashboards[1].widgets.map((w) => w.type)).toEqual(L.TEMPLATES.growth.widgets.map(([t]) => t));
    for (const d of [...layout.dashboards]) layout = L.deleteDashboard(layout, d.id);
    expect(layout.dashboards).toHaveLength(1);
  });

  it('duplicates a dashboard with new card ids, right after the original', () => {
    const layout = L.defaultLayout();
    const { layout: out, id } = L.duplicateDashboard(layout, 'growth', 'copy');
    expect(out.dashboards.map((d) => d.id)).toEqual(['overview', 'growth', 'copy', 'content']);
    const copy = out.dashboards[2];
    expect(copy.name).toBe('Growth copy');
    expect(copy.widgets.map((w) => w.type)).toEqual(layout.dashboards[1].widgets.map((w) => w.type));
    expect(copy.widgets.every((w, i) => w.id !== layout.dashboards[1].widgets[i].id)).toBe(true);
    expect(id).toBe('copy');
  });

  it('renames, ignoring an empty name', () => {
    let layout = L.renameDashboard(L.defaultLayout(), 'overview', '  Weekly  ');
    expect(layout.dashboards[0].name).toBe('Weekly');
    layout = L.renameDashboard(layout, 'overview', '   ');
    expect(layout.dashboards[0].name).toBe('Weekly');
  });

  it('keeps a card’s own settings, and only the ones its type takes', () => {
    const def = { options: ['title', 'period', 'rows'], sizes: ['m'], defaultSize: 'm' };
    expect(L.cleanOptions({ title: '  My posts  ', period: '90d', kind: 'like', rows: 10 }, def)).toEqual({ title: 'My posts', period: '90d', rows: 10 });
    expect(L.cleanOptions({ title: '   ', period: 'fortnight', rows: 7 }, def)).toBe(null);
    expect(L.cleanOptions({ title: 'x'.repeat(200) }, def).title).toHaveLength(L.CARD_TITLE_MAX);
    expect(L.cleanOptions({ title: 'Anything' }, { options: [] })).toBe(null);
    expect(L.cleanOptions(null, def)).toBe(null);
    // A custom range is the dashboard's to pick, not a card's.
    expect(L.cleanOptions({ period: 'custom' }, def)).toBe(null);
  });

  it('sets and clears a card’s settings without touching its neighbours', () => {
    let layout = L.defaultLayout();
    const [first, second] = layout.dashboards[0].widgets;
    layout = L.setWidgetOptions(layout, 'overview', first.id, { period: '7d', title: 'This week' }, WIDGETS[first.type]);
    const cards = layout.dashboards[0].widgets;
    expect(cards[0]).toEqual({ ...first, options: { title: 'This week', period: '7d' } });
    expect(cards[1]).toBe(second);
    layout = L.setWidgetOptions(layout, 'overview', first.id, {}, WIDGETS[first.type]);
    expect(layout.dashboards[0].widgets[0]).toEqual(first);
    expect('options' in layout.dashboards[0].widgets[0]).toBe(false);
  });

  it('reads stored settings back checked, and carries them into a duplicate', () => {
    const raw = {
      dashboards: [
        {
          id: 'mine',
          name: 'Mine',
          widgets: [
            { id: 'a', type: 'top-posts', size: 'm', options: { kind: 'repost', rows: 15, period: 'all', nonsense: true } },
            { id: 'b', type: 'stat-unfollows', size: 'xs', options: { period: '7d', title: 'Left' } },
          ],
        },
      ],
    };
    const layout = L.sanitizeLayout(raw, WIDGETS);
    expect(layout.dashboards[0].widgets[0].options).toEqual({ period: 'all', kind: 'repost', rows: 15 });
    // Unfollows are counted between syncs, whatever the period.
    expect(layout.dashboards[0].widgets[1].options).toEqual({ title: 'Left' });
    const { layout: copied, id } = L.duplicateDashboard(layout, 'mine', 'copy');
    expect(copied.dashboards.find((d) => d.id === id).widgets[0].options).toEqual({ period: 'all', kind: 'repost', rows: 15 });
  });
});

describe('the Views template', () => {
  it('is offered, every card in it exists, and new accounts don’t start with it', async () => {
    const { WIDGETS } = await import('./catalog.js');
    expect(L.TEMPLATES.views.widgets.every(([type, size]) => WIDGETS[type]?.sizes.includes(size))).toBe(true);
    expect(L.defaultLayout().dashboards.map((d) => d.template)).toEqual(['overview', 'growth', 'content']);
    expect(L.dashboardFromTemplate('views').widgets.map((w) => w.type)).toContain('views-by-date');
  });
});
