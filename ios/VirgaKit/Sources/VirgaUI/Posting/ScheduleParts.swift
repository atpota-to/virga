// Ports src/posting/pages/scheduleParts.jsx
// Ports src/posting/pages/hubParts.jsx (useLoad, as the scheduling pages read the list)
// Ports src/posting/pages/schedule.css (.sched-cal, .sched-cal-grid, .sched-cal-time, .sched-cal-day, .sched-cal-head, .sched-cal-mark, .sched-cal-pick, .sched-cal-caption, .sched-cal-skeleton, .sched-tz, .sched-switch, .sched-confirm)
//
// What the scheduled posts' page, the weekly schedule and Settings ›
// Posting share: the time-zone picker (TimezoneSelect), a switch with its
// words (ScheduleSwitch), the week ahead as a calendar (QueueCalendarView),
// the question before an action (`.scheduleActionDialog`, which the
// Timers page asks too; a post it quotes is HubQuote, Posting/HubParts.swift),
// and the list's read (ScheduledListLoad, hubParts' useLoad over
// listScheduled, read again whenever a scheduling or timer event names the
// account).
//
// Differences: SwitchButton is Settings' SettingsSwitch; useFocusAfterRemoval
// is the system's (VoiceOver moves on to what took the row's place by
// itself); a link inside a caption is a link in its run of words, which the
// page's navigator follows.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights
import VirgaNetwork
import VirgaPosting

/// The scheduling pages' icons (lucide's names, as SF Symbols). Those the
/// other posting pages draw too (Send, CalendarClock, Repeat, Trash2) are
/// HubGlyph's.
enum ScheduleGlyph {
  static let alert = "exclamationmark.triangle"  // AlertTriangle
  static let up = "arrow.up"  // ArrowUp
  static let down = "arrow.down"  // ArrowDown
  static let ban = "nosign"  // Ban
  static let replyingTo = "arrow.turn.down.right"  // CornerDownRight
  // GripVertical has no SF Symbol: it is drawn (GripVerticalGlyph).
  static let hourglass = "hourglass"  // Hourglass
  static let listPlus = "text.badge.plus"  // ListPlus
  static let listTree = "list.bullet.indent"  // ListTree
  static let lock = "lock"  // Lock
  static let pencil = "pencil"  // Pencil
  static let skip = "forward.end"  // SkipForward
  static let close = "xmark"  // X
  static let plus = "plus"  // Plus
  static let restart = "arrow.counterclockwise"  // RotateCcw
}

/// lucide's GripVertical, the queue's handle: six dots, two columns of
/// three. No SF Symbol draws it (line.3.horizontal, the nearest, reads as
/// a list), so it is drawn as lucide does: on its 24-point grid, circles of
/// 1 at x 9 and 15, y 5, 12 and 19, under its 2-point stroke, so each dot
/// is 4 across. The glyph is `size` square, grown with Dynamic Type as
/// virgaGlyph grows a symbol beside words of `words` points, at most
/// `upTo`, in the foreground style.
struct GripVerticalGlyph: View {
  @Environment(\.virgaTheme) private var theme
  let size: CGFloat
  var words: CGFloat?
  var upTo: CGFloat?

  var body: some View {
    let points = theme.scaled(size, relativeTo: VirgaTheme.textStyle(for: words ?? size))
    let side = upTo.map { min(points, $0) } ?? points
    GripVerticalShape()
      .frame(width: side, height: side)
      .accessibilityHidden(true)
  }
}

private struct GripVerticalShape: Shape {
  func path(in rect: CGRect) -> Path {
    let unit = min(rect.width, rect.height) / 24
    let left = rect.midX - 12 * unit
    let top = rect.midY - 12 * unit
    var path = Path()
    for x: CGFloat in [9, 15] {
      for y: CGFloat in [5, 12, 19] {
        path.addEllipse(in: CGRect(x: left + (x - 2) * unit, y: top + (y - 2) * unit, width: 4 * unit, height: 4 * unit))
      }
    }
    return path
  }
}

