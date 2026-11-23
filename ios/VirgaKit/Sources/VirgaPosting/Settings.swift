// Ports src/posting/settings.js
//
// Each account's posting settings, kept on this device under
// `virga:posting:<did>` in the key-value store (the web's localStorage;
// never on the PDS): the languages and reply and quote settings a new post
// starts with, its default lifespan, the weekly queue, what the main button
// does, and the adviser's setup.
//
// Defaults are never written back. A reader that finds nothing, or a value
// it can't use, gets that key's default; so a setting added later reaches
// every account without a migration. The web's usePostingSettings hook is
// PostingSettingsModel. (The web also follows other tabs' writes through
// the `storage` event; one app has no other tabs, and every write here
// goes out on the posting events bus.)

import Foundation
import Observation
import VirgaCore
import VirgaNetwork

/// The weekly queue as settings keep it: `{ timezone, slots }`, every day present.
public struct QueueSettings: Codable, Hashable, Sendable {
  public var timezone: String
  /// Each weekday key ('mon' … 'sun') to its sorted 'HH:MM' times.
  public var slots: [String: [String]]

  public init(timezone: String, slots: [String: [String]]) {
    self.timezone = timezone
    self.slots = slots
  }

  /// The schedule as the queue's slot math takes it.
  public var json: JSONValue { (try? JSONValue(encoding: self)) ?? [:] }
}

/// An account's posting settings, every key present.
public struct PostingSettings: Codable, Hashable, Sendable {
  public var langs: [String]
  /// The reply and quote settings a new post starts with; nil to follow
  /// Bluesky's own.
  public var gates: PostGates?
  /// The default timer, never pinned to a time.
  public var lifespan: TimerRule
  public var queue: QueueSettings
  /// 'post' | 'schedule' | 'queue' | 'draft'.
  public var defaultAction: String
  public var requireAltText: Bool
  public var showThreadSuggestion: Bool
  /// 'off' | 'counter'.
  public var threadNumbering: String
  public var adviser: AdviserSettings
  public var suggestBestTimes: Bool

  enum CodingKeys: String, CodingKey {
    case langs, gates, lifespan, queue, defaultAction, requireAltText, showThreadSuggestion, threadNumbering, adviser,
      suggestBestTimes
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    langs = try c.decode([String].self, forKey: .langs)
    gates = try c.decodeIfPresent(PostGates.self, forKey: .gates)
    lifespan = SelfDestruct.normalizeTimer(try c.decode(JSONValue.self, forKey: .lifespan))
    queue = try c.decode(QueueSettings.self, forKey: .queue)
    defaultAction = try c.decode(String.self, forKey: .defaultAction)
    requireAltText = try c.decode(Bool.self, forKey: .requireAltText)
    showThreadSuggestion = try c.decode(Bool.self, forKey: .showThreadSuggestion)
    threadNumbering = try c.decode(String.self, forKey: .threadNumbering)
    adviser = AdviserSetup.normalizeAdviserSettings(try c.decode(JSONValue.self, forKey: .adviser))
    suggestBestTimes = try c.decode(Bool.self, forKey: .suggestBestTimes)
  }

  init(
    langs: [String], gates: PostGates?, lifespan: TimerRule, queue: QueueSettings, defaultAction: String,
    requireAltText: Bool, showThreadSuggestion: Bool, threadNumbering: String, adviser: AdviserSettings,
    suggestBestTimes: Bool
  ) {
    self.langs = langs
    self.gates = gates
    self.lifespan = lifespan
    self.queue = queue
    self.defaultAction = defaultAction
    self.requireAltText = requireAltText
    self.showThreadSuggestion = showThreadSuggestion
    self.threadNumbering = threadNumbering
    self.adviser = adviser
    self.suggestBestTimes = suggestBestTimes
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(langs, forKey: .langs)
    try c.encode(gates?.json ?? .null, forKey: .gates)
    try c.encode(lifespan, forKey: .lifespan)
    try c.encode(queue, forKey: .queue)
    try c.encode(defaultAction, forKey: .defaultAction)
    try c.encode(requireAltText, forKey: .requireAltText)
    try c.encode(showThreadSuggestion, forKey: .showThreadSuggestion)
    try c.encode(threadNumbering, forKey: .threadNumbering)
    try c.encode(adviser, forKey: .adviser)
    try c.encode(suggestBestTimes, forKey: .suggestBestTimes)
  }

