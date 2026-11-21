// The design tokens, read from the stylesheets themselves, and what they
// come to on <html> for every set of attributes the web stamps there.
// Swift: VirgaCore/Theme/ThemeTokens*.swift.
//
// - `tokens`: every custom property the sheets set on <html>, in the order
//   they first appear.
// - `block`: each rule that sets them, in cascade order: its selectors, the
//   media query it sits in, and each declaration as written and as typed data
//   (_css.js says the shapes; the value is an index into `values`). The
//   Swift table (ThemeTokens+Blocks.swift) is held to these one for one.
// - `values`: every value a declaration has or a token computes to anywhere
//   below, once each, so the cases can name them by index.
// - `resolve`: the tokens on <html> for each sky × theme × accent ×
//   contrast × density (all 192), at a desk's width, a phone's (under the
//   899px query) and a narrow phone's (under 760px as well), plus the widths
//   either side of each query: `tokens` is a string of indexes into
//   `values`, one per token in `tokens` order, "-" where a token has no
//   value. Computed as a browser computes custom properties: the rules that
//   match, the winning declaration, var() followed where it is declared,
//   color-mix() worked out.
// - `swatch`: what an element carrying data-accent alone (Settings' accent
//   choices) declares for itself inside a page, as `name=index` pairs; the
//   rest it inherits from <html>.
// - `points`: the length expressions above (and some made up to reach the
//   corners: clamp's MIN over its MAX, ch, cqi in a container, em, a
//   percentage) in px for a viewport.
// - `colorMix`: color-mix() in sRGB over the percentages and alphas CSS
//   Color 5 treats specially.
// - `cascade`: small made-up sheets that reach what the real one doesn't:
//   !important, a var() cycle, a var() to nothing, a tie broken by order.
// The kit's own measures (sizes, weights, durations) are ui.themeKit.js.
//
// Forced colours (Windows' contrast themes) are recorded in `block` but
// never resolved: no device the iOS app runs on has them, and their system
// colours have no value outside one.

import fs from 'node:fs';
import {
  collapse,
  evaluateLength,
  mixColours,
  parseStylesheet,
  resolveRoot,
  swatchOwn,
  tokenBlocks,
} from './_css.js';
import { each, toJSON, value } from './_helpers.js';

/** In the order the app loads them (src/main.jsx), which is cascade order. */
export const sources = [
  'src/styles/theme.css',
  'src/styles/base.css',
  'src/styles/controls.css',
  'src/styles/app.css',
];

const read = (file) =>
  fs.readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');

export const SKIES = ['dawn', 'day', 'dusk', 'night'];
export const THEMES = ['light', 'dark'];
export const ACCENTS = ['blue', 'violet', 'teal', 'amber', 'rose', 'graphite'];
export const CONTRASTS = ['normal', 'high'];
export const DENSITIES = ['comfortable', 'compact'];

/** A desk, a phone (under 899px) and a narrow phone (under 760px too). */
const WIDTHS = [1280, 820, 390];
/** Either side of each query, for a few attribute sets. */
const EDGES = [900, 899, 761, 760, 320];

/** The sheets' rules and the token blocks among them, in cascade order. */
export function readTheme() {
  const rules = sources.flatMap((file) => parseStylesheet(read(file), file));
  return { rules, blocks: tokenBlocks(rules) };
}

/** Every token, in the order the blocks first set it. */
export function tokenNames(blocks) {
  const names = [];
  for (const block of blocks) {
    for (const d of block.declarations)
      if (!names.includes(d.name)) names.push(d.name);
  }
  return names;
}

const keyOf = (v) => JSON.stringify(v);

/** Values by index, and a function that gives a value's index (adding it). */
function table() {
  const list = [];
  const index = new Map();
  return {
    list,
    of(v) {
      const k = keyOf(v);
      if (!index.has(k)) {
        index.set(k, list.length);
        list.push(v);
      }
      return index.get(k);
    },
  };
}

/** Every length expression inside a resolved value. */
function lengthsIn(v, out = []) {
  if (!v || typeof v !== 'object') return out;
  if ('length' in v) out.push(v.length);
  if ('shadow' in v) {
    for (const layer of v.shadow) {
      for (const k of ['x', 'y', 'blur', 'spread'])
        if (layer[k]) out.push(layer[k]);
    }
  }
  return out;
}