/// The scheduling pages' clock. (A thrown error's `err.message` is
/// PostingPages.message, HubParts.swift.)
enum ScheduleText {
  /// `Date.now()`.
  static func now() -> Double { Date().timeIntervalSince1970 * 1000 }

  /// This device's zone, as resolveTimezone(null) names it.
  static var deviceZone: String { PostingQueue.resolveTimezone(nil) }
}

/// Lists of ids as the web compares them; two ids are `===` as
/// PostingPages.sameValue has it (two strings by code unit, two numbers by
/// value, nothing else). PostingPages is the main actor's, so the three
/// that compare are too (their callers, the page and its model, are);
/// `firstText` and `key` stay free for ScheduleListEntry.
enum ScheduleIds {
  /// `ids.includes(id)`.
  @MainActor
  static func contains(_ ids: [JSONValue], _ id: JSONValue?) -> Bool {
    ids.contains { PostingPages.sameValue($0, id) }
  }

  /// `ids.indexOf(id)`, or nil.
  @MainActor
  static func index(_ ids: [JSONValue], _ id: JSONValue?) -> Int? {
    ids.firstIndex { PostingPages.sameValue($0, id) }
  }

  /// `a.join() === b.join()` for two lists of ids.
  @MainActor
  static func sameOrder(_ a: [JSONValue], _ b: [JSONValue]) -> Bool {
    a.count == b.count && zip(a, b).allSatisfy { PostingPages.sameValue($0, $1) }
  }

  /// A row's first post's words: `String(row.payload?.posts?.[0]?.record?.text || '')`.
  static func firstText(_ row: JSONValue?) -> String {
    row?["payload"]?["posts"]?[0]?["record"]?["text"]?.stringValue ?? ""
  }

  /// An id as a key for a list's identity.
  static func key(_ id: JSONValue?) -> String {
    id?.stringValue ?? id.map { "\($0)" } ?? ""
  }
}

/// An error that says what the web's `new Error(text)` says (with a
/// `code` where the web gives it one, as the composer's ROOM).
struct ScheduleSaid: LocalizedError, ScheduleErrorObject {
  let message: String
  var code: String?

  init(message: String, code: String? = nil) {
    self.message = message
    self.code = code
  }

  var errorDescription: String? { message }

  var errorObject: JSONValue {
    var out: JSONValue = ["name": "Error", "message": .string(message)]
    if let code { out["code"] = .string(code) }
    return out
  }
}

// MARK: - Words with a link in them

/// A run of words, some of them a link to a page of the app.
struct ScheduleLinkedText: View {
  enum Piece {
    case words(String)
    case link(String, to: String)
  }

  @Environment(\.navigate) private var navigate
  let pieces: [Piece]

  var body: some View {
    Text(attributed)
      .environment(
        \.openURL,
        OpenURLAction { url in
          guard let href = InternalLink.href(url) else { return .systemAction }
          navigate(href)
          return .handled
        })
  }

  private var attributed: AttributedString {
    var out = AttributedString()
    for piece in pieces {
      switch piece {
      case .words(let text):
        out += AttributedString(text)
      case .link(let text, let path):
        var link = AttributedString(text)
        link.link = InternalLink.url(path)
        // Named in full: SwiftUI's and UIKit's attribute scopes both have an underlineStyle.
        link.underlineStyle = Text.LineStyle.single
        out += link
      }
    }
    return out
  }
}

// MARK: - The time zone

/// `TimezoneSelect`: every zone this device knows, this device's first. A
/// stored zone the device doesn't list is kept, first after it. It is the
/// kit's select (`select.input sched-tz`).
struct TimezoneSelect: View {
  let value: String
  var disabled = false
  /// The picker's identifier, for the UI tests (the web's `id`).
  var identifier = "time-zone-select"
  /// The field's whole width (`.sched-tz { max-width: 100% }` in the weekly
  /// schedule's field); otherwise a settings row's select.
  var fill = false
  let onChange: (String) -> Void