  /// The settings as the web's object.
  public var json: JSONValue { (try? JSONValue(encoding: self)) ?? [:] }
}

/// A value a setting can't take: the web's Error with `field`.
public struct PostingSettingsError: Error, LocalizedError, Hashable, Sendable {
  public var field: String?
  public var message: String
  public init(field: String?, message: String) {
    self.field = field
    self.message = message
  }
  public var errorDescription: String? { message }
}

/// The reply settings a new post starts with, and where they came from.
public struct ResolvedDefaultGates: Codable, Hashable, Sendable {
  /// `{ custom: false, reply, quotes }`.
  public var gates: JSONValue
  /// 'settings' | 'bluesky' | 'everyone'.
  public var source: String
  public var notice: String?

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(gates, forKey: .gates)
    try c.encode(source, forKey: .source)
    try c.encode(notice, forKey: .notice)
  }
}

public enum PostingSettingsStore {
  public static let postingSettingsPrefix = "virga:posting:"

  public static func postingSettingsKey(_ did: String) -> String { "\(postingSettingsPrefix)\(did)" }

  public static let defaultActions = ["post", "schedule", "queue", "draft"]
  public static let weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

  /// Most posting-language tags a post can carry (app.bsky.feed.post `langs`).
  public static let maxLangs = 3
  /// More than anyone posts in a day, and few enough that the queue editor
  /// stays a list rather than a grid.
  public static let maxSlotsPerDay = 48

  static let defaultLifespanSeconds = 86_400

  public static let postingSettingKeys = [
    "langs", "gates", "lifespan", "queue", "defaultAction", "requireAltText", "showThreadSuggestion",
    "threadNumbering", "adviser", "suggestBestTimes",
  ]

  /// The base of a device language ("en-GB" → "en"), or nil.
  public static func baseLanguage(_ language: JSONValue?) -> String? {
    let text = ComposerJS.truthy(language) ? language!.jsString : ""
    let trimmed = Array(text.jsTrimmed().utf16)
    let base = String(decoding: trimmed.prefix { $0 != 0x2D && $0 != 0x5F }, as: UTF16.self).jsLowercased()
    let units = Array(base.utf16)
    guard (2...3).contains(units.count), units.allSatisfy({ $0 >= 0x61 && $0 <= 0x7A }) else { return nil }
    return base
  }

  public static func baseLanguage(_ language: String?) -> String? { baseLanguage(language.map(JSONValue.string)) }

  static func defaultLifespan() -> TimerRule {
    var rule = SelfDestruct.normalizeTimer(
      ["enabled": false, "lifespanSeconds": .number(Double(defaultLifespanSeconds))] as JSONValue)
    rule.deleteAt = nil
    return rule
  }

  /// A fresh copy of the queue's shipped week.
  static func defaultQueue() -> QueueSettings {
    var slots: [String: [String]] = [:]
    for day in weekdayKeys {
      slots[day] = PostingQueue.defaultPostingQueue["slots"]?[day]?.arrayValue?.compactMap(\.stringValue) ?? []
    }
    return QueueSettings(timezone: PostingQueue.defaultPostingQueue["timezone"]?.stringValue ?? "", slots: slots)
  }

  /// The settings an account has before it changes any. `language` is the
  /// device's (Locale.preferredLanguages.first on iOS).
  public static func defaultPostingSettings(language: JSONValue? = nil) -> PostingSettings {
    PostingSettings(
      langs: [baseLanguage(language) ?? "en"],
      gates: nil,
      lifespan: defaultLifespan(),
      queue: defaultQueue(),
      defaultAction: "post",
      requireAltText: false,
      showThreadSuggestion: true,
      threadNumbering: "off",
      adviser: AdviserSetup.normalizeAdviserSettings(AdviserSetup.defaultAdviserSettings),
      suggestBestTimes: true)
  }

  public static func defaultPostingSettings(language: String?) -> PostingSettings {
    defaultPostingSettings(language: language.map(JSONValue.string))
  }

  // MARK: Per-key validation

  static func invalid(_ field: String, _ message: String) -> PostingSettingsError {
    PostingSettingsError(field: field, message: message)
  }

  /// `/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{1,8})*$/`.
  static func isLangTag(_ tag: String) -> Bool {
    let parts = PostingQueue.split(tag, 0x2D)
    func letter(_ u: UInt16) -> Bool { (u >= 0x41 && u <= 0x5A) || (u >= 0x61 && u <= 0x7A) }
    func alnum(_ u: UInt16) -> Bool { letter(u) || (u >= 0x30 && u <= 0x39) }
    let first = Array(parts[0].utf16)
    guard (2...3).contains(first.count), first.allSatisfy(letter) else { return false }
    return parts.dropFirst().allSatisfy { part in
      let units = Array(part.utf16)
      return (1...8).contains(units.count) && units.allSatisfy(alnum)
    }
  }

