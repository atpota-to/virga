// Ports src/shell/shell.css (its measures)
// Ports src/styles/app.css (the measures ThemeKit doesn't carry)
// Ports src/legal/legal.css (its measures)
// Ports src/signin/signin.css (its measures)
// Ports src/accounts/accounts.css (its measures)
// Ports src/settings/settings.css (its measures)
// Ports src/shell/commandPalette.css (its measures)
// Ports src/charts/charts.css (its measures)
// Ports src/dashboards/dashboards.css (its measures)
// Ports src/reports/reports.css (its measures)
//
// The measures of the stylesheets ThemeKit doesn't read yet (ThemeKit holds
// theme.css, base.css, controls.css and app.css; ios/parity/cases/
// _themeKit.js lists what it reads). Each is named here once, with the rule
// it comes from, so no view writes a number of its own; a view that needs
// one of these says `Measure.TabBar.itemSize`. When the kit grows to read
// these sheets (a line each in _themeKit.js), each moves to ThemeKit and the
// parity fixture holds it to the stylesheet.
//
// Lengths are points (CSS px); `em`/`ch` lengths are noted, and applied
// against the text they sit in. The literal colours are the ones the
// stylesheets write out themselves (settings.css's sky tiles, the toast's
// danger ground), read as a browser reads them.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// A CSS `clamp(min, share × extent, max)` of the window's width (vw) or
/// height (svh).
public struct Clamp: Sendable {
  public var min: CGFloat
  public var share: CGFloat
  public var max: CGFloat

  public init(min: CGFloat, share: CGFloat, max: CGFloat) {
    self.min = min
    self.share = share
    self.max = max
  }

  /// The length for a window this wide (or tall).
  public func of(_ extent: CGFloat) -> CGFloat {
    Swift.min(self.max, Swift.max(self.min, extent * share))
  }
}

public enum Measure {
  // MARK: controls.css (the touch block's reaches, which ThemeKit doesn't read)

  public enum LinkAction {
    /// `.link-action::after, .more-link::after { inset: -13px -6px }`
    public static let reachAbove: CGFloat = 13
    public static let reachSides: CGFloat = 6
    /// `.link-action, .more-link { line-height: 1.45 }`
    public static let lineHeight: Double = 1.45
    /// `.link-action { text-decoration-thickness: 1px }`; 2px while what it
    /// opens is open (`[aria-expanded='true']`) and under the pointer.
    public static let underline: CGFloat = 1
    public static let heavyUnderline: CGFloat = 2
  }

  /// controls.css's controls whose words are one line in a box of their own.
  public enum Lines {
    /// `.btn { line-height: 1 }`
    public static let button: Double = 1
    /// `.segmented-key { line-height: 1 }`
    public static let segmentedKey: Double = 1
    /// `.token { line-height: 1.2 }`
    public static let token: Double = 1.2
  }

  public enum Avatar {
    /// The most of the disc its letter may take under Dynamic Type.
    public static let letterShare: CGFloat = 0.5
  }

  public enum Token {
    /// `.token { border: 1px solid var(--line-2); font-size: var(--text-sm); font-weight: 500 }`
    public static let border: CGFloat = 1
    public static let fontSize: ThemeToken = .textSm
    public static let weight: Double = 500
  }

  public enum Badge {
    /// `.badge { border: 1px solid transparent }`: an edge that only forced
    /// colours draw, there in the pill's size all the same.
    public static let border: CGFloat = 1
  }

  public enum Segmented {
    /// `.segmented-key { gap: 6px }`: a key's glyph to its word.
    public static let keyGap: CGFloat = 6
    /// Segmented.jsx's SPARE: how far clear of the fade a key is scrolled
    /// when it is pressed under it.
    public static let spare: CGFloat = 24
    /// `.card-head > .segmented { margin-top: 8px }` at 560 and under, and
    /// `margin-block: -13px` on touch from 561 up, so the 44 keys don't
    /// make the title's line taller.
    public static let headSpaceAbove: CGFloat = 8
    public static let headLift: CGFloat = 13
  }

  public enum Touch {
    /// The least a finger is given anywhere: 44 points (the touch block's
    /// reach for a small button, a ghost icon, a Segmented's key, a menu's item).
    public static let target: CGFloat = 44
    /// `.token-remove::after { inset: -10px }`
    public static let tokenRemoveReach: CGFloat = 10
    /// `.segmented-key::before { inset: 0 -11px }`, `.segmented { padding-inline: 11px }`
    public static let segmentedReach: CGFloat = 11
  }

  public enum Field {
    /// `.search > svg { width: 16px }`
    public static let searchIcon: CGFloat = 16
    /// `select.input { padding-right: 30px }` with its chevron, two 5px
    /// halves drawn 11 to 21 in from the right edge: the system's chevron at
    /// about that size, 11 in, and room for it before the words stop.
    public static let selectChevron: CGFloat = 9
    public static let selectChevronInset: CGFloat = 11
    public static let selectChevronGap: CGFloat = 9
    /// What a TextEditor's own text view keeps inside it (UITextView's
    /// textContainerInset, 8 above and below, and lineFragmentPadding, 5 at
    /// the sides), which a text area's padding is drawn less of.
    public static let textEditorInset = EdgeInsets(top: 8, leading: 5, bottom: 8, trailing: 5)
  }

  public enum Disclosure {
    /// `.disclosure > summary::before`: a 6px chevron of 1.5px strokes,
    /// drawn as the system's chevron at about its height.
    public static let chevron: CGFloat = 8
    /// `.disclosure > summary { gap: 8px }`
    public static let gap: CGFloat = 8
  }

  /// The browser's own checkbox (`input[type='checkbox']` with
  /// `accent-color`), drawn: corners of 3, a 1-point edge in --line-2, the
  /// tick at 60% of the box.
  public enum Check {
    public static let radius: CGFloat = 3
    public static let edge: CGFloat = 1
    public static let tickShare: CGFloat = 0.6
    /// A radio's dot, half the ring.
    public static let radioDotShare: CGFloat = 0.5
  }

  public enum Switch {
    /// theme.css, high contrast: `.switch::after { transform: scale(0.7) }`.
    public static let highContrastKnobScale: CGFloat = 0.7
  }

  public enum Figures {
    /// `.figures { grid-template-columns: repeat(auto-fit, minmax(min(168px, 100%), 1fr)) }`,
    /// 128 when there are exactly five.
    public static let minWidth: CGFloat = 168
    public static let fiveMinWidth: CGFloat = 128
    /// `.figures-note .delta:not(:last-child)::after { margin: 0 6px 0 4px }`
    public static let noteDotBefore: CGFloat = 4
    public static let noteDotAfter: CGFloat = 6
  }

