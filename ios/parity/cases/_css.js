// Reading the stylesheets for the theme fixture (ui.theme.js) and for the
// Swift table written from them (ios/scripts/generate-theme-tokens.mjs).
//
// Enough of CSS for src/styles/*.css, read as a browser reads it:
//
// - the rules, in order, with the @media and @supports they sit in;
// - each declaration's value as typed data: colours as RGBA (hex, rgb(),
//   rgba(), hsl(), hsla(), the named colours the sheets use, the system
//   colours of forced-colours mode, and color-mix() in sRGB), lengths as
//   the expression they are (px, rem, em, ch, vw, cqi, %, calc(), clamp(),
//   min(), max()), shadows, font stacks, cubic-bezier() and keywords, each
//   with var() where the sheet has it;
// - the cascade for the custom properties on <html> (and on a swatch inside
//   it): which rules apply for a set of data-* attributes and a viewport
//   width, which declaration wins (!important, then specificity, then the
//   later one), and what each computes to once var() is followed, as the
//   CSS Variables spec has it (a reference to a property that is missing or
//   in a cycle leaves the property with no value);
// - the arithmetic a browser does with them: color-mix() per CSS Color 5
//   (premultiplied, with its rules for missing and short percentages), and a
//   length expression in px for a viewport.
//
// Anything the sheets don't use yet throws, so a stylesheet that starts
// using it fails `npm run parity:write` loudly instead of drifting quietly.
//
// The typed JSON shapes here are the ones the Swift types encode to
// (VirgaCore/Theme/ThemeTokens+Values.swift):
//
//   colour   { red, green, blue, alpha }            each 0 to 1
//   value    { color } | { system } | { var } | { colorMix: { space, first,
//            firstPercent, second, secondPercent } } | { length } |
//            { shadow: [layer] } | { fonts: [name] } | { cubicBezier: [4] } |
//            { keyword }
//   length   { value, unit } | { number } | { var } | { op, left, right } |
//            { fn: 'calc' | 'clamp' | 'min' | 'max' | 'group', args }
//   layer    { inset, x, y, blur, spread, color }   (blur, spread, color may be null)

/* ---- the sheet ---------------------------------------------------------- */

function stringEnd(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') i += 1;
    i += 1;
  }
  return Math.min(i + 1, text.length);
}

/** The text without its comments (a string's contents are left alone). */
export function stripComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (css[i] === '"' || css[i] === "'") {
      const end = stringEnd(css, i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    out += css[i];
    i += 1;
  }
  return out;
}

/** Where the next of `chars` is at the top level (outside strings, brackets and parentheses), or -1. */
function scan(text, from, chars) {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = stringEnd(text, i);
      continue;
    }
    if (depth === 0 && chars.includes(c)) return i;
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    i += 1;
  }
  return -1;
}

/** The index just past the `}` closing the block whose `{` is at `open`. */
function blockEnd(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = stringEnd(text, i);
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  throw new Error('a block that is never closed');
}

