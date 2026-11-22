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
  /// `.composer-dialog .dialog-body { padding: 0 20px 20px }` on a phone.
  static let phoneSide: CGFloat = 20
  static let side: CGFloat = 24
  /// `.post-block { gap: 10px }`, `.post-blocks { gap: 12px }`, a thread's
  /// post `padding-bottom: 18px`.
  static let blockGap: CGFloat = 10
  static let blocksGap: CGFloat = 12
  static let threadPostSpaceBelow: CGFloat = 18
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
  /// `.image-grid { gap: 6px }`, `.image-tile { min-height: 96px; aspect-ratio: 4/3 }`
  static let gridGap: CGFloat = 6
  static let tileMinHeight: CGFloat = 96
  static let tileAspect: CGFloat = 4.0 / 3.0
  /// `.image-tile { --picture-scrim: rgb(15 27 51 / 0.72) }`, the one colour
  /// that isn't a token (over a picture).
  static let pictureScrim = ThemeColor(css: "rgb(15 27 51 / 0.72)") ?? .transparent
  /// `.image-alt { bottom: 8px; left: 8px; min-height: 28px; padding: 0 10px }`
  static let altInset: CGFloat = 8
  static let altHeight: CGFloat = 28
  static let altPadding: CGFloat = 10
  /// `.embed-card { gap: 12px; padding: 12px }`, `.link-thumb { 72 × 72 }`
  static let embedGap: CGFloat = 12
  static let embedPadding: CGFloat = 12
  static let thumb: CGFloat = 72
  static let thumbLarge: CGFloat = 160
  /// `.post-as-button { gap: 8px; min-height: 32px }`
  static let postAsGap: CGFloat = 8
  /// `.reply-context { gap: 6px }`
  static let replyGap: CGFloat = 6
  /// `.composer-busy { gap: 6px 12px }`, `.composer-actions { gap: 8px 12px }`
  static let busyGap: CGFloat = 12
  static let actionsGap: CGFloat = 12
  /// `.publish-main { min-width: 88px }`
  static let publishMinWidth: CGFloat = 88
  /// `.composer-dialog .dialog-actions { padding: 12px 24px 16px }`; a
  /// phone's `8px 12px 10px 20px`.
  static let foot = EdgeInsets(top: 12, leading: 24, bottom: 16, trailing: 24)
  static let phoneFoot = EdgeInsets(top: 8, leading: 20, bottom: 10, trailing: 12)
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
