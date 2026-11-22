// Ports src/reports/reports.css (its measures)
// Ports src/dashboards/dashboards.css (its measures)
// Ports src/charts/charts.css (its measures)
//
// More of the measures of the reports', the dashboards' and the charts'
// stylesheets, which ThemeKit doesn't read yet, each named once with the
// rule it comes from (Theme/Measures.swift says why). Lengths are points
// (CSS px).

#if canImport(UIKit)
import SwiftUI
import VirgaCore

extension Measure.Reports {
  /// `.report-filters-rule { height: 16px; margin: 0 16px }`
  static let filtersRuleHeight: CGFloat = 16
  static let filtersRuleMargin: CGFloat = 16
  /// `@media (max-width: 760px) { .kind-filter .segmented-key.has-icon {
  /// min-width: 32px } }`: a kind filter's keys that are their glyph alone
  /// (the engagement report's, the lookup's Kind).
  static let kindFilterIconKey: CGFloat = 32
  /// `.report-filter-bar { gap: 32px }`, 16 on a phone; its actions 24 apart.
  static let filterBarGap: CGFloat = 32
  static let phoneFilterBarGap: CGFloat = 16
  static let filterActionsGap: CGFloat = 24
  /// `.report-split { grid-template-columns: repeat(auto-fit, minmax(min(100%, 400px), 1fr)) }`
  static let splitMin: CGFloat = 400
  /// `.report-split--wide { grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr) }`, from 1100.
  static let wideSplitAt: CGFloat = 1100
  static let wideSplitSideMin: CGFloat = 260
  static let wideSplitShares: [CGFloat] = [2, 1]
  /// `.fig-unit { margin-left: 3px; font-size: 0.4em; font-weight: 500 }`
  static let figUnitGap: CGFloat = 3
  static let figUnitScale: CGFloat = 0.4
  static let figUnitWeight: Double = 500
  /// `.report-insight { margin: 0 0 16px }`
  static let insightSpaceBelow: CGFloat = 16
  /// `.day-row { grid-template-columns: 64px 52px minmax(0, 1fr); gap: 12px }`
  static let dayDate: CGFloat = 64
  static let dayCount: CGFloat = 52
  static let dayGap: CGFloat = 12
  /// `.report-index { grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)) }`:
  /// four to a row from 1000; on a phone two, 20 apart.
  static let tileMinWidth: CGFloat = 280
  static let indexWideAt: CGFloat = 1000
  static let indexWideColumns = 4
  static let phoneIndexColumnGap: CGFloat = 20
  /// `.report-tile { gap: 8px; padding-top: 16px }`, 12 on a phone;
  /// `.report-tile-desc { margin-top: 4px }`.
  static let tileGap: CGFloat = 8
  static let phoneTilePaddingTop: CGFloat = 12
  static let tileDescSpaceAbove: CGFloat = 4
  /// controls.css's touch `.info-tip-button { margin: -8px -6px }`: the (i)
  /// beside a note's words takes no more of the line than its 20 points.
  static let infoTipMarginV: CGFloat = 8
  static let infoTipMarginH: CGFloat = 6
  /// `.chart-notes-list { margin-top: 18px }`, its rows at least 46 tall in
  /// a 108 | 1fr | auto grid (84 at 760 and under), 12 apart.
  static let notesListSpaceAbove: CGFloat = 18
  static let notesRowMinHeight: CGFloat = 46
  static let notesDay: CGFloat = 108
  static let narrowNotesDay: CGFloat = 84
  static let notesGap: CGFloat = 12
}