/** Whitespace outside strings collapsed to one space, and trimmed. */
export function collapse(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (/\s/.test(c)) {
      if (out && !out.endsWith(' ')) out += ' ';
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out.trim();
}

/** Split at top-level commas (not inside parentheses, brackets or strings). */
export function splitTop(text, char = ',') {
  const parts = [];
  let from = 0;
  for (;;) {
    const at = scan(text, from, [char]);
    if (at < 0) {
      parts.push(text.slice(from));
      return parts.map((p) => p.trim());
    }
    parts.push(text.slice(from, at));
    from = at + 1;
  }
}

function parseDeclarations(body, where) {
  if (scan(body, 0, ['{']) >= 0) {
    throw new Error(
      `${where}: a nested rule, which this reader doesn't follow`,
    );
  }
  const out = [];
  for (const part of splitTop(body, ';')) {
    if (!part) continue;
    const colon = part.indexOf(':');
    if (colon < 0) throw new Error(`${where}: not a declaration: ${part}`);
    const rawName = part.slice(0, colon).trim();
    const name = rawName.startsWith('--') ? rawName : rawName.toLowerCase();
    let value = collapse(part.slice(colon + 1));
    let important = false;
    const bang = /\s*!\s*important$/i.exec(value);
    if (bang) {
      important = true;
      value = value.slice(0, bang.index).trim();
    }
    out.push({ name, css: value, important });
  }
  return out;
}

/**
 * The rules of a stylesheet, in order: `{ file, selectors, media, supports,
 * declarations: [{ name, css, important }] }`. `media` and `supports` are
 * the conditions the rule sits in (joined with " and " when nested), or
 * null. @keyframes, @font-face and statements are passed over.
 */
export function parseStylesheet(css, file, out = [], context = {}) {
  const text = stripComments(css);
  let i = 0;
  while (i < text.length) {
    const next = scan(text, i, ['{', ';', '}']);
    if (next < 0) {
      if (text.slice(i).trim())
        throw new Error(`${file}: text after the last rule`);
      break;
    }
    if (text[next] !== '{') {
      // A statement (@import, @charset) or a stray brace.
      if (text[next] === '}' && text.slice(i, next).trim()) {
        throw new Error(`${file}: a rule with no block`);
      }
      i = next + 1;
      continue;
    }
    const prelude = collapse(text.slice(i, next));
    const end = blockEnd(text, next);
    const body = text.slice(next + 1, end - 1);
    const at = /^@([a-z-]+)\s*(.*)$/i.exec(prelude);
    if (at) {
      const kind = at[1].toLowerCase();
      if (kind === 'media' || kind === 'supports') {
        const join = (a, b) => (a ? `${a} and ${b}` : b);
        parseStylesheet(body, file, out, {
          ...context,
          [kind]: join(context[kind], at[2]),
        });
      }
      // @keyframes, @font-face, @page and the rest hold no rules for <html>.
    } else {
      out.push({
        file,
        selectors: splitTop(prelude).map(collapse),
        media: context.media || null,
        supports: context.supports || null,
        declarations: parseDeclarations(body, `${file} ${prelude}`),
        order: out.length,
      });
    }
    i = end;
  }
  return out;
}

/* ---- selectors and media ------------------------------------------------ */

const SIMPLE =
  /:root|\[([A-Za-z][\w-]*)=(?:'([^']*)'|"([^"]*)"|([A-Za-z_][\w-]*))\]/y;

/**
 * A selector made of `:root` and `[attr='value']` compounds joined by the
 * descendant combinator, as theme.css writes the rules for its tokens:
 * `{ compounds: [[{ root: true } | { attr, value }]], specificity }`.
 * Null for anything else (a class, a pseudo-element, another combinator).
 */
export function parseRootSelector(selector) {
  const compounds = [];
  for (const compound of collapse(selector).split(' ')) {
    const parts = [];
    SIMPLE.lastIndex = 0;
    while (SIMPLE.lastIndex < compound.length) {
      const m = SIMPLE.exec(compound);
      if (!m) return null;
      parts.push(
        m[0] === ':root'
          ? { root: true }
          : { attr: m[1], value: m[2] ?? m[3] ?? m[4] },
      );
    }
    if (parts.length === 0) return null;
    compounds.push(parts);
  }
  return { compounds, specificity: compounds.flat().length };
}

/** A selector as theme.css writes it, from its parts. */
export function selectorText(sel) {
  return sel.compounds
    .map((c) =>
      c.map((p) => (p.root ? ':root' : `[${p.attr}='${p.value}']`)).join(''),
    )
    .join(' ');
}

/**
 * A media query the token rules may sit in: `(max-width: Npx)`,
 * `(min-width: Npx)` or `(forced-colors: active)`, or several joined with
 * "and". Null when it says anything else.
 */
export function parseMedia(media) {
  const features = [];
  for (const part of media.split(/\s+and\s+/)) {
    let m = /^\(\s*(max|min)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(part);
    if (m) {
      features.push({
        [m[1] === 'max' ? 'maxWidth' : 'minWidth']: Number(m[2]),
      });
      continue;
    }
    m = /^\(\s*forced-colors\s*:\s*active\s*\)$/.exec(part);
    if (m) {
      features.push({ forcedColors: true });
      continue;
    }
    return null;
  }
  return features;
}

/** Whether a media query holds for a viewport (`{ width, forcedColors }`). */
export function mediaMatches(media, env) {
  const features = parseMedia(media);
  if (!features)
    throw new Error(`a media query the theme can't evaluate: ${media}`);
  return features.every((f) =>
    'maxWidth' in f
      ? env.width <= f.maxWidth
      : 'minWidth' in f
        ? env.width >= f.minWidth
        : Boolean(env.forcedColors),
  );
}

/* ---- values: tokens and component values ---------------------------------- */

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^(?:--|-?[A-Za-z_])[\w-]*/;

function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const rest = text.slice(i);
    if (/\s/.test(c)) {
      while (i < text.length && /\s/.test(text[i])) i += 1;
      out.push({ t: 'ws' });
      continue;
    }
    if (c === '"' || c === "'") {
      const end = stringEnd(text, i);
      out.push({
        t: 'string',
        v: text.slice(i + 1, end - 1).replace(/\\(.)/g, '$1'),
      });
      i = end;
      continue;
    }
    if (c === '#') {
      const m = /^#[\w-]+/.exec(rest);
      if (m) {
        out.push({ t: 'hash', v: m[0].slice(1) });
        i += m[0].length;
        continue;
      }
    }
    const n = NUMBER.exec(rest);
    if (n) {
      i += n[0].length;
      const v = Number(n[0]);
      if (text[i] === '%') {
        out.push({ t: 'percent', v });
        i += 1;
        continue;
      }
      const unit = /^[A-Za-z_][\w-]*/.exec(text.slice(i));
      if (unit) {
        out.push({ t: 'dim', v, unit: unit[0].toLowerCase() });
        i += unit[0].length;
        continue;
      }
      out.push({ t: 'number', v });
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      i += id[0].length;
      if (text[i] === '(') {
        out.push({ t: 'function', v: id[0].toLowerCase() });
        i += 1;
        continue;
      }
      out.push({ t: 'ident', v: id[0] });
      continue;
    }
    out.push({
      t:
        c === '('
          ? 'open'
          : c === ')'
            ? 'close'
            : c === ','
              ? 'comma'
              : 'delim',
      v: c,
    });
    i += 1;
  }
  return out;
}

/** Component values: functions and parentheses hold their contents. */
function components(text) {
  const tokens = tokenize(text);
  let i = 0;
  const read = (inside) => {
    const out = [];
    while (i < tokens.length) {
      const tok = tokens[i];
      i += 1;
      if (tok.t === 'close') {
        if (!inside) throw new Error(`an unmatched ")" in ${text}`);
        return out;
      }
      if (tok.t === 'function')
        out.push({ t: 'fn', name: tok.v, items: read(true) });
      else if (tok.t === 'open') out.push({ t: 'paren', items: read(true) });
      else out.push(tok);
    }
    if (inside) throw new Error(`an unclosed "(" in ${text}`);
    return out;
  };
  return read(false);
}

