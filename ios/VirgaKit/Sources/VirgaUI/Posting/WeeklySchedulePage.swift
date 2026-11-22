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
// there is nothing to press in its header. The focus after a time is taken
// off or a day cleared is the system's to place.

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

struct WeeklySchedulePage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let did: String?
  private let store: (any KeyValueStore)?
  @State private var settings: PostingSettingsModel
  /// The settings stopped as the page went: a new one when it comes back.
  @State private var settingsStopped = false
  @State private var load: ScheduledListLoad
  @State private var error = ""
  @State private var resetting = false
  @State private var repacking = false

  init(app: AppModel, did: String?) {
    self.did = did
    store = app.stores.keyValue
    _settings = State(
      initialValue: PostingSettingsModel(did: did, store: app.stores.keyValue, language: Locale.preferredLanguages.first))
    _load = State(
      initialValue: ScheduledListLoad(
        did: did, requester: app.session.backendFor(did), withLimits: false, events: [PostingEvents.scheduledChangedEvent]))
  }

  private var schedule: JSONValue { settings.settings.queue.json }

  var body: some View {
    let now = ScheduleText.now()
    let schedule = self.schedule
    let tz = PostingQueue.resolveTimezone(schedule)
    let device = ScheduleText.deviceZone
    let rows = load.list?.rows ?? []
    let queued = rows.filter { r in (r["queued"]?.isTruthy ?? false) && (r["status"] == "pending" || r["status"] == "publishing") }
    let off = (try? ScheduleModel.offScheduleRows(schedule, rows, now: now)) ?? []
    let suggestions = ScheduleSuggestions.read(
      archive: archive, did: did, schedule: schedule, enabled: settings.settings.suggestBestTimes)
    let empty = PostingQueue.isScheduleEmpty(schedule)
    let shippedOrEmpty = empty || ScheduleModel.isDefaultWeek(schedule)
    let showSuggestions =
      settings.settings.suggestBestTimes && suggestions.status == .ready && !suggestions.missing.isEmpty
    VirgaPage(
      PostingHeader.model(
        "schedule",
        crumbs: [
          Crumb("Posting", to: PostingRoutes.postingBase),
          Crumb("Scheduled posts", to: PostingRoutes.postingPageByKey["scheduled"]?.path ?? "/posting/scheduled"),
        ])
    ) {
      if !error.isEmpty {
        Callout(tone: .danger) { Text(error) }
          .accessibilityIdentifier("week-error")
      }
      if !tz.jsEquals(device) {
        zoneNotice(tz: tz, device: device)
      }
      if showSuggestions {
        suggestionsSection(suggestions, device: device, shippedOrEmpty: shippedOrEmpty)
      }
      ScheduleSplit(
        twoColumns: theme.windowWidth >= Measure.Schedule.weekTwoColumns, spacing: theme.gridGapX, rowGap: theme.gridGap
      ) {
        weekSection(tz: tz, device: device)
        side(now: now, queued: queued, rows: rows, off: off, empty: empty)
      }
    }
    .task {
      if settingsStopped {
        settings = PostingSettingsModel(did: did, store: store, language: Locale.preferredLanguages.first)
        settingsStopped = false
      }
      load.start()
    }
    .onDisappear {
      load.stop()
      settings.stop()
      settingsStopped = true
    }
    .scheduleActionDialog(
      isPresented: $resetting, title: "Start again from the default?", confirmLabel: "Use the default",
      onConfirm: {
        var reset: [String: JSONValue] = ["timezone": .string(settings.settings.queue.timezone.isEmpty ? device : settings.settings.queue.timezone)]
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
      try settings.update(["queue": queue])
      error = ""
    } catch {
      self.error = ScheduleText.message(error) ?? "That change couldn’t be saved."
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

  private func zoneNotice(tz: String, device: String) -> some View {
    Callout(tone: .warn) {
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .center, spacing: theme.space3) {
          zoneWords(tz: tz, device: device).frame(maxWidth: .infinity, alignment: .leading)
          useDevice(device)
        }
        VStack(alignment: .leading, spacing: theme.space3) {
          zoneWords(tz: tz, device: device)
          useDevice(device)
        }
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
        Button("Stop suggesting") { try? settings.update(["suggestBestTimes": false]) }
          .buttonStyle(.virga(.ghost, size: .small))
      }
      .padding(.top, theme.space3)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("week-suggestions")
  }

  // MARK: Posting times

  private func weekSection(tz: String, device: String) -> some View {
    let count = ScheduleModel.weeklyCount(schedule)
    return VirgaSection(
      title: "Posting times",
      sub: "\(count == 1 ? "1 time a week" : "\(count) times a week"). \(ScheduleModel.weekSummary(schedule))", flush: true
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
            day: day, times: settings.settings.queue.slots[day.key] ?? [],
            onAdd: { save(ScheduleModel.addSlot(schedule, day.key, .string($0), deviceZone: device)) },
            onRemove: { save(ScheduleModel.removeSlot(schedule, day.key, .string($0))) },
            onCopy: { save(ScheduleModel.copyDay(schedule, day.key, $0)) },
            onClear: { save(ScheduleModel.clearDay(schedule, day.key)) })
        }
      }
      .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("week-days")
      FlowLayout(spacing: theme.space3, lineSpacing: theme.space2) {
        Text("Saved as you go, in this browser.")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
        if !ScheduleModel.isDefaultWeek(schedule) {
          Button {
            resetting = true
          } label: {
            Label("Start again from the default", systemImage: ScheduleGlyph.restart)
          }
          .buttonStyle(.linkAction)
          .accessibilityIdentifier("week-reset")
        }
      }
      .padding(.top, theme.points(ThemeKit.cardFootSpaceAbove))
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("week-times")
  }

  // MARK: Beside the week

  private func side(now: Double, queued: [JSONValue], rows: [JSONValue], off: [JSONValue], empty: Bool) -> some View {
    VStack(alignment: .leading, spacing: theme.gridGap) {
      VirgaSection(title: "The week ahead", sub: "Open times over the next seven days.", flush: true) {
        // With no times there is no week to draw, and nothing in it that could be taken.
        if empty {
          EmptyState("No posting times yet.")
            .padding(.top, theme.space4)
        } else {
          let ready = load.status == .ready && load.list != nil
          QueueCalendarView(
            schedule: schedule, rows: queued.filter { $0["status"] == "pending" }, now: now, occupancy: ready,
            lead: ready ? lead(rows) : nil)
          if load.status == .error {
            FieldHint("Couldn’t read what’s already queued, so these may be taken.")
              .padding(.top, theme.space2)
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
      if !settings.settings.suggestBestTimes {
        ScheduleSwitch(
          label: "Suggest times from my best times", hint: "Uses the archive in this browser; nothing is sent anywhere.",
          isOn: false
        ) { on in try? settings.update(["suggestBestTimes": .bool(on)]) }
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

/// `DayRow`: one weekday's times as a band.
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

  private var long: String { ScheduleWeek.longDay[day.key] ?? day.label }

  var body: some View {
    let phone = theme.isPhone
    Group {
      if phone {
        VStack(alignment: .leading, spacing: Measure.Schedule.dayLineGap) {
          HStack(alignment: .center) {
            name
            Spacer(minLength: 0)
            menu
          }
          timesBand
        }
      } else {
        HStack(alignment: .firstTextBaseline, spacing: Measure.Schedule.dayColumnGap) {
          name.frame(width: Measure.Schedule.dayNameWidth, alignment: .leading)
          timesBand.frame(maxWidth: .infinity, alignment: .leading)
          menu.alignmentGuide(.firstTextBaseline) { d in d[.top] + d.height / 2 }
        }
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .sheet(isPresented: $copying) {
      CopyDaysDialog(day: day, onClose: { copying = false }) { days in
        copying = false
        onCopy(days)
      }
      .presentationDetents([.medium, .large])
      .presentationBackground(theme.surface)
      .presentationCornerRadius(Measure.Dialog.radius)
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
        Button {
          adding = true
        } label: {
          Image(systemName: ScheduleGlyph.plus)
        }
        .buttonStyle(.virga(.ghost, size: .small, icon: true))
        .help("Add a time on \(long)")
        .accessibilityLabel("Add a time on \(long)")
        .accessibilityIdentifier("week-add-\(day.key)")
      }
    }
  }

  /// `.sched-add`: the time, Add and Cancel.
  private var addForm: some View {
    HStack(spacing: Measure.Schedule.addGap) {
      DatePicker(
        "New time on \(long)",
        selection: Binding(get: { ClockTime.date(time) }, set: { time = ClockTime.text($0) }),
        displayedComponents: .hourAndMinute
      )
      .labelsHidden()
      .environment(\.timeZone, ClockTime.utc)
      .frame(minWidth: Measure.Schedule.addInputWidth, alignment: .leading)
      .accessibilityLabel("New time on \(long)")
      .accessibilityIdentifier("week-add-time")
      Button("Add") {
        guard !time.isEmpty else { return }
        onAdd(time)
        adding = false
      }
      .buttonStyle(.virga(.primary, size: .small))
      .keyboardShortcut(.defaultAction)
      .accessibilityIdentifier("week-add-confirm")
      Button("Cancel") { adding = false }
        .buttonStyle(.virga(.ghost, size: .small))
        .keyboardShortcut(.cancelAction)
    }
  }

  @ViewBuilder
  private var menu: some View {
    if !times.isEmpty {
      // The three common spans each take one press; any other days are
      // picked together in a small dialog. None carries an icon.
      let copies: [MenuEntry] =
        ScheduleModel.copyTargets.map { t -> MenuEntry in
          MenuEntry.item(MenuItem("Copy to \(t.label.lowercased())", key: t.key) { onCopy(t.days) })
        } + [MenuEntry.item(MenuItem("Copy to other days…", key: "other") { copying = true })]
      MoreMenu(
        label: "More for \(long)",
        entries: copies + [
          .separator, .item(MenuItem("Clear this day", key: "clear", systemImage: ScheduleGlyph.trash, destructive: true) { onClear() }),
        ])
    }
  }
}

/// `CopyDaysDialog`: the days to copy one day's times to, any number at once.
struct CopyDaysDialog: View {
  @Environment(\.virgaTheme) private var theme
  let day: QueueWeekday
  let onClose: () -> Void
  let onCopy: ([String]) -> Void
  @State private var days: [String] = []

  var body: some View {
    let others = ScheduleWeek.orderedWeekdays().filter { $0.key != day.key }
    DialogFrame(title: "Copy \(day.label)’s times", onClose: onClose) {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(others, id: \.key) { d in
          Toggle(
            d.label,
            isOn: Binding(
              get: { days.contains(d.key) },
              set: { on in
                if on { days.append(d.key) } else { days.removeAll { $0 == d.key } }
              })
          )
          .toggleStyle(.virgaCheck)
          .frame(minHeight: Measure.Schedule.copyDayHeight, alignment: .leading)
          .accessibilityIdentifier("copy-day-\(d.key)")
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Days to copy them to")
    } actions: {
      Button("Cancel", action: onClose)
        .buttonStyle(.virga)
      Button("Copy") { onCopy(days) }
        .buttonStyle(.virga(.primary))
        .disabled(days.isEmpty)
        .accessibilityIdentifier("copy-days-confirm")
    }
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
