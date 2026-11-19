// The AppView a score case scripts (ios/parity/cases/_defense.js
// `scripted`): profiles and relationships from tables, batches left
// uncounted, asks that fail. Answers exactly as the generator's fake does,
// so the Swift scorer meets what the web scorer met.

import Foundation
import VirgaCore
import VirgaDefense

/// A failed read with the status the case gave (nil: no answer at all).
struct ScriptedError: HTTPStatusError {
  var httpStatus: Int?
}

final class ScriptedAppView: Sendable {
  struct Rule: Sendable {
    var status: Int?
    var times: Int
  }

  let profiles: [String: JSONValue]
  let uncounted: [String: Int]
  let profileErrors: [String: Rule]
  let relationships: [String: JSONValue]
  let relationshipErrors: [String: Rule]
  private let state = Locked((seen: [String: Int](), asked: [[String]](), relAsked: [[String]]()))

  init(_ spec: JSONValue) {
    profiles = spec["profiles"]?.objectValue ?? [:]
    uncounted = (spec["uncounted"]?.objectValue ?? [:]).compactMapValues(\.intValue)
    relationships = spec["relationships"]?.objectValue ?? [:]
    func rules(_ value: JSONValue?) -> [String: Rule] {
      (value?.objectValue ?? [:]).mapValues { Rule(status: $0["status"]?.intValue, times: $0["times"]?.intValue ?? 0) }
    }
    profileErrors = rules(spec["profileErrors"])
    relationshipErrors = rules(spec["relationshipErrors"])
  }

  /// Every batch asked of getProfiles, in the order asked.
  var asked: [[String]] { state.wrappedValue.asked }
  var relationshipCalls: Int { state.wrappedValue.relAsked.count }

  /// The batches asked, sorted as the generator sorts them (by their JSON).
  var sortedAsked: [[String]] {
    func json(_ batch: [String]) -> [UInt16] {
      Array(("[" + batch.map { $0.jsJSONQuoted }.joined(separator: ",") + "]").utf16)
    }
    return asked.sorted { json($0).lexicographicallyPrecedes(json($1)) }
  }

  private func nth(_ kind: String, _ key: String) -> Int {
    state.withLock { s in
      let k = "\(kind):\(key)"
      let n = s.seen[k] ?? 0
      s.seen[k] = n + 1
      return n
    }
  }

  private static func fail(_ rule: Rule?, _ n: Int) throws {
    guard let rule, rule.times == -1 || n < rule.times else { return }
    throw ScriptedError(httpStatus: rule.status)
  }

  var getProfiles: GetProfiles {
    { [self] dids in
      state.withLock { $0.asked.append(dids) }
      let first = dids.first ?? ""
      let n = nth("p", first)
      try Self.fail(profileErrors[first], n)
      let drop = n < (uncounted[first] ?? 0)
      return dids.compactMap { did -> JSONValue? in
        guard var p = profiles[did] else { return nil }
        if drop, var viewer = p["viewer"]?.objectValue {
          viewer["knownFollowers"] = nil
          p["viewer"] = .object(viewer)
        }
        return p
      }
    }
  }

  var getRelationships: GetRelationships {
    { [self] _, dids in
      state.withLock { $0.relAsked.append(dids) }
      let n = nth("r", dids.first ?? "")
      try Self.fail(relationshipErrors[dids.first ?? ""], n)
      return dids.map { did in
        var r: [String: JSONValue] = ["did": .string(did)]
        for (k, v) in relationships[did]?.objectValue ?? [:] { r[k] = v }
        return .object(r)
      }
    }
  }
}

extension JSONValue {
  /// The strings of an array (non-strings dropped).
  var strings: [String] { arrayValue?.compactMap(\.stringValue) ?? [] }

  /// The array's elements as optional strings (null is nil).
  var optionalStrings: [String?] { arrayValue?.map(\.stringValue) ?? [] }
}

extension Date {
  init(ms: Double) { self.init(timeIntervalSince1970: ms / 1000) }
}

let utc = TimeZone(identifier: "UTC")!
