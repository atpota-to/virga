// Ports src/posting/composer/Composer.jsx (Schedule and Add to queue: openWhen, submitSchedule, the queue's next slot shown before it's used, the limits and the room left; a scheduled post opened to edit; finishSource's scheduled half and retryCancelSource)
//
// Schedule opens the when panel (WhenPicker) at the next whole hour, and
// pressed again schedules the post for the time picked; Add to queue finds
// the weekly queue's next open time and adds the post there. Both read the
// account's limits first (a full allowance is said before anyone tries),
// ask about a timer there's no room for, check the post as one going out
// later, and send it to Virga's server (ScheduleSerialize, ScheduleService),
// creating a row or rewriting the one it was opened from. An intent's
// scheduledId opens that row in the composer (loadScheduledTarget, then its
// images read back as files). A post that went out from a scheduled row
// takes the row off, once retried; if it can't, the composer says so and
// offers to try again.
//
// The state this needs beside the post is ComposerScheduling (the web's
// whenOpen, queuePreview, limitsInfo, sourceWarning and scheduledRowRef),
// held by the controller as `scheduling`.

#if canImport(UIKit)
import Foundation
import Observation
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// The queue's next slot, shown before it's used: `{ status, at }`.
struct QueuePreview: Equatable {
  var status = "idle"
  var at: String?
}

/// The account's limits as last read: `{ did, status, value }`.
struct ComposerLimits {
  var did: String?
  var status = "idle"
  var value: JSONValue?
}

/// What Composer.jsx holds for scheduling beside the post.
@MainActor
@Observable
final class ComposerScheduling {
  /// The when panel is open (`whenOpen`).
  var whenOpen = false
  var preview = QueuePreview()
  var limits = ComposerLimits()
  /// The scheduled copy a post that went out couldn't take off.
  var sourceWarning = ""
  /// The row a scheduled post was opened from (`scheduledRowRef`).
  @ObservationIgnored var row: JSONValue?

  /// What goes when the composer holds another post.
  func forget() {
    row = nil
    whenOpen = false
    sourceWarning = ""
  }
}

/// A scheduled row and its images, read before they become the composer's
/// state (reconstructFromScheduled is async here).
struct ScheduledParts: Sendable {
  var row: JSONValue
  var media: JSONValue
}

extension ComposerController {
  // MARK: Reading

  /// Virga's server for the account the post goes out as, when it can schedule.
  var requester: VirgaBackend? { caps.canSchedule ? session.backendFor(asDid) : nil }

  /// The limits, once read for this account; loading otherwise.
  var limits: ComposerLimits {
    scheduling.limits.did.jsEquals(asDid) ? scheduling.limits : ComposerLimits(did: asDid, status: "loading")
  }

  /// `usageLine`: how much of the allowance is in use, for the send menu's foot.
  var usageLine: String {
    let limits = self.limits
    return limits.status == "ready" && caps.canSchedule ? ScheduleService.scheduledUsageLine(limits.value) : ""
  }

  /// The occurrence of a repeating post being edited, 1 for anything else.
  var editingOccurrence: Double {
    guard state.source?.kind == "scheduled", let row = scheduling.row, row["payload"]?["repeat"]?.isTruthy ?? false
    else { return 1 }
    let n = row["occurrence"]?.jsNumber ?? 0
    return n.isFinite && n != 0 ? n : 1
  }

