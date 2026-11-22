// Ports src/posting/autosave.js
//
// Keeping a post that hasn't been sent, in two layers.
//
// In memory, per account (AutosaveSession, the web's module-level Maps):
// the composer's whole state, files and all, so closing and reopening it
// loses nothing.
//
// In the key-value store (the web's localStorage), under
// `virga:composer-autosave:<did>`: what survives a relaunch. Text, the
// thread, tags, languages, labels, reply and quote settings, the post being
// replied to, quotes and link cards, and media only when it already lives
// somewhere a relaunch can't take it from (an uploaded blob, or a draft's
// files in the media store, named by `localRef`). A picked file that is in
// neither is left out and counted. Entries expire after a day. Writes wait
// two seconds for typing to stop (Autosaver); the app flushes one still
// waiting when it goes to the background (the web's pagehide), and one
// meant for an account that is no longer the composer's is dropped.
//
// Beside the post being written, each account can have posts set aside (in
// both layers): ones the composer moved out of the way rather than write
// over, which come back the next time it opens with nothing in it.
//
// States are the web's objects (JSONValue, files as ComposerFile markers);
// entries are written with JSON.stringify's text (key order aside).

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaRepo

/// A serialized state and how many pieces of media had to be left out.
public struct SerializedComposerState: Codable, Hashable, Sendable {
  public var state: JSONValue
  public var mediaLeftOut: Int
}

/// A saved post read back: `{ state, savedAt, mediaLeftOut, lifespanTouched }`.
public struct AutosaveRead: Codable, Hashable, Sendable {
  public var state: JSONValue
  public var savedAt: JSONValue
  public var mediaLeftOut: Double
  /// Whether the writer chose the timer; nil for an entry saved before it was kept.
  public var lifespanTouched: Bool?
}

/// A post taken back out of the set-aside list.
public struct TakenAside: Codable, Hashable, Sendable {
  public var state: JSONValue
  public var savedAt: JSONValue
  public var mediaLeftOut: Double
  public var lifespanTouched: Bool?
  /// It came from this run's memory (files and all).
  public var inMemory: Bool
}

/// What the session layer keeps for an account: `{ state, savedAt, lifespanTouched? }`.
public struct SessionDraft: Codable, Hashable, Sendable {
  public var state: JSONValue
  public var savedAt: Double
  public var lifespanTouched: Bool?
}

/// The in-memory layer: the post being written and the posts set aside,
/// per account, for this run of the app. `.shared` is the app's; tests make
/// their own.
public final class AutosaveSession: Sendable {
  public static let shared = AutosaveSession()

  struct Piece: Sendable, Hashable {
    var id: String
    var state: JSONValue
    var savedAt: Double
    var lifespanTouched: Bool?
  }

  let drafts = Locked<[JSKey: SessionDraft]>([:])
  let aside = Locked<[JSKey: [Piece]]>([:])

  public init() {}
}

public enum Autosave {
  public static let autosavePrefix = "virga:composer-autosave:"
  public static let autosaveVersion = 1
  public static let autosaveTtlMs: Double = 24 * 60 * 60 * 1000
  public static let autosaveDebounceMs: Double = 2000
  /// The most posts kept aside per account; past it the oldest goes.
  public static let maxSetAside = 10

  public static func autosaveKey(_ did: String) -> String { "\(autosavePrefix)\(did)" }

  static func str(_ value: JSONValue?) -> String { ComposerJS.str(value) }

  /// `str(v) || null`.
  static func strOrNull(_ value: JSONValue?) -> JSONValue {
    let text = str(value)
    return text.isEmpty ? .null : .string(text)
  }

