// Ports src/posting/drafts/drafts.js
//
// Drafts are Bluesky's private drafts (app.bsky.draft.*): kept by Bluesky's
// AppView for the account alone, and shared with every app that reads them.
// Calls always go to Bluesky's AppView (`withBlueskyAppView`), whatever else
// the agent is pointed at: no other AppView keeps drafts, and the permission
// names it.
//
// A draft is written in two shapes at once (Drafts+Shapes.swift):
//
//   - the lexicon's own fields (`text`, `labels`, `embedImages`,
//     `embedVideos`, `embedExternals`, `embedRecords`, the draft's `langs`,
//     `threadgateAllow` and `postgateEmbeddingRules`), which Bluesky's app
//     reads;
//   - the fields Anisota writes beside them on each post (`facets`, `tags`,
//     `embed`, `reply`), which keep links, tags, the post being replied to
//     and already-uploaded media whole.
//
// Beside them each post may carry one field of Virga's (`virgaCard`), for
// what a link card holds that neither shape keeps: an image not uploaded
// yet, and whether the writer edited the card.
//
// Reading takes both and prefers the fuller one. Media are device-bound:
// each file is kept on this device (DraftMedia) and the draft names it by a
// `localRef` path.

import Foundation
import VirgaCore
import VirgaNetwork

/// A drafts call that couldn't be made, in the web's words: `code`
/// DRAFT_TOO_LONG (with `postIndex`) or DRAFT_LIMIT (with the refusal as
/// `cause`), or none.
public struct DraftsError: Error, LocalizedError, Sendable, CustomStringConvertible {
  public var message: String
  public var code: String?
  public var postIndex: Int?
  public var cause: (any Error)?

  public init(_ message: String, code: String? = nil, postIndex: Int? = nil, cause: (any Error)? = nil) {
    self.message = message
    self.code = code
    self.postIndex = postIndex
    self.cause = cause
  }

  public var errorDescription: String? { message }
  public var description: String { message }
}

/// One page of drafts: `{ drafts, cursor }`.
public struct DraftPage: Sendable, Hashable {
  public var drafts: [JSONValue]
  public var cursor: JSONValue
}

/// Every draft, and whether the list was read to its end.
public struct DraftList: Sendable, Hashable {
  public var drafts: [JSONValue]
  public var complete: Bool
}

/// A saved draft: `{ id, state, draft, recreated? }`, `state` naming the
/// draft as its source and its media by path.
public struct SavedDraft: Sendable, Hashable {
  public var id: JSONValue
  public var state: JSONValue
  public var draft: JSONValue
  public var recreated: Bool?

  public var json: JSONValue {
    var out: JSONValue = ["id": id, "state": state, "draft": draft]
    if let recreated { out["recreated"] = .bool(recreated) }
    return out
  }
}

/// The card service, as openDraft and completeDraftCards call it: the card
/// for an address, with the caller's deadline (`AbortSignal.timeout`), or nil.
public typealias DraftCardFetch = @Sendable (_ url: String, _ deadlineMs: Double?) async throws -> JSONValue?

/// How a draft is saved: the web's `opts` for createDraft and updateDraft.
public struct DraftSaveOptions: Sendable {
  /// This device's id, or a given one.
  public enum Device: Sendable {
    /// postingDeviceId over this store (the web's localStorage).
    case thisDevice(store: (any KeyValueStore)?)
    /// The id given (nil for none).
    case given(String?)
  }

  /// Already resolved, one `{ text, facets }` per post; nil resolves them.
  public var texts: [JSONValue]?
  public var resolveMention: ResolveMention?
  public var validationCache: MentionValidationCache
  public var device: Device
  public var deviceName: String?
  /// The account's media store (nil for DraftMedia.openDraftMedia's).
  public var media: (any DraftMediaStore)?
  /// Where the drafts-changed events go (nil for nowhere).
  public var target: PostingEventBus?
  /// The time a kept file is saved at.
  public var now: @Sendable () -> Double
  /// A fresh path for a file about to be kept.
  public var newRef: @Sendable () -> String
  /// `crypto.randomUUID`, for a device id made the first time.
  public var uuid: @Sendable () -> String
  /// The locale the length refusal counts in (nil: the active one).
  public var locale: String?

