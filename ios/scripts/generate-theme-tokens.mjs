// Writes the Swift side of the design tokens from the stylesheets:
//
//   ios/VirgaKit/Sources/VirgaCore/Theme/ThemeTokens+Blocks.swift
//     every token (ThemeToken), the rules that set them on <html>
//     (ThemeTokens.blocks), and a named accessor for each on ResolvedTheme;
//   ios/VirgaKit/Sources/VirgaCore/Theme/ThemeTokens+Kit.swift
//     the kit's measures (ThemeKit), from ios/parity/cases/_themeKit.js.
//
//   node ios/scripts/generate-theme-tokens.mjs
//
// The stylesheets are read with the same reader the parity fixtures use
// (ios/parity/cases/_css.js), and the fixtures (ui.theme, ui.themeKit) hold
// the Swift tables to them, so when a token or a measure changes in a
// stylesheet `npm run parity:write` makes the fixture stale, `swift test`
// fails on the value that moved, and running this again brings the tables
// in line. The resolver that reads them (ThemeTokens+Cascade.swift) is
// written by hand.

import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateLength,
  findDeclaration,
  parseKitValue,
  resolveRoot,
} from '../parity/cases/_css.js';
import { THEME_KIT } from '../parity/cases/_themeKit.js';
import { readTheme, sources, tokenNames } from '../parity/cases/ui.theme.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const THEME_DIR = path.join(here, '../VirgaKit/Sources/VirgaCore/Theme');

/** `--surface-2` → surface2, `color-scheme` → colorScheme. */
export function swiftName(css) {
  const parts = css.replace(/^--/, '').split('-');
  return parts
    .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join('');
}

const num = (n) => {
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${n}`);
  return String(n);
};
const str = (s) => JSON.stringify(s);

function colour(c) {
  const bytes = ['red', 'green', 'blue'].map((k) => Math.round(c[k] * 255));
  const exact = bytes.every(
    (b, i) => b / 255 === c[['red', 'green', 'blue'][i]],
  );
  if (exact && c.alpha === 1) {
    return `.hex(0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')})`;
  }
  if (exact) return `.rgb(${bytes.join(', ')}, ${num(c.alpha)})`;
  return `ThemeColor(red: ${num(c.red)}, green: ${num(c.green)}, blue: ${num(c.blue)}, alpha: ${num(c.alpha)})`;
}

const UNITS = {
  px: 'px',
  rem: 'rem',
  em: 'em',
  ch: 'ch',
  vw: 'vw',
  vh: 'vh',
  svh: 'svh',
  dvh: 'dvh',
  cqi: 'cqi',
  '%': 'percent',
};
const OPS = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' };

function length(l) {
  if ('unit' in l) {
    if (l.unit === 'px') return `.px(${num(l.value)})`;
    if (l.unit === 'rem') return `.rem(${num(l.value)})`;
    if (l.unit === 'em') return `.em(${num(l.value)})`;
    return `.value(${num(l.value)}, .${UNITS[l.unit]})`;
  }
  if ('number' in l) return `.number(${num(l.number)})`;
  if ('var' in l) return `.variable(.${swiftName(l.var)})`;
  if ('op' in l)
    return `.operation(.${OPS[l.op]}, ${length(l.left)}, ${length(l.right)})`;
  return `.function(.${l.fn}, [${l.args.map(length).join(', ')}])`;
}

function layer(s) {
  const args = [];
  if (s.inset) args.push('inset: true');
  args.push(`x: ${length(s.x)}`, `y: ${length(s.y)}`);
  if (s.blur) args.push(`blur: ${length(s.blur)}`);
  if (s.spread) args.push(`spread: ${length(s.spread)}`);
  if (s.color) args.push(`color: ${value(s.color)}`);
  return `ThemeShadowLayer(${args.join(', ')})`;
}

