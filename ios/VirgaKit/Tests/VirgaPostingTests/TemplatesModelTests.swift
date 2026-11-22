// src/posting/templates/useTemplates.js as TemplatesModel: the hook's own
// tests (the cached copy at once, for the account asked for and no other;
// nothing read when disabled), and what its effect does after the first
// render, over a fake session and over a SessionModel signed in through
// Virga's server.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
@testable import VirgaPosting

@MainActor
final class FakeTemplatesSession: TemplatesSession {
  var repos: [String: FakeRepo] = [:]
  var asked: [String] = []

  func templateAgent(for did: String) async throws -> (any TemplateRepoAgent)? {
    asked.append(did)
    return repos[did]
  }
}

@MainActor @Suite struct TemplatesModelBehaviour {
  let store = InMemoryKeyValueStore()
  let service: TemplateService
  let session = FakeTemplatesSession()

  init() {
    service = TemplateService(store: store, target: nil, locale: "en-US")
  }

  func cache(_ did: String, _ entries: [JSONValue]) throws {
    var object: [String: JSONValue] = [:]
    for e in entries { object[TemplateJS.rkeyOf(e["uri"])] = e }
    try store.setItem(TemplateService.templatesCacheKey(did), JSONValue.object(object).jsonString())
  }

  func names(_ model: TemplatesModel) -> [String] { model.templates.map(\.name) }

  @Test func showsTheAccountsCachedTemplatesOnTheFirstRenderLoading() throws {
    try cache(bob, [entry("3la", "Cached")])
    let model = TemplatesModel(session: session, did: bob, service: service)
    #expect(names(model) == ["Cached"])
    #expect(model.loading)
    #expect(!model.ready)
    #expect(model.error == nil)
    #expect(TemplatesModel(session: session, did: carol, service: service).templates.isEmpty)
  }

  @Test func readsNothingWhenDisabledOrWithoutAnAccount() async throws {
    try cache(bob, [entry("3la", "Cached")])
    let disabled = TemplatesModel(session: session, did: bob, enabled: false, service: service)
    #expect(disabled.templates.isEmpty && !disabled.loading && !disabled.ready)
    let none = TemplatesModel(session: session, did: nil, service: service)
    #expect(none.templates.isEmpty && !none.loading)
    disabled.start()
    none.start()
    #expect(service.list(bob).isEmpty)
    #expect(session.asked.isEmpty)
    #expect(await none.reload().isEmpty)
  }

  @Test func loadsOnceStartedAndIsReady() async throws {
    let repo = FakeRepo(did: bob)
    repo.onList = { _ in ["records": [entry("3la", "Loaded"), entry("3lb", "Also")]] }
    session.repos[bob] = repo
    let model = TemplatesModel(session: session, did: bob, service: service)
    model.start()
    _ = await model.effectLoad?.value
    #expect(names(model) == ["Also", "Loaded"])
    #expect(model.ready && !model.loading && model.error == nil)
    #expect(session.asked == [bob])
    // A second model for the account reads what the first confirmed, and loads nothing.
    let second = TemplatesModel(session: session, did: bob, service: service)
    second.start()
    #expect(second.ready && second.effectLoad == nil)
    #expect(repo.count("list") == 1)
  }

  @Test func aFailedLoadKeepsTheCachedCopyAndSaysWhy() async throws {
    try cache(bob, [entry("3la", "From before")])
    let repo = FakeRepo(did: bob)
    repo.onList = { _ in throw XRPCError(statusCode: 502, error: "UpstreamFailure", message: "network down") }
    session.repos[bob] = repo
    let model = TemplatesModel(session: session, did: bob, service: service)
    model.start()
    _ = await model.effectLoad?.value
    #expect(names(model) == ["From before"])
    #expect(!model.loading && !model.ready)
    #expect(model.error.map(jsMessage) == "network down")
    // reload never throws; it answers what memory holds.
    #expect(await model.reload().map(\.name) == ["From before"])
  }

  @Test func followsWhatTheServiceChangesForItsAccountOnly() async throws {
    let repo = FakeRepo(did: bob)
    session.repos[bob] = repo
    session.repos[carol] = FakeRepo(did: carol)
    let model = TemplatesModel(session: session, did: bob, service: service)
    model.start()
    _ = await model.effectLoad?.value
    try await service.create(PostTemplate(name: "From elsewhere", text: "x"), TemplateAccount(did: bob, agent: repo))
    #expect(names(model) == ["From elsewhere"])
    try await service.create(PostTemplate(name: "Carol’s", text: "x"), TemplateAccount(did: carol, agent: FakeRepo(did: carol)))
    #expect(names(model) == ["From elsewhere"])
    model.stop()
    service.reset()
    // Stopped, it no longer follows.
    #expect(names(model) == ["From elsewhere"])
  }

