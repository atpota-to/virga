// Parity with src/archive/useAnalyticsArchive.js end to end (fixture
// archive.model): each scenario's steps (mounts and a page's actions)
// replayed through MockTransport, one recording per step, must send the
// requests the web sent, wait its waits, show every state of the sync bar
// the web showed, and leave the archive as the web left it.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaRepo
import VirgaTestSupport
@testable import VirgaArchive

/// A transport whose recording changes step by step (the web's agent reads
/// the global fetch of the moment), cancelling the calling task once the
/// step's request `abortAt` is answered.
final class StepTransport: HTTPTransport, @unchecked Sendable {
  private let state = Locked<(base: (any HTTPTransport)?, abortAt: Int?, count: Int)>((nil, nil, 0))

  func use(_ base: any HTTPTransport, abortAt: Int?) {
    state.set((base, abortAt, 0))
  }

  func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    let (base, abortAt, index) = state.withLock { s -> ((any HTTPTransport)?, Int?, Int) in
      defer { s.count += 1 }
      return (s.base, s.abortAt, s.count)
    }
    guard let base else { throw HTTPTransportError.network("no step") }
    let response = try await base.send(request)
    if index == abortAt { withUnsafeCurrentTask { $0?.cancel() } }
    return response
  }
}

/// A clock whose time and record of waits change step by step.
final class StepClock: @unchecked Sendable {
  private let state = Locked<(now: Double, waits: [Double])>((0, []))

  func use(now: Double) { state.set((now, [])) }
  var waits: [Double] { state.wrappedValue.waits }

  var clock: NetworkClock {
    NetworkClock(
      now: { [state] in state.wrappedValue.now },
      sleep: { [state] ms in
        state.withLock { $0.waits.append(ms) }
        await Task.yield()
      })
  }
}

@MainActor
private func snapshot(_ model: ArchiveModel) -> JSONValue {
  let d = model.data
  var out: [String: JSONValue] = [
    "loaded": .bool(d.loaded), "persistent": .bool(d.persistent), "blocked": .bool(d.blocked),
    "posts": json(d.posts), "followers": json(d.followers), "following": json(d.following), "blocks": json(d.blocks),
    "inbound": json(d.inbound), "outbound": json(d.outbound), "atmosphere": .array(d.atmosphere.map(\.json)),
    "meta": d.meta.json, "rev": .number(Double(d.rev)), "actors": json(model.actors.cards),
    "sync": model.sync.map(encoded) ?? .null, "syncError": model.syncError.map(JSONValue.string) ?? .null,
  ]
  if d.followRev != 0 { out["followRev"] = .number(Double(d.followRev)) }
  return .object(out)
}

private let owner = "owner.test"
private let pds = "https://pds.example"

@MainActor
private func act(_ scenario: String, _ step: String, _ model: ArchiveModel) async -> JSONValue? {
  switch (scenario, step) {
  case ("first-build-then-sync", "build"), ("interrupted-build", "build-called-off"):
    await model.runSync()
  case ("repo-unavailable", "build"):
    await model.runSync(.full)
  case ("old-archive", "rebuild-diff-refused"):
    await model.runSync(.incremental)
  case ("first-build-then-sync", "people"):
    let did = model.did
    try? await model.setFollow("did:plc:cy", true)
    try? await model.setFollow("did:plc:ana", false)
    await model.wantActors(["did:plc:cy", "did:plc:fan", nil, "did:plc:cy"])
    await model.wantActors(["did:plc:cy"])
    let read = await model.checkActivity(["did:plc:cy", "did:plc:fan"])
    let now: Double = 1_794_657_600_000 + 3 * 3_600_000
    await model.notePosted([
      PostedItem(
        uri: "at://\(did)/app.bsky.feed.post/\(tidKey(now))", cid: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
        record: ["$type": "app.bsky.feed.post", "text": "just posted", "createdAt": .string(JSDate.toISOString(now)!)])
    ])
    await model.noteDeleted([
      "at://\(did)/app.bsky.feed.post/\(tidKey(1_794_657_600_000 - 2 * 86_400_000))", "at://did:plc:other/app.bsky.feed.post/x",
    ])
    return ["activityRead": .number(Double(read))]
  case ("first-build-then-sync", "delete"):
    await model.deleteArchive()
  default:
    break
  }
  return nil
}