  static func checkLangs(_ value: JSONValue) throws -> JSONValue {
    guard let list = value.arrayValue else { throw invalid("langs", "Languages are a list.") }
    var out: [String] = []
    for raw in list {
      let tag = (raw.isTruthy ? raw.jsString : "").jsTrimmed()
      if !isLangTag(tag) { throw invalid("langs", "“\(tag)” isn’t a language tag.") }
      if !out.contains(where: { $0.jsLowercased().jsEquals(tag.jsLowercased()) }) { out.append(tag) }
    }
    if out.count > maxLangs { throw invalid("langs", "A post can have at most \(maxLangs) languages.") }
    return .array(out.map(JSONValue.string))
  }

  /// `/^at:\/\/[^/]+\/app\.bsky\.graph\.list\/[^/]+$/`: three non-empty
  /// pieces, the record key anything without a '/' (a '?' or '#' in it
  /// too, where an AT URI parser would stop).
  static func isListUri(_ uri: String) -> Bool {
    let units = Array(uri.utf16)
    let scheme = Array("at://".utf16)
    guard units.count > scheme.count, Array(units[0..<scheme.count]) == scheme else { return false }
    let pieces = units[scheme.count...].split(separator: 0x2F, omittingEmptySubsequences: false)
    return pieces.count == 3 && !pieces[0].isEmpty && !pieces[2].isEmpty
      && Array(pieces[1]) == Array("app.bsky.graph.list".utf16)
  }

  static func checkReplyRule(_ rule: JSONValue?) -> JSONValue? {
    guard let rule, TimerJS.isObject(rule) else { return nil }
    if let type = rule["type"]?.stringValue, ["mention", "follower", "following"].contains(type) {
      return ["type": .string(type)]
    }
    if rule["type"] == "list", let list = rule["list"]?.stringValue, isListUri(list) {
      return ["type": "list", "list": .string(list)]
    }
    return nil
  }

  static func checkGates(_ value: JSONValue) throws -> JSONValue {
    if value.isNull { return .null }
    guard value.isTruthy, TimerJS.isObject(value) else {
      throw invalid("gates", "Reply settings are an object or null.")
    }
    var reply: JSONValue = .null
    if let raw = value["reply"], !raw.isNull {
      guard let list = raw.arrayValue else {
        throw invalid("gates", "Who can reply is a list of rules, or null for everyone.")
      }
      var rules: [JSONValue] = []
      for item in list {
        guard let rule = checkReplyRule(item) else {
          throw invalid("gates", "One of the reply rules isn’t one Bluesky knows.")
        }
        let same = rules.contains {
          ComposerJS.strictEquals($0["type"], rule["type"]) && ComposerJS.strictEquals($0["list"], rule["list"])
        }
        if !same { rules.append(rule) }
      }
      // threadgate `allow` holds at most five rules.
      if rules.count > 5 { throw invalid("gates", "Who can reply takes at most five rules.") }
      reply = .array(rules)
    }
    return ["reply": reply, "quotes": .bool(value["quotes"] != .bool(false))]
  }

  static func checkPlainObject(_ field: String) -> (JSONValue) throws -> JSONValue {
    { value in
      guard case .object = value else { throw invalid(field, "\(field) is an object.") }
      return value
    }
  }

