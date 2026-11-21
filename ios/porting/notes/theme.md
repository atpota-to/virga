# theme: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, not yet audited.
Parity cases at port time: 1528.
Tests at the time: Whole package passes with `swift test`. VirgaCoreTests: 165 tests in 30 suites, 31 of them in the 3 new theme suites: ThemeTokensParity (8), ThemeKitParity (1) and ThemeTokensBehaviour (22). Also passing: `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity` (69 tests) and `npx eslint ios` (clean).

## API for the code that builds on it

All of this is in VirgaCore (`import VirgaCore`), in ios/VirgaKit/Sources/VirgaCore/Theme/. The guide for VirgaUI is ios/DESIGN.md.

ENTRY POINT (ThemeTokens+Cascade.swift)
- `ThemeTokens.resolve(_ attributes: RootAttributes, viewportWidth: Double, blocks: [ThemeBlock] = ThemeTokens.blocks) -> ResolvedTheme`
  - Get attributes from `Preferences.rootAttributes(...)` or `PreferencesModel.rootAttributes`.
  - `viewportWidth` is the window width in points. It decides the media queries: 899 and narrower is the phone set, 760 and narrower is body text 15.
  - It runs the CSS cascade for custom properties: !important, then specificity, then order; var() followed on the element that declares it; a cycle or a dangling var() leaves the token with no value; color-mix() computed.
