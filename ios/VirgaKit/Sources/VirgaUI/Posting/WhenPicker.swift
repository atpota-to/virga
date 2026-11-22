// Ports src/posting/ui/WhenPicker.jsx
// Ports src/posting/pages/schedule.css (.when-picker, .sched-when, .sched-when-fields, .sched-picks, .sched-when-zone, .when-at, .sched-problem, .sched-repeat, .sched-repeat-fields, .sched-when-queue, .sched-when-queue-text)
//
// When a post goes out: a date and a time on the account's queue clock (its
// weekly schedule's time zone), quick picks, and with `queue` the next open
// time in the weekly queue and a way to use it (`onQueue`). `value` is an
// ISO string or nil; `onChange` hears an ISO string, or nil while the date
// or time is incomplete. `min` and `max` default to what Virga's server
// takes: a minute from now to 90 days out.
//
// With `onRepeatChange` it also offers Repeat: every day, week, two weeks or
// month, ending never, on a date or after a number of times. `repeatRule` is
// the rule (`{ every, until?, count?, ends? }`, repeat.js) or nil, and
// `onRepeatChange` hears the new one. `repeatBlock` is a sentence saying why
// this post can't repeat (a reply), which turns the control off;
// `occurrence` is the number, in its series, of the post being edited.
//
// The web's WhenPicker reads the account's weekly schedule and server
// session itself (usePostingSettings, backendFor); here the caller passes
// them (`schedule`, `requester`, nil without a long session). The date and
// the time are the system's pickers, read on the queue's clock; they always
// hold a time, so a date without a time can't be typed. The fields share
// their row evenly (the web's 1.3 to 1, and 1 to 1.3 to 0.7 for a repeat's),
// and go one under another when the picker itself is 440 or narrower (its
// own width, `@container when`, not the window's). A problem is read out as
// it appears and as it changes (`role="alert"`), as is the repeat's when it
// is wrong; the date and time are described by the zone line and the
// problem, a repeat's fields by its note (`aria-describedby`).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights
import VirgaNetwork
import VirgaPosting