extension Measure.Dashboard {
  /// `@media (max-width: 1179px) { .dash-grid { column-gap: clamp(24px, 4cqi,
  /// var(--grid-gap-x)) } }`: with less room the gutter narrows with the
  /// grid, 4% of the grid box's width and at least 24.
  static let narrowGapAt: CGFloat = 1179
  static let narrowGapMin: CGFloat = 24
  static let narrowGapShare: CGFloat = 0.04
  /// `.stat { padding-top: 16px }`, 12 at 560 and under.
  static let phoneStatPaddingTop: CGFloat = 12
  /// `@container widget (max-width: 250px) { .stat-window { display: none } }`
  static let statWindowHiddenAt: CGFloat = 250
  /// `.stat .sparkline { flex: 0 1 46%; height: 40px; margin-bottom: 4px }`,
  /// shown from a card 300 wide (`@container widget (min-width: 300px)`).
  static let statSparkAt: CGFloat = 300
  static let statSparkHeight: CGFloat = 40
  static let statSparkShare: CGFloat = 0.46
  static let statSparkSpaceBelow: CGFloat = 4
  /// `.stat-note { line-height: 1.35 }`
  static let noteLineHeight: Double = 1.35
  /// `@container widget (max-width: 440px)`: a chart's modes under the title, 8 down.
  static let headModesAt: CGFloat = 440
  static let headModesSpaceAbove: CGFloat = 8
  /// `.widget--list > .widget-head { padding-bottom: 12px }`, and what isn't
  /// rows 16 under its rule.
  static let listHeadSpaceBelow: CGFloat = 12
  static let listBodySpaceAbove: CGFloat = 16
  /// `.person-row { gap: 14px }`, 10 on a phone; `.follow-button { min-width: 92px }` (0 on a phone).
  static let personGap: CGFloat = 14
  static let phonePersonGap: CGFloat = 10
  static let followMinWidth: CGFloat = 92
  /// `.person-main { line-height: 1.35 }`
  static let personLineHeight: Double = 1.35
  /// `@container rows (max-width: 599px)` drops "follows you" beside a fact,
  /// `(max-width: 479px)` the handle too.
  static let personRelHiddenAt: CGFloat = 599
  static let personHandleHiddenAt: CGFloat = 479
  /// tools.css `@container widget (max-width: 400px) { .person-history {
  /// display: none } }`: a card a third of the row wide keeps a name, a
  /// count and Follow.
  static let personHistoryHiddenAt: CGFloat = 400
  /// `.person-meta > :not(:last-child)::after { margin: 0 6px }`
  static let personDotMargin: CGFloat = 6
  /// `.post-row { gap: 14px }`, `.post-rank { width: 16px }`, `.post-main { gap: 4px }`,
  /// `.post-text { line-height: 1.4 }`, `.post-count { gap: 4px }` with its 13-point glyph.
  static let postGap: CGFloat = 14
  static let postRank: CGFloat = 16
  static let postMainGap: CGFloat = 4
  static let postTextLineHeight: Double = 1.4
  static let postCountGap: CGFloat = 4
  static let postCountIcon: CGFloat = 13
  /// `.post-count.is-dim { opacity: 0.5 }`
  static let postCountDim: Double = 0.5
  /// `.list-row { gap: 12px }`
  static let listRowGap: CGFloat = 12
  /// `.arrange-line { min-height: 52px }`: the name 8 after the arrows, the
  /// value 12 after the name, the chevron (16) 8 after that.
  static let arrangeLineHeight: CGFloat = 52
  /// `.arrange-line > .btn:first-child { margin-left: -14px }` on touch: the
  /// first arrow's glyph on the page's edge.
  static let arrangeArrowBleed: CGFloat = 14
  static let arrangeNameSpaceBefore: CGFloat = 8
  static let arrangeValueSpaceBefore: CGFloat = 12
  static let arrangeChevronSpaceBefore: CGFloat = 8
  static let arrangeChevron: CGFloat = 16
  /// `.arrange-detail { gap: 16px; padding: 4px 0 16px }`, `.arrange-size { gap: 4px }`.
  static let arrangeDetailGap: CGFloat = 16
  static let arrangeDetailSpaceAbove: CGFloat = 4
  static let arrangeDetailSpaceBelow: CGFloat = 16
  static let arrangeSizeGap: CGFloat = 4
  /// `.arrange-tools { gap: 8px 24px }`
  static let arrangeToolsGap: CGFloat = 24
  static let arrangeToolsLineGap: CGFloat = 8
  /// `.library { gap: 14px }`; `.library-item { gap: 12px }`, its icon 16
  /// in a box 20 tall, `.library-text { gap: 2px }`, `.library-name { gap: 8px }`,
  /// `.library-on { gap: 5px }` with its 13-point check.
  static let libraryGap: CGFloat = 14
  static let libraryItemGap: CGFloat = 12
  static let libraryIcon: CGFloat = 16
  static let libraryIconBox: CGFloat = 20
  static let libraryTextGap: CGFloat = 2
  static let libraryNameGap: CGFloat = 8
  static let libraryOnGap: CGFloat = 5
  static let libraryOnIcon: CGFloat = 13
  /// `.library-text { line-height: 1.35 }`
  static let libraryLineHeight: Double = 1.35
}

extension Measure.Chart {
  /// SeriesChart.jsx: the middle date steps aside when it would come within
  /// 12 of an end date, each date's width estimated at 6.6 a character.
  static let dateCharWidth: CGFloat = 6.6
  static let dateClearance: CGFloat = 12
  /// `.an-tableview .table thead th { padding-top: 8px }`
  static let tableHeadSpaceAbove: CGFloat = 8
  /// `.chart-foot > .menu:last-child:has(> .btn--icon) { margin-right: -14px }`
  /// on touch (and `.report-filter-actions > .menu`'s): a ⋯'s dots end on
  /// the column's edge.
  static let footMenuBleed: CGFloat = 14
}
#endif