  public enum Section {
    /// `.card-head > :first-child { min-width: min(100%, 16rem) }`: the title's
    /// least room before its group wraps under it.
    public static let titleMinWidth: CGFloat = 256
    /// `.card-head:has(> :nth-child(2)) { column-gap: 16px }` at 560 and under.
    public static let phoneHeadGap: CGFloat = 16
    /// A list's rows: `border-bottom: 1px solid var(--line)`.
    public static let hairline: CGFloat = 1
    /// `.empty-block .empty { max-width: 56ch }`
    public static let emptyMeasure: CGFloat = 56
    /// `.card-head .btn--icon { margin-top: -12px }` on touch: a 44 icon over the title's line.
    public static let iconToolLift: CGFloat = 12
    /// `.row-actions { margin-top: -6px }` on touch.
    public static let rowActionsLift: CGFloat = 6
    /// `.table tr.is-selected`: let out 10 past the table's sides.
    public static let selectedRowBleed: CGFloat = 10
    /// `.callout svg { width: 16px; margin-top: 2px }`
    public static let calloutIcon: CGFloat = 16
    public static let calloutIconSpaceAbove: CGFloat = 2
    /// `.info-tip-pop { top: calc(100% + 6px) }`, an info tip's glyph 13.
    public static let infoTipIcon: CGFloat = 13
    /// `.info-tip-pop { line-height: 1.45 }`
    public static let infoTipLineHeight: Double = 1.45
    /// The touch block's `.info-tip-button { margin: -8px -6px }`: the 32
    /// button laid out 6 narrower at each side and 8 shorter at each end.
    public static let infoTipLetOut = CGSize(width: 6, height: 8)
  }

  // MARK: shell.css

  public enum Shell {
    /// `.shell { --figure-size: min(var(--text-figure), max(2.5rem,
    /// calc((column - 96px) / 4 * 0.26))) }`; from 560 down
    /// `calc((100vw - var(--page-pad) * 2 - 20px) / 2 * 0.26)`.
    public static let figureFloor: CGFloat = 40
    public static let figureShare: CGFloat = 0.26
    public static let figureGaps: CGFloat = 96
    public static let phoneFigureGaps: CGFloat = 20
  }

  public enum Sidebar {
    /// `.sidebar { padding: var(--page-top) 16px 24px 36px }`
    public static let paddingTrailing: CGFloat = 16
    public static let paddingBottom: CGFloat = 24
    public static let paddingLeading: CGFloat = 36
    /// `.sidebar { gap: 24px }`
    public static let gap: CGFloat = 24
    /// `.sidebar[data-collapsed] { padding: … 0 20px }`
    public static let railPaddingBottom: CGFloat = 20
    /// `.sidebar-top { min-height: 35px; gap: 8px }`
    public static let topHeight: CGFloat = 35
    /// `.sidebar-do { gap: 8px }`
    public static let doGap: CGFloat = 8
    /// `.sidebar-search { padding: 0 8px 0 12px; gap: 8px }`, its ground
    /// `color-mix(in srgb, var(--surface) 60%, transparent)`.
    public static let searchPaddingLeading: CGFloat = 12
    public static let searchPaddingTrailing: CGFloat = 8
    public static let searchFillShare: Double = 0.6
    /// `.nav { gap: 2px }`, `.sidebar[data-collapsed] .nav { gap: 6px }`
    public static let navGap: CGFloat = 2
    public static let railNavGap: CGFloat = 6
    /// `.nav-link { gap: 10px; min-height: 34px }`, 44 on touch.
    public static let navLinkGap: CGFloat = 10
    public static let navLinkHeight: CGFloat = 44
    /// `.nav-icon` 16 (18 on the rail).
    public static let navIcon: CGFloat = 16
    public static let railNavIcon: CGFloat = 18
    /// `.nav-sub { margin: 0 0 10px 7px; padding-left: 18px; border-left: 1px }`
    public static let subIndent: CGFloat = 7
    public static let subPadding: CGFloat = 18
    public static let subSpaceBelow: CGFloat = 10
    /// `.nav-sub-link { min-height: 30px }`, 40 on touch.
    public static let subLinkHeight: CGFloat = 40
    /// `.nav-sub-link[aria-current]::before`: a 7px dot centred on the rail.
    public static let currentDot: CGFloat = 7
    /// A 44px disc on the rail: `.sidebar[data-collapsed] .nav-link`.
    public static let railDisc: CGFloat = 44
  }

  /// shell.css's sync places (.sync-card, .sync-banner, .sync-steps).
  public enum Sync {
    /// `.sync-card { gap: 4px }`; `.sync-card-row, .sync-card-title { gap: 8px }`.
    public static let cardGap: CGFloat = 4
    public static let rowGap: CGFloat = 8
    /// `.sync-card-sub { line-height: 1.4 }`
    public static let subLineHeight: Double = 1.4
    /// `.sync-card .progress { margin: 4px 0 }`
    public static let cardProgressSpace: CGFloat = 4
    /// `.sync-card > .btn { gap: 6px; min-height: 24px; margin-top: 2px }`, 44 to touch.
    public static let linkGap: CGFloat = 6
    public static let linkHeight: CGFloat = 24
    public static let linkSpaceAbove: CGFloat = 2
    public static let linkIcon: CGFloat = 14
    /// `.sidebar .sync-card-counts` is hidden on a window this short or
    /// shorter (`max-height: 860px`).
    public static let countsHiddenAtHeight: CGFloat = 860
    /// `.sync-banner { min-height: 36px; gap: 16px; margin-bottom: 4px }`,
    /// its progress a 2px line along its foot.
    public static let bannerHeight: CGFloat = 36
    public static let bannerGap: CGFloat = 16
    public static let bannerSpaceBelow: CGFloat = 4
    public static let bannerProgress: CGFloat = 2
    /// `.sync-banner-step::before { margin: 0 6px }`
    public static let bannerDotSpace: CGFloat = 6
    /// `.sync-steps-wrap { gap: 12px }`, `.sync-steps { gap: 12px }` in
    /// three columns (two from 479 down), `.sync-step { gap: 6px }`,
    /// `.sync-step-name { gap: 6px }`, its tick 13.
    public static let stepsGap: CGFloat = 12
    public static let stepColumns = 3
    public static let narrowStepColumns = 2
    public static let narrowStepsAt: CGFloat = 479
    public static let stepGap: CGFloat = 6
    public static let tick: CGFloat = 13
  }

