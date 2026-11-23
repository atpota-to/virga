// adviser/usage.js held to adviser.usage.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// What a store holds, each value parsed where it is JSON, as the
/// generators' `snapshot(store)` records it.
func storeSnapshot(_ store: InMemoryKeyValueStore) -> JSONValue {
  snapshotJSON(store.snapshot.map { ($0.key, $0.value) })
}

func storeSnapshot(_ store: CodeUnitKeyValueStore) -> JSONValue {
  snapshotJSON(store.items.withLock { $0.map { ($0.key.value, $0.value) } })
}

private func snapshotJSON(_ items: [(String, String)]) -> JSONValue {
  var out: [String: JSONValue] = [:]
  for (key, value) in items {
    if let json = try? JSONValue.parse(value) { out[key] = ["json": json] } else { out[key] = ["text": .string(value)] }
  }
  return .object(out)
}

/// localStorage as browsers key it: by code unit (InMemoryKeyValueStore's
/// Dictionary keys are canonically equivalent, so "é" and "e\u{301}" would
/// share an entry).
final class CodeUnitKeyValueStore: KeyValueStore, Sendable {
  let items: Locked<[JSKey: String]>

  init(_ initial: [String: String] = [:]) {
    items = Locked(Dictionary(uniqueKeysWithValues: initial.map { (JSKey($0.key), $0.value) }))
  }

  func getItem(_ key: String) -> String? { items.withLock { $0[JSKey(key)] } }
  func setItem(_ key: String, _ value: String) throws { items.withLock { $0[JSKey(key)] = value } }
  func removeItem(_ key: String) { items.withLock { _ = $0.removeValue(forKey: JSKey(key)) } }
  func allKeys() -> [String] { items.withLock { $0.keys.map(\.value) } }
}

@Suite struct AdviserUsageParity {
  static let f = "adviser.usage"

  @Test func constants() throws {
    for c in try cases(Self.f, "usageConstants") {
      check(
        [
          "ADVISER_USAGE_KEY_PREFIX": .string(AdviserUsageStore.adviserUsageKeyPrefix),
          "USAGE_FEATURES": json(AdviserUsageStore.usageFeatures),
          "FREE_MONTHLY_LIMITS": .object(
            Dictionary(uniqueKeysWithValues: AdviserUsageStore.freeMonthlyLimits.map { ($0.key.rawValue, .number($0.value)) })),
          "key": .string(AdviserUsageStore.adviserUsageKey("did:plc:writer")),
        ], c)
    }
  }

  @Test func months() throws {
    for c in try cases(Self.f, "currentMonthKey") {
      check(.string(AdviserUsageStore.currentMonthKey(now: c["now"].doubleValue!)), c)
    }
    for c in try cases(Self.f, "usageResetsAt") {
      let at = AdviserUsageStore.usageResetsAt(now: c["now"].doubleValue!)
      check(["ms": at.isNaN ? "NaN" : .number(at)], c)
    }
  }

  @Test func scripts() throws {
    for c in try cases(Self.f, "usageScript") {
      let initial = (c["initial"].objectValue ?? [:]).compactMapValues(\.stringValue)
      let store = CodeUnitKeyValueStore(initial)
      let given: (any KeyValueStore)? = c["noStore"].boolValue == true ? nil : store
      var steps: [JSONValue] = []
      for op in c["ops"].arrayValue ?? [] {
        let did = op["did"]?.stringValue
        let now = op["now"]?.doubleValue ?? 0
        let result: JSONValue
        do {
          let feature = try AdviserUsageFeature.checked(op["feature"]?.stringValue)
          switch op["op"]?.stringValue {
          case "read":
            result = json(AdviserUsageStore.readAdviserUsage(did, feature: feature, now: now, store: given))
          case "record":
            result = json(
              AdviserUsageStore.recordAdviserUsage(did, op["usage"], feature: feature, now: now, store: given))
          case "clear":
            AdviserUsageStore.clearAdviserUsage(did, feature: feature, store: given)
            result = .null
          case "mark":
            result = json(
              AdviserUsageStore.markAdviserLimitReached(did, op["limit"], feature: feature, now: now, store: given))
          case "atLimit":
            result = .bool(AdviserUsageStore.isAdviserAtLimit(did, feature: feature, now: now, store: given))
          case "left":
            result = AdviserUsageStore.adviserUsesLeft(did, feature: feature, now: now, store: given).map(JSONValue.number) ?? .null
          default:
            Issue.record("unknown op \(op)")
            result = .null
          }
          steps.append(["value": result, "store": storeSnapshot(store)])
        } catch {
          steps.append(["$throws": .string(message(of: error)), "store": storeSnapshot(store)])
        }
      }
      check(.array(steps), c)
    }
  }

  @Test func lines() throws {
    for c in try cases(Self.f, "adviserUsageLine") {
      let actual = outcome {
        let feature = try AdviserUsageFeature.checked(c["feature"].stringValue ?? "adviser")
        return .string(
          AdviserUsageStore.adviserUsageLine(
            c.input["usage"], feature: feature, now: c["now"].doubleValue!, locale: c.string("locale")))
      }
      check(actual, c)
    }
  }
}
