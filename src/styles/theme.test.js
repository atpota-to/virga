// The promise in the README is that the colours are checked, not eyeballed:
// contrast against their own ground and against the sky, and the two series
// on a chart still apart for colour-blind eyes. This is the check. It reads
// theme.css the way a browser would (which blocks apply to <html> for a sky,
// an accent and a contrast setting, and which of them wins), and holds every
// combination to the same numbers. A colour changed in theme.css, or an
// accent added to it, has to pass here.
//
// What is measured, and against what:
//
//   Contrast is WCAG 2's ratio. Words need 4.5:1 (AA), and 7:1 (AAA) in high
//   contrast. Marks that are not words (a line on a chart, a focus ring, the
//   edge of a control) need 3:1 (WCAG 1.4.11), and 4.5:1 in high contrast.
//
//   The grounds are the page (--bg), what floats over it (--surface), and
//   the sky. The sky is a wash that fades from --sky-top through --sky-mid
//   into the page, so a colour that holds against all three of those holds
//   everywhere on it. A page's title and the words under it sit at the very
//   top of the wash; its first chart starts further down, so marks are held
//   to --sky-mid and the page. A colour with some transparency (the lines
//   are a tint of the ink) is measured as it lands on the ground under it.
//
//   "Apart" is the distance between two colours in OKLab, times 100, once as
//   they are and once each as protanopia, deuteranopia and tritanopia see
//   them (Machado, Oliveira and Fernandes 2009, at full severity). The method
//   the chart colours came from asks 8 of two neighbouring series under that
//   simulation and 15 with ordinary vision. These are the only two series on
//   a chart and they are thin lines, so both are held higher: colour-blind
//   eyes get the 15 that ordinary ones are owed, and ordinary ones get 20.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENT_CHOICES, skyColor } from '../lib/preferences.jsx';
import { SKY_PHASES, themeOf } from '../lib/sky.js';

const WORDS = { normal: 4.5, high: 7 };
const MARKS = { normal: 3, high: 4.5 };
const LINES_IN_HIGH_CONTRAST = 3;
const APART = 20;
const APART_COLOUR_BLIND = 15;
/** The least two neighbouring steps of the heatmap ramp differ by, in OKLab lightness. */
const RAMP_STEP = 0.03;

const CONTRASTS = ['normal', 'high'];
/** The grounds a word can sit on: the page, what floats, the quiet fills, and the two ends of the sky. */
const GROUNDS = ['--bg', '--surface', '--surface-2', '--surface-3', '--hover', '--sky-top', '--sky-mid'];
/** Where a chart, a switch or a chosen thing's edge can sit. */
const MARK_GROUNDS = ['--bg', '--surface', '--sky-mid'];

/** The tokens an accent gives. Every accent block has to declare all of them, or a stronger block's value leaks through. */
const ACCENT_TOKENS = [
  '--accent',
  '--accent-hover',
  '--accent-ink',
  '--accent-wash',
  '--accent-line',
  '--on-accent',
  '--second',
  '--second-ink',
  '--second-wash',
  '--second-tip',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-area',
  '--heat-0',
  '--heat-1',
  '--heat-2',
  '--heat-3',
  '--heat-4',
  '--heat-5',
  '--heat-6',
];

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/* ---- reading the stylesheet ------------------------------------------ */

/**
 * The rules of a stylesheet, in order: `{ selectors, decls, media }`. Enough
 * of CSS for theme.css: comments, rules, and rules inside one level of
 * @media. `media` is the query a rule sits in, or null.
 */
function parseRules(css, media = null, out = []) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let close = open + 1;
    while (close < text.length && depth > 0) {
      if (text[close] === '{') depth += 1;
      else if (text[close] === '}') depth -= 1;
      close += 1;
    }
    const body = text.slice(open + 1, close - 1);
    if (prelude.startsWith('@')) parseRules(body, prelude, out);
    else {
      const decls = {};
      for (const part of body.split(';')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        decls[part.slice(0, colon).trim()] = part
          .slice(colon + 1)
          .replace(/!important/, '')
          .trim();
      }
      out.push({ selectors: prelude.split(',').map((s) => s.trim()), decls, media, order: out.length });
    }
    i = close;
  }
  return out;
}

