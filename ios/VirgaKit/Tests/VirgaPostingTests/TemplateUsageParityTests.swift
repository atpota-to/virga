// Parity for src/posting/templates/templateUsage.js (fixture
// templates.templateUsage), and what a fixture can't show.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct TemplateUsageParity {
  static let f = "templates.templateUsage"

  @Test func keys() throws {
    check(.string(TemplateUsage.templateUsagePrefix), try cases(Self.f, "TEMPLATE_USAGE_PREFIX")[0])
    for c in try cases(Self.f, "templateUsageKey") {
      check(.string(TemplateUsage.templateUsageKey(c.string("did") ?? "")), c)
    }
  }

  /// Reads and uses against a store, ending with the store's text byte for byte.
  @Test func scripts() throws {
    for c in try cases(Self.f, "script") {
      var initial: [String: String] = [:]
      for (key, value) in c["store"].objectValue ?? [:] { initial[key] = value.stringValue }
      let store = InMemoryKeyValueStore(initial)
      let zone = TimeZone(identifier: c.string("tz") ?? "UTC")!
      var results: [JSONValue] = []
      for step in c["steps"].arrayValue ?? [] {
        let args = step.arrayValue ?? []
        if args.first?.stringValue == "read" {
          let usage = TemplateUsage.readTemplateUsage(args[1].stringValue, store: store)
          results.append(.array(usage.entries.map { [.string($0.rkey), json($0.use)] }))
        } else {
          let entry = TemplateUsage.recordTemplateUse(
            args[1].stringValue, args[2].stringValue, fixtureDate(args[3]), store: store, timeZone: zone)
          results.append(json(entry))
        }
      }
      let stored = JSONValue.object(store.snapshot.mapValues(JSONValue.string))
      check(["results": .array(results), "store": stored], c, strictNulls: true)
    }
  }

  @Test func sortTemplatesForShelf() throws {
    for c in try cases(Self.f, "sortTemplatesForShelf") {
      let sorted = TemplateUsage.sortTemplatesForShelf(c["templates"].arrayValue, c["usage"], locale: "en-US")
      check(.array(sorted), c, strictNulls: true)
    }
  }

  /// The typed counts sort as the stored JSON does.
  @Test func typedCountsSortTheSame() throws {
    for c in try cases(Self.f, "sortTemplatesForShelf") {
      guard let usage = c["usage"].objectValue, usage.values.allSatisfy({ $0["count"]?.doubleValue != nil }) else { continue }
      let store = InMemoryKeyValueStore([TemplateUsage.templateUsageKey("did:plc:x"): c["usage"].jsonString()])
      let counts = TemplateUsage.readTemplateUsage("did:plc:x", store: store)
      let sorted = TemplateUsage.sortTemplatesForShelf(c["templates"].arrayValue, counts, locale: "en-US")
      check(.array(sorted), c, strictNulls: true)
    }
  }
}

@Suite struct TemplateUsageBehaviour {
  let alice = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"

  @Test func aDateThatIsntOneStampsNow() {
    let store = InMemoryKeyValueStore()
    let before = Date().timeIntervalSince1970 * 1000
    let entry = TemplateUsage.recordTemplateUse("3la", alice, Date(timeIntervalSince1970: .nan), store: store)
    let stamped = JSDate.parse(entry?.lastUsedAt ?? "", timeZone: TimeZone(identifier: "UTC")!)
    #expect(stamped >= before.rounded(.down) - 1)
  }

  @Test func aStoreThatRefusesStillCounts() {
    let store = InMemoryKeyValueStore()
    store.refusesWrites = true
    let entry = TemplateUsage.recordTemplateUse("3la", alice, Date(timeIntervalSince1970: 1_790_000_000), store: store)
    #expect(entry?.count == 1)
    #expect(store.snapshot.isEmpty)
    #expect(TemplateUsage.recordTemplateUse("3la", alice, store: nil)?.count == 1)
    #expect(TemplateUsage.readTemplateUsage(alice, store: nil).isEmpty)
  }

  @Test func countsAreKeyedByCodeUnit() {
    var counts = TemplateUsageCounts()
    counts["é"] = TemplateUseEntry(count: 1, lastUsedAt: nil)
    counts["e\u{301}"] = TemplateUseEntry(count: 2, lastUsedAt: nil)
    #expect(counts.count == 2)
    #expect(counts["é"]?.count == 1)
    #expect(counts["e\u{301}"]?.count == 2)
    #expect(counts["K"] == nil)
  }

  @Test func theCountsAreAmongTheAccountsLocalData() {
    // VirgaSession's Accounts.localDataKeys names the same key, so removing
    // the account from this device takes the counts.
    #expect(TemplateUsage.templateUsageKey(alice) == "virga:template-usage:\(alice)")
  }
}
