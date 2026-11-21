// Ports src/posting/templates/templateUsage.js
//
// How often each post template has been used, kept on this device so using
// a template never rewrites its record (a write per use would churn the repo
// for a number nobody else needs).
//
// Stored per account under `virga:template-usage:<did>`, as the web stores
// it (the same JSON, its keys in the same order), so a value written by one
// reads in the other. Signing out keeps the counts: they are the writer's
// own history and nothing regenerates them. Removing the account from this
// device can delete them (VirgaSession's Accounts.localDataKeys lists the
// key). Without a DID nothing is read or written.

import Foundation
import VirgaCore
import VirgaNetwork

/// One template's count.
public struct TemplateUseEntry: Codable, Hashable, Sendable {
  /// A whole number of uses (a Double, as the stored JSON holds it).
  public var count: Double
  /// When it was last used, as an ISO string, or nil when unknown.
  public var lastUsedAt: String?

  public init(count: Double, lastUsedAt: String?) {
    self.count = count
    self.lastUsedAt = lastUsedAt
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(count, forKey: .count)
    try c.encode(lastUsedAt, forKey: .lastUsedAt)
  }

  /// `{"count":…,"lastUsedAt":…}`, as JSON.stringify writes it.
  var jsonText: String {
    "{\"count\":\(JSNumber.format(count)),\"lastUsedAt\":\(lastUsedAt?.jsJSONQuoted ?? "null")}"
  }
}

/// An account's counts, `{ [rkey]: { count, lastUsedAt } }`, with its keys
/// in the order a JavaScript object lists them (array-index keys first,
/// ascending, then the rest as they were added).
public struct TemplateUsageCounts: Hashable, Sendable, Codable {
  public struct Entry: Hashable, Sendable {
    public var rkey: String
    public var use: TemplateUseEntry
  }

  public private(set) var entries: [Entry] = []

  public init() {}

  public var isEmpty: Bool { entries.isEmpty }
  public var count: Int { entries.count }
  public var rkeys: [String] { entries.map(\.rkey) }

  /// `usage[rkey]`, by code unit.
  public subscript(rkey: String) -> TemplateUseEntry? {
    get { entries.first { $0.rkey.jsEquals(rkey) }?.use }
    set {
      if let index = entries.firstIndex(where: { $0.rkey.jsEquals(rkey) }) {
        if let newValue { entries[index].use = newValue } else { entries.remove(at: index) }
        return
      }
      guard let newValue else { return }
      let entry = Entry(rkey: rkey, use: newValue)
      if TemplateJS.isArrayIndex(rkey) {
        let n = UInt64(rkey)!
        let at = entries.firstIndex { !TemplateJS.isArrayIndex($0.rkey) || UInt64($0.rkey)! > n } ?? entries.count
        entries.insert(entry, at: at)
      } else {
        entries.append(entry)
      }
    }
  }

  public var json: JSONValue {
    var out: [String: JSONValue] = [:]
    for entry in entries {
      out[entry.rkey] = ["count": .number(entry.use.count), "lastUsedAt": entry.use.lastUsedAt.map(JSONValue.string) ?? .null]
    }
    return .object(out)
  }

  /// JSON.stringify of the counts, byte for byte.
  public var jsonText: String {
    "{" + entries.map { "\($0.rkey.jsJSONQuoted):\($0.use.jsonText)" }.joined(separator: ",") + "}"
  }

  public init(from decoder: Decoder) throws {
    let value = try JSONValue(from: decoder)
    self = TemplateUsage.sanitize(OrderedJSON(value))
  }

  public func encode(to encoder: Encoder) throws {
    try json.encode(to: encoder)
  }
}

public enum TemplateUsage {
  public static let templateUsagePrefix = "virga:template-usage:"

  public static func templateUsageKey(_ did: String) -> String {
    "\(templateUsagePrefix)\(did)"
  }

  // Deleted templates leave their counts behind; past this many entries the
  // least recently used are dropped so the key stays small.
  static let maxEntries = 500

  /// The stored value as the web keeps it: entries with a whole, positive
  /// count; `lastUsedAt` only when it reads as a date.
  static func sanitize(_ parsed: OrderedJSON) -> TemplateUsageCounts {
    guard case .object(let members) = parsed else { return TemplateUsageCounts() }
    var out = TemplateUsageCounts()
    for member in members {
      // `out['__proto__'] = …` sets the object's prototype on the web, so
      // that entry is never kept.
      if member.key.isEmpty || member.key == "__proto__" { continue }
      guard member.value.isObjectLike else { continue }
      let entry = member.value.value
      guard case .number(let raw)? = entry.templateField("count"), raw.isFinite else { continue }
      let count = max(0, raw.rounded(.down))
      if count == 0 { continue }
      let last = entry.templateField("lastUsedAt")?.stringValue
      let lastUsedAt = last.flatMap { JSDate.parse($0, timeZone: TimeZone(identifier: "UTC")!).isNaN ? nil : $0 }
      out[member.key] = TemplateUseEntry(count: count, lastUsedAt: lastUsedAt)
    }
    return out
  }