- `ThemeTokens.resolve(html: [String: String], viewportWidth:, blocks:)` takes raw data-* attributes, so an unknown accent falls back to blue.
- `ThemeTokens.swatch(_ accent: Preferences.Accent, in: RootAttributes, viewportWidth:) -> ResolvedTheme` gives the tokens inside an element carrying data-accent alone (Settings' accent choices).
- `ThemeTokens.htmlAttributes(RootAttributes) -> [String: String]`.

RESOLVEDTHEME (struct, Hashable, Sendable)
- Stored: `viewportWidth`, `values: [ThemeToken: ThemeValue]`. The values have no var() and no color-mix() left; lengths stay expressions.
- Lookups: `subscript(ThemeToken) -> ThemeValue?`, `color(_:) -> ThemeColor?`, `length(_:) -> ThemeLength?`, `points(_ token, in: ThemeLengthContext? = nil) -> Double?`, `shadow(_:) -> [ThemeShadowLayer]?`, `fonts(_:)`, `cubicBezier(_:)`, `keyword(_:)`, `colorScheme: Theme`, `lengthContext`.
- Kit values with var() go through the theme: `resolve(_ ThemeValue) -> ThemeValue?`, `resolve(_ ThemeLength)`, `color(of: ThemeValue) -> ThemeColor?`, `points(of: ThemeLength, in:) -> Double?`.
- `declaring([(ThemeToken, ThemeValue)]) -> ResolvedTheme` gives the tokens of an element that declares some itself. Use it for `.input[aria-invalid]`'s focus ring and for shell.css's `.shell --figure-size`.
- Generated named accessors for every token (ThemeTokens+Blocks.swift):
  - colours return `ThemeColor` (e.g. `theme.bg`, `.ink`, `.accent`, `.chart1`, `.heat6`);
  - lengths return `Double` in points (e.g. `theme.space4`, `.pagePad`, `.textBase`, `.figureSize`, `.shellMax`). The exception is `measure`, which returns `ThemeLength` (54ch): measure it with `points(.measure, in: ThemeLengthContext(viewportWidth:, chWidth:))`;
  - shadows (`shadowSm/Md/Lg`, `focus`) return `[ThemeShadowLayer]`;
  - `sans` and `code` return `[String]`;
  - `ease` returns `ThemeCubicBezier`.

TOKENS
- `enum ThemeToken: String, CaseIterable, Codable`
  - The raw value is the CSS name ("--surface-2" is `.surface2`; "color-scheme" is `.colorScheme`), in stylesheet order.
  - `.kind: ThemeTokenKind` (color, length, shadow, fonts, easing, keyword).
- Lists on `ThemeTokens`: `typeScale`, `spaceScale`, `radii`, `densityTokens`, `accentTokens` (22), and `fontWeights` = [400, 500, 600].
- `ThemeTokens.blocks: [ThemeBlock]` is generated, never hand-edited.

VALUE TYPES (ThemeTokens+Values.swift)
All are Codable to the JSON shapes in ios/parity/cases/_css.js.
- `struct ThemeColor { red, green, blue, alpha }`, each 0 to 1 in sRGB.
  - Builders: `.hex(0xRRGGBB)`, `.rgb(r, g, b, alpha)` with 0-255 channels, `.transparent`.
  - `init?(css:)` reads hex (3, 4, 6, 8 digits), rgb()/rgba() in both syntaxes, hsl()/hsla() and transparent/black/white.
  - `static mix(a, p1?, b, p2?) -> ThemeColor?` is CSS Color 5 color-mix in srgb.
  - Also `over(_:)`, `relativeLuminance`, `contrastRatio(on:)` (WCAG) and `hexString`.
  - SwiftUI: `Color(.sRGB, red:, green:, blue:, opacity: alpha)`.
- `indirect enum ThemeLength`: `.value(Double, ThemeUnit)`, `.number`, `.variable(ThemeToken)`, `.operation(ThemeLengthOperator, l, r)`, `.function(ThemeLengthFunction calc/clamp/min/max/group, [l])`.
  - Shorthands: `.px`, `.rem`, `.em`.
  - `points(in: ThemeLengthContext) -> Double?` uses rem = 16, vw from the viewport, and cqi from `containerWidth` (the viewport if nil). It is nil for ch without `chWidth`, %, vh, and var.
  - `variables`.
- `ThemeLengthContext(viewportWidth:, containerWidth:, fontSize: 16, rootFontSize: 16, chWidth:)`.
- `indirect enum ThemeValue`: `.color`, `.system(String)`, `.variable`, `.colorMix(ThemeColorMix)`, `.length`, `.shadow([ThemeShadowLayer])`, `.fonts([String])`, `.cubicBezier(ThemeCubicBezier)`, `.keyword`. Accessors `.colorValue` and `.lengthValue`.
- `ThemeShadowLayer(inset:, x:, y:, blur:, spread:, color: ThemeValue?)`.
- `ThemeCubicBezier(x1, y1, x2, y2)`, with `.keyword("ease")` for the CSS easing keywords.

CASCADE TYPES
- `ThemeSelector` (compounds of `ThemeSimpleSelector` .root or .attribute(name, value); Codable as its CSS text).
- `ThemeMedia(css)` (max-width, min-width, forced-colors; forced colours never match).
- `ThemeDeclaration(token, css, value, important:)`.
- `ThemeBlock(file:, selectors:, media:, declarations:)`.

KIT (ThemeTokens+Kit.swift, generated; types in ThemeKit+Values.swift)
- `enum ThemeKit` has about 290 named constants, one declaration each, with a doc comment naming the rule. Examples:
  - `buttonHeight: ThemeLength = var(--control-h)`, `smallButtonHeight`, `touchButtonHeight` (40), `touchGhostIconButtonSize` (44);
  - `segmentedOnUnderline`, `primaryButtonFill: ThemeValue`, `inputFill` (color-mix);
  - `skyWash: ThemeGradient`;
  - `buttonTransition: [ThemeTransition]`, `menuSheetAnimation: ThemeAnimation`;
  - `headingWeight: Double`, `bodyLineHeight`, `figureValueTracking: ThemeLength` (em);
  - `invalidFocusRing` and `invalidFocus`, the `highContrast*` constants, `landing*`, `appStatusAnimation`.
- `ThemeKit.entries: [ThemeKitEntry]` records where each constant comes from.
- Types: `ThemeBox` (top/right/bottom/left), `ThemeGap` (row/column), `ThemeBorder` (width, style, color), `ThemeTransition`, `ThemeAnimation` (duration and delay in seconds, `infinite`), `ThemeGradient` (CSS angle; stops of `ThemeGradientStop(color, position)`), `ThemeKitValue`.

CONVENTIONS AND MAINTENANCE
- Never hard-code a colour, size or duration in a view: name a token or a ThemeKit constant.
- Lengths are points. Durations are seconds.
- A stylesheet change makes the `ui.theme`/`ui.themeKit` fixtures stale. Run `npm run parity:write`, then `node ios/scripts/generate-theme-tokens.mjs` to rewrite ThemeTokens+Blocks.swift and ThemeTokens+Kit.swift.
- To add a kit measure, add a line to ios/parity/cases/_themeKit.js `[name, file, selector, property, kind, media?]`, then run the script and parity:write.
- The CSS reader is ios/parity/cases/_css.js (parseStylesheet, tokenBlocks, resolveRoot, swatchOwn, parseValue, parseKitValue, evaluateLength, mixColours, findDeclaration). VirgaUI agents porting other stylesheets can reuse it for their own generators.

## Known gaps and deliberate differences

- Component styles (how each button, row, menu, dialog and header is laid out) are not ported. They are VirgaUI's (wave 4), from controls.css, shell.css and the other sheets; ios/DESIGN.md describes each and maps it to SwiftUI. ThemeKit holds only the measures (about 290 declarations).
- @media (forced-colors: active) rules are recorded in ThemeTokens.blocks but never applied: no iOS device has Windows' contrast themes, and system colours like CanvasText have no value outside one. iOS's Increase Contrast maps to data-contrast='high' through Preferences.rootAttributes.
- Lengths stay expressions, as unregistered custom properties do. --measure (54ch) needs the font's '0' width from the UI (ThemeLengthContext.chWidth). cqi uses the viewport unless the caller gives a containerWidth. shell.css re-declares --figure-size on .shell (and --shell-max while a dashboard is being arranged); those are VirgaUI's, via ResolvedTheme.declaring.
- var() substitution is typed, not token-level. A custom property whose value is a bare sum, substituted inside another expression, would bind as a group in Swift where the browser re-associates the operators. The JS reader throws on that, so no stylesheet can do it unnoticed.
- Only these are evaluated in token rules: color-mix() in srgb, max-width/min-width/forced-colors media queries, and no var() fallbacks. Anything else makes the generator throw, loudly, rather than drift.
- ThemeSelector(css:) does not read attribute values containing whitespace (no stylesheet uses them).
- The phone menu sheet's padding uses env(safe-area-inset-bottom) and is left out of ThemeKit; SwiftUI's safe area handles it.
- The fixture ui.theme.json is about 970 KB (192 attribute sets × 3 widths plus edge widths, with an indexed value table), near the size of the largest existing fixtures.
- ios/README.md does not link DESIGN.md yet; I left that shared file alone.
