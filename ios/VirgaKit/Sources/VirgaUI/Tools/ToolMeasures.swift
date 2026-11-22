// Ports src/tools/tools.css (its measures)
// Ports src/share/share.css (its measures)
//
// The measures of the tools' stylesheet and the share dialog's, which
// ThemeKit doesn't read yet, each named once with the rule it comes from
// (Theme/Measures.swift says why). Lengths are points (CSS px).

#if canImport(UIKit)
import SwiftUI
import VirgaCore

extension Measure {
  public enum Tools {
    /// `.tools-sections { grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr)) }`
    public static let sectionMin: CGFloat = 360
    /// `.tools-section-head { gap: 2px }`
    public static let sectionHeadGap: CGFloat = 2
    /// `.tool-row { gap: 12px }`
    public static let rowGap: CGFloat = 12
    /// `.tool-row-icon` (the lucide glyph at 20, `margin-top: 1px`)
    public static let rowIcon: CGFloat = 20
    public static let rowIconSpaceAbove: CGFloat = 1
    /// `.tool-row-text { gap: 2px }`, `.tool-row-meta { margin-top: 2px }`
    public static let rowTextGap: CGFloat = 2
    /// `.tool-row-name { line-height: 1.35 }`
    public static let rowNameLineHeight: Double = 1.35
    /// `.tool-row-go` (the chevron at 16)
    public static let rowChevron: CGFloat = 16

    /// `.tool-statement { max-width: 820px; letter-spacing: -0.01em; line-height: 1.25 }`
    public static let statementMax: CGFloat = 820
    public static let statementTracking: ThemeLength = .em(-0.01)
    public static let statementLineHeight: Double = 1.25

    /// `.card--flush > .callout { margin: 14px 0 }`
    public static let flushCalloutSpace: CGFloat = 14

    /// `.filter-cards { grid-template-columns: repeat(auto-fit, minmax(min(100%, 168px), 1fr)); gap: 20px var(--space-6) }`
    public static let filterMin: CGFloat = 168
    public static let filterRowGap: CGFloat = 20
    /// `@media (max-width: 560px) { .filter-cards { column-gap: 20px } }`
    public static let phoneFilterColumnGap: CGFloat = 20
    /// `.filter-card { gap: 8px; padding: 16px 0 0; border-top: 2px }` (12 on a phone)
    public static let filterGap: CGFloat = 8
    public static let filterPaddingTop: CGFloat = 16
    public static let phoneFilterPaddingTop: CGFloat = 12
    public static let filterRule: CGFloat = 2
    /// `.filter-card-count { font-size: clamp(1.75rem, 20cqi, 2.75rem); letter-spacing: -0.04em; line-height: 1 }`
    public static let filterCountMin: CGFloat = 28
    public static let filterCountMax: CGFloat = 44
    public static let filterCountShare: CGFloat = 0.2
    /// `@media (max-width: 560px) { .filter-card-count { font-size: clamp(1.75rem, (100cqi - 20px) / 10, 2.75rem) } }`
    public static let phoneFilterCountShare: CGFloat = 0.1
    public static let filterCountTracking: ThemeLength = .em(-0.04)
    /// `.filter-card-hint { line-height: 1.35 }`
    public static let filterHintLineHeight: Double = 1.35