  /// reports.css (its measures are in Reports/InsightMeasures.swift).
  public enum Reports {}

  /// dashboards.css.
  public enum Dashboard {
    /// `.stat { gap: 8px; padding-top: 16px; border-top: 2px }` (12 at 560
    /// and under, which the dashboards' own measures hold), its head 8
    /// apart, the label's glyph 14 and 6 from its words, the number's line
    /// 16 from the trend (`.stat-value { letter-spacing: -0.04em }`). A
    /// report tile's padding (reports.css `.report-tile`) is 16 at every
    /// width.
    public static let statGap: CGFloat = 8
    public static let statPaddingTop: CGFloat = 16
    public static let statHeadGap: CGFloat = 8
    public static let statLabelGap: CGFloat = 6
    public static let statIcon: CGFloat = 14
    public static let statLineGap: CGFloat = 16
    public static let statTracking: ThemeLength = .em(-0.04)
    /// Customize: the dashed outline (1, dashes 4 3). A card's head, the
    /// stat's note and spark, and the arrange list's lines are in
    /// Reports/InsightMeasures.swift (a list card's head 12 over its rule,
    /// any other card's the kit's ThemeKit.cardHeadSpaceBelow, 16).
    public static let editDash: [CGFloat] = [4, 3]
    /// The grid's column gap on a phone (`.dash-grid { column-gap: 20px }`).
    public static let phoneColumnGap: CGFloat = 20
    /// Where the grid narrows (`@container dash`): from 860 down a third
    /// and two thirds take the row; from 620 down every card does, and
    /// figures go two to a row.
    public static let narrow: CGFloat = 860
    public static let phone: CGFloat = 620
    /// `.widget-open { margin-right: -14px }` on touch: a card's last tool,
    /// a 44 ghost icon, let out by its own padding so its glyph ends on the
    /// card's edge.
    public static let openLetOut: CGFloat = 14
  }

  /// charts.css and SeriesChart.jsx's own measures.
  public enum Chart {
    /// SeriesChart's column for the rules' numbers, roughly (Swift Charts
    /// lays its own out; this sizes the slots for the bars and the ghost).
    public static let labelColumn: CGFloat = 32
    /// `GHOST_GUTTER`: the reach past the last bucket.
    public static let ghostGutter: CGFloat = 28
    /// Bars: at most 24 thick, a 2-point gap, top corners 3, at 90%.
    public static let barMax: CGFloat = 24
    public static let barGap: CGFloat = 2
    public static let barRadius: CGFloat = 3
    public static let barOpacity: Double = 0.9
    /// `.an-chart-ylabel, .an-chart-xlabel { font-size: 12px }`
    public static let labelSize: CGFloat = 12
    /// The last point's dot (r 3.4), the readout's marker (r 4), a mark's
    /// diamond (4 from centre to point).
    public static let dot: CGFloat = 6.8
    public static let marker: CGFloat = 8
    public static let diamond: CGFloat = 5.6
    /// Dashes: a mark's rule 2 3, the second line 6 5, the ghost 4 4.
    public static let markDash: [CGFloat] = [2, 3]
    public static let secondaryDash: [CGFloat] = [6, 5]
    public static let ghostDash: [CGFloat] = [4, 4]
    /// The ghost's dot, 4 in from the plot's right.
    public static let ghostInset: CGFloat = 4
    /// `.an-chart-area-secondary { fill-opacity: 0.14 }`
    public static let stackedOpacity: Double = 0.14
    /// `.an-chart-tip { padding: 7px 11px }`, 10 above its point; its ground
    /// and words (charts.css's own: dark by day, light at night).
    public static let tipPadding = EdgeInsets(top: 7, leading: 11, bottom: 7, trailing: 11)
    public static let tipSpace: CGFloat = 10
    public static let tipFillDay = Color(red: 0x0f / 255, green: 0x1b / 255, blue: 0x33 / 255)
    public static let tipInkDay = Color(red: 0xc9 / 255, green: 0xd3 / 255, blue: 0xe6 / 255)
    public static let tipStrongDay = Color.white
    public static let tipFillNight = Color(red: 0xf2 / 255, green: 0xf5 / 255, blue: 0xfc / 255)
    public static let tipInkNight = Color(red: 0x33 / 255, green: 0x41 / 255, blue: 0x5c / 255)
    public static let tipStrongNight = Color(red: 0x0d / 255, green: 0x15 / 255, blue: 0x2b / 255)
    /// `.an-chart-legend span { gap: 6px }`
    public static let legendGap: CGFloat = 6
    /// `.an-chart-marks { gap: 4px 14px }`, the newest five listed, each
    /// diamond 6 before its words.
    public static let marksGap: CGFloat = 14
    public static let marksLineGap: CGFloat = 4
    public static let marksListed = 5
    public static let marksDiamondGap: CGFloat = 6
    /// `.an-tableview-scroll { max-height: 20rem }`, straight under the
    /// foot on touch (its 44-point link actions leave the room; the chart
    /// foot's gaps are ThemeKit.chartFootGap).
    public static let tableMaxHeight: CGFloat = 320
    /// `.an-tableview .table { min-width: min(100%, 28rem) }`: 28rem, held
    /// to the column by TableScroll.
    public static let tableMinWidth: CGFloat = 448
    /// `.barlist`: the label column 136 (200 for NSIDs), the track at
    /// least 96 (60), 6 tall; 12 between rows, 16 between columns; at
    /// most 640 wide; a label's glyph 15.
    public static let barLabel: CGFloat = 136
    public static let barLabelCode: CGFloat = 200
    public static let barTrack: CGFloat = 96
    public static let barTrackCode: CGFloat = 60
    public static let barTrackHeight: CGFloat = 6
    public static let barRowGap: CGFloat = 12
    public static let barColumnGap: CGFloat = 16
    public static let barListMax: CGFloat = 640
    public static let barIcon: CGFloat = 15
    /// `.heatmap`: the day column 34, 3 between cells, a cell 18 tall with
    /// corners 3; the legend's cells 14 × 10, corners 2, 10 under the grid.
    public static let heatDay: CGFloat = 34
    public static let heatGap: CGFloat = 3
    public static let heatCell: CGFloat = 18
    public static let heatRadius: CGFloat = 3
    public static let heatLegendCell = CGSize(width: 14, height: 10)
    public static let heatLegendRadius: CGFloat = 2
    public static let heatLegendSpace: CGFloat = 10
    public static let heatLegendGap: CGFloat = 4
    /// `.sparkline { height: 32px }`, its line 1.5.
    public static let sparkHeight: CGFloat = 32
    public static let sparkLine: CGFloat = 1.5
  }

