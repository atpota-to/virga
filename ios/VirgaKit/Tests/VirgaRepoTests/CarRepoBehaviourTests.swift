// Behaviour of the repo download and parse beyond the fixtures: a repo
// built here and read back, cancellation, transport failures, local-time
// dates in zones other than UTC, and the URL the download asks for.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaRepo

/// A repo CAR built in Swift: one MST node per `fanout` keys under a root,
/// with real CIDs, as a PDS would export it.
private func buildRepo(did: String, rev: String, records: [(key: String, value: JSONValue)]) throws -> [UInt8] {
  var blocks: [(cid: CID, data: [UInt8])] = []
  func add(_ value: DagCborValue) throws -> CID {
    let data = try DagCbor.encode(value)
    let cid = CID.create(codec: CID.codecDagCbor, data: data)
    blocks.append((cid, data))
    return cid
  }
  func add(_ value: JSONValue) throws -> CID {
    let data = try DagCbor.encode(value)
    let cid = CID.create(codec: CID.codecDagCbor, data: data)
    blocks.append((cid, data))
    return cid
  }
  // Leaves of up to 16 keys each, prefix-compressed, under one root whose
  // entries are the first key of each leaf after the first.
  let sorted = records.sorted { Array($0.key.utf8).lexicographicallyPrecedes(Array($1.key.utf8)) }
  func entries(_ items: [(key: String, value: CID, tree: CID?)]) -> DagCborValue {
    var previous: [UInt8] = []
    return .array(
      items.map { item in
        let bytes = Array(item.key.utf8)
        var p = 0
        while p < bytes.count, p < previous.count, bytes[p] == previous[p] { p += 1 }
        previous = bytes
        return .map([
          "p": .number(Double(p)), "k": .bytes(Array(bytes[p...])), "v": .link(item.value),
          "t": item.tree.map { .link($0) } ?? .null,
        ])
      })
  }
  var recordCids: [CID] = []
  for record in sorted { recordCids.append(try add(record.value)) }
  var leaves: [CID] = []
  var firsts: [(String, CID)] = []
  var index = 0
  while index < sorted.count {
    let end = min(index + 16, sorted.count)
    let start = index == 0 ? 0 : index + 1
    let items = (start..<end).map { (key: sorted[$0].key, value: recordCids[$0], tree: CID?.none) }
    leaves.append(try add(DagCborValue.map(["l": .null, "e": entries(items)])))
    if index > 0 { firsts.append((sorted[index].key, recordCids[index])) }
    index = end
  }
  let rootItems = firsts.enumerated().map { (key: $1.0, value: $1.1, tree: Optional(leaves[$0 + 1])) }
  let root = try add(
    DagCborValue.map(["l": leaves.first.map { .link($0) } ?? .null, "e": entries(rootItems)]))
  let commit = try add(
    DagCborValue.map([
      "did": .string(did), "version": .number(3), "data": .link(root), "rev": .string(rev), "prev": .null,
      "sig": .bytes([UInt8](repeating: 0, count: 64)),
    ]))
  // Commit first, as a PDS writes it.
  let commitBlock = blocks.removeLast()
  return CarWriter.writeCar(roots: [commit], blocks: [commitBlock] + blocks)
}

/// A transport whose body never ends, until cancelled.
private struct EndlessTransport: RepoCarTransport {
  func get(_ url: String) async throws -> RepoCarResponse {
    let stream = AsyncThrowingStream<Data, Error> { continuation in
      let task = Task {
        while !Task.isCancelled {
          continuation.yield(Data([0]))
          try? await Task.sleep(nanoseconds: 1_000_000)
        }
        continuation.finish(throwing: CancellationError())
      }
      continuation.onTermination = { _ in task.cancel() }
    }
    return RepoCarResponse(status: 200, body: .stream(stream))
  }
}

private struct FailingTransport: RepoCarTransport {
  struct Offline: Error {}
  func get(_ url: String) async throws -> RepoCarResponse { throw Offline() }
}

private struct FailingStreamTransport: RepoCarTransport {
  struct Reset: Error {}
  func get(_ url: String) async throws -> RepoCarResponse {
    let stream = AsyncThrowingStream<Data, Error> { continuation in
      continuation.yield(Data([1, 2, 3]))
      continuation.finish(throwing: Reset())
    }
    return RepoCarResponse(status: 200, body: .stream(stream))
  }
}