  /// `nextHour(now)`: an hour from now, back to the start of its hour on this device's clock.
  static func nextHour(_ now: Double = Date().timeIntervalSince1970 * 1000) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = AppLocale.activeTimeZone()
    let at = Date(timeIntervalSince1970: (now + 3_600_000) / 1000)
    let start = calendar.dateInterval(of: .hour, for: at)?.start ?? at
    return JSDate.toISOString(start.timeIntervalSince1970 * 1000) ?? ""
  }

  // MARK: The limits (§6.6)

  @discardableResult
  func refreshLimits(_ did: String) async -> JSONValue? {
    let req = !did.isEmpty && session.capabilitiesFor(did).canSchedule ? session.backendFor(did) : nil
    guard let req else {
      scheduling.limits = ComposerLimits(did: did, status: "none")
      return nil
    }
    if !(scheduling.limits.did.jsEquals(did) && scheduling.limits.status == "ready") {
      scheduling.limits = ComposerLimits(did: did, status: "loading")
    }
    do {
      let value = try await ScheduleService.getLimits(req)
      scheduling.limits = ComposerLimits(did: did, status: "ready", value: value)
      return value
    } catch {
      scheduling.limits = ComposerLimits(did: did, status: "error")
      return nil
    }
  }

  /// With the limits read, a full allowance is said before anyone tries.
  func applyScheduleRoom(_ set: inout ComposerActionSet) {
    let limits = self.limits
    guard limits.status == "ready" else { return }
    let room = ScheduleService.scheduledRoomProblem(limits.value, editing: state.source?.kind == "scheduled")
    guard !room.isEmpty else { return }
    let off = ComposerActionState(disabled: true, reason: room)
    if !set.actions.schedule.disabled { set.actions.schedule = off }
    if !set.actions.queue.disabled { set.actions.queue = off }
  }

  // MARK: The when panel

  func openWhen() {
    scheduling.whenOpen = true
    if state.schedule?.mode != "at" { dispatch(.setSchedule(.at(Self.nextHour()))) }
  }

  /// An intent that asks for the queue or a time, on a post already here.
  func reopenScheduling(_ mode: String) {
    if mode == "queue" { dispatch(.setSchedule(.queue)) }
    if mode == "schedule" { openWhen() }
  }

  /// "Post now instead": the main button posts now until another time is chosen.
  func postNowInstead() {
    dispatch(.setSchedule(nil))
    scheduling.whenOpen = false
    postNow = true
  }

  /// The picker's time, keeping a repeat it has.
  func setWhen(_ iso: String?) {
    var schedule = state.schedule?.json.objectValue ?? [:]
    schedule["mode"] = "at"
    schedule["at"] = .string(iso ?? "")
    dispatch(.setSchedule(ComposerSchedule(json: .object(schedule))))
  }

  func setRepeat(_ rule: JSONValue?) {
    var schedule: [String: JSONValue] = ["mode": "at", "at": state.schedule?.json["at"] ?? .null]
    if let rule { schedule["repeat"] = rule }
    dispatch(.setSchedule(ComposerSchedule(json: .object(schedule))))
  }

  /// The queue's next slot, shown before it's used.
  func readQueuePreview() async {
    guard state.schedule?.mode == "queue", let requester else { return }
    scheduling.preview = QueuePreview(status: "loading", at: nil)
    let queue = settings.queue.json
    let excludeId: JSONValue = state.source?.kind == "scheduled" ? state.source?.id ?? .null : .null
    do {
      let rows = try await ScheduleService.listScheduled(requester).rows
      if Task.isCancelled { return }
      let slot = try PostingQueue.nextOpenSlot(
        queue, ComposerSubmit.queueSlotRows(rows, excludeId: excludeId), now: ScheduleText.now())
      scheduling.preview = QueuePreview(status: "ready", at: slot.flatMap { JSDate.toISOString($0) })
    } catch {
      if !Task.isCancelled { scheduling.preview = QueuePreview(status: "error", at: nil) }
    }
  }

  // MARK: Sending (submitSchedule)

  func runSchedule(_ action: String) {
    if action == PublishActions.schedule {
      if state.schedule?.mode != "at" || !scheduling.whenOpen {
        openWhen()
      } else {
        publishTask = Task { await submitSchedule(false) }
      }
    } else {
      publishTask = Task { await submitSchedule(true) }
    }
  }

  func submitSchedule(_ queued: Bool) async {
    var s = state
    let did = s.asDid
    error = nil
    let action = queued ? PublishActions.queue : PublishActions.schedule
    let a = actionSet.actions[action]
    if a.disabled {
      error = ComposerErrorLine(text: a.reason ?? "")
      return
    }
    guard let req = session.backendFor(did) else {
      error = ComposerErrorLine(text: PublishActions.needsBackendHint(session.authMode))
      return
    }
    let editing = s.source?.kind == "scheduled" ? s.source : nil
    let editingRow = editing != nil ? scheduling.row : nil
    let settings = self.settings
    let attempt = startBusy(action, queued ? "Finding the next open time" : "Scheduling")
    defer { endBusy(attempt) }
    do {
      let limitsNow = await refreshLimits(did)
      let room = ScheduleService.scheduledRoomProblem(limitsNow, editing: editing != nil)
      if !room.isEmpty { throw ScheduleSaid(message: room, code: "ROOM") }
      if s.lifespan["enabled"]?.isTruthy ?? false {
        let problem = SelfDestruct.timerRoomProblem(s.lifespan, limitsNow, holds: editingRow?["payload"]?["selfDestruct"])
        if !problem.isEmpty {
          let choice = await askUser(
            ComposerAsk(
              title: "No free timer", body: "\(problem) Schedule it without the timer, or keep editing.",
              choices: [
                .init(value: "edit", label: "Keep editing"), .init(value: "without", label: "Schedule without it", primary: true),
              ]))
          if choice != "without" { return }
          var lifespan = s.lifespan.objectValue ?? [:]
          lifespan["enabled"] = false
          s.lifespan = .object(lifespan)
          model.lifespanTouched = true
          dispatch(.setLifespan(s.lifespan))
        }
      }
      var scheduledFor: JSONValue
      var moveNote = ""
      if queued {
        let rows = try await ScheduleService.listScheduled(req).rows
        let at = ScheduleText.now()
        let slot = try PostingQueue.nextOpenSlot(
          settings.queue.json, ComposerSubmit.queueSlotRows(rows, excludeId: editing?.id ?? .null), now: at)
        guard let slot else {
          throw ScheduleSaid(
            message:
              "Your weekly schedule has no open times in the next 90 days. Add some in Posting › Weekly schedule.")
        }
        scheduledFor = JSDate.toISOString(slot).map(JSONValue.string) ?? .null
        if let editingRow { moveNote = PostingQueue.queueSlotMoveNote(editingRow, when: slot, now: ScheduleText.now()) }
      } else {
        scheduledFor = s.schedule?.json["at"] ?? .null
      }
      var check = s
      check.schedule = queued ? ComposerSchedule.queue : s.schedule
      let publishAt = TimeValue.ms(scheduledFor)
      let problems = ComposerModel.validateComposer(
        check, now: Date(), forSchedule: true, requireAltText: settings.requireAltText,
        lifespanProblem: { rule in SelfDestruct.scheduledTimerProblem(rule, publishAt, now: ScheduleText.now()) })
      if let first = problems.first {
        if let index = first.postIndex, state.posts.indices.contains(index) { focusPostId = state.posts[index].id }
        throw ScheduleSaid(message: first.message)
      }
      s = await ensureGates(s)
      if busy != nil { busy?.line = editing != nil ? "Saving the changes" : queued ? "Adding it to the queue" : "Scheduling" }
      let media = draftMedia(did)
      let body = try await ScheduleSerialize.serializeForSchedule(
        s,
        ScheduleSerializeOptions(
          now: ScheduleText.now(), scheduledFor: scheduledFor, queued: queued,
          // A repeating post keeps its wall clock in the zone its time was picked in.
          repeatTz: PostingQueue.resolveTimezone(settings.queue.json),
          occurrence: editingRow?["payload"]?["repeat"]?.isTruthy ?? false ? editingOccurrence : 1,
          fit: SelfDestruct.composerTimerFit(reply: s.reply != nil),
          loadImage: { image in
            guard let ref = image["localRef"]?.stringValue, !ref.isEmpty else { return nil }
            return await media.get(ref)?.file.flatMap { ComposerFile(json: $0) }
          },
          media: PublishMedia(files: TemporaryComposerFiles(), encoder: ImageIOEncoder(), transport: transport)))
      let row =
        editing != nil
        ? try await ScheduleService.updateScheduled(req, editing?.id, body.json)
        : try await ScheduleService.createScheduled(req, body.json)
      if s.source?.kind == "draft" { await finishDraftAfterScheduling(s) }
      let at = row["scheduledFor"].flatMap { $0.isTruthy ? $0 : nil } ?? scheduledFor
      let said = ComposerSubmit.scheduledMessage(
        at: at, queued: queued, editing: editing != nil, account: accountJSON(did), did: did, now: ScheduleText.now(),
        repeat: body.payload["repeat"])
      toasts.push(moveNote.isEmpty ? said : "\(said) \(moveNote)", seconds: Measure.Schedule.scheduledToastSeconds)
      for warning in body.warnings {
        if let text = warning["message"]?.stringValue { toasts.push(text, seconds: Measure.Schedule.skipToastSeconds) }
      }
      Task { await self.refreshLimits(did) }
      resetAfterSend(did)
    } catch {
      let object = ScheduledPostError.errorObject(error)
      let message = Self.optionalMessage(error)
      let friendly = ScheduledPostError.scheduleErrorMessage(error)
      let text =
        object["code"] == "ROOM"
        ? message ?? "" : !friendly.isEmpty ? friendly : message ?? "That didn’t work. Try again."
      self.error = ComposerErrorLine(text: text)
    }
  }

  /// A scheduled draft: its draft goes, and if it can't, the toast says so.
  func finishDraftAfterScheduling(_ s: ComposerState) async {
    guard let source = s.source, let id = source.id?.stringValue, !id.isEmpty else { return }
    let owner = source.ownerDid ?? s.asDid
    do {
      let agent = try await session.agentFor(owner)
      let refs = DraftMedia.stateLocalRefs(s.json).map(JSONValue.string)
      try await Drafts.deleteDraft(agent, id, localRefs: refs, media: draftMedia(owner))
    } catch {
      toasts.push(
        "Scheduled, but its draft couldn’t be deleted. Delete it in Drafts.", danger: true,
        seconds: Measure.Schedule.longToastSeconds)
    }
  }

  // MARK: A scheduled post opened to edit (§6.3)

  func loadScheduled(_ id: String, asDid: String, token: Int) {
    let req = session.capabilitiesFor(asDid).canSchedule ? session.backendFor(asDid) : nil
    Task {
      do {
        let target = try await ComposerLoaders.loadScheduledTarget(
          id: .string(id), asDid: asDid, req: req,
          getScheduled: { r, i in try await ScheduleService.getScheduled(r, i) },
          getScheduledMedia: { r, i in try await ScheduleService.getScheduledMedia(r, i) },
          reconstructFromScheduled: { row, media, _ in ScheduledParts(row: row, media: media) })
        let loaded = try await ScheduleSerialize.reconstructFromScheduled(
          target.state.row, target.state.media, asDid: asDid, files: TemporaryComposerFiles(),
          makePreviewUrl: Self.previewOfFile)
        guard self.loadToken == token else { return }
        self.scheduling.row = target.row
        self.loadState(loaded, touched: true)
        self.loads = [:]
        self.scheduling.whenOpen = loaded.schedule?.mode == "at"
        // A scheduled reply keeps the refs it goes out with and a note of
        // who it answers; the post itself is read again to show it whole.
        if let reply = loaded.reply, !reply.uri.isEmpty, !(reply.view?.isTruthy ?? false) {
          let ref: JSONValue = ["kind": "post", "uri": .string(reply.uri), "soft": true, "scheduled": true]
          self.replyRefPending = ref
          self.loadReply(ref, token: token)
        }
      } catch {
        guard self.loadToken == token else { return }
        self.loads["scheduled"] = .failed(Self.message(error), soft: false)
      }
    }
  }

  // MARK: After a post from a scheduled row went out (finishSource)

  /// Takes the scheduled copy off (one retry). False when it couldn't, and
  /// the composer holds on to the post to try again.
  func finishScheduledSource(_ s: ComposerState) async -> Bool {
    let session = self.session
    let requester = session.backendFor(s.asDid)
    let result = await ComposerSubmit.finishSource(
      s.source?.json, asDid: s.asDid,
      agentFor: { did in try await session.agentFor(did) },
      backendFor: { _ in requester },
      deleteDraft: { _, _ in },
      cancelScheduled: { req, id in _ = try await ScheduleService.cancelScheduled(req, id) })
    if result.keepSource {
      scheduling.sourceWarning = result.warning
      return false
    }
    if !result.warning.isEmpty { toasts.push(result.warning, danger: true, seconds: Measure.Schedule.warningToastSeconds) }
    return true
  }

  /// "Cancel the scheduled copy", after it couldn't be taken off.
  func retryCancelSource() {
    let s = state
    Task {
      guard await self.finishScheduledSource(s) else { return }
      self.toasts.push("The scheduled copy is cancelled.")
      self.resetAfterSend(s.asDid)
    }
  }
}
#endif
