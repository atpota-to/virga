// Helpers for the composer's parity tests (the composer.*.js fixtures).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

enum ComposerFixtures {
  /// The ids a run mints, as ios/parity/cases/_composer.js's canonIds names
  /// them: each string shaped like a fresh post or image id (or a restored
  /// or set-aside one) that the input doesn't hold becomes `$new<n>`, in the
  /// order they first appear with object members walked in sorted order.
  static func canonIds(_ value: JSONValue, _ input: JSONValue) -> JSONValue {
    var known = Set<JSKey>()
    var stack = [input]
    while let next = stack.popLast() {
      switch next {
      case .string(let s): known.insert(JSKey(s))
      case .array(let items): stack.append(contentsOf: items)
      case .object(let members): stack.append(contentsOf: members.values)
      default: break
      }
    }
    var names: [JSKey: String] = [:]
    func walk(_ v: JSONValue) -> JSONValue {
      switch v {
      case .string(let s):
        if known.contains(JSKey(s)) || !isFresh(s) { return v }
        if let name = names[JSKey(s)] { return .string(name) }
        let name = "$new\(names.count + 1)"
        names[JSKey(s)] = name
        return .string(name)
      case .array(let items):
        return .array(items.map(walk))
      case .object(let members):
        var out: [String: JSONValue] = [:]
        for key in members.keys.sorted(by: { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }) {
          out[key] = walk(members[key]!)
        }
        return .object(out)
      default:
        return v
      }
    }
    return walk(value)
  }

  static let fresh = [
    try! NSRegularExpression(pattern: "^[pi]m[0-9a-z]{8,}$"),
    try! NSRegularExpression(pattern: "^restored-[0-9a-z]+-[0-9]+$"),
    try! NSRegularExpression(pattern: "^aside-[0-9a-z]+-[0-9]+$"),
  ]

  static func isFresh(_ s: String) -> Bool {
    let range = NSRange(location: 0, length: (s as NSString).length)
    return fresh.contains { $0.firstMatch(in: s, range: range) != nil }
  }

  /// A case's `tz`, or UTC.
  static func zone(_ c: ParityCase) -> TimeZone {
    c["tz"].stringValue.flatMap(TimeZone.init(identifier:)) ?? TimeZone(identifier: "UTC")!
  }

  /// A resolver answering from a case's `{ handle: did }` table.
  static func tableResolver(_ table: JSONValue) -> ResolveMention {
    let entries = table.objectValue ?? [:]
    return { handle in entries.jsValue(handle)?.stringValue }
  }
}

/// Checks `actual` against the case's output with fresh ids named the same way.
func checkCanon(_ actual: JSONValue, _ c: ParityCase, sourceLocation: SourceLocation = #_sourceLocation) {
  check(ComposerFixtures.canonIds(actual, c.input), c, sourceLocation: sourceLocation)
}
