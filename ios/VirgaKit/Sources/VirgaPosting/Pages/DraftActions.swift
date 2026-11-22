// Ports src/posting/pages/draftActions.js
//
// The Drafts page's quick actions, outside the view: post a draft now, or
// schedule it, without opening the composer. Each goes through the same
// steps the composer would: open the draft with the account's posting
// defaults, refuse when its pictures aren't on this device, settle who can
// reply, then publish or schedule. The draft is deleted only after that has
// worked, so a failure keeps it.
//
// Everything that touches the network arrives as closures
// (DraftActionDeps; `live(...)` wires the app's services as the Drafts
// page does), so the tests can stand in for it.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// A quick action's refusal: MEDIA_MISSING or NEEDS_BACKEND.
public struct DraftActionError: Error, LocalizedError, ScheduleErrorObject, JSErrorConvertible, Hashable, Sendable {
  public var code: String
  public var message: String

  public init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }

  public var errorDescription: String? { message }
  public var errorObject: JSONValue { ["name": "Error", "message": .string(message), "code": .string(code)] }
  public var jsFields: JSErrorFields { JSErrorFields(message: message, code: .string(code)) }
}

/// What a quick schedule hands the serializer.
public struct DraftScheduleRequest: Sendable {
  public var now: Double
  public var scheduledFor: JSONValue?
  public var queued: Bool
  public var resolveMention: ResolveMention?
  public var loadImage: (@Sendable (JSONValue) async throws -> ComposerFile?)?
}

/// What the quick actions work with (the web's `deps`). `Target` is what
/// `targetFor` gives and `publish` takes (the write account).
public struct DraftActionDeps<Target: Sendable>: Sendable {
  /// openDraft(view, asDid, defaults).
  public var openDraft: @Sendable (JSONValue, String, JSONValue?) async throws -> DraftMedia.Loaded
  /// resolveDefaultGates(settings, agent).
  public var resolveDefaultGates: @Sendable (JSONValue?, XRPCAgent?) async throws -> ResolvedDefaultGates
  /// Why the rule can't be set ('' when it can); nil drops any timer (a
  /// browser session, or no long session).
  public var timerRoom: (@Sendable (JSONValue) async throws -> String?)?
  public var targetFor: @Sendable (String) async throws -> Target
  /// publish(state, target, resolveMention, requireAltText): publish's result.
  public var publish: @Sendable (JSONValue, Target, ResolveMention?, Bool) async throws -> JSONValue
  /// emitPostsChanged(did, added).
  public var emitPostsChanged: @Sendable (String, [JSONValue]) throws -> Void
  /// deleteDraft(agent, id).
  public var deleteDraft: @Sendable (XRPCAgent?, JSONValue) async throws -> Void
  public var resolveMention: ResolveMention?
  public var armTimer: (@Sendable (JSONValue, JSONValue) async throws -> ArmOutcome?)?
  /// serializeForSchedule(state, request): the create body.
  public var serializeForSchedule: @Sendable (JSONValue, DraftScheduleRequest) async throws -> JSONValue
  /// createScheduled(requester, body): the server's row.
  public var createScheduled: @Sendable (any ScheduleRequester, JSONValue) async throws -> JSONValue
  public var requester: (any ScheduleRequester)?
  public var loadImage: (@Sendable (JSONValue) async throws -> ComposerFile?)?

