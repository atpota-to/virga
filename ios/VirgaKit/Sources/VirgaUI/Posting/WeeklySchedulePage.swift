// Ports src/posting/pages/WeeklySchedulePage.jsx
// Ports src/posting/pages/schedule.css (.sched-week-layout, .sched-week, .sched-week-side, .sched-week-more, .sched-tz-field, .sched-days, .sched-day, .sched-day-name, .sched-day-times, .sched-day-none, .sched-day-menu, .sched-copy-days, .sched-add, .sched-add-input, .sched-week-foot, .sched-suggest, .sched-suggest-time, .sched-suggest-actions)
//
// The weekly schedule: the times each week a queued post goes out, the
// zone they're read in, the week ahead as a grid of what's open, and
// suggestions from the account's best times. Every change is saved as it's
// made, on this device. Posts already queued keep their times until the
// queue is moved onto the new ones. A day is one band: its name, its times
// as tokens with a + to add one after them, and a ⋯ to copy them or clear
// the day, offered only when there is something to copy or clear. From
// 1181 wide the week and what's beside it are two columns.
//
// The page is reached from Scheduled posts, so that is the way back up;
// there is nothing to press in its header. Adding a time takes the focus to
// the new time's field, and back to the + as the form closes; the focus
// after a time is taken off or a day cleared is the system's to place.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaPosting
import VirgaSession

/// The weekdays in the order the reader's week runs (Settings › Appearance),
/// and what each is called in full.
enum ScheduleWeek {
  /// `orderedWeekdays()`: weekOrder counts from Sunday as 0; WEEKDAYS starts on Monday.
  static func orderedWeekdays() -> [QueueWeekday] {
    AppLocale.weekOrder().map { PostingQueue.weekdays[($0 + 6) % 7] }
  }

  static let longDay = [
    "mon": "Mondays", "tue": "Tuesdays", "wed": "Wednesdays", "thu": "Thursdays", "fri": "Fridays",
    "sat": "Saturdays", "sun": "Sundays",
  ]

  /// `{ key: '1y', days: 365, label: 'Year' }`
  static let year = AnalyticsPeriod(key: "1y", days: 365, label: "Year")
}

/// `useSuggestions`: times suggested from the account's best times, when
/// the archive says enough.
struct ScheduleSuggestions {
  enum Status { case loading, none, ready }
  var status: Status
  var items: [QueueSuggestion] = []
  var missing: [QueueSuggestion] = []

  @MainActor
  static func read(archive: ArchiveModel?, did: String?, schedule: JSONValue, enabled: Bool) -> ScheduleSuggestions {
    guard enabled, let archive, archive.did.jsEquals(did ?? ""), archive.isBuilt else {
      return ScheduleSuggestions(status: archive?.data.loaded == true ? .none : .loading)
    }
    let model = ReportModels.bestTimeModel(ReportArchive(archive), year, archive.nowMs, block: 1)
    let items = QueueSuggestions.suggestionsFromBestTimes(model.best.map { (day: $0.day, col: $0.col) }, 1)
    if items.isEmpty { return ScheduleSuggestions(status: .none) }
    return ScheduleSuggestions(status: .ready, items: items, missing: QueueSuggestions.missingSuggestions(schedule, items))
  }

  static let year = ScheduleWeek.year
}

/// useSuggestions' `useMemo(…, [archive, did, schedule, enabled])`: the
/// year's best-time report is worked out again only when what it reads
/// changes, not on every redraw (each list answer, each sync step).
final class ScheduleSuggestionsMemo {
  struct Key: Equatable {
    var archive: ObjectIdentifier?
    var rev: Int
    var loaded: Bool
    var built: Bool
    var nowMs: Double
    var did: String?
    var schedule: JSONValue
    var enabled: Bool
  }

  var key: Key?
  var value = ScheduleSuggestions(status: .loading)
}

/// The height of a weekly schedule section's heading, for the two side by
/// side to share the taller one's.
struct WeekHeadHeight: PreferenceKey {
  static let defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = Swift.max(value, nextValue())
  }
}

