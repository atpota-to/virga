// What a fixture can't show about the template service: loads held open
// while writes and resets land (templateService.test.js's races), a load
// shared by every caller, and the Swift error types it reads.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
@testable import VirgaPosting

/// A latch a fake call waits on until the test opens it.
actor Gate {
  private var open = false
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func wait() async {
    if open { return }
    await withCheckedContinuation { waiters.append($0) }
  }

  func release() {
    open = true
    for waiter in waiters { waiter.resume() }
    waiters = []
  }
}

/// A repo whose calls the test scripts: each answers from a closure, and
/// every call is recorded.
final class FakeRepo: TemplateRepoAgent, @unchecked Sendable {
  let did: String?
  let calls = Locked<[String]>([])
  var onList: @Sendable (String?) async throws -> JSONValue = { _ in ["records": []] }
  var onCreate: @Sendable (JSONValue) async throws -> JSONValue
  var onPut: @Sendable (String, JSONValue) async throws -> JSONValue
  var onDelete: @Sendable (String) async throws -> JSONValue = { _ in [:] }
  private let minted = Locked(0)

  init(did: String?) {
    self.did = did
    let minted = self.minted
    let owner = did ?? ""
    onCreate = { _ in
      let n = minted.withLock { $0 += 1; return $0 }
      return ["uri": .string("at://\(owner)/net.anisota.feed.template/3lnew\(n)"), "cid": .string("bafynew\(n)")]
    }
    onPut = { rkey, _ in ["uri": .string("at://\(owner)/net.anisota.feed.template/\(rkey)"), "cid": .string("bafyput-\(rkey)")] }
  }

  func listRecords(repo: String, collection: String, limit: Int, cursor: String?) async throws -> JSONValue {
    calls.withLock { $0.append("list \(cursor ?? "-")") }
    return try await onList(cursor)
  }

  func createRecord(repo: String, collection: String, record: JSONValue) async throws -> JSONValue {
    calls.withLock { $0.append("create") }
    return try await onCreate(record)
  }

  func putRecord(repo: String, collection: String, rkey: String, record: JSONValue) async throws -> JSONValue {
    calls.withLock { $0.append("put \(rkey)") }
    return try await onPut(rkey, record)
  }

  func deleteRecord(repo: String, collection: String, rkey: String) async throws -> JSONValue {
    calls.withLock { $0.append("delete \(rkey)") }
    return try await onDelete(rkey)
  }

  func count(_ prefix: String) -> Int { calls.wrappedValue.filter { $0.hasPrefix(prefix) }.count }
}

let bob = "did:plc:bob"
let carol = "did:plc:carol"

func entry(_ rkey: String, _ name: String, did: String = bob, text: String = "") -> JSONValue {
  [
    "uri": .string("at://\(did)/net.anisota.feed.template/\(rkey)"),
    "cid": .string("cid-\(rkey)"),
    "value": ["$type": "net.anisota.feed.template", "name": .string(name), "text": .string(text), "createdAt": "2026-09-01T00:00:00.000Z"],
  ]
}

/// A repo whose single page is read now but answered when the gate opens.
func slowRepo(_ records: [JSONValue], did: String = bob) -> (FakeRepo, Gate) {
  let repo = FakeRepo(did: did)
  let gate = Gate()
  repo.onList = { _ in
    await gate.wait()
    return ["records": .array(records)]
  }
  return (repo, gate)
}

/// Lets the main actor run what is queued (the load's first steps).
@MainActor func settle() async {
  for _ in 0..<20 { await Task.yield() }
}

@MainActor @Suite struct TemplateServiceBehaviour {
  let store = InMemoryKeyValueStore()
  let service: TemplateService

  init() {
    service = TemplateService(store: store, target: nil, locale: "en-US")
  }

  func names(_ templates: [PostTemplate]) -> [String] { templates.map(\.name) }

  @Test func sharesALoadInFlightAndAsksAgainOnceItSettles() async throws {
    let (repo, gate) = slowRepo([entry("3la", "Shared")])
    let account = TemplateAccount(did: bob, agent: repo)
    let a = service.loadTask(account)
    let b = service.loadTask(account)
    await settle()
    await gate.release()
    #expect(names(try await a.value) == ["Shared"])
    #expect(names(try await b.value) == ["Shared"])
    #expect(repo.count("list") == 1)
    try await service.load(account)
    #expect(repo.count("list") == 2)
  }

  @Test func keepsATemplateCreatedWhileThePagesCameIn() async throws {
    let (repo, gate) = slowRepo([entry("3la", "Older")])
    let account = TemplateAccount(did: bob, agent: repo)
    let pending = service.loadTask(account)
    await settle()
    try await service.create(obj(["name": "Made meanwhile", "text": "Hello"]), account)
    await gate.release()
    #expect(names(try await pending.value) == ["Made meanwhile", "Older"])
    #expect(service.isLoaded(bob))
    let cached = try JSONValue.parse(store.getItem(TemplateService.templatesCacheKey(bob)) ?? "")
    #expect(cached.objectValue?.keys.sorted() == ["3la", "3lnew1"])
  }

