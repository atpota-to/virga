// Ports src/posting/composer/restore.js
//
// What the composer brings back, and what it moves out of the way, when it
// opens, when an intent brings its own words, and when the post changes
// account. The rule all of it keeps: a post the writer wrote is never
// written over. It is either still the one on screen, or set aside
// (Autosave) and offered back. Pure over Autosave's two layers.

import Foundation
import VirgaCore

/// The post kept for an account: where it came from ('session' |
/// 'autosave'), the state, whether the writer chose its timer, and how many
/// pieces of media a relaunch lost.
public struct KeptPost: Codable, Hashable, Sendable {
  public var from: String
  public var state: JSONValue
  public var touched: Bool
  public var mediaLeftOut: Double
}

/// Another account with a post kept or set aside: `{ did, account }`.
public struct OtherKeptAccount: Codable, Hashable, Sendable {
  public var did: String
  public var account: JSONValue
}

public enum ComposerRestore {
  /// Whether the writer chose the timer on a kept post themselves. Entries
  /// saved before that was recorded fall back to "a timer that's on was
  /// chosen". `kept` is `{ lifespanTouched?, state }`.
  public static func restoredTouched(_ kept: JSONValue?) -> Bool {
    if let touched = kept?["lifespanTouched"]?.boolValue { return touched }
    return ComposerJS.truthy(kept?["state"]?["lifespan"]?["enabled"])
  }

  static func touched(_ flag: Bool?, _ state: JSONValue) -> Bool {
    var kept: [String: JSONValue] = ["state": state]
    if let flag { kept["lifespanTouched"] = .bool(flag) }
    return restoredTouched(.object(kept))
  }

  /// The post kept for `did`: this run's copy first (it still has its
  /// files), else the stored one, laid over `base`. Nil when there's none.
  public static func keptPostFor(
    _ did: String?, base: JSONValue? = nil, store: (any KeyValueStore)?, now: Double,
    session: AutosaveSession = .shared
  ) -> KeptPost? {
    guard let did, !did.isEmpty else { return nil }
    if let kept = Autosave.loadSessionDraft(did, session: session), Autosave.hasAutosaveContent(kept.state) {
      return KeptPost(
        from: "session", state: kept.state, touched: touched(kept.lifespanTouched, kept.state), mediaLeftOut: 0)
    }
    if let saved = Autosave.readAutosave(did, store: store, now: now, base: base) {
      return KeptPost(
        from: "autosave", state: ComposerModel.normalizeComposerState(saved.state).json,
        touched: touched(saved.lifespanTouched, saved.state), mediaLeftOut: saved.mediaLeftOut)
    }
    return nil
  }

  /// Forget the post being written for `did`, in both layers.
  public static func clearKept(_ did: String?, store: (any KeyValueStore)?, now: Double, session: AutosaveSession = .shared) {
    Autosave.clearSessionDraft(did, session: session)
    Autosave.clearAutosave(did, store: store, now: now)
  }

  /// Set `state` aside for `did` and forget it as the post being written
  /// there. The set-aside id, or nil when it held nothing.
  @discardableResult
  public static func setAsideState(
    _ did: String?, _ state: JSONValue?, touched: Bool? = nil, store: (any KeyValueStore)?, now: Double,
    session: AutosaveSession = .shared
  ) -> String? {
    let id = Autosave.setAside(did, state, store: store, now: now, lifespanTouched: touched, session: session)
    if id != nil { clearKept(did, store: store, now: now, session: session) }
    return id
  }

  /// Move whatever is kept for `did` into its set-aside list. The id, or nil.
  @discardableResult
  public static func setAsideKept(
    _ did: String?, base: JSONValue? = nil, store: (any KeyValueStore)?, now: Double, session: AutosaveSession = .shared
  ) -> String? {
    guard let kept = keptPostFor(did, base: base, store: store, now: now, session: session) else { return nil }
    return setAsideState(did, kept.state, touched: kept.touched, store: store, now: now, session: session)
  }

  static func postTexts(_ state: JSONValue?) -> [JSONValue] {
    ComposerJS.list(ComposerJS.or(state?["posts"], nil)).map { ComposerJS.or($0["text"], "") ?? "" }
  }