/// The generator's TID for a time (clock id 0).
func tidKey(_ ms: Double) -> String {
  let alphabet = Array("234567abcdefghijklmnopqrstuvwxyz")
  var n = (UInt64(ms) * 1000) << 10
  var out: [Character] = []
  for _ in 0..<13 {
    out.append(alphabet[Int(n & 31)])
    n >>= 5
  }
  return String(out.reversed())
}

@MainActor
private func replay(_ c: ParityCase) async throws {
  let scenario = c.id
  let did = c["did"].stringValue ?? ""
  let steps = c.output["steps"]?.arrayValue ?? c.output.arrayValue ?? []
  #expect(!steps.isEmpty, "\(c): no steps")
  let registry = AnalyticsStoreRegistry()
  let transport = StepTransport()
  let clock = StepClock()
  let env = ArchiveEnvironment(
    files: nil, registry: registry, transport: transport, clock: clock.clock, didDocuments: PromiseCache(),
    timeZone: TimeZone(identifier: "UTC")!, locale: "en-US")

  if let seed = c.output["seed"] {
    let store = await AnalyticsStore.openAnalyticsStore(did, files: nil, registry: registry)
    await store.putAll("posts", seed["posts"]?.arrayValue ?? [])
    for (key, name) in [("posts_meta", "posts"), ("repo_meta", "repo"), ("followers_meta", "followers")] {
      if let meta = seed[key], !meta.isNull { await store.setMeta(name, meta) }
    }
  }

  var model: ArchiveModel?
  for step in steps {
    let name = step["name"]?.stringValue ?? ""
    let recording = RecordedFetch(step)
    let mock = recording.transport()
    transport.use(mock, abortAt: step["abortAt"]?.intValue)
    clock.use(now: num(step["now"]))
    var history: [JSONValue] = []

    if step["remount"]?.boolValue == true {
      model?.stop()
      model = nil
    }
    if model == nil {
      let agent = XRPCAgent(service: pds, transport: transport)
      model = ArchiveModel(agent: agent, did: did, handle: owner, environment: env)
    }
    let m = model!
    m.syncObserver = { history.append($0.map(encoded) ?? .null) }
    await m.start()
    let result = await act(scenario, name, m)
    var outcome: [String: JSONValue] = ["archive": snapshot(m)]
    if let result { outcome["result"] = result }

    let where_ = "\(c) step \(name)"
    let d = recording.check(sent: mock.requests, result: recorded(.object(outcome)), waits: clock.waits, ordered: true)
    #expect(d == nil, "\(where_): \(d ?? "")")
    let h = exactDiff(.array(history), step["history"] ?? .array([]))
    #expect(h == nil, "\(where_) history (\(history.count) states, the web's \(step["history"]?.arrayValue?.count ?? 0)): \(h ?? "")")
  }
  model?.stop()
}

@Suite(.serialized) struct ArchiveModelParity {
  @Test @MainActor func firstBuildThenSync() async throws {
    try await replay(try #require(try Parity.cases("archive.model", fn: "scenario").first { $0.id == "first-build-then-sync" }))
  }

  @Test @MainActor func interruptedBuild() async throws {
    try await replay(try #require(try Parity.cases("archive.model", fn: "scenario").first { $0.id == "interrupted-build" }))
  }

  @Test @MainActor func repoUnavailable() async throws {
    try await replay(try #require(try Parity.cases("archive.model", fn: "scenario").first { $0.id == "repo-unavailable" }))
  }

  @Test @MainActor func oldArchive() async throws {
    try await replay(try #require(try Parity.cases("archive.model", fn: "scenario").first { $0.id == "old-archive" }))
  }

  @Test func everyScenarioIsReplayed() throws {
    let ids = Set(try Parity.cases("archive.model", fn: "scenario").map(\.id))
    #expect(ids == ["first-build-then-sync", "interrupted-build", "repo-unavailable", "old-archive"])
  }
}
