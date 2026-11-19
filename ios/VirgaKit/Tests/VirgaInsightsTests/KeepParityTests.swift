// The kept-accounts list (the web's useKeepList, ios/parity/cases/
// insights-early.keep.js, which runs the hook itself): the key, what each
// stored value reads as, and what each change holds and writes, byte for
// byte. Then what a fixture can't show: a store that refuses the write.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct KeepParity {
  let fixture = "insights-early.keep"

  @Test func keepKey() throws {
    for c in try Parity.cases(fixture, fn: "keepKey") {
      expectOutput(.string(Keep.keepKey(c["did"].stringValue!, c["name"].stringValue!)), c)
    }
  }

  @MainActor
  func state(_ model: KeepListModel, probes: [String], store: KeyValueStore) -> JSONValue {
    var has: [String: JSONValue] = [:]
    for probe in probes { has[probe] = .bool(model.has(probe)) }
    return [
      "size": .number(Double(model.size)),
      "has": .object(has),
      "stored": store.getItem(model.key).map(JSONValue.string) ?? .null,
    ]
  }

  @Test @MainActor func everyChangeAsTheHookMakesIt() throws {
    for c in try Parity.cases(fixture, fn: "useKeepList") {
      let did = c["did"].stringValue!
      let name = c["name"].stringValue!
      var items: [String: String] = [:]
      for (key, value) in c["others"].objectValue ?? [:] { items[key] = value.stringValue }
      if let stored = c["stored"].stringValue { items[Keep.keepKey(did, name)] = stored }
      let store = InMemoryKeyValueStore(items)
      let states = c.output["states"]?.arrayValue ?? []
      let probes = (states.first?["has"]?.objectValue ?? [:]).keys.sorted()

      #expect(exactDiff(.string(Keep.keepKey(did, name)), c.output["key"] ?? .null) == nil, "\(c)")
      let model = KeepListModel(did: did, name: name, store: store)
      #expect(exactDiff(state(model, probes: probes, store: store), states[0]) == nil, "\(c) at the start")

      for (index, step) in (c["steps"].arrayValue ?? []).enumerated() {
        switch step["op"]?.stringValue {
        case "add": model.add(strings(step["dids"] ?? .null))
        case "remove": model.remove(strings(step["dids"] ?? .null))
        default: model.clear()
        }
        let expected = states[index + 1]
        let d = exactDiff(state(model, probes: probes, store: store), expected)
        #expect(d == nil, "\(c) after step \(index + 1): \(d ?? "")")
        // A model made afresh reads back what the hook would mount with.
        let fresh = KeepListModel(did: did, name: name, store: store)
        let e = exactDiff(state(fresh, probes: probes, store: store), expected)
        #expect(e == nil, "\(c) read back after step \(index + 1): \(e ?? "")")
      }

      var others: [String: JSONValue] = [:]
      for (key, value) in store.snapshot where key != Keep.keepKey(did, name) { others[key] = .string(value) }
      #expect(exactDiff(.object(others), c.output["others"] ?? [:]) == nil, "\(c): other keys untouched")
    }
  }
}

@Suite @MainActor struct KeepModelBehaviour {
  @Test func refusedWriteHoldsForThisVisitOnly() throws {
    let store = InMemoryKeyValueStore([Keep.keepKey("did:plc:me", "cleanup"): #"["did:plc:a"]"#])
    store.refusesWrites = true
    let model = KeepListModel(did: "did:plc:me", name: "cleanup", store: store)
    model.add(["did:plc:b"])
    #expect(model.has("did:plc:b"))
    #expect(model.dids == ["did:plc:a", "did:plc:b"])
    #expect(store.getItem(model.key) == #"["did:plc:a"]"#, "the store keeps what it had")
    #expect(KeepListModel(did: "did:plc:me", name: "cleanup", store: store).size == 1)
  }

  @Test func withoutAStoreItLivesInMemory() {
    let model = KeepListModel(did: "did:plc:me", name: "followback", store: nil)
    #expect(model.size == 0)
    model.add(["did:plc:a", "did:plc:a", "did:plc:b"])
    #expect(model.dids == ["did:plc:a", "did:plc:b"])
    model.remove(["did:plc:a"])
    #expect(model.dids == ["did:plc:b"])
    model.clear()
    #expect(model.size == 0)
  }

  @Test func writesTheWebsJSON() throws {
    let store = InMemoryKeyValueStore()
    let model = KeepListModel(did: "did:plc:me", name: "cleanup", store: store)
    model.add(["did:plc:a", "did:web:x.example/\"q\"", "é"])
    #expect(store.getItem("virga:keep:cleanup:did:plc:me") == #"["did:plc:a","did:web:x.example/\"q\"","é"]"#)
  }

  @Test func accountsAndToolsAreKeptApart() {
    let store = InMemoryKeyValueStore()
    KeepListModel(did: "did:plc:one", name: "cleanup", store: store).add(["did:plc:a"])
    #expect(KeepListModel(did: "did:plc:two", name: "cleanup", store: store).size == 0)
    #expect(KeepListModel(did: "did:plc:one", name: "followback", store: store).size == 0)
    #expect(KeepListModel(did: "did:plc:one", name: "cleanup", store: store).has("did:plc:a"))
  }
}