  /// `allZones()`: Intl.supportedValuesOf('timeZone') is sorted by code unit.
  static let allZones: [String] = TimeZone.knownTimeZoneIdentifiers.sorted {
    $0.utf16.lexicographicallyPrecedes($1.utf16)
  }

  var body: some View {
    let device = ScheduleText.deviceZone
    var zones = Self.allZones.filter { !$0.jsEquals(device) }
    if !value.isEmpty && !value.jsEquals(device) && !zones.contains(where: { $0.jsEquals(value) }) {
      zones.insert(value, at: 0)
    }
    var choices: [SelectChoice<String>] = [SelectChoice(device, "\(ScheduleModel.zoneLabel(device)) (this device)")]
    choices += zones.map { zone in SelectChoice(zone, ScheduleModel.zoneLabel(zone)) }
    return VirgaSelect(
      "Time zone", selection: Binding(get: { value.isEmpty ? device : value }, set: { onChange($0) }), options: choices
    )
    .disabled(disabled)
    .frame(
      minWidth: fill ? nil : Measure.Settings.selectMinWidth, maxWidth: fill ? .infinity : Measure.Settings.selectMaxWidth,
      alignment: .leading
    )
    .accessibilityIdentifier(identifier)
  }
}

// MARK: - A switch with its words

