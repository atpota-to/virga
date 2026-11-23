// Ports src/posting/composer/composer.css (the composer's measures)
// Ports src/posting/posting.css (.composer-dialog's width)
//
// The measures composer.css writes as numbers, each citing its rule, as
// Theme/Measures.swift does for the shell's sheets.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

enum ComposerMeasure {
  /// `.dialog.composer-dialog { width: min(640px, 100vw - 32px) }`
  static let dialogWidth: CGFloat = 640
  /// `.composer { gap: 14px }`
  static let gap: CGFloat = 14
  /// `.composer-drop { border: 2px dashed var(--accent); background:
  /// color-mix(in srgb, var(--surface) 90%, transparent) }`. A browser draws
  /// a 2px dashed border in dashes about three times as long as it is wide;
  /// the padding is iOS's, room for the words to wrap on a narrow phone.
  static let dropBorder: CGFloat = 2
  static let dropDash: CGFloat = 6
  static let dropFillShare: Double = 0.9
  static let dropPadding: CGFloat = 16
  /// `.composer-dialog .dialog-body { padding-top: 6px }` over `.dialog-body
  /// { padding: 4px 24px 20px }`; a phone's `0 20px 20px`, with the bar's
  /// `margin-bottom: -6px` leaving 8 under it (the composer's gap less 6).
  static let phoneSide: CGFloat = 20
  static let side: CGFloat = 24
  static let bodyTop: CGFloat = 6
  static let phoneBodyTop: CGFloat = 8
  static let bodyBottom: CGFloat = 20
  /// `.post-block { gap: 10px }`, `.post-blocks { gap: 12px }`, a thread's
  /// post `padding-bottom: 18px`.
  static let blockGap: CGFloat = 10
  static let blocksGap: CGFloat = 12
  static let threadPostSpaceBelow: CGFloat = 18
  /// `.post-block::before { top: 4px; bottom: 4px; left: -14px; width: 2px }`
  /// (left −12 at 760 and under; down a thread, bottom 0, the last post's 18).
  static let sideLineInset: CGFloat = 4
  static let sideLineWidth: CGFloat = 2
  static let sideLineLead: CGFloat = 14
  static let phoneSideLineLead: CGFloat = 12
  /// `.post-problems { padding-left: 18px }`; `.split-offer { row-gap: 8px }`.
  static let problemsInset: CGFloat = 18
  static let splitOfferRowGap: CGFloat = 8
  /// `.post-block-head { min-height: 30px }`
  static let headHeight: CGFloat = 30
  /// `.post-editor-input { font-size: 1.25rem; font-weight: 500;
  /// letter-spacing: -0.012em; line-height: 1.4; min-height: 88px }`
  static let editorSize: CGFloat = 20
  static let editorWeight: Double = 500
  static let editorTracking: CGFloat = -0.012
  static let editorLineHeight: CGFloat = 1.4
  static let editorMinHeight: CGFloat = 88
  /// `.composer-options { gap: 2px 18px; padding-top: 10px }`, a rule in ink above.
  static let optionsRowGap: CGFloat = 2
  static let optionsGap: CGFloat = 18
  static let optionsTop: CGFloat = 10
  /// `.composer-option { gap: 6px; min-height: 32px }`, its picture 16
  /// (lucide's `size={16}`), a phone's chevron 15.
  static let optionGap: CGFloat = 6
  static let optionHeight: CGFloat = 32
  static let optionIcon: CGFloat = 16
  static let optionChevron: CGFloat = 15
  /// `.composer-options { padding-right: 40px }`: the room the ⋯ keeps.
  static let optionsMoreRoom: CGFloat = 40
  /// `.composer-more { position: absolute; top: 11px; right: -7px }`
  static let moreTop: CGFloat = 11
  static let moreRight: CGFloat = 7
  /// `.composer-options > .tags-field { padding: 6px 0 2px }`; a phone's
  /// `14px 0 16px`, on a hairline.
  static let tagsFieldTop: CGFloat = 6
  static let tagsFieldBottom: CGFloat = 2
  static let phoneTagsFieldTop: CGFloat = 14
  static let phoneTagsFieldBottom: CGFloat = 16
  /// A phone's `.composer-option { gap: 12px; min-height: 52px }`, and
  /// More's rows `.composer-option--sub { padding-left: 28px }`.
  static let phoneOptionGap: CGFloat = 12
  static let phoneOptionHeight: CGFloat = 52
  static let subRowInset: CGFloat = 28
  /// `.composer-timer-note { margin-top: -4px }`, under the composer's gap.
  static let noteLift: CGFloat = 4
  /// A phone's `.composer-options + .when-panel { padding-top: 4px; border-top: 0 }`
  static let whenPanelUnderRows: CGFloat = 4
  /// `.media-block { gap: 8px }`, `.image-grid { gap: 6px }`, `.image-tile {
  /// min-height: 96px; aspect-ratio: 4/3 }`, one picture's `16 / 9`, and
  /// `.image-missing { padding: 8px }`.
  static let mediaGap: CGFloat = 8
  static let gridGap: CGFloat = 6
  static let tileMinHeight: CGFloat = 96
  static let tileAspect: CGFloat = 4.0 / 3.0
  static let singleTileAspect: CGFloat = 16.0 / 9.0
  static let missingPadding: CGFloat = 8
  /// `.image-tile { --picture-scrim: rgb(15 27 51 / 0.72) }`, the one colour
  /// that isn't a token (over a picture).
  static let pictureScrim = ThemeColor(css: "rgb(15 27 51 / 0.72)") ?? .transparent
  /// `.image-alt { bottom: 8px; left: 8px; gap: 5px; padding: 0 10px;
  /// letter-spacing: 0.02em }`, 36 tall under a finger (`pointer: coarse`),
  /// its tick 12; `.image-tools { top: 8px; right: 8px; gap: 4px }`,
  /// `.image-tool` 36 under a finger, its picture 14, 0.4 while it can't run.
  static let altInset: CGFloat = 8
  static let altHeight: CGFloat = 36
  static let altPadding: CGFloat = 10
  static let altGap: CGFloat = 5
  static let altTick: CGFloat = 12
  static let altTracking: ThemeLength = .em(0.02)
  static let toolGap: CGFloat = 4
  static let toolSize: CGFloat = 36
  static let toolGlyph: CGFloat = 14
  static let toolOffOpacity: Double = 0.4
  /// `.video-block { gap: 10px }`, `.video-preview { max-height: 320px }`
  /// (`--missing` at least 120), `.video-meta { gap: 6px 10px }`,
  /// `.video-progress { flex: 1 1 120px }`.
  static let videoGap: CGFloat = 10
  static let videoMaxHeight: CGFloat = 320
  static let videoMissingHeight: CGFloat = 120
  static let videoMetaGap: CGFloat = 10
  static let videoMetaRowGap: CGFloat = 6
  static let videoBarMin: CGFloat = 120
  /// `.embed-card { gap: 12px; padding: 12px }`, `.link-thumb { 72 × 72 }`
  /// (56 at 420 and under), `.link-thumb--lg { 160 × 84 }`.
  static let embedGap: CGFloat = 12
  static let embedPadding: CGFloat = 12
  static let thumb: CGFloat = 72
  static let smallThumb: CGFloat = 56
  static let smallThumbWidth: CGFloat = 420
  static let thumbLarge: CGFloat = 160
  static let thumbLargeHeight: CGFloat = 84
  /// `.embed-icon { 40 × 40 }`, its glyph 18 (ImageOff's too);
  /// `.embed-text { gap: 2px; padding-right: 32px }`, `.embed-desc {
  /// line-height: 1.4 }`; `.embed-remove { top: 6px; right: 6px }`, a
  /// quoted post's preview `padding-right: 44px`; `.embed-tools { gap: 2px;
  /// margin: -4px -4px 0 0 }`.
  static let embedIcon: CGFloat = 40
  static let embedGlyph: CGFloat = 18
  static let embedTextGap: CGFloat = 2
  static let embedTextRoom: CGFloat = 32
  static let embedDescLineHeight: Double = 1.4
  static let embedRemoveInset: CGFloat = 6
  static let postEmbedRoom: CGFloat = 44
  static let embedToolsGap: CGFloat = 2
  static let embedToolsLift: CGFloat = 4
  /// `.gates-editor--full { gap: 14px }`, `.gates-group { gap: 6px }`,
  /// `.gates-rules { gap: 14px (a finger's); margin-top: 2px; padding: 4px
  /// 0 4px 14px; border-left: 1px }`.
  static let gatesEditorGap: CGFloat = 14
  static let gatesGroupGap: CGFloat = 6
  static let gatesRulesGap: CGFloat = 14
  static let gatesRulesTop: CGFloat = 2
  static let gatesRulesPad: CGFloat = 4
  static let gatesRulesInset: CGFloat = 14
  /// `.continue-list { gap: 8px }`
  static let continueGap: CGFloat = 8
  /// `.post-as-button { gap: 8px; min-height: 32px }`, its avatar 26,
  /// `.post-as-text { gap: 0 6px }`, `.post-as-note { margin-top: 2px }`;
  /// `.post-as-list { width: min(22rem, 100vw - 40px); padding: 6px }`,
  /// `.post-as-hint { padding: 6px 10px 8px; line-height: 1.4 }`,
  /// `.post-as-row { gap: 6px }`, `.post-as-option { min-height: 48px }`.
  static let postAsGap: CGFloat = 8
  static let postAsHeight: CGFloat = 32
  static let postAsAvatar: CGFloat = 26
  static let postAsTextGap: CGFloat = 6
  static let postAsNoteGap: CGFloat = 2
  static let postAsListWidth: CGFloat = 352
  static let postAsListMargin: CGFloat = 40
  static let postAsListPadding: CGFloat = 6
  static let postAsHintPadding = EdgeInsets(top: 6, leading: 10, bottom: 8, trailing: 10)
  static let postAsHintLineHeight: Double = 1.4
  static let postAsRowGap: CGFloat = 6
  static let postAsRowHeight: CGFloat = 48
  /// `.reply-context { gap: 6px }`
  static let replyGap: CGFloat = 6
  /// `.composer-busy { gap: 6px 12px }`, `.composer-actions { gap: 8px 12px }`
  /// (a phone's `column-gap: 8px`), `.composer-why { line-height: 1.35 }`
  /// (a phone's line of its own, `padding-right: 8px`).
  static let busyGap: CGFloat = 12
  static let actionsGap: CGFloat = 12
  static let actionsRowGap: CGFloat = 8
  static let phoneActionsGap: CGFloat = 8
  static let whyLineHeight: Double = 1.35
  static let phoneWhyTrailing: CGFloat = 8
  /// `.composer-also { gap: 8px }` (16 on a phone), `.btn.composer-also-draft
  /// { padding: 0 10px }` (0 on a phone), and Schedule's picture dropped in a
  /// foot of 350 or less (`@container composer-foot (max-width: 350px)`).
  static let alsoGap: CGFloat = 8
  static let phoneAlsoGap: CGFloat = 16
  static let draftPadding: CGFloat = 10
  static let footWordsOnly: CGFloat = 350
  /// `.composer-tools { margin-left: -12px }` on touch (their pictures on the
  /// dialog's edge), `.post-block-actions { margin-left: -7px }`; the foot's
  /// are the medium size with 20-point pictures, a post's the small with 17.
  static let footToolsLead: CGFloat = 12
  static let postToolsLead: CGFloat = 7
  static let footToolGlyph: CGFloat = 20
  static let postToolGlyph: CGFloat = 17
  /// `.publish-main { min-width: 88px }` (0 at 640 and under), its right
  /// padding 14 before the caret; `.publish-caret { width: 40px; padding:
  /// 0 4px 0 0; border-left: 1px solid color-mix(on-btn 28%) }`; a half that
  /// can't run keeps the ink, its words at 55%; their pictures are 16.
  static let publishMinWidth: CGFloat = 88
  static let publishMainTrailing: CGFloat = 14
  static let publishCaretWidth: CGFloat = 40
  static let publishCaretInset: CGFloat = 4
  static let publishSeam: CGFloat = 1
  static let publishSeamInk: Double = 0.28
  static let publishOffInk: Double = 0.55
  static let publishGlyph: CGFloat = 16
  /// `.composer-dialog .dialog-actions { padding: 12px 24px 16px }`; a
  /// phone's `8px 12px 10px 20px`.
  static let foot = EdgeInsets(top: 12, leading: 24, bottom: 16, trailing: 24)
  static let phoneFoot = EdgeInsets(top: 8, leading: 20, bottom: 10, trailing: 12)
  /// `.suggest-pop { margin-top: 6px }` (and `.post-editor-note`'s),
  /// `.suggest-list { padding: 6px }`, `.suggest-item { gap: 10px;
  /// min-height: 40px; padding: 6px 10px }`, `.suggest-text { line-height:
  /// 1.3 }`, `.suggest-status { padding: 12px 14px }`, `.suggest-foot {
  /// min-height: 42px; padding: 8px 16px }`; who to mention closes 150 ms
  /// after the field loses focus.
  static let suggestTop: CGFloat = 6
  static let suggestListPadding: CGFloat = 6
  static let suggestItemGap: CGFloat = 10
  static let suggestItemHeight: CGFloat = 40
  static let suggestItemPadding = EdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10)
  static let suggestLineHeight: Double = 1.3
  static let suggestStatusPadding = EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
  static let suggestFootHeight: CGFloat = 42
  static let suggestFootPadding = EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16)
  static let suggestCloseDelay: Double = 0.15
  /// The language suggestions close 120 ms after the field loses focus.
  static let languagesCloseDelay: Double = 0.12
  /// `.lang-search .suggest-list { position: absolute; top: calc(100% +
  /// 4px) }`: the language suggestions float 4 under the field.
  static let languagesListTop: CGFloat = 4
  /// How long after opening the first post takes the caret (Composer.jsx's 40 ms).
  static let focusDelay: Double = 0.04
  /// `.callout-actions { gap: 6px }`
  static let calloutActionsGap: CGFloat = 6
  /// `.composer-skeleton .post-block { gap: 12px; padding: 6px 0 4px }`,
  /// `.skeleton-line { height: 14px }` (`--short` 45%), `.skeleton-chip {
  /// 96 × 24 }`, `.composer-skeleton .composer-options { gap: 8px }`.
  static let skeletonLineGap: CGFloat = 12
  static let skeletonTop: CGFloat = 6
  static let skeletonBottom: CGFloat = 4
  static let skeletonLine: CGFloat = 14
  static let skeletonShortLine: CGFloat = 0.45
  static let skeletonChip = CGSize(width: 96, height: 24)
  static let skeletonChipGap: CGFloat = 8
  /// `.composer-bar { gap: 10px; min-height: 56px; padding: 6px 12px 6px 20px }`
  /// (the safe area's inset is the sheet's own), `.composer-bar-close {
  /// min-height: 44px; font-weight: 500 }`.
  static let barGap: CGFloat = 10
  static let barHeight: CGFloat = 56
  static let bar = EdgeInsets(top: 6, leading: 20, bottom: 6, trailing: 12)
  static let barCloseHeight: CGFloat = 44
}

extension VirgaTheme {
  /// composer.css `(max-width: 640px)`: the sheet fills the screen, with
  /// Close, its title and the send button in a bar held at the top.
  var composerNarrow: Bool { windowWidth <= Breakpoint.composer }
  /// composer.css `(max-width: 760px)`: the post's tools are in the foot,
  /// once, for the post being written in.
  var composerToolsInFoot: Bool { windowWidth <= Breakpoint.tablet }
}

#endif
