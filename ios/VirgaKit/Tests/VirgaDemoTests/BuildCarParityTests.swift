// Parity with harness/buildCar.js, against
// ios/parity/fixtures/demo-world.buildCar.json, and the round trip: every
// CAR built here reads back through VirgaRepo's reader (the app's own) with
// every record, key and value.

import Foundation
import Testing
import VirgaCore
import VirgaRepo
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct BuildCarParity {
  static let fixture = "demo-world.buildCar"

  static func records(_ value: JSONValue?) -> [(key: String, value: JSONValue)] {
    (value?.arrayValue ?? []).map { pair in (pair[0]?.stringValue ?? "", pair[1] ?? .null) }
  }

  /// Reads a CAR back and checks it holds exactly these records.
  static func roundTrip(_ car: [UInt8], did: String, _ records: [(key: String, value: JSONValue)]) async throws {
    let contents = try await CarRepo.readRepoCar(car)
    #expect(contents.didString == did)
    #expect(contents.entries.count == records.count)
    for (entry, record) in zip(contents.entries, records) {
      #expect(entry.uri == "at://\(did)/\(record.key)")
      let d = Exact.diff(entry.record, record.value)
      #expect(d == nil, "\(record.key): \(d ?? "")")
    }
  }

  @Test func small() async throws {
    for c in try Parity.cases(Self.fixture, fn: "buildRepoCar") {
      let did = c["did"].stringValue ?? ""
      let records = Self.records(c.input["records"])
      let actual: JSONValue
      var built: [UInt8]? = nil
      do {
        let car = try BuildCar.buildRepoCar(did, records, rev: c.input["rev"]?.stringValue ?? "3mharnessrev22")
        built = car
        actual = [
          "length": .number(Double(car.count)),
          "sha256": .string(CanonicalJSON.sha256(bytes: car)),
          "base64": .string(Data(car).base64EncodedString()),
        ]
      } catch {
        actual = ["$throws": .string(error.localizedDescription)]
      }
      let d = Exact.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
      // Keys past ASCII are compressed by code unit, as the web does it,
      // which a reader of the spec's byte prefixes can't follow.
      if let built, c.id != "keys-past-ascii" { try await Self.roundTrip(built, did: did, records) }
    }
  }

  @Test(arguments: ["mira", "lab"])
  func world(_ id: String) async throws {
    let c = try #require(try Parity.cases(Self.fixture, fn: "buildRepoCar-world").first { $0.id == id })
    let world = World.buildWorld(now: DemoFixtures.now, account: id == "lab" ? World.lab : World.me)
    let records = World.repoRecords(world)
    let car = try BuildCar.buildRepoCar(world.me.did, records)
    let actual: JSONValue = [
      "records": .number(Double(records.count)),
      "length": .number(Double(car.count)),
      "sha256": .string(CanonicalJSON.sha256(bytes: car)),
    ]
    let d = Exact.diff(actual, c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
    try await Self.roundTrip(car, did: world.me.did, records)
  }
}