/**
 * A selector as theme.css writes them for tokens: one or two compounds made
 * of `:root` and `[data-x='y']`. Null for anything else (the few rules at
 * the end of the file that style the kit), which sets no token on <html>.
 */
function parseSelector(selector) {
  const compounds = selector.split(/\s+/).map((compound) => {
    const parts = compound.match(/:root|\[data-[a-z-]+='[^']*'\]/g) || [];
    if (parts.join('') !== compound) return null;
    return parts.map((p) => (p === ':root' ? { root: true } : { attr: p.slice(1, p.indexOf('=')), value: p.slice(p.indexOf("'") + 1, -2) }));
  });
  if (compounds.includes(null) || compounds.length > 2) return null;
  return { compounds, specificity: compounds.flat().length };
}

const holds = (compound, attrs) => compound.every((p) => p.root || attrs[p.attr] === p.value);

/** What <html> carries for a sky (and the theme it brings), an accent and a contrast setting. */
const rootAttrs = ({ sky, accent, contrast }) => ({ 'data-sky': sky, 'data-theme': themeOf(sky), 'data-accent': accent, 'data-contrast': contrast, 'data-density': 'comfortable' });

/** Whether a selector picks out <html> in this state. */
function matchesRoot(sel, state) {
  return sel.compounds.length === 1 && holds(sel.compounds[0], rootAttrs(state));
}

/** Whether it picks out a swatch: an element inside the page carrying data-accent and nothing else. */
function matchesSwatch(sel, state, accent) {
  const own = sel.compounds[sel.compounds.length - 1];
  if (own.length !== 1 || own[0].attr !== 'data-accent' || own[0].value !== accent) return false;
  return sel.compounds.length === 1 || holds(sel.compounds[0], rootAttrs(state));
}

/** The declarations that win, as the cascade has it: the most specific selector, then the later rule. */
function cascade(rules, matches) {
  const hits = [];
  for (const rule of rules) {
    if (rule.media) continue;
    let best = -1;
    for (const selector of rule.selectors) {
      const sel = parseSelector(selector);
      if (sel && matches(sel)) best = Math.max(best, sel.specificity);
    }
    if (best >= 0) hits.push({ rule, specificity: best });
  }
  hits.sort((a, b) => a.specificity - b.specificity || a.rule.order - b.rule.order);
  return Object.assign({}, ...hits.map((h) => h.rule.decls));
}

function resolveVars(decls) {
  const seen = (value, depth = 0) => (depth > 8 ? value : value.replace(/var\((--[a-z0-9-]+)\)/g, (_, name) => seen(decls[name] ?? '', depth + 1)));
  return Object.fromEntries(Object.entries(decls).map(([name, value]) => [name, seen(value)]));
}

const RULES = parseRules(read('./theme.css'));

/** Every token on <html>, with var() followed, for one state. */
const tokensFor = (state) => resolveVars(cascade(RULES, (sel) => matchesRoot(sel, state)));

/** The tokens a swatch for `accent` sees inside a page in `state`: what it inherits, and what it is given. */
const swatchTokens = (state, accent) => ({ ...tokensFor(state), ...cascade(RULES, (sel) => matchesSwatch(sel, state, accent)) });

/* ---- colour ----------------------------------------------------------- */

/** '#rgb', '#rrggbb' or 'rgb(r g b / a)' as { rgb: [0..1 × 3], alpha }. Throws on anything else, so a typo fails the test. */
function parseColour(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255), alpha: 1 };
  }
  const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(value);
  if (fn) return { rgb: [fn[1], fn[2], fn[3]].map((n) => Number(n) / 255), alpha: fn[4] === undefined ? 1 : Number(fn[4]) };
  throw new Error(`not a colour this test can read: ${JSON.stringify(value)}`);
}

