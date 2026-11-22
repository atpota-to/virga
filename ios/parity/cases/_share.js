// Shared by the share generators (insights.share*.js): the theme as the
// picture reads it (readShareTheme over the stylesheets' own values, through
// a stand-in for getComputedStyle), colours written one way on both sides,
// and a canvas that records every call drawShareImage makes, measuring text
// by a rule the Swift recorder follows too. Swift: ShareTestSupport.swift.

import { createHash } from 'node:crypto';
import { readShareTheme } from '../../../src/share/chartImage.js';
import { resolveRoot } from './_css.js';
import { readTheme } from './ui.theme.js';

/** A resolved colour as both sides write it: `rgba(r,g,b,a)`, channels 0–255. */
export function canonical(c) {
  return `rgba(${Math.round(c.red * 255)},${Math.round(c.green * 255)},${Math.round(c.blue * 255)},${c.alpha})`;
}

/** A CSS colour the picture's fallbacks are written in, as `canonical`. */
export function canonicalCss(text) {
  const s = String(text).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return canonical({
      red: (n >> 16) / 255,
      green: ((n >> 8) & 255) / 255,
      blue: (n & 255) / 255,
      alpha: 1,
    });
  }
  m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(s);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${Number(m[4])})`;
  if (s.startsWith('rgba(')) return s;
  throw new Error(`no canonical form for ${s}`);
}

let sheets = null;

/**
 * The page's colours for a set of <html> attributes, read by the web's own
 * readShareTheme from the stylesheets' computed tokens, each as `canonical`.
 */
export function shareThemeFor(attrs, width = 1280) {
  sheets ||= readTheme();
  const tokens = resolveRoot(sheets.blocks, attrs, { width });
  const before = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => {
      const value = tokens.get(name);
      return value?.color ? canonical(value.color) : '';
    },
  });
  try {
    const theme = readShareTheme({});
    return Object.fromEntries(
      Object.entries(theme).map(([k, v]) => [k, canonicalCss(v)]),
    );
  } finally {
    if (before) globalThis.getComputedStyle = before;
    else delete globalThis.getComputedStyle;
  }
}

/** Text width as both recorders measure it: 0.55 of the size a UTF-16 unit, plus the spacing. */
export function measure(text, size, spacing) {
  const n = String(text).length;
  return n * size * 0.55 + n * spacing;
}

/**
 * A 2D context that records every call and every property set, in order,
 * as `[name, ...args]` and `['set', property, value]`. Fonts are `[weight,
 * size]`, letter spacing pixels, gradients `{ x0, y0, x1, y1, stops }`.
 */
export function recordingContext() {
  const log = [];
  let size = 10;
  let spacing = 0;
  const ctx = {
    log,
    measureText: (text) => ({ width: measure(text, size, spacing) }),
    createLinearGradient: (x0, y0, x1, y1) => {
      const gradient = { x0, y0, x1, y1, stops: [] };
      return {
        gradient,
        addColorStop: (offset, color) => gradient.stops.push([offset, color]),
      };
    },
  };
  for (const name of [
    'fillRect',
    'fillText',
    'save',
    'restore',
    'translate',
    'scale',
    'beginPath',
    'moveTo',
    'lineTo',
    'arc',
    'arcTo',
    'rect',
    'closePath',
    'fill',
    'stroke',
    'clip',
    'setLineDash',
  ])
    ctx[name] = (...args) =>
      void log.push([
        name,
        ...args.map((a) => (Array.isArray(a) ? [...a] : a)),
      ]);
  const props = {
    fillStyle: (v) => (typeof v === 'string' ? v : v.gradient),
    strokeStyle: (v) => (typeof v === 'string' ? v : v.gradient),
    font: (v) => {
      const m = /^(\d+) (\d+(?:\.\d+)?)px /.exec(v);
      size = Number(m[2]);
      return [Number(m[1]), size];
    },
    letterSpacing: (v) => {
      spacing = parseFloat(v);
      return spacing;
    },
    textAlign: (v) => v,
    textBaseline: (v) => v,
    lineWidth: (v) => v,
    lineCap: (v) => v,
    lineJoin: (v) => v,
  };
  const values = {};
  for (const [name, record] of Object.entries(props)) {
    Object.defineProperty(ctx, name, {
      enumerable: true,
      get: () => values[name],
      set: (v) => {
        values[name] = v;
        log.push(['set', name, record(v)]);
      },
    });
  }
  return ctx;
}

/** A log as a fixture holds it: whole while short, else its length, SHA-256 and ends. */
export function logRecord(log, whole = 300) {
  const text = JSON.stringify(log);
  if (log.length <= whole) return { length: log.length, log };
  return {
    length: log.length,
    sha256: createHash('sha256').update(text).digest('hex'),
    head: log.slice(0, 60),
    tail: log.slice(-60),
  };
}