  public init(
    openDraft: @escaping @Sendable (JSONValue, String, JSONValue?) async throws -> DraftMedia.Loaded,
    resolveDefaultGates: @escaping @Sendable (JSONValue?, XRPCAgent?) async throws -> ResolvedDefaultGates,
    timerRoom: (@Sendable (JSONValue) async throws -> String?)? = nil,
    targetFor: @escaping @Sendable (String) async throws -> Target,
    publish: @escaping @Sendable (JSONValue, Target, ResolveMention?, Bool) async throws -> JSONValue,
    emitPostsChanged: @escaping @Sendable (String, [JSONValue]) throws -> Void,
    deleteDraft: @escaping @Sendable (XRPCAgent?, JSONValue) async throws -> Void,
    resolveMention: ResolveMention? = nil,
    armTimer: (@Sendable (JSONValue, JSONValue) async throws -> ArmOutcome?)? = nil,
    serializeForSchedule: @escaping @Sendable (JSONValue, DraftScheduleRequest) async throws -> JSONValue,
    createScheduled: @escaping @Sendable (any ScheduleRequester, JSONValue) async throws -> JSONValue,
    requester: (any ScheduleRequester)? = nil,
    loadImage: (@Sendable (JSONValue) async throws -> ComposerFile?)? = nil
  ) {
    self.openDraft = openDraft
    self.resolveDefaultGates = resolveDefaultGates
    self.timerRoom = timerRoom
    self.targetFor = targetFor
    self.publish = publish
    self.emitPostsChanged = emitPostsChanged
    self.deleteDraft = deleteDraft
    self.resolveMention = resolveMention
    self.armTimer = armTimer
    self.serializeForSchedule = serializeForSchedule
    self.createScheduled = createScheduled
    self.requester = requester
    self.loadImage = loadImage
  }
}

extension DraftActionDeps where Target == PublishTarget? {
  /// The app's services, as the Drafts page wires them: the draft opened
  /// with this device's media, the account's default gates read through
  /// its agent, the timer limits from Virga's server, publish, the drafts
  /// service, the serializer and the schedule service, and the account's
  /// PDS for pictures a draft names by blob.
  public static func live(
    did: String, target: PublishTarget?, requester: (any ScheduleRequester)?, timers: (any TimerRequester)?,
    media: PublishMedia, draftMedia: (any DraftMediaStore)? = nil,
    makePreviewUrl: (@Sendable (JSONValue) throws -> String?)? = nil, resolveMention: ResolveMention? = nil,
    now: @escaping @Sendable () -> Double, events: PostingEventBus? = .shared, timeZone: TimeZone? = nil
  ) -> DraftActionDeps<PublishTarget?> {
    DraftActionDeps<PublishTarget?>(
      openDraft: { view, asDid, defaults in
        await Drafts.openDraft(view, asDid: asDid, defaults: defaults, media: draftMedia, makePreviewUrl: makePreviewUrl)
      },
      resolveDefaultGates: { settings, agent in
        var read: (@Sendable () async throws -> JSONValue?)?
        if let gates = agent?.gatesAgent { read = { await Gates.readDefaultGates(gates)?.json } }
        return try await PostingSettingsStore.resolveDefaultGates(settings, readDefaultGates: read)
      },
      timerRoom: requester.map { req -> @Sendable (JSONValue) async throws -> String? in
        { @Sendable rule in
          let limits = try? await ScheduleService.getLimits(req)
          return SelfDestruct.timerRoomProblem(rule, limits)
        }
      },
      targetFor: { _ in target },
      publish: { state, target, resolve, requireAltText in
        let result = try await Publish.publish(
          state, target, media: media, resolveMention: resolve, now: now, requireAltText: requireAltText,
          timeZone: timeZone)
        return (try? JSONValue(encoding: result)) ?? .null
      },
      emitPostsChanged: { did, added in try PostingEvents.emitPostsChanged(did, added: added, target: events) },
      deleteDraft: { agent, id in try await Drafts.deleteDraft(agent, id.stringValue, media: draftMedia, target: events) },
      resolveMention: resolveMention,
      armTimer: timers.map { req -> @Sendable (JSONValue, JSONValue) async throws -> ArmOutcome? in
        { @Sendable result, state in
          let at = now()
          return await TimerService.armAfterPublish(
            req, result, state["lifespan"] ?? .null,
            snippet: TimerService.timerSnippet(state["posts"]?[0]?["text"]).map(JSONValue.string) ?? .null,
            postedAt: JSDate.toISOString(at),
            fit: SelfDestruct.composerTimerFit(reply: ComposerJS.truthy(state["reply"])), now: at, timeZone: timeZone)
        }
      },
      serializeForSchedule: { state, request in
        try await ScheduleSerialize.serializeForSchedule(
          state,
          ScheduleSerializeOptions(
            now: request.now, scheduledFor: request.scheduledFor, queued: request.queued,
            resolveMention: request.resolveMention, loadImage: request.loadImage, media: media, timeZone: timeZone)
        ).json
      },
      createScheduled: { req, body in try await ScheduleService.createScheduled(req, body, target: events, timeZone: timeZone) },
      requester: requester,
      loadImage: DraftActions.blobImageLoader(
        did: did, pdsUrl: target?.pdsUrl, transport: media.transport, files: media.files))
  }
}