  @Test func keepsATemplateDeletedWhileThePagesCameInDeleted() async throws {
    let records = [entry("3la", "Going"), entry("3lb", "Staying")]
    let first = FakeRepo(did: bob)
    first.onList = { _ in ["records": .array(records)] }
    try await service.load(TemplateAccount(did: bob, agent: first))
    let (repo, gate) = slowRepo(records)
    let account = TemplateAccount(did: bob, agent: repo)
    let pending = service.loadTask(account)
    await settle()
    try await service.remove("3la", account)
    await gate.release()
    #expect(names(try await pending.value) == ["Staying"])
    let cached = try JSONValue.parse(store.getItem(TemplateService.templatesCacheKey(bob)) ?? "")
    #expect(cached.objectValue?.keys.sorted() == ["3lb"])
  }

  @Test func keepsTheEditMadeWhileThePagesCameIn() async throws {
    let records = [entry("3la", "Before", text: "Hi")]
    let first = FakeRepo(did: bob)
    first.onList = { _ in ["records": .array(records)] }
    try await service.load(TemplateAccount(did: bob, agent: first))
    let (repo, gate) = slowRepo(records)
    let account = TemplateAccount(did: bob, agent: repo)
    let pending = service.loadTask(account)
    await settle()
    var edited = service.list(bob)[0]
    edited.name = "After"
    try await service.update("3la", edited, account)
    await gate.release()
    let loaded = try await pending.value
    #expect(loaded.map(\.name) == ["After"])
    #expect(loaded.first?.cid == "bafyput-3la")
  }

  @Test func forgetsTheWritesOfALoadTheResetDiscarded() async throws {
    let (repo, gate) = slowRepo([])
    let account = TemplateAccount(did: bob, agent: repo)
    let pending = service.loadTask(account)
    await settle()
    try await service.create(obj(["name": "Before the reset", "text": "Hi"]), account)
    service.reset()
    store.removeItem(TemplateService.templatesCacheKey(bob))
    await gate.release()
    #expect(try await pending.value.isEmpty)
    #expect(service.list(bob).isEmpty)
    #expect(store.getItem(TemplateService.templatesCacheKey(bob)) == nil)
  }

  @Test func keepsALoadThatStartedBeforeTheResetFromRefillingMemory() async throws {
    let (repo, gate) = slowRepo([entry("3la", "Before")])
    let account = TemplateAccount(did: bob, agent: repo)
    let pending = service.loadTask(account)
    await settle()
    service.reset()
    store.removeItem(TemplateService.templatesCacheKey(bob))
    await gate.release()
    #expect(try await pending.value.isEmpty)
    #expect(service.list(bob).isEmpty)
    #expect(store.getItem(TemplateService.templatesCacheKey(bob)) == nil)
    // The next load is a new request, not the discarded one.
    try await service.load(account)
    #expect(repo.count("list") == 2)
  }

  @Test func canForgetOneAccountAndLeaveAnothersLoadAlone() async throws {
    let first = FakeRepo(did: bob)
    first.onList = { _ in ["records": [entry("3la", "Bob’s")]] }
    try await service.load(TemplateAccount(did: bob, agent: first))
    let (repo, gate) = slowRepo([entry("3lc", "Carol’s", did: carol)], did: carol)
    let pending = service.loadTask(TemplateAccount(did: carol, agent: repo))
    await settle()
    service.reset(bob)
    await gate.release()
    #expect(names(try await pending.value) == ["Carol’s"])
    #expect(service.list(bob).isEmpty)
    #expect(service.isLoaded(carol))
  }

  @Test func keepsAWriteThatLandsAfterTheResetOutOfMemoryAndTheCache() async throws {
    let repo = FakeRepo(did: bob)
    let gate = Gate()
    repo.onCreate = { _ in
      await gate.wait()
      return ["uri": "at://did:plc:bob/net.anisota.feed.template/3llate", "cid": "bafylate"]
    }
    let account = TemplateAccount(did: bob, agent: repo)
    let service = self.service
    let pending = Task { @MainActor in try await service.create(obj(["name": "Late", "text": "x"]), account) }
    await settle()
    service.reset()
    store.removeItem(TemplateService.templatesCacheKey(bob))
    await gate.release()
    #expect(try await pending.value.rkey == "3llate")
    #expect(service.list(bob).isEmpty)
    #expect(store.getItem(TemplateService.templatesCacheKey(bob)) == nil)
  }

  @Test func anAgentGetterIsAskedForTheAccountItsCalledFor() async throws {
    let repo = FakeRepo(did: bob)
    repo.onList = { _ in ["records": [entry("3la", "Fetched")]] }
    let asked = Locked<[String]>([])
    let account = TemplateAccount(did: bob, agentFor: { did in
      asked.withLock { $0.append(did) }
      return repo
    })
    #expect(names(try await service.load(account)) == ["Fetched"])
    #expect(asked.wrappedValue == [bob])
  }