  public init(
    texts: [JSONValue]? = nil, resolveMention: ResolveMention? = nil, validationCache: MentionValidationCache = .shared,
    device: Device = .thisDevice(store: nil), deviceName: String? = nil, media: (any DraftMediaStore)? = nil,
    target: PostingEventBus? = .shared, now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 },
    newRef: @escaping @Sendable () -> String = { DraftMedia.newLocalRef() },
    uuid: @escaping @Sendable () -> String = { DraftMedia.randomUUID() }, locale: String? = nil
  ) {
    self.texts = texts
    self.resolveMention = resolveMention
    self.validationCache = validationCache
    self.device = device
    self.deviceName = deviceName
    self.media = media
    self.target = target
    self.now = now
    self.newRef = newRef
    self.uuid = uuid
    self.locale = locale
  }
}

public enum Drafts {
  /// The lexicon's limits on a draft.
  public struct Limits: Sendable, Hashable {
    public let posts = 100
    public let textGraphemes = 1000
    public let textBytes = 10000
    public let images = 4
    public let videos = 1
    public let langs = 3
    public let altGraphemes = 2000
    public let pageSize = 100
  }

  public static let limits = Limits()

  /// How Virga names itself as the device a draft was saved on.
  public static let deviceNameDefault = "Virga"

  /// Per device, not per account: which drafts' media this device holds.
  public static let postingDeviceKey = "virga:posting-device"

  public static let draftLimitMessage =
    "You’ve reached Bluesky’s limit on drafts. Delete one you don’t need, then save again."

  /// A file is only forgotten once it's this old: a draft saved while the
  /// list was read, or a post in the composer that names it, has had the day
  /// the composer keeps a post for (autosave's TTL) and a day more.
  public static let orphanMediaMinAgeMs: Double = 2 * 24 * 60 * 60 * 1000

  /// The composer waits this long for the card service when a draft opens.
  public static let cardWaitMs: Double = 5_000

  // MARK: The account

  static func draftsOf(_ agent: XRPCAgent?) throws -> XRPCAgent {
    guard let agent else { throw DraftsError("Drafts need a signed-in account.") }
    return agent.withBlueskyAppView()
  }

  static func ownerOf(_ agent: XRPCAgent?, _ state: JSONValue?) throws -> String {
    if let did = agent?.did, !did.isEmpty { return did }
    if let did = state?["asDid"], did.isTruthy { return did.stringValue ?? did.jsString }
    throw DraftsError("A draft belongs to an account.")
  }