/// prepareDraft's answer.
public struct PreparedDraft: Hashable, Sendable {
  public var state: JSONValue
  public var notes: [String]
}

/// postDraftNow's answer.
public struct PostedDraft: Sendable {
  public var result: JSONValue
  public var notes: [String]
  public var timer: ArmOutcome?
  /// Whether the draft could be removed afterwards.
  public var deleted: Bool
}

/// scheduleDraft's answer.
public struct ScheduledDraft: Sendable {
  public var row: JSONValue
  public var notes: [String]
  public var deleted: Bool
}

public enum DraftActions {
  /// The meta line under a draft in a list (summarizeDraft's row), as short
  /// parts: each is one item of a meta line, which puts the dots between
  /// them. `now` is epoch ms; dates are said in `locale` on `timeZone`.
  public static func draftMeta(_ row: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil)
    -> [String]
  {
    guard let row, row.isTruthy else { return [] }
    var parts: [String] = []
    if ComposerJS.truthy(row["isThread"]) { parts.append("Thread of \(row["posts"].map(\.jsString) ?? "undefined")") }
    if ComposerJS.truthy(row["isReply"]) { parts.append("Reply") }
    if ComposerJS.truthy(row["images"]) { parts.append(HubModel.countPhrase(row["images"], "image", locale: locale)) }
    if ComposerJS.truthy(row["video"]) { parts.append("Video") }
    if ComposerJS.truthy(row["link"]) { parts.append("Link card") }
    if let record = row["record"], record.isTruthy { parts.append(recordWord(record)) }
    if ComposerJS.length(row["labels"]) > 0 { parts.append("Content warning") }
    if let tags = row["tags"]?.arrayValue, !tags.isEmpty {
      parts.append(tags.map { "#\($0.isNull ? "null" : $0.jsString)" }.joined(separator: " "))
    }
    if let name = row["deviceName"], name.isTruthy, !ComposerJS.truthy(row["savedHere"]) {
      parts.append("Saved in \(name.jsString)")
    }
    let edited = editedLabel(row["updatedAt"], now: now, locale: locale, timeZone: timeZone)
    if !edited.isEmpty { parts.insert(edited, at: 0) }
    return parts
  }

  static func recordWord(_ record: JSONValue?) -> String {
    switch record?["kind"]?.stringValue {
    case "feed"?: return "Shares a feed"
    case "list"?: return "Shares a list"
    case "starterpack"?: return "Shares a starter pack"
    default: return "Quotes a post"
    }
  }

  /// "Edited just now", "Edited 5 min ago", "Edited Nov 3".
  public static func editedLabel(_ iso: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil)
    -> String
  {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    guard let t = HubModel.time(iso, zone) else { return "" }
    let mins = ((now - t) / 60_000).jsRounded
    if mins < 1 { return "Edited just now" }
    if mins < 60 { return "Edited \(JSNumber.format(mins)) min ago" }
    let hrs = (mins / 60).jsRounded
    if hrs < 24 { return "Edited \(JSNumber.format(hrs)) hr ago" }
    let sameYear = JSDate.fields(t, timeZone: zone)?.year == JSDate.fields(now, timeZone: zone)?.year
      && JSDate.fields(now, timeZone: zone) != nil
    let options = DateFormatOptions(year: sameYear ? nil : "numeric", month: "short", day: "numeric")
    return "Edited \(AppLocale.toLocaleDateString(t, options, locale: locale, timeZone: zone))"
  }

  /// Why a draft row can't be scheduled from the list, or '' when it can:
  /// replies and videos can't be, and media kept on another device has to
  /// be attached again first.
  public static func draftScheduleBlock(_ row: JSONValue?, canSchedule: Bool) -> String {
    if !canSchedule { return "Scheduling needs a long session." }
    if ComposerJS.truthy(row?["isReply"]) { return "Replies can’t be scheduled. Post it now instead." }
    if ComposerJS.truthy(row?["video"]) { return "Posts with video can’t be scheduled. Post it now instead." }
    if ComposerJS.truthy(row?["mediaElsewhere"]) {
      return "Its images were saved on another device. Open it to attach them again."
    }
    return ""
  }

