// Strings compared as JavaScript compares them.
//
// Swift's `==` on String is canonical equivalence: "é" (U+00E9) equals
// "e\u{301}", and so do Set<String> membership, Dictionary keys,
// `contains` and `firstIndex(of:)`. JavaScript's `===`, `includes`,
// `indexOf`, a Set and an object's keys compare UTF-16 code units, so
// those are two strings there. Wherever the web compares two strings that
// come from outside the code (ids, DIDs, keys read back from storage, a
// caller's registry), this target compares them with these.
//
// A comparison with a literal or a constant table of ASCII words is exact
// either way, unless the word has "K", ";" or "`": those three are the
// only ASCII characters something else canonically decomposes to (the
// Kelvin sign, the Greek question mark and the Greek varia). So the
// key "K" of a key press is compared here too.
//
// (VirgaCore has no such helper yet; this is internal until it does.)

import Foundation

extension String {
  /// `a === b`: the same UTF-16 code units.
  func jsEquals(_ other: String) -> Bool {
    utf16.elementsEqual(other.utf16)
  }
}

extension Optional where Wrapped == String {
  /// `a === b` for values that may be missing: nil only equals nil.
  func jsEquals(_ other: String?) -> Bool {
    switch (self, other) {
    case (nil, nil): return true
    case (let a?, let b?): return a.jsEquals(b)
    default: return false
    }
  }
}

/// A string as a JavaScript Set or Map holds it: equal only to the same
/// code units.
struct JSKey: Hashable, Sendable {
  let value: String
  init(_ value: String) { self.value = value }

  static func == (a: JSKey, b: JSKey) -> Bool { a.value.jsEquals(b.value) }

  func hash(into hasher: inout Hasher) {
    for unit in value.utf16 { hasher.combine(unit) }
  }
}

extension Dictionary where Key == String {
  /// `object[key]` over an object's own keys, matched by code units (a
  /// key that is only canonically equivalent isn't the same key).
  func jsValue(_ key: String) -> Value? {
    guard let index = index(forKey: key), self[index].key.jsEquals(key) else { return nil }
    return self[index].value
  }
}

extension Sequence where Element == String {
  /// `list.includes(value)`, by code units.
  func jsIncludes(_ value: String) -> Bool {
    contains { $0.jsEquals(value) }
  }
}