@Suite struct CarRepoBehaviour {
  @Test func readsBackARepoBuiltHere() async throws {
    var records: [(key: String, value: JSONValue)] = []
    for i in 0..<500 {
      let collection = ["app.bsky.feed.like", "app.bsky.feed.post", "app.bsky.graph.follow"][i % 3]
      let rkey = TID.encode(micros: UInt64(1_700_000_000_000_000 + i * 1_000_000), clockId: UInt64(i % 1024))
      records.append(("\(collection)/\(rkey)", ["$type": .string(collection), "n": .number(Double(i))]))
    }
    let car = try buildRepo(did: "did:plc:built", rev: "3mbuilt222222", records: records)
    let log = ProgressLog<RepoCarReadProgress>()
    let contents = try await CarRepo.readRepoCar(Data(car), onProgress: { log.append($0) })
    #expect(contents.didString == "did:plc:built")
    #expect(contents.revString == "3mbuilt222222")
    #expect(contents.empty == nil)
    let expected = records.sorted { Array($0.key.utf8).lexicographicallyPrecedes(Array($1.key.utf8)) }
    #expect(contents.entries.map { "\($0.collection)/\($0.rkey)" } == expected.map(\.key))
    #expect(contents.entries.map(\.record) == expected.map(\.value))
    #expect(contents.entries.allSatisfy { $0.uri == "at://did:plc:built/\($0.collection)/\($0.rkey)" })
    #expect(log.all.isEmpty, "a parse of fewer than \(CarRepo.yieldEvery) steps reports nothing")

    // Every entry dates by its TID.
    for (entry, index) in zip(contents.entries, 0...) {
      let row = try CarRepo.atmosphereRowFromEntry(entry, timeZone: TimeZone(identifier: "UTC")!)
      #expect(row?.at == Double(TID.tidTimestamp(entry.rkey) ?? -1), "\(index)")
    }
  }

  @Test func reportsProgressInOrder() async throws {
    var records: [(key: String, value: JSONValue)] = []
    for i in 0..<4500 { records.append(("x.test/\(String(format: "%05d", i))", ["i": .number(Double(i))])) }
    let car = try buildRepo(did: "did:plc:big", rev: "3mbig", records: records)
    let log = ProgressLog<RepoCarReadProgress>()
    let contents = try await CarRepo.readRepoCar(car, onProgress: { log.append($0) })
    #expect(contents.entries.count == 4500)
    // 4,500 records, ~283 leaves, a root and a commit: one report while
    // indexing (step 4,000) and two while decoding (8,000).
    let stages = log.all.map(\.stage)
    #expect(stages == [.index, .decode])
    #expect(log.all[0].total == car.count)
    #expect(log.all[1].total == 4500)
  }

  @Test func cancellingStopsTheDownload() async throws {
    let task = Task {
      try await CarRepo.fetchRepoCar("https://pds.example", "did:plc:x", transport: EndlessTransport())
    }
    try await Task.sleep(nanoseconds: 20_000_000)
    task.cancel()
    let result = await task.result
    #expect(throws: CancellationError.self) { try result.get() }
  }

  @Test func cancellingStopsTheParse() async throws {
    var records: [(key: String, value: JSONValue)] = []
    for i in 0..<9000 { records.append(("x.test/\(String(format: "%05d", i))", ["i": .number(Double(i))])) }
    let car = try buildRepo(did: "did:plc:big", rev: "3mbig", records: records)
    let started = Locked(false)
    let task = Task {
      try await CarRepo.readRepoCar(car, onProgress: { _ in started.set(true) })
    }
    // Cancelled before it starts, it stops at its first yield.
    task.cancel()
    let result = await task.result
    #expect(throws: CancellationError.self) { try result.get() }
    #expect(started.wrappedValue, "it got as far as its first report")
  }

  @Test func aClosureTransportAdaptsAnyClient() async throws {
    let seen = Locked<[String]>([])
    let transport = RepoCarTransportClosure { url in
      seen.withLock { $0.append(url) }
      return RepoCarResponse(status: 200, headers: ["Content-Length": "3"], body: .data(Data([1, 2, 3])))
    }
    let log = ProgressLog<RepoCarDownloadProgress>()
    let bytes = try await CarRepo.fetchRepoCar(
      "https://pds.example", "did:plc:x", transport: transport, onProgress: { log.append($0) })
    #expect(bytes == [1, 2, 3])
    #expect(seen.wrappedValue == ["https://pds.example/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Ax"])
    #expect(log.all == [RepoCarDownloadProgress(bytes: 3, total: 3)])
  }