  /// Why a draft row can't be posted from the list, or '' when it can.
  public static func draftPostBlock(_ row: JSONValue?, canPost: Bool) -> String {
    if !canPost { return "Virga needs permission to post." }
    if ComposerJS.truthy(row?["mediaElsewhere"]) {
      return "Its images were saved on another device. Open it to attach them again."
    }
    if let row, row.isTruthy, ComposerJS.trimmed(row["text"]).isEmpty, !ComposerJS.truthy(row["images"]),
      !ComposerJS.truthy(row["video"]), !ComposerJS.truthy(row["link"]), !ComposerJS.truthy(row["record"])
    {
      return "There’s nothing in it to post yet."
    }
    return ""
  }

  /// The draft as a ComposerState ready to go out: opened with the
  /// account's posting settings as defaults (openDraft fills in the
  /// pictures this device keeps), refused when some are missing, with the
  /// reply settings resolved when the draft didn't choose any, and its
  /// default timer kept only where it can be set.
  public static func prepareDraft<Target>(
    _ view: JSONValue, did: String, settings: JSONValue?, agent: XRPCAgent?, deps: DraftActionDeps<Target>
  ) async throws -> PreparedDraft {
    let opened = try await deps.openDraft(view, did, settings)
    if !opened.missing.isEmpty {
      throw DraftActionError(
        "MEDIA_MISSING",
        "This draft’s images were saved on another device. Open it to attach them again, then post it.")
    }
    var notes: [String] = []
    var state = opened.state
    if !ComposerJS.truthy(state["gates"]?["custom"]) && !ComposerJS.truthy(state["reply"]) {
      let resolved = try await deps.resolveDefaultGates(settings, agent)
      state["gates"] = resolved.gates
      if let notice = resolved.notice, !notice.isEmpty { notes.append(notice) }
    }
    if ComposerJS.truthy(state["lifespan"]?["enabled"]) {
      let reason = try await deps.timerRoom?(state["lifespan"] ?? .null) ?? nil
      if reason != "" {
        var lifespan = state["lifespan"] ?? [:]
        lifespan["enabled"] = false
        state["lifespan"] = lifespan
        if let reason, !reason.isEmpty { notes.append("It went without your default timer. \(reason)") }
      }
    }
    return PreparedDraft(state: state, notes: notes)
  }

  /// Post a draft now: `result` publish's, `timer` the timer's (nil when
  /// no timer was asked for), `deleted` whether the draft could be removed
  /// afterwards (a post that went out is never undone because of it).
  public static func postDraftNow<Target>(
    _ view: JSONValue, did: String, settings: JSONValue?, agent: XRPCAgent?, deps: DraftActionDeps<Target>
  ) async throws -> PostedDraft {
    let prepared = try await prepareDraft(view, did: did, settings: settings, agent: agent, deps: deps)
    var notes = prepared.notes
    let state = prepared.state
    let target = try await deps.targetFor(did)
    let result = try await deps.publish(state, target, deps.resolveMention, settings?["requireAltText"] == .bool(true))
    try deps.emitPostsChanged(did, ComposerJS.or(result["written"], [])?.arrayValue ?? [])
    var timer: ArmOutcome?
    if ComposerJS.truthy(state["lifespan"]?["enabled"]), let armTimer = deps.armTimer {
      timer = try await armTimer(result, state)
      if timer?.status == "failed" {
        let message = timer?.error?.message ?? ""
        notes.append("It went out without its timer\(message.isEmpty ? "." : ": \(message)")")
      }
    }
    let deleted = await deleteQuietly(view, agent: agent, deps: deps)
    if !deleted { notes.append("It’s still in your drafts: delete it there when you’re ready.") }
    return PostedDraft(result: result, notes: notes, timer: timer, deleted: deleted)
  }

