# theme: porting notes

A snapshot of what the agents that ported and audited this domain handed on (November 2026).
The code and ios/parity/modules/*.json are the truth; read this for orientation, the API
map, and the known gaps and deliberate differences.

Status: ported, audited (2026-11-21; findings at the end).
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

## The audit (2026-11-21)

Cases added: 399. Tests then: `swift test` (whole package) passes. VirgaCoreTests: 176 tests in 31 suites, 35 of them in the theme suites: ThemeTokensParity 8, ThemeKitParity 3 (new: everyMeasureThroughTheTheme, anInvalidFieldDeclaresItsOwnRing), ThemeTokensBehaviour 24 (new: theTwoSeriesStayApartForOrdinaryAndColourBlindEyes, aHeatmapRunsOneWayInStepsThatCanBeToldApart). `PARITY_ALLOW_PENDING=1 npx vitest run ios/parity`: 4 files, 111 tests pass, including the new ios/parity/css.test.js (9). `npx eslint ios` is clean, prettier is clean, and `parity:drift` shows no drift. The generator re-run gives no diff and the fixtures are fresh. Seven commits on ios/w5-b (4032650..4d07a71).

Findings, all fixed:

- **medium**, ios/parity/cases/_css.js tokenBlocks: The CSS reader skipped, without a word, any rule setting custom properties whose selector it couldn't parse. That is right for a component's own tokens (.shell, .input[aria-invalid]). It is wrong for a rule that might still set tokens on <html>: `html {}`, `:ROOT`, `[data-x]`, `:root > x`, `:where(:root)`, or a list mixing `:root` with a component. Such a rule would have drifted out of the fixtures and the Swift tables unnoticed. It now throws while the fixture is written (new mightPickRoot), and ios/parity/css.test.js holds the reader to the browser where the fixtures can't: !important over specificity, a var() to nothing or in a cycle giving no value rather than the inherited one, var() followed where declared, width queries at a fraction, color-mix() worked by hand from CSS Color 5, clamped colour channels, clamp() and cqi.
- **medium**, ios/DESIGN.md Focus and high contrast: DESIGN.md treated focus as one thing: 'a solid line with a soft halo (--focus)' for keyboard focus everywhere. In the web most controls take base.css's outline (2pt of --focus-ring, offset 2pt, 3pt wide in high contrast, drawn inside the key in a Segmented or a sideways row). Only a field draws the --focus shadow ring. Rewritten, with the ThemeKit names.
- **medium**, ios/DESIGN.md Charts: DESIGN.md said --chart-ghost is 'the window before'. It is the dashed reach from a line's end to a value the line can't arrive at (the followers chart's profile count), plus the Defense radar's dust. It also said --chart-3/--chart-4 are 'for breakdowns', but no chart uses them. Corrected.
- **medium**, ios/DESIGN.md Button: DESIGN.md didn't say that a danger button at night keeps the deep red (#b42318, ThemeKit.dangerButtonFillAtNight) instead of night's --danger, which is a light coral meant for words. A view following the guide would have drawn a coral confirm button. Also fixed: its weight is 600 like primary's, not 500, and the primary and danger edges match their fill.
- **low**, ios/DESIGN.md The page: DESIGN.md said 'the page you are on ... ink with a line under it'. In the web it is ink 600 with the accent's dot on the sidebar rail, or the tab bar's --accent-tint pill, and it is underlined only in high contrast.
- **low**, ios/DESIGN.md Dialog, Shape: DESIGN.md said a dialog 'on a phone is a sheet' as if that were the web. The web draws a modal at every width (520 wide at most, 16pt corners, --shadow-lg over --scrim, equal-halves foot from 560 down). A sheet is now stated as the iOS mapping. It also listed 16 as if it were a radius token; it is a number in shell.css and controls.css.
- **low**, ios/DESIGN.md: DESIGN.md left out or misstated several measures. High contrast's switch knob is drawn at 70% (scale(0.7), a transform the kit doesn't hold). A callout's edge is 2pt of --line-2, not a hairline. A ch for --measure is the '0' at the text's own size (13pt for every line held to it). em lengths (tracking) are of the text's own size. theme.figureSize measures cqi against the viewport. --up/--down are set but drawn by no rule. The web's phone menu becomes a sheet only when it has no room.
- **low**, ios/parity/cases/ui.themeKit.js: No fixture held the API VirgaUI will use most to the reader: kit values resolved through a theme (theme.resolve, points(of:), color(of:)) and theme.declaring. Added two case groups to ui.themeKit. `resolved` covers every kit measure that says var() or color-mix(), in 3 themes, part by part with px (390 cases, via the new _css.js resolveIn). `declaring` covers the invalid field's own --focus-ring/--focus, with the high-contrast override (4 cases). Two new ThemeKitParity tests run them; mutating the fixture makes both fail. The Swift side already agreed.
- **low**, ios/parity/cases/ui.theme.js SHEETS: The made-up cascade sheets didn't reach several corners. Added 5: a selector list takes its strongest matching selector's specificity; a property that refers to itself; a cycle through a shadow and a color-mix(); system colours kept unmixed outside forced colours (the Swift branch that keeps color-mix with a system colour was otherwise never run); and a 899.5pt viewport against queries joined by 'and', nested, and written without a space. The Swift resolver agreed with all of them.
- **low**, src/styles/theme.test.js (ported checks): ThemeTokensBehaviour claimed to port theme.test.js's checks but lacked two of them: the two series kept apart in OKLab (20, and 15 under protanopia, deuteranopia and tritanopia, Machado 2009), and the heatmap ramp (one-way OKLab lightness steps of 0.03, heat-0 beside the page, heat-5/6 as marks). Both are added. The tooltip check against charts.css stays on the web side, and the header says so.
- **low**, ios/parity/modules/ui-shell.json src/styles/{app,base,controls,theme}.css: The module map's notes for app.css, base.css and controls.css said 'design tokens in VirgaCore/Theme', but none of those sheets sets a theme token. What is ported from them is ThemeKit measures. Each note now says what is in VirgaCore/Theme (with the count for controls.css: 246 declarations) and what is left for VirgaUI. Stamps were re-run and are unchanged; no drift.

Left after the audit:

- shell.css re-declares --figure-size on .shell (and --shell-max while a dashboard is being arranged). ResolvedTheme.declaring can apply it, but no Swift value exists: VirgaCore can't parse CSS, and the generator reads only theme/base/controls/app.css. VirgaUI must write that ThemeLength, or the generator and _themeKit.js can be extended to shell.css when it is ported.
- High contrast's switch knob scale(0.7) (and its translateX) is a transform with no kit kind, so it lives only in DESIGN.md and the theme.css note.
- ui.theme.json is now about 996 KB, at the 1 MB guideline. A new token or accent will push it over, and the resolve or cascade cases would then need slimming (e.g. dropping the cascade cases' duplicated css input).
- Component styles (layout of every control, the shell, the landing page) stay VirgaUI's (wave 4), as the partial notes say. ThemeKit holds 298 measures (19 base, 246 controls, 11 theme, 22 app), not every declaration: e.g. the phone's landing paddings and some touch reaches are not in it.
- ThemeSelector(css:) still doesn't read attribute values containing whitespace (no sheet uses them). Forced-colours rules are recorded and never applied.
- Not a web bug: --up, --down, --up-wash, --down-wash, --chart-3 and --chart-4 are set in every theme but no rule or component uses them. No new web bugs found; the known 374px vs 429px high-contrast tab ring is already in WEB-BUGS.md.
