// Ports src/posting/pages/ScheduledPage.jsx (its state: the list, the clock, reordering, the row actions)
//
// What ScheduledPage.jsx holds beside what it draws: the account's list
// (ScheduledListLoad, read again on a scheduling or timer event), the
// clock that moves on once a minute, the rows busy with an action, the
// message over the page, the optimistic redraw while a new order is saved
// (`redraw`, the web's `override`), the row being moved (`drag`), the row picked out from the
// calendar (`lit`), what is announced, and the question up (`confirm`).
// The functions keep the web's names: commitOrder, positionPhrase, retry,
// cancel, postNow, skip, stopRepeat, acknowledge, pick.

#if canImport(UIKit)
import Foundation
import Observation
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// The message over the page: `{ tone, text }`.
struct ScheduledMessage: Equatable {
  var danger: Bool
  var text: String
}

/// The row being moved: `{ id, order, via }`.
struct QueueDrag: Equatable {
  enum Via { case pointer, keys }
  var id: JSONValue
  var order: [JSONValue]
  var via: Via
}

/// The question up: `{ kind, row }` (its `run` is the model's).
struct ScheduledConfirm: Equatable {
  enum Kind { case cancel, now, skip, stop }
  var kind: Kind
  var row: JSONValue
}

/// A reorder that moved some rows and not others (`REORDER_PARTIAL`).
struct ReorderPartial: Error {}

@MainActor
@Observable
final class ScheduledPageModel {
  @ObservationIgnored let did: String?
  @ObservationIgnored let session: SessionModel
  @ObservationIgnored let requester: VirgaBackend?
  @ObservationIgnored let transport: any HTTPTransport
  @ObservationIgnored let clock: NetworkClock
  let settings: PostingSettingsModel
  let load: ScheduledListLoad

  var now: Double = ScheduleText.now()
  /// Row ids (and "reorder") busy with an action.
  var busy: Set<String> = []
  var message: ScheduledMessage?
  var redraw: (generation: Int, rows: [JSONValue])?
  var drag: QueueDrag?
  var lit: JSONValue?
  var announce = ""
  var confirm: ScheduledConfirm?
  /// A row to bring into view (pick), once it's drawn.
  var scrollTarget: String?

  @ObservationIgnored private var ticker: Task<Void, Never>?
  @ObservationIgnored private var litTask: Task<Void, Never>?

  init(
    session: SessionModel, store: (any KeyValueStore)?, did: String?, transport: any HTTPTransport, clock: NetworkClock
  ) {
    self.did = did
    self.session = session
    self.transport = transport
    self.clock = clock
    let requester = session.backendFor(did)
    self.requester = requester
    settings = PostingSettingsModel(did: did, store: store, language: Locale.preferredLanguages.first)
    load = ScheduledListLoad(
      did: did, requester: requester, withLimits: true,
      events: [PostingEvents.scheduledChangedEvent, PostingEvents.timersChangedEvent])
  }

  // MARK: Starting and stopping