struct WhenPicker: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  /// The account's weekly schedule (its settings' `queue`).
  let schedule: JSONValue
  let value: String?
  let onChange: (String?) -> Void
  var queue = false
  /// Virga's server for the account, when it can schedule (the next open time's read).
  var requester: VirgaBackend?
  var onQueue: (() -> Void)?
  var min: Double?
  var max: Double?
  var repeatRule: JSONValue?
  var onRepeatChange: ((JSONValue?) -> Void)?
  var repeatBlock = ""
  var occurrence: Double = 1

  @State private var now = ScheduleText.now()
  /// What's picked, on the queue's clock: kept apart from `value`.
  @State private var parts = ZonedParts(date: "", time: "")
  @State private var touched = false
  @State private var taken = Taken(status: .idle, rows: [])
  /// The picker's own width (`container: when / inline-size`); the
  /// window's stands in until it has been measured.
  @State private var width: CGFloat? = nil

  struct ZonedParts: Equatable {
    var date: String
    var time: String
  }

  struct Taken {
    enum Status { case idle, none, loading, ready, error }
    var status: Status
    var rows: [JSONValue]
  }

  private var tz: String { PostingQueue.resolveTimezone(schedule) }
  private var zone: TimeZone { PostingQueue.timeZone(named: tz) ?? AppLocale.activeTimeZone() }
  private var lo: Double { min.flatMap { $0.isFinite ? $0 : nil } ?? now + PostingQueue.minLeadMs }
  private var hi: Double {
    max.flatMap { $0.isFinite ? $0 : nil } ?? now + Double(PostingQueue.queueHorizonDays) * 86_400_000
  }
  private var valueMs: Double { TimeValue.ms(value.map(JSONValue.string)) }

  /// `@container when (max-width: 440px)`: too narrow for the fields side by side.
  private var narrow: Bool { (width ?? theme.windowWidth) <= Measure.Schedule.whenNarrow }

  var body: some View {
    let problem = touched || !(value ?? "").isEmpty
      ? ScheduleModel.whenProblem(value.map(JSONValue.string) ?? .null, now: now, min: lo, max: hi) : ""
    VStack(alignment: .leading, spacing: Measure.Schedule.whenPickerGap) {
      fields(described: described(problem: problem))
      picks
      zoneLine(problem: problem)
      if !problem.isEmpty {
        Text(problem)
          .virgaText(.textSm, weight: VirgaWeight.medium)
          .foregroundStyle(theme.danger)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("when-problem")
          .modifier(CalloutAlert(words: problem))
      }
      if onRepeatChange != nil {
        repeatBlockView
      }
      if queue {
        queueRow
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
    .onAppear { readParts(value) }
    .onChange(of: value) { _, next in readParts(next) }
    .onChange(of: tz) { _, _ in readParts(value) }
    .task {
      // The clock moves on while the picker is open; the bounds and picks follow.
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: UInt64(Measure.Schedule.pickerClockSeconds * 1_000_000_000))
        if Task.isCancelled { return }
        now = ScheduleText.now()
      }
    }
    .task(id: "\(queue)|\(requester?.did ?? "")") { await readTaken() }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("when-picker")
  }

  // MARK: The date and the time

  /// `value` shown on the queue's clock, unless what's picked already says it.
  private func readParts(_ next: String?) {
    let ms = TimeValue.ms(next.map(JSONValue.string))
    guard ms.isFinite else { return }
    if let shown = PostingQueue.zonedWallTimeToUtc(parts.date, parts.time, tz), shown == ms { return }
    if let wall = PostingQueue.zonedWallTime(.number(ms), .string(tz)) {
      parts = ZonedParts(date: wall.date, time: wall.time)
    }
  }

  private func emit(_ next: ZonedParts) {
    parts = next
    touched = true
    let at = PostingQueue.zonedWallTimeToUtc(next.date, next.time, tz)
    onChange(at.flatMap { JSDate.toISOString($0) })
  }

  /// The instant the pickers show: what's picked, else the earliest allowed.
  private var shownDate: Date {
    let ms = PostingQueue.zonedWallTimeToUtc(parts.date, parts.time, tz) ?? lo
    return Date(timeIntervalSince1970: ms / 1000)
  }

  /// The wall-clock date and time of a picked instant on the queue's clock.
  private func wall(_ date: Date) -> ZonedWallTime? {
    PostingQueue.zonedWallTime(.number(date.timeIntervalSince1970 * 1000), .string(tz))
  }

  /// `aria-describedby`: the zone line, then the problem when there is one.
  private func described(problem: String) -> String {
    var words = zoneLead
    if valueMs.isFinite && problem.isEmpty {
      words += " Goes out \(ScheduleModel.formatInZone(value.map(JSONValue.string), tz, now: now))."
    }
    if !problem.isEmpty { words += " \(problem)" }
    return words
  }

  @ViewBuilder
  private func fields(described: String) -> some View {
    let layout =
      narrow
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Measure.Schedule.whenFieldsGap))
      : AnyLayout(HStackLayout(alignment: .top, spacing: Measure.Schedule.whenFieldsGap))
    layout {
      FieldStack("Date") {
        DatePicker(
          "Date",
          selection: Binding(
            get: { shownDate },
            set: { picked in
              guard let w = wall(picked) else { return }
              emit(ZonedParts(date: w.date, time: parts.time.isEmpty ? w.time : parts.time))
            }),
          in: Date(timeIntervalSince1970: lo / 1000)...Date(timeIntervalSince1970: Swift.max(lo, hi) / 1000),
          displayedComponents: .date
        )
        .labelsHidden()
        .environment(\.timeZone, zone)
        .accessibilityLabel("Date")
        .accessibilityHint(described)
        .accessibilityIdentifier("when-date")
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      FieldStack("Time") {
        DatePicker(
          "Time",
          selection: Binding(
            get: { shownDate },
            set: { picked in
              guard let w = wall(picked) else { return }
              emit(ZonedParts(date: parts.date.isEmpty ? w.date : parts.date, time: w.time))
            }),
          displayedComponents: .hourAndMinute
        )
        .labelsHidden()
        .environment(\.timeZone, zone)
        .accessibilityLabel("Time")
        .accessibilityHint(described)
        .accessibilityIdentifier("when-time")
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  // MARK: Quick picks

  @ViewBuilder
  private var picks: some View {
    let list = ScheduleModel.quickPicks(now: now, tz, min: lo, max: hi)
    if !list.isEmpty {
      // One line that scrolls sideways on a phone, the pressed pick brought
      // clear of the fade (useOverflowEdge); wrapped where there is room.
      if theme.isTablet {
        let pressed = list.first { valueMs == $0.at }?.key
        ScrollRow(focus: pressed.map { AnyHashable($0) }) {
          HStack(spacing: Measure.Schedule.picksGap) { pickButtons(list) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Quick picks")
      } else {
        FlowLayout(spacing: Measure.Schedule.picksGap, lineSpacing: Measure.Schedule.picksGap) { pickButtons(list) }
          .accessibilityElement(children: .contain)
          .accessibilityLabel("Quick picks")
      }
    }
  }

  private func pickButtons(_ list: [QuickPick]) -> some View {
    ForEach(list, id: \.key) { pick in
      let on = valueMs == pick.at
      Button(pick.label) {
        touched = true
        if let w = PostingQueue.zonedWallTime(.number(pick.at), .string(tz)) {
          parts = ZonedParts(date: w.date, time: w.time)
        }
        onChange(JSDate.toISOString(pick.at))
      }
      .buttonStyle(ChipStyle(isOn: on))
      .scrollRowFocus(on)
      .help(ScheduleModel.formatInZone(.number(pick.at), tz, now: now))
      .accessibilityAddTraits(on ? .isSelected : [])
      .accessibilityIdentifier("when-pick-\(pick.key)")
    }
  }

  // MARK: The zone, and when it goes out

  /// The zone line's first sentence (or two).
  private var zoneLead: String {
    let device = ScheduleText.deviceZone
    return tz.jsEquals(device)
      ? "Times are in your time zone, \(ScheduleModel.zoneLabel(tz))."
      : "Times are in \(ScheduleModel.zoneLabel(tz)), your weekly schedule’s time zone. This device is in \(ScheduleModel.zoneLabel(device))."
  }

  private func zoneLine(problem: String) -> some View {
    var words = Text(zoneLead)
    if valueMs.isFinite && problem.isEmpty {
      // A time it goes out is read as one thing: a narrow line breaks before it.
      let at = ScheduleModel.formatInZone(value.map(JSONValue.string), tz, now: now)
        .replacingOccurrences(of: " ", with: "\u{00A0}")
      words = words + Text(" Goes out ") + Text(at) + Text(".")
    }
    return words
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityIdentifier("when-zone")
  }

  // MARK: Repeat

  private var every: String { repeatBlock.isEmpty ? repeatRule?["every"]?.stringValue ?? "" : "" }

  @ViewBuilder
  private var repeatBlockView: some View {
    let every = self.every
    let ends = every.isEmpty ? "never" : Repeat.repeatEnds(repeatRule)
    let wrong =
      !every.isEmpty && valueMs.isFinite
      ? Repeat.repeatProblem(repeatRule, value.map(JSONValue.string), .string(tz), occurrence: occurrence) : ""
    let note = repeatNote(every: every, wrong: wrong)
    VStack(alignment: .leading, spacing: Measure.Schedule.repeatGap) {
      repeatFields(every: every, ends: ends, wrong: !wrong.isEmpty, note: note)
      // Said only once there is something to say: a repeat chosen, or why there can't be one.
      if !note.isEmpty {
        Text(note)
          .virgaText(.textSm, weight: wrong.isEmpty ? VirgaWeight.regular : VirgaWeight.medium)
          .foregroundStyle(wrong.isEmpty ? theme.muted : theme.danger)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("when-repeat-note")
          // `role={repeatWrong ? 'alert' : undefined}`.
          .modifier(CalloutAlert(words: wrong.isEmpty ? nil : wrong))
      }
    }
    .padding(.top, Measure.Schedule.repeatTop)
    .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
  }

  /// The repeat's note: why it can't repeat, what's wrong, or what it
  /// will do; '' while there is nothing to say.
  private func repeatNote(every: String, wrong: String) -> String {
    if !repeatBlock.isEmpty { return repeatBlock }
    if !wrong.isEmpty { return wrong }
    if every.isEmpty { return "" }
    let summary = Repeat.repeatSummary(
      Repeat.normalizeRepeat(repeatRule)?.json, value.map(JSONValue.string), .string(tz), now: now)
    let tail =
      occurrence > 1
      ? " This is number \(JSNumber.format(occurrence)); the change applies to it and the ones after."
      : " Each one is a post of its own, with the same words and pictures."
    return summary + tail
  }

  private func setRepeat(_ next: JSONValue?) { onRepeatChange?(next) }

  @ViewBuilder
  private func repeatFields(every: String, ends: String, wrong: Bool, note: String) -> some View {
    let layout =
      narrow
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: Measure.Schedule.repeatFieldsGap))
      : AnyLayout(HStackLayout(alignment: .bottom, spacing: Measure.Schedule.repeatFieldsGap))
    layout {
      repeatPicker(every, note: note)
        .frame(maxWidth: .infinity, alignment: .leading)
      if !every.isEmpty {
        endsPicker(every, ends: ends)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      if !every.isEmpty && ends == "on" {
        lastDay(every, invalid: wrong, note: note)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      if !every.isEmpty && ends == "after" {
        timesInAll(every, invalid: wrong, note: note)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private func repeatLabel() -> some View {
    HStack(spacing: Measure.Schedule.repeatLabelGap) {
      Image(systemName: HubGlyph.again)
        .virgaGlyph(Measure.Schedule.repeatIcon, beside: theme.points(ThemeKit.fieldLabelFontSize))
        .accessibilityHidden(true)
      FieldLabel("Repeat")
    }
  }

  /// `REPEAT_OPTIONS` as the select's choices.
  private var repeatChoices: [SelectChoice<String>] {
    Repeat.repeatOptions.map { option in SelectChoice(option.value, option.label) }
  }

  private func repeatPicker(_ every: String, note: String) -> some View {
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.fieldGap)) {
      repeatLabel()
      VirgaSelect(
        "Repeat",
        selection: Binding(
          get: { every },
          set: { next in
            if next.isEmpty {
              setRepeat(nil)
            } else {
              var rule = repeatRule?.objectValue ?? [:]
              rule["every"] = .string(next)
              setRepeat(.object(rule))
            }
          }),
        options: repeatChoices
      )
      .disabled(!repeatBlock.isEmpty)
      .accessibilityHint(note)
      .accessibilityIdentifier("when-repeat")
    }
  }

  /// `changeEnds(kind)`.
  private func changeEnds(_ kind: String, every: String) {
    if kind == "on" {
      let until = repeatRule?["until"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? defaultUntil(every)
      setRepeat(["every": .string(every), "ends": "on", "until": .string(until)])
    } else if kind == "after" {
      let count = repeatRule?["count"].flatMap { $0.isTruthy ? $0 : nil } ?? .number(Swift.max(10, occurrence + 1))
      setRepeat(["every": .string(every), "ends": "after", "count": count])
    } else {
      setRepeat(["every": .string(every)])
    }
  }

  /// A month of dailies or weeklies, half a year of monthlies: somewhere to
  /// start from, not a suggestion.
  private func defaultUntil(_ every: String) -> String {
    let days: Double = ["day": 30, "week": 56, "2weeks": 112, "month": 183][every] ?? 30
    let from = valueMs.isFinite ? valueMs : now
    return PostingQueue.zonedWallTime(.number(from + days * 86_400_000), .string(tz))?.date ?? ""
  }

  /// The ways a repeat ends, as the select's choices.
  private static var endsChoices: [SelectChoice<String>] {
    [SelectChoice("never", "Never"), SelectChoice("on", "On a date"), SelectChoice("after", "After a number of times")]
  }

  private func endsPicker(_ every: String, ends: String) -> some View {
    FieldStack("Ends") {
      VirgaSelect(
        "Ends", selection: Binding(get: { ends }, set: { changeEnds($0, every: every) }), options: Self.endsChoices
      )
      .accessibilityIdentifier("when-ends")
    }
  }

  private func lastDay(_ every: String, invalid: Bool, note: String) -> some View {
    let until = repeatRule?["until"]?.stringValue ?? ""
    let first = valueMs.isFinite ? valueMs : lo
    let shown = PostingQueue.zonedWallTimeToUtc(until, "12:00", tz) ?? first
    return FieldStack("Last day") {
      DatePicker(
        "Last day",
        selection: Binding(
          get: { Date(timeIntervalSince1970: shown / 1000) },
          set: { picked in
            let day = wall(picked)?.date ?? ""
            setRepeat(["every": .string(every), "ends": "on", "until": .string(day)])
          }),
        in: Date(timeIntervalSince1970: first / 1000)...,
        displayedComponents: .date
      )
      .labelsHidden()
      .environment(\.timeZone, zone)
      .accessibilityLabel("Last day")
      .accessibilityHint(note)
      .accessibilityIdentifier("when-until")
    }
  }

  private func timesInAll(_ every: String, invalid: Bool, note: String) -> some View {
    let count = repeatRule?["count"]
    let text = count.flatMap { $0.isNull ? nil : $0 }.map { $0.stringValue ?? JSNumber.format($0.jsNumber) } ?? ""
    return FieldStack("Times in all") {
      // No placeholder: the label over it says what it is.
      VirgaTextField(
        "",
        text: Binding(
          get: { text },
          set: { typed in
            let digits = typed.filter(\.isNumber)
            let next: JSONValue = digits.isEmpty ? "" : .number(Double(digits) ?? 0)
            setRepeat(["every": .string(every), "ends": "after", "count": next])
          })
      )
      .keyboardType(.numberPad)
      .virgaField(invalid: invalid)
      .accessibilityLabel("Times in all")
      .accessibilityHint(note)
      .accessibilityIdentifier("when-count")
    }
  }

  // MARK: The queue's next open time

  private func readTaken() async {
    guard queue else { return }
    guard let requester else {
      taken = Taken(status: .none, rows: [])
      return
    }
    taken = Taken(status: .loading, rows: [])
    do {
      let list = try await ScheduleService.listScheduled(requester)
      if Task.isCancelled { return }
      taken = Taken(
        status: .ready,
        rows: list.rows.filter { r in
          (r["queued"]?.isTruthy ?? false) && (r["status"] == "pending" || r["status"] == "publishing")
        })
    } catch {
      if !Task.isCancelled { taken = Taken(status: .error, rows: []) }
    }
  }

  private var queueRow: some View {
    let slot: Double? = taken.status != .loading ? (try? PostingQueue.nextOpenSlot(schedule, taken.rows, now: now)) ?? nil : nil
    return QueueLine(gap: Measure.Schedule.queueGap, lineGap: Measure.Schedule.queueLineGap, basis: Measure.Schedule.queueTextBasis) {
      Image(systemName: ScheduleGlyph.listTree)
        .virgaGlyph(Measure.Schedule.queueIcon, beside: theme.textSm)
        .foregroundStyle(theme.ink2)
        .accessibilityHidden(true)
      queueWords(slot)
      if let onQueue, slot != nil {
        Button("Use this time", action: onQueue)
          .buttonStyle(.virga(size: .small))
          .accessibilityIdentifier("when-use-queue")
      }
    }
    .padding(.top, Measure.Schedule.queueTop)
    .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("when-queue")
  }

  @ViewBuilder
  private func queueWords(_ slot: Double?) -> some View {
    if taken.status == .loading {
      FieldHint("Finding the next open time in your queue…")
    } else if PostingQueue.isScheduleEmpty(schedule) {
      ScheduleLinkedText(pieces: [
        .words("Your weekly schedule has no times yet. "),
        .link("Set some", to: PostingRoutes.postingPageByKey["schedule"]?.path ?? "/posting/schedule"),
        .words(" to use the queue."),
      ])
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .tint(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
    } else if let slot {
      let at = ScheduleModel.formatInZone(.number(slot), tz, now: now).replacingOccurrences(of: " ", with: "\u{00A0}")
      let note = taken.status == .error ? Text(" (couldn’t check what’s already queued)").foregroundColor(theme.muted) : Text("")
      (Text("Next open time in your queue: ").foregroundColor(theme.ink)
        + Text(at).fontWeight(.semibold).foregroundColor(theme.ink) + note)
        .virgaText(.textSm)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("when-queue-slot")
    } else {
      FieldHint("Your queue has no open times in the next 90 days.")
    }
  }
}
/// `.sched-when-queue`: the glyph, the words (`flex: 1 1 200px`) and Use
/// this time, centred on their line, `gap` apart; the button drops under
/// them, `lineGap` down at the line's start, when the words would get less
/// than `basis` beside it (`flex-wrap: wrap`). Its subviews: the glyph, the
/// words, and the button if there is one.
struct QueueLine: Layout {
  var gap: CGFloat
  var lineGap: CGFloat
  var basis: CGFloat

  struct Plan {
    var wraps = false
    var glyph = CGSize.zero
    var words = CGSize.zero
    var button = CGSize.zero
    var line: CGFloat = 0
    var height: CGFloat = 0
  }

  func plan(_ width: CGFloat?, _ subviews: Subviews) -> Plan {
    var out = Plan()
    guard subviews.count >= 2 else { return out }
    let hasButton = subviews.count > 2
    out.glyph = subviews[0].sizeThatFits(.unspecified)
    out.button = hasButton ? subviews[2].sizeThatFits(.unspecified) : .zero
    let lead = out.glyph.width + gap
    let beside: CGFloat? = width.map { $0 - lead - (hasButton ? gap + out.button.width : 0) }
    out.wraps = hasButton && (beside ?? .infinity) < basis
    let room: CGFloat? = out.wraps ? width.map { $0 - lead } : beside
    out.words = subviews[1].sizeThatFits(ProposedViewSize(width: room.map { Swift.max(0, $0) }, height: nil))
    out.line = Swift.max(out.glyph.height, out.words.height)
    if hasButton && !out.wraps { out.line = Swift.max(out.line, out.button.height) }
    out.height = out.wraps ? out.line + lineGap + out.button.height : out.line
    return out
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let plan = plan(proposal.width, subviews)
    let ideal = plan.glyph.width + gap + plan.words.width + (subviews.count > 2 ? gap + plan.button.width : 0)
    return CGSize(width: proposal.width ?? ideal, height: plan.height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard subviews.count >= 2 else { return }
    let plan = plan(bounds.width, subviews)
    let x = bounds.minX
    subviews[0].place(
      at: CGPoint(x: x, y: bounds.minY + (plan.line - plan.glyph.height) / 2),
      proposal: ProposedViewSize(width: plan.glyph.width, height: plan.glyph.height))
    let wordsX = x + plan.glyph.width + gap
    let wordsWidth = plan.wraps ? bounds.maxX - wordsX : bounds.maxX - wordsX - (subviews.count > 2 ? gap + plan.button.width : 0)
    subviews[1].place(
      at: CGPoint(x: wordsX, y: bounds.minY + (plan.line - plan.words.height) / 2),
      proposal: ProposedViewSize(width: Swift.max(0, wordsWidth), height: plan.words.height))
    guard subviews.count > 2 else { return }
    let buttonAt =
      plan.wraps
      ? CGPoint(x: x, y: bounds.minY + plan.line + lineGap)
      : CGPoint(x: bounds.maxX - plan.button.width, y: bounds.minY + (plan.line - plan.button.height) / 2)
    subviews[2].place(at: buttonAt, proposal: ProposedViewSize(width: plan.button.width, height: plan.button.height))
  }
}
#endif
