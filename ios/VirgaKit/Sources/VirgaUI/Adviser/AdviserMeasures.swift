// Ports src/posting/ui/adviser.css
//
// The post adviser's measures (the busy line, the sheet, the alt-text and
// style dialogs, the settings' rows), each citing its rule. The colours are
// the theme's tokens, read where they're drawn.

#if canImport(UIKit)
import SwiftUI

extension Measure {
  public enum Adviser {
    // MARK: The busy line

    /// `.adviser-busy { gap: 10px; padding: 2px 0 2px 14px; border-left: 2px solid var(--accent) }`
    public static let busyGap: CGFloat = 10
    public static let busyInset: CGFloat = 14
    public static let busyPadding: CGFloat = 2
    public static let busyRule: CGFloat = 2
    /// `.adviser-busy-head { gap: 10px }`, its icon 16 in a 20-tall cell, `.adviser-busy-text { gap: 1px }`.
    public static let busyHeadGap: CGFloat = 10
    public static let busyIcon: CGFloat = 16
    public static let busyIconHeight: CGFloat = 20
    public static let busyTextGap: CGFloat = 1
    /// `.adviser-busy-goals { gap: 6px }`, each `gap: 6px; padding: 2px 10px` in a pill.
    public static let goalsGap: CGFloat = 6
    public static let goalPadding = EdgeInsets(top: 2, leading: 10, bottom: 2, trailing: 10)
    /// `.adviser-busy-actions { gap: 8px }`; on a phone each takes an equal share, 44 tall.
    public static let busyActionsGap: CGFloat = 8
    public static let phoneBusyAction: CGFloat = 44

    // MARK: The sheet

    /// `.adviser-read { gap: 16px }`, the verdict `gap: 8px` with an 18-point glyph.
    public static let readGap: CGFloat = 16
    public static let verdictGap: CGFloat = 8
    public static let verdictIcon: CGFloat = 18
    /// `.adviser-draft { gap: 10px; padding-top: 12px }`, its meta `gap: 4px 12px`, its posts `gap: 12px`.
    public static let draftGap: CGFloat = 10
    public static let draftTop: CGFloat = 12
    public static let draftMetaGap: CGFloat = 12
    public static let draftPostsGap: CGFloat = 12
    /// `.adviser-draft-post { line-height: 1.6 }`, `.adviser-draft-index { margin-right: 8px }`.
    public static let draftLineHeight: Double = 1.6
    public static let draftIndexGap: CGFloat = 8
    /// `.adviser-draft-tally { gap: 8px; min-height: 30px }`
    public static let tallyGap: CGFloat = 8
    public static let tallyHeight: CGFloat = 30
    /// `.adviser-note-row { gap: 12px; padding: 11px 0 }`, the marker `min-width: 22px; height: 22px; padding: 0 4px`.
    public static let noteGap: CGFloat = 12
    public static let notePadding: CGFloat = 11
    public static let noteMarker: CGFloat = 22
    public static let noteMarkerPadding: CGFloat = 4
    public static let noteMarkerIcon: CGFloat = 13
    /// `.adviser-note-words { gap: 2px 8px; padding-top: 1px }`
    public static let noteWordsGap: CGFloat = 8
    public static let noteWordsLineGap: CGFloat = 2
    /// `.adviser-met { gap: 6px 10px }`, each `gap: 5px; padding: 2px 10px` with a 13-point tick.
    public static let metGap: CGFloat = 10
    public static let metRowGap: CGFloat = 6
    public static let metItemGap: CGFloat = 5
    public static let metIcon: CGFloat = 13
    /// `.adviser-context { gap: 6px }`, its glyph 14, 3 down.
    public static let contextGap: CGFloat = 6
    public static let contextIcon: CGFloat = 14
    /// `.adviser-empty { gap: 6px; padding: 8px 0 4px }`, its glyph 20, `max-width: 60ch`.
    public static let emptyGap: CGFloat = 6
    public static let emptyTop: CGFloat = 8
    public static let emptyBottom: CGFloat = 4
    public static let emptyIcon: CGFloat = 20
    public static let emptyMeasure: CGFloat = 60
    /// The skeleton: a verdict 45% × 18, lines 12 tall (the first 30%), chips 96 × 22.
    public static let skeletonVerdictShare: CGFloat = 0.45
    public static let skeletonVerdictHeight: CGFloat = 18
    public static let skeletonLineHeight: CGFloat = 12
    public static let skeletonShortShare: CGFloat = 0.30
    public static let skeletonChip = CGSize(width: 96, height: 22)
    /// `adviser-pulse 1.6s` to 50%; a mark shown lights for 1.6s.
    public static let pulseSeconds: Double = 1.6
    public static let pulseLow: Double = 0.5
    public static let markShownSeconds: Double = 1.6
    /// `.adviser-fix { padding: 1px 4px; border-radius: 4px }`
    public static let fixRadius: CGFloat = 4