  /// `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.
  static let uuidV4 = JSRegex(
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\\z")

  static func isUUIDv4(_ text: String) -> Bool { uuidV4.test(text) }

  /// This device's id for drafts (a UUIDv4 under `virga:posting-device`,
  /// made the first time). Nil when there is nowhere to keep one: a draft
  /// then names no device, and its media read as being elsewhere.
  public static func postingDeviceId(
    _ store: (any KeyValueStore)?, uuid: () -> String = { DraftMedia.randomUUID() }
  ) -> String? {
    guard let store else { return nil }
    if let known = store.getItem(postingDeviceKey), !known.isEmpty, isUUIDv4(known) { return known }
    let id = uuid()
    do {
      try store.setItem(postingDeviceKey, id)
    } catch {
      return nil
    }
    return id
  }

  // MARK: Errors

  /// Whether Bluesky refused a new draft because the account has its limit.
  public static func isDraftLimitError(_ error: JSONValue?) -> Bool {
    guard let error, error.isTruthy else { return false }
    if error["error"]?.stringValue == "DraftLimitReached" || error["code"]?.stringValue == "DraftLimitReached" {
      return true
    }
    // (The SDK's DraftLimitReachedError is an XRPCError whose `error` says so.)
    // `/DraftLimitReached/.test(...)`, by code unit: Swift's `contains`
    // compares Characters, and misses the name before a combining mark.
    return str(error["message"]).jsIndexOf("DraftLimitReached") >= 0
  }

  public static func isDraftLimitError(_ error: (any Error)?) -> Bool {
    guard let error else { return false }
    return isDraftLimitError(PublishRecord.errorObject(error))
  }

  static func asDraftError(_ error: any Error) -> any Error {
    guard isDraftLimitError(error) else { return error }
    return DraftsError(draftLimitMessage, code: "DRAFT_LIMIT", cause: error)
  }

  /// `/not ?found/i`, the `i` written out.
  static let notFoundWords = JSRegex("[nN][oO][tT] ?[fF][oO][uU][nN][dD]")

  static func isNotFound(_ error: any Error) -> Bool {
    let object = PublishRecord.errorObject(error)
    return object["error"]?.stringValue == "NotFound" || object["status"]?.doubleValue == 404
      || notFoundWords.test(str(object["message"]))
  }

  // MARK: Reading

  /// One page of the account's drafts, newest edit first as Bluesky returns
  /// them. `limit` is held to 1–100 (anything that isn't a number is 50).
  public static func listDrafts(_ agent: XRPCAgent?, cursor: JSONValue? = nil, limit: JSONValue? = nil) async throws
    -> DraftPage
  {
    let asked = limit.map(\.jsNumber) ?? 50
    let size = Swift.max(1, Swift.min(Double(limits.pageSize), asked == 0 || asked.isNaN ? 50 : asked))
    var params: XRPCParams = ["limit": .integer(Int(size))]
    if let cursor, cursor.isTruthy { params["cursor"] = .string(cursor.stringValue ?? cursor.jsString) }
    let data = try await draftsOf(agent).query("app.bsky.draft.getDrafts", params).data
    let drafts = (data["drafts"]?.arrayValue ?? []).filter { $0["id"]?.isTruthy == true && isObject($0["draft"]) }
    return DraftPage(drafts: drafts, cursor: data["cursor"].truthy ?? .null)
  }

  /// Every draft, paged to the end. A cursor handed back twice ends the
  /// walk, and so does `maxPages` (the list is then not complete).
  public static func listAllDrafts(_ agent: XRPCAgent?, maxPages: Int = 50) async throws -> DraftList {
    var out: [JSONValue] = []
    var seen: [JSONValue] = []
    var cursors: [JSONValue] = []
    var cursor: JSONValue = .null
    var complete = false
    var page = 0
    while page < maxPages {
      let res = try await listDrafts(agent, cursor: cursor, limit: .number(Double(limits.pageSize)))
      for d in res.drafts {
        let id = d["id"] ?? .null
        if seen.contains(where: { ComposerJS.sameValueZero($0, id) }) { continue }
        seen.append(id)
        out.append(d)
      }
      cursor = res.cursor
      if !cursor.isTruthy || cursors.contains(where: { ComposerJS.sameValueZero($0, cursor) }) || res.drafts.isEmpty {
        complete = !cursor.isTruthy || res.drafts.isEmpty
        break
      }
      cursors.append(cursor)
      page += 1
    }
    return DraftList(drafts: out, complete: complete)
  }

  // MARK: Writing

  struct Prepared {
    var owner: String
    var media: any DraftMediaStore
    var state: JSONValue
    var draft: JSONValue
    var forgetMinted: @Sendable () async -> Void
  }

  static func prepare(_ agent: XRPCAgent?, _ state: JSONValue, _ opts: DraftSaveOptions) async throws -> Prepared {
    let owner = try ownerOf(agent, state)
    let media = opts.media ?? DraftMedia.openDraftMedia(owner)
    let before = DraftMedia.stateLocalRefs(state).map(JSKey.init)
    let withRefs = try await DraftMedia.storeDraftMedia(owner, state, media: media, now: opts.now(), newRef: opts.newRef)
      .state
    // Files kept for this write alone: forgotten again if it fails.
    let minted = DraftMedia.stateLocalRefs(withRefs).filter { !before.contains(JSKey($0)) }
    let forgetMinted: @Sendable () async -> Void = { await DraftMedia.removeDraftMedia(owner, minted, media: media) }
    do {
      var texts = opts.texts
      if texts == nil {
        texts = try await ComposerModel.resolvePostTexts(
          withRefs, resolveMention: opts.resolveMention, validationCache: opts.validationCache
        ).map { (try? JSONValue(encoding: $0)) ?? .null }
      }
      let deviceId: String?
      switch opts.device {
      case .thisDevice(let store): deviceId = postingDeviceId(store, uuid: opts.uuid)
      case .given(let id): deviceId = id
      }
      let draft = try composerStateToDraft(
        withRefs, texts: texts ?? [], deviceId: deviceId, deviceName: opts.deviceName, owner: owner,
        locale: opts.locale)
      return Prepared(owner: owner, media: media, state: withRefs, draft: draft, forgetMinted: forgetMinted)
    } catch {
      await forgetMinted()
      throw error
    }
  }

  static func withSource(_ state: JSONValue, id: JSONValue, owner: String) -> JSONValue {
    var out = state
    out["source"] = ["kind": "draft", "id": id, "ownerDid": .string(owner)]
    return out
  }

  static func emit(_ owner: String, _ id: JSONValue, _ action: String, _ target: PostingEventBus?) {
    _ = try? PostingEvents.emitPostingEvent(
      PostingEvents.drafts, ["did": .string(owner), "id": id, "action": .string(action)], target: target)
  }

  /// Save `state` as a new draft of the agent's account. Media files are
  /// kept on this device first. Bluesky's limit on drafts comes back as a
  /// DraftsError with code DRAFT_LIMIT and a sentence to show.
  public static func createDraft(_ agent: XRPCAgent?, _ state: JSONValue, _ opts: DraftSaveOptions = DraftSaveOptions())
    async throws -> SavedDraft
  {
    let prepared = try await prepare(agent, state, opts)
    let data: JSONValue
    do {
      data = try await draftsOf(agent).procedure("app.bsky.draft.createDraft", input: .json(["draft": prepared.draft]))
        .data
    } catch {
      await prepared.forgetMinted()
      throw asDraftError(error)
    }
    guard let id = data["id"], id.isTruthy else {
      throw DraftsError("The draft was sent, but Bluesky didn’t say where it was saved.")
    }
    emit(prepared.owner, id, "created", opts.target)
    return SavedDraft(id: id, state: withSource(prepared.state, id: id, owner: prepared.owner), draft: prepared.draft)
  }

  /// The draft `id` from the account's whole list, with every path the
  /// other drafts name (two drafts can share a file, and it stays while
  /// either does).
  static func findDraft(_ agent: XRPCAgent?, _ id: String) async throws -> (
    found: JSONValue?, complete: Bool, others: [JSONValue]
  ) {
    let all = try await listAllDrafts(agent)
    let found = all.drafts.first { $0["id"]?.stringValue?.jsEquals(id) == true }
    let others = all.drafts.filter { $0["id"]?.stringValue?.jsEquals(id) != true }.flatMap(draftLocalRefs)
    return (found, all.complete, others)
  }

  /// Save `state` over the draft `id`. Bluesky ignores an update to a draft
  /// that no longer exists (deleted, or posted from another app) and reports
  /// success, so the draft is looked for first: when the complete list
  /// hasn't got it, the state is saved as a new draft instead (`recreated`,
  /// with its new id). When the list can't be read, the update is sent
  /// regardless. Media the old draft named and neither the new one nor
  /// another draft does are forgotten.
  public static func updateDraft(
    _ agent: XRPCAgent?, _ id: String?, _ state: JSONValue, _ opts: DraftSaveOptions = DraftSaveOptions()
  ) async throws -> SavedDraft {
    guard let id, !id.isEmpty else { throw DraftsError("Which draft?") }
    // Unverified when the list can't be read: the update below is the best that can be done.
    let looked = try? await findDraft(agent, id)
    if let looked, looked.found == nil, looked.complete {
      var made = try await createDraft(agent, state, opts)
      made.recreated = true
      return made
    }
    let previous = looked?.found
    let others = looked?.others ?? []
    let prepared = try await prepare(agent, state, opts)
    do {
      _ = try await draftsOf(agent).procedure(
        "app.bsky.draft.updateDraft", input: .json(["draft": ["id": .string(id), "draft": prepared.draft]]))
    } catch {
      await prepared.forgetMinted()
      throw asDraftError(error)
    }
    if let previous {
      let kept = DraftMedia.stateLocalRefs(prepared.state).map(JSONValue.string) + others
      let gone = draftLocalRefs(previous).filter { ref in !kept.contains { ComposerJS.sameValueZero($0, ref) } }
      await DraftMedia.removeDraftMedia(prepared.owner, gone, media: prepared.media)
    }
    emit(prepared.owner, .string(id), "updated", opts.target)
    return SavedDraft(
      id: .string(id), state: withSource(prepared.state, id: .string(id), owner: prepared.owner), draft: prepared.draft,
      recreated: false)
  }

  /// Delete the draft `id`. One already gone counts as deleted. Its media
  /// are then forgotten from this device, except files another draft still
  /// names: the account's list is read first to learn both. When that list
  /// can't be read, only `localRefs` (draftLocalRefs of the draft, when the
  /// caller has it) are forgotten.
  public static func deleteDraft(
    _ agent: XRPCAgent?, _ id: String?, localRefs: [JSONValue]? = nil, media: (any DraftMediaStore)? = nil,
    target: PostingEventBus? = .shared
  ) async throws {
    guard let id, !id.isEmpty else { throw DraftsError("Which draft?") }
    let owner = try ownerOf(agent, nil)
    var refs = localRefs ?? []
    var others: [JSONValue] = []
    if let looked = try? await findDraft(agent, id) {
      if let found = looked.found {
        var unique: [JSONValue] = []
        for ref in refs + draftLocalRefs(found) where !unique.contains(where: { ComposerJS.sameValueZero($0, ref) }) {
          unique.append(ref)
        }
        refs = unique
      }
      others = looked.others
    }
    do {
      _ = try await draftsOf(agent).procedure("app.bsky.draft.deleteDraft", input: .json(["id": .string(id)]))
    } catch {
      if !isNotFound(error) { throw error }
    }
    await DraftMedia.removeDraftMedia(
      owner, refs.filter { ref in !others.contains { ComposerJS.sameValueZero($0, ref) } }, media: media)
    emit(owner, .string(id), "deleted", target)
  }

  /// The card service through `transport`, as openDraft calls it by default.
  public static func networkCardFetch(transport: any HTTPTransport = HTTP.transport) -> DraftCardFetch {
    { url, deadline in try await LinkCard.fetchLinkCard(url, deadlineMs: deadline, transport: transport) }
  }

  /// Open a draft for the composer: draftToComposerState, then the media
  /// files this device keeps, and the cards the draft lost read again from
  /// the card service (`fetchCard` nil for none). `missing` lists the
  /// localRefs that have to be attached again before it can be posted.
  public static func openDraft(
    _ draftView: JSONValue?, asDid: String?, defaults: JSONValue? = nil, media: (any DraftMediaStore)? = nil,
    makePreviewUrl: (@Sendable (JSONValue) throws -> String?)? = nil,
    fetchCard: DraftCardFetch? = Drafts.networkCardFetch(), readId: (String) -> String = { Drafts.readId($0) }
  ) async -> DraftMedia.Loaded {
    let state = draftToComposerState(draftView, asDid: asDid, defaults: defaults, readId: readId)
    async let cards = completeCards(state, fetchCard)
    let loaded = await DraftMedia.loadDraftMedia(asDid, state, media: media, makePreviewUrl: makePreviewUrl)
    guard let found = await cards else { return loaded }
    var out = loaded.state
    out["posts"] = .array(
      ComposerJS.list(loaded.state["posts"]).enumerated().map { i, post in
        guard i < found.count, let card = found[i] else { return post }
        var p = post
        p["card"] = card
        return p
      })
    return DraftMedia.Loaded(state: out, missing: loaded.missing)
  }

  static func completeCards(_ state: JSONValue, _ fetchCard: DraftCardFetch?) async -> [JSONValue?]? {
    guard let fetchCard else { return nil }
    return await completeDraftCards(state, fetchCard: fetchCard)
  }

  /// The cards in `state` with what the draft lost filled in from the card
  /// service: the title, description and image a draft from Bluesky's app
  /// never kept, or an image only an older draft lacks. What the draft does
  /// say (an edited title, an uploaded image) is kept. One card per post, or
  /// nil where nothing changed; nil when nothing changed at all.
  public static func completeDraftCards(
    _ state: JSONValue?, fetchCard: @escaping DraftCardFetch, timeoutMs: Double = cardWaitMs
  ) async -> [JSONValue?]? {
    let posts = ComposerJS.list(ComposerJS.or(state?["posts"], nil))
    let results = await withTaskGroup(of: (Int, JSONValue?).self) { group -> [JSONValue?] in
      for (index, post) in posts.enumerated() {
        group.addTask {
          guard let card = post["card"], let url = card["url"], url.isTruthy, !(card["edited"]?.isTruthy ?? false) else {
            return (index, nil)
          }
          // A card the writer edited says what they chose, a removed image too.
          let lacksThumb =
            !(card["thumb"]?.isTruthy ?? false) && !(card["thumbBlob"]?.isTruthy ?? false)
            && !(card["thumbFile"]?.isTruthy ?? false)
          if !str(card["title"]).isEmpty && !lacksThumb { return (index, nil) }
          guard let fresh = (try? await fetchCard(url.stringValue ?? url.jsString, timeoutMs)) ?? nil, fresh.isTruthy
          else { return (index, nil) }
          var next = card
          next["title"] = .string(str(card["title"]).isEmpty ? str(fresh["title"]) : str(card["title"]))
          next["description"] = .string(
            str(card["description"]).isEmpty ? str(fresh["description"]) : str(card["description"]))
          if lacksThumb { next["thumb"] = fresh["thumb"].truthy ?? .null } else { next["thumb"] = card["thumb"] }
          if !(card["associatedRefs"]?.isTruthy ?? false), let refs = fresh["associatedRefs"], refs.isTruthy {
            next["associatedRefs"] = refs
          }
          return (index, next)
        }
      }
      var out = [JSONValue?](repeating: nil, count: posts.count)
      for await (index, card) in group { out[index] = card }
      return out
    }
    return results.contains { $0 != nil } ? results : nil
  }

  // MARK: Files no draft names any more

  /// Every localRef in the account's stored composer entry (the post being
  /// written and the ones set aside), read as raw JSON: whatever names a
  /// file keeps it, valid entry or not, and reading never clears anything.
  static func autosavedLocalRefs(_ did: String, _ store: (any KeyValueStore)?) -> [JSONValue] {
    guard let text = store?.getItem(Autosave.autosaveKey(did)), !text.isEmpty else { return [] }
    guard let entry = try? JSONValue.parse(text) else { return [] }
    var refs: [JSONValue] = []
    var stack: [JSONValue] = [entry]
    // Depth first, in the order a recursive walk visits them.
    while let value = stack.popLast() {
      switch value {
      case .array(let items):
        stack.append(contentsOf: items.reversed())
      case .object(let members):
        if let ref = members["localRef"], let path = ref.stringValue, !path.isEmpty { refs.append(ref) }
        stack.append(contentsOf: members.values.reversed())
      default:
        break
      }
    }
    return refs
  }

  /// Forget the files on this device that no draft of the account names
  /// any more: ones whose draft was posted or deleted in another app, or
  /// that a failed removal left behind. Reads every draft first and does
  /// nothing unless that read is complete. Files the composer's stored or
  /// in-memory post names, and files newer than `minAgeMs`, stay. Returns
  /// the paths forgotten.
  public static func pruneOrphanedDraftMedia(
    _ agent: XRPCAgent?, _ did: String?, media: (any DraftMediaStore)? = nil,
    now: Double = Date().timeIntervalSince1970 * 1000, minAgeMs: Double = orphanMediaMinAgeMs,
    store: (any KeyValueStore)? = nil, session: AutosaveSession = .shared
  ) async throws -> [String] {
    guard agent != nil, let did, !did.isEmpty else { return [] }
    let all = try await listAllDrafts(agent)
    if !all.complete { return [] }
    let keep =
      all.drafts.flatMap(draftLocalRefs) + autosavedLocalRefs(did, store)
      + DraftMedia.stateLocalRefs(Autosave.loadSessionDraft(did, session: session)?.state).map(JSONValue.string)
    return await DraftMedia.pruneDraftMedia(did, keep, media: media, savedBefore: now - minAgeMs)
  }
}
