// Dashboards as data: the sizes, the templates a new account starts with,
// what a card can be set to, reading a stored layout back checked, and every
// change Customize makes. Swift: VirgaInsights/Dashboards/Layouts.swift.
//
// newId reads the clock, Math.random and a counter of its own. Here they are
// made deterministic: Date.now() is FIXED_NOW, Math.random() is 0.25, and
// the counter is brought back to 0 before each case (its first id then has
// counter 1, as a fresh module's does). The Swift test gives its
// LayoutIDGenerator the same clock and random number, so the ids a change
// makes are held to the web's too.

import * as L from '../../../src/dashboards/layouts.js';
import { WIDGETS } from '../../../src/dashboards/catalog.js';
import { FIXED_NOW, each, grid, value } from './_helpers.js';

export const sources = ['src/dashboards/layouts.js'];

const ID_RANDOM = 0.25;

/** Brings newId's counter back to 0, with the clock and random number given. */
function resetIds(now, random) {
  Date.now = () => 0;
  Math.random = () => 0;
  // With both at 0, an id is `0`, the counter in base 36, then `0`.
  const probe = L.newId('');
  const counter = parseInt(probe.slice(1, -1), 36);
  for (let i = 0; i < (1296 - counter) % 1296; i += 1) L.newId('');
  Date.now = () => now;
  Math.random = () => random;
}