  /// A preview a relaunch can still show (an http(s) address).
  static func lastingUrl(_ value: JSONValue?) -> JSONValue {
    guard let url = value?.stringValue else { return .null }
    let lower = String(decoding: url.utf16.prefix(8).map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 }, as: UTF16.self)
    return PostingJS.hasPrefix(lower, "http://") || PostingJS.hasPrefix(lower, "https://") ? .string(url) : .null
  }

  static func jsonBlob(_ blob: JSONValue?) -> JSONValue? {
    guard let blob, ComposerJS.isObject(blob) else { return nil }
    return RecordCid.toJsonShape(blob)
  }

  /// `{ width, height }` from an aspect ratio object.
  static func ratio(_ value: JSONValue?) -> JSONValue? {
    guard let value, ComposerJS.isObject(value) else { return nil }
    var out: [String: JSONValue] = [:]
    if let width = value["width"] { out["width"] = width }
    if let height = value["height"] { out["height"] = height }
    return .object(out)
  }

  // MARK: Serializing

  static func serializeImage(_ image: JSONValue, _ left: inout Int) -> JSONValue? {
    let blob = jsonBlob(image["blob"])
    let localRef = strOrNull(image["localRef"])
    if blob == nil && localRef.isNull {
      if image.isTruthy { left += 1 }
      return nil
    }
    var out: [String: JSONValue] = [
      "id": strOrNull(image["id"]), "mime": .string(str(image["mime"])),
      "size": .number(numberOrZero(image["size"])), "alt": .string(str(image["alt"])),
    ]
    if let aspect = ratio(image["aspectRatio"]) { out["aspectRatio"] = aspect }
    if !localRef.isNull { out["localRef"] = localRef }
    if let blob {
      out["blob"] = blob
      out["blobDid"] = strOrNull(image["blobDid"])
    }
    let preview = lastingUrl(image["previewUrl"])
    if !preview.isNull { out["previewUrl"] = preview }
    return .object(out)
  }

  /// `Number(v) || 0`.
  static func numberOrZero(_ value: JSONValue?) -> Double {
    let n = value.jsNumber
    return n.isNaN || n == 0 ? 0 : n
  }

  static func serializeVideo(_ video: JSONValue?, _ left: inout Int) -> JSONValue {
    guard let video, video.isTruthy else { return .null }
    let blob = jsonBlob(video["blob"])
    let localRef = strOrNull(video["localRef"])
    if blob == nil && localRef.isNull {
      left += 1
      return .null
    }
    var out: [String: JSONValue] = [
      "mime": .string(str(video["mime"])), "size": .number(numberOrZero(video["size"])),
      "alt": .string(str(video["alt"])),
      // An upload in flight can't be resumed after a relaunch; it starts again.
      "status": blob != nil ? "ready" : "idle",
    ]
    if let aspect = ratio(video["aspectRatio"]) { out["aspectRatio"] = aspect }
    if !localRef.isNull { out["localRef"] = localRef }
    if let blob {
      out["blob"] = blob
      out["blobDid"] = strOrNull(video["blobDid"])
    }
    return .object(out)
  }

  static func serializeCard(_ card: JSONValue?, _ left: inout Int) -> JSONValue {
    guard let card, let url = card["url"], url.isTruthy else { return .null }
    var out: [String: JSONValue] = [
      "url": url, "title": .string(str(card["title"])), "description": .string(str(card["description"])),
      "thumb": lastingUrl(card["thumb"]),
    ]
    if let thumbBlob = jsonBlob(card["thumbBlob"]) {
      out["thumbBlob"] = thumbBlob
      out["thumbBlobDid"] = strOrNull(card["thumbBlobDid"])
    } else if ComposerJS.truthy(card["thumbFile"]) {
      left += 1
    }
    if ComposerJS.truthy(card["edited"]) { out["edited"] = true }
    return .object(out)
  }

  static func serializeRecord(_ record: JSONValue?, views: Bool) -> JSONValue {
    guard let record, let uri = record["uri"], uri.isTruthy else { return .null }
    var out: [String: JSONValue] = [
      "kind": ComposerJS.or(record["kind"], "post") ?? "post", "uri": uri,
      "cid": ComposerJS.or(record["cid"], nil) ?? .null,
    ]
    if views, ComposerJS.isObject(record["view"]) { out["view"] = record["view"] }
    return .object(out)
  }

  static func serializePost(_ post: JSONValue, _ left: inout Int, views: Bool) -> JSONValue {
    var images: [JSONValue] = []
    for image in ComposerJS.list(ComposerJS.or(post["images"], nil)) {
      if let out = serializeImage(image, &left) { images.append(out) }
    }
    return [
      "id": strOrNull(post["id"]), "text": .string(str(post["text"])), "images": .array(images),
      "video": serializeVideo(post["video"], &left), "record": serializeRecord(post["record"], views: views),
      "card": serializeCard(post["card"], &left),
    ]
  }

  static func serializeReply(_ reply: JSONValue?, views: Bool) -> JSONValue {
    guard let reply, let uri = reply["uri"], uri.isTruthy else { return .null }
    let cid = ComposerJS.or(reply["cid"], nil) ?? .null
    var out: [String: JSONValue] = [
      "uri": uri, "cid": cid, "root": ComposerJS.or(reply["root"], nil) ?? ["uri": uri, "cid": cid],
    ]
    if ComposerJS.isObject(reply["author"]) { out["author"] = reply["author"] }
    if views, let text = reply["text"], text.stringValue != nil { out["text"] = text }
    return .object(out)
  }

  /// The part of a ComposerState a relaunch can bring back, and how many
  /// pieces of media had to be left out. `views: false` leaves the hydrated
  /// quote and reply text out too, for a smaller entry.
  public static func serializeComposerState(_ state: JSONValue?, views: Bool = true) -> SerializedComposerState {
    var left = 0
    let posts = ComposerJS.list(ComposerJS.or(state?["posts"], nil)).map { serializePost($0, &left, views: views) }
    func strings(_ value: JSONValue?) -> JSONValue {
      .array((value?.arrayValue ?? []).filter { $0.stringValue != nil })
    }
    func shaped(_ value: JSONValue?) -> JSONValue {
      guard let value, ComposerJS.isObject(value) else { return .null }
      return RecordCid.toJsonShape(value)
    }
    let out: JSONValue = [
      "posts": .array(posts),
      "reply": serializeReply(state?["reply"], views: views),
      "tags": strings(state?["tags"]),
      "langs": strings(state?["langs"]),
      "labels": strings(state?["labels"]),
      "gates": shaped(state?["gates"]),
      "asDid": strOrNull(state?["asDid"]),
      "schedule": shaped(state?["schedule"]),
      "lifespan": shaped(state?["lifespan"]),
      "source": shaped(state?["source"]),
    ]
    return SerializedComposerState(state: out, mediaLeftOut: left)
  }

  public static func serializeComposerState(_ state: ComposerState, views: Bool = true) -> SerializedComposerState {
    serializeComposerState(state.json, views: views)
  }

  static func postHasContent(_ p: JSONValue) -> Bool {
    !str(p["text"]).jsTrimmed().isEmpty || ComposerJS.length(p["images"]) > 0 || ComposerJS.truthy(p["video"])
      || ComposerJS.truthy(p["record"]) || ComposerJS.truthy(p["card"])
  }

  /// Whether a (serialized or live) state holds anything worth keeping.
  public static func hasAutosaveContent(_ state: JSONValue?) -> Bool {
    guard let state, state.isTruthy else { return false }
    return ComposerJS.list(ComposerJS.or(state["posts"], nil)).contains(where: postHasContent)
      || ComposerJS.truthy(state["reply"]) || ComposerJS.length(ComposerJS.or(state["tags"], nil)) > 0
  }

  public static func hasAutosaveContent(_ state: ComposerState) -> Bool { hasAutosaveContent(state.json) }

  // MARK: Restoring

  static let restoredIds = Locked(0)

  static func restoredId(_ now: Double) -> String {
    let n = restoredIds.withLock { count -> Int in
      count += 1
      return count
    }
    return "restored-\(base36(now))-\(n)"
  }

  /// `n.toString(36)` for a whole number of milliseconds.
  static func base36(_ n: Double) -> String {
    guard n.isFinite else { return JSNumber.format(n) }
    return String(Int64(n.rounded(.towardZero)), radix: 36)
  }

  static func restorePost(_ p: JSONValue?, _ now: Double) -> JSONValue {
    let id = str(p?["id"])
    let idValue: JSONValue = .string(id.isEmpty ? restoredId(now) : id)
    let images: [JSONValue] = ComposerJS.list(ComposerJS.or(p?["images"], nil)).map { image in
      var out = ComposerJS.spread(image)
      let imageId = str(image["id"])
      out["id"] = .string(imageId.isEmpty ? restoredId(now) : imageId)
      return .object(out)
    }
    func copy(_ value: JSONValue?) -> JSONValue {
      guard let value, value.isTruthy else { return .null }
      return .object(ComposerJS.spread(value))
    }
    return [
      "id": idValue, "text": .string(str(p?["text"])), "images": .array(images), "video": copy(p?["video"]),
      "record": copy(p?["record"]), "card": copy(p?["card"]),
    ]
  }

  /// A serialized state as a ComposerState: laid over `base` (normally
  /// `emptyComposerState(asDid:defaults:)`), so whatever the entry lacks
  /// comes from the account's defaults. Fields it holds as null stay null;
  /// a missing `gates` or `lifespan` keeps the base's. `now` names restored
  /// posts and images that have no id.
  public static func deserializeComposerState(_ stored: JSONValue?, base: JSONValue? = nil, now: Double) -> JSONValue {
    let s: JSONValue = ComposerJS.isObject(stored) ? stored! : [:]
    let base = base ?? [:]
    let posts = ComposerJS.list(ComposerJS.or(s["posts"], nil)).map { restorePost($0, now) }
    var out = ComposerJS.spread(base)
    if !posts.isEmpty {
      out["posts"] = .array(posts)
    } else if let basePosts = ComposerJS.or(base["posts"], nil) {
      out["posts"] = basePosts
    } else {
      out["posts"] = .array([restorePost([:], now)])
    }
    for key in ["reply", "tags", "langs", "labels", "asDid", "schedule", "source"] {
      if let value = s[key] { out[key] = value }
    }
    // Never null in a ComposerState: without a stored one, the base's stands.
    if ComposerJS.isObject(s["gates"]) { out["gates"] = s["gates"] }
    if ComposerJS.isObject(s["lifespan"]) { out["lifespan"] = s["lifespan"] }
    if !ComposerJS.truthy(out["asDid"]), let did = base["asDid"], did.isTruthy { out["asDid"] = did }
    return .object(out)
  }

  // MARK: The stored entry

  static func touchedFlag(_ value: JSONValue?) -> Bool? { value?.boolValue }

  static func freshPiece(_ piece: JSONValue?, _ now: Double) -> Bool {
    guard let piece, ComposerJS.isObject(piece), let savedAt = piece["savedAt"]?.doubleValue else { return false }
    return now - savedAt <= autosaveTtlMs && hasAutosaveContent(piece["state"])
  }

  /// The current piece as read: `{ state, savedAt, mediaLeftOut, lifespanTouched }`.
  struct Current {
    var state: JSONValue
    var savedAt: JSONValue
    var mediaLeftOut: JSONValue
    var lifespanTouched: Bool?
  }

  struct Entry {
    var current: Current?
    /// The stored pieces as they were (every member kept).
    var aside: [JSONValue]
  }

  static func readEntry(_ store: any KeyValueStore, _ did: String, _ now: Double) -> Entry? {
    let text = store.getItem(autosaveKey(did))
    let entry: JSONValue? = (text?.isEmpty ?? true) ? .null : (try? JSONValue.parse(text!))
    guard let entry, ComposerJS.isObject(entry), entry["version"] == .number(Double(autosaveVersion)) else {
      return nil
    }
    if let owner = entry["did"], owner.isTruthy, !ComposerJS.strictEquals(owner, .string(did)) { return nil }
    let current: Current? =
      freshPiece(entry, now)
      ? Current(
        state: entry["state"] ?? .null, savedAt: entry["savedAt"] ?? .null,
        mediaLeftOut: .number(numberOrZero(entry["mediaLeftOut"])), lifespanTouched: touchedFlag(entry["lifespanTouched"]))
      : nil
    let aside = ComposerJS.list(entry["aside"]).filter { a in
      freshPiece(a, now) && !(a["id"]?.stringValue ?? "").isEmpty
    }
    return Entry(current: current, aside: aside)
  }

  static func storePiece(state: JSONValue, savedAt: JSONValue, mediaLeftOut: JSONValue?, lifespanTouched: Bool?)
    -> [String: JSONValue]
  {
    var out: [String: JSONValue] = [
      "savedAt": savedAt, "mediaLeftOut": ComposerJS.or(mediaLeftOut, .number(0)) ?? .number(0), "state": state,
    ]
    if let lifespanTouched { out["lifespanTouched"] = .bool(lifespanTouched) }
    return out
  }

  static func remove(_ store: (any KeyValueStore)?, _ did: String) {
    store?.removeItem(autosaveKey(did))
  }

  /// Writes `{ current, aside }` for `did`; nothing in either removes the key.
  @discardableResult
  static func writeEntry(_ store: any KeyValueStore, _ did: String, _ entry: Entry, _ now: Double) throws -> JSONValue? {
    if entry.current == nil && entry.aside.isEmpty {
      remove(store, did)
      return nil
    }
    let current = entry.current
    var out: [String: JSONValue] = [
      "version": .number(Double(autosaveVersion)),
      "savedAt": current?.savedAt ?? .number(now),
      "did": .string(did),
      "mediaLeftOut": current.map { ComposerJS.or($0.mediaLeftOut, .number(0)) ?? .number(0) } ?? .number(0),
      "state": current?.state ?? .null,
      "aside": .array(
        entry.aside.map { a in
          var piece = storePiece(
            state: a["state"] ?? .null, savedAt: a["savedAt"] ?? .null, mediaLeftOut: a["mediaLeftOut"],
            lifespanTouched: touchedFlag(a["lifespanTouched"]))
          piece["id"] = a["id"]
          return .object(piece)
        }),
    ]
    if let touched = current?.lifespanTouched { out["lifespanTouched"] = .bool(touched) }
    try store.setItem(autosaveKey(did), JSONStringify.stringify(.object(out)))
    return .object(out)
  }

  // MARK: The post being written

  /// Forget the post being written for `did`. Posts set aside for it stay.
  public static func clearAutosave(_ did: String?, store: (any KeyValueStore)?, now: Double) {
    guard let did, !did.isEmpty, let store else { return }
    guard let found = readEntry(store, did, now), !found.aside.isEmpty else {
      remove(store, did)
      return
    }
    do {
      try writeEntry(store, did, Entry(current: nil, aside: found.aside), now)
    } catch {
      remove(store, did)
    }
  }

  /// Write `state` for `did` now. An empty state clears the post being
  /// written (not what was set aside). The entry written, or nil. When
  /// storage is full, tries again without the hydrated views.
  @discardableResult
  public static func writeAutosave(
    _ did: String?, _ state: JSONValue?, store: (any KeyValueStore)?, now: Double, lifespanTouched: Bool? = nil
  ) -> JSONValue? {
    guard let did, !did.isEmpty, let store else { return nil }
    if !hasAutosaveContent(state) {
      clearAutosave(did, store: store, now: now)
      return nil
    }
    let aside = readEntry(store, did, now)?.aside ?? []
    for views in [true, false] {
      let saved = serializeComposerState(state, views: views)
      let current = Current(
        state: saved.state, savedAt: .number(now), mediaLeftOut: .number(Double(saved.mediaLeftOut)),
        lifespanTouched: lifespanTouched)
      if let written = try? writeEntry(store, did, Entry(current: current, aside: aside), now) { return written }
    }
    return nil
  }

  /// `did`'s saved post with the state laid over `base`, or nil. An entry
  /// from another version, filed for another account, or holding nothing
  /// current is cleared on the way (posts set aside for the account stay).
  public static func readAutosave(_ did: String?, store: (any KeyValueStore)?, now: Double, base: JSONValue? = nil)
    -> AutosaveRead?
  {
    guard let did, !did.isEmpty, let store else { return nil }
    let found = readEntry(store, did, now)
    guard let current = found?.current else {
      if found?.aside.isEmpty ?? true { remove(store, did) }
      return nil
    }
    return AutosaveRead(
      state: deserializeComposerState(current.state, base: base, now: now), savedAt: current.savedAt,
      mediaLeftOut: current.mediaLeftOut.jsNumber, lifespanTouched: current.lifespanTouched)
  }

  // MARK: Set aside

  static let asideIds = Locked(0)

  static func newAsideId(_ now: Double) -> String {
    let n = asideIds.withLock { count -> Int in
      count += 1
      return count
    }
    return "aside-\(base36(now))-\(n)"
  }

  /// Keep `state` aside for `did`, in this run (files and all) and in the
  /// store. Its id, or nil when there was nothing in it.
  @discardableResult
  public static func setAside(
    _ did: String?, _ state: JSONValue?, store: (any KeyValueStore)?, now: Double, lifespanTouched: Bool? = nil,
    session: AutosaveSession = .shared
  ) -> String? {
    guard let did, !did.isEmpty, let state, hasAutosaveContent(state) else { return nil }
    let id = newAsideId(now)
    let piece = AutosaveSession.Piece(id: id, state: state, savedAt: now, lifespanTouched: lifespanTouched)
    session.aside.withLock { all in
      all[JSKey(did)] = ComposerJS.slice((all[JSKey(did)] ?? []) + [piece], -maxSetAside)
    }
    if let store {
      let found = readEntry(store, did, now) ?? Entry(current: nil, aside: [])
      for views in [true, false] {
        let saved = serializeComposerState(state, views: views)
        var stored: [String: JSONValue] = [
          "id": .string(id), "state": saved.state, "savedAt": .number(now),
          "mediaLeftOut": .number(Double(saved.mediaLeftOut)),
        ]
        if let lifespanTouched { stored["lifespanTouched"] = .bool(lifespanTouched) }
        let aside = ComposerJS.slice(found.aside + [.object(stored)], -maxSetAside)
        if (try? writeEntry(store, did, Entry(current: found.current, aside: aside), now)) != nil { break }
      }
    }
    return id
  }

  /// How many posts are set aside for `did` (in this run or saved).
  public static func countSetAside(
    _ did: String?, store: (any KeyValueStore)?, now: Double, session: AutosaveSession = .shared
  ) -> Int {
    guard let did, !did.isEmpty else { return 0 }
    var ids = Set((session.aside.withLock { $0[JSKey(did)] } ?? []).map { JSKey($0.id) })
    for a in store.flatMap({ readEntry($0, did, now)?.aside }) ?? [] {
      if let id = a["id"]?.stringValue { ids.insert(JSKey(id)) }
    }
    return ids.count
  }

  /// Take a post set aside for `did` back out: the one with `id`, or the
  /// newest. This run's copy wins (it still has its files); the saved one
  /// is laid over `base`. Either way it's gone from both afterwards.
  public static func takeSetAside(
    _ did: String?, id: String? = nil, store: (any KeyValueStore)?, now: Double, base: JSONValue? = nil,
    session: AutosaveSession = .shared
  ) -> TakenAside? {
    guard let did, !did.isEmpty else { return nil }
    let mem = session.aside.withLock { $0[JSKey(did)] } ?? []
    let found = store.flatMap { readEntry($0, did, now) } ?? Entry(current: nil, aside: [])
    let wanted: String
    if let id, !id.isEmpty {
      wanted = id
    } else {
      let all: [(id: String, savedAt: Double)] =
        mem.map { ($0.id, $0.savedAt) } + found.aside.map { ($0["id"]?.stringValue ?? "", $0["savedAt"]?.doubleValue ?? .nan) }
      guard let newest = TimerJS.v8Sorted(all, by: { $0.savedAt - $1.savedAt }).last else { return nil }
      wanted = newest.id
    }
    let inMemory = mem.first { $0.id.jsEquals(wanted) }
    let saved = found.aside.first { ($0["id"]?.stringValue).map { $0.jsEquals(wanted) } ?? false }
    let rest = mem.filter { !$0.id.jsEquals(wanted) }
    session.aside.withLock { all in all[JSKey(did)] = rest.isEmpty ? nil : rest }
    if saved != nil, let store {
      let remaining = found.aside.filter { !(($0["id"]?.stringValue).map { $0.jsEquals(wanted) } ?? false) }
      _ = try? writeEntry(store, did, Entry(current: found.current, aside: remaining), now)
    }
    if let inMemory {
      return TakenAside(
        state: inMemory.state, savedAt: .number(inMemory.savedAt), mediaLeftOut: 0,
        lifespanTouched: inMemory.lifespanTouched, inMemory: true)
    }
    if let saved, let savedAt = saved["savedAt"]?.doubleValue, now - savedAt <= autosaveTtlMs {
      return TakenAside(
        state: deserializeComposerState(saved["state"], base: base, now: now), savedAt: .number(savedAt),
        mediaLeftOut: numberOrZero(saved["mediaLeftOut"]), lifespanTouched: touchedFlag(saved["lifespanTouched"]),
        inMemory: false)
    }
    return nil
  }

  // MARK: In memory, for this run

  /// Keep `state` (files and all) for `did` until the app quits.
  public static func saveSessionDraft(
    _ did: String?, _ state: JSONValue?, now: Double, lifespanTouched: Bool? = nil, session: AutosaveSession = .shared
  ) {
    guard let did, !did.isEmpty else { return }
    session.drafts.withLock { drafts in
      if let state, hasAutosaveContent(state) {
        drafts[JSKey(did)] = SessionDraft(state: state, savedAt: now, lifespanTouched: lifespanTouched)
      } else {
        drafts[JSKey(did)] = nil
      }
    }
  }

  /// What the session layer keeps for `did`, or nil.
  public static func loadSessionDraft(_ did: String?, session: AutosaveSession = .shared) -> SessionDraft? {
    guard let did, !did.isEmpty else { return nil }
    return session.drafts.withLock { $0[JSKey(did)] }
  }

  public static func clearSessionDraft(_ did: String?, session: AutosaveSession = .shared) {
    guard let did, !did.isEmpty else { return }
    session.drafts.withLock { $0[JSKey(did)] = nil }
  }

  /// Forget everything this run holds for `did`: the post being written
  /// and the posts set aside. For an account that has left this device.
  public static func forgetSessionDrafts(_ did: String?, session: AutosaveSession = .shared) {
    guard let did, !did.isEmpty else { return }
    session.drafts.withLock { $0[JSKey(did)] = nil }
    session.aside.withLock { $0[JSKey(did)] = nil }
  }

  public static func clearAllSessionDrafts(session: AutosaveSession = .shared) {
    session.drafts.withLock { $0.removeAll() }
    session.aside.withLock { $0.removeAll() }
  }

  /// Every local preview address a state shows (image previews, a card's
  /// picked thumbnail): the web's `blob:` object URLs, in insertion order.
  public static func collectPreviewUrls(_ state: JSONValue?) -> [String] {
    var urls: [String] = []
    var seen = Set<JSKey>()
    func add(_ value: JSONValue?) {
      guard let url = value?.stringValue, PostingJS.hasPrefix(url, "blob:"), seen.insert(JSKey(url)).inserted else {
        return
      }
      urls.append(url)
    }
    for post in ComposerJS.list(ComposerJS.or(state?["posts"], nil)) {
      for image in ComposerJS.list(ComposerJS.or(post["images"], nil)) { add(image["previewUrl"]) }
      add(post["video"]?["previewUrl"])
      add(post["card"]?["thumb"])
    }
    return urls
  }

  /// Whether a preview may be let go: only when neither `state` nor any
  /// account's kept or set-aside post still shows it.
  public static func previewUrlIsHeld(_ url: String, _ state: JSONValue?, session: AutosaveSession = .shared) -> Bool {
    func holds(_ s: JSONValue?) -> Bool { collectPreviewUrls(s).jsIncludes(url) }
    if holds(state) { return true }
    if session.drafts.withLock({ Array($0.values) }).contains(where: { holds($0.state) }) { return true }
    return session.aside.withLock({ Array($0.values) }).contains { $0.contains { holds($0.state) } }
  }
}