  /// commandPalette.css.
  public enum Palette {
    /// `.palette-search { margin: 0 56px 0 20px; border-bottom: 2px }`, its
    /// input 52 tall, 30 in for the 18-point glyph, its words --text-lg (16
    /// from 374 down).
    public static let fieldLeading: CGFloat = 20
    public static let fieldTrailing: CGFloat = 56
    public static let fieldRule: CGFloat = 2
    public static let fieldHeight: CGFloat = 52
    public static let fieldIcon: CGFloat = 18
    public static let fieldIconGap: CGFloat = 12
    public static let narrowFieldSize: CGFloat = 16
    public static let fieldSpaceAbove: CGFloat = 4
    /// `.palette-list { padding: 8px 10px 10px }`, `.palette-group + .palette-group { margin-top: 8px }`,
    /// `.palette-group-head { padding: 8px 10px 4px }`.
    public static let list = EdgeInsets(top: 8, leading: 10, bottom: 10, trailing: 10)
    public static let groupGap: CGFloat = 8
    public static let groupHead = EdgeInsets(top: 8, leading: 10, bottom: 4, trailing: 10)
    /// `.palette-option { gap: 10px; min-height: 40px; padding: 5px 10px }`, 48 on a phone;
    /// its icon 24 wide (a 16 glyph), the tick 15, a phone's hint 1 under its title.
    public static let optionGap: CGFloat = 10
    public static let optionHeight: CGFloat = 40
    public static let phoneOptionHeight: CGFloat = 48
    public static let optionPadding = EdgeInsets(top: 5, leading: 10, bottom: 5, trailing: 10)
    public static let optionIcon: CGFloat = 24
    public static let optionGlyph: CGFloat = 16
    public static let mark: CGFloat = 15
    public static let phoneHintGap: CGFloat = 1
    /// `.palette-empty { padding: 28px 12px 32px }`
    public static let empty = EdgeInsets(top: 28, leading: 12, bottom: 32, trailing: 12)
    /// `.palette-foot { gap: 18px; padding: 9px 20px 11px }`, its keys 4 from their words.
    public static let foot = EdgeInsets(top: 9, leading: 20, bottom: 11, trailing: 20)
    public static let footGap: CGFloat = 18
    public static let footKeyGap: CGFloat = 4
    /// `.kbd { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 5px }`
    public static let keySize: CGFloat = 20
    public static let keyPadding: CGFloat = 5
    public static let keyRadius: CGFloat = 5
    /// The sidebar's row: its glyph 15 (`.sidebar-search > svg`).
    public static let sidebarIcon: CGFloat = 15
  }

  /// shell.css's `.range-fields`: `repeat(auto-fit, minmax(180px, 1fr))`, 16 apart.
  public enum Period {
    public static let fieldMinWidth: CGFloat = 180
    public static let fieldsGap: CGFloat = 16
  }

  /// shell.css's `.first-run`.
  public enum FirstRun {
    /// `.first-run-card { gap: 20px; max-width: 640px }`
    public static let cardGap: CGFloat = 20
    public static let cardMaxWidth: CGFloat = 640
    /// `.first-run-list li { gap: 12px; padding: 12px 0 }`, its icon 16, 3 down.
    public static let itemGap: CGFloat = 12
    public static let itemPadding: CGFloat = 12
    public static let icon: CGFloat = 16
    public static let iconSpaceAbove: CGFloat = 3
  }

  public enum Brand {
    /// `.brand { gap: 10px }`
    public static let gap: CGFloat = 10
    /// `.brand-name { font-size: 1.0625rem; font-weight: 600; letter-spacing: -0.01em }`
    public static let nameSize: CGFloat = 17
    public static let nameWeight: Double = 600
    public static let nameTracking: ThemeLength = .em(-0.01)
    /// bits.jsx LogoMark: 22 by default, its stroke 1.8 on a 24 grid.
    public static let markSize: CGFloat = 22
    public static let markStroke: CGFloat = 1.8
  }

  public enum Account {
    /// `.account-menu > .menu-button { min-height: 42px; padding: 6px; gap: 10px }`
    public static let buttonHeight: CGFloat = 42
    public static let buttonPadding: CGFloat = 6
    public static let buttonGap: CGFloat = 10
    /// Its avatar: 30, its letter `var(--text-xs)`.
    public static let avatarSize: CGFloat = 30
    /// `.account-menu--compact > .menu-button`: a 44px circle.
    public static let compactSize: CGFloat = 44
  }

  public enum AppBar {
    /// `.appbar { padding: 0 8px 0 var(--page-pad); gap: 8px }`
    public static let paddingTrailing: CGFloat = 8
    public static let gap: CGFloat = 8
    /// `.appbar-back { gap: 2px; margin-left: -6px }`, its chevron 18.
    public static let backGap: CGFloat = 2
    public static let backChevron: CGFloat = 18
    /// `.appbar .btn--icon { width: 44px }`, its glyph 20; `.appbar .brand`
    /// is as tall.
    public static let iconButton: CGFloat = 44
    public static let icon: CGFloat = 20
  }

  public enum TabBar {
    /// `.tabbar { padding: 7px 12px 8px; gap: 12px; border-top: 1px }`
    public static let paddingTop: CGFloat = 7
    public static let paddingBottom: CGFloat = 8
    public static let paddingSides: CGFloat = 12
    public static let gap: CGFloat = 12
    /// `.tabbar-tabs { max-width: 420px; gap: 4px }`
    public static let tabsMaxWidth: CGFloat = 420
    public static let tabsGap: CGFloat = 4
    /// `.tabbar-item { min-width: 48px; height: 48px; gap: 8px }`, its glyph 20.
    public static let itemSize: CGFloat = 48
    public static let itemGap: CGFloat = 8
    public static let icon: CGFloat = 20
    /// `.tabbar-item[aria-current] { padding: 0 16px 0 14px }`
    public static let currentPaddingLeading: CGFloat = 14
    public static let currentPaddingTrailing: CGFloat = 16
    /// `.tabbar-new-post`: a 48px ink circle.
    public static let newPostSize: CGFloat = 48
  }

