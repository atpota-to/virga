// The stylesheet reader the theme's fixtures and Swift tables are written
// with (cases/_css.js), held to what a browser does where the fixtures can't
// say: they are the reader's own output, so the Swift port agreeing with
// them proves nothing if the reader is wrong. Values here are worked out by
// hand from CSS Color 5, CSS Values 4, CSS Variables and the cascade, and
// the reader has to refuse, loudly, a token rule it can't follow rather than
// leave it out.

import { describe, expect, it } from 'vitest';
import {
  evaluateLength,
  mediaMatches,
  mightPickRoot,
  mixColours,
  parseStylesheet,
  parseValue,
  resolveRoot,
  resolveSwatch,
  tokenBlocks,
} from './cases/_css.js';

const ATTRS = {
  sky: 'day',
  theme: 'light',
  accent: 'blue',
  contrast: 'normal',
  density: 'comfortable',
};
const blocksOf = (css) => tokenBlocks(parseStylesheet(css, 'test.css'));
const rgb = (r, g, b, alpha = 1) => ({
  red: r / 255,
  green: g / 255,
  blue: b / 255,
  alpha,
});
const close = (actual, expected) => {
  for (const k of ['red', 'green', 'blue', 'alpha'])
    expect(actual[k]).toBeCloseTo(expected[k], 12);
};

describe('the reader', () => {
  it('refuses a token rule for <html> it cannot follow, rather than leave it out', () => {
    for (const css of [
      'html { --bg: #ffffff; }',
      ':ROOT { --bg: #ffffff; }',
      '[data-accent] { --accent: #1d5ee0; }',
      "[data-theme^='da'] { --bg: #000000; }",
      ":root > [data-accent='blue'] { --accent: #1d5ee0; }",
      '* { --bg: #ffffff; }',
      ':where(:root) { --bg: #ffffff; }',
      ':root, .shell { --page-pad: 20px; }',
    ]) {
      expect(() => blocksOf(css), css).toThrow();
    }
  });

  it('leaves a component’s own tokens to the component', () => {
    expect(
      blocksOf(`.shell { --figure-size: 40px; }
        :root[data-contrast='high'] .input[aria-invalid='true'] { --focus: 0 0 0 2px #ffffff; }
        .landing { --landing-max: 1160px; }
        body::before { --x: 1px; }`),
    ).toEqual([]);
    expect(mightPickRoot('.shell[data-sidebar="collapsed"]')).toBe(false);
    expect(mightPickRoot(":root[data-theme='dark'] .btn--danger")).toBe(false);
    expect(mightPickRoot('html:not(.x)')).toBe(true);
  });
});

describe('the cascade, as a browser runs it', () => {
  it('lets !important beat a stronger selector and a later rule', () => {
    const t = resolveRoot(
      blocksOf(`:root { --bg: #000000 !important; }
        :root[data-sky='day'][data-theme='light'] { --bg: #ffffff; }`),
      ATTRS,
      { width: 1280 },
    );
    expect(t.get('--bg')).toEqual({ color: rgb(0, 0, 0) });
  });

  it('leaves a var() to nothing, or a cycle, with no value: not the inherited one', () => {
    const blocks = blocksOf(`:root { --rule: #0f1b33; --ink: #111111; }
      [data-accent='violet'] { --rule: var(--nowhere); --ink: var(--ink-2); --ink-2: var(--ink); }`);
    const swatch = resolveSwatch(blocks, ATTRS, 'violet', { width: 1280 });
    expect(swatch.has('--rule')).toBe(false);
    expect(swatch.has('--ink')).toBe(false);
    expect(swatch.has('--ink-2')).toBe(false);
  });

  it('follows var() where the property is declared, so a swatch inherits what <html> worked out', () => {
    const blocks = blocksOf(`:root, [data-accent='blue'] { --accent: #1d5ee0; }
      :root { --focus-ring: var(--accent); }
      [data-accent='violet'] { --accent: #8149e3; }`);
    const swatch = resolveSwatch(blocks, ATTRS, 'violet', { width: 1280 });
    expect(swatch.get('--accent')).toEqual({ color: rgb(129, 73, 227) });
    expect(swatch.get('--focus-ring')).toEqual({ color: rgb(29, 94, 224) });
  });

  it('holds a width query to the exact width, a fraction included', () => {
    expect(mediaMatches('(max-width: 899px)', { width: 899 })).toBe(true);
    expect(mediaMatches('(max-width: 899px)', { width: 899.5 })).toBe(false);
    expect(mediaMatches('(min-width: 900px)', { width: 899.5 })).toBe(false);
    expect(mediaMatches('(forced-colors: active)', { width: 1280 })).toBe(
      false,
    );
  });
});

describe('the arithmetic, as CSS defines it', () => {
  it('mixes colours premultiplied, with a short sum kept on the alpha (CSS Color 5)', () => {
    // A tint of a colour into transparent keeps the colour and takes the share as its alpha.
    close(
      mixColours(rgb(29, 94, 224), 12, rgb(0, 0, 0, 0), null),
      rgb(29, 94, 224, 0.12),
    );
    // 20% and 30% scale to 40/60, and the sum, 50%, multiplies the alpha.
    close(
      mixColours(rgb(255, 0, 0), 20, rgb(0, 0, 255), 30),
      rgb(102, 0, 153, 0.5),
    );
    // 80% and 60% scale to 4/7 and 3/7, with nothing taken off the alpha.
    close(
      mixColours(rgb(255, 0, 0), 80, rgb(0, 0, 255), 60),
      rgb((255 * 4) / 7, 0, (255 * 3) / 7),
    );
    // No percentages: half each.
    close(
      mixColours(rgb(255, 0, 0), null, rgb(0, 0, 255), null),
      rgb(127.5, 0, 127.5),
    );
    expect(mixColours(rgb(255, 0, 0), 0, rgb(0, 0, 255), 0)).toBeNull();
  });

  it('reads the colour syntaxes as computed values: clamped channels, hue wrapped', () => {
    expect(parseValue('rgb(300 -20 128 / 2)')).toEqual({
      color: { red: 1, green: 0, blue: 128 / 255, alpha: 1 },
    });
    expect(parseValue('#1D5EE0CC')).toEqual({
      color: rgb(29, 94, 224, 204 / 255),
    });
    // hsl(120 100% 25%) is rgb(0 127.5 0); -240deg is the same hue.
    close(parseValue('hsl(-240deg 100% 25%)').color, rgb(0, 127.5, 0));
  });

  it('measures lengths: clamp’s MIN over its MAX, cqi from the viewport with no container', () => {
    const at = (css, ctx) => evaluateLength(parseValue(css).length, ctx);
    expect(at('clamp(60px, 4vw, 40px)', { width: 1280 })).toBe(60);
    expect(
      at('clamp(2.5rem, 1.6rem + 2.6vw, 3.75rem)', { width: 1000 }),
    ).toBeCloseTo(51.6, 12);
    expect(at('26cqi', { width: 1000 })).toBe(260);
    expect(at('26cqi', { width: 1000, containerWidth: 200 })).toBe(52);
    expect(at('54ch', { width: 1000 })).toBeNull();
    expect(at('calc(var(--x) * 2)', { width: 1000 })).toBeNull();
  });
});