  /// Schedule a draft for `scheduledFor` (an ISO string), or the next queue
  /// slot when `queued`. The caller works the slot out (nextOpenSlot) and
  /// passes it as `scheduledFor` too.
  public static func scheduleDraft<Target>(
    _ view: JSONValue, did: String, settings: JSONValue?, agent: XRPCAgent?, scheduledFor: JSONValue?,
    queued: Bool = false, now: Double, deps: DraftActionDeps<Target>
  ) async throws -> ScheduledDraft {
    guard let requester = deps.requester else {
      throw DraftActionError("NEEDS_BACKEND", "Scheduling needs this account signed in for a long session.")
    }
    let prepared = try await prepareDraft(view, did: did, settings: settings, agent: agent, deps: deps)
    var notes = prepared.notes
    let body = try await deps.serializeForSchedule(
      prepared.state,
      DraftScheduleRequest(
        now: now, scheduledFor: scheduledFor, queued: queued, resolveMention: deps.resolveMention,
        loadImage: deps.loadImage))
    let row = try await deps.createScheduled(requester, body)
    let deleted = await deleteQuietly(view, agent: agent, deps: deps)
    if !deleted { notes.append("It’s still in your drafts: delete it there when you’re ready.") }
    return ScheduledDraft(row: row, notes: notes, deleted: deleted)
  }

  static func deleteQuietly<Target>(_ view: JSONValue, agent: XRPCAgent?, deps: DraftActionDeps<Target>) async -> Bool {
    do {
      try await deps.deleteDraft(agent, view["id"] ?? .null)
      return true
    } catch {
      return false
    }
  }

  /// Read the bytes of a picture a draft names by blob (one saved by an app
  /// that uploads draft images, rather than keeping them on the device),
  /// from the account's PDS: the serializer's loadImage. Nil when it can't
  /// be read; the serializer then refuses with IMAGE_MISSING.
  public static func blobImageLoader(
    did: String?, pdsUrl: String?, transport: any HTTPTransport = HTTP.transport, files: any ComposerFiles
  ) -> @Sendable (JSONValue) async throws -> ComposerFile? {
    { image in
      if let file = image["file"], file.isTruthy { return ComposerFile(json: file) }
      guard let cid = Blobs.blobCid(image["blob"]), cid.isTruthy, let pdsUrl, !pdsUrl.isEmpty else { return nil }
      do {
        let base = String(decoding: PostedModel.trimTrailingSlashes(Array(pdsUrl.utf16)), as: UTF16.self)
        let url =
          "\(base)/xrpc/com.atproto.sync.getBlob?did=\(JSURI.encodeURIComponent(did ?? "undefined"))&cid=\(JSURI.encodeURIComponent(cid.jsString))"
        let response = try await transport.send(HTTPRequest(url: url))
        guard response.ok else { return nil }
        return try await files.makeFile(
          response.body, name: nil, type: LinkCard.blobType(response.headers.get("content-type")), lastModified: nil)
      } catch {
        return nil
      }
    }
  }

  /// The message for a quick action that failed, in plain words. `action`
  /// is 'post' or 'schedule'.
  public static func draftActionMessage(_ err: JSONValue?, action: String) -> String {
    guard let err, err.isTruthy else { return "" }
    let code = err["code"]
    if code == "MEDIA_MISSING" || code == "NEEDS_BACKEND" || code == "DRAFT_LIMIT" || code == "MISSING_SCOPE" {
      return err["message"].map { $0.isNull ? "null" : $0.jsString } ?? "undefined"
    }
    if ComposerJS.length(err["problems"]) > 0 {
      let first = ScheduleJS.first(err["problems"])?["message"]
      return first.map { $0.isNull ? "null" : $0.jsString } ?? "undefined"
    }
    let base = action == "schedule" ? "The draft couldn’t be scheduled." : "The draft couldn’t be posted."
    if let message = err["message"], message.isTruthy { return "\(base) \(message.jsString)" }
    return "\(base) Try again."
  }

  /// draftActionMessage for a thrown error, read as the web's object.
  public static func draftActionMessage(_ error: (any Error)?, action: String) -> String {
    guard let error else { return "" }
    return draftActionMessage(ScheduledPostError.errorObject(error), action: action)
  }
}
