// Ports src/posting/pages/ScheduledPage.jsx
// Ports src/posting/pages/schedule.css (.sched-page, .sched-message, .sched-groups, .sched-limits)
//
// Scheduled posts: what's waiting to go out for this account, in the weekly
// queue or at a time of its own. A timer that couldn't be set and a post
// that didn't go out come first, each in a section of its own; then the
// queue, with the week ahead as a calendar over it, in order (dragged by
// its handle, moved with the keys or VoiceOver's adjust, or with its arrows
// on a phone); then the posts at a set time; then the account's allowance.
// Each row's state and what can be done about it are scheduleModel's
// (ScheduledPageModel holds the page's state). The header holds the page's
// name and nothing to press: each way to add a post sits at the head of the
// list it adds to, and the weekly schedule is reached from the week it draws.
//
// Set a timer on a post whose timer couldn't be set opens the timer dialog
// (TimerDialog.jsx's PostTimerDialog, Posting/TimerDialog.swift); once the
// timer is set the page says so and the note is dismissed.
// useFocusAfterRemoval is the system's.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights
import VirgaPosting
import VirgaSession

struct ScheduledPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let did: String?
  @State private var model: ScheduledPageModel
  @State private var frames: [String: CGRect] = [:]
  /// Where a pick from the week puts the focus: the row's first button
  /// (`el.querySelector('button, a').focus()`), for a keyboard and for
  /// VoiceOver.
  @FocusState private var keyRow: String?
  @AccessibilityFocusState private var spokenRow: String?

  init(app: AppModel, did: String?) {
    self.did = did
    _model = State(
      initialValue: ScheduledPageModel(
        session: app.session, store: app.stores.keyValue, did: did, transport: app.archiveEnvironment.transport,
        clock: app.archiveEnvironment.clock))
  }

  var body: some View {
    ScrollViewReader { proxy in
      VirgaPage(PostingHeader.model("scheduled")) {
        notices
        if let notes = model.load.list?.timerNotes, !notes.isEmpty {
          timerNotesSection(notes)
        }
        let sections = model.sections
        if !sections.attention.isEmpty {
          attentionSection(sections.attention)
        }
        queueSection(sections.queue)
        VStack(alignment: .leading, spacing: theme.space3) {
          timedSection(sections.timed)
          limitsLine
        }
      }
      .onChange(of: model.scrollTarget) { _, target in
        guard let target else { return }
        withAnimation(theme.motion.control) { proxy.scrollTo(target, anchor: .center) }
        model.scrollTarget = nil
        if let row = model.focusRow {
          model.focusRow = nil
          keyRow = row
          spokenRow = row
        }
      }
    }
    .task { model.start() }
    .onDisappear { model.stop() }
    .onChange(of: model.announce) { _, words in
      if !words.isEmpty { UIAccessibility.post(notification: .announcement, argument: words) }
    }
    .modifier(ScheduledDialogs(model: model))
    .postTimerDialog(timerFor, did: did) { _ in
      Task { await model.timerArmed(toasts: toasts) }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("scheduled-page")
  }

  /// TimerDialog's post, set while a timer note's Set a timer is open.
  private var timerFor: Binding<PostTimerTarget?> {
    Binding(get: { model.timerFor }, set: { if $0 == nil { model.timerFor = nil } })
  }

  private var loading: Bool { model.load.status == .loading }

  // MARK: What's said over the lists

  @ViewBuilder
  private var notices: some View {
    if model.load.status == .error && model.load.list == nil {
      LoadError(
        message:
          "Couldn’t read \(model.name)’s scheduled posts. \(ScheduledPostError.scheduleErrorMessage(model.load.error))"
      ) { model.load.reload() }
    }
    if model.load.list?.unavailable == true {
      Callout(tone: .warn) {
        Text("Scheduling isn’t switched on at Virga’s server yet, so there’s nothing to show here.")
      }
      .accessibilityIdentifier("sched-unavailable")
    }
    if let message = model.message {
      // `role="alert"`. `.sched-message { align-items: center }`: the glyph,
      // the words and Dismiss centred on one another, 10 apart.
      Callout(tone: message.danger ? .danger : .warn, alert: message.text) {
        HStack(alignment: .center, spacing: theme.points(ThemeKit.calloutGap)) {
          Image(systemName: ScheduleGlyph.alert)
            .virgaGlyph(Measure.Section.calloutIcon, beside: theme.textSm)
            .accessibilityHidden(true)
          Text(message.text).frame(maxWidth: .infinity, alignment: .leading)
          Button("Dismiss") { model.message = nil }
            .buttonStyle(.virga(.ghost, size: .small))
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("sched-message")
    }
  }

  // MARK: A timer couldn't be set

  private func timerNotesSection(_ notes: [JSONValue]) -> some View {
    VirgaSection(
      title: "A timer couldn’t be set",
      sub: "These went out, but without the timer they were scheduled with. They stay up unless you set one or delete them.",
      flush: true
    ) {
      ForEach(notes.map { ScheduleListEntry(id: "row-\(ScheduleIds.key($0["id"]))", row: $0) }) { entry in
        if let row = entry.row {
          TimerNoteRow(row: row, model: model)
            .id("sched-row-\(ScheduleIds.key(row["id"]))")
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sched-notes")
  }

  // MARK: Didn't go out

  private func attentionSection(_ rows: [JSONValue]) -> some View {
    VirgaSection(title: "Didn’t go out", sub: "Retry sends it again as it is. Edit it to change it first.", flush: true) {
      ForEach(rows.map { ScheduleListEntry(id: "row-\(ScheduleIds.key($0["id"]))", row: $0) }) { entry in
        if let row = entry.row {
          ScheduledRowView(row: row, model: model, showDate: true, onEdit: edit)
            .id("sched-row-\(ScheduleIds.key(row["id"]))")
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sched-failed")
  }

  // MARK: Your queue

  private func queueSection(_ queueAll: [JSONValue]) -> some View {
    let schedule = model.schedule
    let empty = PostingQueue.isScheduleEmpty(schedule)
    let sub =
      empty
      ? "Posts added to the queue go out at the weekly schedule’s next open time."
      : "Posts go out in order, at the weekly schedule’s next open times.\(model.canReorder ? " Drag a post, or use its arrows, to change the order." : "")"
    return VirgaSection(
      title: "Your queue", sub: sub,
      trailing: AnyView(
        Button {
          open(["asDid": did.map(JSONValue.string) ?? .null, "mode": "queue"])
        } label: {
          Label("Add to queue", systemImage: ScheduleGlyph.listPlus)
        }
        .buttonStyle(.linkAction)
        .accessibilityIdentifier("sched-add-to-queue")),
      flush: true
    ) {
      if loading {
        CalendarSkeleton()
        RowSkeleton(rows: 3, actions: 1)
      } else if model.load.list != nil {
        if !empty {
          QueueCalendarView(
            schedule: schedule, rows: queueAll.filter { $0["status"] == "pending" }, now: model.now,
            onPick: { model.pick($0) }, highlight: model.lit,
            after: [.link("Change the times", to: PostingRoutes.postingPageByKey["schedule"]?.path ?? "/posting/schedule")])
        }
        if queueAll.isEmpty {
          queueEmpty(empty)
        } else {
          queueList(queueAll)
        }
        if model.busy.contains("reorder") {
          Text("Saving the new order…")
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
            .padding(.top, theme.points(ThemeKit.cardCaptionSpaceAbove))
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sched-queue")
  }

  @ViewBuilder
  private func queueEmpty(_ empty: Bool) -> some View {
    if empty {
      EmptyState(
        "Your week has no posting times yet. Set some, then add posts to the queue and they go out in turn.",
        actionTitle: "Set posting times"
      ) {
        navigate(PostingRoutes.postingPageByKey["schedule"]?.path ?? "/posting/schedule")
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("sched-queue-empty")
    } else {
      // EmptyState keeps the 16 under the section's rule itself.
      EmptyState("Nothing in the queue. Every time above is open: add a post and it takes the next one.")
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sched-queue-empty")
    }
  }

  /// One run of rows with the day names between them, so a row that changes
  /// day while it's moved stays the same view (and keeps its handle).
  private func queueList(_ rows: [JSONValue]) -> some View {
    let movable = model.movable
    let canReorder = model.canReorder
    let entries = ScheduleListEntry.entries(rows, tz: model.tz, now: model.now)
    return VStack(alignment: .leading, spacing: 0) {
      ForEach(entries) { entry in
        if let label = entry.label {
          DayLabel(label: label)
        } else if let row = entry.row {
          ScheduledRowView(
            row: row, model: model, reorder: canReorder ? reorder(row, movable: movable) : nil, frames: frames,
            focus: $keyRow, spoken: $spokenRow, onEdit: edit
          )
          .id("sched-row-\(ScheduleIds.key(row["id"]))")
        }
      }
    }
    .coordinateSpace(name: ScheduledRowView.space)
    .onPreferenceChange(QueueRowFrames.self) { next in frames = next }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sched-queue-list")
  }

  private func reorder(_ row: JSONValue, movable: [JSONValue]) -> RowReorder {
    let index = ScheduleIds.index(movable, row["id"])
    return RowReorder(
      movable: index != nil, first: index == 0, last: index == movable.count - 1,
      disabled: model.busy.contains("reorder"),
      active: model.drag.map { PostingPages.sameValue($0.id, row["id"]) } ?? false)
  }

  // MARK: At a set time

  private func timedSection(_ rows: [JSONValue]) -> some View {
    VirgaSection(
      title: "At a set time",
      sub: "Posts with a time of their own, replies and repeating posts among them. They don’t move when the queue does.",
      trailing: AnyView(
        Button {
          open(["asDid": did.map(JSONValue.string) ?? .null, "mode": "schedule"])
        } label: {
          Label("Schedule a post", systemImage: HubGlyph.schedule)
        }
        .buttonStyle(.linkAction)
        .accessibilityIdentifier("sched-schedule-a-post")),
      flush: true
    ) {
      if loading {
        RowSkeleton(rows: 2, actions: 1)
      } else if model.load.list != nil {
        if rows.isEmpty {
          EmptyState("Nothing scheduled for a set time. Write a post and choose Schedule to pick when it goes out.")
        } else {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(ScheduleListEntry.entries(rows, tz: model.tz, now: model.now)) { entry in
              if let label = entry.label {
                DayLabel(label: label)
              } else if let row = entry.row {
                ScheduledRowView(row: row, model: model, onEdit: edit)
                  .id("sched-row-\(ScheduleIds.key(row["id"]))")
              }
            }
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sched-timed")
  }

  @ViewBuilder
  private var limitsLine: some View {
    let line = ScheduleModel.scheduledLimitsLine(model.load.limits)
    if loading {
      LimitsBone()
    } else if !line.isEmpty {
      Text(line)
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("sched-limits")
    }
  }

  // MARK: Actions

  private func open(_ intent: JSONValue) {
    if let composer { composer.open(intent) } else { navigate("/posting/compose") }
  }

  /// `composer.open({ scheduledId, asDid })`.
  private func edit(_ row: JSONValue) {
    open(["scheduledId": row["id"] ?? .null, "asDid": did.map(JSONValue.string) ?? .null])
  }
}

/// The four questions before a row's action: remove (or dismiss), post now,
/// skip this one, stop repeating.
struct ScheduledDialogs: ViewModifier {
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let model: ScheduledPageModel
  /// The question last asked. `model.confirm` goes nil as a sheet starts to
  /// slide away, and the sheet is still drawn until it has gone; its words
  /// come from this, so they don't change under it (the web unmounts the
  /// dialog's content at once).
  @State private var asked: ScheduledConfirm? = nil

  private func shown(_ kind: ScheduledConfirm.Kind) -> Binding<Bool> {
    Binding(
      get: { model.confirm?.kind == kind },
      set: { if !$0, model.confirm?.kind == kind { model.confirm = nil } })
  }

  private var row: JSONValue? { (model.confirm ?? asked)?.row }
  private var failed: Bool { row?["status"] == "failed" }
  private var text: String { row.map { ScheduleModel.rowFacts($0, now: model.now).text } ?? "" }
  private var series: RowRepeat? { row.map { Repeat.rowRepeat($0, now: ScheduleText.now()) } }
  private var when: String {
    row.map { ScheduleModel.formatInZone($0["scheduledFor"], model.tz, now: model.now) } ?? ""
  }

  @MainActor
  private func run() async throws {
    guard let ask = model.confirm else { return }
    try await model.run(ask, toasts: toasts)
  }

  // The questions' sentences, worked out apart from the dialogs that say them.

  private var cancelWords: String {
    let repeats = series?.repeats == true ? " It stops repeating too: nothing follows it." : ""
    return "It won’t go out, and Virga’s server deletes its copy, images included.\(repeats) This can’t be undone."
  }

  private var postNowWords: String {
    let timer = row.map { !ScheduleModel.rowFacts($0, now: model.now).timer.isEmpty } ?? false
    let takesPlace = row?["status"] == "pending" && series?.repeats == true
    let timerWords = timer ? " Its timer starts now." : ""
    let placeWords = takesPlace ? " It takes the place of this one; the next still goes out at its time." : ""
    return
      "It goes out at once as \(model.name), with the settings it was scheduled with, and comes off the schedule.\(timerWords)\(placeWords)"
  }

  private var skipWords: String {
    if series?.last == true {
      return "This one doesn’t go out. It’s the last, so the post stops repeating and Virga’s server deletes its copy."
    }
    return "The one due \(when) doesn’t go out. The next one takes its place, at its usual time."
  }

  private var stopWords: String {
    if failed { return "Nothing follows this one. It stays here to retry or dismiss." }
    return "It still goes out \(when), once, and nothing follows it. To take this one off too, remove it instead."
  }

  func body(content: Content) -> some View {
    content
      .onChange(of: model.confirm) { _, next in
        if let next { asked = next }
      }
      .scheduleActionDialog(
        isPresented: shown(.cancel), title: failed ? "Dismiss this post?" : "Remove this scheduled post?",
        confirmLabel: failed ? "Dismiss" : "Remove", busyLabel: "Removing…", danger: true, onConfirm: run
      ) {
        Text(cancelWords)
        if !text.isEmpty { HubQuote(text: text.jsSlice(0, Measure.Schedule.quoteMax)) }
      }
      .scheduleActionDialog(
        isPresented: shown(.now), title: "Post this now?", confirmLabel: "Post now", busyLabel: "Posting…", onConfirm: run
      ) {
        Text(postNowWords)
        if !text.isEmpty { HubQuote(text: text.jsSlice(0, Measure.Schedule.quoteMax)) }
      }
      .scheduleActionDialog(
        isPresented: shown(.skip), title: "Skip this one?", confirmLabel: "Skip it", busyLabel: "Skipping…", onConfirm: run
      ) {
        Text(skipWords)
        if !text.isEmpty { HubQuote(text: text.jsSlice(0, Measure.Schedule.quoteMax)) }
      }
      .scheduleActionDialog(
        isPresented: shown(.stop), title: "Stop this post repeating?", confirmLabel: "Stop repeating", busyLabel: "Stopping…",
        onConfirm: run
      ) {
        Text(stopWords)
        if !text.isEmpty { HubQuote(text: text.jsSlice(0, Measure.Schedule.quoteMax)) }
      }
  }
}
/// The allowance line's bone while the list is read: a plain `.hub-bone`
/// (11 tall, 260 wide), pulsing as every bone does (still under Reduce
/// Motion).
struct LimitsBone: View {
  @Environment(\.virgaTheme) private var theme
  @State private var dim = false

  var body: some View {
    RoundedRectangle(cornerRadius: theme.radiusSm)
      .fill(theme.line)
      .frame(width: Measure.Schedule.limitsBoneWidth, height: Measure.Templates.rowBoneHeight)
      .opacity(dim ? Measure.Templates.pulseLow : 1)
      .onAppear {
        guard !theme.reduceMotion else { return }
        withAnimation(.easeInOut(duration: Measure.Templates.pulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
      }
      .accessibilityHidden(true)
  }
}
#endif
