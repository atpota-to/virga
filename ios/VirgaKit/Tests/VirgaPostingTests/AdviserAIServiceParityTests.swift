// adviser/aiService.js held to adviser.aiService: every call replayed over
// VirgaBackend from the recorded exchanges.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaPosting

/// The server and account the AI generators record against.
enum AdviserFixtureServer {
  static let server = "https://server.example"
  static let did = "did:plc:writer"
  static let token = "vg_" + String(repeating: "0f", count: 32)
  static let now: Double = 1_794_477_600_000  // 2026-11-12T10:00:00Z

  /// The posting account's requester over `transport`.
  static func requester(_ transport: any HTTPTransport, did: String? = did) -> VirgaBackend {
    VirgaBackend(backendUrl: server, token: { token }, did: did, transport: transport)
  }
}

/// The fields of an error as the AI generators' errorShape records them.
func aiErrorShape(_ error: any Error) -> JSONValue {
  if let ai = error as? AIServiceError { return ai.json }
  let f = AIErrorFields(error)
  var out: JSONValue = [
    "name": .string(f.name), "message": .string(f.message), "status": f.status.map { .number(Double($0)) } ?? .null,
    "code": f.code ?? .null, "detail": f.detail.map(JSONValue.string) ?? .null, "payload": f.payload ?? .null,
  ]
  if f.canceled { out["canceled"] = true }
  return out
}

final class UsageLog: Sendable {
  let seen = Locked<[JSONValue]>([])
  var onUsage: @Sendable (AIUsageCount) -> Void {
    { [seen] u in seen.withLock { $0.append(["used": .number(u.used), "limit": .number(u.limit)]) } }
  }
  var json: JSONValue { .array(seen.withLock { $0 }) }
}

@Suite struct AdviserAIServiceParity {
  static let f = "adviser.aiService"

  @Test func constants() throws {
    for c in try cases(Self.f, "aiConstants") {
      check(
        [
          "AI_REQUEST_TIMEOUT_MS": .number(AIService.aiRequestTimeoutMs),
          "ALT_TEXT_MIME_TYPES": json(AIService.altTextMimeTypes),
          "MAX_ALT_TEXT_BASE64": .number(Double(AIService.maxAltTextBase64)),
        ], c)
    }
  }

  @Test func messages() throws {
    for c in try cases(Self.f, "aiErrorMessage") {
      check(["message": AIService.aiErrorMessage(c.input["err"]).map(JSONValue.string) ?? .null], c)
    }
  }

  /// The payload a case names, with `image: { repeat, count }` spelled out.
  static func payload(_ c: ParityCase) -> JSONValue? {
    guard var payload = c.input["payload"] else { return nil }
    if let image = payload["image"], let unit = image["repeat"]?.stringValue, let count = image["count"]?.intValue {
      payload = .object((payload.objectValue ?? [:]).filter { $0.key != "image" })
      payload["imageBase64"] = .string(String(repeating: unit, count: count))
    }
    return payload
  }

  @Test(arguments: ["analyzePost", "synthesizeStyle", "generateAltText", "generateAltTextForFile"])
  func calls(_ fn: String) async throws {
    for c in try cases(Self.f, fn) {
      let recorded = RecordedFetch(c.output)
      let transport = recorded.transport()
      let initial = (c["initial"].objectValue ?? [:]).compactMapValues(\.stringValue)
      let store = InMemoryKeyValueStore(initial)
      let req: (any AIRequester)? =
        c["requester"].stringValue == "none"
        ? nil : AdviserFixtureServer.requester(transport, did: c["did"].stringValue ?? AdviserFixtureServer.did)
      let signal = AdviserAbortSignal()
      if c["aborted"].boolValue == true { signal.abort() }
      let given: AdviserAbortSignal? = c["aborted"].boolValue == true ? signal : nil
      let log = UsageLog()
      let onUsage: (@Sendable (AIUsageCount) -> Void)? = c["withOnUsage"].boolValue == true ? log.onUsage : nil
      let now: @Sendable () -> Double = { AdviserFixtureServer.now }
      let payload = Self.payload(c)
      var out: JSONValue
      do {
        switch fn {
        case "analyzePost":
          out = ["value": try await AIService.analyzePost(req, payload, signal: given, store: store, now: now)]
        case "synthesizeStyle":
          out = ["value": try await AIService.synthesizeStyle(req, payload, signal: given, store: store, now: now).json]
        case "generateAltText":
          out = [
            "value": .string(
              try await AIService.generateAltText(
                req, payload, onUsage: onUsage, signal: given, store: store, now: now))
          ]
        default:
          let file = c["file"]
          let composerFile = file.objectValue == nil
            ? nil : ComposerFile(name: file["name"]?.stringValue, type: file["type"]?.stringValue ?? "", size: 0)
          let bytes = Data((file["bytes"]?.arrayValue ?? []).compactMap { $0.intValue.map(UInt8.init) })
          out = [
            "value": .string(
              try await AIService.generateAltTextForFile(
                req, composerFile, read: { _ in bytes }, payload: payload, onUsage: onUsage, signal: given,
                store: store, now: now))
          ]
        }
      } catch {
        out = ["error": aiErrorShape(error)]
      }
      out["store"] = storeSnapshot(store)
      out["usages"] = log.json
      let d = recorded.check(sent: transport.requests, result: out)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
