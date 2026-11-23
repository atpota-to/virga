// src/defense/harvest.js against the web code (ios/parity/cases/
// defense.harvest.js): the pure pieces, and harvestPost replayed from the
// exchanges the web harvest made with Constellation.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense.harvest"

@Suite struct HarvestParity {
  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let actual: JSONValue = [
      "MAX_PAGES": .number(Double(Harvest.maxPages)),
      "KIND_ORDER": .array(Harvest.kindOrder.map(JSONValue.string)),
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  @Test func isDid() throws {
    for c in try Parity.cases(fixture, fn: "isDid") {
      let d = Parity.diff(.bool(Harvest.isDid(c.input["value"])), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func engagementKind() throws {
    for c in try Parity.cases(fixture, fn: "engagementKind") {
      let kind = Harvest.engagementKind(
        collection: c["collection"].stringValue ?? "", path: c["path"].stringValue ?? "")
      let d = Parity.diff(.string(kind), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func harvestPost() async throws {
    for c in try Parity.cases(fixture, fn: "harvestPost") {
      // Three sources are read at once, so the requests (and Constellation's
      // waits) can come in any order.
      await expectReplay(c, ordered: false, sortedWaits: true) { transport, clock in
        let heard = Heard<HarvestProgress>()
        let only = c.input["only"]?.arrayValue?.compactMap(\.stringValue)
        let harvest = try await Harvest.harvestPost(
          c["uri"].stringValue ?? "",
          maxPages: c.input["maxPages"]?.intValue ?? Harvest.maxPages,
          only: only,
          onProgress: { heard.add($0) },
          transport: transport,
          clock: clock.clock,
          now: { date(ms: c["now"].doubleValue ?? 0) })
        return ["harvest": .of(harvest), "progress": .of(heard.all)]
      }
    }
  }
}
