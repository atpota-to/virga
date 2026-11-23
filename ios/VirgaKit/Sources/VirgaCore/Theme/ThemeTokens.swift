// Ports src/styles/theme.css
// Ports src/styles/base.css
// Ports src/styles/controls.css
// Ports src/styles/app.css
//
// Virga's design system as data: the tokens of src/styles/theme.css (the
// grounds, the ink, the lines, the sky, the six accents in light, dark and
// high contrast, the type scale, space, density, shape, focus, layout) and
// the kit's own measures from base.css, controls.css and app.css, for the
// SwiftUI layer to draw with, held to the stylesheets by the parity
// fixtures ui.theme and ui.themeKit. ios/DESIGN.md says how the screens use
// them.
//
// The parts:
//
//   ThemeTokens+Values.swift   what a token holds: ThemeColor (RGBA),
//                              ThemeLength (an expression, in points with
//                              `points(in:)`), shadows, fonts, curves
//   ThemeTokens+Blocks.swift   every token (ThemeToken) and the rules that
//                              set them (ThemeTokens.blocks), written from
//                              the stylesheets by
//                              ios/scripts/generate-theme-tokens.mjs
//   ThemeTokens+Cascade.swift  the cascade: ThemeTokens.resolve and
//                              ThemeTokens.swatch, and ResolvedTheme
//   ThemeKit+Values.swift      the shapes of the kit's measures
//   ThemeTokens+Kit.swift      the kit's measures (ThemeKit), written by the
//                              same script
//
// Use: Preferences.rootAttributes gives what the web stamps on <html> (the
// sky, the theme it brings, the accent, the contrast, the density), and
// `ThemeTokens.resolve(attributes, viewportWidth:)` gives every token for
// it the way the CSS cascade would, with the phone's media queries decided
// by the width. Colours come out as RGBA; lengths in points
// (`theme.space4`, `theme.points(.pagePad)`); a kit measure with var() in it
// goes through the theme (`theme.points(of: ThemeKit.buttonHeight)`).
//
// What isn't here: the component styles themselves (how a button, a row or
// a menu is laid out) are VirgaUI's, from the same sheets (wave 4); the
// rules theme.css keeps for forced colours apply to no device the app runs
// on.

import Foundation

/// The design tokens and their cascade.
public enum ThemeTokens {
  /// The sizes of type, smallest first, then the page's title, the figure
  /// that leads a page and the statement that leads a tool.
  public static let typeScale: [ThemeToken] = [
    .textXs, .textSm, .textBase, .textMd, .textLg, .textXl, .text2xl, .text3xl, .textTitle, .textFigure, .textLead,
  ]

  /// The steps of space, 4 to 48 points.
  public static let spaceScale: [ThemeToken] = [.space1, .space2, .space3, .space4, .space5, .space6, .space7]

  /// The radii, smallest first; `pill` rounds a button or a chip to a pill.
  public static let radii: [ThemeToken] = [.radiusSm, .radius, .radiusLg, .pill]

  /// What Compact (Settings › Appearance) tightens.
  public static let densityTokens: [ThemeToken] = [
    .cardPad, .gridGap, .gridGapX, .sectionGap, .pagePad, .pageTop, .rowPad, .rowPadLg, .controlH,
  ]

  /// The tokens an accent gives: the accent with its ink, wash and line and
  /// what is written on it; the second colour; the four chart slots and the
  /// area under a line; the heatmap's ramp. Every accent block sets all of
  /// them (theme.test.js checks it), so none leaks through from another.
  public static let accentTokens: [ThemeToken] = [
    .accent, .accentHover, .accentInk, .accentWash, .accentLine, .onAccent,
    .second, .secondInk, .secondWash, .secondTip,
    .chart1, .chart2, .chart3, .chart4, .chartArea,
    .heat0, .heat1, .heat2, .heat3, .heat4, .heat5, .heat6,
  ]

  /// The weights of the one typeface: 400 to read, 500 for a label, 600 for
  /// a heading or a thing that is on.
  public static let fontWeights: [Double] = [ThemeKit.segmentedKeyWeight, ThemeKit.buttonWeight, ThemeKit.headingWeight]
}

/// What a token holds once resolved.
public enum ThemeTokenKind: String, Codable, CaseIterable, Hashable, Sendable {
  case color, length, shadow, fonts, easing, keyword
}