  public enum PageHeader {
    /// `.page-header-in { gap: 4px }`, `.page-header-row { gap: 16px 32px }`,
    /// `.page-header-text { gap: 6px }`, `.page-title-row { gap: 4px }`.
    public static let gap: CGFloat = 4
    public static let rowGap: CGFloat = 16
    public static let columnGap: CGFloat = 32
    public static let textGap: CGFloat = 6
    /// `.page-header-text { flex: 1 1 320px }`: the words' least room before
    /// the controls go under them.
    public static let wordsBasis: CGFloat = 320
    /// `.page-header-row { gap: 12px }` at 560 and under.
    public static let phoneRowGap: CGFloat = 12
    /// `.page-sub, .page-access { max-width: 68ch }`
    public static let subMeasure: CGFloat = 68
    /// `.page-actions { gap: 12px 32px }`; 16 on a phone.
    public static let actionsGap: CGFloat = 32
    public static let phoneActionsGap: CGFloat = 16
    /// `.page-header-extra { margin-top: 8px }`
    public static let extraSpaceAbove: CGFloat = 8
    /// The title's tracking and line: `.page-title`.
    public static let titleTracking: ThemeLength = .em(-0.025)
    public static let titleLineHeight: Double = 1.1
  }

  public enum Page {
    /// `.page-body { padding-bottom: 72px }`, 40 under 900.
    public static let bodySpaceBelow: CGFloat = 72
    public static let phoneBodySpaceBelow: CGFloat = 40
  }

