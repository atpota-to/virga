// Ports src/posting/pages/hub.css (the overview's columns, nav and timed rows, the drafts' and posts' rows, the quote, the spinner)
// Ports src/posting/pages/schedule.css (the Timers page's rows and settled list, the timer dialog)
//
// The measures the overview, Drafts, Posted and Timers pages and the timer
// dialog draw from, each citing its rule. The Templates page's and the
// bones' are Measure.Templates; the timer editor's Measure.Lifespan.

#if canImport(UIKit)
import SwiftUI

extension Measure {
  enum Hub {
    // MARK: The overview (hub.css)

    /// `@media (max-width: 1180px) { .hub-columns { grid-template-columns: minmax(0, 1fr) } }`:
    /// two columns only wider than this.
    static let oneColumnMax: CGFloat = 1180
    /// `.hub-card > .needs-backend { padding-top: 16px }`
    static let noticeAbove: CGFloat = 16
    /// `.card--flush > .hub-error { margin-top: 16px }`
    static let errorAbove: CGFloat = 16

    // MARK: Rows (hub.css)

    /// `.hub-row { gap: 8px 16px }`
    static let rowRowGap: CGFloat = 8
    static let rowColumnGap: CGFloat = 16
    /// `.hub-row-main { gap: 4px }`
    static let rowLineGap: CGFloat = 4
    /// `.hub-row-text { font-size: var(--text-md); line-height: 1.4; -webkit-line-clamp: 2 }`, a draft's 3.
    static let rowTextLineHeight: Double = 1.4
    static let rowTextLines = 2
    static let draftTextLines = 3
    /// `.hub-row-note, .hub-row-why { font-size: var(--text-sm); line-height: 1.45 }`
    static let whyLineHeight: Double = 1.45
    /// `.hub-row[aria-busy='true'] { opacity: 0.6 }`
    static let busyOpacity: Double = 0.6
    /// `.hub-when { width: var(--time-col); line-height: 1.35 }`
    static let whenLineHeight: Double = 1.35
    /// On a phone, `.hub-when-day:not(:last-child)::after { content: '·'; margin: 0 6px }`
    static let whenDotMargin: CGFloat = 6
    /// `.hub-inline-action { text-decoration-thickness: 1px; text-underline-offset: 3px }`, its
    /// reach on a coarse pointer `inset: -12px -6px`.
    static let inlineReachVertical: CGFloat = 12
    static let inlineReachHorizontal: CGFloat = 6

    // MARK: Dialogs (hub.css)

    /// `.hub-confirm { gap: 12px }`
    static let confirmGap: CGFloat = 12
    /// `.hub-quote { padding: 2px 0 2px 14px; border-left: 2px solid var(--line-2) }`
    static let quoteInset: CGFloat = 14
    static let quoteRule: CGFloat = 2
    static let quotePadding: CGFloat = 2
    /// The draft's words a delete quotes (280) and the schedule dialog (200).
    static let deleteQuoteMax = 280
    static let scheduleQuoteMax = 200

    // MARK: The spinner (hub.css)

    /// `.hub-spinner { width: 14px; height: 14px; border: 2px solid; animation: hub-spin 0.8s linear infinite }`
    static let spinnerSize: CGFloat = 14
    static let spinnerLine: CGFloat = 2
    static let spinnerSeconds: Double = 0.8

    // MARK: Lists' lengths (the pages' own)

    /// DraftsPage.jsx `PAGE`, `MANY_DRAFTS`; HubPage.jsx's three drafts and five posts.
    static let draftsPage = 50
    static let manyDrafts = 50
    static let hubDrafts = 3
    static let hubPosts = 5
    static let hubDraftsRead = 100
    /// PostedPage.jsx `STEP`, and the author feed's page.
    static let postedStep = 30
    static let postedFeedPage = 50
    static let hubFeedPage = 10
    /// A draft's name in its labels (`text.slice(0, 40)`).
    static let draftName = 40

    // MARK: Timers (schedule.css)

    /// `.sched-rule { color: var(--ink-2); font-size: var(--text-sm) }`; `.sched-row-why` in --danger.
    /// `.sched-acted { gap: 2px; margin: 2px 0 0 }`, `.sched-acted li { gap: 6px }`, its glyph 13.
    static let actedGap: CGFloat = 2
    static let actedAbove: CGFloat = 2
    static let actedItemGap: CGFloat = 6
    static let actedGlyph: CGFloat = 13
    /// `.sched-page > .card-caption, .sched-page > .sched-settled { margin-top: calc(var(--section-gap) * -1 + var(--space-3)) }`:
    /// the page's closing lines sit `--space-3` under its last section.
    /// `.sched-settled > .hub-list { margin-top: var(--space-3); border-top: 1px solid var(--rule) }`
    static let settledRule: CGFloat = 1
    /// TimersPage.jsx: countdowns move on, and a due timer is looked for again, every 30 seconds,
    /// once it is 30 seconds past its check.
    static let timersTickSeconds: Double = 30
    static let timersDueSlackMs: Double = 30_000

    // MARK: The timer dialog (schedule.css)

    /// `.timer-dialog-body { gap: 14px }`
    static let timerBodyGap: CGFloat = 14
    /// `.sched-dialog-skeleton { gap: 10px }`, its button bones 32 tall.
    static let timerSkeletonGap: CGFloat = 10
    static let timerSkeletonBone: CGFloat = 32
    /// `.lse-sub { gap: 8px }`
    static let subGap: CGFloat = 8
    /// The snippet a timer dialog quotes (`slice(0, 280)`), and a call-off's (200).
    static let timerQuoteMax = 280
    static let cancelQuoteMax = 200
  }
}
#endif
