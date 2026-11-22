// autosave.js, settings.js, composer/restore.js and lib/pendingCompose.js
// held to composer.storage: the pure readers, and every script of writes
// and reads replayed against the same store, step by step.

import Foundation
import Testing
import VirgaCore
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

/// The generator's fake localStorage: a quota in UTF-16 units of keys and
/// values, writes it can refuse, and values planted past both.
final class ScriptStore: KeyValueStore, @unchecked Sendable {
  var items: [String: String] = [:]
  var quota: Int?
  var refusing = false
  let lock = NSLock()

  init(quota: Int? = nil) { self.quota = quota }

  func getItem(_ key: String) -> String? { lock.withLock { items[key] } }

  func setItem(_ key: String, _ value: String) throws {
    try lock.withLock {
      if refusing { throw KeyValueStoreError.refused(key: key) }
      if let quota {
        let used = items.filter { $0.key != key }.reduce(0) { $0 + $1.key.utf16.count + $1.value.utf16.count }
        if used + key.utf16.count + value.utf16.count > quota { throw KeyValueStoreError.quotaExceeded(key: key) }
      }
      items[key] = value
    }
  }

  func removeItem(_ key: String) { lock.withLock { _ = items.removeValue(forKey: key) } }
  func allKeys() -> [String] { lock.withLock { Array(items.keys) } }
  func plant(_ key: String, _ value: String) { lock.withLock { items[key] = value } }

  /// `{ key: { json } | { text } }`, as the generator records it.
  var snapshot: JSONValue {
    lock.withLock {
      var out: [String: JSONValue] = [:]
      for (key, value) in items {
        if let parsed = try? JSONValue.parse(value) { out[key] = ["json": parsed] } else { out[key] = ["text": .string(value)] }
      }
      return .object(out)
    }
  }
}

/// A planted value: a string as it is, anything else as its JSON.
private func planted(_ value: JSONValue?) -> String {
  if let text = value?.stringValue { return text }
  return value?.jsonString() ?? "null"
}

@Suite struct ComposerStorageParity {
  static let f = "composer.storage"
  static let t0: Double = 1_794_819_600_000  // Date.UTC(2026, 10, 16, 9)

  @Test func autosaveReaders() throws {
    for c in try cases(Self.f, "autosaveConstants") {
      check(
        [
          "AUTOSAVE_PREFIX": .string(Autosave.autosavePrefix),
          "AUTOSAVE_VERSION": .number(Double(Autosave.autosaveVersion)),
          "AUTOSAVE_TTL_MS": .number(Autosave.autosaveTtlMs),
          "AUTOSAVE_DEBOUNCE_MS": .number(Autosave.autosaveDebounceMs),
          "MAX_SET_ASIDE": .number(Double(Autosave.maxSetAside)),
          "key": .string(Autosave.autosaveKey("did:plc:mira")),
        ], c)
    }
    for c in try cases(Self.f, "serializeComposerState") {
      check(json(Autosave.serializeComposerState(c.input["state"], views: c.input["views"]?.boolValue ?? true)), c)
    }
    for c in try cases(Self.f, "hasAutosaveContent") {
      check(.bool(Autosave.hasAutosaveContent(c.input["state"])), c)
    }
    for c in try cases(Self.f, "deserializeComposerState") {
      checkCanon(Autosave.deserializeComposerState(c.input["stored"], base: c.input["base"], now: Self.t0), c)
    }
    for c in try cases(Self.f, "collectPreviewUrls") {
      check(.array(Autosave.collectPreviewUrls(c.input["state"]).map(JSONValue.string)), c)
    }
  }

  @Test func restoreReaders() throws {
    for c in try cases(Self.f, "restoredTouched") { check(.bool(ComposerRestore.restoredTouched(c.input["kept"])), c) }
    for c in try cases(Self.f, "isUntouchedSeed") {
      check(.bool(ComposerRestore.isUntouchedSeed(c.input["state"], c.input["seed"])), c)
    }
    for c in try cases(Self.f, "worthSettingAside") {
      check(.bool(ComposerRestore.worthSettingAside(c.input["state"], c.input["seed"])), c)
    }
    for c in try cases(Self.f, "mediaPatches") {
      check(json(ComposerRestore.mediaPatches(c.input["current"], c.input["filled"])), c)
    }
  }

