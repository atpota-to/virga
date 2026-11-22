// Ports src/posting/pages/ScheduledPage.jsx (ScheduledRow, the timer notes' rows, dayInZone)
// Ports src/posting/pages/schedule.css (.sched-group-label, .sched-row, .sched-handle, .sched-when-cell, .sched-time, .sched-rel, .sched-when-past, .sched-row-why, .sched-row-note, .sched-row-reply, .sched-steps, and the phone's rows)
// Ports src/posting/pages/hub.css (.hub-row-main, .hub-row-text)
//
// A row of the list: its time in a column of its own (the hour over how far
// off it is, or, out of its day's run, the day over the hour), its words,
// what it replies to, its facts on a meta line, why it is as it is, and one
// action in words (Retry for a post that didn't go out, else Edit) with
// the rest in its ⋯, the one that takes it off last. On a phone the time is
// the row's first line, the ⋯ in its top corner, and the action under the
// words; the queue moves with arrows there. Wider, a queued row's handle
// moves it: dragged, with the keys (Space to pick it up, the arrows, Space
// to put it down, Escape to put it back), or with VoiceOver's adjust.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaPosting

/// `dayInZone(value, tz, now, opts)`: 'Fri, Nov 13' from 'Fri, Nov 13, 6:00 PM'.
enum ScheduleDays {
  static func dayInZone(_ value: JSONValue?, _ tz: String, now: Double, weekday: Bool = true) -> String {
    let full = ScheduleModel.formatInZone(value, tz, now: now, weekday: weekday)
    let clock = ScheduleModel.timeInZone(value, tz)
    guard !clock.isEmpty, full.utf16.count >= clock.utf16.count, full.utf16.reversed().starts(with: clock.utf16.reversed())
    else { return full }
    var units = Array(full.utf16.dropLast(clock.utf16.count))
    // `.replace(/[,\s]+$/, '')`
    while let last = units.last, last == 0x2C || Unicode.Scalar(last).map(JSWhitespace.contains) == true {
      units.removeLast()
    }
    return String(decoding: units, as: UTF16.self)
  }
}

/// One entry of a list with the day names between its rows: a day's name,
/// or a row. One flat run, so a row that changes day while it's moved stays
/// the same view (and keeps its drag).
struct ScheduleListEntry: Identifiable {
  var id: String
  var label: String?
  var row: JSONValue?

  /// `groupByZonedDay(rows, tz, now)`, flattened.
  static func entries(_ rows: [JSONValue], tz: String, now: Double) -> [ScheduleListEntry] {
    var out: [ScheduleListEntry] = []
    for (index, group) in ScheduleModel.groupByZonedDay(rows, tz, now: now).enumerated() {
      out.append(ScheduleListEntry(id: "day-\(index)-\(group.key)", label: group.label, row: nil))
      for row in group.rows {
        out.append(ScheduleListEntry(id: "row-\(ScheduleIds.key(row["id"]))", label: nil, row: row))
      }
    }
    return out
  }
}

/// What a queued row can do about its place (the web's `drag` prop).
struct RowReorder {
  var movable: Bool
  var first: Bool
  var last: Bool
  var disabled: Bool
  var active: Bool
}

/// Where each movable row is drawn, in the queue's space, for a drag.
struct QueueRowFrames: PreferenceKey {
  static let defaultValue: [String: CGRect] = [:]
  static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
    value.merge(nextValue()) { $1 }
  }
}

