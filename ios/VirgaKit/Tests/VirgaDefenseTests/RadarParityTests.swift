// src/defense/radar.js against the web code (ios/parity/cases/
// defense-early.radar.js): rings, slices, placing, texture, finding, the
// walk, and a scan on the radar.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense-early.radar"

@Suite struct RadarParity {
  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    var rings: [String: JSONValue] = [:]
    for (ring, span) in Radar.rings { rings[ring.rawValue] = [.number(span.inner), .number(span.outer)] }
    var edges: [String: JSONValue] = [:]
    for (ring, edge) in Radar.edges { edges[ring.rawValue] = .number(edge) }
    let actual: JSONValue = [
      "RINGS": .object(rings),
      "EDGES": .object(edges),
      "SCAN_SECTORS": try JSONValue(encoding: Radar.scanSectors),
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  @Test func ringOf() throws {
    for c in try Parity.cases(fixture, fn: "ringOf") {
      let band = c.input["band"]?.stringValue.flatMap(Band.named)
      let d = Parity.diff(.string(Radar.ringOf(band).rawValue), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func ringAt() throws {
    for c in try Parity.cases(fixture, fn: "ringAt") {
      let actual: JSONValue = Radar.ringAt(c["r"].doubleValue!).map { .string($0.rawValue) } ?? .null
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func spots() throws {
    for c in try Parity.cases(fixture, fn: "spots") {
      let (u, v) = Radar.spots(c["text"].stringValue!)
      let d = Parity.diff([.number(u), .number(v)], c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
      #expect(u >= 0 && u < 1 && v >= 0 && v < 1)
    }
  }

  @Test func sectorAngles() throws {
    for c in try Parity.cases(fixture, fn: "sectorAngles") {
      let d = Parity.diff(encoding: Radar.sectorAngles(c["n"].intValue!), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func sectorAt() throws {
    for c in try Parity.cases(fixture, fn: "sectorAt") {
      let actual = Radar.sectorAt(c["angle"].doubleValue!, c["n"].intValue!)
      let d = Parity.diff(.number(Double(actual)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func place() throws {
    for c in try Parity.cases(fixture, fn: "place") {
      let points = try c["points"].decode([RadarPoint].self)
      let d = Parity.diff(encoding: Radar.place(points, c["sectorCount"].intValue!), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func texture() throws {
    for c in try Parity.cases(fixture, fn: "texture") {
      let counts = c["counts"].arrayValue!.map { $0.intValue! }
      let dots = c["max"].intValue.map { Radar.texture(counts, max: $0) } ?? Radar.texture(counts)
      let d = Parity.diff(encoding: dots, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func nearest() throws {
    for c in try Parity.cases(fixture, fn: "nearest") {
      let placed = try c["placed"].decode([PlacedPoint].self)
      let found: [JSONValue] = c["queries"].arrayValue!.map { q in
        let hit = Radar.nearest(placed, q["x"]!.doubleValue!, q["y"]!.doubleValue!, q["within"]!.doubleValue!)
        return .number(Double(hit.flatMap { placed.firstIndex(of: $0) } ?? -1))
      }
      let d = Parity.diff(.array(found), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func walkOrder() throws {
    for c in try Parity.cases(fixture, fn: "walkOrder") {
      let placed = try c["placed"].decode([PlacedPoint].self)
      let order = Radar.walkOrder(placed).map { p in JSONValue.number(Double(placed.firstIndex(of: p)!)) }
      let d = Parity.diff(.array(order), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func sectorKey() throws {
    for c in try Parity.cases(fixture, fn: "sectorKey") {
      let d = Parity.diff(.string(Radar.sectorKey(c.input["kind"]?.stringValue)), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func scanRadarAndTable() throws {
    for c in try Parity.cases(fixture, fn: "scanRadar") {
      let summary = try c["summary"].decode(ScanSummary.self)
      let radar = Radar.scanRadar(summary)
      var drawn = try JSONValue(encoding: radar)
      // A mark's row is written as its DID, as the generator writes it.
      drawn["points"] = .array(radar.points.map { p in
        var point = (try? JSONValue(encoding: p)) ?? .null
        point["row"] = p.row.map { .string($0.did) } ?? .null
        return point
      })
      let actual: JSONValue = ["radar": drawn, "table": try JSONValue(encoding: Radar.radarTable(summary))]
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
      #expect(radar.points.allSatisfy { $0.row?.did == $0.id })
    }
  }
}