  /// Runs one autosave script as the generator's runScript does.
  static func run(_ script: JSONValue) -> JSONValue {
    let session = AutosaveSession()
    let store: ScriptStore? = script["noStore"]?.isTruthy == true ? nil : ScriptStore(quota: script["quota"]?.intValue)
    let timers = Locked<[(fn: @Sendable () -> Void, live: Bool)]>([])
    let clock = Locked(t0)
    var saver: Autosaver?
    var steps: [JSONValue] = []
    var results: [JSONValue] = []
    for step in script["steps"]?.arrayValue ?? [] {
      let now = step["now"]?.doubleValue ?? clock.withLock { $0 }
      let did = step["did"]?.stringValue
      let state = step["state"]
      let touched = step["touched"]?.boolValue
      let id = step["idFrom"]?.intValue.map { results[$0].stringValue } ?? step["id"]?.stringValue
      var result: JSONValue = .null
      switch step["op"]?.stringValue {
      case "write":
        result = Autosave.writeAutosave(did, state, store: store, now: now, lifespanTouched: touched) ?? .null
      case "read": result = json(Autosave.readAutosave(did, store: store, now: now, base: step["base"]))
      case "clear": Autosave.clearAutosave(did, store: store, now: now)
      case "aside":
        result = json(Autosave.setAside(did, state, store: store, now: now, lifespanTouched: touched, session: session))
      case "count": result = .number(Double(Autosave.countSetAside(did, store: store, now: now, session: session)))
      case "take":
        result = json(Autosave.takeSetAside(did, id: id, store: store, now: now, base: step["base"], session: session))
      case "saveSession":
        Autosave.saveSessionDraft(did, state, now: now, lifespanTouched: touched, session: session)
      case "loadSession": result = json(Autosave.loadSessionDraft(did, session: session))
      case "clearSession": Autosave.clearSessionDraft(did, session: session)
      case "forget": Autosave.forgetSessionDrafts(did, session: session)
      case "held": result = .bool(Autosave.previewUrlIsHeld(step["url"]?.stringValue ?? "", state, session: session))
      case "plant": store?.plant(step["key"]?.stringValue ?? "", planted(step["value"]))
      case "refuse": store?.refusing = step["flag"]?.boolValue ?? false
      case "kept":
        result = json(ComposerRestore.keptPostFor(did, base: step["base"], store: store, now: now, session: session))
      case "clearKept": ComposerRestore.clearKept(did, store: store, now: now, session: session)
      case "asideState":
        result = json(
          ComposerRestore.setAsideState(did, state, touched: touched, store: store, now: now, session: session))
      case "asideKept":
        result = json(ComposerRestore.setAsideKept(did, base: step["base"], store: store, now: now, session: session))
      case "otherKept":
        result = json(
          ComposerRestore.otherKeptAccount(step["accounts"]?.arrayValue, did, store: store, now: now, session: session))
      case "saver":
        let current = step["currentDid"]?.stringValue
        var currentDid: (@Sendable () -> String?)?
        if step["currentDid"] != nil { currentDid = { @Sendable in current } }
        let setTimer: Autosaver.SetTimer = { _, fn in
          timers.withLock { list -> Int in
            list.append((fn, true))
            return list.count - 1
          }
        }
        let clearTimer: Autosaver.ClearTimer = { n in
          timers.withLock { list in
            if list.indices.contains(n) { list[n].live = false }
          }
        }
        saver = Autosaver(
          store: store, now: { clock.withLock { $0 } }, currentDid: currentDid, setTimer: setTimer,
          clearTimer: clearTimer)
      case "save": saver?.save(did, state ?? .null, lifespanTouched: touched)
      case "flush": result = saver?.flush() ?? .null
      case "cancel": saver?.cancel()
      case "pending": result = saver?.pending().map(JSONValue.string) ?? .null
      case "fire":
        let live = timers.withLock { list -> [@Sendable () -> Void] in
          var fns: [@Sendable () -> Void] = []
          for i in list.indices where list[i].live {
            list[i].live = false
            fns.append(list[i].fn)
          }
          return fns
        }
        for fn in live { fn() }
      case "tick": clock.withLock { $0 = step["to"]?.doubleValue ?? $0 }
      default: break
      }
      results.append(result)
      steps.append(["result": result, "store": store?.snapshot ?? .null])
    }
    return .array(steps)
  }

  @Test func autosaveScripts() throws {
    for c in try cases(Self.f, "autosaveScript") {
      checkCanon(Self.run(c.input["script"] ?? [:]), c)
    }
  }