  @Test func switchingAccountsShowsTheNewOnesCacheAndIgnoresTheOldLoad() async throws {
    let (slow, gate) = slowRepo([entry("3la", "Bob’s late")])
    session.repos[bob] = slow
    let carolRepo = FakeRepo(did: carol)
    carolRepo.onList = { _ in ["records": [entry("3lc", "Carol’s", did: carol)]] }
    session.repos[carol] = carolRepo
    try cache(carol, [entry("3lc", "Carol’s cached", did: carol)])
    let model = TemplatesModel(session: session, did: bob, service: service)
    model.start()
    await settle()
    let bobsLoad = model.effectLoad
    model.setAccount(carol)
    #expect(model.forDid == carol)
    #expect(names(model) == ["Carol’s cached"])
    #expect(model.loading)
    _ = await model.effectLoad?.value
    #expect(names(model) == ["Carol’s"])
    await gate.release()
    #expect(await bobsLoad?.value.isEmpty == true)
    #expect(names(model) == ["Carol’s"])
    // Turning it off shows nothing.
    model.setAccount(carol, enabled: false)
    #expect(model.templates.isEmpty && !model.loading)
  }

  @Test func writesGoToTheOpenAccountAndRethrow() async throws {
    let repo = FakeRepo(did: bob)
    session.repos[bob] = repo
    let model = TemplatesModel(session: session, did: bob, service: service)
    model.start()
    _ = await model.effectLoad?.value
    let made = try await model.create(PostTemplate(name: "Made", text: "Hi"))
    #expect(made.rkey == "3lnew1")
    var edited = made
    edited.name = "Edited"
    let saved = try await model.update(made.rkey, edited)
    #expect(saved.name == "Edited")
    #expect(names(model) == ["Edited"])
    try await model.remove(made.rkey)
    #expect(model.templates.isEmpty)
    #expect(repo.calls.wrappedValue == ["list -", "create", "put 3lnew1", "delete 3lnew1"])

    repo.onCreate = { _ in throw JSError(message: "socket hang up") }
    await #expect(throws: (any Error).self) { try await model.create(PostTemplate(name: "A", text: "B")) }
    let none = TemplatesModel(session: session, did: nil, service: service)
    do {
      try await none.create(PostTemplate(name: "A", text: "B"))
      Issue.record("expected a refusal")
    } catch {
      #expect(jsMessage(error) == "Not signed in")
    }
  }

  @Test func aSessionWithoutTheAccountLeavesItsErrorInError() async throws {
    let env = SessionEnvironment(
      storage: InMemoryKeyValueStore(), tabStorage: InMemoryKeyValueStore(), secrets: InMemorySecretStore(),
      backendUrl: "https://server.example", transport: MockTransport())
    let model = TemplatesModel(session: SessionModel(env: env), did: bob, service: service)
    model.start()
    _ = await model.effectLoad?.value
    #expect(Accounts.isReauthRequiredError(model.error))
    #expect(model.templates.isEmpty && !model.loading)
  }

  @Test func readsThroughTheSessionsAgentAndVirgasServer() async throws {
    let storage = InMemoryKeyValueStore()
    let secrets = InMemorySecretStore()
    let token = "vg_" + String(repeating: "ab", count: 32)
    Accounts.recordSignIn(storage, did: bob, mode: "backend", now: 1)
    Accounts.writeBackendToken(secrets, bob, token)
    let transport = MockTransport()
    transport.on(.urlPrefix("https://server.example/api/oauth/proxy?"), respond: .json([
      "success": true,
      "data": ["records": [entry("3la", "Through the server")]],
    ]))
    let env = SessionEnvironment(
      storage: storage, tabStorage: InMemoryKeyValueStore(), secrets: secrets, backendUrl: "https://server.example",
      transport: transport)
    let model = TemplatesModel(session: SessionModel(env: env), did: bob, service: service)
    model.start()
    _ = await model.effectLoad?.value
    #expect(names(model) == ["Through the server"])
    #expect(model.ready)
    let sent = transport.requests.first
    #expect(sent?.headers.get("authorization") == "Bearer \(token)")
    #expect(sent?.headers.get("x-xrpc-method") == "com.atproto.repo.listRecords")
    #expect(sent?.url.contains("collection=net.anisota.feed.template") == true)
  }
}
