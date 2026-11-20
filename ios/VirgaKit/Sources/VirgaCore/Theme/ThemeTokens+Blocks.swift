// Ports src/styles/theme.css
//
// Written by ios/scripts/generate-theme-tokens.mjs from the stylesheets;
// don't edit it by hand. ui.theme holds it to the
// stylesheets: the tokens one for one, each rule's selectors, media query
// and declarations as written, and what they resolve to for every set of
// attributes.

import Foundation

/// Every design token the stylesheets set on <html>, in the order they first
/// appear: the custom properties, and the page's color-scheme. The raw value
/// is the property's name.
public enum ThemeToken: String, CaseIterable, Codable, Hashable, Sendable {
  case colorScheme = "color-scheme"
  case bg = "--bg"
  case surface = "--surface"
  case surface2 = "--surface-2"
  case surface3 = "--surface-3"
  case hover = "--hover"
  case scrim = "--scrim"
  case tint = "--tint"
  case accentTint = "--accent-tint"
  case ink = "--ink"
  case ink2 = "--ink-2"
  case muted = "--muted"
  case faint = "--faint"
  case line = "--line"
  case line2 = "--line-2"
  case lineSoft = "--line-soft"
  case rule = "--rule"
  case skyTop = "--sky-top"
  case skyMid = "--sky-mid"
  case skyMidAt = "--sky-mid-at"
  case skyEnd = "--sky-end"
  case btn = "--btn"
  case btnHover = "--btn-hover"
  case onBtn = "--on-btn"
  case up = "--up"
  case upWash = "--up-wash"
  case down = "--down"
  case downWash = "--down-wash"
  case ok = "--ok"
  case warn = "--warn"
  case warnWash = "--warn-wash"
  case danger = "--danger"
  case dangerHover = "--danger-hover"
  case dangerWash = "--danger-wash"
  case chartGrid = "--chart-grid"
  case chartAxis = "--chart-axis"
  case chartGhost = "--chart-ghost"
  case avatarBg = "--avatar-bg"
  case avatarInk = "--avatar-ink"
  case sans = "--sans"
  case code = "--code"
  case textXs = "--text-xs"
  case textSm = "--text-sm"
  case textBase = "--text-base"
  case textMd = "--text-md"
  case textLg = "--text-lg"
  case textXl = "--text-xl"
  case text2xl = "--text-2xl"
  case text3xl = "--text-3xl"
  case textTitle = "--text-title"
  case textFigure = "--text-figure"
  case figureSize = "--figure-size"
  case textLead = "--text-lead"
  case measure = "--measure"
  case space1 = "--space-1"
  case space2 = "--space-2"
  case space3 = "--space-3"
  case space4 = "--space-4"
  case space5 = "--space-5"
  case space6 = "--space-6"
  case space7 = "--space-7"
  case cardPad = "--card-pad"
  case gridGap = "--grid-gap"
  case gridGapX = "--grid-gap-x"
  case sectionGap = "--section-gap"
  case pagePad = "--page-pad"
  case pageTop = "--page-top"
  case rowPad = "--row-pad"
  case rowPadLg = "--row-pad-lg"
  case controlH = "--control-h"
  case timeCol = "--time-col"
  case radiusSm = "--radius-sm"
  case radius = "--radius"
  case radiusLg = "--radius-lg"
  case pill = "--pill"
  case shadowSm = "--shadow-sm"
  case shadowMd = "--shadow-md"
  case shadowLg = "--shadow-lg"
  case focusRing = "--focus-ring"
  case focus = "--focus"
  case sidebarW = "--sidebar-w"
  case railW = "--rail-w"
  case appbarH = "--appbar-h"
  case tabbarH = "--tabbar-h"
  case contentMax = "--content-max"
  case shellMax = "--shell-max"
  case ease = "--ease"
  case accent = "--accent"
  case accentHover = "--accent-hover"
  case accentInk = "--accent-ink"
  case accentWash = "--accent-wash"
  case accentLine = "--accent-line"
  case onAccent = "--on-accent"
  case second = "--second"
  case secondInk = "--second-ink"
  case secondWash = "--second-wash"
  case secondTip = "--second-tip"
  case chart1 = "--chart-1"
  case chart2 = "--chart-2"
  case chart3 = "--chart-3"
  case chart4 = "--chart-4"
  case chartArea = "--chart-area"
  case heat0 = "--heat-0"
  case heat1 = "--heat-1"
  case heat2 = "--heat-2"
  case heat3 = "--heat-3"
  case heat4 = "--heat-4"
  case heat5 = "--heat-5"
  case heat6 = "--heat-6"

  /// What the token holds once resolved.
  public var kind: ThemeTokenKind {
    switch self {
    case .colorScheme:
      return .keyword
    case .bg, .surface, .surface2, .surface3, .hover, .scrim, .tint, .accentTint, .ink, .ink2, .muted, .faint, .line, .line2, .lineSoft, .rule, .skyTop, .skyMid, .btn, .btnHover, .onBtn, .up, .upWash, .down, .downWash, .ok, .warn, .warnWash, .danger, .dangerHover, .dangerWash, .chartGrid, .chartAxis, .chartGhost, .avatarBg, .avatarInk, .focusRing, .accent, .accentHover, .accentInk, .accentWash, .accentLine, .onAccent, .second, .secondInk, .secondWash, .secondTip, .chart1, .chart2, .chart3, .chart4, .chartArea, .heat0, .heat1, .heat2, .heat3, .heat4, .heat5, .heat6:
      return .color
    case .skyMidAt, .skyEnd, .textXs, .textSm, .textBase, .textMd, .textLg, .textXl, .text2xl, .text3xl, .textTitle, .textFigure, .figureSize, .textLead, .measure, .space1, .space2, .space3, .space4, .space5, .space6, .space7, .cardPad, .gridGap, .gridGapX, .sectionGap, .pagePad, .pageTop, .rowPad, .rowPadLg, .controlH, .timeCol, .radiusSm, .radius, .radiusLg, .pill, .sidebarW, .railW, .appbarH, .tabbarH, .contentMax, .shellMax:
      return .length
    case .sans, .code:
      return .fonts
    case .shadowSm, .shadowMd, .shadowLg, .focus:
      return .shadow
    case .ease:
      return .easing
    }
  }
}