  /// Whether `state` is still exactly what an intent seeded it with (`seed`
  /// is `{ texts }`), so nothing in it is the writer's own.
  public static func isUntouchedSeed(_ state: JSONValue?, _ seed: JSONValue?) -> Bool {
    guard let seedTexts = seed?["texts"]?.arrayValue else { return false }
    let texts = postTexts(state)
    let expected: [JSONValue] = seedTexts.isEmpty ? [""] : seedTexts
    if texts.count != expected.count || zip(texts, expected).contains(where: { !ComposerJS.strictEquals($0, $1) }) {
      return false
    }
    return !ComposerJS.list(ComposerJS.or(state?["posts"], nil)).contains { post in
      ComposerJS.length(post["images"]) > 0 || ComposerJS.truthy(post["video"])
    }
  }

  /// Whether `state` holds something of the writer's worth setting aside.
  public static func worthSettingAside(_ state: JSONValue?, _ seed: JSONValue? = nil) -> Bool {
    Autosave.hasAutosaveContent(state) && !isUntouchedSeed(state, seed)
  }

  /// The web's loose file test: an object with a numeric size and a string type.
  static func isFile(_ value: JSONValue?) -> Bool {
    guard let value, ComposerJS.isObject(value) else { return false }
    return value["size"]?.doubleValue != nil && value["type"]?.stringValue != nil
  }

  /// The composer actions that put the files `filled` found (the draft's
  /// media read back) into `current`, the composer's state now: only into
  /// media that are still there, by id, and still have no file.
  public static func mediaPatches(_ current: JSONValue?, _ filled: JSONValue?) -> [ComposerAction] {
    var out: [ComposerAction] = []
    var byId: [JSKey: JSONValue] = [:]
    for post in ComposerJS.list(ComposerJS.or(filled?["posts"], nil)) {
      byId[JSKey(post["id"]?.jsString ?? "\u{0}undefined")] = post
    }
    for (index, post) in ComposerJS.list(ComposerJS.or(current?["posts"], nil)).enumerated() {
      guard let found = byId[JSKey(post["id"]?.jsString ?? "\u{0}undefined")] else { continue }
      for image in ComposerJS.list(ComposerJS.or(post["images"], nil)) {
        if isFile(image["file"]) || !ComposerJS.truthy(image["localRef"]) { continue }
        let got = ComposerJS.list(ComposerJS.or(found["images"], nil)).first {
          ComposerJS.strictEquals($0["id"], image["id"]) && ComposerJS.strictEquals($0["localRef"], image["localRef"])
        }
        guard let got, isFile(got["file"]), let file = got["file"] else { continue }
        var patch: [String: JSONValue] = [
          "file": file,
          "mime": ComposerJS.or(got["mime"], ComposerJS.or(image["mime"], "")) ?? "",
          "size": ComposerJS.coalesce(got["size"], file["size"]) ?? .null,
        ]
        if ComposerJS.truthy(got["previewUrl"]) && !ComposerJS.truthy(image["previewUrl"]) {
          patch["previewUrl"] = got["previewUrl"]
        }
        var action: [String: JSONValue] = [
          "type": "updateImage", "index": .number(Double(index)), "patch": .object(patch),
        ]
        if let id = image["id"] { action["id"] = id }
        out.append(ComposerAction(json: .object(action)))
      }
      if let v = post["video"], ComposerJS.truthy(v["localRef"]), !isFile(v["file"]),
        let fv = found["video"], ComposerJS.strictEquals(fv["localRef"], v["localRef"]), isFile(fv["file"]),
        let file = fv["file"]
      {
        var video = ComposerJS.spread(v)
        video["file"] = file
        video["mime"] = ComposerJS.or(fv["mime"], ComposerJS.or(v["mime"], "")) ?? ""
        video["size"] = ComposerJS.coalesce(fv["size"], file["size"]) ?? .null
        out.append(
          ComposerAction(json: ["type": "setVideo", "index": .number(Double(index)), "video": .object(video)]))
      }
    }
    return out
  }

  /// The first of `accounts`, other than `did`, with a post kept or set
  /// aside for it, so a composer that opens empty can say where the
  /// writer's unsent post went.
  public static func otherKeptAccount(
    _ accounts: [JSONValue]?, _ did: String?, store: (any KeyValueStore)?, now: Double,
    session: AutosaveSession = .shared
  ) -> OtherKeptAccount? {
    for account in accounts ?? [] {
      guard let other = account["did"]?.stringValue, !other.isEmpty, !other.jsEquals(did ?? "\u{0}") else { continue }
      if keptPostFor(other, store: store, now: now, session: session) != nil
        || Autosave.countSetAside(other, store: store, now: now, session: session) > 0
      {
        return OtherKeptAccount(did: other, account: account)
      }
    }
    return nil
  }
}