  static func checkQueue(_ value: JSONValue) throws -> JSONValue {
    guard case .object = value else { throw invalid("queue", "The weekly schedule is an object.") }
    let timezone = value["timezone"]?.stringValue?.jsTrimmed() ?? ""
    if !timezone.isEmpty && PostingQueue.timeZone(named: timezone) == nil {
      throw invalid("queue", "“\(timezone)” isn’t a time zone.")
    }
    var slots: [String: JSONValue] = [:]
    for day in weekdayKeys {
      let raw = ComposerJS.coalesce(value["slots"]?[day], .array([])) ?? .array([])
      guard let list = raw.arrayValue else { throw invalid("queue", "Each day is a list of times.") }
      var times: [String] = []
      for t in list {
        guard let time = t.stringValue, isSlotTime(time) else {
          throw invalid("queue", "“\(t.jsString)” isn’t a time like 09:30.")
        }
        if !times.jsIncludes(time) { times.append(time) }
      }
      if times.count > maxSlotsPerDay { throw invalid("queue", "A day takes at most \(maxSlotsPerDay) times.") }
      slots[day] = .array(times.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }.map(JSONValue.string))
    }
    return ["timezone": .string(timezone), "slots": .object(slots)]
  }

  /// `/^([01]\d|2[0-3]):[0-5]\d$/`.
  static func isSlotTime(_ text: String) -> Bool {
    guard let f = PostingQueue.fields(text, [2, 2], ":") else { return false }
    return f[0] <= 23 && f[1] <= 59
  }

  static func checkAction(_ value: JSONValue) throws -> JSONValue {
    guard ComposerJS.includes(defaultActions, value) else {
      throw invalid("defaultAction", "“\(jsText(value))” isn’t an action.")
    }
    return value
  }

  /// `${value}` in a sentence.
  static func jsText(_ value: JSONValue) -> String {
    if case .object = value { return "[object Object]" }
    return value.jsString
  }

  static func checkBoolean(_ field: String) -> (JSONValue) throws -> JSONValue {
    { value in
      guard case .bool = value else { throw invalid(field, "\(field) is true or false.") }
      return value
    }
  }

  static func checkThreadNumbering(_ value: JSONValue) throws -> JSONValue {
    guard ComposerJS.includes(ThreadSplit.threadNumberingOptions, value) else {
      throw invalid("threadNumbering", "“\(jsText(value))” isn’t a way to number posts.")
    }
    return value
  }

  static func checker(_ key: String) -> ((JSONValue) throws -> JSONValue)? {
    switch key {
    case "langs": return checkLangs
    case "gates": return checkGates
    case "lifespan": return checkPlainObject("lifespan")
    case "queue": return checkQueue
    case "defaultAction": return checkAction
    case "requireAltText": return checkBoolean("requireAltText")
    case "showThreadSuggestion": return checkBoolean("showThreadSuggestion")
    case "threadNumbering": return checkThreadNumbering
    case "adviser": return checkPlainObject("adviser")
    case "suggestBestTimes": return checkBoolean("suggestBestTimes")
    default: return nil
    }
  }

  // MARK: Read and write

  static func readStored(_ did: String?, _ store: (any KeyValueStore)?) -> [String: JSONValue] {
    guard let did, !did.isEmpty, let store else { return [:] }
    let text = store.getItem(postingSettingsKey(did))
    guard let text, !text.isEmpty, let parsed = try? JSONValue.parse(text), case .object(let members) = parsed else {
      return [:]
    }
    return members
  }

  static func normalizeLifespan(_ raw: JSONValue?) -> TimerRule {
    var rule = SelfDestruct.normalizeTimer(raw ?? .null)
    rule.deleteAt = nil
    return rule
  }

  /// Settings from the web's object (every key present, as checked).
  static func settings(from members: [String: JSONValue], defaults: PostingSettings) -> PostingSettings {
    var out = defaults
    if let v = members["langs"] { out.langs = v.arrayValue?.compactMap(\.stringValue) ?? [] }
    if let v = members["gates"] { out.gates = v.isNull ? nil : PostGates(json: v) }
    if let v = members["queue"] {
      out.queue = QueueSettings(
        timezone: v["timezone"]?.stringValue ?? "",
        slots: (v["slots"]?.objectValue ?? [:]).mapValues { $0.arrayValue?.compactMap(\.stringValue) ?? [] })
    }
    if let v = members["defaultAction"]?.stringValue { out.defaultAction = v }
    if let v = members["requireAltText"]?.boolValue { out.requireAltText = v }
    if let v = members["showThreadSuggestion"]?.boolValue { out.showThreadSuggestion = v }
    if let v = members["threadNumbering"]?.stringValue { out.threadNumbering = v }
    if let v = members["suggestBestTimes"]?.boolValue { out.suggestBestTimes = v }
    out.lifespan = normalizeLifespan(members["lifespan"] ?? defaults.lifespan.json)
    out.adviser = AdviserSetup.normalizeAdviserSettings(members["adviser"] ?? defaults.adviser.json)
    return out
  }

  /// `did`'s posting settings: every key present, each stored value that
  /// passes its check, the default otherwise. `language` is the device's.
  public static func readPostingSettings(_ did: String?, store: (any KeyValueStore)?, language: JSONValue? = nil)
    -> PostingSettings
  {
    let defaults = defaultPostingSettings(language: language)
    let stored = readStored(did, store)
    var checked: [String: JSONValue] = [:]
    for key in postingSettingKeys {
      guard let value = stored[key], let check = checker(key) else { continue }
      // An unreadable value reads as the default and is left for the next write.
      if let ok = try? check(value) { checked[key] = ok }
    }
    return settings(from: checked, defaults: defaults)
  }

  /// Merge `patch` into `did`'s stored settings and return them as
  /// readPostingSettings would. Unknown keys are ignored; a known key with
  /// a value it can't take throws (with `field`) before anything is
  /// written. Only the keys that were stored or patched are written.
  /// Announces `virga:posting-settings` on `target`.
  @discardableResult
  public static func writePostingSettings(
    _ did: String?, _ patch: JSONValue?, store: (any KeyValueStore)?, language: JSONValue? = nil,
    target: PostingEventBus? = .shared
  ) throws -> PostingSettings {
    guard let did, !did.isEmpty else {
      throw PostingSettingsError(field: nil, message: "Posting settings belong to an account.")
    }
    var checked: [String: JSONValue] = [:]
    var order: [String] = []
    for (key, value) in (patch?.objectValue ?? [:]).sorted(by: { $0.key < $1.key }) {
      guard let check = checker(key) else { continue }
      checked[key] = try check(value)
      order.append(key)
    }
    var next = readStored(did, store)
    for (key, value) in checked { next[key] = value }
    // Kept for this run only when the store refuses: the event still tells the open screens.
    try? store?.setItem(postingSettingsKey(did), JSONStringify.stringify(.object(next)))
    var settings = readPostingSettings(did, store: store, language: language)
    // A live view can't wait on storage that refused the write.
    let live = self.settings(from: checked, defaults: settings)
    for key in order {
      switch key {
      case "langs": settings.langs = live.langs
      case "gates": settings.gates = live.gates
      case "lifespan": settings.lifespan = live.lifespan
      case "queue": settings.queue = live.queue
      case "defaultAction": settings.defaultAction = live.defaultAction
      case "requireAltText": settings.requireAltText = live.requireAltText
      case "showThreadSuggestion": settings.showThreadSuggestion = live.showThreadSuggestion
      case "threadNumbering": settings.threadNumbering = live.threadNumbering
      case "adviser": settings.adviser = live.adviser
      case "suggestBestTimes": settings.suggestBestTimes = live.suggestBestTimes
      default: break
      }
    }
    _ = try? PostingEvents.emitPostingEvent(
      PostingEvents.settings, ["did": .string(did), "settings": settings.json], target: target)
    return settings
  }

  /// Take back `keys` of `did`'s stored settings (all of them when nil),
  /// so they follow the defaults again. The hook's `reset`.
  @discardableResult
  public static func resetPostingSettings(
    _ did: String?, keys: [String]? = nil, store: (any KeyValueStore)?, language: JSONValue? = nil,
    target: PostingEventBus? = .shared
  ) -> PostingSettings {
    guard let did, !did.isEmpty, let store else { return readPostingSettings(did, store: store, language: language) }
    var stored = readStored(did, store)
    for key in keys ?? Array(stored.keys) { stored[key] = nil }
    // Nothing to undo when the store refuses: the defaults below are what the screen shows.
    try? store.setItem(postingSettingsKey(did), JSONStringify.stringify(.object(stored)))
    let next = readPostingSettings(did, store: store, language: language)
    _ = try? PostingEvents.emitPostingEvent(
      PostingEvents.settings, ["did": .string(did), "settings": next.json], target: target)
    return next
  }

  /// The reply and quote settings a new post starts with, when the writer
  /// hasn't chosen any: the account's posting settings, else its Bluesky
  /// setting (read with `readDefaultGates`, which gives up after 7 s), else
  /// everyone, with a notice saying why.
  /// Throws, as the web does, only for settings whose own gates can't be
  /// read (readPostingSettings never gives such).
  public static func resolveDefaultGates(
    _ settings: JSONValue?,
    readDefaultGates: (@Sendable () async throws -> JSONValue?)? = nil
  ) async throws -> ResolvedDefaultGates {
    if let gates = settings?["gates"], gates.isTruthy {
      var out = ComposerJS.spread(try checkGates(gates))
      out["custom"] = false
      return ResolvedDefaultGates(gates: .object(out), source: "settings", notice: nil)
    }
    if let readDefaultGates {
      if let found = try? await readDefaultGates(), TimerJS.isObject(found) {
        var input: [String: JSONValue] = ["reply": ComposerJS.coalesce(found["reply"], .null) ?? .null]
        if let quotes = found["quotes"] { input["quotes"] = quotes }
        if let checked = try? checkGates(.object(input)) {
          var out = ComposerJS.spread(checked)
          out["custom"] = false
          return ResolvedDefaultGates(gates: .object(out), source: "bluesky", notice: nil)
        }
      }
    }
    return ResolvedDefaultGates(
      gates: ["custom": false, "reply": .null, "quotes": true], source: "everyone",
      notice: "Couldn’t read your reply settings from Bluesky, so anyone can reply and quote this post.")
  }

  /// resolveDefaultGates reading Bluesky's setting with the account's agent.
  public static func resolveDefaultGates(_ settings: PostingSettings, agent: (any GatesAgent)?) async
    -> ResolvedDefaultGates
  {
    var read: (@Sendable () async throws -> JSONValue?)?
    if let agent {
      read = { @Sendable in await Gates.readDefaultGates(agent)?.json }
    }
    let everyone = ResolvedDefaultGates(
      gates: ["custom": false, "reply": .null, "quotes": true], source: "everyone", notice: nil)
    return (try? await resolveDefaultGates(settings.json, readDefaultGates: read)) ?? everyone
  }
}