  /// The read, and the clock: relative times move on, and a post whose
  /// time has come is looked for again (once a minute, never mid-drag).
  func start() {
    load.start()
    ticker?.cancel()
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: UInt64(Measure.Schedule.clockSeconds * 1_000_000_000))
        guard !Task.isCancelled, let self else { return }
        self.tick()
      }
    }
  }

  func stop() {
    ticker?.cancel()
    ticker = nil
    litTask?.cancel()
    load.stop()
    settings.stop()
  }

  func tick() {
    let at = ScheduleText.now()
    now = at
    let due = (load.list?.rows ?? []).contains { r in
      r["status"] == "pending" && TimeValue.ms(r["scheduledFor"]) <= at
    }
    if due && busy.isEmpty && drag == nil { load.reload() }
  }

  // MARK: What's drawn

  var schedule: JSONValue { settings.settings.queue.json }
  var tz: String { PostingQueue.resolveTimezone(schedule) }

  var name: String {
    let account = session.accounts.first { $0.did.jsEquals(did ?? "") }
    return Accounts.accountName(account)
  }

  var saved: [JSONValue] { load.list?.rows ?? [] }

  var rows: [JSONValue] {
    if let redraw, redraw.generation == load.generation { return redraw.rows }
    return saved
  }

  var movable: [JSONValue] { ScheduleModel.movableIds(rows, now: now) }

  var canReorder: Bool { !PostingQueue.isScheduleEmpty(schedule) && movable.count > 1 }

  /// While a row is being moved, the queue is drawn at the times the new
  /// order would give it.
  var shown: [JSONValue] {
    guard let drag, !ScheduleIds.sameOrder(drag.order, movable),
      let plan = try? QueueReorder.planQueueReorder(schedule, rows, drag.order, now: now)
    else { return rows }
    return ScheduleModel.applyAssignment(rows, plan.assignment)
  }

  var sections: ScheduledSections { ScheduleModel.scheduledSections(shown) }

  func isBusy(_ row: JSONValue) -> Bool { busy.contains(ScheduleIds.key(row["id"])) }

  func setRowBusy(_ id: String, _ on: Bool) {
    if on { busy.insert(id) } else { busy.remove(id) }
  }

  // MARK: Reordering

  func commitOrder(_ order: [JSONValue]) async {
    let at = ScheduleText.now()
    let rows = self.rows
    guard let plan = try? QueueReorder.planQueueReorder(schedule, rows, order, now: at) else { return }
    if let conflict = plan.conflict {
      message = ScheduledMessage(danger: false, text: conflict.message)
      announce = conflict.message
      return
    }
    if plan.moves.isEmpty { return }
    message = nil
    redraw = (generation: load.generation, rows: ScheduleModel.applyAssignment(rows, plan.assignment))
    setRowBusy("reorder", true)
    defer { setRowBusy("reorder", false) }
    do {
      let out = try await ScheduleService.reorderScheduled(requester, plan.moves)
      if out.fallback && !out.failed.isEmpty {
        // Some rows moved and some didn't: start again from what was saved.
        let fresh = try await ScheduleService.listScheduled(requester)
        let again = try QueueReorder.planQueueReorder(schedule, fresh.rows, order, now: ScheduleText.now())
        var retry: ReorderResult?
        if again.conflict == nil && !again.moves.isEmpty {
          retry = try await ScheduleService.reorderScheduled(requester, again.moves)
        }
        if again.conflict != nil || !(retry?.failed.isEmpty ?? true) {
          throw retry?.refusal ?? ReorderPartial()
        }
      }
      announce = "The new order is saved."
    } catch {
      let text =
        error is ReorderPartial
        ? "Couldn’t save the whole new order. The queue below is what’s saved."
        : ScheduledPostError.reorderRefusal(error) ?? "Couldn’t save the new order. The queue below is what’s saved."
      message = ScheduledMessage(danger: true, text: text)
      announce = text
      redraw = nil
      load.reload()
    }
  }

  /// "Place 2 of 5, Tue, Nov 17, 9:00 AM."
  func positionPhrase(_ order: [JSONValue], _ id: JSONValue) -> String {
    let same = ScheduleIds.sameOrder(order, movable)
    let at: JSONValue?
    if same {
      at = rows.first { ScheduleIds.same($0["id"], id) }?["scheduledFor"]
    } else {
      let plan = try? QueueReorder.planQueueReorder(schedule, rows, order, now: ScheduleText.now())
      at = plan?.assignment.first { ScheduleIds.same($0.id, id) }?.newScheduledFor.map(JSONValue.string)
    }
    let place = (ScheduleIds.index(order, id) ?? -1) + 1
    let when = at.flatMap { $0.isTruthy ? $0 : nil }.map { ", \(ScheduleModel.formatInZone($0, tz, now: ScheduleText.now()))" } ?? ""
    return "Place \(place) of \(order.count)\(when)."
  }

  /// A step earlier or later (a phone's arrows, VoiceOver's adjust).
  func step(_ id: JSONValue, _ delta: Double) {
    let order = ScheduleModel.moveId(movable, id, delta)
    Task { await commitOrder(order) }
  }

  /// The keys on a handle: Space or Return picks it up and puts it down,
  /// the arrows move it, Escape puts it back.
  func key(_ id: JSONValue, _ press: KeyMove) -> Bool {
    if busy.contains("reorder") { return false }
    switch press {
    case .pickOrDrop:
      if drag == nil {
        drag = QueueDrag(id: id, order: movable, via: .keys)
        announce =
          "Picked up. \(positionPhrase(movable, id)) Use the up and down arrows to move it, and Space to put it down."
      } else if let drag, ScheduleIds.same(drag.id, id) {
        let order = drag.order
        self.drag = nil
        if !ScheduleIds.sameOrder(order, movable) {
          announce = "Put down. \(positionPhrase(order, id)) Saving the new order."
          Task { await commitOrder(order) }
        } else {
          announce = "Put down where it was."
        }
      }
      return true
    case .earlier, .later:
      guard let drag, ScheduleIds.same(drag.id, id) else { return false }
      let next = ScheduleModel.moveId(drag.order, id, press == .earlier ? -1 : 1)
      self.drag = QueueDrag(id: id, order: next, via: .keys)
      announce = positionPhrase(next, id)
      return true
    case .back:
      guard let drag, ScheduleIds.same(drag.id, id) else { return false }
      self.drag = nil
      announce = "Put back. The order hasn’t changed."
      return true
    }
  }

  enum KeyMove { case pickOrDrop, earlier, later, back }

  /// A drag on a handle: picked up, moved over the others (`others` are the
  /// movable rows on screen, top to bottom, with their middles), put down.
  func dragMoved(_ id: JSONValue, y: CGFloat, others: [(id: JSONValue, midY: CGFloat)]) {
    if busy.contains("reorder") { return }
    if drag == nil { drag = QueueDrag(id: id, order: movable, via: .pointer) }
    guard let drag, ScheduleIds.same(drag.id, id), drag.via == .pointer else { return }
    let rest = others.filter { !ScheduleIds.same($0.id, id) }
    let index = rest.filter { $0.midY < y }.count
    var ids = rest.map(\.id)
    ids.insert(id, at: Swift.min(index, ids.count))
    // Only the rows on screen are measured; keep any others where they were.
    let next =
      movable.allSatisfy({ ScheduleIds.contains(ids, $0) })
      ? ids : ScheduleModel.moveIdTo(drag.order, id, Double(index))
    if !ScheduleIds.sameOrder(next, drag.order) { self.drag = QueueDrag(id: id, order: next, via: .pointer) }
  }

  func dragEnded() {
    guard let drag, drag.via == .pointer else { return }
    let order = drag.order
    self.drag = nil
    if !ScheduleIds.sameOrder(order, movable) { Task { await commitOrder(order) } }
  }

  // MARK: Row actions

  func retry(_ row: JSONValue, toasts: ToastCenter?) async {
    let id = ScheduleIds.key(row["id"])
    setRowBusy(id, true)
    defer { setRowBusy(id, false) }
    do {
      _ = try await ScheduleService.retryScheduled(requester, row["id"])
      toasts?.push(
        row["partial"]?.isTruthy ?? false
          ? "The rest of the thread goes out in a moment." : "It goes out again in a moment.")
    } catch {
      message = ScheduledMessage(danger: true, text: ScheduledPostError.scheduleErrorMessage(error))
    }
  }

  static func status(_ error: any Error) -> JSONValue? { ScheduledPostError.errorObject(error)["status"] }

  func runCancel(_ row: JSONValue, toasts: ToastCenter?) async throws {
    do {
      _ = try await ScheduleService.cancelScheduled(requester, row["id"])
      toasts?.push(row["status"] == "failed" ? "Dismissed." : "Removed from the schedule.")
    } catch {
      let object = ScheduledPostError.errorObject(error)
      if object["code"]?.stringValue?.jsEquals("NOT_CANCELLABLE") ?? false || object["status"] == .number(409) {
        load.reload()
      }
      throw ScheduleSaid(message: ScheduledPostError.scheduleErrorMessage(error))
    }
  }

  func runPostNow(_ row: JSONValue, toasts: ToastCenter?) async throws {
    guard let did else { return }
    let id = ScheduleIds.key(row["id"])
    setRowBusy(id, true)
    defer { setRowBusy(id, false) }
    let session = self.session
    let files = TemporaryComposerFiles()
    let media = PublishMedia(files: files, encoder: ImageIOEncoder(), transport: transport, clock: clock)
    let deps = PostScheduledNowDeps<PublishTarget?>.live(
      requester: requester, timers: requester, files: files, media: media,
      targetFor: { did in
        let target = try await session.targetFor(did)
        return PublishTarget(did: target.did, agent: target.agent, pdsUrl: target.pdsUrl)
      },
      now: { Date().timeIntervalSince1970 * 1000 }, makePreviewUrl: ComposerController.previewOfFile)
    do {
      let out = try await ScheduleModel.postScheduledNow(row, did: did, deps: deps, now: ScheduleText.now())
      toasts?.push((["Posted."] + out.notes).joined(separator: " "), seconds: out.notes.isEmpty ? Measure.Toast.seconds : Measure.Schedule.longToastSeconds)
    } catch {
      let object = ScheduledPostError.errorObject(error)
      let said = object["message"]?.stringValue ?? ""
      let text =
        (object["code"]?.isTruthy ?? false) && !said.isEmpty ? said : ScheduledPostError.scheduleErrorMessage(error)
      throw ScheduleSaid(message: text)
    }
  }

  func runSkip(_ row: JSONValue, toasts: ToastCenter?) async throws {
    do {
      let out = try await ScheduleService.skipScheduled(requester, row["id"])
      toasts?.push(
        out.ended
          ? "Skipped. That was the last one, so it has stopped repeating."
          : "Skipped. The next one goes out \(ScheduleModel.formatInZone(out.next["scheduledFor"], tz, now: ScheduleText.now())).",
        seconds: Measure.Schedule.skipToastSeconds)
    } catch {
      if Self.status(error) == .number(409) { load.reload() }
      throw ScheduleSaid(message: ScheduledPostError.scheduleErrorMessage(error))
    }
  }

  func runStopRepeat(_ row: JSONValue, toasts: ToastCenter?) async throws {
    do {
      _ = try await ScheduleService.stopRepeating(requester, row["id"])
      toasts?.push(row["status"] == "failed" ? "It won’t repeat any more." : "It goes out once more, then stops.")
    } catch {
      if Self.status(error) == .number(409) { load.reload() }
      throw ScheduleSaid(message: ScheduledPostError.scheduleErrorMessage(error))
    }
  }

  /// The question's action, whichever it is.
  func run(_ ask: ScheduledConfirm, toasts: ToastCenter?) async throws {
    switch ask.kind {
    case .cancel: try await runCancel(ask.row, toasts: toasts)
    case .now: try await runPostNow(ask.row, toasts: toasts)
    case .skip: try await runSkip(ask.row, toasts: toasts)
    case .stop: try await runStopRepeat(ask.row, toasts: toasts)
    }
  }

  func acknowledge(_ row: JSONValue) async {
    let id = ScheduleIds.key(row["id"])
    setRowBusy(id, true)
    defer { setRowBusy(id, false) }
    do {
      _ = try await ScheduleService.acknowledgeTimerNote(requester, row["id"])
    } catch {
      message = ScheduledMessage(danger: true, text: ScheduledPostError.scheduleErrorMessage(error))
    }
  }

  /// A taken time in the week, pressed: its row brought into view and lit
  /// for a moment.
  func pick(_ row: JSONValue) {
    let id = row["id"] ?? .null
    scrollTarget = "sched-row-\(ScheduleIds.key(id))"
    lit = id
    litTask?.cancel()
    litTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(Measure.Schedule.litSeconds * 1_000_000_000))
      guard !Task.isCancelled, let self else { return }
      if let lit = self.lit, ScheduleIds.same(lit, id) { self.lit = nil }
    }
  }
}

/// A row's time as epoch ms (`Date.parse`), NaN when it has none.
enum TimeValue {
  static func ms(_ value: JSONValue?) -> Double {
    guard let text = value?.stringValue, !text.isEmpty else {
      if case .number(let n)? = value { return n }
      return .nan
    }
    return JSDate.parse(text, timeZone: AppLocale.activeTimeZone())
  }
}
#endif