const solid = (value) => {
  const c = parseColour(value);
  if (c.alpha !== 1) throw new Error(`expected a solid colour, got ${value}`);
  return c.rgb;
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (rgb) => {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** A colour as it lands on a solid ground: itself, or blended into the ground by its own transparency. */
function over(value, ground) {
  const top = parseColour(value);
  const under = solid(ground);
  return top.rgb.map((c, i) => c * top.alpha + under[i] * (1 - top.alpha));
}

/** WCAG 2's contrast ratio between a colour and the solid ground it is drawn on. */
function contrast(a, b) {
  const [hi, lo] = [luminance(over(a, b)), luminance(solid(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Machado, Oliveira and Fernandes (2009), severity 1.0, on linear RGB.
const COLOUR_BLIND = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

const lightness = (value) => oklab(solid(value).map(toLinear))[0];

/** How far apart two colours are (OKLab, × 100), as they are or as one kind of colour blindness sees them. */
function apart(a, b, kind = null) {
  const seen = (value) => {
    const lin = solid(value).map(toLinear);
    if (!kind) return oklab(lin);
    const M = COLOUR_BLIND[kind];
    return oklab(M.map((row) => Math.max(0, Math.min(1, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]))));
  };
  const [p, q] = [seen(a), seen(b)];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/* ---- the checks ------------------------------------------------------- */

const STATES = SKY_PHASES.flatMap((sky) => CONTRASTS.flatMap((contrast) => ACCENT_CHOICES.map((accent) => ({ sky, contrast, accent }))));
const nameOf = ({ sky, contrast, accent }) => `${accent}, ${sky}${contrast === 'high' ? ', high contrast' : ''}`;

/**
 * Run `check(tokens, state, need)` for every state, where `need(label, ratio,
 * least)` notes a shortfall. Every shortfall is reported at once, by name,
 * rather than the first.
 */
function everyState(check, states = STATES) {
  const short = [];
  for (const state of states) {
    const need = (label, got, least) => {
      if (!(got >= least)) short.push(`${nameOf(state)}: ${label} is ${got.toFixed(2)}, needs ${least}`);
    };
    check(tokensFor(state), state, need);
  }
  expect(short).toEqual([]);
}

describe('theme.css', () => {
  it('is read here the way a browser reads it', () => {
    // The plain page, and the strongest combination, against values known by heart.
    expect(tokensFor({ sky: 'day', contrast: 'normal', accent: 'blue' })).toMatchObject({ '--bg': '#ffffff', '--sky-top': '#b9d5ff', '--accent': '#1d5ee0', '--chart-2': '#e8553a', '--up': '#1849b5', '--btn': '#0f1b33' });
    expect(tokensFor({ sky: 'dusk', contrast: 'normal', accent: 'blue' })).toMatchObject({ '--bg': '#ffffff', '--sky-top': '#cbc5f4', '--ink': '#0f1b33' });
    const night = tokensFor({ sky: 'night', contrast: 'normal', accent: 'blue' });
    expect(night).toMatchObject({ '--bg': '#0d152b', '--sky-top': '#0e1a3a', '--ink': '#f2f5fc', '--on-btn': '#0d152b' });
    expect(night['--focus-ring']).toBe(night['--accent-ink']);
    const strongest = tokensFor({ sky: 'night', contrast: 'high', accent: 'amber' });
    expect(strongest['--bg']).toBe('#000000');
    expect(strongest['--sky-top']).toBe('#000000');
    expect(strongest['--focus-ring']).toBe(strongest['--accent']);
    expect(strongest['--down']).toBe(strongest['--second-ink']);
  });

  it('gives dawn, day and dusk the same page under different skies, and night a page of its own', () => {
    const page = (sky) => {
      const t = tokensFor({ sky, contrast: 'normal', accent: 'blue' });
      const rest = Object.fromEntries(Object.entries(t).filter(([name]) => !name.startsWith('--sky-')));
      return { top: t['--sky-top'], mid: t['--sky-mid'], rest: JSON.stringify(rest) };
    };
    const [dawn, day, dusk, night] = SKY_PHASES.map(page);
    expect(dawn.rest).toBe(day.rest);
    expect(dusk.rest).toBe(day.rest);
    expect(night.rest).not.toBe(day.rest);
    expect(new Set([dawn.top, day.top, dusk.top, night.top]).size).toBe(4);
  });

  it('has an accent for every choice in Settings, and blue for a stamp it does not know', () => {
    const light = (accent) => tokensFor({ sky: 'day', contrast: 'normal', accent })['--accent'];
    expect(new Set(ACCENT_CHOICES.map(light)).size).toBe(ACCENT_CHOICES.length);
    expect(light('chartreuse')).toBe(light('blue'));
  });

  it('gives every accent the same tokens in every theme, so none leaks through from a stronger block', () => {
    const blocks = RULES.filter((rule) => !rule.media && rule.selectors.some((s) => /\[data-accent='\w+'\]$/.test(s)));
    // Six accents, in light and dark, in ordinary and high contrast.
    expect(blocks).toHaveLength(ACCENT_CHOICES.length * 4);
    for (const block of blocks) {
      expect(Object.keys(block.decls).sort(), block.selectors.join(', ')).toEqual([...ACCENT_TOKENS].sort());
    }
  });

  it('says again, for dark high contrast, everything light high contrast says', () => {
    const find = (selector) => RULES.filter((rule) => !rule.media && rule.selectors.length === 1 && rule.selectors[0] === selector).flatMap((rule) => Object.keys(rule.decls));
    const light = find(":root[data-contrast='high']");
    const dark = find(":root[data-contrast='high'][data-theme='dark']");
    expect(light.length).toBeGreaterThan(10);
    expect(light.filter((name) => !dark.includes(name))).toEqual([]);
  });

  it('resolves every colour it is about to measure', () => {
    for (const state of STATES) {
      const t = tokensFor(state);
      for (const name of [...ACCENT_TOKENS, ...GROUNDS, '--ink', '--muted', '--line', '--focus-ring', '--up', '--down', '--btn', '--on-btn']) {
        expect(() => parseColour(t[name]), `${nameOf(state)} ${name}`).not.toThrow();
      }
    }
  });
});

describe('words', () => {
  it('are readable on every ground, the sky included: 4.5:1, and 7:1 in high contrast', () => {
    everyState((t, { contrast: c }, need) => {
      for (const ground of GROUNDS) {
        for (const ink of ['--ink', '--ink-2', '--muted']) need(`${ink} on ${ground}`, contrast(t[ink], t[ground]), WORDS[c]);
      }
    });
  });

  it('on a button are readable, pressed or pointed at', () => {
    everyState((t, { contrast: c }, need) => {
      need('--on-btn on --btn', contrast(t['--on-btn'], t['--btn']), WORDS[c]);
      need('--on-btn on --btn-hover', contrast(t['--on-btn'], t['--btn-hover']), WORDS[c]);
    });
  });

  it('in the accent are readable on the page, on what floats, under the sky and on their own wash', () => {
    everyState((t, { contrast: c }, need) => {
      for (const ground of ['--bg', '--surface', '--sky-mid', '--accent-wash']) need(`--accent-ink on ${ground}`, contrast(t['--accent-ink'], t[ground]), WORDS[c]);
    });
  });

  it('on the accent are readable, pressed or pointed at', () => {
    everyState((t, { contrast: c }, need) => {
      need('--on-accent on --accent', contrast(t['--on-accent'], t['--accent']), WORDS[c]);
      need('--on-accent on --accent-hover', contrast(t['--on-accent'], t['--accent-hover']), WORDS[c]);
    });
  });

  it('in the second colour (a change downward) are readable on the page, on what floats, under the sky and on their own wash', () => {
    everyState((t, { contrast: c }, need) => {
      for (const ground of ['--bg', '--surface', '--sky-mid', '--second-wash']) need(`--second-ink on ${ground}`, contrast(t['--second-ink'], t[ground]), WORDS[c]);
    });
  });

  it('that warn or report a failure are readable on the page, on what floats and on their own wash', () => {
    everyState((t, { contrast: c }, need) => {
      for (const [ink, wash] of [
        ['--warn', '--warn-wash'],
        ['--danger', '--danger-wash'],
      ]) {
        need(`${ink} on --bg`, contrast(t[ink], t['--bg']), WORDS[c]);
        need(`${ink} on --surface`, contrast(t[ink], t['--surface']), WORDS[c]);
        need(`${ink} on ${wash}`, contrast(t[ink], t[wash]), WORDS[c]);
      }
    });
  });

  it('in a chart’s tooltip, for the second series, are readable on the tooltip', () => {
    // The tooltip is the one ground the theme does not own: charts.css sets it, dark in the light theme and light in the dark.
    const charts = parseRules(read('../charts/charts.css'));
    const ground = (selector) => charts.find((rule) => rule.selectors.includes(selector)).decls.background;
    const grounds = { light: ground('.an-chart-tip'), dark: ground(":root[data-theme='dark'] .an-chart-tip") };
    everyState((t, { sky }, need) => need('--second-tip on the tooltip', contrast(t['--second-tip'], grounds[themeOf(sky)]), WORDS.normal));
  });
});

describe('marks', () => {
  it('in the accent show against the page, what floats and the sky: a chosen thing’s rule, a switch, the focus outline', () => {
    everyState((t, { contrast: c }, need) => {
      for (const ground of [...MARK_GROUNDS, '--sky-top']) need(`--accent on ${ground}`, contrast(t['--accent'], t[ground]), MARKS[c]);
    });
  });

  it('have a focus ring that is a solid line at 3:1 or better, thicker and stronger in high contrast', () => {
    everyState((t, state, need) => {
      const c = state.contrast;
      for (const ground of [...MARK_GROUNDS, '--sky-top']) need(`--focus-ring on ${ground}`, contrast(t['--focus-ring'], t[ground]), MARKS[c]);
      // --focus is a stack of rings ("0 0 0 <spread> <colour>"), innermost first. The ring in the solid
      // colour is the one that counts; a halo beside it is decoration.
      const rings = t['--focus'].split(/,(?![^(]*\))/).map((layer) => /^0 0 0 (\d+)px (.+)$/.exec(layer.trim()));
      expect(rings.every(Boolean), `${nameOf(state)} --focus`).toBe(true);
      const at = rings.findIndex((ring) => ring[2] === t['--focus-ring']);
      expect(at, `${nameOf(state)}: --focus has a ring in --focus-ring`).toBeGreaterThanOrEqual(0);
      const width = Number(rings[at][1]) - (at > 0 ? Number(rings[at - 1][1]) : 0);
      need('the solid ring’s width in px', width, c === 'high' ? 3 : 1);
    });
  });

  it('on a chart show against the page, what floats and the sky under the title: 3:1, and 4.5:1 in high contrast', () => {
    everyState((t, { contrast: c }, need) => {
      for (const ground of MARK_GROUNDS) {
        for (const mark of ['--chart-1', '--chart-2', '--chart-ghost']) need(`${mark} on ${ground}`, contrast(t[mark], t[ground]), MARKS[c]);
      }
    });
  });

  it('for the two series on a chart stay apart, for ordinary eyes and for colour-blind ones', () => {
    everyState((t, state, need) => {
      const [one, two] = [t['--chart-1'], t['--chart-2']];
      need('--chart-1 from --chart-2', apart(one, two), APART);
      for (const kind of Object.keys(COLOUR_BLIND)) need(`--chart-1 from --chart-2 under ${kind}`, apart(one, two, kind), APART_COLOUR_BLIND);
    });
  });

  it('on a heatmap run one way from "nothing" to "most", in steps that can be told apart', () => {
    everyState((t, { sky }, need) => {
      const ramp = [0, 1, 2, 3, 4, 5, 6].map((i) => t[`--heat-${i}`]);
      const toward = themeOf(sky) === 'light' ? -1 : 1;
      for (let i = 1; i < ramp.length; i += 1) need(`--heat-${i} past --heat-${i - 1}`, (lightness(ramp[i]) - lightness(ramp[i - 1])) * toward, RAMP_STEP);
      // "Nothing" sits next to the page; the two fullest steps are marks in their own right.
      for (const ground of ['--bg', '--surface']) {
        need(`--heat-0 beside ${ground} (1 / contrast)`, 1 / contrast(ramp[0], t[ground]), 1 / 1.3);
        need(`--heat-5 on ${ground}`, contrast(ramp[5], t[ground]), MARKS.normal);
        need(`--heat-6 on ${ground}`, contrast(ramp[6], t[ground]), MARKS.normal);
      }
    });
  });

  it('under a line are a tint of that line', () => {
    for (const state of STATES) {
      const t = tokensFor(state);
      const area = parseColour(t['--chart-area']);
      expect(area.rgb, nameOf(state)).toEqual(solid(t['--chart-1']));
      expect(area.alpha, nameOf(state)).toBeLessThanOrEqual(0.25);
    }
  });
});

describe('high contrast', () => {
  const high = STATES.filter((state) => state.contrast === 'high');

  it('draws its lines and borders at 3:1 or better', () => {
    everyState((t, state, need) => {
      for (const line of ['--line', '--line-2', '--line-soft', '--accent-line', '--chart-axis']) {
        need(`${line} on --surface`, contrast(t[line], t['--surface']), LINES_IN_HIGH_CONTRAST);
        need(`${line} on --bg`, contrast(t[line], t['--bg']), LINES_IN_HIGH_CONTRAST);
      }
    }, high);
  });

  it('keeps the marks that are never words (--faint, and the dot for "done") at 3:1 or better', () => {
    everyState((t, state, need) => {
      need('--faint on --surface', contrast(t['--faint'], t['--surface']), MARKS.normal);
      need('--ok on --surface', contrast(t['--ok'], t['--surface']), MARKS.normal);
    }, high);
  });

  it('is a step past the ordinary set, for every accent', () => {
    for (const { sky, accent } of high) {
      const plain = tokensFor({ sky, accent, contrast: 'normal' });
      const strong = tokensFor({ sky, accent, contrast: 'high' });
      for (const [ink, ground] of [
        ['--muted', '--surface'],
        ['--accent-ink', '--surface'],
        ['--on-accent', '--accent'],
        ['--line', '--surface'],
      ]) {
        expect(contrast(strong[ink], strong[ground]), `${accent}, ${sky}: ${ink} on ${ground}`).toBeGreaterThan(contrast(plain[ink], plain[ground]));
      }
    }
  });
});

describe('a swatch', () => {
  it('shows the accent it names, in the page’s own sky and contrast, whatever the page’s accent is', () => {
    for (const state of STATES) {
      for (const accent of ACCENT_CHOICES) {
        const shown = swatchTokens(state, accent);
        const meant = tokensFor({ ...state, accent });
        for (const name of ACCENT_TOKENS) expect(shown[name], `${accent} swatch on a page that is ${nameOf(state)}: ${name}`).toBe(meant[name]);
      }
    }
  });
});

describe('the sky', () => {
  it('is a wash that fades into the page: three stops, the last of them the page’s own ground', () => {
    const base = parseRules(read('./base.css'));
    const body = base.find((rule) => rule.selectors.includes('body')).decls;
    expect(body['background-image'].replace(/\s+/g, ' ')).toBe('linear-gradient(180deg, var(--sky-top) 0, var(--sky-mid) var(--sky-mid-at), var(--bg) var(--sky-end))');
    expect(body['background-repeat']).toBe('no-repeat');
  });

  it('is gone in high contrast: the wash is the page’s flat ground', () => {
    for (const state of STATES.filter((s) => s.contrast === 'high')) {
      const t = tokensFor(state);
      expect(t['--sky-top'], nameOf(state)).toBe(t['--bg']);
      expect(t['--sky-mid'], nameOf(state)).toBe(t['--bg']);
    }
  });

  it('gives the browser’s own chrome the colour at its top', () => {
    for (const sky of SKY_PHASES) {
      for (const contrast of CONTRASTS) expect(skyColor(sky, contrast)).toBe(tokensFor({ sky, contrast, accent: 'blue' })['--sky-top']);
    }
  });
});