/// The debounced writer the composer holds (the web's createAutosaver):
/// `save` writes two seconds after the last call, `flush` writes what's
/// waiting now (the app calls it when it goes to the background), `cancel`
/// drops it (after a publish). `currentDid`, when given, is asked at write
/// time: a write for any other account is dropped.
public final class Autosaver: Sendable {
  public typealias SetTimer = PublishWatch.SetTimer
  public typealias ClearTimer = PublishWatch.ClearTimer

  struct Job: Sendable {
    var did: String
    var state: JSONValue
    var lifespanTouched: Bool?
  }

  let store: (any KeyValueStore)?
  let now: @Sendable () -> Double
  let debounceMs: Double
  let currentDid: (@Sendable () -> String?)?
  let setTimer: SetTimer
  let clearTimer: ClearTimer
  let state = Locked<(timer: Int?, pending: Job?)>((nil, nil))

  public init(
    store: (any KeyValueStore)?,
    now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 },
    debounceMs: Double = Autosave.autosaveDebounceMs,
    currentDid: (@Sendable () -> String?)? = nil,
    setTimer: SetTimer? = nil,
    clearTimer: ClearTimer? = nil
  ) {
    self.store = store
    self.now = now
    self.debounceMs = debounceMs
    self.currentDid = currentDid
    let timers = setTimer.map { ($0, clearTimer ?? { _ in }) } ?? PublishWatch.taskTimers()
    self.setTimer = timers.0
    self.clearTimer = timers.1
  }

  /// Drop what's waiting.
  public func cancel() {
    let timer = state.withLock { s -> Int? in
      let timer = s.timer
      s = (nil, nil)
      return timer
    }
    if let timer { clearTimer(timer) }
  }

  /// Write what's waiting now. The entry written, or nil.
  @discardableResult
  public func flush() -> JSONValue? {
    let job = state.withLock { $0.pending }
    cancel()
    guard let job else { return nil }
    if let currentDid, !(currentDid().map { $0.jsEquals(job.did) } ?? false) { return nil }
    return Autosave.writeAutosave(job.did, job.state, store: store, now: now(), lifespanTouched: job.lifespanTouched)
  }

  /// Write `state` for `did` once `debounceMs` pass without another save.
  public func save(_ did: String?, _ state: JSONValue, lifespanTouched: Bool? = nil) {
    let old = self.state.withLock { $0.timer }
    if let old { clearTimer(old) }
    guard let did, !did.isEmpty else {
      self.state.withLock { $0 = (nil, nil) }
      return
    }
    self.state.withLock { $0.pending = Job(did: did, state: state, lifespanTouched: lifespanTouched) }
    let timer = setTimer(debounceMs) { [weak self] in self?.flush() }
    self.state.withLock { $0.timer = timer }
  }

  /// The account a write is waiting for, or nil.
  public func pending() -> String? { state.withLock { $0.pending?.did } }

  /// Cancel and stop.
  public func dispose() { cancel() }
}