  public enum Dialog {
    /// `.dialog { width: min(520px, 100vw - 32px); border-radius: 16px }`
    public static let width: CGFloat = 520
    /// The dialogs the web makes wider, each `min(640px, 100vw - 32px)`:
    /// `.dialog.timer-dialog` (schedule.css), `.dialog.adviser-sheet,
    /// .dialog.alt-dialog, .dialog.style-dialog` (adviser.css) and
    /// `.dialog.tpl-dialog` (library.css).
    public static let wideWidth: CGFloat = 640
    /// `.dialog.lib-dialog { width: min(980px, 100vw - 32px); height: min(720px, 100svh - 48px) }`
    public static let libraryWidth: CGFloat = 980
    public static let libraryHeight: CGFloat = 720
    /// What a dialog leaves of the window: `100vw - 32px` across, `100svh - 48px` down.
    public static let windowSpaceAcross: CGFloat = 32
    public static let windowSpaceDown: CGFloat = 48
    public static let radius: CGFloat = 16
    /// `.dialog-head { padding: 20px 16px 8px 24px }`; a phone's 16 10 8 18.
    public static let head = EdgeInsets(top: 20, leading: 24, bottom: 8, trailing: 16)
    public static let phoneHead = EdgeInsets(top: 16, leading: 18, bottom: 8, trailing: 10)
    /// `.dialog-body { padding: 4px 24px 20px }`; a phone's 4 18 16.
    public static let body = EdgeInsets(top: 4, leading: 24, bottom: 20, trailing: 24)
    public static let phoneBody = EdgeInsets(top: 4, leading: 18, bottom: 16, trailing: 18)
    /// `.dialog-actions { padding: 8px 24px 20px; gap: 8px }`; a phone's 8 18 16.
    public static let actions = EdgeInsets(top: 8, leading: 24, bottom: 20, trailing: 24)
    public static let phoneActions = EdgeInsets(top: 8, leading: 18, bottom: 16, trailing: 18)
    public static let actionsGap: CGFloat = 8
    /// `.dialog-title { letter-spacing: -0.015em }`
    public static let titleTracking: ThemeLength = .em(-0.015)
    /// `.dialog-form { gap: 16px }`
    public static let formGap: CGFloat = 16
    /// `.choice { padding: 12px 0 12px 12px; gap: 12px }`, the picked one's
    /// rule 2px in the accent.
    public static let choicePadding = EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 0)
    public static let choiceGap: CGFloat = 12
    public static let choiceRule: CGFloat = 2
    /// `.choice input { margin-top: 3px }`
    public static let choiceInputSpaceAbove: CGFloat = 3
  }

  public enum Toast {
    /// `.toast { max-width: 420px; padding: 11px 16px }`
    public static let maxWidth: CGFloat = 420
    public static let padding = EdgeInsets(top: 11, leading: 16, bottom: 11, trailing: 16)
    /// `.toasts { right: 16px; bottom: 16px; gap: 8px }`; 12 on a phone.
    public static let inset: CGFloat = 16
    public static let phoneInset: CGFloat = 12
    public static let gap: CGFloat = 8
    /// `.toast[data-tone='danger'] { background: #b42318; color: #ffffff }`
    public static let dangerFill = ThemeColor(css: "#b42318") ?? .transparent
    public static let dangerInk = ThemeColor(css: "#ffffff") ?? .transparent
    /// How long a toast stays (bits.jsx: 4200 ms).
    public static let seconds: Double = 4.2
  }

  // MARK: app.css

  public enum Landing {
    /// `.landing-main { padding-top: clamp(32px, 7svh, 72px); padding-bottom: 56px }`;
    /// a phone's 24 and 40.
    public static let mainSpaceBelow: CGFloat = 56
    public static let phoneMainSpaceAbove: CGFloat = 24
    public static let phoneMainSpaceBelow: CGFloat = 40
    /// `.landing-main { padding-top: clamp(32px, 7svh, 72px) }`
    public static let mainSpaceAbove = Clamp(min: 32, share: 0.07, max: 72)
    /// `.landing-hero { gap: 48px clamp(40px, 6vw, 88px) }`; a phone's 40.
    public static let heroGap: CGFloat = 48
    public static let heroColumnGap = Clamp(min: 40, share: 0.06, max: 88)
    public static let phoneHeroGap: CGFloat = 40
    /// `.landing-copy { gap: 20px; max-width: 560px }`; 620 under 900.
    public static let copyGap: CGFloat = 20
    public static let copyMaxWidth: CGFloat = 560
    public static let phoneCopyMaxWidth: CGFloat = 620
    /// `.landing-title { margin-top: -6px }`
    public static let titleSpaceAbove: CGFloat = -6
    /// `.landing-copy > .signin-flow { margin-top: 12px }`
    public static let flowSpaceAbove: CGFloat = 12
    /// `.landing-note { max-width: 60ch }`
    public static let noteMeasure: CGFloat = 60
    /// `.landing-points { gap: 32px … }`, each `gap: 6px`, its glyph 18 with 4 under it.
    public static let pointsGap: CGFloat = 32
    public static let pointGap: CGFloat = 6
    public static let pointIcon: CGFloat = 18
    public static let pointIconSpaceBelow: CGFloat = 4
    /// `.landing-points p { max-width: 44ch }`
    public static let pointMeasure: CGFloat = 44
    /// `.landing-foot { padding-top: 20px; padding-bottom: 32px; gap: 8px 32px }`,
    /// its words held to 78ch.
    public static let footSpaceAbove: CGFloat = 20
    public static let footSpaceBelow: CGFloat = 32
    public static let footGap: CGFloat = 8
    public static let footColumnGap: CGFloat = 32
    public static let footMeasure: CGFloat = 78
    /// `.landing-points`: three to a row from 720.
    public static let pointsRow: CGFloat = 720

    // The sketch (app.css), and the picture's own data in Landing.jsx.
    /// `.landing-sketch { gap: clamp(22px, 2.6vw, 34px); padding-top: 34px }`
    public static let sketchGap = Clamp(min: 22, share: 0.026, max: 34)
    public static let sketchSpaceAbove: CGFloat = 34
    /// `.sketch-figures { gap: 0 clamp(12px, 1.8vw, 24px) }`, `.sketch-lists { gap: 0 clamp(20px, 3vw, 40px) }`
    public static let sketchFigureGap = Clamp(min: 12, share: 0.018, max: 24)
    public static let sketchListGap = Clamp(min: 20, share: 0.03, max: 40)
    /// `.sketch-word { height: 6px; border-radius: 3px }`, `--strong { height: 8px; opacity: 0.82 }`,
    /// `.sketch-number { height: clamp(18px, 2.4vw, 30px); opacity: 0.84 }`.
    public static let sketchWord: CGFloat = 6
    public static let sketchRadius: CGFloat = 3
    public static let sketchStrong: CGFloat = 8
    public static let sketchStrongOpacity: Double = 0.82
    public static let sketchNumber = Clamp(min: 18, share: 0.024, max: 30)
    public static let sketchNumberOpacity: Double = 0.84
    /// `.sketch-figure { gap: 10px; padding-top: 12px; border-top: 2px }`
    public static let sketchCellGap: CGFloat = 10
    public static let sketchCellPadding: CGFloat = 12
    public static let sketchFigureRule: CGFloat = 2
    /// `.sketch-tabs .sketch-word { width: 30px }`
    public static let sketchTab: CGFloat = 30
    /// `.sketch-row { gap: 10px; height: 34px }`, its count 18 wide at 0.6, a face 16.
    public static let sketchRowGap: CGFloat = 10
    public static let sketchRow: CGFloat = 34
    public static let sketchCount: CGFloat = 18
    public static let sketchCountOpacity: Double = 0.6
    public static let sketchFace: CGFloat = 16
    /// `.sketch-heat { gap: 3px }`, a cell 12 tall, radius 2.
    public static let sketchHeatGap: CGFloat = 3
    public static let sketchHeatCell: CGFloat = 12
    public static let sketchHeatRadius: CGFloat = 2
    /// The chart's svg: `viewBox="0 0 520 176"`, its grid at 12, 88 and 164,
    /// the line's reach to (512, 22) dashed `2 6`, its dots r 3.5 and 4.5,
    /// the strokes 2.
    public static let sketchBox = CGSize(width: 520, height: 176)
    public static let sketchChartAspect: CGFloat = 520.0 / 176.0
    public static let sketchGridLines: [CGFloat] = [12, 88, 164]
    public static let sketchEnd = CGPoint(x: 512, y: 22)
    public static let sketchDash: [CGFloat] = [2, 6]
    public static let sketchLineWidth: CGFloat = 2
    public static let sketchOpenDot: CGFloat = 7
    public static let sketchDot: CGFloat = 9
    /// `.landing-narrow { gap: 18px; max-width: 560px …; padding: clamp(32px, 10svh, 104px) … 56px }`
    public static let narrowGap: CGFloat = 18
    public static let narrowMaxWidth: CGFloat = 560
    public static let narrowSpaceAbove = Clamp(min: 32, share: 0.10, max: 104)
    /// `.return-code { margin-top: 8px }`
    public static let codeSpaceAbove: CGFloat = 8
    /// `.app-status { top: 40svh }`
    public static let statusTopShare: CGFloat = 0.4
  }

  // MARK: legal.css

  public enum Legal {
    /// `.legal-main { padding: clamp(28px, 7svh, 64px) … 64px }`; under 760, 20 and 40.
    public static let mainSpaceAbove = Clamp(min: 28, share: 0.07, max: 64)
    public static let mainSpaceBelow: CGFloat = 64
    public static let tabletSpaceAbove: CGFloat = 20
    public static let tabletSpaceBelow: CGFloat = 40
    /// `.legal-doc { max-width: 68ch }`
    public static let measure: CGFloat = 68
    /// `.legal-nav { gap: 4px 20px }`
    public static let navGap: CGFloat = 20
    /// `.legal-text { gap: 14px; line-height: 1.65 }`
    public static let textGap: CGFloat = 14
    public static let lineHeight: Double = 1.65
    /// `.legal-h1 { font-size: clamp(2rem, 1.3rem + 2.6vw, 3rem); letter-spacing: -0.035em; line-height: 1.05 }`
    public static let h1Size: ThemeLength = .function(.clamp, [.rem(2), .operation(.add, .rem(1.3), .value(2.6, .vw)), .rem(3)])
    public static let h1Tracking: ThemeLength = .em(-0.035)
    public static let h1LineHeight: Double = 1.05
    public static let h1SpaceBelow: CGFloat = 4
    /// `.legal-h2 { margin-top: 22px; padding-top: 22px; letter-spacing: -0.02em }`;
    /// in the dialog 12 and 16.
    public static let h2SpaceAbove: CGFloat = 22
    public static let h2RuleSpace: CGFloat = 22
    public static let dialogH2SpaceAbove: CGFloat = 12
    public static let dialogH2RuleSpace: CGFloat = 16
    public static let h2Tracking: ThemeLength = .em(-0.02)
    /// `.legal-h3 { margin-top: 8px }`
    public static let h3SpaceAbove: CGFloat = 8
    /// `.legal-text ul { gap: 6px; padding-left: 1.3em }`
    public static let listGap: CGFloat = 6
    public static let listIndentEm: CGFloat = 1.3
    /// `.legal-text hr { margin: 10px 0 }`
    public static let ruleSpace: CGFloat = 10
    /// `.legal-contents { margin-top: 6px; padding: 14px 0 }`, its links 7 apart on touch.
    public static let contentsSpaceAbove: CGFloat = 6
    public static let contentsPadding: CGFloat = 14
    public static let contentsLinkPadding: CGFloat = 7
    public static let contentsLineHeight: Double = 1.5
    /// `.legal-table th, td { padding: 10px 12px }`, a block's 14 on a phone.
    public static let cellPadding = EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
    public static let blockPadding: CGFloat = 14
    public static let blockCellGap: CGFloat = 10
    /// `.legal-table td::before { margin-bottom: 2px }`
    public static let blockLabelGap: CGFloat = 2
    /// `.legal-contents ol { columns: 2 240px; column-gap: 40px; padding-left: 1.8em }`
    public static let contentsColumnGap: CGFloat = 40
    public static let contentsIndentEm: CGFloat = 1.8
    /// `.legal-dialog-links { margin-bottom: 12px }`, `a { gap: 5px }`, its glyph 13.
    public static let dialogLinksSpaceBelow: CGFloat = 12
    public static let dialogLinkGap: CGFloat = 5
    public static let dialogLinkIcon: CGFloat = 13
    /// `.terms-card { gap: 16px }`, `.terms-check { gap: 12px; line-height: 1.4 }`, its box 18.
    public static let termsGap: CGFloat = 16
    public static let checkGap: CGFloat = 12
    public static let checkLineHeight: Double = 1.4
    public static let checkBox: CGFloat = 18
    /// `.terms-check input { margin-top: 1px }`
    public static let checkSpaceAbove: CGFloat = 1
  }

  // MARK: signin.css

  public enum SignIn {
    /// `.signin-flow { gap: 8px }`, `.signin-step { gap: 12px }`.
    public static let flowGap: CGFloat = 8
    public static let stepGap: CGFloat = 12
    /// `@keyframes signin-step-in { from { transform: translateY(6px) } }`
    public static let stepRise: CGFloat = 6
    /// `.signin-step > .field-label { margin-bottom: -4px }`
    public static let labelPull: CGFloat = 4
    /// `.signin-title { letter-spacing: -0.005em; line-height: 1.3 }`
    public static let titleTracking: ThemeLength = .em(-0.005)
    public static let titleLineHeight: Double = 1.3
    /// `.signin-detail { max-width: 60ch; line-height: 1.5 }`
    public static let detailMeasure: CGFloat = 60
    public static let detailLineHeight: Double = 1.5
    /// `.signin-row { gap: 10px }`, the field's basis 240.
    public static let rowGap: CGFloat = 10
    public static let fieldBasis: CGFloat = 240
    /// `.signin-field-error { margin-top: 6px }`
    public static let errorSpaceAbove: CGFloat = 6
    /// `.signin-action { padding-block: 10px; line-height: 1.25 }`; waiting, 0.5.
    public static let actionPaddingBlock: CGFloat = 10
    public static let waitingOpacity: Double = 0.5
    /// `.signin-links { gap: 4px 20px; min-height: 24px }`; a link 36 tall on touch.
    public static let linksGap: CGFloat = 20
    public static let linksHeight: CGFloat = 24
    public static let linkHeight: CGFloat = 36
    /// `.handle-field-at { left: 14px }`, the field's words from 32.
    public static let atInset: CGFloat = 14
    public static let fieldLeading: CGFloat = 32
    /// `.handle-suggestions { top: calc(100% + 6px); max-height: min(296px, 50svh); padding: 6px }`
    public static let suggestionsSpaceAbove: CGFloat = 6
    public static let suggestionsMaxHeight: CGFloat = 296
    public static let suggestionsPadding: CGFloat = 6
    /// `.handle-suggestion { gap: 10px; min-height: 44px; padding: 6px 10px }`, marked: 2px of ink at its edge.
    public static let suggestionGap: CGFloat = 10
    public static let suggestionHeight: CGFloat = 44
    public static let suggestionPadding = EdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10)
    public static let suggestionMark: CGFloat = 2
    /// `.signin-identity { gap: 12px; min-height: 70px; padding: 12px 0 }`
    public static let identityGap: CGFloat = 12
    public static let identityHeight: CGFloat = 70
    public static let identityPadding: CGFloat = 12
    /// `.signin-identity-text { gap: 2px }`
    public static let identityTextGap: CGFloat = 2
    /// `.signin-bone--avatar` 44; `--name` 46% × 14; `--meta` 68% × 11, 3 above and below.
    public static let boneAvatar: CGFloat = 44
    public static let boneNameShare: CGFloat = 0.46
    public static let boneNameHeight: CGFloat = 14
    public static let boneMetaShare: CGFloat = 0.68
    public static let boneMetaHeight: CGFloat = 11
    public static let boneMargin: CGFloat = 3
    /// `@keyframes signin-pulse`: 1.6s, to half opacity.
    public static let pulseSeconds: Double = 1.6
    /// `.signin-wick { height: 2px; max-width: 420px }`
    public static let wickHeight: CGFloat = 2
    public static let wickMaxWidth: CGFloat = 420
    /// `.signin-wick:not([data-phase='waiting']) span { animation: signin-pulse 1.5s }`
    public static let wickPulseSeconds: Double = 1.5
    /// `.signin-host { gap: 12px; min-height: 60px; padding: 10px 0 }`
    public static let hostGap: CGFloat = 12
    public static let hostHeight: CGFloat = 60
    public static let hostPadding: CGFloat = 10
    /// The host row's ExternalLink, 15.
    public static let hostIcon: CGFloat = 15
    /// `.dialog.signin-how { width: min(600px, …) }`, `.signin-how-body { gap: 16px }`
    public static let howWidth: CGFloat = 600
    public static let howGap: CGFloat = 16
    /// `.signin-how-flow { gap: 6px; padding: 18px 0 }`, a stop 96 wide, its glyph a 40px circle.
    public static let howFlowGap: CGFloat = 6
    public static let howFlowPadding: CGFloat = 18
    public static let howStopWidth: CGFloat = 96
    public static let howGlyph: CGFloat = 40
    public static let howGlyphIcon: CGFloat = 18
    public static let howLinkWidth: CGFloat = 88
    public static let howLinkIcon: CGFloat = 14
    /// `.signin-how-link svg { padding: 4px }` on the dialog's ground.
    public static let howLinkIconPadding: CGFloat = 4
    /// `.signin-how-link::before { border-top: 1px dashed }`: a browser's dash, about 3.
    public static let howDash: CGFloat = 3
    /// `.signin-how-asks { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) }`
    public static let asksMinWidth: CGFloat = 200
    /// `.signin-how-asks { gap: 16px 28px }`, `h3 { margin-bottom: 8px; padding-bottom: 8px }`,
    /// `ul { gap: 7px }`, `li { gap: 8px; line-height: 1.4 }`, its glyph 14.
    public static let asksGap: CGFloat = 28
    public static let asksHeadSpace: CGFloat = 8
    public static let asksListGap: CGFloat = 7
    public static let asksItemGap: CGFloat = 8
    public static let asksLineHeight: Double = 1.4
    public static let asksIcon: CGFloat = 14
  }

  // MARK: accounts.css

  public enum Accounts {
    /// `.accounts-row { gap: 2px 12px }`, the name `line-height: 1.35; gap: 2px 8px`.
    public static let rowGap: CGFloat = 12
    public static let rowLineGap: CGFloat = 2
    public static let nameGap: CGFloat = 8
    public static let nameLineHeight: Double = 1.35
    /// `.accounts-row-current { gap: 6px }`
    public static let currentGap: CGFloat = 6
    /// `.accounts-row-handle svg` 12.
    public static let handleIcon: CGFloat = 12
    /// `.accounts-how-intro { margin-top: 4px }`
    public static let howIntroSpaceAbove: CGFloat = 4
    /// `.remembered { gap: 12px }`, the row's gap 4, the button's `gap: 12px; min-height: 68px; padding: 10px 0`.
    public static let rememberedGap: CGFloat = 12
    public static let rememberedRowGap: CGFloat = 4
    public static let rememberedOpenGap: CGFloat = 12
    public static let rememberedHeight: CGFloat = 68
    public static let rememberedPadding: CGFloat = 10
    public static let rememberedTextGap: CGFloat = 1
    public static let rememberedLineHeight: Double = 1.3
    public static let disabledOpacity: Double = 0.7
    /// `.remembered-chevron`, 16.
    public static let rememberedChevron: CGFloat = 16
    /// `.session-notices { top: 12px; width: min(560px, 100vw - 32px); gap: 8px }`
    public static let noticesTop: CGFloat = 12
    public static let noticesWidth: CGFloat = 560
    public static let noticesGap: CGFloat = 8
    /// `.session-notice { padding: 10px 10px 10px 16px; gap: 8px 12px }`, the danger rule 3.
    public static let noticePadding = EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 10)
    public static let noticeGap: CGFloat = 12
    public static let noticeDangerRule: CGFloat = 3
  }

  // MARK: composer.css (the language picker's suggestions)

  public enum LanguageList {
    /// `.lang-search .suggest-list { max-height: 16rem; overflow-y: auto }`:
    /// past it the suggestions scroll inside the list. A rem, so it grows
    /// with Dynamic Type as the rows' words do (LanguagePicker scales it).
    /// Six rows at the default size come to 252 and don't reach it.
    public static let maxHeight: CGFloat = 256
  }

  // MARK: settings.css

  public enum Settings {
    /// `.settings-index-item { gap: 12px; min-height: 64px; padding: 12px 0 }`, its text `gap: 2px`.
    public static let indexGap: CGFloat = 12
    public static let indexHeight: CGFloat = 64
    public static let indexPadding: CGFloat = 12
    public static let indexTextGap: CGFloat = 2
    /// `.settings-row { gap: 12px 40px }`, its text `gap: 2px`, the label's line 1.45.
    public static let rowGap: CGFloat = 12
    public static let rowColumnGap: CGFloat = 40
    public static let rowTextGap: CGFloat = 2
    public static let labelLineHeight: Double = 1.45
    /// `.settings-row-sample { margin-top: 4px }`
    public static let sampleSpaceAbove: CGFloat = 4
    /// `.settings-row-control { gap: 8px }`, a select 220–320 wide.
    public static let controlGap: CGFloat = 8
    public static let selectMinWidth: CGFloat = 220
    public static let selectMaxWidth: CGFloat = 320
    /// `.settings-section-body > .callout { margin: 16px 0 4px }`
    public static let calloutSpaceAbove: CGFloat = 16
    public static let calloutSpaceBelow: CGFloat = 4
    /// `.perm-codes { margin-top: 4px }`
    public static let codesSpaceAbove: CGFloat = 4
    /// `.sky-choices { gap: 16px 12px; max-width: 660px }`, a tile at least 118 (three to a row on a phone).
    public static let skyRowGap: CGFloat = 16
    public static let skyColumnGap: CGFloat = 12
    public static let skyMaxWidth: CGFloat = 660
    public static let skyMinWidth: CGFloat = 118
    /// `.sky-choice { gap: 8px }`, its swatch 64 tall (56 on a phone), radius 10, the words' line 1.3.
    public static let skyChoiceGap: CGFloat = 8
    public static let skySwatchHeight: CGFloat = 64
    public static let phoneSkySwatchHeight: CGFloat = 56
    public static let skySwatchRadius: CGFloat = 10
    public static let skyLineHeight: Double = 1.3
    public static let skyIcon: CGFloat = 20
    /// The chosen tile and swatch: `0 0 0 2px var(--bg), 0 0 0 4px var(--accent)`.
    public static let ringGap: CGFloat = 2
    public static let ringWidth: CGFloat = 2
    /// `.accent-choices { gap: 12px; max-width: 732px }`, a choice at least 112.
    public static let accentGap: CGFloat = 12
    public static let accentMaxWidth: CGFloat = 732
    public static let accentMinWidth: CGFloat = 112
    /// `.accent-choice { gap: 12px; min-height: 40px; padding: 0 2px 0 5px }`, 44 on a phone; its swatch 22.
    public static let accentChoiceGap: CGFloat = 12
    public static let accentChoiceHeight: CGFloat = 40
    public static let phoneAccentChoiceHeight: CGFloat = 44
    public static let accentSwatch: CGFloat = 22
    public static let accentPaddingLeading: CGFloat = 5
    public static let accentPaddingTrailing: CGFloat = 2

    /// settings.css's own sky tiles: each sky's wash written out, since every
    /// tile shows its own sky whatever the page's is.
    public static func skySwatch(_ choice: SkyChoice) -> (stops: [ThemeColor], angle: Double, ink: ThemeColor) {
      func c(_ css: String) -> ThemeColor { ThemeColor(css: css) ?? .transparent }
      let ink = c("#0f1b33")
      switch choice {
      case .clock: return ([c("#ffd8c4"), c("#b9d5ff"), c("#cbc5f4"), c("#22315f")], 120, ink)
      case .dawn: return ([c("#ffd8c4"), c("#e4ecff")], 180, ink)
      case .day: return ([c("#b9d5ff"), c("#e1edff")], 180, ink)
      case .dusk: return ([c("#cbc5f4"), c("#fbe9ee")], 180, ink)
      case .night: return ([c("#0e1a3a"), c("#22315f")], 180, c("#f2f5fc"))
      }
    }

    /// The clock tile's stops: `linear-gradient(120deg, … 0%, … 38%, … 68%, … 100%)`.
    public static let clockStops: [CGFloat] = [0, 0.38, 0.68, 1]
  }
}
#endif