const PX = (n) => ({ value: n, unit: 'px' });
const REM = (n) => ({ value: n, unit: 'rem' });
const VW = (n) => ({ value: n, unit: 'vw' });

/** Length expressions no stylesheet has yet, for the corners of the arithmetic. */
const MADE_UP_LENGTHS = [
  {
    $id: 'clamp MIN over MAX',
    length: { fn: 'clamp', args: [PX(60), VW(4), PX(40)] },
  },
  {
    $id: 'clamp under MIN',
    length: { fn: 'clamp', args: [PX(28), VW(1), PX(56)] },
  },
  {
    $id: 'clamp over MAX',
    length: { fn: 'clamp', args: [PX(28), VW(50), PX(56)] },
  },
  { $id: 'ch without a font', length: { value: 54, unit: 'ch' } },
  { $id: 'ch with a font', length: { value: 54, unit: 'ch' }, chWidth: 8.25 },
  {
    $id: 'ch in calc',
    length: {
      fn: 'calc',
      args: [{ op: '-', left: { value: 40, unit: 'ch' }, right: PX(12) }],
    },
    chWidth: 7.5,
  },
  { $id: 'em', length: { value: 0.92, unit: 'em' }, fontSize: 13 },
  { $id: 'negative em', length: { value: -0.04, unit: 'em' }, fontSize: 60 },
  { $id: 'em at the root size', length: { value: 0.2, unit: 'em' } },
  { $id: 'cqi without a container', length: { value: 26, unit: 'cqi' } },
  {
    $id: 'cqi in a container',
    length: { value: 26, unit: 'cqi' },
    containerWidth: 168,
  },
  { $id: 'percentage', length: { value: 35, unit: '%' } },
  { $id: 'var left in', length: { var: '--page-pad' } },
  {
    $id: 'grouped',
    length: {
      fn: 'calc',
      args: [
        {
          op: '*',
          left: {
            op: '/',
            left: {
              fn: 'group',
              args: [{ op: '-', left: VW(100), right: PX(96) }],
            },
            right: { number: 4 },
          },
          right: { number: 0.26 },
        },
      ],
    },
  },
  {
    $id: 'min of three',
    length: {
      fn: 'min',
      args: [
        PX(280),
        { fn: 'calc', args: [{ op: '-', left: VW(100), right: PX(32) }] },
        REM(20),
      ],
    },
  },
  {
    $id: 'max of two',
    length: {
      fn: 'max',
      args: [REM(2.5), { op: '*', left: VW(26), right: { number: 0.5 } }],
    },
  },
  { $id: 'number', length: { number: 1.5 } },
  {
    $id: 'divide',
    length: {
      fn: 'calc',
      args: [{ op: '/', left: REM(3), right: { number: 4 } }],
    },
  },
];

const C = (r, g, b, a = 1) => ({
  red: r / 255,
  green: g / 255,
  blue: b / 255,
  alpha: a,
});

/** color-mix() where CSS Color 5 does something other than the plain sum. */
const MIXES = [
  {
    $id: 'accent tint, 12%',
    first: C(29, 94, 224),
    firstPercent: 12,
    second: C(0, 0, 0, 0),
    secondPercent: null,
  },
  {
    $id: 'focus halo, 32%',
    first: C(122, 176, 245),
    firstPercent: 32,
    second: C(0, 0, 0, 0),
    secondPercent: null,
  },
  {
    $id: 'a field over the sky, 72%',
    first: C(22, 33, 64),
    firstPercent: 72,
    second: C(0, 0, 0, 0),
    secondPercent: null,
  },
  {
    $id: 'no percentages',
    first: C(255, 0, 0),
    firstPercent: null,
    second: C(0, 0, 255),
    secondPercent: null,
  },
  {
    $id: 'second only',
    first: C(255, 0, 0),
    firstPercent: null,
    second: C(0, 0, 255),
    secondPercent: 25,
  },
  {
    $id: 'over 100% is scaled',
    first: C(255, 0, 0),
    firstPercent: 80,
    second: C(0, 0, 255),
    secondPercent: 60,
  },
  {
    $id: 'under 100% leaves alpha',
    first: C(255, 0, 0),
    firstPercent: 20,
    second: C(0, 0, 255),
    secondPercent: 30,
  },
  {
    $id: 'half alpha against solid',
    first: C(15, 27, 51, 0.5),
    firstPercent: 40,
    second: C(255, 255, 255),
    secondPercent: null,
  },
  {
    $id: 'both transparent',
    first: C(0, 0, 0, 0),
    firstPercent: 50,
    second: C(255, 255, 255, 0),
    secondPercent: 50,
  },
  {
    $id: 'all of the first',
    first: C(29, 94, 224),
    firstPercent: 100,
    second: C(232, 85, 58),
    secondPercent: null,
  },
  {
    $id: 'none of the first',
    first: C(29, 94, 224),
    firstPercent: 0,
    second: C(232, 85, 58),
    secondPercent: null,
  },
  {
    $id: 'both zero',
    first: C(29, 94, 224),
    firstPercent: 0,
    second: C(232, 85, 58),
    secondPercent: 0,
  },
  {
    $id: 'fractional',
    first: C(13, 21, 43),
    firstPercent: 33.3,
    second: C(242, 245, 252, 0.4),
    secondPercent: 12.5,
  },
];