extension ThemeTokens {
  /// The rules that set tokens on <html>, in cascade order (theme.css, then
  /// the sheets after it as the app loads them).
  public static let blocks: [ThemeBlock] = [
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root]])],
      declarations: [
        ThemeDeclaration(.colorScheme, "light", .keyword("light")),
        ThemeDeclaration(.bg, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.surface, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.surface2, "#f6f8fc", .color(.hex(0xf6f8fc))),
        ThemeDeclaration(.surface3, "#edf1f8", .color(.hex(0xedf1f8))),
        ThemeDeclaration(.hover, "#e6ebf5", .color(.hex(0xe6ebf5))),
        ThemeDeclaration(.scrim, "rgb(15 27 51 / 0.42)", .color(.rgb(15, 27, 51, 0.42))),
        ThemeDeclaration(.tint, "rgb(15 27 51 / 0.06)", .color(.rgb(15, 27, 51, 0.06))),
        ThemeDeclaration(.accentTint, "color-mix(in srgb, var(--accent) 12%, transparent)", .colorMix(ThemeColorMix(first: .variable(.accent), firstPercent: 12, second: .color(.rgb(0, 0, 0, 0)), secondPercent: nil))),
        ThemeDeclaration(.ink, "#0f1b33", .color(.hex(0x0f1b33))),
        ThemeDeclaration(.ink2, "#33415c", .color(.hex(0x33415c))),
        ThemeDeclaration(.muted, "#46536b", .color(.hex(0x46536b))),
        ThemeDeclaration(.faint, "#7c879b", .color(.hex(0x7c879b))),
        ThemeDeclaration(.line, "rgb(15 27 51 / 0.14)", .color(.rgb(15, 27, 51, 0.14))),
        ThemeDeclaration(.line2, "rgb(15 27 51 / 0.3)", .color(.rgb(15, 27, 51, 0.3))),
        ThemeDeclaration(.lineSoft, "rgb(15 27 51 / 0.08)", .color(.rgb(15, 27, 51, 0.08))),
        ThemeDeclaration(.rule, "var(--ink)", .variable(.ink)),
        ThemeDeclaration(.skyTop, "#b9d5ff", .color(.hex(0xb9d5ff))),
        ThemeDeclaration(.skyMid, "#e1edff", .color(.hex(0xe1edff))),
        ThemeDeclaration(.skyMidAt, "240px", .length(.px(240))),
        ThemeDeclaration(.skyEnd, "560px", .length(.px(560))),
        ThemeDeclaration(.btn, "var(--ink)", .variable(.ink)),
        ThemeDeclaration(.btnHover, "var(--ink-2)", .variable(.ink2)),
        ThemeDeclaration(.onBtn, "var(--bg)", .variable(.bg)),
        ThemeDeclaration(.up, "var(--accent-ink)", .variable(.accentInk)),
        ThemeDeclaration(.upWash, "var(--accent-wash)", .variable(.accentWash)),
        ThemeDeclaration(.down, "var(--second-ink)", .variable(.secondInk)),
        ThemeDeclaration(.downWash, "var(--second-wash)", .variable(.secondWash)),
        ThemeDeclaration(.ok, "#12b76a", .color(.hex(0x12b76a))),
        ThemeDeclaration(.warn, "#b54708", .color(.hex(0xb54708))),
        ThemeDeclaration(.warnWash, "#fdf3e2", .color(.hex(0xfdf3e2))),
        ThemeDeclaration(.danger, "#b42318", .color(.hex(0xb42318))),
        ThemeDeclaration(.dangerHover, "#912018", .color(.hex(0x912018))),
        ThemeDeclaration(.dangerWash, "#fef3f2", .color(.hex(0xfef3f2))),
        ThemeDeclaration(.chartGrid, "rgb(15 27 51 / 0.1)", .color(.rgb(15, 27, 51, 0.1))),
        ThemeDeclaration(.chartAxis, "rgb(15 27 51 / 0.3)", .color(.rgb(15, 27, 51, 0.3))),
        ThemeDeclaration(.chartGhost, "#5d6b82", .color(.hex(0x5d6b82))),
        ThemeDeclaration(.avatarBg, "#dfe7f5", .color(.hex(0xdfe7f5))),
        ThemeDeclaration(.avatarInk, "#33415c", .color(.hex(0x33415c))),
        ThemeDeclaration(.sans, "'Instrument Sans Variable', 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", .fonts(["Instrument Sans Variable", "Instrument Sans", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"])),
        ThemeDeclaration(.code, "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", .fonts(["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"])),
        ThemeDeclaration(.textXs, "0.75rem", .length(.rem(0.75))),
        ThemeDeclaration(.textSm, "0.8125rem", .length(.rem(0.8125))),
        ThemeDeclaration(.textBase, "0.875rem", .length(.rem(0.875))),
        ThemeDeclaration(.textMd, "0.9375rem", .length(.rem(0.9375))),
        ThemeDeclaration(.textLg, "1.125rem", .length(.rem(1.125))),
        ThemeDeclaration(.textXl, "1.375rem", .length(.rem(1.375))),
        ThemeDeclaration(.text2xl, "1.75rem", .length(.rem(1.75))),
        ThemeDeclaration(.text3xl, "2.25rem", .length(.rem(2.25))),
        ThemeDeclaration(.textTitle, "2rem", .length(.rem(2))),
        ThemeDeclaration(.textFigure, "clamp(2.5rem, 1.6rem + 2.6vw, 3.75rem)", .length(.function(.clamp, [.rem(2.5), .operation(.add, .rem(1.6), .value(2.6, .vw)), .rem(3.75)]))),
        ThemeDeclaration(.figureSize, "min(var(--text-figure), 26cqi)", .length(.function(.min, [.variable(.textFigure), .value(26, .cqi)]))),
        ThemeDeclaration(.textLead, "clamp(1.25rem, 1rem + 0.8vw, 1.5rem)", .length(.function(.clamp, [.rem(1.25), .operation(.add, .rem(1), .value(0.8, .vw)), .rem(1.5)]))),
        ThemeDeclaration(.measure, "54ch", .length(.value(54, .ch))),
        ThemeDeclaration(.space1, "4px", .length(.px(4))),
        ThemeDeclaration(.space2, "8px", .length(.px(8))),
        ThemeDeclaration(.space3, "12px", .length(.px(12))),
        ThemeDeclaration(.space4, "16px", .length(.px(16))),
        ThemeDeclaration(.space5, "24px", .length(.px(24))),
        ThemeDeclaration(.space6, "32px", .length(.px(32))),
        ThemeDeclaration(.space7, "48px", .length(.px(48))),
        ThemeDeclaration(.cardPad, "16px", .length(.px(16))),
        ThemeDeclaration(.gridGap, "40px", .length(.px(40))),
        ThemeDeclaration(.gridGapX, "48px", .length(.px(48))),
        ThemeDeclaration(.sectionGap, "40px", .length(.px(40))),
        ThemeDeclaration(.pagePad, "clamp(28px, 4vw, 56px)", .length(.function(.clamp, [.px(28), .value(4, .vw), .px(56)]))),
        ThemeDeclaration(.pageTop, "40px", .length(.px(40))),
        ThemeDeclaration(.rowPad, "12px", .length(.px(12))),
        ThemeDeclaration(.rowPadLg, "16px", .length(.px(16))),
        ThemeDeclaration(.controlH, "36px", .length(.px(36))),
        ThemeDeclaration(.timeCol, "112px", .length(.px(112))),
        ThemeDeclaration(.radiusSm, "6px", .length(.px(6))),
        ThemeDeclaration(.radius, "8px", .length(.px(8))),
        ThemeDeclaration(.radiusLg, "12px", .length(.px(12))),
        ThemeDeclaration(.pill, "999px", .length(.px(999))),
        ThemeDeclaration(.shadowSm, "0 1px 2px rgb(15 27 51 / 0.08)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(1), blur: .px(2), color: .color(.rgb(15, 27, 51, 0.08)))])),
        ThemeDeclaration(.shadowMd, "0 6px 16px -4px rgb(15 27 51 / 0.14), 0 2px 4px -2px rgb(15 27 51 / 0.06)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(6), blur: .px(16), spread: .px(-4), color: .color(.rgb(15, 27, 51, 0.14))), ThemeShadowLayer(x: .px(0), y: .px(2), blur: .px(4), spread: .px(-2), color: .color(.rgb(15, 27, 51, 0.06)))])),
        ThemeDeclaration(.shadowLg, "0 24px 48px -16px rgb(15 27 51 / 0.28), 0 0 0 1px rgb(15 27 51 / 0.06)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(24), blur: .px(48), spread: .px(-16), color: .color(.rgb(15, 27, 51, 0.28))), ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(1), color: .color(.rgb(15, 27, 51, 0.06)))])),
        ThemeDeclaration(.focusRing, "var(--accent)", .variable(.accent)),
        ThemeDeclaration(.focus, "0 0 0 1px var(--focus-ring), 0 0 0 4px color-mix(in srgb, var(--focus-ring) 32%, transparent)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(1), color: .variable(.focusRing)), ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(4), color: .colorMix(ThemeColorMix(first: .variable(.focusRing), firstPercent: 32, second: .color(.rgb(0, 0, 0, 0)), secondPercent: nil)))])),
        ThemeDeclaration(.sidebarW, "272px", .length(.px(272))),
        ThemeDeclaration(.railW, "72px", .length(.px(72))),
        ThemeDeclaration(.appbarH, "56px", .length(.px(56))),
        ThemeDeclaration(.tabbarH, "64px", .length(.px(64))),
        ThemeDeclaration(.contentMax, "1040px", .length(.px(1040))),
        ThemeDeclaration(.shellMax, "calc(var(--sidebar-w) + var(--content-max) + var(--page-pad) * 2)", .length(.function(.calc, [.operation(.add, .operation(.add, .variable(.sidebarW), .variable(.contentMax)), .operation(.multiply, .variable(.pagePad), .number(2)))]))),
        ThemeDeclaration(.ease, "cubic-bezier(0.2, 0.8, 0.2, 1)", .cubicBezier(ThemeCubicBezier(0.2, 0.8, 0.2, 1))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-density", "compact")]])],
      declarations: [
        ThemeDeclaration(.cardPad, "12px", .length(.px(12))),
        ThemeDeclaration(.gridGap, "28px", .length(.px(28))),
        ThemeDeclaration(.gridGapX, "36px", .length(.px(36))),
        ThemeDeclaration(.sectionGap, "28px", .length(.px(28))),
        ThemeDeclaration(.pagePad, "clamp(24px, 3vw, 40px)", .length(.function(.clamp, [.px(24), .value(3, .vw), .px(40)]))),
        ThemeDeclaration(.pageTop, "28px", .length(.px(28))),
        ThemeDeclaration(.rowPad, "8px", .length(.px(8))),
        ThemeDeclaration(.rowPadLg, "12px", .length(.px(12))),
        ThemeDeclaration(.controlH, "32px", .length(.px(32))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-sky", "dawn")]])],
      declarations: [
        ThemeDeclaration(.skyTop, "#ffd8c4", .color(.hex(0xffd8c4))),
        ThemeDeclaration(.skyMid, "#e4ecff", .color(.hex(0xe4ecff))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-sky", "dusk")]])],
      declarations: [
        ThemeDeclaration(.skyTop, "#cbc5f4", .color(.hex(0xcbc5f4))),
        ThemeDeclaration(.skyMid, "#fbe9ee", .color(.hex(0xfbe9ee))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-sky", "night")]])],
      declarations: [
        ThemeDeclaration(.skyTop, "#0e1a3a", .color(.hex(0x0e1a3a))),
        ThemeDeclaration(.skyMid, "#22315f", .color(.hex(0x22315f))),
        ThemeDeclaration(.skyEnd, "620px", .length(.px(620))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-theme", "dark")]])],
      declarations: [
        ThemeDeclaration(.colorScheme, "dark", .keyword("dark")),
        ThemeDeclaration(.bg, "#0d152b", .color(.hex(0x0d152b))),
        ThemeDeclaration(.surface, "#162140", .color(.hex(0x162140))),
        ThemeDeclaration(.surface2, "#111a34", .color(.hex(0x111a34))),
        ThemeDeclaration(.surface3, "#1c284a", .color(.hex(0x1c284a))),
        ThemeDeclaration(.hover, "#243257", .color(.hex(0x243257))),
        ThemeDeclaration(.scrim, "rgb(3 7 18 / 0.66)", .color(.rgb(3, 7, 18, 0.66))),
        ThemeDeclaration(.tint, "rgb(255 255 255 / 0.08)", .color(.rgb(255, 255, 255, 0.08))),
        ThemeDeclaration(.accentTint, "color-mix(in srgb, var(--accent) 16%, transparent)", .colorMix(ThemeColorMix(first: .variable(.accent), firstPercent: 16, second: .color(.rgb(0, 0, 0, 0)), secondPercent: nil))),
        ThemeDeclaration(.ink, "#f2f5fc", .color(.hex(0xf2f5fc))),
        ThemeDeclaration(.ink2, "#d5ddf0", .color(.hex(0xd5ddf0))),
        ThemeDeclaration(.muted, "#b4beda", .color(.hex(0xb4beda))),
        ThemeDeclaration(.faint, "#7482a8", .color(.hex(0x7482a8))),
        ThemeDeclaration(.line, "rgb(255 255 255 / 0.16)", .color(.rgb(255, 255, 255, 0.16))),
        ThemeDeclaration(.line2, "rgb(255 255 255 / 0.32)", .color(.rgb(255, 255, 255, 0.32))),
        ThemeDeclaration(.lineSoft, "rgb(255 255 255 / 0.09)", .color(.rgb(255, 255, 255, 0.09))),
        ThemeDeclaration(.ok, "#2fbf71", .color(.hex(0x2fbf71))),
        ThemeDeclaration(.warn, "#f5b454", .color(.hex(0xf5b454))),
        ThemeDeclaration(.warnWash, "#33290f", .color(.hex(0x33290f))),
        ThemeDeclaration(.danger, "#ff8a80", .color(.hex(0xff8a80))),
        ThemeDeclaration(.dangerHover, "#ffb1aa", .color(.hex(0xffb1aa))),
        ThemeDeclaration(.dangerWash, "#3a1a1f", .color(.hex(0x3a1a1f))),
        ThemeDeclaration(.chartGrid, "rgb(255 255 255 / 0.1)", .color(.rgb(255, 255, 255, 0.1))),
        ThemeDeclaration(.chartAxis, "rgb(255 255 255 / 0.32)", .color(.rgb(255, 255, 255, 0.32))),
        ThemeDeclaration(.chartGhost, "#a3aecb", .color(.hex(0xa3aecb))),
        ThemeDeclaration(.avatarBg, "#2a3963", .color(.hex(0x2a3963))),
        ThemeDeclaration(.avatarInk, "#d5ddf0", .color(.hex(0xd5ddf0))),
        ThemeDeclaration(.shadowSm, "0 1px 2px rgb(0 0 0 / 0.4)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(1), blur: .px(2), color: .color(.rgb(0, 0, 0, 0.4)))])),
        ThemeDeclaration(.shadowMd, "0 8px 20px -6px rgb(0 0 0 / 0.6)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(8), blur: .px(20), spread: .px(-6), color: .color(.rgb(0, 0, 0, 0.6)))])),
        ThemeDeclaration(.shadowLg, "0 24px 48px -12px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.08)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(24), blur: .px(48), spread: .px(-12), color: .color(.rgb(0, 0, 0, 0.7))), ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(1), color: .color(.rgb(255, 255, 255, 0.08)))])),
        ThemeDeclaration(.focusRing, "var(--accent-ink)", .variable(.accentInk)),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root]]), ThemeSelector([[.attribute("data-accent", "blue")]])],
      declarations: [
        ThemeDeclaration(.accent, "#1d5ee0", .color(.hex(0x1d5ee0))),
        ThemeDeclaration(.accentHover, "#1849b5", .color(.hex(0x1849b5))),
        ThemeDeclaration(.accentInk, "#1849b5", .color(.hex(0x1849b5))),
        ThemeDeclaration(.accentWash, "#eef3fd", .color(.hex(0xeef3fd))),
        ThemeDeclaration(.accentLine, "#c9d8f7", .color(.hex(0xc9d8f7))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#e8553a", .color(.hex(0xe8553a))),
        ThemeDeclaration(.secondInk, "#b13a1f", .color(.hex(0xb13a1f))),
        ThemeDeclaration(.secondWash, "#fdeeea", .color(.hex(0xfdeeea))),
        ThemeDeclaration(.secondTip, "#ffb7a6", .color(.hex(0xffb7a6))),
        ThemeDeclaration(.chart1, "#1d5ee0", .color(.hex(0x1d5ee0))),
        ThemeDeclaration(.chart2, "#e8553a", .color(.hex(0xe8553a))),
        ThemeDeclaration(.chart3, "#1baf7a", .color(.hex(0x1baf7a))),
        ThemeDeclaration(.chart4, "#eda100", .color(.hex(0xeda100))),
        ThemeDeclaration(.chartArea, "rgb(29 94 224 / 0.08)", .color(.rgb(29, 94, 224, 0.08))),
        ThemeDeclaration(.heat0, "#f2f5fa", .color(.hex(0xf2f5fa))),
        ThemeDeclaration(.heat1, "#dce8fb", .color(.hex(0xdce8fb))),
        ThemeDeclaration(.heat2, "#b7d3f6", .color(.hex(0xb7d3f6))),
        ThemeDeclaration(.heat3, "#86b6ef", .color(.hex(0x86b6ef))),
        ThemeDeclaration(.heat4, "#5598e7", .color(.hex(0x5598e7))),
        ThemeDeclaration(.heat5, "#2a78d6", .color(.hex(0x2a78d6))),
        ThemeDeclaration(.heat6, "#1c5cab", .color(.hex(0x1c5cab))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-theme", "dark")]]), ThemeSelector([[.attribute("data-theme", "dark")], [.attribute("data-accent", "blue")]])],
      declarations: [
        ThemeDeclaration(.accent, "#7ab0f5", .color(.hex(0x7ab0f5))),
        ThemeDeclaration(.accentHover, "#a2c8f9", .color(.hex(0xa2c8f9))),
        ThemeDeclaration(.accentInk, "#7ab0f5", .color(.hex(0x7ab0f5))),
        ThemeDeclaration(.accentWash, "#20304e", .color(.hex(0x20304e))),
        ThemeDeclaration(.accentLine, "#375079", .color(.hex(0x375079))),
        ThemeDeclaration(.onAccent, "#0d152b", .color(.hex(0x0d152b))),
        ThemeDeclaration(.second, "#d95926", .color(.hex(0xd95926))),
        ThemeDeclaration(.secondInk, "#f0906a", .color(.hex(0xf0906a))),
        ThemeDeclaration(.secondWash, "#312a39", .color(.hex(0x312a39))),
        ThemeDeclaration(.secondTip, "#b13a1f", .color(.hex(0xb13a1f))),
        ThemeDeclaration(.chart1, "#3987e5", .color(.hex(0x3987e5))),
        ThemeDeclaration(.chart2, "#d95926", .color(.hex(0xd95926))),
        ThemeDeclaration(.chart3, "#199e70", .color(.hex(0x199e70))),
        ThemeDeclaration(.chart4, "#c98500", .color(.hex(0xc98500))),
        ThemeDeclaration(.chartArea, "rgb(57 135 229 / 0.14)", .color(.rgb(57, 135, 229, 0.14))),
        ThemeDeclaration(.heat0, "#1a2748", .color(.hex(0x1a2748))),
        ThemeDeclaration(.heat1, "#213965", .color(.hex(0x213965))),
        ThemeDeclaration(.heat2, "#284b83", .color(.hex(0x284b83))),
        ThemeDeclaration(.heat3, "#2e5ea2", .color(.hex(0x2e5ea2))),
        ThemeDeclaration(.heat4, "#3472c3", .color(.hex(0x3472c3))),
        ThemeDeclaration(.heat5, "#3987e5", .color(.hex(0x3987e5))),
        ThemeDeclaration(.heat6, "#7ab0f5", .color(.hex(0x7ab0f5))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-accent", "violet")]])],
      declarations: [
        ThemeDeclaration(.accent, "#8149e3", .color(.hex(0x8149e3))),
        ThemeDeclaration(.accentHover, "#6333b3", .color(.hex(0x6333b3))),
        ThemeDeclaration(.accentInk, "#6333b3", .color(.hex(0x6333b3))),
        ThemeDeclaration(.accentWash, "#f4f1fe", .color(.hex(0xf4f1fe))),
        ThemeDeclaration(.accentLine, "#dbd3f9", .color(.hex(0xdbd3f9))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#e8553a", .color(.hex(0xe8553a))),
        ThemeDeclaration(.secondInk, "#b13a1f", .color(.hex(0xb13a1f))),
        ThemeDeclaration(.secondWash, "#fdeeea", .color(.hex(0xfdeeea))),
        ThemeDeclaration(.secondTip, "#ffb7a6", .color(.hex(0xffb7a6))),
        ThemeDeclaration(.chart1, "#8149e3", .color(.hex(0x8149e3))),
        ThemeDeclaration(.chart2, "#e8553a", .color(.hex(0xe8553a))),
        ThemeDeclaration(.chart3, "#1baf7a", .color(.hex(0x1baf7a))),
        ThemeDeclaration(.chart4, "#eda100", .color(.hex(0xeda100))),
        ThemeDeclaration(.chartArea, "rgb(129 73 227 / 0.08)", .color(.rgb(129, 73, 227, 0.08))),
        ThemeDeclaration(.heat0, "#f6f5fb", .color(.hex(0xf6f5fb))),
        ThemeDeclaration(.heat1, "#e9e4fd", .color(.hex(0xe9e4fd))),
        ThemeDeclaration(.heat2, "#d4c9f9", .color(.hex(0xd4c9f9))),
        ThemeDeclaration(.heat3, "#b8a4f2", .color(.hex(0xb8a4f2))),
        ThemeDeclaration(.heat4, "#9d7fea", .color(.hex(0x9d7fea))),
        ThemeDeclaration(.heat5, "#845ed7", .color(.hex(0x845ed7))),
        ThemeDeclaration(.heat6, "#6645ab", .color(.hex(0x6645ab))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-theme", "dark"), .attribute("data-accent", "violet")]]), ThemeSelector([[.attribute("data-theme", "dark")], [.attribute("data-accent", "violet")]])],
      declarations: [
        ThemeDeclaration(.accent, "#b8a0fc", .color(.hex(0xb8a0fc))),
        ThemeDeclaration(.accentHover, "#ccbdfe", .color(.hex(0xccbdfe))),
        ThemeDeclaration(.accentInk, "#b8a0fc", .color(.hex(0xb8a0fc))),
        ThemeDeclaration(.accentWash, "#2b2d50", .color(.hex(0x2b2d50))),
        ThemeDeclaration(.accentLine, "#4e4a7b", .color(.hex(0x4e4a7b))),
        ThemeDeclaration(.onAccent, "#0d152b", .color(.hex(0x0d152b))),
        ThemeDeclaration(.second, "#d95926", .color(.hex(0xd95926))),
        ThemeDeclaration(.secondInk, "#f0906a", .color(.hex(0xf0906a))),
        ThemeDeclaration(.secondWash, "#312a39", .color(.hex(0x312a39))),
        ThemeDeclaration(.secondTip, "#b13a1f", .color(.hex(0xb13a1f))),
        ThemeDeclaration(.chart1, "#906be2", .color(.hex(0x906be2))),
        ThemeDeclaration(.chart2, "#d95926", .color(.hex(0xd95926))),
        ThemeDeclaration(.chart3, "#199e70", .color(.hex(0x199e70))),
        ThemeDeclaration(.chart4, "#c98500", .color(.hex(0xc98500))),
        ThemeDeclaration(.chartArea, "rgb(144 107 226 / 0.14)", .color(.rgb(144, 107, 226, 0.14))),
        ThemeDeclaration(.heat0, "#1d2748", .color(.hex(0x1d2748))),
        ThemeDeclaration(.heat1, "#323464", .color(.hex(0x323464))),
        ThemeDeclaration(.heat2, "#484281", .color(.hex(0x484281))),
        ThemeDeclaration(.heat3, "#5f509f", .color(.hex(0x5f509f))),
        ThemeDeclaration(.heat4, "#775ebf", .color(.hex(0x775ebf))),
        ThemeDeclaration(.heat5, "#8f6ddf", .color(.hex(0x8f6ddf))),
        ThemeDeclaration(.heat6, "#b49df5", .color(.hex(0xb49df5))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-accent", "teal")]])],
      declarations: [
        ThemeDeclaration(.accent, "#0a7788", .color(.hex(0x0a7788))),
        ThemeDeclaration(.accentHover, "#055a67", .color(.hex(0x055a67))),
        ThemeDeclaration(.accentInk, "#055a67", .color(.hex(0x055a67))),
        ThemeDeclaration(.accentWash, "#e8f7fa", .color(.hex(0xe8f7fa))),
        ThemeDeclaration(.accentLine, "#b4e3ec", .color(.hex(0xb4e3ec))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#e8553a", .color(.hex(0xe8553a))),
        ThemeDeclaration(.secondInk, "#b13a1f", .color(.hex(0xb13a1f))),
        ThemeDeclaration(.secondWash, "#fdeeea", .color(.hex(0xfdeeea))),
        ThemeDeclaration(.secondTip, "#ffb7a6", .color(.hex(0xffb7a6))),
        ThemeDeclaration(.chart1, "#0e95a9", .color(.hex(0x0e95a9))),
        ThemeDeclaration(.chart2, "#e8553a", .color(.hex(0xe8553a))),
        ThemeDeclaration(.chart3, "#6250d6", .color(.hex(0x6250d6))),
        ThemeDeclaration(.chart4, "#eda100", .color(.hex(0xeda100))),
        ThemeDeclaration(.chartArea, "rgb(14 149 169 / 0.08)", .color(.rgb(14, 149, 169, 0.08))),
        ThemeDeclaration(.heat0, "#f0f7f9", .color(.hex(0xf0f7f9))),
        ThemeDeclaration(.heat1, "#d1eef4", .color(.hex(0xd1eef4))),
        ThemeDeclaration(.heat2, "#a0dde9", .color(.hex(0xa0dde9))),
        ThemeDeclaration(.heat3, "#52c4da", .color(.hex(0x52c4da))),
        ThemeDeclaration(.heat4, "#02a7bf", .color(.hex(0x02a7bf))),
        ThemeDeclaration(.heat5, "#06899d", .color(.hex(0x06899d))),
        ThemeDeclaration(.heat6, "#006a79", .color(.hex(0x006a79))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-theme", "dark"), .attribute("data-accent", "teal")]]), ThemeSelector([[.attribute("data-theme", "dark")], [.attribute("data-accent", "teal")]])],
      declarations: [
        ThemeDeclaration(.accent, "#20c1da", .color(.hex(0x20c1da))),
        ThemeDeclaration(.accentHover, "#7dd4e6", .color(.hex(0x7dd4e6))),
        ThemeDeclaration(.accentInk, "#20c1da", .color(.hex(0x20c1da))),
        ThemeDeclaration(.accentWash, "#16334a", .color(.hex(0x16334a))),
        ThemeDeclaration(.accentLine, "#1d576f", .color(.hex(0x1d576f))),
        ThemeDeclaration(.onAccent, "#0d152b", .color(.hex(0x0d152b))),
        ThemeDeclaration(.second, "#d95926", .color(.hex(0xd95926))),
        ThemeDeclaration(.secondInk, "#f0906a", .color(.hex(0xf0906a))),
        ThemeDeclaration(.secondWash, "#312a39", .color(.hex(0x312a39))),
        ThemeDeclaration(.secondTip, "#b13a1f", .color(.hex(0xb13a1f))),
        ThemeDeclaration(.chart1, "#15b1c9", .color(.hex(0x15b1c9))),
        ThemeDeclaration(.chart2, "#d95926", .color(.hex(0xd95926))),
        ThemeDeclaration(.chart3, "#9085e9", .color(.hex(0x9085e9))),
        ThemeDeclaration(.chart4, "#c98500", .color(.hex(0xc98500))),
        ThemeDeclaration(.chartArea, "rgb(21 177 201 / 0.14)", .color(.rgb(21, 177, 201, 0.14))),
        ThemeDeclaration(.heat0, "#182847", .color(.hex(0x182847))),
        ThemeDeclaration(.heat1, "#1b3d5a", .color(.hex(0x1b3d5a))),
        ThemeDeclaration(.heat2, "#1d526d", .color(.hex(0x1d526d))),
        ThemeDeclaration(.heat3, "#1c6881", .color(.hex(0x1c6881))),
        ThemeDeclaration(.heat4, "#187f96", .color(.hex(0x187f96))),
        ThemeDeclaration(.heat5, "#0b97ab", .color(.hex(0x0b97ab))),
        ThemeDeclaration(.heat6, "#32c2da", .color(.hex(0x32c2da))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-accent", "amber")]])],
      declarations: [
        ThemeDeclaration(.accent, "#966105", .color(.hex(0x966105))),
        ThemeDeclaration(.accentHover, "#764700", .color(.hex(0x764700))),
        ThemeDeclaration(.accentInk, "#764700", .color(.hex(0x764700))),
        ThemeDeclaration(.accentWash, "#f8f3e8", .color(.hex(0xf8f3e8))),
        ThemeDeclaration(.accentLine, "#e9d7b4", .color(.hex(0xe9d7b4))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#2a78d6", .color(.hex(0x2a78d6))),
        ThemeDeclaration(.secondInk, "#1c5cab", .color(.hex(0x1c5cab))),
        ThemeDeclaration(.secondWash, "#eef3fd", .color(.hex(0xeef3fd))),
        ThemeDeclaration(.secondTip, "#a9cdfb", .color(.hex(0xa9cdfb))),
        ThemeDeclaration(.chart1, "#b47908", .color(.hex(0xb47908))),
        ThemeDeclaration(.chart2, "#2a78d6", .color(.hex(0x2a78d6))),
        ThemeDeclaration(.chart3, "#1baf7a", .color(.hex(0x1baf7a))),
        ThemeDeclaration(.chart4, "#6250d6", .color(.hex(0x6250d6))),
        ThemeDeclaration(.chartArea, "rgb(180 121 8 / 0.08)", .color(.rgb(180, 121, 8, 0.08))),
        ThemeDeclaration(.heat0, "#f8f6ef", .color(.hex(0xf8f6ef))),
        ThemeDeclaration(.heat1, "#f1e7d0", .color(.hex(0xf1e7d0))),
        ThemeDeclaration(.heat2, "#e5cea2", .color(.hex(0xe5cea2))),
        ThemeDeclaration(.heat3, "#d6ab60", .color(.hex(0xd6ab60))),
        ThemeDeclaration(.heat4, "#c48810", .color(.hex(0xc48810))),
        ThemeDeclaration(.heat5, "#a56d03", .color(.hex(0xa56d03))),
        ThemeDeclaration(.heat6, "#825103", .color(.hex(0x825103))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-theme", "dark"), .attribute("data-accent", "amber")]]), ThemeSelector([[.attribute("data-theme", "dark")], [.attribute("data-accent", "amber")]])],
      declarations: [
        ThemeDeclaration(.accent, "#d9a648", .color(.hex(0xd9a648))),
        ThemeDeclaration(.accentHover, "#e5c185", .color(.hex(0xe5c185))),
        ThemeDeclaration(.accentInk, "#d9a648", .color(.hex(0xd9a648))),
        ThemeDeclaration(.accentWash, "#303037", .color(.hex(0x303037))),
        ThemeDeclaration(.accentLine, "#5a4f41", .color(.hex(0x5a4f41))),
        ThemeDeclaration(.onAccent, "#0d152b", .color(.hex(0x0d152b))),
        ThemeDeclaration(.second, "#3987e5", .color(.hex(0x3987e5))),
        ThemeDeclaration(.secondInk, "#7ab0f5", .color(.hex(0x7ab0f5))),
        ThemeDeclaration(.secondWash, "#1e2d4b", .color(.hex(0x1e2d4b))),
        ThemeDeclaration(.secondTip, "#1c5cab", .color(.hex(0x1c5cab))),
        ThemeDeclaration(.chart1, "#e3a41a", .color(.hex(0xe3a41a))),
        ThemeDeclaration(.chart2, "#3987e5", .color(.hex(0x3987e5))),
        ThemeDeclaration(.chart3, "#199e70", .color(.hex(0x199e70))),
        ThemeDeclaration(.chart4, "#9085e9", .color(.hex(0x9085e9))),
        ThemeDeclaration(.chartArea, "rgb(227 164 26 / 0.14)", .color(.rgb(227, 164, 26, 0.14))),
        ThemeDeclaration(.heat0, "#1e2842", .color(.hex(0x1e2842))),
        ThemeDeclaration(.heat1, "#3a3942", .color(.hex(0x3a3942))),
        ThemeDeclaration(.heat2, "#56493f", .color(.hex(0x56493f))),
        ThemeDeclaration(.heat3, "#745939", .color(.hex(0x745939))),
        ThemeDeclaration(.heat4, "#93682b", .color(.hex(0x93682b))),
        ThemeDeclaration(.heat5, "#b37802", .color(.hex(0xb37802))),
        ThemeDeclaration(.heat6, "#d6a54d", .color(.hex(0xd6a54d))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-accent", "rose")]])],
      declarations: [
        ThemeDeclaration(.accent, "#cb2864", .color(.hex(0xcb2864))),
        ThemeDeclaration(.accentHover, "#9d144a", .color(.hex(0x9d144a))),
        ThemeDeclaration(.accentInk, "#9d144a", .color(.hex(0x9d144a))),
        ThemeDeclaration(.accentWash, "#fdeff2", .color(.hex(0xfdeff2))),
        ThemeDeclaration(.accentLine, "#f6cdd5", .color(.hex(0xf6cdd5))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#2a78d6", .color(.hex(0x2a78d6))),
        ThemeDeclaration(.secondInk, "#1c5cab", .color(.hex(0x1c5cab))),
        ThemeDeclaration(.secondWash, "#eef3fd", .color(.hex(0xeef3fd))),
        ThemeDeclaration(.secondTip, "#a9cdfb", .color(.hex(0xa9cdfb))),
        ThemeDeclaration(.chart1, "#cb2965", .color(.hex(0xcb2965))),
        ThemeDeclaration(.chart2, "#2a78d6", .color(.hex(0x2a78d6))),
        ThemeDeclaration(.chart3, "#1baf7a", .color(.hex(0x1baf7a))),
        ThemeDeclaration(.chart4, "#eda100", .color(.hex(0xeda100))),
        ThemeDeclaration(.chartArea, "rgb(203 41 101 / 0.08)", .color(.rgb(203, 41, 101, 0.08))),
        ThemeDeclaration(.heat0, "#fbf4f5", .color(.hex(0xfbf4f5))),
        ThemeDeclaration(.heat1, "#fbe0e5", .color(.hex(0xfbe0e5))),
        ThemeDeclaration(.heat2, "#f5c1cc", .color(.hex(0xf5c1cc))),
        ThemeDeclaration(.heat3, "#ea97aa", .color(.hex(0xea97aa))),
        ThemeDeclaration(.heat4, "#db6c89", .color(.hex(0xdb6c89))),
        ThemeDeclaration(.heat5, "#c4486d", .color(.hex(0xc4486d))),
        ThemeDeclaration(.heat6, "#9b3253", .color(.hex(0x9b3253))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-theme", "dark"), .attribute("data-accent", "rose")]]), ThemeSelector([[.attribute("data-theme", "dark")], [.attribute("data-accent", "rose")]])],
      declarations: [
        ThemeDeclaration(.accent, "#f191a7", .color(.hex(0xf191a7))),
        ThemeDeclaration(.accentHover, "#f8b2c1", .color(.hex(0xf8b2c1))),
        ThemeDeclaration(.accentInk, "#f191a7", .color(.hex(0xf191a7))),
        ThemeDeclaration(.accentWash, "#352c42", .color(.hex(0x352c42))),
        ThemeDeclaration(.accentLine, "#64475d", .color(.hex(0x64475d))),
        ThemeDeclaration(.onAccent, "#0d152b", .color(.hex(0x0d152b))),
        ThemeDeclaration(.second, "#3987e5", .color(.hex(0x3987e5))),
        ThemeDeclaration(.secondInk, "#7ab0f5", .color(.hex(0x7ab0f5))),
        ThemeDeclaration(.secondWash, "#1e2d4b", .color(.hex(0x1e2d4b))),
        ThemeDeclaration(.secondTip, "#1c5cab", .color(.hex(0x1c5cab))),
        ThemeDeclaration(.chart1, "#d05779", .color(.hex(0xd05779))),
        ThemeDeclaration(.chart2, "#3987e5", .color(.hex(0x3987e5))),
        ThemeDeclaration(.chart3, "#199e70", .color(.hex(0x199e70))),
        ThemeDeclaration(.chart4, "#c98500", .color(.hex(0xc98500))),
        ThemeDeclaration(.chartArea, "rgb(208 87 121 / 0.14)", .color(.rgb(208, 87, 121, 0.14))),
        ThemeDeclaration(.heat0, "#202745", .color(.hex(0x202745))),
        ThemeDeclaration(.heat1, "#423350", .color(.hex(0x423350))),
        ThemeDeclaration(.heat2, "#633e5b", .color(.hex(0x633e5b))),
        ThemeDeclaration(.heat3, "#864865", .color(.hex(0x864865))),
        ThemeDeclaration(.heat4, "#a95170", .color(.hex(0xa95170))),
        ThemeDeclaration(.heat5, "#ce597a", .color(.hex(0xce597a))),
        ThemeDeclaration(.heat6, "#eb8fa4", .color(.hex(0xeb8fa4))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-accent", "graphite")]])],
      declarations: [
        ThemeDeclaration(.accent, "#343e4a", .color(.hex(0x343e4a))),
        ThemeDeclaration(.accentHover, "#1e2733", .color(.hex(0x1e2733))),
        ThemeDeclaration(.accentInk, "#1e2733", .color(.hex(0x1e2733))),
        ThemeDeclaration(.accentWash, "#e8ebef", .color(.hex(0xe8ebef))),
        ThemeDeclaration(.accentLine, "#d6d9dd", .color(.hex(0xd6d9dd))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#e8553a", .color(.hex(0xe8553a))),
        ThemeDeclaration(.secondInk, "#b13a1f", .color(.hex(0xb13a1f))),
        ThemeDeclaration(.secondWash, "#fdeeea", .color(.hex(0xfdeeea))),
        ThemeDeclaration(.secondTip, "#ffb7a6", .color(.hex(0xffb7a6))),
        ThemeDeclaration(.chart1, "#323b48", .color(.hex(0x323b48))),
        ThemeDeclaration(.chart2, "#e8553a", .color(.hex(0xe8553a))),
        ThemeDeclaration(.chart3, "#1baf7a", .color(.hex(0x1baf7a))),
        ThemeDeclaration(.chart4, "#eda100", .color(.hex(0xeda100))),
        ThemeDeclaration(.chartArea, "rgb(50 59 72 / 0.08)", .color(.rgb(50, 59, 72, 0.08))),
        ThemeDeclaration(.heat0, "#f5f6f6", .color(.hex(0xf5f6f6))),
        ThemeDeclaration(.heat1, "#e6e8ea", .color(.hex(0xe6e8ea))),
        ThemeDeclaration(.heat2, "#ced1d6", .color(.hex(0xced1d6))),
        ThemeDeclaration(.heat3, "#adb3bb", .color(.hex(0xadb3bb))),
        ThemeDeclaration(.heat4, "#8e96a0", .color(.hex(0x8e96a0))),
        ThemeDeclaration(.heat5, "#727b87", .color(.hex(0x727b87))),
        ThemeDeclaration(.heat6, "#575e68", .color(.hex(0x575e68))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-theme", "dark"), .attribute("data-accent", "graphite")]]), ThemeSelector([[.attribute("data-theme", "dark")], [.attribute("data-accent", "graphite")]])],
      declarations: [
        ThemeDeclaration(.accent, "#d3dce7", .color(.hex(0xd3dce7))),
        ThemeDeclaration(.accentHover, "#e0e6ee", .color(.hex(0xe0e6ee))),
        ThemeDeclaration(.accentInk, "#d3dce7", .color(.hex(0xd3dce7))),
        ThemeDeclaration(.accentWash, "#2e374d", .color(.hex(0x2e374d))),
        ThemeDeclaration(.accentLine, "#576174", .color(.hex(0x576174))),
        ThemeDeclaration(.onAccent, "#0d152b", .color(.hex(0x0d152b))),
        ThemeDeclaration(.second, "#d95926", .color(.hex(0xd95926))),
        ThemeDeclaration(.secondInk, "#f0906a", .color(.hex(0xf0906a))),
        ThemeDeclaration(.secondWash, "#312a39", .color(.hex(0x312a39))),
        ThemeDeclaration(.secondTip, "#b13a1f", .color(.hex(0xb13a1f))),
        ThemeDeclaration(.chart1, "#c5cfdb", .color(.hex(0xc5cfdb))),
        ThemeDeclaration(.chart2, "#d95926", .color(.hex(0xd95926))),
        ThemeDeclaration(.chart3, "#199e70", .color(.hex(0x199e70))),
        ThemeDeclaration(.chart4, "#c98500", .color(.hex(0xc98500))),
        ThemeDeclaration(.chartArea, "rgb(197 207 219 / 0.14)", .color(.rgb(197, 207, 219, 0.14))),
        ThemeDeclaration(.heat0, "#1e2948", .color(.hex(0x1e2948))),
        ThemeDeclaration(.heat1, "#303b57", .color(.hex(0x303b57))),
        ThemeDeclaration(.heat2, "#424d65", .color(.hex(0x424d65))),
        ThemeDeclaration(.heat3, "#566074", .color(.hex(0x566074))),
        ThemeDeclaration(.heat4, "#6a7383", .color(.hex(0x6a7383))),
        ThemeDeclaration(.heat5, "#7f8792", .color(.hex(0x7f8792))),
        ThemeDeclaration(.heat6, "#a8afb7", .color(.hex(0xa8afb7))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-contrast", "high")]])],
      declarations: [
        ThemeDeclaration(.bg, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.surface, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.surface2, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.surface3, "#eef0f3", .color(.hex(0xeef0f3))),
        ThemeDeclaration(.hover, "#e4e7ec", .color(.hex(0xe4e7ec))),
        ThemeDeclaration(.scrim, "rgb(16 24 40 / 0.6)", .color(.rgb(16, 24, 40, 0.6))),
        ThemeDeclaration(.ink, "#0a0d14", .color(.hex(0x0a0d14))),
        ThemeDeclaration(.ink2, "#1d2534", .color(.hex(0x1d2534))),
        ThemeDeclaration(.muted, "#3b4558", .color(.hex(0x3b4558))),
        ThemeDeclaration(.faint, "#667085", .color(.hex(0x667085))),
        ThemeDeclaration(.line, "#6b7585", .color(.hex(0x6b7585))),
        ThemeDeclaration(.line2, "#475467", .color(.hex(0x475467))),
        ThemeDeclaration(.lineSoft, "#8a93a1", .color(.hex(0x8a93a1))),
        ThemeDeclaration(.ok, "#067647", .color(.hex(0x067647))),
        ThemeDeclaration(.warn, "#8a3a00", .color(.hex(0x8a3a00))),
        ThemeDeclaration(.warnWash, "#fdf3e2", .color(.hex(0xfdf3e2))),
        ThemeDeclaration(.danger, "#9a1b12", .color(.hex(0x9a1b12))),
        ThemeDeclaration(.dangerHover, "#7a140d", .color(.hex(0x7a140d))),
        ThemeDeclaration(.dangerWash, "#fef3f2", .color(.hex(0xfef3f2))),
        ThemeDeclaration(.chartGrid, "#c4cad3", .color(.hex(0xc4cad3))),
        ThemeDeclaration(.chartAxis, "#667085", .color(.hex(0x667085))),
        ThemeDeclaration(.chartGhost, "#475467", .color(.hex(0x475467))),
        ThemeDeclaration(.avatarBg, "#d0d5dd", .color(.hex(0xd0d5dd))),
        ThemeDeclaration(.avatarInk, "#1d2534", .color(.hex(0x1d2534))),
        ThemeDeclaration(.skyTop, "var(--bg)", .variable(.bg)),
        ThemeDeclaration(.skyMid, "var(--bg)", .variable(.bg)),
        ThemeDeclaration(.focusRing, "var(--accent)", .variable(.accent)),
        ThemeDeclaration(.focus, "0 0 0 2px var(--surface), 0 0 0 5px var(--focus-ring)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(2), color: .variable(.surface)), ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(5), color: .variable(.focusRing))])),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-contrast", "high"), .attribute("data-theme", "dark")]])],
      declarations: [
        ThemeDeclaration(.bg, "#000000", .color(.hex(0x000000))),
        ThemeDeclaration(.surface, "#0b0d11", .color(.hex(0x0b0d11))),
        ThemeDeclaration(.surface2, "#000000", .color(.hex(0x000000))),
        ThemeDeclaration(.surface3, "#1b1f27", .color(.hex(0x1b1f27))),
        ThemeDeclaration(.hover, "#262b35", .color(.hex(0x262b35))),
        ThemeDeclaration(.scrim, "rgb(0 0 0 / 0.75)", .color(.rgb(0, 0, 0, 0.75))),
        ThemeDeclaration(.ink, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.ink2, "#e4e8ef", .color(.hex(0xe4e8ef))),
        ThemeDeclaration(.muted, "#bcc4d0", .color(.hex(0xbcc4d0))),
        ThemeDeclaration(.faint, "#8791a1", .color(.hex(0x8791a1))),
        ThemeDeclaration(.line, "#6f7989", .color(.hex(0x6f7989))),
        ThemeDeclaration(.line2, "#98a2b3", .color(.hex(0x98a2b3))),
        ThemeDeclaration(.lineSoft, "#5c6676", .color(.hex(0x5c6676))),
        ThemeDeclaration(.ok, "#4ade8b", .color(.hex(0x4ade8b))),
        ThemeDeclaration(.warn, "#ffc56e", .color(.hex(0xffc56e))),
        ThemeDeclaration(.warnWash, "#2c2210", .color(.hex(0x2c2210))),
        ThemeDeclaration(.danger, "#ff9189", .color(.hex(0xff9189))),
        ThemeDeclaration(.dangerHover, "#ffb4ae", .color(.hex(0xffb4ae))),
        ThemeDeclaration(.dangerWash, "#2d1513", .color(.hex(0x2d1513))),
        ThemeDeclaration(.chartGrid, "#353c48", .color(.hex(0x353c48))),
        ThemeDeclaration(.chartAxis, "#8791a1", .color(.hex(0x8791a1))),
        ThemeDeclaration(.chartGhost, "#bcc4d0", .color(.hex(0xbcc4d0))),
        ThemeDeclaration(.avatarBg, "#353c48", .color(.hex(0x353c48))),
        ThemeDeclaration(.avatarInk, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.skyTop, "var(--bg)", .variable(.bg)),
        ThemeDeclaration(.skyMid, "var(--bg)", .variable(.bg)),
        ThemeDeclaration(.focusRing, "var(--accent)", .variable(.accent)),
        ThemeDeclaration(.focus, "0 0 0 2px var(--surface), 0 0 0 5px var(--focus-ring)", .shadow([ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(2), color: .variable(.surface)), ThemeShadowLayer(x: .px(0), y: .px(0), blur: .px(0), spread: .px(5), color: .variable(.focusRing))])),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-contrast", "high")]]), ThemeSelector([[.attribute("data-contrast", "high")], [.attribute("data-accent", "blue")]])],
      declarations: [
        ThemeDeclaration(.accent, "#0650ac", .color(.hex(0x0650ac))),
        ThemeDeclaration(.accentHover, "#003c87", .color(.hex(0x003c87))),
        ThemeDeclaration(.accentInk, "#004397", .color(.hex(0x004397))),
        ThemeDeclaration(.accentWash, "#e8f1ff", .color(.hex(0xe8f1ff))),
        ThemeDeclaration(.accentLine, "#0650ac", .color(.hex(0x0650ac))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#c83406", .color(.hex(0xc83406))),
        ThemeDeclaration(.secondInk, "#8f2a12", .color(.hex(0x8f2a12))),
        ThemeDeclaration(.secondWash, "#fdeeea", .color(.hex(0xfdeeea))),
        ThemeDeclaration(.secondTip, "#ffc4b5", .color(.hex(0xffc4b5))),
        ThemeDeclaration(.chart1, "#005cc8", .color(.hex(0x005cc8))),
        ThemeDeclaration(.chart2, "#c83406", .color(.hex(0xc83406))),
        ThemeDeclaration(.chart3, "#0b7a53", .color(.hex(0x0b7a53))),
        ThemeDeclaration(.chart4, "#8a5f00", .color(.hex(0x8a5f00))),
        ThemeDeclaration(.chartArea, "rgb(0 92 200 / 0.16)", .color(.rgb(0, 92, 200, 0.16))),
        ThemeDeclaration(.heat0, "#ebf1f8", .color(.hex(0xebf1f8))),
        ThemeDeclaration(.heat1, "#c4d9f9", .color(.hex(0xc4d9f9))),
        ThemeDeclaration(.heat2, "#97bdf4", .color(.hex(0x97bdf4))),
        ThemeDeclaration(.heat3, "#679ceb", .color(.hex(0x679ceb))),
        ThemeDeclaration(.heat4, "#3a7bda", .color(.hex(0x3a7bda))),
        ThemeDeclaration(.heat5, "#195cb9", .color(.hex(0x195cb9))),
        ThemeDeclaration(.heat6, "#0a3f86", .color(.hex(0x0a3f86))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-contrast", "high"), .attribute("data-theme", "dark")]]), ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark")], [.attribute("data-accent", "blue")]])],
      declarations: [
        ThemeDeclaration(.accent, "#81b3fd", .color(.hex(0x81b3fd))),
        ThemeDeclaration(.accentHover, "#a4c8fd", .color(.hex(0xa4c8fd))),
        ThemeDeclaration(.accentInk, "#a1c7fe", .color(.hex(0xa1c7fe))),
        ThemeDeclaration(.accentWash, "#152741", .color(.hex(0x152741))),
        ThemeDeclaration(.accentLine, "#81b3fd", .color(.hex(0x81b3fd))),
        ThemeDeclaration(.onAccent, "#0b0d11", .color(.hex(0x0b0d11))),
        ThemeDeclaration(.second, "#ff8a5c", .color(.hex(0xff8a5c))),
        ThemeDeclaration(.secondInk, "#ffb499", .color(.hex(0xffb499))),
        ThemeDeclaration(.secondWash, "#2e1a14", .color(.hex(0x2e1a14))),
        ThemeDeclaration(.secondTip, "#8f2a12", .color(.hex(0x8f2a12))),
        ThemeDeclaration(.chart1, "#7fb3fe", .color(.hex(0x7fb3fe))),
        ThemeDeclaration(.chart2, "#ff8a5c", .color(.hex(0xff8a5c))),
        ThemeDeclaration(.chart3, "#3ecf9a", .color(.hex(0x3ecf9a))),
        ThemeDeclaration(.chart4, "#f0b429", .color(.hex(0xf0b429))),
        ThemeDeclaration(.chartArea, "rgb(127 179 254 / 0.2)", .color(.rgb(127, 179, 254, 0.2))),
        ThemeDeclaration(.heat0, "#191e26", .color(.hex(0x191e26))),
        ThemeDeclaration(.heat1, "#253d61", .color(.hex(0x253d61))),
        ThemeDeclaration(.heat2, "#315a97", .color(.hex(0x315a97))),
        ThemeDeclaration(.heat3, "#3f76c8", .color(.hex(0x3f76c8))),
        ThemeDeclaration(.heat4, "#5795f0", .color(.hex(0x5795f0))),
        ThemeDeclaration(.heat5, "#86b6fd", .color(.hex(0x86b6fd))),
        ThemeDeclaration(.heat6, "#c1d9fe", .color(.hex(0xc1d9fe))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-accent", "violet")]]), ThemeSelector([[.attribute("data-contrast", "high")], [.attribute("data-accent", "violet")]])],
      declarations: [
        ThemeDeclaration(.accent, "#6632ba", .color(.hex(0x6632ba))),
        ThemeDeclaration(.accentHover, "#501f97", .color(.hex(0x501f97))),
        ThemeDeclaration(.accentInk, "#5729a0", .color(.hex(0x5729a0))),
        ThemeDeclaration(.accentWash, "#f1edff", .color(.hex(0xf1edff))),
        ThemeDeclaration(.accentLine, "#6632ba", .color(.hex(0x6632ba))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#c83406", .color(.hex(0xc83406))),
        ThemeDeclaration(.secondInk, "#8f2a12", .color(.hex(0x8f2a12))),
        ThemeDeclaration(.secondWash, "#fdeeea", .color(.hex(0xfdeeea))),
        ThemeDeclaration(.secondTip, "#ffc4b5", .color(.hex(0xffc4b5))),
        ThemeDeclaration(.chart1, "#753fd0", .color(.hex(0x753fd0))),
        ThemeDeclaration(.chart2, "#c83406", .color(.hex(0xc83406))),
        ThemeDeclaration(.chart3, "#0b7a53", .color(.hex(0x0b7a53))),
        ThemeDeclaration(.chart4, "#8a5f00", .color(.hex(0x8a5f00))),
        ThemeDeclaration(.chartArea, "rgb(117 63 208 / 0.16)", .color(.rgb(117, 63, 208, 0.16))),
        ThemeDeclaration(.heat0, "#f0eff8", .color(.hex(0xf0eff8))),
        ThemeDeclaration(.heat1, "#d9d1f7", .color(.hex(0xd9d1f7))),
        ThemeDeclaration(.heat2, "#beaff1", .color(.hex(0xbeaff1))),
        ThemeDeclaration(.heat3, "#a289e6", .color(.hex(0xa289e6))),
        ThemeDeclaration(.heat4, "#8663d5", .color(.hex(0x8663d5))),
        ThemeDeclaration(.heat5, "#6a45b3", .color(.hex(0x6a45b3))),
        ThemeDeclaration(.heat6, "#4a2c82", .color(.hex(0x4a2c82))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark"), .attribute("data-accent", "violet")]]), ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark")], [.attribute("data-accent", "violet")]])],
      declarations: [
        ThemeDeclaration(.accent, "#baa3ff", .color(.hex(0xbaa3ff))),
        ThemeDeclaration(.accentHover, "#cbbcfe", .color(.hex(0xcbbcfe))),
        ThemeDeclaration(.accentInk, "#c9b9fd", .color(.hex(0xc9b9fd))),
        ThemeDeclaration(.accentWash, "#29203f", .color(.hex(0x29203f))),
        ThemeDeclaration(.accentLine, "#baa3ff", .color(.hex(0xbaa3ff))),
        ThemeDeclaration(.onAccent, "#0b0d11", .color(.hex(0x0b0d11))),
        ThemeDeclaration(.second, "#ff8a5c", .color(.hex(0xff8a5c))),
        ThemeDeclaration(.secondInk, "#ffb499", .color(.hex(0xffb499))),
        ThemeDeclaration(.secondWash, "#2e1a14", .color(.hex(0x2e1a14))),
        ThemeDeclaration(.secondTip, "#8f2a12", .color(.hex(0x8f2a12))),
        ThemeDeclaration(.chart1, "#b79ffd", .color(.hex(0xb79ffd))),
        ThemeDeclaration(.chart2, "#ff8a5c", .color(.hex(0xff8a5c))),
        ThemeDeclaration(.chart3, "#3ecf9a", .color(.hex(0x3ecf9a))),
        ThemeDeclaration(.chart4, "#f0b429", .color(.hex(0xf0b429))),
        ThemeDeclaration(.chartArea, "rgb(183 159 253 / 0.2)", .color(.rgb(183, 159, 253, 0.2))),
        ThemeDeclaration(.heat0, "#1e1c26", .color(.hex(0x1e1c26))),
        ThemeDeclaration(.heat1, "#40345f", .color(.hex(0x40345f))),
        ThemeDeclaration(.heat2, "#604b94", .color(.hex(0x604b94))),
        ThemeDeclaration(.heat3, "#7f62c4", .color(.hex(0x7f62c4))),
        ThemeDeclaration(.heat4, "#9d7eeb", .color(.hex(0x9d7eeb))),
        ThemeDeclaration(.heat5, "#baa3fe", .color(.hex(0xbaa3fe))),
        ThemeDeclaration(.heat6, "#dad0ff", .color(.hex(0xdad0ff))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-accent", "teal")]]), ThemeSelector([[.attribute("data-contrast", "high")], [.attribute("data-accent", "teal")]])],
      declarations: [
        ThemeDeclaration(.accent, "#075c6a", .color(.hex(0x075c6a))),
        ThemeDeclaration(.accentHover, "#044650", .color(.hex(0x044650))),
        ThemeDeclaration(.accentInk, "#044e5a", .color(.hex(0x044e5a))),
        ThemeDeclaration(.accentWash, "#e0f4f9", .color(.hex(0xe0f4f9))),
        ThemeDeclaration(.accentLine, "#075c6a", .color(.hex(0x075c6a))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#c83406", .color(.hex(0xc83406))),
        ThemeDeclaration(.secondInk, "#8f2a12", .color(.hex(0x8f2a12))),
        ThemeDeclaration(.secondWash, "#fdeeea", .color(.hex(0xfdeeea))),
        ThemeDeclaration(.secondTip, "#ffc4b5", .color(.hex(0xffc4b5))),
        ThemeDeclaration(.chart1, "#0e7c8d", .color(.hex(0x0e7c8d))),
        ThemeDeclaration(.chart2, "#c83406", .color(.hex(0xc83406))),
        ThemeDeclaration(.chart3, "#4a3aa7", .color(.hex(0x4a3aa7))),
        ThemeDeclaration(.chart4, "#8a5f00", .color(.hex(0x8a5f00))),
        ThemeDeclaration(.chartArea, "rgb(14 124 141 / 0.16)", .color(.rgb(14, 124, 141, 0.16))),
        ThemeDeclaration(.heat0, "#e8f2f5", .color(.hex(0xe8f2f5))),
        ThemeDeclaration(.heat1, "#b2e1eb", .color(.hex(0xb2e1eb))),
        ThemeDeclaration(.heat2, "#70cadc", .color(.hex(0x70cadc))),
        ThemeDeclaration(.heat3, "#03aec6", .color(.hex(0x03aec6))),
        ThemeDeclaration(.heat4, "#048da0", .color(.hex(0x048da0))),
        ThemeDeclaration(.heat5, "#096c7c", .color(.hex(0x096c7c))),
        ThemeDeclaration(.heat6, "#034b56", .color(.hex(0x034b56))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark"), .attribute("data-accent", "teal")]]), ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark")], [.attribute("data-accent", "teal")]])],
      declarations: [
        ThemeDeclaration(.accent, "#00c2dc", .color(.hex(0x00c2dc))),
        ThemeDeclaration(.accentHover, "#6cd4e8", .color(.hex(0x6cd4e8))),
        ThemeDeclaration(.accentInk, "#6cd4e8", .color(.hex(0x6cd4e8))),
        ThemeDeclaration(.accentWash, "#002c34", .color(.hex(0x002c34))),
        ThemeDeclaration(.accentLine, "#00c2dc", .color(.hex(0x00c2dc))),
        ThemeDeclaration(.onAccent, "#0b0d11", .color(.hex(0x0b0d11))),
        ThemeDeclaration(.second, "#ff8a5c", .color(.hex(0xff8a5c))),
        ThemeDeclaration(.secondInk, "#ffb499", .color(.hex(0xffb499))),
        ThemeDeclaration(.secondWash, "#2e1a14", .color(.hex(0x2e1a14))),
        ThemeDeclaration(.secondTip, "#8f2a12", .color(.hex(0x8f2a12))),
        ThemeDeclaration(.chart1, "#0dd4f1", .color(.hex(0x0dd4f1))),
        ThemeDeclaration(.chart2, "#ff8a5c", .color(.hex(0xff8a5c))),
        ThemeDeclaration(.chart3, "#b3aaf5", .color(.hex(0xb3aaf5))),
        ThemeDeclaration(.chart4, "#f0b429", .color(.hex(0xf0b429))),
        ThemeDeclaration(.chartArea, "rgb(13 212 241 / 0.2)", .color(.rgb(13, 212, 241, 0.2))),
        ThemeDeclaration(.heat0, "#132022", .color(.hex(0x132022))),
        ThemeDeclaration(.heat1, "#024550", .color(.hex(0x024550))),
        ThemeDeclaration(.heat2, "#0a6675", .color(.hex(0x0a6675))),
        ThemeDeclaration(.heat3, "#0d8698", .color(.hex(0x0d8698))),
        ThemeDeclaration(.heat4, "#19a7bd", .color(.hex(0x19a7bd))),
        ThemeDeclaration(.heat5, "#22c9e4", .color(.hex(0x22c9e4))),
        ThemeDeclaration(.heat6, "#8de8fa", .color(.hex(0x8de8fa))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-accent", "amber")]]), ThemeSelector([[.attribute("data-contrast", "high")], [.attribute("data-accent", "amber")]])],
      declarations: [
        ThemeDeclaration(.accent, "#784900", .color(.hex(0x784900))),
        ThemeDeclaration(.accentHover, "#5d3603", .color(.hex(0x5d3603))),
        ThemeDeclaration(.accentInk, "#673c01", .color(.hex(0x673c01))),
        ThemeDeclaration(.accentWash, "#f6f0e0", .color(.hex(0xf6f0e0))),
        ThemeDeclaration(.accentLine, "#784900", .color(.hex(0x784900))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#1c5cab", .color(.hex(0x1c5cab))),
        ThemeDeclaration(.secondInk, "#0d366b", .color(.hex(0x0d366b))),
        ThemeDeclaration(.secondWash, "#eef3fd", .color(.hex(0xeef3fd))),
        ThemeDeclaration(.secondTip, "#b7d3f6", .color(.hex(0xb7d3f6))),
        ThemeDeclaration(.chart1, "#895603", .color(.hex(0x895603))),
        ThemeDeclaration(.chart2, "#1c5cab", .color(.hex(0x1c5cab))),
        ThemeDeclaration(.chart3, "#0b7a53", .color(.hex(0x0b7a53))),
        ThemeDeclaration(.chart4, "#4a3aa7", .color(.hex(0x4a3aa7))),
        ThemeDeclaration(.chartArea, "rgb(137 86 3 / 0.16)", .color(.rgb(137, 86, 3, 0.16))),
        ThemeDeclaration(.heat0, "#f3f0e7", .color(.hex(0xf3f0e7))),
        ThemeDeclaration(.heat1, "#e7d6b3", .color(.hex(0xe7d6b3))),
        ThemeDeclaration(.heat2, "#d8b577", .color(.hex(0xd8b577))),
        ThemeDeclaration(.heat3, "#c8902a", .color(.hex(0xc8902a))),
        ThemeDeclaration(.heat4, "#a97000", .color(.hex(0xa97000))),
        ThemeDeclaration(.heat5, "#865400", .color(.hex(0x865400))),
        ThemeDeclaration(.heat6, "#603803", .color(.hex(0x603803))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark"), .attribute("data-accent", "amber")]]), ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark")], [.attribute("data-accent", "amber")]])],
      declarations: [
        ThemeDeclaration(.accent, "#dda844", .color(.hex(0xdda844))),
        ThemeDeclaration(.accentHover, "#e6c078", .color(.hex(0xe6c078))),
        ThemeDeclaration(.accentInk, "#e4be76", .color(.hex(0xe4be76))),
        ThemeDeclaration(.accentWash, "#391f06", .color(.hex(0x391f06))),
        ThemeDeclaration(.accentLine, "#dda844", .color(.hex(0xdda844))),
        ThemeDeclaration(.onAccent, "#0b0d11", .color(.hex(0x0b0d11))),
        ThemeDeclaration(.second, "#96d3fe", .color(.hex(0x96d3fe))),
        ThemeDeclaration(.secondInk, "#b7d3f6", .color(.hex(0xb7d3f6))),
        ThemeDeclaration(.secondWash, "#16233a", .color(.hex(0x16233a))),
        ThemeDeclaration(.secondTip, "#0d366b", .color(.hex(0x0d366b))),
        ThemeDeclaration(.chart1, "#fac044", .color(.hex(0xfac044))),
        ThemeDeclaration(.chart2, "#96d3fe", .color(.hex(0x96d3fe))),
        ThemeDeclaration(.chart3, "#3ecf9a", .color(.hex(0x3ecf9a))),
        ThemeDeclaration(.chart4, "#b3aaf5", .color(.hex(0xb3aaf5))),
        ThemeDeclaration(.chartArea, "rgb(250 192 68 / 0.2)", .color(.rgb(250, 192, 68, 0.2))),
        ThemeDeclaration(.heat0, "#241b15", .color(.hex(0x241b15))),
        ThemeDeclaration(.heat1, "#56340f", .color(.hex(0x56340f))),
        ThemeDeclaration(.heat2, "#7f4e03", .color(.hex(0x7f4e03))),
        ThemeDeclaration(.heat3, "#a16a09", .color(.hex(0xa16a09))),
        ThemeDeclaration(.heat4, "#c5880b", .color(.hex(0xc5880b))),
        ThemeDeclaration(.heat5, "#e2a939", .color(.hex(0xe2a939))),
        ThemeDeclaration(.heat6, "#f3d392", .color(.hex(0xf3d392))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-accent", "rose")]]), ThemeSelector([[.attribute("data-contrast", "high")], [.attribute("data-accent", "rose")]])],
      declarations: [
        ThemeDeclaration(.accent, "#a40e4d", .color(.hex(0xa40e4d))),
        ThemeDeclaration(.accentHover, "#810139", .color(.hex(0x810139))),
        ThemeDeclaration(.accentInk, "#8c0940", .color(.hex(0x8c0940))),
        ThemeDeclaration(.accentWash, "#fdebee", .color(.hex(0xfdebee))),
        ThemeDeclaration(.accentLine, "#a40e4d", .color(.hex(0xa40e4d))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#1c5cab", .color(.hex(0x1c5cab))),
        ThemeDeclaration(.secondInk, "#0d366b", .color(.hex(0x0d366b))),
        ThemeDeclaration(.secondWash, "#eef3fd", .color(.hex(0xeef3fd))),
        ThemeDeclaration(.secondTip, "#b7d3f6", .color(.hex(0xb7d3f6))),
        ThemeDeclaration(.chart1, "#a5104d", .color(.hex(0xa5104d))),
        ThemeDeclaration(.chart2, "#1c5cab", .color(.hex(0x1c5cab))),
        ThemeDeclaration(.chart3, "#0b7a53", .color(.hex(0x0b7a53))),
        ThemeDeclaration(.chart4, "#8a5f00", .color(.hex(0x8a5f00))),
        ThemeDeclaration(.chartArea, "rgb(165 16 77 / 0.16)", .color(.rgb(165, 16, 77, 0.16))),
        ThemeDeclaration(.heat0, "#f7edef", .color(.hex(0xf7edef))),
        ThemeDeclaration(.heat1, "#f4cbd3", .color(.hex(0xf4cbd3))),
        ThemeDeclaration(.heat2, "#eaa4b3", .color(.hex(0xeaa4b3))),
        ThemeDeclaration(.heat3, "#da7991", .color(.hex(0xda7991))),
        ThemeDeclaration(.heat4, "#c44f71", .color(.hex(0xc44f71))),
        ThemeDeclaration(.heat5, "#a23055", .color(.hex(0xa23055))),
        ThemeDeclaration(.heat6, "#741c39", .color(.hex(0x741c39))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark"), .attribute("data-accent", "rose")]]), ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark")], [.attribute("data-accent", "rose")]])],
      declarations: [
        ThemeDeclaration(.accent, "#f893ab", .color(.hex(0xf893ab))),
        ThemeDeclaration(.accentHover, "#ffafc1", .color(.hex(0xffafc1))),
        ThemeDeclaration(.accentInk, "#fcadbe", .color(.hex(0xfcadbe))),
        ThemeDeclaration(.accentWash, "#3b1b23", .color(.hex(0x3b1b23))),
        ThemeDeclaration(.accentLine, "#f893ab", .color(.hex(0xf893ab))),
        ThemeDeclaration(.onAccent, "#0b0d11", .color(.hex(0x0b0d11))),
        ThemeDeclaration(.second, "#96d3fe", .color(.hex(0x96d3fe))),
        ThemeDeclaration(.secondInk, "#b7d3f6", .color(.hex(0xb7d3f6))),
        ThemeDeclaration(.secondWash, "#16233a", .color(.hex(0x16233a))),
        ThemeDeclaration(.secondTip, "#0d366b", .color(.hex(0x0d366b))),
        ThemeDeclaration(.chart1, "#f35a88", .color(.hex(0xf35a88))),
        ThemeDeclaration(.chart2, "#96d3fe", .color(.hex(0x96d3fe))),
        ThemeDeclaration(.chart3, "#3ecf9a", .color(.hex(0x3ecf9a))),
        ThemeDeclaration(.chart4, "#f0b429", .color(.hex(0xf0b429))),
        ThemeDeclaration(.chartArea, "rgb(243 90 136 / 0.2)", .color(.rgb(243, 90, 136, 0.2))),
        ThemeDeclaration(.heat0, "#251a1c", .color(.hex(0x251a1c))),
        ThemeDeclaration(.heat1, "#5a2d38", .color(.hex(0x5a2d38))),
        ThemeDeclaration(.heat2, "#8a3f53", .color(.hex(0x8a3f53))),
        ThemeDeclaration(.heat3, "#b6516d", .color(.hex(0xb6516d))),
        ThemeDeclaration(.heat4, "#dc6c89", .color(.hex(0xdc6c89))),
        ThemeDeclaration(.heat5, "#fa8ea9", .color(.hex(0xfa8ea9))),
        ThemeDeclaration(.heat6, "#fec7d2", .color(.hex(0xfec7d2))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-accent", "graphite")]]), ThemeSelector([[.attribute("data-contrast", "high")], [.attribute("data-accent", "graphite")]])],
      declarations: [
        ThemeDeclaration(.accent, "#19222e", .color(.hex(0x19222e))),
        ThemeDeclaration(.accentHover, "#060e18", .color(.hex(0x060e18))),
        ThemeDeclaration(.accentInk, "#0e1721", .color(.hex(0x0e1721))),
        ThemeDeclaration(.accentWash, "#e5e8ec", .color(.hex(0xe5e8ec))),
        ThemeDeclaration(.accentLine, "#19222e", .color(.hex(0x19222e))),
        ThemeDeclaration(.onAccent, "#ffffff", .color(.hex(0xffffff))),
        ThemeDeclaration(.second, "#c83406", .color(.hex(0xc83406))),
        ThemeDeclaration(.secondInk, "#8f2a12", .color(.hex(0x8f2a12))),
        ThemeDeclaration(.secondWash, "#fdeeea", .color(.hex(0xfdeeea))),
        ThemeDeclaration(.secondTip, "#ffc4b5", .color(.hex(0xffc4b5))),
        ThemeDeclaration(.chart1, "#1f2732", .color(.hex(0x1f2732))),
        ThemeDeclaration(.chart2, "#c83406", .color(.hex(0xc83406))),
        ThemeDeclaration(.chart3, "#0b7a53", .color(.hex(0x0b7a53))),
        ThemeDeclaration(.chart4, "#8a5f00", .color(.hex(0x8a5f00))),
        ThemeDeclaration(.chartArea, "rgb(31 39 50 / 0.16)", .color(.rgb(31, 39, 50, 0.16))),
        ThemeDeclaration(.heat0, "#eff0f1", .color(.hex(0xeff0f1))),
        ThemeDeclaration(.heat1, "#d5d8db", .color(.hex(0xd5d8db))),
        ThemeDeclaration(.heat2, "#b6bbc2", .color(.hex(0xb6bbc2))),
        ThemeDeclaration(.heat3, "#959ca5", .color(.hex(0x959ca5))),
        ThemeDeclaration(.heat4, "#767e89", .color(.hex(0x767e89))),
        ThemeDeclaration(.heat5, "#59616b", .color(.hex(0x59616b))),
        ThemeDeclaration(.heat6, "#3d434b", .color(.hex(0x3d434b))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark"), .attribute("data-accent", "graphite")]]), ThemeSelector([[.attribute("data-contrast", "high"), .attribute("data-theme", "dark")], [.attribute("data-accent", "graphite")]])],
      declarations: [
        ThemeDeclaration(.accent, "#d6dfea", .color(.hex(0xd6dfea))),
        ThemeDeclaration(.accentHover, "#eff6ff", .color(.hex(0xeff6ff))),
        ThemeDeclaration(.accentInk, "#e7effb", .color(.hex(0xe7effb))),
        ThemeDeclaration(.accentWash, "#2e3033", .color(.hex(0x2e3033))),
        ThemeDeclaration(.accentLine, "#d6dfea", .color(.hex(0xd6dfea))),
        ThemeDeclaration(.onAccent, "#0b0d11", .color(.hex(0x0b0d11))),
        ThemeDeclaration(.second, "#ff8a5c", .color(.hex(0xff8a5c))),
        ThemeDeclaration(.secondInk, "#ffb499", .color(.hex(0xffb499))),
        ThemeDeclaration(.secondWash, "#2e1a14", .color(.hex(0x2e1a14))),
        ThemeDeclaration(.secondTip, "#8f2a12", .color(.hex(0x8f2a12))),
        ThemeDeclaration(.chart1, "#e0e9f4", .color(.hex(0xe0e9f4))),
        ThemeDeclaration(.chart2, "#ff8a5c", .color(.hex(0xff8a5c))),
        ThemeDeclaration(.chart3, "#3ecf9a", .color(.hex(0x3ecf9a))),
        ThemeDeclaration(.chart4, "#f0b429", .color(.hex(0xf0b429))),
        ThemeDeclaration(.chartArea, "rgb(224 233 244 / 0.2)", .color(.rgb(224, 233, 244, 0.2))),
        ThemeDeclaration(.heat0, "#1d1e1f", .color(.hex(0x1d1e1f))),
        ThemeDeclaration(.heat1, "#3a3d42", .color(.hex(0x3a3d42))),
        ThemeDeclaration(.heat2, "#565b62", .color(.hex(0x565b62))),
        ThemeDeclaration(.heat3, "#717881", .color(.hex(0x717881))),
        ThemeDeclaration(.heat4, "#8e96a0", .color(.hex(0x8e96a0))),
        ThemeDeclaration(.heat5, "#adb5bf", .color(.hex(0xadb5bf))),
        ThemeDeclaration(.heat6, "#d3d8df", .color(.hex(0xd3d8df))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root]])],
      media: ThemeMedia("(max-width: 899px)"),
      declarations: [
        ThemeDeclaration(.pagePad, "20px", .length(.px(20))),
        ThemeDeclaration(.pageTop, "8px", .length(.px(8))),
        ThemeDeclaration(.gridGap, "28px", .length(.px(28))),
        ThemeDeclaration(.sectionGap, "28px", .length(.px(28))),
        ThemeDeclaration(.textTitle, "1.75rem", .length(.rem(1.75))),
        ThemeDeclaration(.skyMidAt, "170px", .length(.px(170))),
        ThemeDeclaration(.skyEnd, "420px", .length(.px(420))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-density", "compact")]])],
      media: ThemeMedia("(max-width: 899px)"),
      declarations: [
        ThemeDeclaration(.pagePad, "16px", .length(.px(16))),
        ThemeDeclaration(.pageTop, "8px", .length(.px(8))),
        ThemeDeclaration(.gridGap, "22px", .length(.px(22))),
        ThemeDeclaration(.sectionGap, "22px", .length(.px(22))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root, .attribute("data-sky", "night")]])],
      media: ThemeMedia("(max-width: 899px)"),
      declarations: [
        ThemeDeclaration(.skyEnd, "460px", .length(.px(460))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root]])],
      media: ThemeMedia("(max-width: 760px)"),
      declarations: [
        ThemeDeclaration(.textBase, "0.9375rem", .length(.rem(0.9375))),
      ]
    ),
    ThemeBlock(
      file: "src/styles/theme.css",
      selectors: [ThemeSelector([[.root]])],
      media: ThemeMedia("(forced-colors: active)"),
      declarations: [
        ThemeDeclaration(.chart1, "CanvasText", .system("CanvasText"), important: true),
        ThemeDeclaration(.chart2, "LinkText", .system("LinkText"), important: true),
        ThemeDeclaration(.chartArea, "transparent", .color(.rgb(0, 0, 0, 0)), important: true),
        ThemeDeclaration(.chartGrid, "GrayText", .system("GrayText"), important: true),
        ThemeDeclaration(.chartAxis, "CanvasText", .system("CanvasText"), important: true),
        ThemeDeclaration(.chartGhost, "GrayText", .system("GrayText"), important: true),
        ThemeDeclaration(.heat0, "Canvas", .system("Canvas"), important: true),
        ThemeDeclaration(.heat1, "color-mix(in srgb, CanvasText 15%, Canvas)", .colorMix(ThemeColorMix(first: .system("CanvasText"), firstPercent: 15, second: .system("Canvas"), secondPercent: nil)), important: true),
        ThemeDeclaration(.heat2, "color-mix(in srgb, CanvasText 30%, Canvas)", .colorMix(ThemeColorMix(first: .system("CanvasText"), firstPercent: 30, second: .system("Canvas"), secondPercent: nil)), important: true),
        ThemeDeclaration(.heat3, "color-mix(in srgb, CanvasText 45%, Canvas)", .colorMix(ThemeColorMix(first: .system("CanvasText"), firstPercent: 45, second: .system("Canvas"), secondPercent: nil)), important: true),
        ThemeDeclaration(.heat4, "color-mix(in srgb, CanvasText 60%, Canvas)", .colorMix(ThemeColorMix(first: .system("CanvasText"), firstPercent: 60, second: .system("Canvas"), secondPercent: nil)), important: true),
        ThemeDeclaration(.heat5, "color-mix(in srgb, CanvasText 80%, Canvas)", .colorMix(ThemeColorMix(first: .system("CanvasText"), firstPercent: 80, second: .system("Canvas"), secondPercent: nil)), important: true),
        ThemeDeclaration(.heat6, "CanvasText", .system("CanvasText"), important: true),
      ]
    ),
  ]
}

// Each token by name. A colour, a shadow or a font stack that has no value
// (which no stylesheet allows: ThemeTokensBehaviour checks every state) is
// transparent or empty; a length is in points at this viewport, except one
// measured in the font's own units, which is left as its expression.
extension ResolvedTheme {
  /// `--bg`
  public var bg: ThemeColor { color(.bg) ?? .transparent }
  /// `--surface`
  public var surface: ThemeColor { color(.surface) ?? .transparent }
  /// `--surface-2`
  public var surface2: ThemeColor { color(.surface2) ?? .transparent }
  /// `--surface-3`
  public var surface3: ThemeColor { color(.surface3) ?? .transparent }
  /// `--hover`
  public var hover: ThemeColor { color(.hover) ?? .transparent }
  /// `--scrim`
  public var scrim: ThemeColor { color(.scrim) ?? .transparent }
  /// `--tint`
  public var tint: ThemeColor { color(.tint) ?? .transparent }
  /// `--accent-tint`
  public var accentTint: ThemeColor { color(.accentTint) ?? .transparent }
  /// `--ink`
  public var ink: ThemeColor { color(.ink) ?? .transparent }
  /// `--ink-2`
  public var ink2: ThemeColor { color(.ink2) ?? .transparent }
  /// `--muted`
  public var muted: ThemeColor { color(.muted) ?? .transparent }
  /// `--faint`
  public var faint: ThemeColor { color(.faint) ?? .transparent }
  /// `--line`
  public var line: ThemeColor { color(.line) ?? .transparent }
  /// `--line-2`
  public var line2: ThemeColor { color(.line2) ?? .transparent }
  /// `--line-soft`
  public var lineSoft: ThemeColor { color(.lineSoft) ?? .transparent }
  /// `--rule`
  public var rule: ThemeColor { color(.rule) ?? .transparent }
  /// `--sky-top`
  public var skyTop: ThemeColor { color(.skyTop) ?? .transparent }
  /// `--sky-mid`
  public var skyMid: ThemeColor { color(.skyMid) ?? .transparent }
  /// `--sky-mid-at`, in points.
  public var skyMidAt: Double { points(.skyMidAt) ?? 0 }
  /// `--sky-end`, in points.
  public var skyEnd: Double { points(.skyEnd) ?? 0 }
  /// `--btn`
  public var btn: ThemeColor { color(.btn) ?? .transparent }
  /// `--btn-hover`
  public var btnHover: ThemeColor { color(.btnHover) ?? .transparent }
  /// `--on-btn`
  public var onBtn: ThemeColor { color(.onBtn) ?? .transparent }
  /// `--up`
  public var up: ThemeColor { color(.up) ?? .transparent }
  /// `--up-wash`
  public var upWash: ThemeColor { color(.upWash) ?? .transparent }
  /// `--down`
  public var down: ThemeColor { color(.down) ?? .transparent }
  /// `--down-wash`
  public var downWash: ThemeColor { color(.downWash) ?? .transparent }
  /// `--ok`
  public var ok: ThemeColor { color(.ok) ?? .transparent }
  /// `--warn`
  public var warn: ThemeColor { color(.warn) ?? .transparent }
  /// `--warn-wash`
  public var warnWash: ThemeColor { color(.warnWash) ?? .transparent }
  /// `--danger`
  public var danger: ThemeColor { color(.danger) ?? .transparent }
  /// `--danger-hover`
  public var dangerHover: ThemeColor { color(.dangerHover) ?? .transparent }
  /// `--danger-wash`
  public var dangerWash: ThemeColor { color(.dangerWash) ?? .transparent }
  /// `--chart-grid`
  public var chartGrid: ThemeColor { color(.chartGrid) ?? .transparent }
  /// `--chart-axis`
  public var chartAxis: ThemeColor { color(.chartAxis) ?? .transparent }
  /// `--chart-ghost`
  public var chartGhost: ThemeColor { color(.chartGhost) ?? .transparent }
  /// `--avatar-bg`
  public var avatarBg: ThemeColor { color(.avatarBg) ?? .transparent }
  /// `--avatar-ink`
  public var avatarInk: ThemeColor { color(.avatarInk) ?? .transparent }
  /// `--sans`
  public var sans: [String] { fonts(.sans) ?? [] }
  /// `--code`
  public var code: [String] { fonts(.code) ?? [] }
  /// `--text-xs`, in points.
  public var textXs: Double { points(.textXs) ?? 0 }
  /// `--text-sm`, in points.
  public var textSm: Double { points(.textSm) ?? 0 }
  /// `--text-base`, in points.
  public var textBase: Double { points(.textBase) ?? 0 }
  /// `--text-md`, in points.
  public var textMd: Double { points(.textMd) ?? 0 }
  /// `--text-lg`, in points.
  public var textLg: Double { points(.textLg) ?? 0 }
  /// `--text-xl`, in points.
  public var textXl: Double { points(.textXl) ?? 0 }
  /// `--text-2xl`, in points.
  public var text2xl: Double { points(.text2xl) ?? 0 }
  /// `--text-3xl`, in points.
  public var text3xl: Double { points(.text3xl) ?? 0 }
  /// `--text-title`, in points.
  public var textTitle: Double { points(.textTitle) ?? 0 }
  /// `--text-figure`, in points.
  public var textFigure: Double { points(.textFigure) ?? 0 }
  /// `--figure-size`, in points.
  public var figureSize: Double { points(.figureSize) ?? 0 }
  /// `--text-lead`, in points.
  public var textLead: Double { points(.textLead) ?? 0 }
  /// `--measure`: measure it with `points(.measure, in:)`.
  public var measure: ThemeLength { length(.measure) ?? .px(0) }
  /// `--space-1`, in points.
  public var space1: Double { points(.space1) ?? 0 }
  /// `--space-2`, in points.
  public var space2: Double { points(.space2) ?? 0 }
  /// `--space-3`, in points.
  public var space3: Double { points(.space3) ?? 0 }
  /// `--space-4`, in points.
  public var space4: Double { points(.space4) ?? 0 }
  /// `--space-5`, in points.
  public var space5: Double { points(.space5) ?? 0 }
  /// `--space-6`, in points.
  public var space6: Double { points(.space6) ?? 0 }
  /// `--space-7`, in points.
  public var space7: Double { points(.space7) ?? 0 }
  /// `--card-pad`, in points.
  public var cardPad: Double { points(.cardPad) ?? 0 }
  /// `--grid-gap`, in points.
  public var gridGap: Double { points(.gridGap) ?? 0 }
  /// `--grid-gap-x`, in points.
  public var gridGapX: Double { points(.gridGapX) ?? 0 }
  /// `--section-gap`, in points.
  public var sectionGap: Double { points(.sectionGap) ?? 0 }
  /// `--page-pad`, in points.
  public var pagePad: Double { points(.pagePad) ?? 0 }
  /// `--page-top`, in points.
  public var pageTop: Double { points(.pageTop) ?? 0 }
  /// `--row-pad`, in points.
  public var rowPad: Double { points(.rowPad) ?? 0 }
  /// `--row-pad-lg`, in points.
  public var rowPadLg: Double { points(.rowPadLg) ?? 0 }
  /// `--control-h`, in points.
  public var controlH: Double { points(.controlH) ?? 0 }
  /// `--time-col`, in points.
  public var timeCol: Double { points(.timeCol) ?? 0 }
  /// `--radius-sm`, in points.
  public var radiusSm: Double { points(.radiusSm) ?? 0 }
  /// `--radius`, in points.
  public var radius: Double { points(.radius) ?? 0 }
  /// `--radius-lg`, in points.
  public var radiusLg: Double { points(.radiusLg) ?? 0 }
  /// `--pill`, in points.
  public var pill: Double { points(.pill) ?? 0 }
  /// `--shadow-sm`
  public var shadowSm: [ThemeShadowLayer] { shadow(.shadowSm) ?? [] }
  /// `--shadow-md`
  public var shadowMd: [ThemeShadowLayer] { shadow(.shadowMd) ?? [] }
  /// `--shadow-lg`
  public var shadowLg: [ThemeShadowLayer] { shadow(.shadowLg) ?? [] }
  /// `--focus-ring`
  public var focusRing: ThemeColor { color(.focusRing) ?? .transparent }
  /// `--focus`
  public var focus: [ThemeShadowLayer] { shadow(.focus) ?? [] }
  /// `--sidebar-w`, in points.
  public var sidebarW: Double { points(.sidebarW) ?? 0 }
  /// `--rail-w`, in points.
  public var railW: Double { points(.railW) ?? 0 }
  /// `--appbar-h`, in points.
  public var appbarH: Double { points(.appbarH) ?? 0 }
  /// `--tabbar-h`, in points.
  public var tabbarH: Double { points(.tabbarH) ?? 0 }
  /// `--content-max`, in points.
  public var contentMax: Double { points(.contentMax) ?? 0 }
  /// `--shell-max`, in points.
  public var shellMax: Double { points(.shellMax) ?? 0 }
  /// `--ease`
  public var ease: ThemeCubicBezier { cubicBezier(.ease) ?? ThemeCubicBezier(0.25, 0.1, 0.25, 1) }
  /// `--accent`
  public var accent: ThemeColor { color(.accent) ?? .transparent }
  /// `--accent-hover`
  public var accentHover: ThemeColor { color(.accentHover) ?? .transparent }
  /// `--accent-ink`
  public var accentInk: ThemeColor { color(.accentInk) ?? .transparent }
  /// `--accent-wash`
  public var accentWash: ThemeColor { color(.accentWash) ?? .transparent }
  /// `--accent-line`
  public var accentLine: ThemeColor { color(.accentLine) ?? .transparent }
  /// `--on-accent`
  public var onAccent: ThemeColor { color(.onAccent) ?? .transparent }
  /// `--second`
  public var second: ThemeColor { color(.second) ?? .transparent }
  /// `--second-ink`
  public var secondInk: ThemeColor { color(.secondInk) ?? .transparent }
  /// `--second-wash`
  public var secondWash: ThemeColor { color(.secondWash) ?? .transparent }
  /// `--second-tip`
  public var secondTip: ThemeColor { color(.secondTip) ?? .transparent }
  /// `--chart-1`
  public var chart1: ThemeColor { color(.chart1) ?? .transparent }
  /// `--chart-2`
  public var chart2: ThemeColor { color(.chart2) ?? .transparent }
  /// `--chart-3`
  public var chart3: ThemeColor { color(.chart3) ?? .transparent }
  /// `--chart-4`
  public var chart4: ThemeColor { color(.chart4) ?? .transparent }
  /// `--chart-area`
  public var chartArea: ThemeColor { color(.chartArea) ?? .transparent }
  /// `--heat-0`
  public var heat0: ThemeColor { color(.heat0) ?? .transparent }
  /// `--heat-1`
  public var heat1: ThemeColor { color(.heat1) ?? .transparent }
  /// `--heat-2`
  public var heat2: ThemeColor { color(.heat2) ?? .transparent }
  /// `--heat-3`
  public var heat3: ThemeColor { color(.heat3) ?? .transparent }
  /// `--heat-4`
  public var heat4: ThemeColor { color(.heat4) ?? .transparent }
  /// `--heat-5`
  public var heat5: ThemeColor { color(.heat5) ?? .transparent }
  /// `--heat-6`
  public var heat6: ThemeColor { color(.heat6) ?? .transparent }
}
