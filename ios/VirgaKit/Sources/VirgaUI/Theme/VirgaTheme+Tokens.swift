// Ports src/styles/theme.css
//
// Every token by its name, as a view uses it: colours as Color, lengths as
// CGFloat (points). The same names as ResolvedTheme's (ThemeTokens+Blocks.swift),
// one line each, so `theme.ink` and `theme.space4` read like the CSS.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

extension VirgaTheme {
  public var bg: Color { tokens.bg.color }
  public var surface: Color { tokens.surface.color }
  public var surface2: Color { tokens.surface2.color }
  public var surface3: Color { tokens.surface3.color }
  public var hover: Color { tokens.hover.color }
  public var scrim: Color { tokens.scrim.color }
  public var tint: Color { tokens.tint.color }
  public var accentTint: Color { tokens.accentTint.color }
  public var ink: Color { tokens.ink.color }
  public var ink2: Color { tokens.ink2.color }
  public var muted: Color { tokens.muted.color }
  public var faint: Color { tokens.faint.color }
  public var line: Color { tokens.line.color }
  public var line2: Color { tokens.line2.color }
  public var lineSoft: Color { tokens.lineSoft.color }
  public var rule: Color { tokens.rule.color }
  public var skyTop: Color { tokens.skyTop.color }
  public var skyMid: Color { tokens.skyMid.color }
  public var btn: Color { tokens.btn.color }
  public var btnHover: Color { tokens.btnHover.color }
  public var onBtn: Color { tokens.onBtn.color }
  public var up: Color { tokens.up.color }
  public var upWash: Color { tokens.upWash.color }
  public var down: Color { tokens.down.color }
  public var downWash: Color { tokens.downWash.color }
  public var ok: Color { tokens.ok.color }
  public var warn: Color { tokens.warn.color }
  public var warnWash: Color { tokens.warnWash.color }
  public var danger: Color { tokens.danger.color }
  public var dangerHover: Color { tokens.dangerHover.color }
  public var dangerWash: Color { tokens.dangerWash.color }
  public var chartGrid: Color { tokens.chartGrid.color }
  public var chartAxis: Color { tokens.chartAxis.color }
  public var chartGhost: Color { tokens.chartGhost.color }
  public var avatarBg: Color { tokens.avatarBg.color }
  public var avatarInk: Color { tokens.avatarInk.color }
  public var focusRing: Color { tokens.focusRing.color }
  public var accent: Color { tokens.accent.color }
  public var accentHover: Color { tokens.accentHover.color }
  public var accentInk: Color { tokens.accentInk.color }
  public var accentWash: Color { tokens.accentWash.color }
  public var accentLine: Color { tokens.accentLine.color }
  public var onAccent: Color { tokens.onAccent.color }
  public var second: Color { tokens.second.color }
  public var secondInk: Color { tokens.secondInk.color }
  public var secondWash: Color { tokens.secondWash.color }
  public var secondTip: Color { tokens.secondTip.color }
  public var chart1: Color { tokens.chart1.color }
  public var chart2: Color { tokens.chart2.color }
  public var chart3: Color { tokens.chart3.color }
  public var chart4: Color { tokens.chart4.color }
  public var chartArea: Color { tokens.chartArea.color }
  public var heat0: Color { tokens.heat0.color }
  public var heat1: Color { tokens.heat1.color }
  public var heat2: Color { tokens.heat2.color }
  public var heat3: Color { tokens.heat3.color }
  public var heat4: Color { tokens.heat4.color }
  public var heat5: Color { tokens.heat5.color }
  public var heat6: Color { tokens.heat6.color }

  public var skyMidAt: CGFloat { CGFloat(tokens.skyMidAt) }
  public var skyEnd: CGFloat { CGFloat(tokens.skyEnd) }
  public var textXs: CGFloat { CGFloat(tokens.textXs) }
  public var textSm: CGFloat { CGFloat(tokens.textSm) }
  public var textBase: CGFloat { CGFloat(tokens.textBase) }
  public var textMd: CGFloat { CGFloat(tokens.textMd) }
  public var textLg: CGFloat { CGFloat(tokens.textLg) }
  public var textXl: CGFloat { CGFloat(tokens.textXl) }
  public var text2xl: CGFloat { CGFloat(tokens.text2xl) }
  public var text3xl: CGFloat { CGFloat(tokens.text3xl) }
  public var textTitle: CGFloat { CGFloat(tokens.textTitle) }
  public var textFigure: CGFloat { CGFloat(tokens.textFigure) }
  public var figureSize: CGFloat { CGFloat(tokens.figureSize) }
  public var textLead: CGFloat { CGFloat(tokens.textLead) }
  public var space1: CGFloat { CGFloat(tokens.space1) }
  public var space2: CGFloat { CGFloat(tokens.space2) }
  public var space3: CGFloat { CGFloat(tokens.space3) }
  public var space4: CGFloat { CGFloat(tokens.space4) }
  public var space5: CGFloat { CGFloat(tokens.space5) }
  public var space6: CGFloat { CGFloat(tokens.space6) }
  public var space7: CGFloat { CGFloat(tokens.space7) }
  public var cardPad: CGFloat { CGFloat(tokens.cardPad) }
  public var gridGap: CGFloat { CGFloat(tokens.gridGap) }
  public var gridGapX: CGFloat { CGFloat(tokens.gridGapX) }
  public var sectionGap: CGFloat { CGFloat(tokens.sectionGap) }
  public var pagePad: CGFloat { CGFloat(tokens.pagePad) }
  public var pageTop: CGFloat { CGFloat(tokens.pageTop) }
  public var rowPad: CGFloat { CGFloat(tokens.rowPad) }
  public var rowPadLg: CGFloat { CGFloat(tokens.rowPadLg) }
  public var controlH: CGFloat { CGFloat(tokens.controlH) }
  public var timeCol: CGFloat { CGFloat(tokens.timeCol) }
  public var radiusSm: CGFloat { CGFloat(tokens.radiusSm) }
  public var radius: CGFloat { CGFloat(tokens.radius) }
  public var radiusLg: CGFloat { CGFloat(tokens.radiusLg) }
  public var pill: CGFloat { CGFloat(tokens.pill) }
  public var sidebarW: CGFloat { CGFloat(tokens.sidebarW) }
  public var railW: CGFloat { CGFloat(tokens.railW) }
  public var appbarH: CGFloat { CGFloat(tokens.appbarH) }
  public var tabbarH: CGFloat { CGFloat(tokens.tabbarH) }
  public var contentMax: CGFloat { CGFloat(tokens.contentMax) }
  public var shellMax: CGFloat { CGFloat(tokens.shellMax) }
}
#endif