/// `ScheduledRow`.
struct ScheduledRowView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let row: JSONValue
  let model: ScheduledPageModel
  var showDate = false
  var reorder: RowReorder?
  /// Where every movable row is, for the drag.
  var frames: [String: CGRect] = [:]
  let onEdit: (JSONValue) -> Void

  static let space = "sched-queue"
  static let moveHelp =
    "Press Space to pick it up, the up and down arrows to move it, Space again to put it down, or Escape to put it back."

  private var now: Double { model.now }
  private var tz: String { model.tz }
  private var id: JSONValue { row["id"] ?? .null }

  var body: some View {
    let facts = ScheduleModel.rowFacts(row, now: now)
    let status = ScheduleModel.rowStatus(row, now: now)
    let actions = ScheduleModel.rowActions(row, now: now)
    let series = Repeat.rowRepeat(row, now: now)
    let time = ScheduleModel.timeInZone(row["scheduledFor"], tz)
    let busy = model.isBusy(row)
    let lit = model.lit.map { ScheduleIds.same(id, $0) } ?? false
    let active = reorder?.active ?? false
    let menu = menuEntries(actions: actions, series: series)
    Group {
      if theme.isPhone {
        phone(facts: facts, status: status, actions: actions, series: series, time: time, menu: menu, busy: busy)
      } else {
        wide(facts: facts, status: status, actions: actions, series: series, time: time, menu: menu, busy: busy)
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background {
      Rectangle()
        .fill(active ? theme.tint : lit ? theme.accentTint : Color.clear)
        .padding(.horizontal, -Measure.Schedule.rowBleed)
        .animation(theme.reduceMotion ? nil : .easeOut(duration: Measure.Schedule.litFadeSeconds), value: lit)
    }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .overlay(alignment: .topLeading) {
      if theme.hasSidebar, let reorder {
        handle(reorder, facts: facts)
          .offset(x: -Measure.Schedule.deskHandleOutset, y: theme.rowPad - Measure.Schedule.deskHandleRaise)
      }
    }
    .opacity(busy ? Measure.Schedule.busyOpacity : 1)
    .background {
      if reorder?.movable == true {
        GeometryReader { geometry in
          Color.clear.preference(
            key: QueueRowFrames.self, value: [ScheduleIds.key(id): geometry.frame(in: .named(Self.space))])
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sched-row-\(ScheduleIds.key(id))")
  }

  // MARK: Wider than a phone

  private func wide(
    facts: RowFacts, status: RowStatus, actions: RowActions, series: RowRepeat, time: String, menu: [MenuEntry], busy: Bool
  ) -> some View {
    HStack(alignment: .top, spacing: Measure.Schedule.rowColumnGap) {
      if !theme.hasSidebar, let reorder {
        handle(reorder, facts: facts)
          .padding(.top, -Measure.Schedule.handleLift)
          .padding(.leading, -Measure.Schedule.handleLeading)
          .padding(.trailing, -Measure.Schedule.handleTrailing)
      }
      whenCell(time: time)
      main(facts: facts, status: status, series: series)
        .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: theme.points(ThemeKit.rowActionsGap)) {
        primary(actions: actions, busy: busy)
        if !menu.isEmpty {
          MoreMenu(label: "More for the post at \(time)", entries: menu)
        }
      }
      .padding(.top, -Measure.Section.rowActionsLift)
    }
  }

  /// The time leads the row: the hour over how far off it is, or the day
  /// over the hour.
  private func whenCell(time: String) -> some View {
    VStack(alignment: .leading, spacing: Measure.Schedule.whenGap) {
      Text(showDate ? ScheduleDays.dayInZone(row["scheduledFor"], tz, now: now) : time)
        .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Schedule.whenLineHeight)
        .foregroundStyle(theme.ink)
      if showDate {
        Text(time)
          .virgaText(.textSm, lineHeight: Measure.Schedule.whenLineHeight)
          .foregroundStyle(theme.muted)
      } else if row["status"] == "pending" {
        Text(PostingQueue.relativeWhen(row["scheduledFor"], now: now))
          .virgaText(.textSm, lineHeight: Measure.Schedule.whenLineHeight)
          .foregroundStyle(theme.muted)
      }
    }
    .frame(width: theme.timeCol, alignment: .leading)
    .fixedSize(horizontal: false, vertical: true)
  }

  // MARK: A phone

  private func phone(
    facts: RowFacts, status: RowStatus, actions: RowActions, series: RowRepeat, time: String, menu: [MenuEntry], busy: Bool
  ) -> some View {
    VStack(alignment: .leading, spacing: Measure.Schedule.phoneRowLineGap) {
      ZStack(alignment: .topTrailing) {
        phoneWhen(time: time)
          .padding(.trailing, menu.isEmpty ? 0 : Measure.Schedule.cornerMenuRoom)
          .frame(maxWidth: .infinity, alignment: .leading)
        if !menu.isEmpty {
          MoreMenu(label: "More for the post at \(time)", entries: menu)
            .padding(.trailing, -Measure.Settings.dashMenuOutset)
            .padding(.top, -Measure.Section.rowActionsLift)
        }
      }
      main(facts: facts, status: status, series: series)
      let hasPrimary = actions.retry || actions.edit
      if hasPrimary || reorder?.movable == true {
        HStack(spacing: theme.points(ThemeKit.rowActionsGap)) {
          primary(actions: actions, busy: busy)
          if let reorder, reorder.movable {
            steps(reorder)
          }
        }
        .padding(.top, Measure.Schedule.phoneActionsAbove)
      }
    }
  }

  /// A phone's first line: the time, then how far off it is (or the day,
  /// then the hour), a dot between.
  private func phoneWhen(time: String) -> some View {
    let first = showDate ? ScheduleDays.dayInZone(row["scheduledFor"], tz, now: now) : time
    let second =
      showDate ? time : row["status"] == "pending" ? PostingQueue.relativeWhen(row["scheduledFor"], now: now) : ""
    var line = Text(first).fontWeight(.semibold).foregroundColor(theme.ink)
    if !second.isEmpty {
      line = line + Text(" · ").foregroundColor(theme.muted) + Text(second).foregroundColor(theme.muted)
    }
    return line
      .virgaText(.textSm, lineHeight: Measure.Schedule.phoneWhenLineHeight)
      .fixedSize(horizontal: false, vertical: true)
  }

  /// A phone has no drag: the queue moves with these instead.
  private func steps(_ reorder: RowReorder) -> some View {
    HStack(spacing: Measure.Schedule.stepsGap) {
      Button {
        model.step(id, -1)
      } label: {
        Image(systemName: ScheduleGlyph.up)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .disabled(reorder.disabled || reorder.first)
      .accessibilityLabel("Move earlier")
      .accessibilityIdentifier("sched-move-earlier")
      Button {
        model.step(id, 1)
      } label: {
        Image(systemName: ScheduleGlyph.down)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .disabled(reorder.disabled || reorder.last)
      .accessibilityLabel("Move later")
      .accessibilityIdentifier("sched-move-later")
    }
  }

  // MARK: What every row has

  private func main(facts: RowFacts, status: RowStatus, series: RowRepeat) -> some View {
    VStack(alignment: .leading, spacing: Measure.Schedule.mainGap) {
      Group {
        if facts.text.isEmpty {
          Text("A post with media").foregroundStyle(theme.muted)
        } else {
          Text(facts.text).foregroundStyle(theme.ink)
        }
      }
      .virgaText(.textMd, lineHeight: Measure.Schedule.rowTextLineHeight)
      .lineLimit(Measure.Schedule.rowTextLines)
      .fixedSize(horizontal: false, vertical: true)
      if let reply = facts.reply {
        ReplyLine(reply: reply)
      }
      RowMeta(row: row, facts: facts, status: status, series: series)
      // Red once: a failed post's reason, under a heading that says it
      // didn't go out. A thread part way out has its badge for that.
      if !status.detail.isEmpty {
        Text(status.detail)
          .virgaText(.textSm)
          .foregroundStyle(status.tone == "danger" ? theme.danger : theme.ink2)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("sched-row-why")
      }
    }
  }

  @ViewBuilder
  private func primary(actions: RowActions, busy: Bool) -> some View {
    if actions.retry {
      Button(row["partial"]?.isTruthy ?? false ? "Retry the rest" : "Retry") {
        Task { await model.retry(row, toasts: toasts) }
      }
      .buttonStyle(.virga(size: .small))
      .disabled(busy)
      .accessibilityIdentifier("sched-retry")
    } else if actions.edit {
      Button("Edit") { onEdit(row) }
        .buttonStyle(.virga(size: .small))
        .disabled(busy)
        .accessibilityIdentifier("sched-edit")
    }
  }

  private func menuEntries(actions: RowActions, series: RowRepeat) -> [MenuEntry] {
    var menu: [MenuEntry] = []
    let row = self.row
    if actions.retry && actions.edit {
      menu.append(.item(MenuItem("Edit", key: "edit", systemImage: ScheduleGlyph.pencil) { onEdit(row) }))
    }
    if actions.postNow {
      menu.append(
        .item(
          MenuItem("Post now", key: "now", systemImage: ScheduleGlyph.send, accessibilityIdentifier: "sched-post-now") {
            model.confirm = ScheduledConfirm(kind: .now, row: row)
          }))
    }
    if actions.skip {
      menu.append(
        .item(
          MenuItem(
            "Skip this one", key: "skip", hint: series.last ? "It’s the last, so that ends it" : "The next one still goes out",
            systemImage: ScheduleGlyph.skip, accessibilityIdentifier: "sched-skip"
          ) { model.confirm = ScheduledConfirm(kind: .skip, row: row) }))
    }
    if actions.stopRepeat {
      menu.append(
        .item(
          MenuItem(
            "Stop repeating", key: "stop",
            hint: row["status"] == "failed" ? "Nothing follows this one" : "This one still goes out",
            systemImage: ScheduleGlyph.ban, accessibilityIdentifier: "sched-stop"
          ) { model.confirm = ScheduledConfirm(kind: .stop, row: row) }))
    }
    if actions.cancel {
      if !menu.isEmpty { menu.append(.separator) }
      let label =
        row["status"] == "failed"
        ? "Dismiss" : series.repeats ? "Remove, and stop repeating" : "Remove from the schedule"
      menu.append(
        .item(
          MenuItem(label, key: "cancel", systemImage: ScheduleGlyph.trash, destructive: true, accessibilityIdentifier: "sched-cancel") {
            model.confirm = ScheduledConfirm(kind: .cancel, row: row)
          }))
    }
    return menu
  }

  // MARK: The handle

  /// A movable row's handle, or a lock for one that keeps its time.
  @ViewBuilder
  private func handle(_ reorder: RowReorder, facts: RowFacts) -> some View {
    if reorder.movable {
      QueueHandle(
        label: "Move: \(facts.text.isEmpty ? "a post with media" : facts.text.jsSlice(0, 60))", active: reorder.active,
        disabled: reorder.disabled,
        onDrag: { y in model.dragMoved(id, y: y, others: others()) },
        onDrop: { model.dragEnded() },
        onKey: { model.key(id, $0) },
        onAdjust: { delta in model.step(id, delta) })
    } else {
      Image(systemName: ScheduleGlyph.lock)
        .font(.system(size: Measure.Schedule.lockIcon))
        .foregroundStyle(theme.faint)
        .frame(width: Measure.Schedule.handleWidth, height: Measure.Schedule.handleHeight)
        .help("Keeps its time")
        .accessibilityElement()
        .accessibilityLabel("Keeps its time")
    }
  }

  /// The movable rows on screen, top to bottom, with their middles.
  private func others() -> [(id: JSONValue, midY: CGFloat)] {
    model.movable.compactMap { m -> (id: JSONValue, midY: CGFloat)? in
      guard let frame = frames[ScheduleIds.key(m)] else { return nil }
      return (m, frame.midY)
    }
    .sorted { $0.midY < $1.midY }
  }
}

/// `.sched-handle`: the grip a queued row is moved by.
struct QueueHandle: View {
  @Environment(\.virgaTheme) private var theme
  let label: String
  let active: Bool
  let disabled: Bool
  let onDrag: (CGFloat) -> Void
  let onDrop: () -> Void
  let onKey: (ScheduledPageModel.KeyMove) -> Bool
  let onAdjust: (Double) -> Void

  var body: some View {
    Button {
    } label: {
      Image(systemName: ScheduleGlyph.grip)
        .font(.system(size: Measure.Schedule.gripIcon))
        .foregroundStyle(active ? theme.ink : theme.muted)
        .frame(width: Measure.Schedule.handleWidth, height: Measure.Schedule.handleHeight)
        .background(RoundedRectangle(cornerRadius: theme.radiusSm).fill(active ? theme.tint : Color.clear))
        .overlay {
          if active {
            RoundedRectangle(cornerRadius: theme.radiusSm).strokeBorder(theme.accent, lineWidth: Measure.Schedule.handleRing)
          }
        }
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? Measure.Schedule.handleDisabledOpacity : 1)
    .simultaneousGesture(
      DragGesture(minimumDistance: 0, coordinateSpace: .named(ScheduledRowView.space))
        .onChanged { value in if !disabled { onDrag(value.location.y) } }
        .onEnded { _ in onDrop() }
    )
    .onKeyPress(keys: [.space, .return, .upArrow, .downArrow, .escape]) { press in
      let move: ScheduledPageModel.KeyMove
      switch press.key {
      case .upArrow: move = .earlier
      case .downArrow: move = .later
      case .escape: move = .back
      default: move = .pickOrDrop
      }
      return onKey(move) ? .handled : .ignored
    }
    .help(label)
    .accessibilityLabel(label)
    .accessibilityHint(ScheduledRowView.moveHelp)
    .accessibilityAddTraits(active ? .isSelected : [])
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: onAdjust(1)
      case .decrement: onAdjust(-1)
      @unknown default: break
      }
    }
    .accessibilityIdentifier("sched-handle")
  }
}

/// `.sched-row-reply`: who a scheduled reply answers, and the start of what they said.
struct ReplyLine: View {
  @Environment(\.virgaTheme) private var theme
  let reply: RowReply

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Measure.Schedule.replyGap) {
      Image(systemName: ScheduleGlyph.replyingTo)
        .font(.system(size: Measure.Schedule.replyIcon))
        .foregroundStyle(theme.muted)
        .accessibilityHidden(true)
      Text("Replying to \(reply.who)")
        .foregroundStyle(theme.ink)
        .lineLimit(1)
        .fixedSize()
      if !reply.text.isEmpty {
        Text(reply.text)
          .foregroundStyle(theme.muted)
          .lineLimit(1)
          .truncationMode(.tail)
      }
    }
    .virgaText(.textSm)
    .accessibilityElement(children: .combine)
  }
}