/// `Switch`: a switch with its words beside it, the words pressing it too.
struct ScheduleSwitch: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  var hint: String?
  let isOn: Bool
  var disabled = false
  let onChange: (Bool) -> Void

  var body: some View {
    HStack(alignment: .top, spacing: Measure.Schedule.switchGap) {
      Toggle(label, isOn: Binding(get: { isOn }, set: { onChange($0) }))
        .labelsHidden()
        .toggleStyle(.virgaSwitch)
        .disabled(disabled)
        .padding(.top, Measure.Schedule.switchLift)
        .accessibilityHint(hint ?? "")
      VStack(alignment: .leading, spacing: Measure.Schedule.switchTextGap) {
        Text(label)
          .virgaText(.textBase, weight: VirgaWeight.semibold)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
        if let hint {
          FieldHint(hint)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .contentShape(Rectangle())
      .onTapGesture { if !disabled { onChange(!isOn) } }
      .accessibilityHidden(true)
    }
  }
}

// MARK: - The week ahead

/// `QueueCalendar`: the week ahead as a grid, a column a day (this device's
/// days, today first and in ink), a row a time of day, a small circle where
/// a day has that time. An open time is a ring; one a queued post takes is
/// filled in the accent; a post whose time isn't one of the week's any more
/// is a dashed ring of its own. Pressing a filled one calls `onPick(row)`.
/// With `occupancy` false the marks are just posting times. The caption
/// says what's open and in which zone: `lead` takes the place of its first
/// sentence and `after` ends it; with `caption` false there is none.
struct QueueCalendarView: View {
  @Environment(\.virgaTheme) private var theme
  let schedule: JSONValue
  var rows: [JSONValue] = []
  let now: Double
  var onPick: ((JSONValue) -> Void)?
  var occupancy = true
  var highlight: JSONValue?
  var caption = true
  var lead: [ScheduleLinkedText.Piece]?
  var after: [ScheduleLinkedText.Piece]?
  /// The calendar's own width (`.sched-cal { container-type: inline-size }`),
  /// for its day heads.
  @State private var width: CGFloat = 0

  /// One of the grid's rows: a time of day (the nth slot of that minute on a day).
  struct GridLine: Identifiable {
    var key: String
    var minute: Int
    var nth: Int
    var at: Double
    var label: String
    var id: String { key }
  }

  var body: some View {
    let device = AppLocale.activeTimeZone()
    let model = try? QueueCalendar.buildCalendarDays(schedule, occupancy ? rows : [], 7, now: now)
    let days = model?.days ?? []
    let grid = Self.calendarRows(days, zone: device)
    VStack(alignment: .leading, spacing: 0) {
      CalendarGrid(
        days: days, lines: grid.lines, rowOf: grid.rowOf, now: now, occupancy: occupancy, onPick: onPick,
        highlight: highlight, zone: device, wideHeads: width >= Measure.Schedule.calWideHead)
      if caption {
        captionLine(days: days, laterCount: model?.laterCount ?? 0)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      GeometryReader { geometry in
        Color.clear
          .onAppear { width = geometry.size.width }
          .onChange(of: geometry.size.width) { _, next in width = next }
      }
    )
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("queue-calendar")
  }

  /// The caption, under one hairline across the section.
  private func captionLine(days: [CalendarDay], laterCount: Int) -> some View {
    let tz = PostingQueue.resolveTimezone(schedule)
    let device = ScheduleText.deviceZone
    var pieces: [ScheduleLinkedText.Piece] = []
    if let lead {
      pieces += lead
      pieces.append(.words(" "))
    } else if occupancy {
      let open = days.reduce(0) { n, d in n + d.slots.filter { $0.row == nil && !$0.offSchedule }.count }
      let later = laterCount > 0 ? " · \(laterCount) queued further out" : ""
      pieces.append(.words("\(open == 1 ? "1 open time" : "\(open) open times") in the next seven days\(later). "))
    } else {
      pieces.append(.words("The posting times of the next seven days. "))
    }
    let differs = !tz.jsEquals(device) ? "; the week is set in \(ScheduleModel.zoneLabel(tz))" : ""
    pieces.append(.words("Shown in this device’s time (\(ScheduleModel.zoneLabel(device)))\(differs)."))
    if let after {
      pieces.append(.words(" "))
      pieces += after
    }
    return ScheduleLinkedText(pieces: pieces)
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .tint(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, theme.space3)
      .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: Measure.Schedule.captionRule) }
      .accessibilityIdentifier("queue-calendar-caption")
  }

  /// `rowLabel(at)`: '9 AM', '5:30 PM', or '17:00'.
  static func rowLabel(_ at: Double, zone: TimeZone) -> String {
    let minutes = JSDate.fields(at, timeZone: zone)?.minutes ?? 0
    if !AppLocale.uses12Hour() {
      return AppLocale.toLocaleTimeString(
        at, DateFormatOptions(hour: "2-digit", minute: "2-digit", hour12: false), locale: AppLocale.activeLocale(),
        timeZone: zone)
    }
    return AppLocale.toLocaleTimeString(
      at, DateFormatOptions(hour: "numeric", minute: minutes != 0 ? "2-digit" : nil, hour12: true),
      locale: AppLocale.activeLocale(), timeZone: zone)
  }

  /// `calendarRows(days)`: each time of day the week holds, earliest first;
  /// two slots on one day at the same minute get a row each. Returns the
  /// rows and, per day, each slot's row index.
  static func calendarRows(_ days: [CalendarDay], zone: TimeZone) -> (lines: [GridLine], rowOf: [[Int]]) {
    var keys: [String: GridLine] = [:]
    var order: [String] = []
    var placed: [[String]] = []
    for day in days {
      var seen: [Int: Int] = [:]
      var keysOfDay: [String] = []
      for slot in day.slots {
        let f = JSDate.fields(slot.at, timeZone: zone)
        let minute = (f?.hours ?? 0) * 60 + (f?.minutes ?? 0)
        let nth = seen[minute] ?? 0
        seen[minute] = nth + 1
        let key = "\(minute):\(nth)"
        if keys[key] == nil {
          keys[key] = GridLine(key: key, minute: minute, nth: nth, at: slot.at, label: "")
          order.append(key)
        }
        keysOfDay.append(key)
      }
      placed.append(keysOfDay)
    }
    let sorted = order.compactMap { keys[$0] }.sorted { a, b in
      a.minute != b.minute ? a.minute < b.minute : a.nth < b.nth
    }
    var index: [String: Int] = [:]
    for (i, line) in sorted.enumerated() { index[line.key] = i }
    let lines = sorted.map { line -> GridLine in
      var out = line
      out.label = line.nth == 0 ? rowLabel(line.at, zone: zone) : ""
      return out
    }
    return (lines, placed.map { $0.map { index[$0] ?? 0 } })
  }
}