function value(v) {
  if ('color' in v) return `.color(${colour(v.color)})`;
  if ('system' in v) return `.system(${str(v.system)})`;
  if ('var' in v) return `.variable(.${swiftName(v.var)})`;
  if ('colorMix' in v) {
    const m = v.colorMix;
    const pct = (p) => (p === null ? 'nil' : num(p));
    return `.colorMix(ThemeColorMix(first: ${value(m.first)}, firstPercent: ${pct(m.firstPercent)}, second: ${value(m.second)}, secondPercent: ${pct(m.secondPercent)}))`;
  }
  if ('length' in v) return `.length(${length(v.length)})`;
  if ('shadow' in v) return `.shadow([${v.shadow.map(layer).join(', ')}])`;
  if ('fonts' in v) return `.fonts([${v.fonts.map(str).join(', ')}])`;
  if ('cubicBezier' in v)
    return `.cubicBezier(ThemeCubicBezier(${v.cubicBezier.map(num).join(', ')}))`;
  if ('keyword' in v) return `.keyword(${str(v.keyword)})`;
  throw new Error(`no Swift for ${JSON.stringify(v)}`);
}

function selector(text) {
  const compounds = text.split(' ').map((compound) => {
    const parts = [];
    const re = /:root|\[([\w-]+)='([^']*)'\]/gy;
    let m;
    while ((m = re.exec(compound)))
      parts.push(
        m[0] === ':root' ? '.root' : `.attribute(${str(m[1])}, ${str(m[2])})`,
      );
    return `[${parts.join(', ')}]`;
  });
  return `ThemeSelector([${compounds.join(', ')}])`;
}

const HEADER = (ports, about) =>
  `${ports.map((p) => `// Ports ${p}`).join('\n')}
//
// Written by ios/scripts/generate-theme-tokens.mjs from the stylesheets;
// don't edit it by hand. ${about}`;