    /// `.table-bar { gap: 12px 32px; min-height: 44px; padding-bottom: 12px }`
    public static let tableBarRowGap: CGFloat = 12
    public static let tableBarColumnGap: CGFloat = 32
    public static let tableBarMinHeight: CGFloat = 44
    public static let tableBarSpaceBelow: CGFloat = 12
    /// `.table-bar-actions { gap: 12px 8px }`
    public static let tableBarActionsGap: CGFloat = 8
    public static let tableBarActionsLineGap: CGFloat = 12
    /// `.field-inline { gap: 8px }`
    public static let inlineFieldGap: CGFloat = 8
    /// `.field-inline .input { padding-left: 10px }`
    public static let inlineFieldPadding: CGFloat = 10
    /// `@media (max-width: 640px)`: a table with many columns is set as a list (`.table--stack`).
    public static let stackedTableMax: CGFloat = 640
    /// `@media (max-width: 640px) { .table--stack tbody tr { gap: 4px 0 } }`: a stacked row's lines.
    public static let stackedRowGap: CGFloat = 4
    /// A table row's error under its button (`.person-error`; the web runs it on
    /// beside the button, which the table's last column has no room for).
    public static let actionErrorGap: CGFloat = 2
    /// controls.css `input[type='checkbox'] { width: 16px; height: 16px }`, and
    /// `@media (max-width: 640px) { .cleanup-table .col-check input { width: 20px; height: 20px } }`
    public static let checkBox: CGFloat = 16
    public static let stackedCheckBox: CGFloat = 20
    /// `.col-check { width: 36px }`: the tick box's column, its padding in it.
    public static let checkColumn: CGFloat = 36
    /// `@media (min-width: 641px) { .cleanup-table td.col-main { width: 36%; max-width: 0 } }`
    public static let cleanupAccountShare: CGFloat = 0.36
    /// `.table-person { gap: 12px }`
    public static let personGap: CGFloat = 12
    /// `.activity { gap: 7px }`
    public static let activityGap: CGFloat = 7
    /// `.cleanup-table tbody tr { padding-left: 80px }` less the face's
    /// `margin-left: -46px`: the tick box's column on a phone.
    public static let phoneCheckColumn: CGFloat = 34
    /// `.table-scroll--bleed { margin: 0 -10px }`: a chosen row's tint let out past the sides.
    public static let selectedBleed: CGFloat = 10

    /// `.check-card { gap: … 32px }`, `.check-card-text { flex: 1 1 360px; max-width: 68ch }`
    public static let checkColumnGap: CGFloat = 32
    public static let checkRowGap: CGFloat = 14
    public static let checkTextMeasure: CGFloat = 68
    public static let checkTextBasis: CGFloat = 360
    /// `.check-actions, .check-progress { flex-wrap: wrap; gap: 10px 16px }`, `.check-progress .progress { width: 160px }`
    public static let checkActionsGap: CGFloat = 16
    public static let checkActionsRowGap: CGFloat = 10
    public static let checkProgressWidth: CGFloat = 160

    /// controls.css `.list-toolbar { gap: 12px 32px; margin-bottom: var(--space-4) }` (16 apart on a phone),
    /// `.list-toolbar > .search { flex: 1 1 240px; max-width: 420px }` (the whole line on a phone)
    public static let toolbarRowGap: CGFloat = 12
    public static let toolbarColumnGap: CGFloat = 32
    public static let phoneToolbarColumnGap: CGFloat = 16
    public static let toolbarSearchMin: CGFloat = 240
    public static let toolbarSearchMax: CGFloat = 420
    /// `.search--lg > svg { left: 16px; width: 18px }`, `.search--lg > .input { padding-left: 44px }`
    public static let largeSearchIconInset: CGFloat = 16
    public static let largeSearchIcon: CGFloat = 18
    public static let largeSearchLeading: CGFloat = 44

    /// `.change-group-head { padding: 18px 0 8px }`
    public static let changeHeadSpaceAbove: CGFloat = 18
    public static let changeHeadSpaceBelow: CGFloat = 8

    /// `.best-list li { gap: 16px }`, `.best-rank { width: 14px }`, `.best-posts { min-width: 56px }`
    public static let bestGap: CGFloat = 16
    public static let bestRank: CGFloat = 14
    public static let bestPosts: CGFloat = 56
    /// `@media (max-width: 560px) { .best-list li { gap: 2px 16px } }`: the slot over its posts.
    public static let phoneBestLineGap: CGFloat = 2
    /// `.best-days { padding-top: 14px }`
    public static let bestDaysSpaceAbove: CGFloat = 14
    /// `.best-table { max-height: 24rem }`
    public static let bestTableMaxHeight: CGFloat = 384
    /// charts.css `.an-tableview .table { width: auto; min-width: min(100%, 28rem) }`: the
    /// table as wide as the column up to this, which its three columns fit within.
    public static let bestTableWidth: CGFloat = 448
    /// charts.css `.an-tableview .table thead th { position: sticky; padding-top: 8px }`
    public static let stickyHeadSpaceAbove: CGFloat = 8
    /// `.report-split`: two columns from this wide (reports.css), one under it.
    public static let splitMin: CGFloat = 400