  @Test func settingsReaders() throws {
    for c in try cases(Self.f, "settingsConstants") {
      check(
        [
          "POSTING_SETTINGS_PREFIX": .string(PostingSettingsStore.postingSettingsPrefix),
          "DEFAULT_ACTIONS": json(PostingSettingsStore.defaultActions),
          "WEEKDAY_KEYS": json(PostingSettingsStore.weekdayKeys),
          "MAX_LANGS": .number(Double(PostingSettingsStore.maxLangs)),
          "MAX_SLOTS_PER_DAY": .number(Double(PostingSettingsStore.maxSlotsPerDay)),
          "POSTING_SETTING_KEYS": json(PostingSettingsStore.postingSettingKeys),
          "key": .string(PostingSettingsStore.postingSettingsKey("did:plc:mira")),
        ], c)
    }
    for c in try cases(Self.f, "baseLanguage") {
      check(json(PostingSettingsStore.baseLanguage(c.input["language"])), c)
    }
    for c in try cases(Self.f, "defaultPostingSettings") {
      check(PostingSettingsStore.defaultPostingSettings(language: c.input["language"]).json, c)
    }
  }

  @Test func settingsScripts() throws {
    for c in try cases(Self.f, "settingsScript") {
      let script = c.input["script"] ?? [:]
      let store: ScriptStore? = script["noStore"]?.isTruthy == true ? nil : ScriptStore()
      let bus = PostingEventBus()
      let events = Locked<[JSONValue]>([])
      let off = try PostingEvents.onPostingEvent(PostingEvents.settings, target: bus) { detail in
        events.withLock { $0.append(detail) }
      }
      var steps: [JSONValue] = []
      for step in script["steps"]?.arrayValue ?? [] {
        let did = step["did"]?.stringValue
        var result: JSONValue = .null
        switch step["op"]?.stringValue {
        case "write":
          do {
            result = try PostingSettingsStore.writePostingSettings(did, step["patch"], store: store, target: bus).json
          } catch let error as PostingSettingsError {
            result = ["$throws": .string(error.message), "field": error.field.map(JSONValue.string) ?? .null]
          }
        case "read":
          result = PostingSettingsStore.readPostingSettings(did, store: store, language: step["language"]).json
        case "plant": store?.plant(PostingSettingsStore.postingSettingsKey(did ?? ""), planted(step["value"]))
        case "refuse": store?.refusing = step["flag"]?.boolValue ?? false
        default: break
        }
        steps.append(["result": result, "store": store?.snapshot ?? .null])
      }
      off()
      check(["steps": .array(steps), "events": .array(events.withLock { $0 })], c)
    }
  }

  @Test func resolveDefaultGates() async throws {
    for c in try cases(Self.f, "resolveDefaultGates") {
      let input = c.input
      var read: (@Sendable () async throws -> JSONValue?)?
      if input["none"]?.isTruthy != true {
        read = { @Sendable () async throws -> JSONValue? in
          if input["throws"]?.isTruthy == true { throw JSError(message: "down") }
          return input["found"]
        }
      }
      let out = await outcome { json(try await PostingSettingsStore.resolveDefaultGates(input["settings"], readDefaultGates: read)) }
      check(out, c)
    }
  }

  @Test func pendingCompose() throws {
    for c in try cases(Self.f, "pendingConstants") {
      check(
        [
          "PENDING_COMPOSE_KEY": .string(PendingCompose.pendingComposeKey),
          "PENDING_COMPOSE_TTL_MS": .number(PendingCompose.pendingComposeTtlMs),
        ], c)
    }
    for c in try cases(Self.f, "isComposePath") { check(.bool(PendingCompose.isComposePath(c.input["path"])), c) }
    for c in try cases(Self.f, "pendingScript") {
      var store: ScriptStore? = ScriptStore()
      var steps: [JSONValue] = []
      for step in c.input["steps"]?.arrayValue ?? [] {
        var result: JSONValue = .null
        let now = step["now"]?.doubleValue ?? 0
        switch step["op"]?.stringValue {
        case "remember":
          result = .bool(PendingCompose.rememberPendingCompose(step["path"], step["search"], store: store, now: now))
        case "take": result = PendingCompose.takePendingCompose(store: store, now: now).map(JSONValue.string) ?? .null
        case "plant": store?.plant(PendingCompose.pendingComposeKey, step["value"]?.stringValue ?? "")
        case "refuse": store?.refusing = true
        case "noStore": store = nil
        default: break
        }
        steps.append(["result": result, "store": store?.snapshot ?? .null])
      }
      check(.array(steps), c)
    }
  }
}