const ATTRS = {
  sky: 'day',
  theme: 'light',
  accent: 'blue',
  contrast: 'normal',
  density: 'comfortable',
};

/** Made-up sheets for what the real one doesn't do. Each is resolved for `attrs` at `width`. */
const SHEETS = [
  {
    $id: 'important beats specificity and order',
    css: `:root { --bg: #000000 !important; --ink: #111111; }
      :root[data-theme='light'][data-sky='day'] { --bg: #ffffff; --ink: #222222; }
      :root { --ink: #333333; }`,
  },
  {
    $id: 'two important: specificity, then order',
    css: `:root[data-sky='day'] { --bg: #010101 !important; }
      :root { --bg: #020202 !important; }
      :root[data-sky='day'] { --surface: #030303 !important; }
      :root[data-sky='day'] { --surface: #040404 !important; }`,
  },
  {
    $id: 'a later declaration in the same rule',
    css: `:root { --ink: #101010; --ink: #202020; --muted: #303030 !important; --muted: #404040; }`,
  },
  {
    $id: 'a cycle, and what refers to it',
    css: `:root { --btn: var(--btn-hover); --btn-hover: var(--btn); --on-btn: var(--btn); --ink: #0f1b33; --rule: var(--ink); }`,
  },
  {
    $id: 'a var() to nothing',
    css: `:root { --rule: var(--ink); --up: var(--accent-ink); --accent-tint: color-mix(in srgb, var(--accent) 12%, transparent); }`,
  },
  {
    $id: 'a var() of the wrong kind',
    css: `:root { --ink: #0f1b33; --space-4: 16px; --focus: 0 0 0 1px var(--space-4); --accent-tint: color-mix(in srgb, var(--space-4) 12%, transparent); --shell-max: calc(var(--ink) + 2px); }`,
  },
  {
    $id: 'media at its edge',
    width: 899,
    css: `:root { --page-pad: 24px; }
      @media (max-width: 899px) { :root { --page-pad: 20px; } }
      @media (max-width: 898px) { :root { --page-top: 1px; } }
      @media (min-width: 899px) { :root { --page-top: 2px; } }
      @media (min-width: 900px) { :root { --grid-gap: 3px; } }`,
  },
  {
    $id: 'a stronger rule outside the query wins',
    width: 390,
    attrs: { ...ATTRS, density: 'compact' },
    css: `:root[data-density='compact'] { --page-pad: 24px; }
      @media (max-width: 899px) { :root { --page-pad: 20px; } }`,
  },
  {
    $id: 'forced colours never apply',
    css: `:root { --chart-1: #1d5ee0; }
      @media (forced-colors: active) { :root { --chart-1: CanvasText !important; --heat-1: color-mix(in srgb, CanvasText 15%, Canvas) !important; } }`,
  },
  {
    $id: 'a selector for another element',
    css: `:root { --accent: #1d5ee0; }
      [data-theme='light'] [data-accent='blue'] { --accent: #ff0000; }
      [data-accent='blue'] { --accent-ink: #00ff00; }`,
  },
  {
    $id: 'a chain of references',
    css: `:root { --focus: 0 0 0 1px var(--focus-ring), 0 0 0 4px color-mix(in srgb, var(--focus-ring) 32%, transparent);
        --focus-ring: var(--accent); --accent: var(--chart-1); --chart-1: rgb(29 94 224 / 0.5);
        --figure-size: min(var(--text-figure), 26cqi); --text-figure: clamp(2.5rem, 1.6rem + 2.6vw, 3.75rem);
        --shell-max: calc(var(--sidebar-w) + var(--page-pad) * 2); --sidebar-w: 272px; --page-pad: clamp(28px, 4vw, 56px); }`,
  },
  {
    $id: 'colours in every syntax',
    css: `:root { --bg: #fff; --surface: #ffffff80; --surface-2: #0f1b; --surface-3: rgb(15, 27, 51); --hover: rgba(15, 27, 51, 0.5);
        --scrim: rgb(100% 50% 0% / 25%); --tint: hsl(220 60% 50%); --line: hsla(30, 100%, 50%, 0.3); --line-2: hsl(0.5turn 40% 40%);
        --line-soft: transparent; --ink: white; --ink-2: BLACK; --muted: rgb(300 -20 128);
        --faint: hsl(1.2rad 50% 50%); --rule: hsla(200grad, 30%, 60%, 40%); --ok: rgba(10, 20, 30, 50%);
        --warn: #FFF0; --danger: hsl(-30 120% 50%); --chart-1: rgb(12.5 300 -1 / 2); --chart-2: HSL(90DEG 100% 25% / 0.5);
        --chart-3: rgb(10% 20.5% 30% / .25); --chart-4: #1D5EE0CC; }`,
  },
  {
    // A rule's specificity is that of its most specific selector that
    // matches, not its first: the first rule's three-part selector beats
    // the later two-part one, though its `:root` alone would lose.
    $id: 'a list is as specific as its strongest match',
    css: `:root, :root[data-sky='day'][data-theme='light'] { --bg: #111111; --ink: #121212; }
      :root[data-sky='day'] { --bg: #222222; }
      [data-accent='violet'], :root { --ink: #333333; }`,
  },
  {
    $id: 'a property that refers to itself',
    css: `:root { --ink: var(--ink); --ink-2: var(--ink); --muted: #46536b; --rule: var(--muted); }`,
  },
  {
    // A cycle that runs through a shadow's colour and a color-mix() takes
    // every property in it, and what refers to them, with it.
    $id: 'a cycle through a shadow and a mix',
    css: `:root { --focus: 0 0 0 1px var(--focus-ring); --focus-ring: color-mix(in srgb, var(--accent) 50%, transparent);
        --accent: var(--accent-ink); --accent-ink: var(--focus-ring); --shadow-sm: var(--focus); --ink: #0f1b33; }`,
  },
  {
    // Outside forced colours too: a system colour is kept as it is, and a
    // color-mix() or a shadow holding one is kept unmixed.
    $id: 'system colours are kept as they are',
    css: `:root { --chart-1: CanvasText; --chart-2: highlight; --heat-1: color-mix(in srgb, CanvasText 15%, Canvas);
        --heat-2: color-mix(in srgb, var(--chart-1) 30%, #ffffff); --focus-ring: var(--chart-2); --focus: 0 0 0 1px var(--focus-ring);
        --heat-3: color-mix(in srgb, #ff0000, var(--chart-1) 40%); }`,
  },
  {
    // A viewport between whole pixels is under neither (max-width: 899px)
    // nor (min-width: 900px), as in a browser; queries joined by "and",
    // one inside another, and with no space after the colon.
    $id: 'media between whole pixels, and joined',
    width: 899.5,
    css: `:root { --page-pad: 1px; --page-top: 1px; --grid-gap: 1px; --section-gap: 1px; --row-pad: 1px; --row-pad-lg: 1px; }
      @media (max-width: 899px) { :root { --page-pad: 2px; } }
      @media (min-width: 900px) { :root { --page-top: 2px; } }
      @media (max-width:899.5px) { :root { --grid-gap: 2px; } }
      @media (min-width: 561px) and (max-width: 900px) { :root { --section-gap: 2px; } }
      @media (min-width: 561px) { @media (max-width: 899px) { :root { --row-pad: 2px; } } }
      @media (min-width: 561px) { @media (max-width: 900px) { :root { --row-pad-lg: 2px; } } }`,
  },
];

