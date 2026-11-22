// Ports src/posting/library/library.css (the template editor, the questions and the preview)
// Ports src/posting/pages/hub.css (the Templates page's rows, and the bones a list loads under)
//
// The measures the templates' screens draw from, each citing its rule.
// The library panel's own (its shelves, list and detail) come with it.

#if canImport(UIKit)
import SwiftUI

extension Measure {
  public enum Templates {
    // MARK: The editor (library.css)

    /// `.tpl-form { gap: 18px }`
    public static let formGap: CGFloat = 18
    /// `.tpl-text-foot { gap: 8px 16px }`
    public static let footRowGap: CGFloat = 8
    public static let footColumnGap: CGFloat = 16
    /// `.tpl-blank-new { gap: 6px; padding: 2px 0 2px 14px; border-left: 2px solid var(--line-2) }`
    public static let newBlankGap: CGFloat = 6
    public static let newBlankInset: CGFloat = 14
    public static let newBlankRule: CGFloat = 2
    public static let newBlankPadding: CGFloat = 2
    /// `.tpl-row { gap: 8px }`, its field at least 160 wide.
    public static let rowGap: CGFloat = 8
    public static let rowFieldMin: CGFloat = 160
    /// `.tpl-blanks > legend { margin-bottom: 8px }`
    public static let legendSpaceBelow: CGFloat = 8
    /// `.tpl-blank { gap: 10px; padding: 14px 0 }`
    public static let blankGap: CGFloat = 10
    public static let blankPadding: CGFloat = 14
    /// `.tpl-blank-fields { gap: 10px 12px }`, side by side from 640 wide.
    public static let blankFieldsRowGap: CGFloat = 10
    public static let blankFieldsColumnGap: CGFloat = 12
    public static let blankFieldsSideBySide: CGFloat = 640
    /// `.tpl-attached`, `.tpl-posts { gap: 8px }`
    public static let attachGap: CGFloat = 8
    /// `.tpl-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 16px }`
    public static let gridMin: CGFloat = 220
    public static let gridGap: CGFloat = 16
    /// `.tpl-shortcut { gap: 6px }`
    public static let shortcutGap: CGFloat = 6
    /// `.tpl-actions { gap: 8px; padding: 14px 24px 20px }`, 12 18 16 at 560
    /// and under; `.tpl-actions-note { flex: 1 1 200px }`.
    public static let actionsGap: CGFloat = 8
    public static let actionsPadding = EdgeInsets(top: 14, leading: 24, bottom: 20, trailing: 24)
    public static let phoneActionsPadding = EdgeInsets(top: 12, leading: 18, bottom: 16, trailing: 18)
    public static let actionsNoteMin: CGFloat = 200
    /// `textarea rows=5`, and a choice question's `rows=3`.
    public static let textRows: CGFloat = 5
    public static let choicesRows: CGFloat = 3
    /// `POSTS_STEP`: recent posts to quote, five more at a time.
    public static let postsStep = 5

    // MARK: Questions and preview (library.css)

    /// `.lib-questions { gap: 16px }`, `.lib-question-list { gap: 14px }`, actions and answers `gap: 8px`.
    public static let questionsGap: CGFloat = 16
    public static let questionListGap: CGFloat = 14
    public static let questionsActionsGap: CGFloat = 8
    public static let answersGap: CGFloat = 8
    /// `.lib-choice { min-height: 40px; padding: 8px 4px 8px 12px }`, the picked one's 2px rule in the accent.
    public static let choiceHeight: CGFloat = 40
    public static let choicePadding = EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 4)
    public static let choiceRule: CGFloat = 2
    /// `.lib-preview { gap: 8px; padding: 12px 14px; border-radius: 12px }`, its words' line 1.45.
    public static let previewGap: CGFloat = 8
    public static let previewPadding = EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14)
    public static let previewRadius: CGFloat = 12
    public static let previewLineHeight: Double = 1.45
    /// `.lib-part--blank { padding: 0 5px; border-radius: 4px }`, `.lib-part--answer { border-radius: 3px }`.
    public static let blankPartPadding: CGFloat = 5
    public static let blankPartRadius: CGFloat = 4
    /// `.lib-preview-attach { gap: 2px; padding: 9px 12px }`
    public static let attachCardGap: CGFloat = 2
    public static let attachCardPadding = EdgeInsets(top: 9, leading: 12, bottom: 9, trailing: 12)
    /// `.lib-bone-card { gap: 8px }`, a bone 10 tall, a title's 12.
    public static let boneGap: CGFloat = 8
    public static let boneHeight: CGFloat = 10
    public static let titleBoneHeight: CGFloat = 12

    // MARK: The Templates page (hub.css)

    /// `.hub-row { gap: 8px 16px }`, `.hub-row-main { gap: 4px }`, the words' line 1.4.
    public static let rowColumnGap: CGFloat = 16
    public static let rowLineGap: CGFloat = 4
    public static let rowTextLineHeight: Double = 1.4
    /// `.tpl-name { gap: 8px }`
    public static let nameGap: CGFloat = 8
    /// `.tpl-chip { margin: 0 1px; padding: 0 6px; border-radius: 4px; line-height: 1.35 }`
    public static let chipPadding: CGFloat = 6
    public static let chipRadius: CGFloat = 4
    /// `.tpl-group-head { padding: 20px 0 8px }`
    public static let groupHeadAbove: CGFloat = 20
    public static let groupHeadBelow: CGFloat = 8
    /// `.hub-bone { height: 11px }`, `--meta` 8, `--button` 64 × 30; the rows' widths.
    public static let rowBoneHeight: CGFloat = 11
    public static let metaBoneHeight: CGFloat = 8
    public static let buttonBone = CGSize(width: 64, height: 30)
    public static let boneWidths: [CGFloat] = [0.88, 0.64, 0.76, 0.58, 0.70]
    public static let secondBoneWidths: [CGFloat] = [0.52, 0.40, 0.46]
    public static let metaBoneWidths: [CGFloat] = [0.30, 0.24, 0.34, 0.28]
    /// `hub-pulse 1.6s`: to 45% and back.
    public static let pulseSeconds: Double = 1.6
    public static let pulseLow: Double = 0.45
  }
}
#endif
