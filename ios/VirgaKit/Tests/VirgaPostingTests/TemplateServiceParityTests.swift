// Parity for src/posting/templates/templateService.js (fixture
// templates.templateService): every script's requests through Virga's
// server, answered from MockTransport, and what each call returned or
// threw, what the listeners heard and the cache left behind.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

enum TemplateServiceFixture {
  static let server = "https://server.example"
  static let token = "vg_" + String(repeating: "0f", count: 32)
  static let did = "did:plc:bob"
  static let other = "did:plc:carol"
  static let now = Date(timeIntervalSince1970: 1_791_979_200)  // 2026-10-14T12:00:00Z
}

/// What the fixture records of an error a call threw.
func templateErrorJSON(_ error: any Error) -> JSONValue {
  let service = error as? TemplateServiceError
  return [
    "$throws": .string(jsMessage(error)),
    "fieldErrors": service?.fieldErrors?.json ?? .null,
    "permission": service?.permission == true ? true : .null,
  ]
}

@MainActor
struct TemplateScript {
  let transport: MockTransport
  let store: InMemoryKeyValueStore
  let service: TemplateService
  let heard = Locked<[JSONValue]>([])
  let events = Locked<[JSONValue]>([])
  let bus = PostingEventBus()

  init(_ c: ParityCase, transport: MockTransport) {
    self.transport = transport
    var initial: [String: String] = [:]
    for (key, value) in c["store"].objectValue ?? [:] { initial[key] = value.stringValue }
    store = InMemoryKeyValueStore(initial)
    service = TemplateService(store: store, target: bus, locale: "en-US", now: { TemplateServiceFixture.now })
    let events = self.events
    _ = try? PostingEvents.onPostingEvent(PostingEvents.templatesChangedEvent, target: bus) { detail in
      let names = (detail["templates"]?.arrayValue ?? []).map { $0["name"] ?? .null }
      events.withLock { $0.append(["did": detail["did"] ?? .null, "names": .array(names)]) }
    }
    let heard = self.heard
    service.subscribe { did, templates in
      heard.withLock { $0.append(["did": did.map(JSONValue.string) ?? .null, "names": .array(templates.map { .string($0.name) })]) }
    }
  }

  func agent(_ did: String) -> XRPCAgent {
    XRPCAgent(
      did: did,
      fetchHandler: BackendFetchHandler(backendUrl: TemplateServiceFixture.server, token: TemplateServiceFixture.token, did: did, transport: transport))
  }

  func account(_ who: JSONValue?) -> TemplateAccount? {
    let did = TemplateServiceFixture.did
    let other = TemplateServiceFixture.other
    switch who?.stringValue {
    case "bob": return TemplateAccount(did: did, agent: agent(did))
    case "carol": return TemplateAccount(did: other, agent: agent(other))
    case "getter":
      let make = self.agent
      return TemplateAccount(did: did, agentFor: { d in make(d) })
    case "getterNull": return TemplateAccount(did: did, agentFor: { _ in nil })
    case "other": return TemplateAccount(did: did, agent: agent(other))
    case "none": return TemplateAccount(did: did, agent: nil)
    case "empty": return TemplateAccount(did: "", agent: agent(did))
    default: return nil
    }
  }

  func template(_ spec: JSONValue?) -> JSONValue {
    guard let spec, case .object(var fields) = spec, let from = fields["$from"]?.arrayValue else { return spec ?? .null }
    fields["$from"] = nil
    let listed = service.list(from[0].stringValue)
    var members = listed[from[1].intValue ?? 0].json.objectValue ?? [:]
    for (key, value) in fields { members[key] = value }
    return .object(members)
  }

  func run(_ op: [JSONValue]) async -> JSONValue {
    let args = Array(op.dropFirst())
    func templates(_ list: [PostTemplate]) -> JSONValue { .array(list.map(\.json)) }
    do {
      switch op.first?.stringValue {
      case "load": return ["value": templates(try await service.load(account(args[0])))]
      case "list": return ["value": templates(service.list(args[0].stringValue))]
      case "isLoaded": return ["value": .bool(service.isLoaded(args[0].stringValue))]
      case "prime": return ["value": templates(service.primeFromCache(args[0].stringValue))]
      case "create": return ["value": try await service.create(template(args[0]), account(args[1])).json]
      case "update": return ["value": try await service.update(args[0].stringValue, template(args[1]), account(args[2])).json]
      case "remove":
        try await service.remove(args[0].stringValue, account(args[1]))
        return ["value": .null]
      case "reset":
        service.reset(args.first?.stringValue)
        return ["value": .null]
      case "setStore":
        try store.setItem(args[0].stringValue ?? "", args[1].stringValue ?? "")
        return ["value": .null]
      case "clearStore":
        for key in store.allKeys() { store.removeItem(key) }
        return ["value": .null]
      default:
        return ["$throws": "unknown op"]
      }
    } catch {
      return templateErrorJSON(error)
    }
  }

  func result(_ results: [JSONValue]) -> JSONValue {
    var stored: [String: JSONValue] = [:]
    for (key, text) in store.snapshot { stored[key] = (try? JSONValue.parse(text)) ?? ["$text": .string(text)] }
    return [
      "results": .array(results),
      "heard": .array(heard.wrappedValue),
      "events": .array(events.wrappedValue),
      "store": .object(stored),
    ]
  }
}

@Suite struct TemplateServiceParity {
  static let f = "templates.templateService"

  @Test func constants() throws {
    check(.string(TemplateService.templatePermissionMessage), try cases(Self.f, "TEMPLATE_PERMISSION_MESSAGE")[0])
    for c in try cases(Self.f, "templatesCacheKey") {
      check(.string(TemplateService.templatesCacheKey(c.string("did") ?? "")), c)
    }
  }

  /// An error as the fixture describes it, as the Swift side would meet it.
  static func error(_ c: ParityCase) -> (any Error)? {
    if c["isNull"].boolValue == true { return nil }
    return JSError(message: c.string("message") ?? "", code: c.input["code"], error: c.string("error"))
  }

  @Test func errorHelpers() throws {
    for c in try cases(Self.f, "isRecordNotFound") {
      check(.bool(TemplateService.isRecordNotFound(Self.error(c))), c)
    }
    for c in try cases(Self.f, "isPermissionError") {
      check(.bool(TemplateService.isPermissionError(Self.error(c))), c)
    }
  }

  @Test @MainActor func scripts() async throws {
    for c in try cases(Self.f, "script") {
      let recording = RecordedFetch(c.output)
      let transport = recording.transport()
      let script = TemplateScript(c, transport: transport)
      var results: [JSONValue] = []
      for op in c["ops"].arrayValue ?? [] {
        results.append(await script.run(op.arrayValue ?? []))
      }
      let d = recording.check(sent: transport.requests, result: script.result(results))
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