    /// `.identity-card { gap: 12px 16px }`, `.identity-name { letter-spacing: -0.01em; line-height: 1.25 }`
    public static let identityGap: CGFloat = 16
    public static let identityNameTracking: ThemeLength = .em(-0.01)
    public static let identityNameLineHeight: Double = 1.25

    /// `.kv-row { grid-template-columns: 160px …; gap: 12px; min-height: 48px; padding: 8px 0 }`
    public static let kvLabel: CGFloat = 160
    public static let kvGap: CGFloat = 12
    public static let kvMinHeight: CGFloat = 48
    public static let kvPadding: CGFloat = 8
    /// `.kv-row--inline { gap: 24px }`; in a list from 600 wide, the label column.
    public static let kvInlineGap: CGFloat = 24
    public static let kvWide: CGFloat = 600
    /// `@media (max-width: 560px) { .kv-row:not(.kv-row--inline) { padding: 10px 0 } }`
    public static let phoneKvPadding: CGFloat = 10
    /// `.kv-row dd { gap: 6px }`
    public static let kvValueGap: CGFloat = 6
    /// `CopyButton`: its glyph (`Copy size={16}`), and how long it says Copied
    /// (`setTimeout(() => setDone(false), 1500)`), in seconds.
    public static let copyGlyph: CGFloat = 16
    public static let copiedFor: Double = 1.5

    /// `.timeline { margin: 14px 0 0 3px }`, `.timeline-item { grid-template-columns: 104px …; gap: 12px; padding: 9px 0 9px 20px }`
    public static let timelineSpaceAbove: CGFloat = 14
    public static let timelineInset: CGFloat = 3
    public static let timelineDate: CGFloat = 104
    public static let timelineGap: CGFloat = 12
    public static let timelinePadding: CGFloat = 9
    public static let timelineLeading: CGFloat = 20
    /// `.timeline-item::before { top: 16px; left: -4px; width: 7px }`
    public static let timelineDot: CGFloat = 7
    public static let timelineDotTop: CGFloat = 16