/** A list of component values split at its commas, each part trimmed of whitespace. */
function commaList(items) {
  const parts = [[]];
  for (const item of items) {
    if (item.t === 'comma') parts.push([]);
    else parts[parts.length - 1].push(item);
  }
  return parts.map(trimWs);
}

function trimWs(items) {
  let a = 0;
  let b = items.length;
  while (a < b && items[a].t === 'ws') a += 1;
  while (b > a && items[b - 1].t === 'ws') b -= 1;
  return items.slice(a, b);
}

/** The space-separated parts of a list (whitespace dropped). */
function spaced(items) {
  return items.filter((item) => item.t !== 'ws');
}

function show(items) {
  return items
    .map((it) => {
      switch (it.t) {
        case 'fn':
          return `${it.name}(${show(it.items)})`;
        case 'paren':
          return `(${show(it.items)})`;
        case 'ws':
          return ' ';
        case 'dim':
          return `${it.v}${it.unit}`;
        case 'percent':
          return `${it.v}%`;
        case 'hash':
          return `#${it.v}`;
        case 'string':
          return JSON.stringify(it.v);
        default:
          return String(it.v);
      }
    })
    .join('');
}

/* ---- colours -------------------------------------------------------------- */

/** The colour keywords the sheets use. */
const NAMED = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [255, 255, 255, 1],
};

/** The system colours of forced-colours mode (CSS Color 4). */
export const SYSTEM_COLORS = [
  'AccentColor',
  'AccentColorText',
  'ActiveText',
  'ButtonBorder',
  'ButtonFace',
  'ButtonText',
  'Canvas',
  'CanvasText',
  'Field',
  'FieldText',
  'GrayText',
  'Highlight',
  'HighlightText',
  'LinkText',
  'Mark',
  'MarkText',
  'SelectedItem',
  'SelectedItemText',
  'VisitedText',
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** A colour from 0-255 channels and a 0-1 alpha, clamped as a computed value is. */
export function rgba(r, g, b, a = 1) {
  return {
    red: clamp01(r / 255),
    green: clamp01(g / 255),
    blue: clamp01(b / 255),
    alpha: clamp01(a),
  };
}

function hexColour(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) {
    throw new Error(`not a hex colour: #${hex}`);
  }
  const full = hex.length <= 4 ? hex.replace(/./g, '$&$&') : hex;
  const byte = (k) => parseInt(full.slice(k, k + 2), 16);
  return {
    red: byte(0) / 255,
    green: byte(2) / 255,
    blue: byte(4) / 255,
    alpha: full.length === 8 ? byte(6) / 255 : 1,
  };
}

/** The numeric arguments of rgb()/hsl(), in either syntax: [[...channels], alpha | undefined]. */
function colourArgs(fn) {
  const commas = commaList(fn.items);
  let parts;
  let alpha;
  if (commas.length > 1) {
    parts = commas.map((p) => {
      const s = spaced(p);
      if (s.length !== 1)
        throw new Error(`not a colour: ${fn.name}(${show(fn.items)})`);
      return s[0];
    });
    if (parts.length === 4) alpha = parts.pop();
  } else {
    const s = spaced(fn.items);
    const slash = s.findIndex((it) => it.t === 'delim' && it.v === '/');
    parts = slash < 0 ? s : s.slice(0, slash);
    if (slash >= 0) {
      if (s.length !== slash + 2)
        throw new Error(`not a colour: ${fn.name}(${show(fn.items)})`);
      alpha = s[slash + 1];
    }
  }
  if (parts.length !== 3)
    throw new Error(`not a colour: ${fn.name}(${show(fn.items)})`);
  return [parts, alpha];
}

function alphaOf(token) {
  if (token === undefined) return 1;
  if (token.t === 'number') return token.v;
  if (token.t === 'percent') return token.v / 100;
  throw new Error(`not an alpha: ${show([token])}`);
}

function rgbFunction(fn) {
  const [parts, alpha] = colourArgs(fn);
  const channel = (tok) => {
    if (tok.t === 'number') return tok.v;
    if (tok.t === 'percent') return (tok.v / 100) * 255;
    throw new Error(`not a channel: ${show([tok])}`);
  };
  const [r, g, b] = parts.map(channel);
  return rgba(r, g, b, alphaOf(alpha));
}