  /// This account's counts, empty when there are none or the store holds
  /// something unreadable.
  public static func readTemplateUsage(_ did: String?, store: (any KeyValueStore)?) -> TemplateUsageCounts {
    guard let did, !did.isEmpty, let store, let raw = store.getItem(templateUsageKey(did)), !raw.isEmpty else {
      return TemplateUsageCounts()
    }
    guard let parsed = try? OrderedJSON.parse(raw) else { return TemplateUsageCounts() }
    return sanitize(parsed)
  }

  static func usedAtMs(_ entry: TemplateUseEntry?, timeZone: TimeZone) -> Double {
    guard let last = entry?.lastUsedAt, !last.isEmpty else { return 0 }
    return JSDate.parse(last, timeZone: timeZone)
  }

  /// Count one use of the template at `rkey`. Returns its entry after the
  /// use, or nil when there is no template or no account to count it for.
  /// `timeZone` is the one a stored time without an offset is read in, for
  /// choosing which entries to drop (the active one when nil).
  @discardableResult
  public static func recordTemplateUse(
    _ rkey: String?, _ did: String?, _ now: Date = Date(), store: (any KeyValueStore)?, timeZone: TimeZone? = nil
  ) -> TemplateUseEntry? {
    guard let rkey, !rkey.isEmpty, let did, !did.isEmpty else { return nil }
    var ms = now.timeIntervalSince1970 * 1000
    if !ms.isFinite { ms = Date().timeIntervalSince1970 * 1000 }
    var usage = readTemplateUsage(did, store: store)
    let entry = TemplateUseEntry(
      count: (usage[rkey]?.count ?? 0) + 1,
      lastUsedAt: JSDate.toISOString(ms.rounded(.towardZero)))
    usage[rkey] = entry

    var kept = usage
    if usage.count > maxEntries {
      let zone = timeZone ?? AppLocale.activeTimeZone()
      kept = TemplateUsageCounts()
      let sorted = JSSort.sort(usage.entries) { a, b in usedAtMs(b.use, timeZone: zone) - usedAtMs(a.use, timeZone: zone) }
      for item in sorted.prefix(maxEntries) { kept[item.rkey] = item.use }
    }
    // Counted for this visit only when the store refuses.
    try? store?.setItem(templateUsageKey(did), kept.jsonText)
    return entry
  }

  /// Templates in shelf order: grouped (groups by name, ungrouped last),
  /// the most used first within a group, then by name. `locale` is the
  /// collation's (the active one when nil; the web uses the runtime's).
  public static func sortTemplatesForShelf<T: TemplateFields>(
    _ templates: [T]?, _ usage: TemplateUsageCounts?, locale: String? = nil
  ) -> [T] {
    sorted(templates, locale: locale) { rkey in usage?[rkey]?.count ?? 0 }
  }

  /// sortTemplatesForShelf with the counts as any object the web takes
  /// (`counts[rkey]?.count || 0`, read as a number).
  @_disfavoredOverload
  public static func sortTemplatesForShelf<T: TemplateFields>(
    _ templates: [T]?, _ usage: JSONValue?, locale: String? = nil
  ) -> [T] {
    func entry(_ rkey: String) -> JSONValue? {
      switch usage {
      case .object(let members)?: return members.jsValue(rkey)
      case .array(let items)?:
        guard TemplateJS.isArrayIndex(rkey), let index = Int(rkey), index < items.count else { return nil }
        return items[index]
      default: return nil
      }
    }
    return sorted(templates, locale: locale) { rkey in
      guard let count = entry(rkey)?.templateField("count"), count.isTruthy else { return 0 }
      return count.jsNumber
    }
  }

  static func groupOf(_ template: some TemplateFields) -> String {
    TemplateJS.orEmpty(template.templateField("group")).jsTrimmed()
  }

  static func sorted<T: TemplateFields>(_ templates: [T]?, locale: String?, countOf: (String) -> Double) -> [T] {
    let list = (templates ?? []).filter(\.templateIsPresent)
    // `counts[template.rkey]`: the key is the rkey's String form.
    func count(_ t: T) -> Double { countOf(TemplateJS.string(t.templateField("rkey"))) }
    return JSSort.sort(list) { a, b in
      let ga = groupOf(a)
      let gb = groupOf(b)
      if !ga.jsEquals(gb) {
        if ga.isEmpty { return 1 }
        if gb.isEmpty { return -1 }
        // Groups that differ only in case sort together but stay apart.
        let byName = LocaleCompare.compare(ga, gb, locale: locale, sensitivity: .base)
        return Double(byName != 0 ? byName : (LocaleCompare.codeUnitLess(ga, gb) ? -1 : 1))
      }
      let used = count(b) - count(a)
      if used != 0 && !used.isNaN { return used }
      let names = LocaleCompare.compare(
        TemplateJS.orEmpty(a.templateField("name")), TemplateJS.orEmpty(b.templateField("name")),
        locale: locale, sensitivity: .base)
      if names != 0 { return Double(names) }
      return Double(LocaleCompare.compare(
        TemplateJS.orEmpty(a.templateField("rkey")), TemplateJS.orEmpty(b.templateField("rkey")), locale: locale))
    }
  }
}