function withIds(fn) {
  const realNow = Date.now;
  const realRandom = Math.random;
  try {
    resetIds(FIXED_NOW, ID_RANDOM);
    return fn();
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
}

/** What layouts.js reads of a card type: its sizes, default and options. */
const rules = (def) =>
  def
    ? { sizes: def.sizes, defaultSize: def.defaultSize, options: def.options }
    : null;

// newId over a sequence of calls: `call` is how many calls since the counter
// was 0 (so the counter is call % 1296), with the clock and random number
// that call saw.
function newIdCases() {
  const plan = [
    { call: 1, prefix: 'w', now: FIXED_NOW, random: ID_RANDOM },
    { call: 2, prefix: 'd', now: FIXED_NOW, random: 0 },
    { call: 3, prefix: '', now: 0, random: 0.999999 },
    { call: 4, prefix: 'w', now: 1, random: 0.5 },
    { call: 5, prefix: 'card-', now: 8.64e15, random: 0.1 },
    { call: 6, prefix: 'w', now: 1700000000123, random: 0.0007716 },
    { call: 35, prefix: 'w', now: 35, random: 0.027 },
    { call: 36, prefix: 'w', now: 36, random: 0.028 },
    { call: 1295, prefix: 'w', now: FIXED_NOW, random: ID_RANDOM },
    { call: 1296, prefix: 'w', now: FIXED_NOW, random: ID_RANDOM },
    { call: 1297, prefix: 'd', now: FIXED_NOW, random: ID_RANDOM },
  ];
  const realNow = Date.now;
  const realRandom = Math.random;
  const out = [];
  try {
    resetIds(0, 0);
    let calls = 0;
    for (const { call, prefix, now, random } of plan) {
      while (calls < call - 1) {
        L.newId('');
        calls += 1;
      }
      Date.now = () => now;
      Math.random = () => random;
      out.push({
        id: `newId#${call}`,
        fn: 'newId',
        input: { call, prefix, now, random },
        output: L.newId(prefix),
      });
      calls += 1;
    }
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
  return out;
}

const DEFS = {
  all: { options: ['title', 'period', 'kind', 'rows'] },
  test: {
    options: ['title', 'period', 'rows'],
    sizes: ['m'],
    defaultSize: 'm',
  },
  title: { options: ['title'] },
  none: { options: [] },
  bare: {},
  missing: null,
  'top-posts': rules(WIDGETS['top-posts']),
  'stat-unfollows': rules(WIDGETS['stat-unfollows']),
  'stat-engagement': rules(WIDGETS['stat-engagement']),
};

const RAW_OPTIONS = [
  null,
  'string',
  5,
  true,
  [],
  ['title'],
  {},
  { title: '  My posts  ', period: '90d', kind: 'like', rows: 10 },
  { title: '   ', period: 'fortnight', rows: 7 },
  { title: 'x'.repeat(200) },
  { title: `${'a'.repeat(59)}👍 more` },
  { title: ' ﻿Hi ' },
  { title: '\u0085x' },
  { title: 'Café 👍🏽 ünïcödé' },
  { title: 42 },
  { period: 'custom' },
  { period: '7d' },
  { period: '1y' },
  { period: 'ALL' },
  { kind: 'quote' },
  { kind: 'likes' },
  { rows: 3 },
  { rows: '10' },
  { rows: 10.5 },
  { rows: 20 },
  { rows: 0 },
  { kind: 'repost', rows: 15, period: 'all', nonsense: true },
  { title: 'Left', period: '7d' },
];

const SIZE_DEFS = {
  stat: rules(WIDGETS['stat-followers']),
  'best-time': rules(WIDGETS['best-time']),
  onlyM: { sizes: ['m'], defaultSize: 'm' },
  noDefault: { sizes: ['l', 'm'] },
  empty: { sizes: [] },
  emptyWithDefault: { sizes: [], defaultSize: 's' },
  defaultOnly: { defaultSize: 'l' },
  blankDefault: { defaultSize: '' },
  bare: {},
  missing: null,
};

const SMALL = {
  version: 1,
  dashboards: [
    {
      id: 'a',
      name: 'Alpha',
      template: null,
      widgets: [
        { id: 'w1', type: 'stat-followers', size: 'xs' },
        { id: 'w2', type: 'top-posts', size: 'm', options: { rows: 5 } },
        { id: 'w3', type: 'best-time', size: 'l' },
      ],
    },
    { id: 'b', name: 'Beta', template: 'growth', widgets: [] },
    {
      id: 'c',
      name: `${'n'.repeat(54)}👍🏽`,
      template: null,
      widgets: [{ id: 'w4', type: 'top-tags', size: 's' }],
    },
  ],
};

const ONE = {
  version: 1,
  dashboards: [{ id: 'only', name: 'Only', template: null, widgets: [] }],
};

const DUPES = {
  version: 1,
  dashboards: [
    { id: 'a', name: 'First', template: null, widgets: [] },
    { id: 'b', name: 'Between', template: null, widgets: [] },
    { id: 'a', name: 'Second', template: 'content', widgets: [] },
  ],
};

const STORED = [
  null,
  'nonsense',
  5,
  [],
  {},
  { dashboards: [] },
  { dashboards: 'x' },
  { dashboards: [null, 5, 'x', [], {}, { id: 3 }] },
  // The web test's.
  {
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
  },
  {
    dashboards: [
      {
        id: 'mine',
        name: 'Mine',
        widgets: [
          {
            id: 'a',
            type: 'top-posts',
            size: 'm',
            options: {
              kind: 'repost',
              rows: 15,
              period: 'all',
              nonsense: true,
            },
          },
          {
            id: 'b',
            type: 'stat-unfollows',
            size: 'xs',
            options: { period: '7d', title: 'Left' },
          },
        ],
      },
    ],
  },
  { dashboards: [{ id: 'a' }] },
  { version: 99, dashboards: [{ id: '', name: 'Empty id', extra: true }] },
  {
    dashboards: [
      { id: 'n1', name: 5 },
      { id: 'n2', name: '   ' },
      { id: 'n3', name: 'x'.repeat(100) },
      { id: 'n4', name: `${'a'.repeat(59)}👍` },
      { id: 'n5', name: ' Spaced　' },
    ],
  },
  {
    dashboards: [
      { id: 't1', template: 'overview' },
      { id: 't2', template: 'nope' },
      { id: 't3', template: 5 },
      { id: 't4', template: null },
      { id: 't5', template: 'content', name: 'Mine' },
    ],
  },
  {
    dashboards: [
      {
        id: 'cards',
        name: 'Cards',
        template: 'growth',
        widgets: 'not a list',
      },
      {
        id: 'cards2',
        name: 'Cards',
        widgets: [
          null,
          5,
          { id: 5, type: 'top-posts' },
          { id: 'x' },
          { id: 'y', type: 'top-posts' },
          { id: 'y', type: 'top-posts', size: 'xl', extra: 1 },
          {
            id: 'z',
            type: 'stat-posts',
            size: 'm',
            options: { title: 'Posts' },
          },
          { id: 'q', type: 'best-time', size: 's', options: 'bad' },
          { id: 'r', type: 'top-tags', size: 7, options: { rows: 8 } },
        ],
      },
    ],
  },
  { dashboards: [null] },
];

const REGISTRY = {
  alpha: { sizes: ['m'], defaultSize: 'm', options: ['title'] },
  beta: { sizes: ['s', 'l'], options: ['rows'] },
};

export default async function cases() {
  const DEFAULT = withIds(() => L.defaultLayout());
  const MODIFIED = (() => {
    let layout = L.removeWidget(
      DEFAULT,
      'growth',
      DEFAULT.dashboards[1].widgets[0].id,
    );
    layout = L.setWidgetOptions(
      layout,
      'growth',
      DEFAULT.dashboards[1].widgets[1].id,
      { title: 'Changed' },
      WIDGETS[DEFAULT.dashboards[1].widgets[1].type],
    );
    return layout;
  })();
  const firstCard = DEFAULT.dashboards[0].widgets[0];

  const op = (fn, inputs, compute) =>
    each(fn, inputs, (input) => withIds(() => compute(input)));

  return [
    value('constants', {
      LAYOUT_VERSION: L.LAYOUT_VERSION,
      SIZES: L.SIZES,
      SIZES_KEYS: Object.keys(L.SIZES),
      TEMPLATES: L.TEMPLATES,
      TEMPLATES_KEYS: Object.keys(L.TEMPLATES),
      CARD_PERIODS: L.CARD_PERIODS,
      CARD_KINDS: L.CARD_KINDS,
      CARD_ROWS: L.CARD_ROWS,
      CARD_TITLE_MAX: L.CARD_TITLE_MAX,
    }),
    value('idClock', { now: FIXED_NOW, random: ID_RANDOM }),
    ...newIdCases(),

    ...(await each(
      'cleanOptions',
      grid({ raw: RAW_OPTIONS, def: Object.keys(DEFS) }).map(
        ({ raw, def }) => ({ raw, def: DEFS[def], defName: def }),
      ),
      ({ raw, def }) => L.cleanOptions(raw, def ?? undefined),
    )),
    ...(await each(
      'fitSize',
      grid({
        size: ['xs', 's', 'm', 'l', 'xl', 'xxl', '', null, 5, 'M'],
        def: Object.keys(SIZE_DEFS),
      }).map(({ size, def }) => ({ size, def: SIZE_DEFS[def], defName: def })),
      ({ size, def }) => L.fitSize(size, def ?? undefined),
    )),

    ...(await op(
      'dashboardFromTemplate',
      grid({
        key: ['overview', 'growth', 'content', 'nope', ''],
        options: [{}, { id: 'x' }, { name: 'Mine' }, { id: '', name: '' }],
      }),
      ({ key, options }) => L.dashboardFromTemplate(key, options),
    )),
    ...(await op('defaultLayout', [{}], () => L.defaultLayout())),
    ...(await op(
      'sanitizeLayout',
      [
        ...STORED.map((raw) => ({ raw })),
        {
          $id: 'custom-registry',
          raw: {
            dashboards: [
              {
                id: 'r',
                name: 'R',
                widgets: [
                  {
                    id: '1',
                    type: 'alpha',
                    size: 'xl',
                    options: { title: 'A' },
                  },
                  { id: '2', type: 'beta', size: 'm', options: { rows: 8 } },
                  { id: '3', type: 'top-posts', size: 'm' },
                ],
              },
            ],
          },
          widgets: REGISTRY,
        },
      ],
      ({ raw, widgets }) => L.sanitizeLayout(raw, widgets || WIDGETS),
    )),

    ...(await op(
      'addDashboard',
      [
        { layout: DEFAULT },
        { layout: DEFAULT, options: {} },
        { layout: DEFAULT, options: { name: 'Empty' } },
        { layout: DEFAULT, options: { name: 'Mine', template: 'growth' } },
        { layout: DEFAULT, options: { template: 'content', id: 'c2' } },
        { layout: SMALL, options: { id: 'x' } },
        { layout: SMALL, options: { template: 'nope' } },
        { layout: SMALL, options: { name: '' } },
        { layout: SMALL, options: { template: '' } },
        { layout: ONE, options: { name: '', template: 'overview' } },
        { layout: ONE, options: { id: '' } },
      ],
      ({ layout, options }) => L.addDashboard(layout, options),
    )),
    ...(await op(
      'duplicateDashboard',
      [
        { layout: DEFAULT, sourceId: 'growth', id: 'copy' },
        { layout: DEFAULT, sourceId: 'growth' },
        { layout: DEFAULT, sourceId: 'content' },
        { layout: DEFAULT, sourceId: 'nope' },
        { layout: SMALL, sourceId: 'a', id: 'a2' },
        { layout: SMALL, sourceId: 'b', id: 'b2' },
        { layout: SMALL, sourceId: 'c', id: 'c2' },
        { layout: DUPES, sourceId: 'a', id: 'z' },
        { layout: ONE, sourceId: 'only', id: '' },
      ],
      ({ layout, sourceId, id }) => L.duplicateDashboard(layout, sourceId, id),
    )),
    ...(await op(
      'renameDashboard',
      [
        '  Weekly  ',
        '   ',
        '',
        null,
        'x'.repeat(100),
        `${'a'.repeat(59)}👍`,
        ' New ',
        'Café ☕',
      ]
        .map((name) => ({ layout: SMALL, id: 'a', name }))
        .concat([
          { layout: SMALL, id: 'nope', name: 'Renamed' },
          { layout: DUPES, id: 'a', name: 'Both' },
        ]),
      ({ layout, id, name }) => L.renameDashboard(layout, id, name),
    )),
    ...(await op(
      'deleteDashboard',
      [
        { layout: DEFAULT, id: 'growth' },
        { layout: DEFAULT, id: 'nope' },
        { layout: ONE, id: 'only' },
        { layout: ONE, id: 'nope' },
        { layout: DUPES, id: 'a' },
      ],
      ({ layout, id }) => L.deleteDashboard(layout, id),
    )),
    ...(await op(
      'moveDashboard',
      [
        { layout: DEFAULT, id: 'content', toIndex: 0 },
        { layout: DEFAULT, id: 'overview', toIndex: 99 },
        { layout: DEFAULT, id: 'overview', toIndex: -5 },
        { layout: DEFAULT, id: 'growth', toIndex: 1 },
        { layout: DEFAULT, id: 'overview', toIndex: 1 },
        { layout: DEFAULT, id: 'nope', toIndex: 0 },
        { layout: DUPES, id: 'a', toIndex: 1 },
        { layout: ONE, id: 'only', toIndex: 3 },
      ],
      ({ layout, id, toIndex }) => L.moveDashboard(layout, id, toIndex),
    )),
    ...(await op(
      'resetDashboard',
      [
        { layout: MODIFIED, id: 'growth' },
        { layout: MODIFIED, id: 'overview' },
        { layout: SMALL, id: 'a' },
        { layout: SMALL, id: 'b' },
        { layout: SMALL, id: 'nope' },
        { layout: DUPES, id: 'a' },
      ],
      ({ layout, id }) => L.resetDashboard(layout, id),
    )),
    ...(await op(
      'addWidget',
      [
        ['overview', 'unfollows', { id: 'new' }],
        ['overview', 'unfollows', { id: 'new', index: 0 }],
        ['overview', 'unfollows', { id: 'new', index: 99 }],
        ['overview', 'unfollows', { id: 'new', index: -3 }],
        ['overview', 'unfollows', { id: 'new', index: 2 }],
        ['overview', 'unfollows', { id: 'new', index: null }],
        ['overview', 'top-posts', { id: 'new', size: 'xl' }],
        ['overview', 'stat-posts', { id: 'new', size: 'xl' }],
        ['overview', 'top-posts', { id: 'new', size: 'xxl' }],
        ['overview', 'top-posts', { size: 's' }],
        ['overview', 'top-posts', {}],
        ['overview', 'top-posts', undefined],
        ['overview', 'from-the-future', { id: 'new' }],
        ['nope', 'top-posts', {}],
        ['growth', 'best-time', { index: 1 }],
      ]
        .map(([dashboardId, type, options]) => ({
          layout: DEFAULT,
          dashboardId,
          type,
          def: rules(WIDGETS[type]),
          options,
        }))
        .concat([
          {
            $id: 'no-default',
            layout: SMALL,
            dashboardId: 'b',
            type: 'custom',
            def: { sizes: ['l'] },
            options: { id: 'n', size: 'm' },
          },
          {
            $id: 'no-sizes',
            layout: SMALL,
            dashboardId: 'b',
            type: 'custom',
            def: { defaultSize: 'xl' },
            options: { id: 'n', size: 'xl' },
          },
        ]),
      ({ layout, dashboardId, type, def, options }) =>
        L.addWidget(layout, dashboardId, type, def ?? undefined, options),
    )),
    ...(await op(
      'removeWidget',
      [
        { layout: SMALL, dashboardId: 'a', widgetId: 'w2' },
        { layout: SMALL, dashboardId: 'a', widgetId: 'nope' },
        { layout: SMALL, dashboardId: 'b', widgetId: 'w2' },
        { layout: DEFAULT, dashboardId: 'overview', widgetId: firstCard.id },
      ],
      ({ layout, dashboardId, widgetId }) =>
        L.removeWidget(layout, dashboardId, widgetId),
    )),
    ...(await op(
      'resizeWidget',
      [
        { layout: SMALL, dashboardId: 'a', widgetId: 'w1', size: 'xl' },
        { layout: SMALL, dashboardId: 'a', widgetId: 'w2', size: 's' },
        { layout: SMALL, dashboardId: 'a', widgetId: 'nope', size: 'm' },
        { layout: SMALL, dashboardId: 'c', widgetId: 'w1', size: 'm' },
        { layout: SMALL, dashboardId: 'a', widgetId: 'w3', size: 'huge' },
      ],
      ({ layout, dashboardId, widgetId, size }) =>
        L.resizeWidget(layout, dashboardId, widgetId, size),
    )),
    ...(await op(
      'setWidgetOptions',
      [
        {
          layout: DEFAULT,
          dashboardId: 'overview',
          widgetId: firstCard.id,
          options: { period: '7d', title: 'This week' },
          def: rules(WIDGETS[firstCard.type]),
        },
        {
          layout: DEFAULT,
          dashboardId: 'overview',
          widgetId: firstCard.id,
          options: {},
          def: rules(WIDGETS[firstCard.type]),
        },
        {
          layout: SMALL,
          dashboardId: 'a',
          widgetId: 'w2',
          options: {},
          def: rules(WIDGETS['top-posts']),
        },
        {
          layout: SMALL,
          dashboardId: 'a',
          widgetId: 'w2',
          options: null,
          def: rules(WIDGETS['top-posts']),
        },
        {
          layout: SMALL,
          dashboardId: 'a',
          widgetId: 'w2',
          options: { kind: 'like', rows: 20, title: '  Best  ', x: 1 },
          def: rules(WIDGETS['top-posts']),
        },
        {
          layout: SMALL,
          dashboardId: 'a',
          widgetId: 'w2',
          options: { kind: 'like' },
          def: null,
        },
        {
          layout: SMALL,
          dashboardId: 'a',
          widgetId: 'w1',
          options: { period: '30d', kind: 'like' },
          def: rules(WIDGETS['stat-followers']),
        },
        {
          layout: SMALL,
          dashboardId: 'a',
          widgetId: 'nope',
          options: { title: 'x' },
          def: rules(WIDGETS['top-posts']),
        },
      ],
      ({ layout, dashboardId, widgetId, options, def }) =>
        L.setWidgetOptions(
          layout,
          dashboardId,
          widgetId,
          options,
          def ?? undefined,
        ),
    )),
    ...(await op(
      'moveWidget',
      [
        { layout: SMALL, dashboardId: 'a', widgetId: 'w3', toIndex: 0 },
        { layout: SMALL, dashboardId: 'a', widgetId: 'w1', toIndex: 99 },
        { layout: SMALL, dashboardId: 'a', widgetId: 'w1', toIndex: -1 },
        { layout: SMALL, dashboardId: 'a', widgetId: 'w1', toIndex: 1 },
        { layout: SMALL, dashboardId: 'a', widgetId: 'nope', toIndex: 0 },
        { layout: SMALL, dashboardId: 'b', widgetId: 'w1', toIndex: 0 },
        {
          layout: DEFAULT,
          dashboardId: 'content',
          widgetId: DEFAULT.dashboards[2].widgets[8].id,
          toIndex: 0,
        },
      ],
      ({ layout, dashboardId, widgetId, toIndex }) =>
        L.moveWidget(layout, dashboardId, widgetId, toIndex),
    )),
  ];
}