/// The grid itself: the times down the side (for the eye: each mark names
/// its own), then a column a day.
struct CalendarGrid: View {
  @Environment(\.virgaTheme) private var theme
  let days: [CalendarDay]
  let lines: [QueueCalendarView.GridLine]
  let rowOf: [[Int]]
  let now: Double
  let occupancy: Bool
  let onPick: ((JSONValue) -> Void)?
  let highlight: JSONValue?
  let zone: TimeZone
  /// The day's name beside its date: the calendar is 520 or wider.
  let wideHeads: Bool

  var body: some View {
    let phone = theme.isPhone
    Grid(
      alignment: .center, horizontalSpacing: phone ? Measure.Schedule.phoneCalColumnGap : Measure.Schedule.calColumnGap,
      verticalSpacing: Measure.Schedule.calRowGap
    ) {
      GridRow {
        Color.clear.frame(width: phone ? nil : Measure.Schedule.calTimeColumn, height: 1)
          .gridCellUnsizedAxes(.vertical)
          .accessibilityHidden(true)
        ForEach(Array(days.enumerated()), id: \.element.key) { d, day in
          CalendarDayHead(day: day, today: d == 0, zone: zone, wide: wideHeads)
            .accessibilitySortPriority(Double((days.count - d) * 1000 + 999))
        }
      }
      ForEach(Array(lines.enumerated()), id: \.element.id) { r, line in
        GridRow {
          Text(line.label)
            .virgaText(.textSm, lineHeight: Measure.Schedule.calLineHeight)
            .foregroundStyle(theme.muted)
            .lineLimit(1)
            .fixedSize()
            .frame(width: phone ? nil : Measure.Schedule.calTimeColumn, alignment: .leading)
            .accessibilityHidden(true)
          ForEach(Array(days.enumerated()), id: \.element.key) { d, day in
            cell(day: day, d: d, r: r)
              .frame(maxWidth: .infinity)
              .accessibilitySortPriority(Double((days.count - d) * 1000 + (998 - r)))
          }
        }
      }
    }
    .frame(maxWidth: Measure.Schedule.calMaxWidth, alignment: .leading)
    .padding(.top, Measure.Schedule.calPadTop)
    .padding(.bottom, Measure.Schedule.calPadBottom)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("The next seven days")
  }

  @ViewBuilder
  private func cell(day: CalendarDay, d: Int, r: Int) -> some View {
    let places = d < rowOf.count ? rowOf[d] : []
    if let s = places.firstIndex(of: r), s < day.slots.count {
      CalendarMark(
        slot: day.slots[s], now: now, occupancy: occupancy, onPick: onPick,
        lit: highlight.map { h in PostingPages.sameValue(day.slots[s].row?["id"], h) } ?? false)
    } else if r == 0 && day.slots.isEmpty {
      Color.clear.frame(width: Measure.Schedule.markSize, height: Measure.Schedule.markSize)
        .accessibilityElement()
        .accessibilityLabel("No posting times")
    } else {
      Color.clear.frame(width: Measure.Schedule.markSize, height: Measure.Schedule.markSize)
        .accessibilityHidden(true)
    }
  }
}