/// A row's meta line: going out now (a step louder), part of a thread out
/// (a badge), its series, where it came from, its facts, its timer.
struct RowMeta: View {
  @Environment(\.virgaTheme) private var theme
  let row: JSONValue
  let facts: RowFacts
  let status: RowStatus
  let series: RowRepeat

  enum Piece: Identifiable {
    case item(MetaItem)
    case badge(String)
    var id: String {
      switch self {
      case .item(let item): return item.id
      case .badge(let text): return "badge-\(text)"
      }
    }
  }

  private var pieces: [Piece] {
    var out: [Piece] = []
    if status.tone == "busy" { out.append(.item(MetaItem(status.label, isKey: true, id: "status"))) }
    if status.tone == "warn" { out.append(.badge(status.label)) }
    if series.repeats {
      let count = row["payload"]?["repeat"]?["count"]?.isTruthy ?? false
      let text =
        "\(series.label)\(series.progress.isEmpty ? "" : ", \(series.progress)")\(series.last && !count ? ", the last one" : "")"
      out.append(.item(MetaItem(text, systemImage: ScheduleGlyph.repeats, isKey: true, id: "repeat")))
    }
    if series.former && row["status"] == "failed" {
      let occurrence = row["occurrence"]
      let number = occurrence?.isTruthy ?? false ? ", number \(occurrence?.jsString ?? "")" : ""
      out.append(.item(MetaItem("From a repeating post\(number)", id: "former")))
    }
    if row["queued"]?.isTruthy ?? false, row["status"] != "pending" {
      out.append(.item(MetaItem("From the queue", id: "queued")))
    }
    for tag in ScheduleModel.rowTags(facts) { out.append(.item(MetaItem(tag))) }
    if !facts.timer.isEmpty { out.append(.item(MetaItem("Timer", systemImage: ScheduleGlyph.hourglass, id: "timer"))) }
    return out
  }

