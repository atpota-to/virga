// Parity for src/lib/carRepo.js (ios/parity/cases/repo.carRepo.js): repo
// CARs parsed into records, with the progress the parse reports; entries
// dated into atmosphere rows; and the download, replayed from the recorded
// responses.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaRepo

private let utc = TimeZone(identifier: "UTC")!

/// Collects what a parse or download reports.
final class ProgressLog<Value: Sendable>: Sendable {
  private let values = Locked<[Value]>([])
  var all: [Value] { values.wrappedValue }
  func append(_ value: Value) { values.withLock { $0.append(value) } }
}

/// Answers getRepo with the response a fixture case recorded, and keeps the
/// URLs it was asked for.
final class ReplayTransport: RepoCarTransport {
  let status: Int
  let headers: [String: String]
  let chunks: [Data]?
  let body: Data?
  let requested = Locked<[String]>([])

  init(response: JSONValue) {
    status = response["status"]?.intValue ?? 200
    var headers: [String: String] = [:]
    for (name, value) in response["headers"]?.objectValue ?? [:] { headers[name] = value.stringValue ?? "" }
    self.headers = headers
    chunks = response["chunks"]?.arrayValue?.map { Data(base64Encoded: $0.stringValue ?? "") ?? Data() }
    body = response["body"]?.stringValue.flatMap { Data(base64Encoded: $0) }
  }

  func get(_ url: String) async throws -> RepoCarResponse {
    requested.withLock { $0.append(url) }
    if let chunks {
      let stream = AsyncThrowingStream<Data, Error> { continuation in
        for chunk in chunks { continuation.yield(chunk) }
        continuation.finish()
      }
      return RepoCarResponse(status: status, headers: headers, body: .stream(stream))
    }
    return RepoCarResponse(status: status, headers: headers, body: .data(body ?? Data()))
  }
}

private func layOut(_ c: ParityCase) -> [UInt8] {
  var car = c.base64("car")
  let entry = c.base64("repeat")
  for _ in 0..<(c["times"].intValue ?? 0) { car += entry }
  return car
}

@Suite struct CarRepoParity {
  @Test func readRepoCar() async throws {
    for c in try Parity.cases("repo.carRepo", fn: "readRepoCar") {
      let log = ProgressLog<RepoCarReadProgress>()
      let actual = await outcome {
        let contents = try await CarRepo.readRepoCar(c.base64("car"), onProgress: { log.append($0) })
        var out = json(contents)
        out["progress"] = json(log.all)
        return out
      }
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func readRepoCarRecordsWithAProtoMember() async throws {
    // The decoder keeps a "__proto__" member as the record's own; these
    // cases hold the parse as JSON.stringify wrote it, which keeps it too.
    for c in try Parity.cases("repo.carRepo", fn: "readRepoCar.json") {
      let expected = try JSONValue.parse(c.output.stringValue ?? "")
      let contents = try await CarRepo.readRepoCar(c.base64("car"))
      #expect(exactDiff(json(contents), expected, strictNulls: true) == nil, "\(c)")
      #expect(contents.entries.first?.record.jsonString().contains("\"__proto__\"") == true, "\(c)")
    }
  }

  @Test func readRepoCarProgress() async throws {
    for c in try Parity.cases("repo.carRepo", fn: "readRepoCar.progress") {
      let log = ProgressLog<RepoCarReadProgress>()
      let contents = try await CarRepo.readRepoCar(layOut(c), onProgress: { log.append($0) })
      let uris = contents.entries.map(\.uri).joined(separator: "\n")
      let actual: JSONValue = [
        "did": contents.did ?? .null,
        "rev": contents.rev ?? .null,
        "count": .number(Double(contents.entries.count)),
        "uriDigest": .string(SHA256.hex(SHA256.hash(uris))),
        "first": contents.entries.first.map(json) ?? .null,
        "last": contents.entries.last.map(json) ?? .null,
        "progress": json(log.all),
      ]
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func atmosphereRowFromEntry() throws {
    for c in try Parity.cases("repo.carRepo", fn: "atmosphereRowFromEntry") {
      let actual = outcome { try CarRepo.atmosphereRowFromEntry(json: c["entry"], timeZone: utc) }
      #expect(exactDiff(actual, c.output) == nil, "\(c)")

      // The typed form agrees wherever the entry has the typed shape.
      if let entry = try? c["entry"].decode(RepoCarEntry.self) {
        let typed = outcome { json(try CarRepo.atmosphereRowFromEntry(entry, timeZone: utc)) }
        #expect(exactDiff(typed, c.output) == nil, "typed \(c)")
      }
    }
  }

  @Test func fetchRepoCar() async throws {
    for c in try Parity.cases("repo.carRepo", fn: "fetchRepoCar") {
      let transport = ReplayTransport(response: c["response"])
      let log = ProgressLog<RepoCarDownloadProgress>()
      var actual: JSONValue = [:]
      do {
        let bytes = try await CarRepo.fetchRepoCar(
          c["pds"].stringValue ?? "", c["did"].stringValue ?? "", since: c["since"].stringValue,
          transport: transport, onProgress: { log.append($0) })
        actual["result"] = ["bytes": .string(Data(bytes).base64EncodedString()), "progress": json(log.all)]
      } catch let error as RepoError {
        actual["$throws"] = .string(error.message)
        actual["status"] = error.status.map { .number(Double($0)) } ?? .null
      }
      actual["requests"] = .array(
        transport.requested.wrappedValue.map { ["url": .string($0), "method": "GET", "headers": [:], "body": nil] })
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }
}

@Suite struct CarRepoZonedParity {
  @Test func atmosphereRowFromEntryInOtherZones() throws {
    for c in try Parity.cases("repo.carRepo", fn: "atmosphereRowFromEntry.zoned") {
      let zone = try #require(TimeZone(identifier: c["zone"].stringValue ?? ""))
      let actual = outcome { try CarRepo.atmosphereRowFromEntry(json: c["entry"], timeZone: zone) }
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }
}