export default async function cases() {
  const { blocks } = readTheme();
  const names = tokenNames(blocks);
  const out = [value('tokens', names)];

  const values = table();
  const lengths = table();

  // Each block, its declarations' values by index into `values`.
  blocks.forEach((block, i) => {
    out.push(
      value(
        'block',
        {
          ...block,
          declarations: block.declarations.map((d) => ({
            name: d.name,
            css: d.css,
            important: d.important,
            value: values.of(d.value),
          })),
        },
        `${i + 1} ${block.selectors[0]}${block.media ? ` @media ${block.media}` : ''}`,
      ),
    );
  });
  const indexes = (computed) =>
    names
      .map((name) => {
        if (!computed.has(name)) return '-';
        const v = computed.get(name);
        for (const l of lengthsIn(v)) lengths.of(l);
        return String(values.of(v));
      })
      .join(' ');

  const states = [];
  for (const sky of SKIES)
    for (const theme of THEMES)
      for (const accent of ACCENTS)
        for (const contrast of CONTRASTS)
          for (const density of DENSITIES)
            for (const width of WIDTHS)
              states.push({ sky, theme, accent, contrast, density, width });
  for (const sky of SKIES)
    for (const contrast of CONTRASTS)
      for (const density of DENSITIES)
        for (const width of EDGES) {
          states.push({
            sky,
            theme: sky === 'night' ? 'dark' : 'light',
            accent: 'blue',
            contrast,
            density,
            width,
          });
        }

  const resolved = states.map((s) => {
    const { width, ...attrs } = s;
    return {
      id: `${s.sky} ${s.theme} ${s.accent} ${s.contrast} ${s.density} ${s.width}`,
      fn: 'resolve',
      input: s,
      output: { tokens: indexes(resolveRoot(blocks, attrs, { width })) },
    };
  });

  const swatches = [];
  for (const sky of ['day', 'night'])
    for (const theme of THEMES)
      for (const contrast of CONTRASTS)
        for (const accent of ['blue', 'amber'])
          for (const swatch of ACCENTS) {
            const attrs = {
              sky,
              theme,
              accent,
              contrast,
              density: 'comfortable',
            };
            const own = swatchOwn(blocks, attrs, swatch, { width: 1280 });
            swatches.push({
              id: `${swatch} in ${sky} ${theme} ${accent} ${contrast}`,
              fn: 'swatch',
              input: { ...attrs, width: 1280, swatch },
              output: {
                own: [...own]
                  .map(
                    ([name, v]) => `${name}=${v === null ? '-' : values.of(v)}`,
                  )
                  .join(' '),
              },
            });
          }

  out.push(value('values', values.list));
  out.push(...resolved, ...swatches);

  const pointWidths = [320, 390, 760, 899, 900, 1280, 1920];
  const pointInputs = [];
  lengths.list.forEach((length, i) => {
    for (const width of pointWidths)
      pointInputs.push({ $id: `${i} at ${width}`, length, width });
  });
  for (const made of MADE_UP_LENGTHS) {
    for (const width of [390, 1280])
      pointInputs.push({ ...made, $id: `${made.$id} at ${width}`, width });
  }
  out.push(
    ...(await each('points', pointInputs, (ctx) =>
      evaluateLength(ctx.length, ctx),
    )),
  );

  out.push(
    ...(await each('colorMix', MIXES, (m) =>
      mixColours(m.first, m.firstPercent, m.second, m.secondPercent),
    )),
  );

  for (const sheet of SHEETS) {
    const attrs = sheet.attrs ?? ATTRS;
    const width = sheet.width ?? 1280;
    const made = tokenBlocks(parseStylesheet(sheet.css, 'made-up.css'));
    const computed = resolveRoot(made, attrs, { width });
    out.push({
      id: sheet.$id,
      fn: 'cascade',
      input: toJSON({ css: collapse(sheet.css), blocks: made, attrs, width }),
      output: toJSON(
        Object.fromEntries(
          tokenNames(made).map((n) => [n, computed.get(n) ?? null]),
        ),
      ),
    });
  }

  return out;
}