/// A day's name over its date (on one line where the columns have room);
/// today's in ink.
struct CalendarDayHead: View {
  @Environment(\.virgaTheme) private var theme
  let day: CalendarDay
  let today: Bool
  let zone: TimeZone
  /// `@container (min-width: 520px)`: the calendar has room for the name beside the date.
  let wide: Bool

  var body: some View {
    let locale = AppLocale.activeLocale()
    let weekday = AppLocale.toLocaleDateString(day.date, DateFormatOptions(weekday: "short"), locale: locale, timeZone: zone)
    let date = JSDate.fields(day.date, timeZone: zone).map { "\($0.date)" } ?? ""
    let long = AppLocale.toLocaleDateString(
      day.date, DateFormatOptions(weekday: "long", month: "long", day: "numeric"), locale: locale, timeZone: zone)
    Group {
      if wide {
        HStack(spacing: Measure.Schedule.calHeadGap) {
          Text(weekday)
          Text(date)
        }
      } else {
        VStack(spacing: 0) {
          Text(weekday)
          Text(date)
        }
      }
    }
    .virgaText(.textSm, weight: today ? VirgaWeight.semibold : VirgaWeight.regular, lineHeight: Measure.Schedule.calLineHeight)
    .foregroundStyle(today ? theme.ink : theme.muted)
    .lineLimit(1)
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(long)
    .accessibilityAddTraits(.isHeader)
  }
}

/// One circle: open (a ring), taken (filled in the accent), off the week's
/// times (a dashed ring), and picked out from the list (a ring round it).
struct CalendarMark: View {
  @Environment(\.virgaTheme) private var theme
  let slot: CalendarSlot
  let now: Double
  let occupancy: Bool
  let onPick: ((JSONValue) -> Void)?
  let lit: Bool
  /// A keyboard's focus on the pick, drawn round the mark itself
  /// (`.sched-cal-pick:focus-visible .sched-cal-mark`).
  @FocusState private var focused: Bool

  /// How far a taken time is pressed past its circle: 44 points across.
  static let reach = (Measure.Touch.target - Measure.Schedule.markSize) / 2

  /// `label(slot)`.
  private var label: String {
    let when = ScheduleModel.formatInZone(.number(slot.at), ScheduleText.deviceZone, now: now)
    if !occupancy { return when }
    guard let row = slot.row else { return "\(when): open" }
    let text = ScheduleIds.firstText(row).jsTrimmed()
    let off = slot.offSchedule ? " (not one of the week’s times)" : ""
    return "\(when): \(text.isEmpty ? "a post with media" : text.jsSlice(0, 80))\(off)"
  }

  var body: some View {
    if let row = slot.row, let onPick {
      Button {
        onPick(row)
      } label: {
        mark
          .overlay {
            if focused { focusRing }
          }
          .frame(width: Measure.Schedule.pickSize, height: Measure.Schedule.pickSize)
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .focused($focused)
      .focusEffectDisabled()
      .frame(width: Measure.Schedule.markSize, height: Measure.Schedule.markSize)
      // A finger's reach past the gaps (`.sched-cal-pick::after`), without
      // making the grid's row any taller than the others.
      .touchReach(horizontal: Self.reach, vertical: Self.reach)
      .help(label)
      .accessibilityLabel(label)
      .accessibilityIdentifier("calendar-pick")
    } else {
      mark
        .accessibilityElement()
        .accessibilityLabel(label)
        .help(occupancy ? label : "")
    }
  }

  /// `outline: 2px solid var(--focus-ring); outline-offset: 2px` round the
  /// circle. Two points in high contrast too: theme.css's 3px
  /// (`:root[data-contrast='high'] :focus-visible`) is the pick's, whose
  /// own outline is none, not the mark's.
  private var focusRing: some View {
    let width = theme.points(ThemeKit.focusOutline)
    let reach = theme.points(ThemeKit.focusOutlineOffset) + width
    return Circle()
      .inset(by: -reach)
      .strokeBorder(theme.color(ThemeKit.focusOutline), lineWidth: width)
      .allowsHitTesting(false)
  }

  private var mark: some View {
    let size = Measure.Schedule.markSize
    let filled = slot.row != nil && !slot.offSchedule
    let border = slot.row != nil ? theme.accent : theme.line2
    return ZStack {
      if filled {
        Circle().fill(theme.accent)
      }
      if slot.offSchedule {
        Circle()
          .strokeBorder(
            border,
            style: StrokeStyle(lineWidth: Measure.Schedule.markBorder, dash: [Measure.Schedule.markDash, Measure.Schedule.markDash]))
      } else {
        Circle().strokeBorder(border, lineWidth: Measure.Schedule.markBorder)
      }
    }
    .frame(width: size, height: size)
    .overlay {
      if lit {
        Circle()
          .strokeBorder(theme.accent, lineWidth: Measure.Schedule.litRing)
          .padding(-(Measure.Schedule.litGap + Measure.Schedule.litRing))
      }
    }
  }
}

/// `.sched-cal-skeleton`: seven bones while the list is read, pulsing as
/// every `.hub-bone` does (still under Reduce Motion).
struct CalendarSkeleton: View {
  @Environment(\.virgaTheme) private var theme
  @State private var dim = false

