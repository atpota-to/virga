// The hillside's stylesheet (src/hillside/hillside.css) as numbers: the
// flat picture's gradient for each sky with its stops placed about the
// crest, how the canvas comes in and goes out of focus, and the live
// sky's band (the scene's height and crest, its filter, opacity and mask,
// its blend); and the five taps on the mark (src/shell/bits.jsx's
// useSkyTaps: how close the taps must come, how many, and the two
// toasts). Read from the files' text; anything written in a way this
// doesn't know throws, so a change to the sheet fails loudly here.
// Swift: VirgaCore/Hillside/HillsideStyle.swift and SkyTaps.swift.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { value } from './_helpers.js';
import { stripComments } from './_css.js';

export const sources = ['src/hillside/hillside.css', 'src/shell/bits.jsx'];

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/** The sheet's rules outside @media, and the selectors of those inside one. */
function rules(css) {
  const out = [];
  const media = [];
  let text = stripComments(css);
  text = text.replace(
    /@media[^{]*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g,
    (_, inner) => {
      for (const m of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        media.push({ selector: m[1].trim(), body: m[2] });
      return '';
    },
  );
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    out.push({ selector: m[1].trim(), body: m[2] });
  return { out, media };
}

function declarations(body) {
  const out = {};
  for (const part of body.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    out[part.slice(0, at).trim()] = part
      .slice(at + 1)
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
      .trim();
  }
  return out;
}

function rule(list, selector) {
  const found = list.find((r) => r.selector === selector);
  if (!found) throw new Error(`hillside.css has no rule for ${selector}`);
  return declarations(found.body);
}

const CREST = 'var(--crest, 50%)';

/** A gradient stop's place, as `crest × crest + offset` of the height. */
function place(text) {
  let m;
  if ((m = /^(-?[\d.]+)%$/.exec(text)))
    return { crest: 0, offset: Number(m[1]) / 100 };
  if (text === CREST) return { crest: 1, offset: 0 };
  if ((m = /^calc\(var\(--crest, 50%\) \* ([\d.]+)\)$/.exec(text)))
    return { crest: Number(m[1]), offset: 0 };
  if ((m = /^calc\(var\(--crest, 50%\) ([+-]) ([\d.]+)%\)$/.exec(text)))
    return {
      crest: 1,
      offset: ((m[1] === '-' ? -1 : 1) * Number(m[2])) / 100,
    };
  throw new Error(`hillside.css: a stop placed at ${text}`);
}

/** linear-gradient(180deg, <hex> <place>, …) */
function flat(background) {
  const m = /^linear-gradient\(180deg, (.*)\)$/.exec(background);
  if (!m) throw new Error(`hillside.css: background ${background}`);
  const stops = [];
  const re =
    /(#[0-9a-f]{6}) ((?:calc\([^()]*\([^()]*\)[^()]*\))|var\([^()]*\)|[\d.]+%)/g;

  for (const s of m[1].matchAll(re)) {
    stops.push({ color: s[1], ...place(s[2]) });
  }
  if (stops.length !== 7)
    throw new Error(`hillside.css: ${stops.length} stops in ${background}`);
  return stops;
}

function seconds(text) {
  const m = /^([\d.]+)s$/.exec(text);
  if (!m) throw new Error(`hillside.css: a time of ${text}`);
  return Number(m[1]);
}

function style() {
  const { out: list, media } = rules(read('src/hillside/hillside.css'));
  const skies = {
    day: rule(list, '.hillside').background,
    dawn: rule(list, ".hillside[data-phase='dawn']").background,
    dusk: rule(list, ".hillside[data-phase='dusk']").background,
    night: rule(list, ".hillside[data-phase='night']").background,
  };
  const flatStops = {};
  for (const [sky, bg] of Object.entries(skies)) flatStops[sky] = flat(bg);
  const crestRule = rule(list, '.hillside-crest');
  if (crestRule.height !== CREST)
    throw new Error(`.hillside-crest's height is ${crestRule.height}`);

  const canvas = rule(list, '.hillside-canvas');
  const bleed = /^calc\(var\(--hill-blur, ([\d.]+)px\) \* ([\d.]+)\)$/.exec(
    canvas['--bleed'],
  );
  if (!bleed) throw new Error(`--bleed is ${canvas['--bleed']}`);
  const transition =
    /^opacity ([\d.]+s) ease, filter ([\d.]+s) ease ([\d.]+s)$/.exec(
      canvas.transition,
    );
  if (!transition) throw new Error(`the transition is ${canvas.transition}`);
  const soft = rule(list, '.hillside[data-soft] .hillside-canvas').filter;
  if (soft !== `blur(var(--hill-blur, ${bleed[1]}px))`)
    throw new Error(`the soft filter is ${soft}`);
  const still = media.find((r) => r.selector === '.hillside-canvas');
  if (!still || declarations(still.body).transition !== 'none')
    throw new Error('reduced motion no longer stills the canvas');

  const band = rule(list, '.live-sky');
  const scene = rule(list, '.live-sky-scene');
  const night = rule(list, ":root[data-theme='dark'] .live-sky-scene");
  const filter =
    /^grayscale\(([\d.]+)\) brightness\(([\d.]+)\) contrast\(([\d.]+)\)$/.exec(
      scene.filter,
    );
  if (!filter) throw new Error(`the live sky's filter is ${scene.filter}`);
  const mask =
    /^linear-gradient\(180deg, #000 0, rgb\(0 0 0 \/ ([\d.]+)\) var\(--sky-mid-at\), transparent var\(--sky-end\)\)$/.exec(
      scene['mask-image'],
    );
  if (!mask || scene['-webkit-mask-image'] !== scene['mask-image'])
    throw new Error(`the live sky's mask is ${scene['mask-image']}`);
  const height = /^([\d.]+)px$/.exec(scene.height);
  const crest = /^([\d.]+)%$/.exec(scene['--crest']);
  if (!height || !crest)
    throw new Error(
      `the live sky's scene is ${scene.height} at ${scene['--crest']}`,
    );

  return {
    flat: flatStops,
    defaultCrest: 0.5,
    canvas: {
      hillBlur: Number(bleed[1]),
      bleedPerBlur: Number(bleed[2]),
      fadeIn: seconds(transition[1]),
      focusDuration: seconds(transition[2]),
      focusDelay: seconds(transition[3]),
    },
    liveSky: {
      height: band.height,
      blend: band['mix-blend-mode'],
      sceneHeight: Number(height[1]),
      crest: Number(crest[1]) / 100,
      opacity: Number(scene.opacity),
      opacityAtNight: Number(night.opacity),
      grayscale: Number(filter[1]),
      brightness: Number(filter[2]),
      contrast: Number(filter[3]),
      mask: [1, Number(mask[1]), 0],
    },
  };
}

/** useSkyTaps' numbers and words, from bits.jsx's text. */
function skyTaps() {
  const text = read('src/shell/bits.jsx');
  const start = text.indexOf('export function useSkyTaps()');
  const end = text.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('bits.jsx has no useSkyTaps');
  const body = text.slice(start, end);
  const within = /now - t\.at < (\d+) \? t\.n \+ 1 : 1/.exec(body);
  const needed = /if \(t\.n >= (\d+)\)/.exec(body);
  const toasts = /toast\?\.\(liveSky \? '([^']*)' : '([^']*)'\)/.exec(body);
  if (!within || !needed || !toasts)
    throw new Error(
      'useSkyTaps is written in a way the generator does not know',
    );
  return {
    window: Number(within[1]),
    needed: Number(needed[1]),
    putAway: toasts[1],
    out: toasts[2],
  };
}

export default async function cases() {
  return [value('style', style()), value('skyTaps', skyTaps())];
}