/** hsl() to sRGB, as CSS Color 4 §7.1 writes it. */
export function hslToRgb(hue, saturation, lightness) {
  let h = hue % 360;
  if (h < 0) h += 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function hslFunction(fn) {
  const [parts, alpha] = colourArgs(fn);
  const [h, s, l] = parts;
  let hue;
  if (h.t === 'number') hue = h.v;
  else if (h.t === 'dim') {
    const per = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[h.unit];
    if (per === undefined) throw new Error(`not a hue: ${show([h])}`);
    hue = h.v * per;
  } else throw new Error(`not a hue: ${show([h])}`);
  const pct = (tok) => {
    if (tok.t === 'percent' || tok.t === 'number')
      return Math.min(100, Math.max(0, tok.v));
    throw new Error(`not a percentage: ${show([tok])}`);
  };
  const [r, g, b] = hslToRgb(hue, pct(s), pct(l));
  return {
    red: clamp01(r),
    green: clamp01(g),
    blue: clamp01(b),
    alpha: clamp01(alphaOf(alpha)),
  };
}

/** One component as a colour value (a literal, var(), color-mix() or a system colour), or null. */
function colourValue(item) {
  if (item.t === 'hash') return { color: hexColour(item.v) };
  if (item.t === 'ident') {
    const named = NAMED[item.v.toLowerCase()];
    if (named) return { color: rgba(...named) };
    const system = SYSTEM_COLORS.find(
      (s) => s.toLowerCase() === item.v.toLowerCase(),
    );
    if (system) return { system };
    return null;
  }
  if (item.t !== 'fn') return null;
  switch (item.name) {
    case 'var':
      return varValue(item);
    case 'rgb':
    case 'rgba':
      return { color: rgbFunction(item) };
    case 'hsl':
    case 'hsla':
      return { color: hslFunction(item) };
    case 'color-mix':
      return colorMixValue(item);
    default:
      return null;
  }
}

function varValue(fn) {
  const parts = commaList(fn.items);
  const name = spaced(parts[0]);
  if (
    name.length !== 1 ||
    name[0].t !== 'ident' ||
    !name[0].v.startsWith('--')
  ) {
    throw new Error(`not a var(): var(${show(fn.items)})`);
  }
  if (parts.length > 1) {
    throw new Error(
      `var(${show(fn.items)}): a fallback, which the theme doesn't follow`,
    );
  }
  return { var: name[0].v };
}

function colorMixValue(fn) {
  const parts = commaList(fn.items);
  if (parts.length !== 3)
    throw new Error(`not a color-mix(): ${show(fn.items)}`);
  const space = spaced(parts[0]);
  if (space.length !== 2 || space[0].v !== 'in' || space[1].t !== 'ident') {
    throw new Error(`not a color-mix(): ${show(fn.items)}`);
  }
  if (space[1].v !== 'srgb') {
    throw new Error(`color-mix(in ${space[1].v}, …): only srgb is read here`);
  }
  const side = (items) => {
    const s = spaced(items);
    let percent = null;
    const rest = [];
    for (const it of s) {
      if (it.t === 'percent') {
        if (percent !== null)
          throw new Error(`two percentages in color-mix(${show(fn.items)})`);
        percent = it.v;
      } else rest.push(it);
    }
    const colour = rest.length === 1 ? colourValue(rest[0]) : null;
    if (!colour)
      throw new Error(`not a colour in color-mix(${show(fn.items)})`);
    if (percent !== null && (percent < 0 || percent > 100)) {
      throw new Error(
        `a percentage outside 0-100 in color-mix(${show(fn.items)})`,
      );
    }
    return [colour, percent];
  };
  const [first, firstPercent] = side(parts[1]);
  const [second, secondPercent] = side(parts[2]);
  if (firstPercent === 0 && secondPercent === 0) {
    throw new Error(`color-mix(${show(fn.items)}): both percentages zero`);
  }
  return {
    colorMix: { space: 'srgb', first, firstPercent, second, secondPercent },
  };
}

/**
 * color-mix(in srgb, a p1, b p2) as CSS Color 5 §2 computes it: missing
 * percentages from the other (or 50% each), the pair scaled to sum to 100%
 * with any shortfall kept as a multiplier on the alpha, and the channels
 * mixed premultiplied by their alphas.
 */
export function mixColours(a, p1, b, p2) {
  let w1 = p1;
  let w2 = p2;
  if (w1 === null && w2 === null) {
    w1 = 50;
    w2 = 50;
  } else if (w1 === null) w1 = 100 - w2;
  else if (w2 === null) w2 = 100 - w1;
  const sum = w1 + w2;
  if (sum === 0) return null;
  const multiplier = sum < 100 ? sum / 100 : 1;
  const f1 = w1 / sum;
  const f2 = w2 / sum;
  const alpha = a.alpha * f1 + b.alpha * f2;
  const channel = (k) =>
    alpha === 0 ? 0 : (a[k] * a.alpha * f1 + b[k] * b.alpha * f2) / alpha;
  return {
    red: channel('red'),
    green: channel('green'),
    blue: channel('blue'),
    alpha: alpha * multiplier,
  };
}

/* ---- lengths --------------------------------------------------------------- */

const LENGTH_UNITS = new Set([
  'px',
  'rem',
  'em',
  'ch',
  'vw',
  'vh',
  'svh',
  'dvh',
  'cqi',
]);
const MATH = new Set(['calc', 'clamp', 'min', 'max']);

/** One component as a length (or a number, inside an expression), or null. */
function lengthValue(item) {
  if (item.t === 'dim' && LENGTH_UNITS.has(item.unit))
    return { value: item.v, unit: item.unit };
  if (item.t === 'number' && item.v === 0) return { number: 0 };
  if (item.t === 'percent') return { value: item.v, unit: '%' };
  if (item.t === 'fn' && item.name === 'var') return varValue(item);
  if (item.t === 'fn' && MATH.has(item.name)) {
    const args = commaList(item.items).map((arg) => sum(arg, item));
    const count = {
      calc: [1, 1],
      clamp: [3, 3],
      min: [1, Infinity],
      max: [1, Infinity],
    }[item.name];
    if (args.length < count[0] || args.length > count[1]) {
      throw new Error(`${item.name}() with ${args.length} arguments`);
    }
    return { fn: item.name, args };
  }
  return null;
}

/** A calc() sum: products joined by + and - (which CSS wants spaced). */
function sum(items, within) {
  const s = spaced(items);
  let i = 0;
  const unit = () => {
    const it = s[i];
    i += 1;
    if (!it)
      throw new Error(
        `an expression that ends early in ${within.name}(${show(within.items)})`,
      );
    if (it.t === 'number') return { number: it.v };
    if (it.t === 'paren') return { fn: 'group', args: [sum(it.items, within)] };
    const v = lengthValue(it);
    if (!v)
      throw new Error(
        `not a length: ${show([it])} in ${within.name}(${show(within.items)})`,
      );
    return v;
  };
  const product = () => {
    let left = unit();
    while (
      i < s.length &&
      s[i].t === 'delim' &&
      (s[i].v === '*' || s[i].v === '/')
    ) {
      const op = s[i].v;
      i += 1;
      left = { op, left, right: unit() };
    }
    return left;
  };
  let left = product();
  while (i < s.length) {
    const it = s[i];
    if (it.t !== 'delim' || (it.v !== '+' && it.v !== '-')) {
      throw new Error(`not an expression: ${show(items)}`);
    }
    i += 1;
    left = { op: it.v, left, right: product() };
  }
  return left;
}

/** Whether a length expression mentions a unit (or var()) anywhere. */
export function lengthUses(expr, test) {
  if (test(expr)) return true;
  if (expr.op)
    return lengthUses(expr.left, test) || lengthUses(expr.right, test);
  if (expr.fn) return expr.args.some((a) => lengthUses(a, test));
  return false;
}

/**
 * A length expression in px, as a browser computes it at its use: rem from
 * a 16px root, em from `fontSize`, vw from the viewport, cqi from
 * `containerWidth` (the viewport when there is no container, as CSS falls
 * back to), ch from `chWidth`. Null when it needs a measure the context
 * doesn't give (ch without chWidth, a percentage), or isn't a length.
 */
export function evaluateLength(expr, ctx) {
  const fontSize = ctx.fontSize ?? 16;
  const rootFontSize = ctx.rootFontSize ?? 16;
  const container = ctx.containerWidth ?? ctx.width;
  const go = (e) => {
    if ('number' in e) return e.number;
    if ('var' in e) return null;
    if ('unit' in e) {
      switch (e.unit) {
        case 'px':
          return e.value;
        case 'rem':
          return e.value * rootFontSize;
        case 'em':
          return e.value * fontSize;
        case 'vw':
          return (e.value * ctx.width) / 100;
        case 'cqi':
          return (e.value * container) / 100;
        case 'ch':
          return ctx.chWidth == null ? null : e.value * ctx.chWidth;
        default:
          return null;
      }
    }
    if (e.op) {
      const a = go(e.left);
      const b = go(e.right);
      if (a === null || b === null) return null;
      switch (e.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        default:
          return a / b;
      }
    }
    const args = e.args.map(go);
    if (args.some((a) => a === null)) return null;
    switch (e.fn) {
      case 'calc':
      case 'group':
        return args[0];
      case 'min':
        return Math.min(...args);
      case 'max':
        return Math.max(...args);
      default:
        // clamp(MIN, VAL, MAX) is max(MIN, min(VAL, MAX)): MIN wins a tie with MAX.
        return Math.max(args[0], Math.min(args[1], args[2]));
    }
  };
  return go(expr);
}

/* ---- typed values ----------------------------------------------------------- */

function fontName(items) {
  const s = spaced(items);
  if (s.length === 1 && s[0].t === 'string') return s[0].v;
  if (s.length > 0 && s.every((it) => it.t === 'ident'))
    return s.map((it) => it.v).join(' ');
  return null;
}

function shadowLayer(items, css) {
  let inset = false;
  const lengths = [];
  let color = null;
  for (const it of spaced(items)) {
    if (it.t === 'ident' && it.v === 'inset') {
      inset = true;
      continue;
    }
    const isLength =
      (it.t === 'dim' && LENGTH_UNITS.has(it.unit)) ||
      (it.t === 'number' && it.v === 0) ||
      (it.t === 'fn' && MATH.has(it.name));
    if (isLength) {
      const v = lengthValue(it);
      lengths.push('number' in v ? { value: v.number, unit: 'px' } : v);
      continue;
    }
    const c = colourValue(it);
    if (c && color === null) {
      color = c;
      continue;
    }
    throw new Error(`not a shadow: ${css}`);
  }
  if (lengths.length < 2 || lengths.length > 4)
    throw new Error(`not a shadow: ${css}`);
  return {
    inset,
    x: lengths[0],
    y: lengths[1],
    blur: lengths[2] ?? null,
    spread: lengths[3] ?? null,
    color,
  };
}

/**
 * A custom property's value as typed data: a colour, a length, a shadow
 * (several layers, or one of two to four lengths and a colour), a font
 * stack, a cubic-bezier(), a keyword, or var() of another.
 */
export function parseValue(css) {
  const list = commaList(components(css));
  if (list.length > 1) {
    const fonts = list.map(fontName);
    if (fonts.every(Boolean)) return { fonts };
    return { shadow: list.map((p) => shadowLayer(p, css)) };
  }
  const parts = spaced(list[0]);
  if (parts.length === 0) throw new Error('an empty value');
  if (parts.length > 1) {
    const name = fontName(list[0]);
    if (name) return { fonts: [name] };
    return { shadow: [shadowLayer(list[0], css)] };
  }
  const [it] = parts;
  if (it.t === 'string') return { fonts: [it.v] };
  if (it.t === 'fn' && it.name === 'var') return varValue(it);
  if (it.t === 'fn' && it.name === 'cubic-bezier') {
    const nums = commaList(it.items).map((p) => spaced(p));
    if (
      nums.length !== 4 ||
      nums.some((p) => p.length !== 1 || p[0].t !== 'number')
    ) {
      throw new Error(`not a cubic-bezier(): ${css}`);
    }
    return { cubicBezier: nums.map((p) => p[0].v) };
  }
  const colour = colourValue(it);
  if (colour) return colour;
  const length = lengthValue(it);
  if (length) {
    if ('number' in length && length.number === 0)
      return { length: { value: 0, unit: 'px' } };
    return { length };
  }
  if (it.t === 'ident') return { keyword: it.v };
  throw new Error(`a value the theme can't read: ${css}`);
}

/* ---- the cascade --------------------------------------------------------------- */

/**
 * The rules that set custom properties (or color-scheme) on <html>, in
 * cascade order across the sheets given (in the order the app loads them):
 * `{ file, selectors: [text], media, declarations: [{ name, css, important,
 * value }] }`. A rule that sets one but isn't written for <html> (a class,
 * say) is a component's own token, not the theme's, and is left out; one
 * written for <html> under a media query this reader can't evaluate throws.
 */
export function tokenBlocks(rules) {
  const blocks = [];
  for (const rule of rules) {
    const decls = rule.declarations.filter(
      (d) => d.name.startsWith('--') || d.name === 'color-scheme',
    );
    if (decls.length === 0) continue;
    const selectors = rule.selectors.map(parseRootSelector);
    if (selectors.some((s) => s === null)) continue;
    if (rule.supports)
      throw new Error(
        `${rule.file}: theme tokens inside @supports (${rule.supports})`,
      );
    if (rule.media && !parseMedia(rule.media)) {
      throw new Error(
        `${rule.file}: theme tokens inside a media query the theme can't evaluate: ${rule.media}`,
      );
    }
    if (decls.length !== rule.declarations.length) {
      const other = rule.declarations.find((d) => !decls.includes(d));
      throw new Error(
        `${rule.file} ${rule.selectors.join(', ')}: ${other.name} beside the tokens`,
      );
    }
    blocks.push({
      file: rule.file,
      selectors: selectors.map(selectorText),
      media: rule.media,
      declarations: decls.map((d) => ({ ...d, value: parseValue(d.css) })),
    });
  }
  return blocks;
}

const holds = (compound, el) =>
  compound.every((p) => (p.root ? el.root : el.attrs[p.attr] === p.value));

/** Whether a selector picks out `el`, whose ancestors (nearest first) are `ancestors`. */
function selectorMatches(sel, el, ancestors) {
  const n = sel.compounds.length;
  if (!holds(sel.compounds[n - 1], el)) return false;
  let a = 0;
  for (let k = n - 2; k >= 0; k -= 1) {
    while (a < ancestors.length && !holds(sel.compounds[k], ancestors[a]))
      a += 1;
    if (a === ancestors.length) return false;
    a += 1;
  }
  return true;
}

/** Whether one cascade rank ([important, specificity, rule, declaration]) beats another. */
function outranks(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The declaration that wins for each property on `el`: !important, then specificity, then the later. */
export function declared(blocks, el, ancestors, env) {
  const winners = new Map();
  blocks.forEach((block, b) => {
    if (block.media && !mediaMatches(block.media, env)) return;
    let specificity = -1;
    for (const text of block.selectors) {
      const sel = parseRootSelector(text);
      if (selectorMatches(sel, el, ancestors))
        specificity = Math.max(specificity, sel.specificity);
    }
    if (specificity < 0) return;
    block.declarations.forEach((d, k) => {
      const rank = [d.important ? 1 : 0, specificity, b, k];
      const prev = winners.get(d.name);
      if (!prev || outranks(rank, prev.rank))
        winners.set(d.name, { declaration: d, rank });
    });
  });
  return new Map([...winners].map(([name, w]) => [name, w.declaration]));
}

const INVALID = Symbol('invalid');

/**
 * Follow var() through a value, with `lookup(name)` giving a property's
 * computed value (or INVALID). A colour inside color-mix() or a shadow has
 * to come out a colour, and a length inside an expression a length; a bare
 * sum substituted into an expression is token-level in CSS (its operators
 * would bind with the ones around it), which this doesn't do, so it throws.
 */
function substitute(value, lookup) {
  const colour = (v) => {
    const out = substitute(v, lookup);
    if (out === INVALID) return INVALID;
    return 'color' in out || 'system' in out ? out : INVALID;
  };
  const length = (e, nested) => {
    if ('var' in e) {
      const out = lookup(e.var);
      if (out === INVALID || !('length' in out)) return INVALID;
      if (nested && out.length.op) {
        throw new Error(
          `var(${e.var}) is a bare expression, substituted inside another`,
        );
      }
      return out.length;
    }
    if (e.op) {
      const left = length(e.left, true);
      const right = length(e.right, true);
      return left === INVALID || right === INVALID
        ? INVALID
        : { op: e.op, left, right };
    }
    if (e.fn) {
      const args = e.args.map((a) => length(a, false));
      return args.includes(INVALID) ? INVALID : { fn: e.fn, args };
    }
    return e;
  };
  if ('var' in value) return lookup(value.var);
  if ('colorMix' in value) {
    const m = value.colorMix;
    const first = colour(m.first);
    const second = colour(m.second);
    if (first === INVALID || second === INVALID) return INVALID;
    if ('system' in first || 'system' in second) {
      return { colorMix: { ...m, first, second } };
    }
    const mixed = mixColours(
      first.color,
      m.firstPercent,
      second.color,
      m.secondPercent,
    );
    return mixed ? { color: mixed } : INVALID;
  }
  if ('length' in value) {
    const out = length(value.length, false);
    return out === INVALID ? INVALID : { length: out };
  }
  if ('shadow' in value) {
    const layers = [];
    for (const layer of value.shadow) {
      const parts = ['x', 'y', 'blur', 'spread'].map((k) =>
        layer[k] === null ? null : length(layer[k], false),
      );
      if (parts.includes(INVALID)) return INVALID;
      const color = layer.color === null ? null : colour(layer.color);
      if (color === INVALID) return INVALID;
      layers.push({
        inset: layer.inset,
        x: parts[0],
        y: parts[1],
        blur: parts[2],
        spread: parts[3],
        color,
      });
    }
    return { shadow: layers };
  }
  return value;
}

/**
 * The computed value of every custom property on an element: its own
 * declarations with var() followed (in its own values, which for a property
 * it doesn't declare are the ones it inherits), and the rest inherited.
 * A property whose var() leads nowhere, or round in a circle, has none.
 */
export function computed(decls, inherited = new Map()) {
  const out = new Map(inherited);
  const state = new Map();
  const compute = (name) => {
    if (!decls.has(name))
      return inherited.has(name) ? inherited.get(name) : INVALID;
    if (state.get(name) === 'done')
      return out.has(name) ? out.get(name) : INVALID;
    if (state.get(name) === 'visiting') return INVALID;
    state.set(name, 'visiting');
    const value = substitute(decls.get(name).value, compute);
    state.set(name, 'done');
    if (value === INVALID) out.delete(name);
    else out.set(name, value);
    return value;
  };
  for (const name of decls.keys()) compute(name);
  return out;
}

/** <html> for a set of attributes (`{ sky, theme, accent, contrast, density }`). */
export function rootElement(attrs) {
  return {
    root: true,
    attrs: {
      'data-sky': attrs.sky,
      'data-theme': attrs.theme,
      'data-accent': attrs.accent,
      'data-contrast': attrs.contrast,
      'data-density': attrs.density,
    },
  };
}

/** Every custom property on <html>, computed, for a set of attributes and a viewport. */
export function resolveRoot(blocks, attrs, env) {
  return computed(declared(blocks, rootElement(attrs), [], env));
}

/**
 * The custom properties of a swatch: an element inside the page that
 * carries data-accent and nothing else (Settings draws the accents with
 * them). It inherits what <html> computed and computes its own.
 */
export function resolveSwatch(blocks, attrs, accent, env) {
  const root = rootElement(attrs);
  const el = { root: false, attrs: { 'data-accent': accent } };
  return computed(
    declared(blocks, el, [root], env),
    resolveRoot(blocks, attrs, env),
  );
}

/** Only the properties a swatch declares itself (the rest it inherits from <html>). */
export function swatchOwn(blocks, attrs, accent, env) {
  const root = rootElement(attrs);
  const el = { root: false, attrs: { 'data-accent': accent } };
  const decls = declared(blocks, el, [root], env);
  const all = computed(decls, resolveRoot(blocks, attrs, env));
  return new Map(
    [...decls.keys()].map((name) => [
      name,
      all.has(name) ? all.get(name) : null,
    ]),
  );
}

/* ---- the kit's own values ---------------------------------------------------------- */

const TIME = (it) => {
  if (it.t === 'dim' && it.unit === 's') return it.v;
  if (it.t === 'dim' && it.unit === 'ms') return it.v / 1000;
  if (it.t === 'number' && it.v === 0) return 0;
  return null;
};

const EASINGS = new Set([
  'ease',
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
]);

function easing(it) {
  if (it.t === 'ident' && EASINGS.has(it.v)) return { keyword: it.v };
  if (it.t === 'fn' && it.name === 'var') return varValue(it);
  if (it.t === 'fn' && it.name === 'cubic-bezier')
    return parseValue(show([it]));
  return null;
}

function lengthsOf(css) {
  const parts = spaced(components(css));
  return parts.map((it) => {
    const v = lengthValue(it);
    if (!v) throw new Error(`not a length: ${show([it])} in ${css}`);
    return 'number' in v ? { value: v.number, unit: 'px' } : v;
  });
}

/**
 * A declaration of the kit as typed data, read as `kind` says:
 *
 *   length       one length            { length }
 *   box          1-4 lengths (padding, margin, radius), as CSS spreads them
 *                to { top, right, bottom, left }
 *   gap          1-2 lengths            { row, column }
 *   number       a number               { number }
 *   color        a colour value         (as parseValue)
 *   shadow       box-shadow             { shadow }
 *   border       width style colour     { border: { width, style, color } }
 *   transitions  transition             { transitions: [{ property, duration, easing, delay }] }
 *   animation    animation              { animation: { name, duration, easing, delay, iterations, infinite, fill } }
 *   gradient     linear-gradient()      { gradient: { angle, stops: [{ color, position }] } }
 *   keyword      an identifier          { keyword }
 *   value        a custom property      (as parseValue)
 *   time         a duration             { time } (seconds)
 */
export function parseKitValue(kind, css) {
  switch (kind) {
    case 'length': {
      const [v, ...rest] = lengthsOf(css);
      if (rest.length) throw new Error(`one length, not several: ${css}`);
      return { length: v };
    }
    case 'box': {
      const v = lengthsOf(css);
      if (v.length < 1 || v.length > 4) throw new Error(`not a box: ${css}`);
      const [top, right = top, bottom = top, left = right] = v;
      return { box: { top, right, bottom, left } };
    }
    case 'gap': {
      const v = lengthsOf(css);
      if (v.length < 1 || v.length > 2) throw new Error(`not a gap: ${css}`);
      return { gap: { row: v[0], column: v[1] ?? v[0] } };
    }
    case 'number': {
      const parts = spaced(components(css));
      if (parts.length !== 1 || parts[0].t !== 'number')
        throw new Error(`not a number: ${css}`);
      return { number: parts[0].v };
    }
    case 'time': {
      const parts = spaced(components(css));
      const t = parts.length === 1 ? TIME(parts[0]) : null;
      if (t === null) throw new Error(`not a time: ${css}`);
      return { time: t };
    }
    case 'color': {
      const parts = spaced(components(css));
      const c = parts.length === 1 ? colourValue(parts[0]) : null;
      if (!c) throw new Error(`not a colour: ${css}`);
      return c;
    }
    case 'shadow':
      return {
        shadow: commaList(components(css)).map((p) => shadowLayer(p, css)),
      };
    case 'border': {
      const parts = spaced(components(css));
      let width = null;
      let style = null;
      let color = null;
      for (const it of parts) {
        const l = lengthValue(it);
        if (l && width === null && !('var' in l)) {
          width = 'number' in l ? { value: l.number, unit: 'px' } : l;
        } else if (
          it.t === 'ident' &&
          style === null &&
          /^(solid|dashed|dotted|double|none)$/.test(it.v)
        ) {
          style = it.v;
        } else if (color === null && colourValue(it)) {
          color = colourValue(it);
        } else throw new Error(`not a border: ${css}`);
      }
      return { border: { width, style, color } };
    }
    case 'transitions':
      return {
        transitions: commaList(components(css)).map((p) => {
          let property = null;
          const times = [];
          let ease = null;
          for (const it of spaced(p)) {
            const t = TIME(it);
            if (t !== null && it.t !== 'number') times.push(t);
            else if (ease === null && easing(it)) ease = easing(it);
            else if (property === null && it.t === 'ident') property = it.v;
            else throw new Error(`not a transition: ${css}`);
          }
          return {
            property: property ?? 'all',
            duration: times[0] ?? 0,
            easing: ease ?? { keyword: 'ease' },
            delay: times[1] ?? 0,
          };
        }),
      };
    case 'animation': {
      const parts = spaced(components(css));
      let name = null;
      const times = [];
      let ease = null;
      let iterations = 1;
      let infinite = false;
      let fill = 'none';
      for (const it of parts) {
        const t = TIME(it);
        if (t !== null && it.t !== 'number') times.push(t);
        else if (ease === null && easing(it)) ease = easing(it);
        else if (it.t === 'ident' && it.v === 'infinite') infinite = true;
        else if (it.t === 'number') iterations = it.v;
        else if (
          it.t === 'ident' &&
          /^(none|forwards|backwards|both)$/.test(it.v) &&
          name !== null
        )
          fill = it.v;
        else if (it.t === 'ident' && name === null) name = it.v;
        else throw new Error(`not an animation: ${css}`);
      }
      return {
        animation: {
          name,
          duration: times[0] ?? 0,
          easing: ease ?? { keyword: 'ease' },
          delay: times[1] ?? 0,
          iterations,
          infinite,
          fill,
        },
      };
    }
    case 'gradient': {
      const parts = spaced(components(css));
      if (
        parts.length !== 1 ||
        parts[0].t !== 'fn' ||
        parts[0].name !== 'linear-gradient'
      ) {
        throw new Error(`not a linear-gradient(): ${css}`);
      }
      const args = commaList(parts[0].items);
      let angle = 180;
      const first = spaced(args[0]);
      // `to <side>` is the angle that points at that side.
      const SIDES = { top: 0, right: 90, bottom: 180, left: 270 };
      if (
        first.length === 1 &&
        first[0].t === 'dim' &&
        first[0].unit === 'deg'
      ) {
        angle = first[0].v;
        args.shift();
      } else if (
        first.length === 2 &&
        first[0].t === 'ident' &&
        first[0].v === 'to' &&
        first[1].t === 'ident' &&
        first[1].v in SIDES
      ) {
        angle = SIDES[first[1].v];
        args.shift();
      }
      return {
        gradient: {
          angle,
          stops: args.map((stop) => {
            const s = spaced(stop);
            const color = colourValue(s[0]);
            if (!color || s.length > 2)
              throw new Error(`not a colour stop: ${show(stop)}`);
            let position = null;
            if (s.length === 2) {
              position = lengthValue(s[1]);
              if (!position)
                throw new Error(`not a stop position: ${show(stop)}`);
              if ('number' in position)
                position = { value: position.number, unit: 'px' };
            }
            return { color, position };
          }),
        },
      };
    }
    case 'keyword': {
      const parts = spaced(components(css));
      if (parts.length !== 1 || parts[0].t !== 'ident')
        throw new Error(`not a keyword: ${css}`);
      return { keyword: parts[0].v };
    }
    case 'value':
      return parseValue(css);
    default:
      throw new Error(`no such kind: ${kind}`);
  }
}

/** The declaration `property` of the rule for `selector` (in `media`, or at the top level) in a sheet's rules. */
export function findDeclaration(
  rules,
  { file, selector, media = null, property },
) {
  const want = collapse(selector);
  const matching = rules.filter(
    (r) =>
      r.file === file &&
      (r.media || null) === media &&
      r.selectors.includes(want),
  );
  const hits = matching.flatMap((r) =>
    r.declarations.filter((d) => d.name === property),
  );
  if (hits.length === 0) {
    throw new Error(
      `${file}: no ${property} in ${media ? `@media ${media} ` : ''}${selector}`,
    );
  }
  // The later declaration is the one that holds.
  return hits[hits.length - 1];
}