function writeBlocks(blocks, names) {
  const day = resolveRoot(
    blocks,
    {
      sky: 'day',
      theme: 'light',
      accent: 'blue',
      contrast: 'normal',
      density: 'comfortable',
    },
    { width: 1280 },
  );
  const kindOf = (name) => {
    const v = day.get(name);
    if (!v) throw new Error(`${name} has no value on a plain day`);
    if ('color' in v) return 'color';
    if ('length' in v) return 'length';
    if ('shadow' in v) return 'shadow';
    if ('fonts' in v) return 'fonts';
    if ('cubicBezier' in v) return 'easing';
    if ('keyword' in v) return 'keyword';
    throw new Error(`${name}: no kind for ${JSON.stringify(v)}`);
  };
  const lines = [];
  lines.push(
    HEADER(
      ['src/styles/theme.css'],
      `ui.theme holds it to the
// stylesheets: the tokens one for one, each rule's selectors, media query
// and declarations as written, and what they resolve to for every set of
// attributes.

import Foundation

/// Every design token the stylesheets set on <html>, in the order they first
/// appear: the custom properties, and the page's color-scheme. The raw value
/// is the property's name.
public enum ThemeToken: String, CaseIterable, Codable, Hashable, Sendable {`,
    ),
  );
  for (const name of names)
    lines.push(`  case ${swiftName(name)} = ${str(name)}`);
  lines.push('');
  lines.push('  /// What the token holds once resolved.');
  lines.push('  public var kind: ThemeTokenKind {');
  lines.push('    switch self {');
  const byKind = new Map();
  for (const name of names) {
    const k = kindOf(name);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(name);
  }
  for (const [k, list] of byKind) {
    lines.push(`    case ${list.map((n) => `.${swiftName(n)}`).join(', ')}:`);
    lines.push(`      return .${k}`);
  }
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('extension ThemeTokens {');
  lines.push(
    '  /// The rules that set tokens on <html>, in cascade order (theme.css, then',
  );
  lines.push('  /// the sheets after it as the app loads them).');
  lines.push('  public static let blocks: [ThemeBlock] = [');
  for (const block of blocks) {
    lines.push('    ThemeBlock(');
    lines.push(`      file: ${str(block.file)},`);
    lines.push(
      `      selectors: [${block.selectors.map(selector).join(', ')}],`,
    );
    if (block.media)
      lines.push(`      media: ThemeMedia(${str(block.media)}),`);
    lines.push('      declarations: [');
    for (const d of block.declarations) {
      const important = d.important ? ', important: true' : '';
      lines.push(
        `        ThemeDeclaration(.${swiftName(d.name)}, ${str(d.css)}, ${value(d.value)}${important}),`,
      );
    }
    lines.push('      ]');
    lines.push('    ),');
  }
  lines.push('  ]');
  lines.push('}');
  lines.push('');
  lines.push(
    '// Each token by name. A colour, a shadow or a font stack that has no value',
  );
  lines.push(
    '// (which no stylesheet allows: ThemeTokensBehaviour checks every state) is',
  );
  lines.push(
    '// transparent or empty; a length is in points at this viewport, except one',
  );
  lines.push(
    "// measured in the font's own units, which is left as its expression.",
  );
  lines.push('extension ResolvedTheme {');
  for (const name of names) {
    const s = swiftName(name);
    const doc = `  /// \`${name}\``;
    switch (kindOf(name)) {
      case 'color':
        lines.push(
          doc,
          `  public var ${s}: ThemeColor { color(.${s}) ?? .transparent }`,
        );
        break;
      case 'length': {
        const l = day.get(name).length;
        if (evaluateLength(l, { width: 1280 }) === null) {
          lines.push(
            `${doc}: measure it with \`points(.${s}, in:)\`.`,
            `  public var ${s}: ThemeLength { length(.${s}) ?? .px(0) }`,
          );
        } else {
          lines.push(
            `${doc}, in points.`,
            `  public var ${s}: Double { points(.${s}) ?? 0 }`,
          );
        }
        break;
      }
      case 'shadow':
        lines.push(
          doc,
          `  public var ${s}: [ThemeShadowLayer] { shadow(.${s}) ?? [] }`,
        );
        break;
      case 'fonts':
        lines.push(doc, `  public var ${s}: [String] { fonts(.${s}) ?? [] }`);
        break;
      case 'easing':
        lines.push(
          doc,
          `  public var ${s}: ThemeCubicBezier { cubicBezier(.${s}) ?? ThemeCubicBezier(0.25, 0.1, 0.25, 1) }`,
        );
        break;
      default:
        // color-scheme is `colorScheme: Theme` (ThemeTokens+Cascade.swift).
        break;
    }
  }
  lines.push('}');
  fs.writeFileSync(
    path.join(THEME_DIR, 'ThemeTokens+Blocks.swift'),
    `${lines.join('\n')}\n`,
  );
}

const SWIFT_TYPES = {
  length: 'ThemeLength',
  box: 'ThemeBox',
  gap: 'ThemeGap',
  number: 'Double',
  time: 'Double',
  color: 'ThemeValue',
  value: 'ThemeValue',
  shadow: '[ThemeShadowLayer]',
  border: 'ThemeBorder',
  transitions: '[ThemeTransition]',
  animation: 'ThemeAnimation',
  gradient: 'ThemeGradient',
  keyword: 'String',
};

