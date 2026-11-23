// The kit's own measures: each declaration _themeKit.js names, as the
// stylesheet has it and as typed data (_css.js, parseKitValue). Swift:
// VirgaCore/Theme/ThemeTokens+Kit.swift, written from the same list by
// ios/scripts/generate-theme-tokens.mjs and held to these by
// ThemeKitParity.
//
// - `kit`: each measure as its declaration has it.
// - `resolved`: each measure that says var() (or color-mix()), as it
//   computes in a few themes on an element that declares no tokens of its
//   own: every var() followed, color-mix() worked out, and each length in
//   px for the viewport. This is what `theme.resolve(_:)`,
//   `theme.points(of:)` and `theme.color(of:)` give in Swift.
// - `declaring`: the one element of the kit that declares tokens of its
//   own, a field that is the trouble (.input[aria-invalid='true']): its
//   --focus-ring and --focus as they compute on it, the high-contrast rule's
//   --focus winning where it applies. This is what
//   `theme.declaring(_:)` gives with ThemeKit's invalidFocus* values.

import {
  computed as computedOn,
  evaluateLength,
  findDeclaration,
  parseKitValue,
  parseValue,
  resolveIn,
  resolveRoot,
} from './_css.js';
import { THEME_KIT } from './_themeKit.js';
import { readTheme, sources as themeSources } from './ui.theme.js';

export const sources = themeSources;

/** A plain day at a desk; a high-contrast, compact night on a phone; a high-contrast dusk on a tablet. */
const STATES = [
  {
    sky: 'day',
    theme: 'light',
    accent: 'blue',
    contrast: 'normal',
    density: 'comfortable',
    width: 1280,
  },
  {
    sky: 'night',
    theme: 'dark',
    accent: 'rose',
    contrast: 'high',
    density: 'compact',
    width: 390,
  },
  {
    sky: 'dusk',
    theme: 'light',
    accent: 'amber',
    contrast: 'high',
    density: 'comfortable',
    width: 820,
  },
];

/** A kit value in a theme, part by part, in the shapes ThemeKitParity builds from the Swift side. */
function resolvedKit(kind, v, computed, width) {
  const len = (l) => {
    if (!l) return null;
    const r = resolveIn({ length: l }, computed);
    return {
      length: r ? r.length : null,
      px: r ? evaluateLength(r.length, { width }) : null,
    };
  };
  const val = (x) => {
    if (!x) return null;
    const r = resolveIn(x, computed);
    return r && 'length' in r
      ? { value: r, px: evaluateLength(r.length, { width }) }
      : { value: r };
  };
  switch (kind) {
    case 'length':
      return len(v.length);
    case 'box':
      return {
        top: len(v.box.top),
        right: len(v.box.right),
        bottom: len(v.box.bottom),
        left: len(v.box.left),
      };
    case 'gap':
      return { row: len(v.gap.row), column: len(v.gap.column) };
    case 'color':
    case 'value':
      return val(v);
    case 'shadow':
      return val({ shadow: v.shadow });
    case 'border':
      return { width: len(v.border.width), color: val(v.border.color) };
    case 'gradient':
      return {
        stops: v.gradient.stops.map((s) => ({
          color: val(s.color),
          position: len(s.position),
        })),
      };
    case 'transitions':
      return { easings: v.transitions.map((t) => val(t.easing)) };
    case 'animation':
      return { easing: val(v.animation.easing) };
    default:
      throw new Error(`a ${kind} has nothing to resolve`);
  }
}

export default async function cases() {
  const { rules, blocks } = readTheme();
  const picks = THEME_KIT.map((pick) => {
    const d = findDeclaration(rules, pick);
    return { pick, d, value: parseKitValue(pick.kind, d.css) };
  });
  const out = picks.map(({ pick, d, value }) => ({
    id: pick.name,
    fn: 'kit',
    input: {
      file: pick.file,
      selector: pick.selector,
      media: pick.media,
      property: pick.property,
      kind: pick.kind,
    },
    output: { css: d.css, important: d.important, value },
  }));
  for (const state of STATES) {
    const { width, ...attrs } = state;
    const computed = resolveRoot(blocks, attrs, { width });
    for (const { pick, value } of picks) {
      const text = JSON.stringify(value);
      if (!text.includes('"var"') && !text.includes('"colorMix"')) continue;
      out.push({
        id: `${pick.name} in ${Object.values(state).join(' ')}`,
        fn: 'resolved',
        input: { name: pick.name, ...state },
        output: resolvedKit(pick.kind, value, computed, width),
      });
    }
  }
  const INVALID_FIELD = ".input[aria-invalid='true']";
  const HIGH = `:root[data-contrast='high'] ${INVALID_FIELD}`;
  const own = (selector) =>
    rules
      .filter(
        (r) =>
          r.file === 'src/styles/controls.css' &&
          !r.media &&
          r.selectors.includes(selector),
      )
      .flatMap((r) => r.declarations.filter((d) => d.name.startsWith('--')));
  const night = {
    ...STATES[0],
    sky: 'night',
    theme: 'dark',
    accent: 'teal',
  };
  for (const state of [...STATES, night]) {
    const { width, ...attrs } = state;
    const decls = new Map();
    for (const selector of [
      INVALID_FIELD,
      ...(state.contrast === 'high' ? [HIGH] : []),
    ]) {
      for (const d of own(selector))
        decls.set(d.name, { value: parseValue(d.css) });
    }
    const values = computedOn(decls, resolveRoot(blocks, attrs, { width }));
    out.push({
      id: `an invalid field in ${Object.values(state).join(' ')}`,
      fn: 'declaring',
      input: state,
      output: Object.fromEntries(
        [...decls.keys()].map((name) => [name, values.get(name) ?? null]),
      ),
    });
  }
  return out;
}