  @Test func transportFailuresPassThrough() async throws {
    await #expect(throws: FailingTransport.Offline.self) {
      try await CarRepo.fetchRepoCar("https://pds.example", "did:plc:x", transport: FailingTransport())
    }
    await #expect(throws: FailingStreamTransport.Reset.self) {
      try await CarRepo.fetchRepoCar("https://pds.example", "did:plc:x", transport: FailingStreamTransport())
    }
  }

  @Test func httpFailuresCarryTheStatus() async throws {
    let transport = ReplayTransport(response: ["status": 502])
    do {
      _ = try await CarRepo.fetchRepoCar("https://pds.example", "did:plc:x", since: "3mrev", transport: transport)
      Issue.record("expected a failure")
    } catch let error as RepoError {
      #expect(error.status == 502)
      #expect(error.errorDescription == "HTTP 502 from getRepo (since diff)")
    }
  }

  @Test func theUrlItAsksFor() {
    #expect(
      CarRepo.getRepoURL("https://pds.example", "did:plc:abc")
        == "https://pds.example/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Aabc")
    #expect(
      CarRepo.getRepoURL("https://pds.example", "did:plc:abc", since: "3m~x y")
        == "https://pds.example/xrpc/com.atproto.sync.getRepo?did=did%3Aplc%3Aabc&since=3m%7Ex+y")
    #expect(!CarRepo.getRepoURL("https://pds.example", "did:plc:abc", since: "").contains("since"))
  }

  @Test func localTimesInOtherZones() throws {
    // Date.parse in Node 22 with TZ set to each zone, including a spring
    // gap, an autumn overlap and Lord Howe's half-hour shift.
    let expected: [String: [(String, Double)]] = [
      "America/New_York": [
        ("2026-03-15T12:00:00", 1_773_590_400_000), ("2026-01-15 12:00", 1_768_496_400_000),
        ("Mar 8 2026 02:30", 1_772_955_000_000), ("Nov 1 2026 01:30", 1_793_511_000_000),
        ("2026-03-15", 1_773_532_800_000), ("Mar 15 2026", 1_773_547_200_000),
        ("2026-10-04T02:15:00", 1_791_094_500_000), ("1970-01-01T00:00:00", 18_000_000),
      ],
      "Asia/Kolkata": [
        ("2026-03-15T12:00:00", 1_773_556_200_000), ("2026-01-15 12:00", 1_768_458_600_000),
        ("Mar 8 2026 02:30", 1_772_917_200_000), ("Nov 1 2026 01:30", 1_793_476_800_000),
        ("2026-03-15", 1_773_532_800_000), ("Mar 15 2026", 1_773_513_000_000),
        ("2026-10-04T02:15:00", 1_791_060_300_000), ("1970-01-01T00:00:00", -19_800_000),
      ],
      "Australia/Lord_Howe": [
        ("2026-03-15T12:00:00", 1_773_536_400_000), ("2026-01-15 12:00", 1_768_438_800_000),
        ("Mar 8 2026 02:30", 1_772_897_400_000), ("Nov 1 2026 01:30", 1_793_457_000_000),
        ("2026-03-15", 1_773_532_800_000), ("Mar 15 2026", 1_773_493_200_000),
        ("2026-10-04T02:15:00", 1_791_042_300_000), ("1970-01-01T00:00:00", -36_000_000),
      ],
      "Europe/London": [
        ("2026-03-15T12:00:00", 1_773_576_000_000), ("2026-01-15 12:00", 1_768_478_400_000),
        ("Mar 8 2026 02:30", 1_772_937_000_000), ("Nov 1 2026 01:30", 1_793_496_600_000),
        ("2026-03-15", 1_773_532_800_000), ("Mar 15 2026", 1_773_532_800_000),
        ("2026-10-04T02:15:00", 1_791_076_500_000), ("1970-01-01T00:00:00", -3_600_000),
      ],
    ]
    for (zone, cases) in expected {
      let timeZone = try #require(TimeZone(identifier: zone))
      for (text, ms) in cases {
        #expect(JSDate.parse(text, timeZone: timeZone) == ms, "\(zone) \(text)")
      }
    }
  }

  @Test func isoStrings() {
    #expect(JSDate.toISOString(0) == "1970-01-01T00:00:00.000Z")
    #expect(JSDate.toISOString(1_773_576_000_123) == "2026-03-15T12:00:00.123Z")
    #expect(JSDate.toISOString(-1) == "1969-12-31T23:59:59.999Z")
    #expect(JSDate.toISOString(8.64e15) == "+275760-09-13T00:00:00.000Z")
    #expect(JSDate.toISOString(-8.64e15) == "-271821-04-20T00:00:00.000Z")
    #expect(JSDate.toISOString(-62_198_755_200_000) == "-000001-01-01T00:00:00.000Z")
    #expect(JSDate.toISOString(8.64e15 + 1) == nil)
    #expect(JSDate.toISOString(.nan) == nil)
  }
}