function kitValue(kind, v) {
  switch (kind) {
    case 'length':
      return length(v.length);
    case 'box':
      return `ThemeBox(top: ${length(v.box.top)}, right: ${length(v.box.right)}, bottom: ${length(v.box.bottom)}, left: ${length(v.box.left)})`;
    case 'gap':
      return `ThemeGap(row: ${length(v.gap.row)}, column: ${length(v.gap.column)})`;
    case 'number':
      return num(v.number);
    case 'time':
      return num(v.time);
    case 'color':
    case 'value':
      return value(v);
    case 'shadow':
      return `[${v.shadow.map(layer).join(', ')}]`;
    case 'border': {
      const b = v.border;
      return `ThemeBorder(width: ${b.width ? length(b.width) : 'nil'}, style: ${b.style ? str(b.style) : 'nil'}, color: ${b.color ? value(b.color) : 'nil'})`;
    }
    case 'transitions':
      return `[${v.transitions
        .map(
          (t) =>
            `ThemeTransition(property: ${str(t.property)}, duration: ${num(t.duration)}, easing: ${value(t.easing)}, delay: ${num(t.delay)})`,
        )
        .join(', ')}]`;
    case 'animation': {
      const a = v.animation;
      return `ThemeAnimation(name: ${str(a.name)}, duration: ${num(a.duration)}, easing: ${value(a.easing)}, delay: ${num(a.delay)}, iterations: ${num(a.iterations)}, infinite: ${a.infinite}, fill: ${str(a.fill)})`;
    }
    case 'gradient':
      return `ThemeGradient(angle: ${num(v.gradient.angle)}, stops: [${v.gradient.stops
        .map(
          (s) =>
            `ThemeGradientStop(color: ${value(s.color)}, position: ${s.position ? length(s.position) : 'nil'})`,
        )
        .join(', ')}])`;
    case 'keyword':
      return str(v.keyword);
    default:
      throw new Error(`no Swift for kind ${kind}`);
  }
}

const KIT_CASE = {
  length: 'length',
  box: 'box',
  gap: 'gap',
  number: 'number',
  time: 'time',
  color: 'value',
  value: 'value',
  shadow: 'shadow',
  border: 'border',
  transitions: 'transitions',
  animation: 'animation',
  gradient: 'gradient',
  keyword: 'keyword',
};

function writeKit(rules) {
  const lines = [];
  lines.push(
    HEADER(
      [
        'src/styles/theme.css',
        'src/styles/base.css',
        'src/styles/controls.css',
        'src/styles/app.css',
      ],
      `ui.themeKit holds it to the
// stylesheets, one declaration each (ios/parity/cases/_themeKit.js lists
// them).

import Foundation

/// The kit's own measures, beside the tokens: the sizes, weights, durations
/// and the few colours the stylesheets give the controls, each one
/// declaration of one rule (its doc comment says which). Values that say
/// var() are filled in by the theme in force: \`theme.points(of:)\`,
/// \`theme.color(of:)\`, \`theme.resolve(_:)\`. ios/DESIGN.md says what each
/// control is for.
public enum ThemeKit {`,
    ),
  );
  const entries = [];
  for (const pick of THEME_KIT) {
    const d = findDeclaration(rules, pick);
    const v = parseKitValue(pick.kind, d.css);
    const where = `${pick.file.replace('src/styles/', '')}${pick.media ? ` @media ${pick.media}` : ''} \`${pick.selector}\` { ${pick.property}: ${d.css}${d.important ? ' !important' : ''} }`;
    lines.push(`  /// ${where}`);
    lines.push(
      `  public static let ${pick.name}: ${SWIFT_TYPES[pick.kind]} = ${kitValue(pick.kind, v)}`,
    );
    const media = pick.media ? `media: ${str(pick.media)}, ` : '';
    const important = d.important ? 'important: true, ' : '';
    entries.push(
      `    ThemeKitEntry(${str(pick.name)}, file: ${str(pick.file)}, selector: ${str(pick.selector)}, ${media}property: ${str(pick.property)}, kind: ${str(pick.kind)}, css: ${str(d.css)}, ${important}value: .${KIT_CASE[pick.kind]}(${pick.name})),`,
    );
  }
  lines.push('');
  lines.push('  /// Every measure above, with the declaration it comes from.');
  lines.push('  public static let entries: [ThemeKitEntry] = [');
  lines.push(...entries);
  lines.push('  ]');
  lines.push('}');
  fs.writeFileSync(
    path.join(THEME_DIR, 'ThemeTokens+Kit.swift'),
    `${lines.join('\n')}\n`,
  );
}

const { rules, blocks } = readTheme();
writeBlocks(blocks, tokenNames(blocks));
writeKit(rules);
console.log(
  `Wrote ThemeTokens+Blocks.swift and ThemeTokens+Kit.swift from ${sources.join(', ')}.`,
);
