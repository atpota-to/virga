// The `Map<did, string>` the veto and the scan pass around: who is
// protected and why (veto.js's answers, a scan's `kept` and curation lists),
// or who is on a curation list and its name (curationMembers). Not a port of
// a web module: the JavaScript Map those modules use.
//
// Keys compare by UTF-16 code unit, as a Map's do. A Swift dictionary keyed
// by String would take two canonically equivalent DIDs for one, and the
// veto's checks (who was answered, who is already decided) must not.

import Foundation
import VirgaCore

/// did → reason, as a JavaScript Map holds it: each key once, by code unit,
/// in the order it was first set.
public struct ReasonMap: Sendable, Hashable, Sequence, ExpressibleByDictionaryLiteral, Codable {
  public struct Entry: Sendable, Hashable {
    public var did: String
    public var reason: String
  }

  public private(set) var entries: [Entry] = []
  private var index: [JSKey: Int] = [:]

  public init() {}

  /// `new Map(pairs)`: a later pair for the same key replaces the value and
  /// keeps the first one's place.
  public init(_ pairs: [(String, String)]) {
    for (did, reason) in pairs { set(did, reason) }
  }

  public init(dictionaryLiteral elements: (String, String)...) {
    self.init(elements)
  }

  /// `map.get(did)`.
  public subscript(did: String) -> String? {
    index[JSKey(did)].map { entries[$0].reason }
  }

  /// `map.has(did)`.
  public func has(_ did: String) -> Bool {
    index[JSKey(did)] != nil
  }

  /// `map.set(did, reason)`.
  public mutating func set(_ did: String, _ reason: String) {
    if let at = index[JSKey(did)] {
      entries[at].reason = reason
    } else {
      index[JSKey(did)] = entries.count
      entries.append(Entry(did: did, reason: reason))
    }
  }

  /// `[...map.keys()]`.
  public var keys: [String] { entries.map(\.did) }
  public var count: Int { entries.count }
  public var isEmpty: Bool { entries.isEmpty }

  /// `new Map([...self, ...other])`: `other` wins where both have a key.
  public func merging(_ other: ReasonMap) -> ReasonMap {
    var out = self
    for entry in other.entries { out.set(entry.did, entry.reason) }
    return out
  }

  /// As a dictionary, for createScorer's `protectedSet`.
  public var dictionary: [String: String] {
    var out: [String: String] = [:]
    for entry in entries { out[entry.did] = entry.reason }
    return out
  }

  public func makeIterator() -> IndexingIterator<[Entry]> {
    entries.makeIterator()
  }

  public static func == (a: ReasonMap, b: ReasonMap) -> Bool {
    a.entries.count == b.entries.count
      && zip(a.entries, b.entries).allSatisfy { $0.did.jsEquals($1.did) && $0.reason.jsEquals($1.reason) }
  }

  public func hash(into hasher: inout Hasher) {
    for entry in entries {
      for unit in entry.did.utf16 { hasher.combine(unit) }
      hasher.combine(0xFFFF_FFFF as UInt32)
      for unit in entry.reason.utf16 { hasher.combine(unit) }
    }
  }

  /// Encodes as an object, as a fixture writes a Map of strings.
  public func encode(to encoder: Encoder) throws {
    try dictionary.encode(to: encoder)
  }

  public init(from decoder: Decoder) throws {
    let object = try [String: String](from: decoder)
    self.init(object.sorted { $0.key < $1.key }.map { ($0.key, $0.value) })
  }
}