/// A flush section of the weekly schedule: VirgaSection's heading, the rule
/// in ink under it, then what it holds. Side by side (`headHeight`), the
/// two sections' headings take the taller one's height, so the rules under
/// them line up however long the week's summary runs (the web's subgrid).
struct WeekSection<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let sub: String
  let headHeight: CGFloat?
  let content: Content

  init(title: String, sub: String, headHeight: CGFloat?, @ViewBuilder content: () -> Content) {
    self.title = title
    self.sub = sub
    self.headHeight = headHeight
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      SectionHead(title, sub: sub)
        .background(
          GeometryReader { geometry in
            Color.clear.preference(key: WeekHeadHeight.self, value: geometry.size.height)
          }
        )
        .frame(minHeight: headHeight, alignment: .top)
        .padding(.bottom, theme.points(ThemeKit.flushHeadSpaceBelow))
      Rectangle().fill(theme.color(ThemeKit.flushHeadRule)).frame(height: theme.points(ThemeKit.flushHeadRule))
      content
        .environment(\.virgaUnderRuledHead, true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct WeeklySchedulePage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let did: String?
  private let store: (any KeyValueStore)?
  /// The account's posting settings, heard while the page is up
  /// (usePostingSettings). Made in `.task`, not in init: SwiftUI makes the
  /// page again each time the shell redraws and keeps only the first, and a
  /// PostingSettingsModel listens from the moment it is made.
  @State private var settings: PostingSettingsModel? = nil
  /// The settings stopped as the page went: kept to draw from until a new
  /// one is made as it comes back.
  @State private var settingsStopped = false
  /// The settings as the store held them when the page was made, until the
  /// page listens.
  private let stored: PostingSettings
  @State private var load: ScheduledListLoad
  @State private var error = ""
  @State private var resetting = false
  @State private var repacking = false
  @State private var suggestionsMemo = ScheduleSuggestionsMemo()
  /// The taller of the two headings, side by side.
  @State private var headHeight: CGFloat = 0

  init(app: AppModel, did: String?) {
    self.did = did
    store = app.stores.keyValue
    stored = PostingSettingsStore.readPostingSettings(
      did, store: app.stores.keyValue, language: Locale.preferredLanguages.first.map(JSONValue.string))
    _load = State(
      initialValue: ScheduledListLoad(
        did: did, requester: app.session.backendFor(did), withLimits: false, events: [PostingEvents.scheduledChangedEvent]))
  }

  private var current: PostingSettings { settings?.settings ?? stored }
  private var schedule: JSONValue { current.queue.json }

  /// The listening model, for a change: the page's own, made now if it
  /// hasn't been yet.
  private func live() -> PostingSettingsModel {
    if let settings { return settings }
    let made = PostingSettingsModel(did: did, store: store, language: Locale.preferredLanguages.first)
    settings = made
    return made
  }

  /// useSuggestions, worked out again only when what it reads changes.
  private func suggestionsFor(_ schedule: JSONValue, enabled: Bool) -> ScheduleSuggestions {
    var key = ScheduleSuggestionsMemo.Key(
      archive: nil, rev: 0, loaded: false, built: false, nowMs: 0, did: did, schedule: schedule, enabled: enabled)
    if let archive {
      key.archive = ObjectIdentifier(archive)
      key.rev = archive.data.rev
      key.loaded = archive.data.loaded
      key.built = archive.isBuilt
      key.nowMs = archive.nowMs
    }
    if let known = suggestionsMemo.key, known == key { return suggestionsMemo.value }
    let value = ScheduleSuggestions.read(archive: archive, did: did, schedule: schedule, enabled: enabled)
    suggestionsMemo.key = key
    suggestionsMemo.value = value
    return value
  }

  var body: some View {
    let now = ScheduleText.now()
    let schedule = self.schedule
    let suggest = current.suggestBestTimes
    let tz = PostingQueue.resolveTimezone(schedule)
    let device = ScheduleText.deviceZone
    let rows = load.list?.rows ?? []
    let queued = rows.filter { r in (r["queued"]?.isTruthy ?? false) && (r["status"] == "pending" || r["status"] == "publishing") }
    let off = (try? ScheduleModel.offScheduleRows(schedule, rows, now: now)) ?? []
    let suggestions = suggestionsFor(schedule, enabled: suggest)
    let empty = PostingQueue.isScheduleEmpty(schedule)
    let shippedOrEmpty = empty || ScheduleModel.isDefaultWeek(schedule)
    let showSuggestions = suggest && suggestions.status == .ready && !suggestions.missing.isEmpty
    let twoColumns = theme.windowWidth >= Measure.Schedule.weekTwoColumns
    VirgaPage(
      PostingHeader.model(
        "schedule",
        crumbs: [
          Crumb("Posting", to: PostingRoutes.postingBase),
          Crumb("Scheduled posts", to: PostingRoutes.postingPageByKey["scheduled"]?.path ?? "/posting/scheduled"),
        ])
    ) {
      if !error.isEmpty {
        // `role="alert"`: read out as it appears and as it changes.
        Callout(tone: .danger, error)
          .accessibilityIdentifier("week-error")
      }
      if !tz.jsEquals(device) {
        zoneNotice(tz: tz, device: device)
      }
      if showSuggestions {
        suggestionsSection(suggestions, device: device, shippedOrEmpty: shippedOrEmpty)
      }
      ScheduleSplit(twoColumns: twoColumns, spacing: theme.gridGapX, rowGap: theme.gridGap) {
        weekSection(tz: tz, device: device, headHeight: twoColumns ? headHeight : nil)
        side(
          now: now, queued: queued, rows: rows, off: off, empty: empty, suggest: suggest,
          headHeight: twoColumns ? headHeight : nil)
      }
      .onPreferenceChange(WeekHeadHeight.self) { height in
        if headHeight != height { headHeight = height }
      }
    }
    .task {
      if settings == nil || settingsStopped {
        settings = PostingSettingsModel(did: did, store: store, language: Locale.preferredLanguages.first)
        settingsStopped = false
      }
      load.start()
    }
    .onDisappear {
      load.stop()
      settings?.stop()
      settingsStopped = true
    }
    .scheduleActionDialog(
      isPresented: $resetting, title: "Start again from the default?", confirmLabel: "Use the default",
      onConfirm: {
        let zone = current.queue.timezone
        var reset: [String: JSONValue] = ["timezone": .string(zone.isEmpty ? device : zone)]
        reset["slots"] = PostingQueue.defaultPostingQueue["slots"] ?? [:]
        save(.object(reset))
      }
    ) {
      Text(
        "The week goes back to weekdays at \(ScheduleModel.slotLabel("09:00")) and \(ScheduleModel.slotLabel("17:00")), in \(ScheduleModel.zoneLabel(tz)). Posts already queued keep their times."
      )
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("weekly-schedule-page")
  }

  // MARK: Saving

  private func save(_ queue: JSONValue?) {
    guard let queue else { return }
    do {
      try live().update(["queue": queue])
      error = ""
    } catch {
      let said = PostingPages.message(error)
      self.error = said.isEmpty ? "That change couldn’t be saved." : said
    }
  }

  private func repack() async {
    let at = ScheduleText.now()
    let rows = load.list?.rows ?? []
    let movable = QueueReorder.splitQueueRows(rows, now: at).movable.map { $0["id"] ?? .null }
    let plan: QueueReorderPlan
    do {
      plan = try QueueReorder.planQueueReorder(schedule, rows, movable, now: at)
    } catch {
      self.error = ScheduledPostError.scheduleErrorMessage(error)
      return
    }
    if let conflict = plan.conflict {
      error = conflict.message
      return
    }
    if plan.moves.isEmpty { return }
    repacking = true
    defer { repacking = false }
    do {
      let out = try await ScheduleService.reorderScheduled(load.requester, plan.moves)
      if !out.failed.isEmpty { throw out.refusal ?? ReorderPartial() }
      toasts?.push(
        plan.moves.count == 1
          ? "Moved 1 queued post onto the new times." : "Moved \(plan.moves.count) queued posts onto the new times.")
    } catch {
      self.error =
        error is ReorderPartial
        ? "Some queued posts couldn’t be moved. Scheduled posts shows where each one is."
        : ScheduledPostError.reorderRefusal(error) ?? ScheduledPostError.scheduleErrorMessage(error)
      load.reload()
    }
  }

  // MARK: Over the week

  /// `.callout.sched-message`: one row, the words (`flex: 1`) wrapping
  /// beside the button, the two centred on each other, 10 apart.
  private func zoneNotice(tz: String, device: String) -> some View {
    Callout(tone: .warn) {
      HStack(alignment: .center, spacing: theme.points(ThemeKit.calloutGap)) {
        zoneWords(tz: tz, device: device).frame(maxWidth: .infinity, alignment: .leading)
        useDevice(device)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("week-zone-notice")
  }

  private func zoneWords(tz: String, device: String) -> some View {
    Text(
      "Your week is set in \(ScheduleModel.zoneLabel(tz)), and this device is in \(ScheduleModel.zoneLabel(device)). Its times go out on \(ScheduleModel.zoneLabel(tz))’s clock."
    )
  }

  private func useDevice(_ device: String) -> some View {
    Button("Use \(ScheduleModel.zoneLabel(device))") { save(ScheduleModel.moveToZone(schedule, .string(device))) }
      .buttonStyle(.virga(size: .small))
      .accessibilityIdentifier("week-use-device-zone")
  }

  private func suggestionsSection(_ suggestions: ScheduleSuggestions, device: String, shippedOrEmpty: Bool) -> some View {
    let order = ScheduleWeek.orderedWeekdays().map(\.key)
    let sorted = suggestions.items.sorted { a, b in
      let da = order.firstIndex(of: a.dayKey) ?? -1
      let db = order.firstIndex(of: b.dayKey) ?? -1
      return da != db ? da < db : a.time.utf16.lexicographicallyPrecedes(b.time.utf16)
    }
    // Each day and time kept whole, so a line never breaks between an hour and its AM or PM.
    let times: [String] = sorted.map { s -> String in
      let day = PostingQueue.weekdays.first(where: { $0.key == s.dayKey })?.label ?? ""
      let whole = "\(day) \(ScheduleModel.slotLabel(s.time))"
      return whole.replacingOccurrences(of: " ", with: "\u{00A0}")
    }
    let tail = shippedOrEmpty ? " They can replace the starting times." : " They can be added beside your own."
    let zone = ScheduleModel.zoneLabel(device)
    let words = "From your posts over the last year, in \(zone) time: \(times.joined(separator: ", ")).\(tail)"
    return VStack(alignment: .leading, spacing: 0) {
      SectionHead("Times your posts have done well")
      Text(words)
        .virgaText(size: theme.points(ThemeKit.cardSubFontSize))
        .foregroundStyle(theme.color(ThemeKit.cardSubInk))
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: theme.measure, alignment: .leading)
        .padding(.top, theme.points(ThemeKit.cardSubSpaceAbove))
      FlowLayout(spacing: Measure.Schedule.suggestActionsGap, lineSpacing: Measure.Schedule.suggestActionsLineGap) {
        Button(shippedOrEmpty ? "Use these times" : "Add these times") {
          save(
            shippedOrEmpty
              ? QueueSuggestions.scheduleFromSuggestions(suggestions.items, device)
              : QueueSuggestions.mergeSuggestionsIntoSchedule(schedule, suggestions.missing))
        }
        .buttonStyle(.virga(size: .small))
        .accessibilityIdentifier("week-use-suggestions")
        Button("Stop suggesting") { try? live().update(["suggestBestTimes": false]) }
          .buttonStyle(.virga(.ghost, size: .small))
      }
      .padding(.top, theme.space3)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("week-suggestions")
  }

  // MARK: Posting times

  private func weekSection(tz: String, device: String, headHeight: CGFloat?) -> some View {
    let count = ScheduleModel.weeklyCount(schedule)
    return WeekSection(
      title: "Posting times",
      sub: "\(count == 1 ? "1 time a week" : "\(count) times a week"). \(ScheduleModel.weekSummary(schedule))",
      headHeight: headHeight
    ) {
      VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
        FieldLabel("Time zone")
        TimezoneSelect(value: tz, fill: true) { save(ScheduleModel.moveToZone(schedule, .string($0))) }
        FieldHint("The times below are read on this clock, wherever you are when they come round.")
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: Measure.Schedule.tzFieldMaxWidth, alignment: .leading)
      .padding(.vertical, Measure.Schedule.tzFieldPadding)
      VStack(alignment: .leading, spacing: 0) {
        ForEach(ScheduleWeek.orderedWeekdays(), id: \.key) { day in
          DayRow(
            day: day, times: current.queue.slots[day.key] ?? [],
            onAdd: { save(ScheduleModel.addSlot(schedule, day.key, .string($0), deviceZone: device)) },
            onRemove: { save(ScheduleModel.removeSlot(schedule, day.key, .string($0))) },
            onCopy: { save(ScheduleModel.copyDay(schedule, day.key, $0)) },
            onClear: { save(ScheduleModel.clearDay(schedule, day.key)) })
        }
      }
      .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("week-days")
      weekFoot
        .padding(.top, theme.points(ThemeKit.cardFootSpaceAbove))
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("week-times")
  }

  /// `.card-foot.sched-week-foot`: the words, and Start again from the
  /// default at the line's far end (`justify-content: space-between`), or
  /// under the words, 12 down, when the two don't fit on one line.
  @ViewBuilder
  private var weekFoot: some View {
    if ScheduleModel.isDefaultWeek(schedule) {
      footWords
    } else {
      ViewThatFits(in: .horizontal) {
        // `gap: var(--space-3)`: the spacer is the gap, at least 12, so the
        // line needs no more room than the web's does.
        HStack(alignment: .center, spacing: 0) {
          footWords
          Spacer(minLength: theme.space3)
          resetLink
        }
        VStack(alignment: .leading, spacing: theme.space3) {
          footWords
          resetLink
        }
      }
    }
  }

  private var footWords: some View {
    Text("Saved as you go, on this device.")
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
  }

  private var resetLink: some View {
    Button {
      resetting = true
    } label: {
      Label("Start again from the default", systemImage: ScheduleGlyph.restart)
    }
    .buttonStyle(.linkAction)
    .accessibilityIdentifier("week-reset")
  }

  // MARK: Beside the week

  private func side(
    now: Double, queued: [JSONValue], rows: [JSONValue], off: [JSONValue], empty: Bool, suggest: Bool, headHeight: CGFloat?
  ) -> some View {
    VStack(alignment: .leading, spacing: theme.gridGap) {
      WeekSection(title: "The week ahead", sub: "Open times over the next seven days.", headHeight: headHeight) {
        // With no times there is no week to draw, and nothing in it that could be taken.
        if empty {
          // EmptyState keeps the 16 under the rule itself.
          EmptyState("No posting times yet.")
        } else {
          let ready = load.status == .ready && load.list != nil
          QueueCalendarView(
            schedule: schedule, rows: queued.filter { $0["status"] == "pending" }, now: now, occupancy: ready,
            lead: ready ? lead(rows) : nil)
          if load.status == .error {
            // Straight under the caption (`p { margin: 0 }`).
            FieldHint("Couldn’t read what’s already queued, so these may be taken.")
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("week-ahead")
      if !off.isEmpty {
        VirgaSection(
          title: off.count == 1 ? "1 queued post is off these times" : "\(off.count) queued posts are off these times",
          sub:
            "Posts already in the queue keep the times they were given. Move them onto the week’s times, in the order they’re in now."
        ) {
          Button(repacking ? "Moving…" : "Move them onto these times") { Task { await repack() } }
            .buttonStyle(.virga(size: .small))
            .disabled(repacking || empty)
            .accessibilityIdentifier("week-repack")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("week-off")
      }
      if !suggest {
        ScheduleSwitch(
          label: "Suggest times from my best times", hint: "Uses the archive on this device; nothing is sent anywhere.",
          isOn: false
        ) { on in try? live().update(["suggestBestTimes": .bool(on)]) }
      }
    }
  }

  /// "1 post is in the queue, and 1 at a set time. See them."
  private func lead(_ rows: [JSONValue]) -> [ScheduleLinkedText.Piece] {
    let summary = PostingQueue.summarizeQueue(rows)
    let queued = summary.queuedCount == 1 ? "1 post is" : "\(summary.queuedCount) posts are"
    let atTime = summary.scheduledCount != 0 ? ", and \(summary.scheduledCount) at a set time" : ""
    return [
      .words("\(queued) in the queue\(atTime). "),
      .link("See them", to: PostingRoutes.postingPageByKey["scheduled"]?.path ?? "/posting/scheduled"), .words("."),
    ]
  }
}

/// `.sched-week-layout`: one column, the week first, until there is room
/// for two (the week 1.25 to the rest's 1).
struct ScheduleSplit: Layout {
  let twoColumns: Bool
  /// `gap: var(--grid-gap) var(--grid-gap-x)`: between the columns, and between the week and the rest under it.
  let spacing: CGFloat
  let rowGap: CGFloat

  private func widths(_ total: CGFloat) -> (CGFloat, CGFloat) {
    let share = Measure.Schedule.weekMainShare
    let room = Swift.max(0, total - spacing)
    let first = room * share / (share + 1)
    return (first, room - first)
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 0
    guard subviews.count == 2, twoColumns else {
      let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
      let height = sizes.reduce(0) { $0 + $1.height } + spacingBelow(sizes.count)
      return CGSize(width: width, height: height)
    }
    let (a, b) = widths(width)
    let first = subviews[0].sizeThatFits(ProposedViewSize(width: a, height: nil))
    let second = subviews[1].sizeThatFits(ProposedViewSize(width: b, height: nil))
    return CGSize(width: width, height: Swift.max(first.height, second.height))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard subviews.count == 2, twoColumns else {
      var y = bounds.minY
      for subview in subviews {
        let size = subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
        subview.place(at: CGPoint(x: bounds.minX, y: y), proposal: ProposedViewSize(width: bounds.width, height: size.height))
        y += size.height + rowGap
      }
      return
    }
    let (a, b) = widths(bounds.width)
    subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY), proposal: ProposedViewSize(width: a, height: nil))
    subviews[1].place(at: CGPoint(x: bounds.minX + a + spacing, y: bounds.minY), proposal: ProposedViewSize(width: b, height: nil))
  }

  private func spacingBelow(_ count: Int) -> CGFloat { count > 1 ? rowGap * CGFloat(count - 1) : 0 }
}

/// `DayRow`: one weekday's times as a band. Its + takes the focus to the
/// new time's field, and the focus comes back to the + as the form closes
/// (the web's `autoFocus` and `refocus`).
struct DayRow: View {
  @Environment(\.virgaTheme) private var theme
  let day: QueueWeekday
  let times: [String]
  let onAdd: (String) -> Void
  let onRemove: (String) -> Void
  let onCopy: ([String]) -> Void
  let onClear: () -> Void
  @State private var adding = false
  @State private var copying = false
  @State private var time = "09:00"
  /// CopyDaysDialog's ticks, cleared each time it opens.
  @State private var copyDays: [String] = []
  /// The form has just closed: the + takes the focus back as it returns.
  @State private var refocusAdd = false
  @FocusState private var focus: DayFocus?
  @AccessibilityFocusState private var spoken: DayFocus?

  /// What in the band takes the focus: the + or the new time's field.
  enum DayFocus: Hashable {
    case add, time
  }

  private var long: String { ScheduleWeek.longDay[day.key] ?? day.label }

  var body: some View {
    Group {
      if theme.isPhone {
        // A day: its name with the ⋯ beside it, then its times.
        VStack(alignment: .leading, spacing: Measure.Schedule.dayLineGap) {
          HStack(alignment: .center) {
            name
            Spacer(minLength: 0)
            // A phone's `.sched-day-menu { margin-block: -12px; margin-right: -14px }`.
            if !times.isEmpty {
              menu
                .padding(.vertical, -Measure.Schedule.phoneDayMenuReach)
                .padding(.trailing, -Measure.Schedule.phoneDayMenuOutset)
            }
          }
          timesBand
        }
      } else {
        // The name on the first token's baseline; the ⋯, which has none,
        // held to the first line's top (`align-self: start`), its 44-point
        // box let out 6 above and below the tokens' 32-point line.
        HStack(alignment: .top, spacing: Measure.Schedule.dayColumnGap) {
          HStack(alignment: .firstTextBaseline, spacing: Measure.Schedule.dayColumnGap) {
            name.frame(width: Measure.Schedule.dayNameWidth, alignment: .leading)
            timesBand.frame(maxWidth: .infinity, alignment: .leading)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          if !times.isEmpty {
            menu.padding(.vertical, -Measure.Schedule.dayMenuReach)
          }
        }
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .virgaDialog(isPresented: $copying, title: "Copy \(day.label)’s times") {
      copyChecks
    } actions: {
      Button("Cancel") { copying = false }
        .buttonStyle(.virga)
      Button("Copy") {
        let days = copyDays
        copying = false
        onCopy(days)
      }
      .buttonStyle(.virga(.primary))
      .disabled(copyDays.isEmpty)
      .accessibilityIdentifier("copy-days-confirm")
    }
    .onChange(of: copying) { _, open in
      if open { copyDays = [] }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("week-day-\(day.key)")
  }

  private var name: some View {
    Text(day.label)
      .virgaText(.textMd, weight: VirgaWeight.medium)
      .foregroundStyle(theme.ink)
      .accessibilityAddTraits(.isHeader)
  }

  private var timesBand: some View {
    TokenRow {
      if times.isEmpty && !adding {
        Text("No posting times")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
      }
      ForEach(times, id: \.self) { t in
        TokenView(ScheduleModel.slotLabel(t), removeLabel: "Remove \(ScheduleModel.slotLabel(t)) on \(long)") { onRemove(t) }
      }
      if adding {
        addForm
      } else {
        addButton
      }
    }
  }

  /// The +: a ghost icon whose 44-point box reaches 6 past the tokens'
  /// 32-point line above and below (`.sched-day-add { margin-block: -6px }`),
  /// so the line stays the tokens' height.
  private var addButton: some View {
    Button {
      adding = true
    } label: {
      Image(systemName: ScheduleGlyph.plus)
    }
    .buttonStyle(.virga(.ghost, size: .small, icon: true))
    .focused($focus, equals: .add)
    .accessibilityFocused($spoken, equals: .add)
    .onAppear {
      guard refocusAdd else { return }
      refocusAdd = false
      Task { @MainActor in
        focus = .add
        spoken = .add
      }
    }
    .padding(.vertical, -Measure.Schedule.dayAddReach)
    .help("Add a time on \(long)")
    .accessibilityLabel("Add a time on \(long)")
    .accessibilityIdentifier("week-add-\(day.key)")
  }

  /// The form is done with (Add, Cancel, Escape): the + comes back, and the focus with it.
  private func close() {
    refocusAdd = true
    adding = false
  }

  /// `.sched-add`: the time, Add and Cancel. The time takes the focus as it
  /// appears (`autoFocus`).
  private var addForm: some View {
    HStack(spacing: Measure.Schedule.addGap) {
      DatePicker(
        "New time on \(long)",
        selection: Binding(get: { ClockTime.date(time) }, set: { time = ClockTime.text($0) }),
        displayedComponents: .hourAndMinute
      )
      .labelsHidden()
      .environment(\.timeZone, ClockTime.utc)
      // The system's pill, at its own width, Add 8 after it. Its words
      // give no baseline the row can use, so its first baseline is put at
      // its foot: the line's baseline is then the tokens' (or Add's), and
      // the day's name stays on it (`.sched-day { align-items: baseline }`).
      .alignmentGuide(.firstTextBaseline) { $0[.bottom] }
      .focused($focus, equals: .time)
      .accessibilityFocused($spoken, equals: .time)
      .onAppear {
        Task { @MainActor in
          focus = .time
          spoken = .time
        }
      }
      .accessibilityLabel("New time on \(long)")
      .accessibilityIdentifier("week-add-time")
      Button("Add") {
        guard !time.isEmpty else { return }
        onAdd(time)
        close()
      }
      .buttonStyle(.virga(.primary, size: .small))
      .keyboardShortcut(.defaultAction)
      .accessibilityIdentifier("week-add-confirm")
      Button("Cancel") { close() }
        .buttonStyle(.virga(.ghost, size: .small))
        .keyboardShortcut(.cancelAction)
    }
  }

  /// The ⋯, offered only when the day has times to copy or clear.
  private var menu: some View {
    // The three common spans each take one press; any other days are
    // picked together in a small dialog. None carries an icon.
    let copies: [MenuEntry] =
      ScheduleModel.copyTargets.map { t -> MenuEntry in
        MenuEntry.item(MenuItem("Copy to \(t.label.lowercased())", key: t.key) { onCopy(t.days) })
      } + [MenuEntry.item(MenuItem("Copy to other days…", key: "other") { copying = true })]
    return MoreMenu(
      label: "More for \(long)",
      entries: copies + [
        .separator, .item(MenuItem("Clear this day", key: "clear", systemImage: HubGlyph.trash, destructive: true) { onClear() }),
      ])
  }

  /// `CopyDaysDialog`'s days: every other day of the week, one to a line,
  /// any number at once.
  private var copyChecks: some View {
    let others = ScheduleWeek.orderedWeekdays().filter { $0.key != day.key }
    return VStack(alignment: .leading, spacing: 0) {
      ForEach(others, id: \.key) { d in
        Toggle(
          d.label,
          isOn: Binding(
            get: { copyDays.contains(d.key) },
            set: { on in
              if on { copyDays.append(d.key) } else { copyDays.removeAll { $0 == d.key } }
            })
        )
        .toggleStyle(.virgaCheck)
        .frame(minHeight: Measure.Schedule.copyDayHeight, alignment: .leading)
        .accessibilityIdentifier("copy-day-\(d.key)")
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Days to copy them to")
  }
}

/// An 'HH:MM' time of day as a picker's Date (2000-01-03 at that time, in
/// UTC) and back.
enum ClockTime {
  static let utc = TimeZone(identifier: "UTC")!

  static var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = utc
    return calendar
  }

  static func date(_ hhmm: String) -> Date {
    let parts = hhmm.split(separator: ":").compactMap { Int($0) }
    let h = parts.count == 2 ? parts[0] : 9
    let m = parts.count == 2 ? parts[1] : 0
    return calendar.date(from: DateComponents(year: 2000, month: 1, day: 3, hour: h, minute: m)) ?? Date()
  }

  static func text(_ date: Date) -> String {
    let c = calendar.dateComponents([.hour, .minute], from: date)
    let h = c.hour ?? 0
    let m = c.minute ?? 0
    return "\(h < 10 ? "0" : "")\(h):\(m < 10 ? "0" : "")\(m)"
  }
}
#endif
