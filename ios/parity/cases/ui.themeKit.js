// The kit's own measures: each declaration _themeKit.js names, as the
// stylesheet has it and as typed data (_css.js, parseKitValue). Swift:
// VirgaCore/Theme/ThemeTokens+Kit.swift, written from the same list by
// ios/scripts/generate-theme-tokens.mjs and held to these by
// ThemeKitParity.

import { findDeclaration, parseKitValue } from './_css.js';
import { THEME_KIT } from './_themeKit.js';
import { readTheme, sources as themeSources } from './ui.theme.js';

export const sources = themeSources;

export default async function cases() {
  const { rules } = readTheme();
  return THEME_KIT.map((pick) => {
    const d = findDeclaration(rules, pick);
    return {
      id: pick.name,
      fn: 'kit',
      input: {
        file: pick.file,
        selector: pick.selector,
        media: pick.media,
        property: pick.property,
        kind: pick.kind,
      },
      output: {
        css: d.css,
        important: d.important,
        value: parseKitValue(pick.kind, d.css),
      },
    };
  });
}