  var body: some View {
    HStack(spacing: theme.isPhone ? Measure.Schedule.phoneSkeletonGap : Measure.Schedule.skeletonGap) {
      ForEach(0..<7, id: \.self) { _ in
        RoundedRectangle(cornerRadius: theme.radiusSm)
          .fill(theme.line)
          .frame(maxWidth: .infinity)
          .frame(height: Measure.Schedule.skeletonBoneHeight)
      }
    }
    .padding(.top, Measure.Schedule.calPadTop)
    .padding(.bottom, Measure.Schedule.calPadBottom)
    .opacity(dim ? Measure.Templates.pulseLow : 1)
    .onAppear {
      guard !theme.reduceMotion else { return }
      withAnimation(.easeInOut(duration: Measure.Templates.pulseSeconds / 2).repeatForever(autoreverses: true)) { dim = true }
    }
    .accessibilityHidden(true)
  }
}

// MARK: - The question before an action

extension View {
  /// `ActionDialog`: what an action does, a way out ("Keep it"), and the
  /// action. `onConfirm` may throw: the button shows `busyLabel` until it
  /// settles, and a failure's message stays in the dialog. `danger` for
  /// what can't be undone.
  func scheduleActionDialog<Message: View>(
    isPresented: Binding<Bool>, title: String, confirmLabel: String, busyLabel: String? = nil,
    cancelLabel: String = "Keep it", danger: Bool = false,
    onConfirm: @escaping @MainActor () async throws -> Void, @ViewBuilder message: @escaping () -> Message
  ) -> some View {
    modifier(
      ScheduleActionDialog(
        isPresented: isPresented, title: title, confirmLabel: confirmLabel, busyLabel: busyLabel ?? confirmLabel,
        cancelLabel: cancelLabel, danger: danger, onConfirm: onConfirm, message: message))
  }
}

struct ScheduleActionDialog<Message: View>: ViewModifier {
  @Binding var isPresented: Bool
  let title: String
  let confirmLabel: String
  let busyLabel: String
  let cancelLabel: String
  let danger: Bool
  let onConfirm: @MainActor () async throws -> Void
  let message: () -> Message
  @State private var busy = false
  @State private var error = ""