    // MARK: The dialogs (alt text, style)

    /// `.alt-dialog-body, .style-body { gap: 16px }`
    public static let dialogBodyGap: CGFloat = 16
    /// `.alt-dialog-preview { max-height: 240px }` (180 on a phone).
    public static let altPreviewMax: CGFloat = 240
    public static let phoneAltPreviewMax: CGFloat = 180
    /// `.alt-kind, .alt-revise { gap: 8px }`, `.alt-revise { padding-top: 14px }`, `.alt-chips { gap: 6px }`.
    public static let altGroupGap: CGFloat = 8
    public static let altReviseTop: CGFloat = 14
    public static let altChipsGap: CGFloat = 6
    /// `.alt-dialog-text { min-height: 120px }`
    public static let altTextMin: CGFloat = 120
    /// `.style-start, .style-result { gap: 12px }`, `.style-actions { gap: 8px }`, `.style-intro { max-width: 65ch }`.
    public static let styleGap: CGFloat = 12
    public static let styleActionsGap: CGFloat = 8
    public static let styleIntroMeasure: CGFloat = 65
    /// `.style-progress { gap: 10px; padding: 4px 0 4px 14px }`, a dot 7 across, 10 from its words.
    public static let progressGap: CGFloat = 10
    public static let progressInset: CGFloat = 14
    public static let progressPadding: CGFloat = 4
    public static let progressDot: CGFloat = 7
    public static let nowPulseSeconds: Double = 1.2
    /// `textarea rows=6` for the description, `rows=2` for the goals and notes.
    public static let summaryRows: CGFloat = 6
    public static let notesRows: CGFloat = 2

    // MARK: The settings

    /// `.adviser-set-stack { gap: 14px }`, each held to 520 wide; the radios `gap: 10px`.
    public static let stackGap: CGFloat = 14
    public static let stackMax: CGFloat = 520
    public static let radiosGap: CGFloat = 10
    /// `.adviser-check { gap: 10px }`, its words `gap: 1px`, `.adviser-indent { padding-left: 26px }`.
    public static let checkGap: CGFloat = 10
    public static let checkTextGap: CGFloat = 1
    public static let indent: CGFloat = 26
    /// `.adviser-style { gap: 8px 24px; padding-top: 14px }`, its words at least 220.
    public static let styleRowGap: CGFloat = 24
    public static let styleRowTop: CGFloat = 14
    public static let styleWordsMin: CGFloat = 220
    /// `.adviser-sent-body { gap: 8px; margin-top: 10px; max-width: 72ch }`, its list `gap: 4px; padding-left: 18px`.
    public static let sentGap: CGFloat = 8
    public static let sentTop: CGFloat = 10
    public static let sentMeasure: CGFloat = 72
    public static let sentListGap: CGFloat = 4
    public static let sentListInset: CGFloat = 18
  }
}
#endif