    /// `.lookup-search { gap: 10px; max-width: 720px }`, `.lookup-start { max-width: 720px }`
    public static let lookupMax: CGFloat = 720
    public static let lookupSearchGap: CGFloat = 10
    /// `.lookup-options { top: calc(100% + 6px); max-height: 24rem; padding: 6px }`
    public static let optionsSpaceAbove: CGFloat = 6
    public static let optionsMaxHeight: CGFloat = 384
    public static let optionsPadding: CGFloat = 6
    /// `onBlur={() => setTimeout(() => setOpen(false), 120)}`: the suggestions
    /// close this long after the field lets go of the keyboard.
    public static let optionsCloseDelay: Double = 0.12
    /// `.lookup-option { gap: 10px; min-height: 44px; padding: 6px 10px }`
    public static let optionGap: CGFloat = 10
    public static let optionMinHeight: CGFloat = 44
    public static let optionPaddingV: CGFloat = 6
    public static let optionPaddingH: CGFloat = 10
    /// `.lookup-option-glyph { width: 24px }`
    public static let optionGlyph: CGFloat = 24
    /// `.lookup-status { max-width: 80ch }`
    public static let statusMeasure: CGFloat = 80
    /// `.lookup-pair { gap: 10px }`, `.lookup-pair > span { gap: 3px; min-width: 5ch }`
    public static let pairGap: CGFloat = 10
    public static let pairInnerGap: CGFloat = 3
    public static let pairMinWidth: CGFloat = 5
    /// The arrows at 13 (`ArrowDownLeft size={13}`).
    public static let pairArrow: CGFloat = 13
    /// `.lookup-legend { gap: 4px 14px }`
    public static let legendGap: CGFloat = 14
    /// `@media (max-width: 560px) { .card.lookup-start > .card-head > .lookup-legend { margin-top: 8px } }`
    public static let phoneLegendSpaceAbove: CGFloat = 8
    /// `.lookup-person { gap: 16px }`
    public static let personCardGap: CGFloat = 16
    /// `.lookup-person-top { flex-wrap: wrap; gap: 12px 16px }` with
    /// `.lookup-person-main { flex: 1 1 220px }`: the name block grows and
    /// pushes the actions to the column's edge, and they wrap under it when
    /// the line can't hold them beside its 220.
    public static let personTopGap: CGFloat = 16
    public static let personTopLineGap: CGFloat = 12
    public static let personMainBasis: CGFloat = 220
    /// `.report-split.lookup-top`: the totals beside the timeline from 1000 wide,
    /// `grid-template-columns: minmax(300px, 1fr) minmax(0, 2fr)`.
    public static let lookupTopSplit: CGFloat = 1000
    public static let lookupTopMin: CGFloat = 300
    /// `.lookup-total { gap: 8px }`, `.lookup-total-track { min-width: 12px; max-width: 120px; height: 4px }`
    public static let totalGap: CGFloat = 8
    public static let totalTrackMin: CGFloat = 12
    public static let totalTrackMax: CGFloat = 120
    public static let totalTrackHeight: CGFloat = 4
    /// `.lookup-total-n { min-width: 2.2em }`
    public static let totalNumberEm: CGFloat = 2.2
    /// `.lookup-event { grid-template-columns: 96px 22px …; gap: 2px 12px }`
    public static let eventDate: CGFloat = 96
    public static let eventGlyph: CGFloat = 22
    public static let eventGap: CGFloat = 12
    /// `.lookup-kind, .lookup-dir { gap: 6px }` and their glyphs at 14.
    public static let kindGap: CGFloat = 6
    public static let kindGlyph: CGFloat = 14
    /// `.lookup-cannot { max-width: 78ch }`, `.lookup-cannot-card .card-sub { margin-top: 6px }`
    public static let cannotMeasure: CGFloat = 78
    public static let cannotSpaceAbove: CGFloat = 6
    /// reports.css `.how-counted-body { gap: 8px; max-width: 72ch }`
    public static let howCountedGap: CGFloat = 8
    public static let howCountedMeasure: CGFloat = 72
    /// A person row's history link (`History size={15}`).
    public static let historyGlyph: CGFloat = 15
    /// `.queue-dismiss` (`X size={16}`).
    public static let dismissGlyph: CGFloat = 16
    /// A post row's count glyphs (`size={13}`).
    public static let countGlyph: CGFloat = 13
    /// A table link's arrow (`ExternalLink size={12}`; `.table-link { gap: 5px }`).
    public static let linkGlyph: CGFloat = 12
    public static let linkGap: CGFloat = 5

    // dashboards.css's person and post rows, as the tools list them.
    /// `.person-row { gap: 14px }` (10 on a phone), `.person-main { line-height: 1.35 }`
    public static let personRowGap: CGFloat = 14
    public static let phonePersonRowGap: CGFloat = 10
    public static let personLineHeight: Double = 1.35
    /// `@container rows (max-width: 599px)` drops "follows you" from a row with
    /// a fact of its own, `(max-width: 479px)` its handle too.
    public static let personMetaRelMin: CGFloat = 600
    public static let personMetaHandleMin: CGFloat = 480
    /// `.follow-button { min-width: 92px }` (none on a phone)
    public static let followMinWidth: CGFloat = 92
    /// `.post-row { gap: 14px }`, `.post-rank { width: 16px }`, `.post-main { gap: 4px }`
    public static let postRowGap: CGFloat = 14
    public static let postRank: CGFloat = 16
    public static let postMainGap: CGFloat = 4
    /// `.post-text { line-height: 1.4; -webkit-line-clamp: 2 }`
    public static let postTextLineHeight: Double = 1.4
    /// `.meta > .meta-group { gap: 12px }`, `.post-count { gap: 4px }` (the
    /// tools' rows narrow to no kind, so no count is dimmed).
    public static let countsGap: CGFloat = 12
    public static let countInnerGap: CGFloat = 4
  }

  public enum Share {
    /// `.dialog.share-dialog { width: min(640px, …) }`
    public static let dialogWidth: CGFloat = 640
    /// `.share { gap: 16px }`
    public static let gap: CGFloat = 16
    /// `.share-alt { min-height: 110px; line-height: 1.45 }`
    public static let altMinHeight: CGFloat = 110
    public static let altLineHeight: Double = 1.45
    /// The description's own limit (`maxLength={2000}`).
    public static let altMaxLength = 2000
  }
}
#endif