  func body(content: Content) -> some View {
    content
      // `onClose={busy ? undefined : onClose}`: neither Close nor a swipe
      // takes it away while the action runs. It opens on Keep it
      // (`data-autofocus`).
      .virgaDialog(
        isPresented: Binding(get: { isPresented }, set: { if !busy { isPresented = $0 } }), title: title, autofocus: true
      ) {
        VStack(alignment: .leading, spacing: Measure.Schedule.confirmGap) {
          message()
          if !error.isEmpty {
            // `role="alert"`: read out as it appears.
            Callout(tone: .danger, error)
              .accessibilityIdentifier("schedule-dialog-error")
          }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("schedule-dialog")
        .interactiveDismissDisabled(busy)
      } actions: {
        Button(cancelLabel) { isPresented = false }
          .buttonStyle(.virga)
          .disabled(busy)
          .dialogAutofocus()
          .accessibilityIdentifier("schedule-dialog-keep")
        Button(busy ? busyLabel : confirmLabel) { Task { await confirm() } }
          .buttonStyle(.virga(danger ? .danger : .primary))
          .disabled(busy)
          .accessibilityIdentifier("schedule-dialog-confirm")
      }
      .onChange(of: isPresented) { _, open in if open { error = "" } }
  }

  private func confirm() async {
    busy = true
    error = ""
    defer { busy = false }
    do {
      try await onConfirm()
      isPresented = false
    } catch {
      let said = PostingPages.message(error)
      self.error = said.isEmpty ? "That didn’t work. Try again." : said
    }
  }
}

// MARK: - The list's read

/// hubParts' `useLoad` over the account's scheduled posts (and, with
/// `withLimits`, its limits, whose failure isn't one): read once started,
/// again on `reload()` and whenever one of `events` names the account. A
/// failure after a good read keeps what was read (`status` stays ready).
@MainActor
@Observable
final class ScheduledListLoad {
  enum Status { case idle, loading, ready, error }

  private(set) var status: Status
  private(set) var list: ScheduledList?
  private(set) var limits: JSONValue?
  private(set) var error: (any Error)?
  /// Moves on with every good read: the web's `list.data` identity.
  private(set) var generation = 0

  @ObservationIgnored let did: String?
  @ObservationIgnored let requester: VirgaBackend?
  @ObservationIgnored let withLimits: Bool
  @ObservationIgnored let events: [String]
  @ObservationIgnored private var run = 0
  @ObservationIgnored private var stops: [PostingEventUnsubscribe] = []
  @ObservationIgnored private var task: Task<Void, Never>?

  init(did: String?, requester: VirgaBackend?, withLimits: Bool, events: [String]) {
    self.did = did
    self.requester = requester
    self.withLimits = withLimits
    self.events = events
    status = requester == nil ? .idle : .loading
  }

  var enabled: Bool { requester != nil }

  func start() {
    guard enabled, stops.isEmpty else {
      if enabled && list == nil { reload() }
      return
    }
    if let did, !did.isEmpty {
      for name in events {
        if let stop = try? PostingEvents.onPostingEvent(name, did: did, { [weak self] _ in
          Task { @MainActor [weak self] in self?.reload() }
        }) {
          stops.append(stop)
        }
      }
    }
    reload()
  }

  func stop() {
    for stop in stops { stop() }
    stops = []
    task?.cancel()
    task = nil
  }

  /// `getLimits(req).catch(() => null)`, when the page shows them.
  nonisolated static func readLimits(_ requester: VirgaBackend, _ wanted: Bool) async -> JSONValue? {
    guard wanted else { return nil }
    return try? await ScheduleService.getLimits(requester)
  }

  func reload() {
    guard let requester else { return }
    run += 1
    let token = run
    let withLimits = self.withLimits
    task = Task {
      do {
        async let listed = ScheduleService.listScheduled(requester)
        async let read = Self.readLimits(requester, withLimits)
        let list = try await listed
        let limits = await read
        guard token == self.run else { return }
        self.list = list
        self.limits = limits
        self.error = nil
        self.status = .ready
        self.generation += 1
      } catch {
        guard token == self.run, !(error is CancellationError) else { return }
        self.error = error
        self.status = self.list != nil ? .ready : .error
      }
    }
  }
}
#endif