  var body: some View {
    let all = pieces
    if !all.isEmpty {
      let size = theme.points(ThemeKit.metaFontSize)
      FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
        ForEach(Array(all.enumerated()), id: \.element.id) { index, piece in
          switch piece {
          case .item(let item):
            MetaItemView(item: item, size: size, isLast: index == all.count - 1)
              .help(item.id == "timer" ? facts.timer : "")
              .accessibilityLabel(item.id == "timer" ? "Timer: \(facts.timer)" : item.text)
          case .badge(let text):
            MetaPiece(isLast: index == all.count - 1) { Badge(text, tone: .warn) }
          }
        }
      }
      .foregroundStyle(theme.color(ThemeKit.metaInk))
      .accessibilityElement(children: .combine)
    }
  }
}

/// A row of "A timer couldn't be set": "Went out" where a time would lead,
/// over when; its words; why there's no button, if there's none; and
/// Dismiss (✕). Setting a timer here waits for the timer dialog.
struct TimerNoteRow: View {
  @Environment(\.virgaTheme) private var theme
  let row: JSONValue
  let model: ScheduledPageModel

  var body: some View {
    let facts = ScheduleModel.rowFacts(row, now: model.now)
    let note = ScheduleModel.timerNoteActions(row, now: model.now)
    let day = ScheduleDays.dayInZone(row["scheduledFor"], model.tz, now: model.now, weekday: false)
    let hour = ScheduleModel.timeInZone(row["scheduledFor"], model.tz)
    let busy = model.isBusy(row)
    let phone = theme.isPhone
    let layout = phone ? AnyLayout(VStackLayout(alignment: .leading, spacing: Measure.Schedule.phoneRowLineGap))
      : AnyLayout(HStackLayout(alignment: .top, spacing: Measure.Schedule.rowColumnGap))
    layout {
      VStack(alignment: .leading, spacing: Measure.Schedule.whenGap) {
        Text("Went out")
          .virgaText(phone ? .textSm : .textMd, weight: phone ? VirgaWeight.semibold : VirgaWeight.medium)
          .foregroundStyle(theme.ink)
        // Each part kept whole, so a narrow column breaks between them.
        FlowLayout(spacing: 0, lineSpacing: 0, alignment: .firstTextBaseline) {
          Text(hour.isEmpty ? day : "\(day),").fixedSize()
          if !hour.isEmpty { Text(" \(hour)").fixedSize() }
        }
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
      }
      .frame(width: phone ? nil : theme.timeCol, alignment: .leading)
      .padding(.trailing, phone && note.dismiss ? Measure.Schedule.cornerMenuRoom : 0)
      VStack(alignment: .leading, spacing: Measure.Schedule.mainGap) {
        Group {
          if facts.text.isEmpty {
            Text("A post with media").foregroundStyle(theme.muted)
          } else {
            Text(facts.text).foregroundStyle(theme.ink)
          }
        }
        .virgaText(.textMd, lineHeight: Measure.Schedule.rowTextLineHeight)
        .lineLimit(Measure.Schedule.rowTextLines)
        .fixedSize(horizontal: false, vertical: true)
        if !note.note.isEmpty { FieldHint(note.note) }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if note.dismiss && !phone {
        dismiss(busy: busy).padding(.top, -Measure.Section.rowActionsLift)
      }
    }
    .overlay(alignment: .topTrailing) {
      if note.dismiss && phone {
        dismiss(busy: busy).padding(.trailing, -Measure.Settings.dashMenuOutset)
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .opacity(busy ? Measure.Schedule.busyOpacity : 1)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sched-note-\(ScheduleIds.key(row["id"]))")
  }

  private func dismiss(busy: Bool) -> some View {
    Button {
      Task { await model.acknowledge(row) }
    } label: {
      Image(systemName: ScheduleGlyph.close)
    }
    .buttonStyle(.virga(.ghost, size: .small, icon: true))
    .disabled(busy)
    .help("Dismiss")
    .accessibilityLabel("Dismiss")
    .accessibilityIdentifier("sched-note-dismiss")
  }
}

/// `.sched-group-label`: the day a run of rows goes out on, between them.
struct DayLabel: View {
  @Environment(\.virgaTheme) private var theme
  let label: String

  var body: some View {
    Text(label)
      .virgaText(.textSm, weight: VirgaWeight.semibold)
      .foregroundStyle(theme.ink2)
      .padding(.top, Measure.Schedule.groupLabelAbove)
      .padding(.bottom, Measure.Schedule.groupLabelBelow)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
      .accessibilityAddTraits(.isHeader)
  }
}
#endif
