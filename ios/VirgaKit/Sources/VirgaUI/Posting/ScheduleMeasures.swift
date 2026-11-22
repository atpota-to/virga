// Ports src/posting/pages/schedule.css (the measures of the scheduled posts' page, the weekly schedule, the week ahead, the shared bits and the time picker)
//
// schedule.css's numbers, each named once with the rule it comes from, as
// Theme/Measures.swift does for the shell's sheets. The timer editor's are
// Measure.Lifespan (LifespanRuleEditor.swift); the timers' page and the
// timer dialog keep theirs with them.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

extension Measure {
  public enum Schedule {
    // MARK: The list

    /// `.sched-group-label { padding: 18px 0 8px }`
    public static let groupLabelAbove: CGFloat = 18
    public static let groupLabelBelow: CGFloat = 8
    /// `.sched-row { gap: 8px 16px }`; a phone's rows `row-gap: 4px`.
    public static let rowColumnGap: CGFloat = 16
    public static let rowLineGap: CGFloat = 8
    public static let phoneRowLineGap: CGFloat = 4
    /// `.sched-row.is-lit, .is-dragging { box-shadow: ±10px 0 0 … }`: the tint let out past the row's sides.
    public static let rowBleed: CGFloat = 10
    /// `.sched-row { transition: background-color 0.25s ease }`
    public static let litFadeSeconds: Double = 0.25
    /// ScheduledPage.jsx's `setTimeout(() => setLit(null), 2000)`.
    public static let litSeconds: Double = 2
    /// ScheduledPage.jsx's clock (`setInterval(…, 60_000)`), and its toasts'
    /// `{ ms: 9000 }` (Posted, with what didn't go to plan) and `{ ms: 7000 }` (Skipped).
    public static let clockSeconds: Double = 60
    public static let longToastSeconds: Double = 9
    public static let skipToastSeconds: Double = 7
    /// Composer.jsx's toasts: Scheduled… `{ ms: 8000 }`, what a post that went out couldn't do `{ ms: 10000 }`.
    public static let scheduledToastSeconds: Double = 8
    public static let warningToastSeconds: Double = 10
    /// WhenPicker.jsx's clock (`setInterval(…, 30_000)`).
    public static let pickerClockSeconds: Double = 30
    /// `.sched-row[aria-busy='true'] { opacity: 0.6 }`
    public static let busyOpacity: Double = 0.6
    /// `.sched-handle { width: 28px; height: 36px; margin: -6px -4px 0 -6px }`
    public static let handleWidth: CGFloat = 28
    public static let handleHeight: CGFloat = 36
    public static let handleLift: CGFloat = 6
    public static let handleLeading: CGFloat = 6
    public static let handleTrailing: CGFloat = 4
    /// From 900: `.sched-handle { top: calc(var(--row-pad) - 8px); left: -34px }`.
    public static let deskHandleRaise: CGFloat = 8
    public static let deskHandleOutset: CGFloat = 34
    /// `.sched-handle[aria-pressed='true'] { box-shadow: 0 0 0 2px var(--accent) }`
    public static let handleRing: CGFloat = 2
    /// `.sched-handle:disabled { opacity: 0.5 }`
    public static let handleDisabledOpacity: Double = 0.5
    /// The handle's grip (`<GripVertical size={16} />`) and the lock (`<Lock size={14} />`).
    public static let gripIcon: CGFloat = 16
    public static let lockIcon: CGFloat = 14
    /// `.sched-when-cell { gap: 2px; line-height: 1.4 }`; a phone's `line-height: 1.45`.
    public static let whenGap: CGFloat = 2
    public static let whenLineHeight: Double = 1.4
    public static let phoneWhenLineHeight: Double = 1.45
    /// A phone's `.sched-when-cell > :not(:last-child)::after { content: '·'; margin: 0 6px }`.
    public static let whenDotGap: CGFloat = 6
    /// A phone's `.sched-row.has-corner-menu > .sched-when-cell { padding-right: 40px }`.
    public static let cornerMenuRoom: CGFloat = 40
    /// A phone's `.sched-row > .row-actions { margin-top: 4px }`.
    public static let phoneActionsAbove: CGFloat = 4
    /// `.sched-row-reply { gap: 5px }`, its arrow `<CornerDownRight size={13} />`.
    public static let replyGap: CGFloat = 5
    public static let replyIcon: CGFloat = 13
    /// `.sched-steps { gap: 4px }`
    public static let stepsGap: CGFloat = 4
    /// hub.css: `.hub-row-main { gap: 4px }`, `.hub-row-text { font-size: var(--text-md); line-height: 1.4; -webkit-line-clamp: 2 }`.
    public static let mainGap: CGFloat = 4
    public static let rowTextLineHeight: Double = 1.4
    public static let rowTextLines = 2
    /// The words a question quotes (`.slice(0, 200)`), drawn by HubQuote (`.hub-quote`, Measure.Hub).
    public static let quoteMax = 200

    /// ScheduledPage.jsx's bone for the limits line, `style={{ width: 260 }}`.
    public static let limitsBoneWidth: CGFloat = 260

    // MARK: The week ahead