/// `did`'s posting settings, kept current across the app (the web's
/// usePostingSettings): `settings`, `update(patch)` and `reset(keys)`.
@MainActor @Observable
public final class PostingSettingsModel {
  public private(set) var did: String?
  public private(set) var settings: PostingSettings

  @ObservationIgnored let store: (any KeyValueStore)?
  @ObservationIgnored let language: JSONValue?
  @ObservationIgnored let target: PostingEventBus?
  @ObservationIgnored var unsubscribe: PostingEventUnsubscribe?
  /// Announcements on their way to this model (the bus delivers on the
  /// announcer's thread; the model takes them on the main actor).
  @ObservationIgnored let deliveries = Locked<[Task<Void, Never>]>([])

  public init(did: String?, store: (any KeyValueStore)?, language: String? = nil, target: PostingEventBus? = .shared) {
    self.did = did
    self.store = store
    self.language = language.map(JSONValue.string)
    self.target = target
    settings = PostingSettingsStore.readPostingSettings(did, store: store, language: self.language)
    listen()
  }

  /// Follow another account.
  public func setDid(_ did: String?) {
    guard did != self.did else { return }
    self.did = did
    settings = PostingSettingsStore.readPostingSettings(did, store: store, language: language)
    listen()
  }

  func listen() {
    unsubscribe?()
    unsubscribe = nil
    guard let did, !did.isEmpty else { return }
    let language = self.language
    let deliveries = self.deliveries
    unsubscribe = try? PostingEvents.onPostingEvent(PostingEvents.settings, did: did, target: target) {
      [weak self] detail in
      let settings = detail["settings"].flatMap { try? $0.decode(PostingSettings.self) }
      @MainActor func apply(_ model: PostingSettingsModel?) {
        guard let model, model.did == did else { return }
        model.settings =
          settings ?? PostingSettingsStore.readPostingSettings(did, store: model.store, language: language)
      }
      let delivery = Task { @MainActor [weak self] in apply(self) }
      deliveries.withLock { $0.append(delivery) }
    }
  }

  /// Merge `patch` and save it; throws as writePostingSettings does.
  @discardableResult
  public func update(_ patch: JSONValue) throws -> PostingSettings {
    let next = try PostingSettingsStore.writePostingSettings(
      did, patch, store: store, language: language, target: target)
    settings = next
    return next
  }

  /// Back to the defaults for `keys` (all when nil).
  @discardableResult
  public func reset(_ keys: [String]? = nil) -> PostingSettings {
    let next = PostingSettingsStore.resetPostingSettings(did, keys: keys, store: store, language: language, target: target)
    settings = next
    return next
  }

  /// Waits until every announcement made so far has reached this model.
  public func settle() async {
    while true {
      let pending = deliveries.withLock { list -> [Task<Void, Never>] in
        defer { list.removeAll() }
        return list
      }
      if pending.isEmpty { return }
      for task in pending { await task.value }
    }
  }

  /// Stop listening (the hook's unmount).
  public func stop() {
    unsubscribe?()
    unsubscribe = nil
  }
}