  @Test func listenersHearEveryChangeAndStopWhenTheyLeave() async throws {
    let heard = Locked<[String]>([])
    let stop = service.subscribe { did, templates in
      heard.withLock { $0.append("\(did ?? "-"): \(templates.map(\.name).joined(separator: ","))") }
    }
    let repo = FakeRepo(did: bob)
    try await service.create(obj(["name": "A", "text": "B"]), TemplateAccount(did: bob, agent: repo))
    service.reset()
    stop()
    service.reset()
    #expect(heard.wrappedValue == ["did:plc:bob: A", "did:plc:bob: "])
  }

  @Test func eventsGoToTheBusNamingTheAccount() async throws {
    let bus = PostingEventBus()
    let service = TemplateService(store: nil, target: bus, locale: "en-US")
    let details = Locked<[JSONValue]>([])
    _ = try PostingEvents.onPostingEvent(PostingEvents.templatesChangedEvent, did: bob, target: bus) { detail in
      details.withLock { $0.append(detail) }
    }
    try await service.create(obj(["name": "Evented", "text": "x"]), TemplateAccount(did: bob, agent: FakeRepo(did: bob)))
    #expect(details.wrappedValue.count == 1)
    #expect(details.wrappedValue.first?["did"] == "did:plc:bob")
    #expect(details.wrappedValue.first?["templates"]?[0]?["name"] == "Evented")
  }

  @Test func aRefusalThatIsntAnErrorObjectStillReadsAsAPermission() async throws {
    let repo = FakeRepo(did: bob)
    repo.onCreate = { _ in throw JSError(message: "", error: "Unauthorized") }
    do {
      try await service.create(obj(["name": "A", "text": "B"]), TemplateAccount(did: bob, agent: repo))
      Issue.record("expected a refusal")
    } catch let error as TemplateServiceError {
      #expect(error.message == TemplateService.templatePermissionMessage)
      #expect(error.permission)
      #expect((error.cause as? JSError)?.jsFields.error == "Unauthorized")
      #expect(error.jsFields.error == "Unauthorized")
    }
  }

  @Test func theErrorHelpersReadTheNetworksErrors() {
    let gone = XRPCError(statusCode: 400, error: "RecordNotFound", message: "Could not locate record")
    #expect(TemplateService.isRecordNotFound(gone))
    #expect(!TemplateService.isPermissionError(gone))
    let scope = XRPCError(statusCode: 403, error: "ScopeMissingError", message: "Missing required scope")
    #expect(TemplateService.isPermissionError(scope))
    let backend = BackendError(name: "Error", message: "x", status: 403, code: "FORBIDDEN")
    #expect(TemplateService.isPermissionError(backend))
    #expect(!TemplateService.isRecordNotFound(nil))
    #expect(!TemplateService.isPermissionError(nil))
  }

  @Test func aValidationRefusalCarriesTheProblemsAndMakesNoRequest() async throws {
    let repo = FakeRepo(did: bob)
    do {
      try await service.create(PostTemplate(name: "  ", text: ""), TemplateAccount(did: bob, agent: repo))
      Issue.record("expected a refusal")
    } catch let error as TemplateServiceError {
      #expect(error.fieldErrors?.fields == ["name", "text"])
      #expect(error.message == error.fieldErrors?.firstMessage)
    }
    #expect(repo.calls.wrappedValue.isEmpty)
  }

  @Test func theTypedTemplateSavesWhatTheLooseOneDoes() async throws {
    let repo = FakeRepo(did: bob)
    let records = Locked<[JSONValue]>([])
    repo.onCreate = { record in
      records.withLock { $0.append(record) }
      return ["uri": "at://did:plc:bob/net.anisota.feed.template/3lt", "cid": "c"]
    }
    let typed = PostTemplate(
      name: " Typed ", text: "Hi {{q}}", variables: [TemplateVariable(key: "q", label: "Q?")], use: "reply",
      shortcut: "/T", keywords: ["One", "one"])
    let account = TemplateAccount(did: bob, agent: repo)
    let saved = try await service.create(typed, account)
    // A second service, or the first save's shortcut would clash.
    try await TemplateService(store: nil, target: nil, locale: "en-US").create(typed.json, account)
    #expect(records.wrappedValue.count == 2)
    // The same record, but for the moment each was stamped.
    var written = records.wrappedValue
    for index in written.indices { written[index]["createdAt"] = nil }
    #expect(written[0] == written[1])
    #expect(written[0]["shortcut"] == "t")
    #expect(saved.shortcut == "t")
    #expect(saved.keywords == ["one"])
  }
}

/// A JSON literal as a value.
func obj(_ value: JSONValue) -> JSONValue { value }