    /// `.sched-cal-grid { grid-template-columns: 52px repeat(7, minmax(0, 1fr)); gap: 14px 8px; max-width: 640px; padding: 18px 0 16px; line-height: 1.35 }`;
    /// a phone's time column `max-content` and `column-gap: 4px`.
    public static let calTimeColumn: CGFloat = 52
    public static let calRowGap: CGFloat = 14
    public static let calColumnGap: CGFloat = 8
    public static let phoneCalColumnGap: CGFloat = 4
    public static let calMaxWidth: CGFloat = 640
    public static let calPadTop: CGFloat = 18
    public static let calPadBottom: CGFloat = 16
    public static let calLineHeight: Double = 1.35
    /// `@container (min-width: 520px) { .sched-cal-head { flex-direction: row; gap: 4px } }`
    public static let calWideHead: CGFloat = 520
    public static let calHeadGap: CGFloat = 4
    /// `.sched-cal-mark { width: 12px; height: 12px; border: 1.5px solid }`
    public static let markSize: CGFloat = 12
    public static let markBorder: CGFloat = 1.5
    /// `.sched-cal-mark.is-off { border-style: dashed }`: the dash and its gap.
    public static let markDash: CGFloat = 2.5
    /// `.sched-cal-mark.is-lit { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent) }`
    public static let litGap: CGFloat = 2
    public static let litRing: CGFloat = 2
    /// `.sched-cal-pick { width: 28px; height: 28px; margin: -8px }`, reached out
    /// to a finger's 44 (`.sched-cal-pick::after { inset: -8px }`).
    public static let pickSize: CGFloat = 28
    /// `.sched-cal-caption { padding-top: var(--space-3); border-top: 1px solid var(--line) }`
    public static let captionRule: CGFloat = 1
    /// `.sched-cal-skeleton { gap: 0 12px; padding: 18px 0 16px }` (a phone's `gap: 0 4px`), `.hub-bone { height: 64px }`.
    public static let skeletonGap: CGFloat = 12
    public static let phoneSkeletonGap: CGFloat = 4
    public static let skeletonBoneHeight: CGFloat = 64

    // MARK: The weekly schedule

    /// `@media (min-width: 1181px) { .sched-week-layout { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) } }`
    public static let weekTwoColumns: CGFloat = 1181
    public static let weekMainShare: CGFloat = 1.25
    /// `.sched-tz-field { max-width: 420px; padding: 16px 0 }`
    public static let tzFieldMaxWidth: CGFloat = 420
    public static let tzFieldPadding: CGFloat = 16
    /// `.sched-day { grid-template-columns: 104px minmax(0, 1fr) auto; gap: 8px 16px }`
    public static let dayNameWidth: CGFloat = 104
    public static let dayColumnGap: CGFloat = 16
    public static let dayLineGap: CGFloat = 8
    /// `.sched-copy-days > .check { min-height: 36px }`, 44 on touch.
    public static let copyDayHeight: CGFloat = 44
    /// `.sched-add { gap: 8px }`, `.sched-add-input { width: 128px }`
    public static let addGap: CGFloat = 8
    public static let addInputWidth: CGFloat = 128
    /// `.sched-suggest-actions { gap: 12px 8px }`
    public static let suggestActionsGap: CGFloat = 8
    public static let suggestActionsLineGap: CGFloat = 12

    // MARK: Shared bits

    /// `.sched-switch { gap: 12px }`, `.sched-switch .switch { margin-top: 1px }`, `.sched-switch-text { gap: 2px }`
    public static let switchGap: CGFloat = 12
    public static let switchLift: CGFloat = 1
    public static let switchTextGap: CGFloat = 2
    /// `.sched-confirm { gap: 12px }`
    public static let confirmGap: CGFloat = 12

    // MARK: The time picker

    /// `.when-picker.sched-when { gap: 10px }`, `.sched-when-fields { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 10px }`
    public static let whenPickerGap: CGFloat = 10
    public static let whenFieldsGap: CGFloat = 10
    /// `@container when (max-width: 440px)`: the fields one under another.
    public static let whenNarrow: CGFloat = 440
    /// `.sched-picks { gap: 8px }`
    public static let picksGap: CGFloat = 8
    /// `.sched-repeat { gap: 6px; padding-top: 12px; border-top: 1px solid var(--line) }`,
    /// `.sched-repeat-fields { grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) minmax(0, 0.7fr); gap: 10px }`,
    /// `.sched-repeat .field-label { gap: 4px }` and its 13px glyph.
    public static let repeatGap: CGFloat = 6
    public static let repeatTop: CGFloat = 12
    public static let repeatFieldsGap: CGFloat = 10
    public static let repeatLabelGap: CGFloat = 4
    public static let repeatIcon: CGFloat = 13
    /// `.sched-when-queue { gap: 8px 10px; padding-top: 12px }`, its glyph `<ListTree size={16} />`.
    public static let queueGap: CGFloat = 10
    public static let queueLineGap: CGFloat = 8
    public static let queueTop: CGFloat = 12
    public static let queueIcon: CGFloat = 16

    // MARK: The composer's when panel (composer.css)

    /// `.when-panel { gap: 12px; padding-top: 16px; border-top: 1px solid var(--line) }`
    public static let panelGap: CGFloat = 12
    public static let panelTop: CGFloat = 16
    /// `.when-panel-head { gap: 4px 16px }`
    public static let panelHeadGap: CGFloat = 16
    public static let panelHeadLineGap: CGFloat = 4
    /// `.composer-timer-note { gap: 6px; margin-top: -4px }`, its glyph `<ListTree size={14} />`.
    public static let noteGap: CGFloat = 6
    public static let noteLift: CGFloat = 4
    public static let noteIcon: CGFloat = 14
  }
}
#endif
